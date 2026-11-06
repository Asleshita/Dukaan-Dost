/*
 * Dukaan Dost – WhatsApp bot server
 *
 * Meta sends every WhatsApp message to POST /webhook. We answer "200 OK" at once
 * (Meta wants a reply within 10 seconds), then understand the message with AI,
 * run the engine and reply on WhatsApp.
 *
 * Needs Node 18 or newer. No npm packages.
 * Settings (environment variables):
 *   WHATSAPP_TOKEN     access token from Meta (WhatsApp → API Setup)
 *   PHONE_NUMBER_ID    the test number’s Phone number ID (15 digits, not the WABA ID)
 *   VERIFY_TOKEN       any secret word you choose; type the same word in Meta’s webhook settings
 *   GEMINI_API_KEY     free key from Google AI Studio (for any-language text and voice notes)
 *   APP_SECRET         optional: Meta app secret, to check messages really come from Meta
 *   DISTRIBUTOR_NUMBER optional: a phone number (e.g. 919876543210) that receives orders
 *   CUSTOMER_NUMBERS   optional: comma-separated numbers that receive offers
 *   GEMINI_MODEL       optional: force a Gemini model name
 */
'use strict';

const http = require('http');
const crypto = require('crypto');

// Reuse the web app’s engine and sample data unchanged.
globalThis.window = globalThis;
require('./data.js');
require('./engine.js');

const ai = require('./ai.js');
// Twilio Sandbox (no Facebook needed) if its keys are set, otherwise Meta’s WhatsApp Cloud API.
const USE_TWILIO = Boolean(process.env.TWILIO_ACCOUNT_SID);
const wa = USE_TWILIO ? require('./twilio.js') : require('./whatsapp.js');
const { createBot } = require('./bot.js');

const bot = createBot({ DD: globalThis.DD, ai: ai, wa: wa });
const PORT = process.env.PORT || 3000;
const seen = new Set();      // message ids already handled (Meta may retry)
const queues = new Map();    // one message at a time per phone number

function checkSettings() {
  console.log('[setup] WhatsApp provider: ' + (USE_TWILIO ? 'Twilio Sandbox (webhook: /twilio)' : 'Meta Cloud API (webhook: /webhook)'));
  (USE_TWILIO ? ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] : ['WHATSAPP_TOKEN', 'PHONE_NUMBER_ID', 'VERIFY_TOKEN']).forEach((k) => {
    if (!process.env[k]) console.warn('[setup] missing ' + k);
  });
  if (!ai.enabled()) console.warn('[setup] GEMINI_API_KEY missing: only English typed messages will work');
}

function validSignature(raw, header) {
  if (!process.env.APP_SECRET) return true;
  if (!header) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', process.env.APP_SECRET).update(raw).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* Pull the messages we care about out of Meta’s webhook payload. */
function extractMessages(payload) {
  const out = [];
  (payload.entry || []).forEach((entry) => {
    (entry.changes || []).forEach((change) => {
      const value = change.value || {};
      (value.messages || []).forEach((m) => {
        const msg = { id: m.id, from: m.from, type: m.type };
        if (m.type === 'text') msg.text = m.text && m.text.body;
        else if (m.type === 'audio') msg.audio = { id: m.audio && m.audio.id };
        else if (m.type === 'interactive' && m.interactive && m.interactive.button_reply) msg.buttonId = m.interactive.button_reply.id;
        else if (m.type === 'button' && m.button) msg.text = m.button.text;
        else msg.unsupported = true;
        out.push(msg);
      });
    });
  });
  return out;
}

function enqueue(msg) {
  if (seen.has(msg.id)) return;
  seen.add(msg.id);
  if (seen.size > 5000) seen.clear();
  const prev = queues.get(msg.from) || Promise.resolve();
  const next = prev.then(async () => {
    wa.markRead(msg.id);
    if (msg.unsupported) {
      await wa.sendText(msg.from, 'Please send a text or a voice note. Type *help* to see what I can do.');
      return;
    }
    await bot.handle(msg);
  }).catch(async (err) => {
    console.error('[server] failed to handle message:', err.message);
    try { await wa.sendText(msg.from, 'Sorry, something went wrong. Please try again.'); } catch (e) { /* ignore */ }
  });
  queues.set(msg.from, next);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Dukaan Dost WhatsApp bot is running. AI: ' + (ai.enabled() ? 'on' : 'off') + ' · WhatsApp via ' + (USE_TWILIO ? 'Twilio' : 'Meta'));
    return;
  }

  // Meta checks the webhook once when you save it in the dashboard.
  if (req.method === 'GET' && url.pathname === '/webhook') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === process.env.VERIFY_TOKEN;
    res.writeHead(ok ? 200 : 403, { 'Content-Type': 'text/plain' });
    res.end(ok ? url.searchParams.get('hub.challenge') : 'Forbidden');
    if (ok) console.log('[webhook] verified by Meta');
    return;
  }

  // Twilio Sandbox: "When a message comes in" → https://YOUR-APP.onrender.com/twilio
  if (req.method === 'POST' && url.pathname === '/twilio') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end('<Response></Response>');
      try {
        const p = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        const msg = { id: p.get('MessageSid') || ('tw' + Date.now()), from: p.get('From') };
        if (!msg.from) return;
        const numMedia = Number(p.get('NumMedia') || 0);
        const type = String(p.get('MediaContentType0') || '');
        if (numMedia > 0 && type.startsWith('audio/')) msg.audio = { url: p.get('MediaUrl0'), mimeType: type };
        else if (numMedia > 0 && !p.get('Body')) msg.unsupported = true;
        else if (p.get('ButtonPayload')) msg.buttonId = p.get('ButtonPayload');
        else msg.text = p.get('Body') || '';
        enqueue(msg);
      } catch (e) { console.error('[twilio] bad payload:', e.message); }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/webhook') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (!validSignature(raw, req.headers['x-hub-signature-256'])) {
        res.writeHead(401); res.end('Bad signature');
        return;
      }
      res.writeHead(200); res.end('EVENT_RECEIVED');
      try { extractMessages(JSON.parse(raw.toString('utf8'))).forEach(enqueue); } catch (e) { console.error('[webhook] bad payload:', e.message); }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

if (require.main === module) {
  checkSettings();
  server.listen(PORT, () => console.log('Dukaan Dost WhatsApp bot listening on port ' + PORT));
}

module.exports = { server, extractMessages, _queues: queues };
