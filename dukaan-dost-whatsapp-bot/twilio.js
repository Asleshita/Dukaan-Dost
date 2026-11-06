/*
 * Dukaan Dost – talking to WhatsApp through the Twilio WhatsApp Sandbox
 * (no Facebook account needed). Same functions as whatsapp.js, so bot.js works with either.
 *
 * Settings:
 *   TWILIO_ACCOUNT_SID     from the Twilio Console home page
 *   TWILIO_AUTH_TOKEN      from the Twilio Console home page
 *   TWILIO_WHATSAPP_FROM   optional, default whatsapp:+14155238886 (the Sandbox number)
 */
'use strict';

const FROM = () => process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
// The Sandbox sends at most one message every 3 seconds, so we space messages out.
const GAP_MS = () => Number(process.env.TWILIO_MIN_GAP_MS != null ? process.env.TWILIO_MIN_GAP_MS : 3100);

let lastSend = 0;
let chain = Promise.resolve();

function basicAuth() {
  return 'Basic ' + Buffer.from(process.env.TWILIO_ACCOUNT_SID + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64');
}

function toWhatsApp(n) {
  const s = String(n);
  if (s.startsWith('whatsapp:')) return s;
  return 'whatsapp:+' + s.replace(/[^\d]/g, '');
}

function send(to, body) {
  const job = chain.then(async () => {
    const wait = lastSend + GAP_MS() - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSend = Date.now();
    const form = new URLSearchParams({ From: FROM(), To: toWhatsApp(to), Body: String(body).slice(0, 1600) });
    const res = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + process.env.TWILIO_ACCOUNT_SID + '/Messages.json', {
      method: 'POST',
      headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
    const text = await res.text();
    if (!res.ok) {
      console.error('[twilio] send failed', res.status, text.slice(0, 400));
      throw new Error('Twilio send failed (' + res.status + ')');
    }
    return JSON.parse(text);
  });
  chain = job.catch(() => {});
  return job;
}

/* WhatsApp via Twilio allows 1600 characters per message; long replies (Telugu, Tamil…) are split at line breaks. */
function splitBody(body, max) {
  const out = [];
  let cur = '';
  for (const line of String(body).split('\n')) {
    const next = cur ? cur + '\n' + line : line;
    if (next.length <= max) { cur = next; continue; }
    if (cur) out.push(cur.trim());
    cur = line.slice(0, max);
  }
  if (cur.trim()) out.push(cur.trim());
  return out.length ? out : [''];
}

async function sendText(to, body) {
  let last = null;
  for (const part of splitBody(body, 1500)) last = await send(to, part);
  return last;
}

/* The Sandbox can’t show tap buttons, so we offer numbered replies instead (1, 2, 3). */
function sendButtons(to, body, buttons) {
  const lines = buttons.slice(0, 3).map((b, i) => (i + 1) + ' – ' + b.title);
  return send(to, body + '\n\nReply with a number:\n' + lines.join('\n'));
}

/* Voice notes arrive as a URL; Twilio may require our account login to download them. */
async function downloadMedia(media) {
  const res = await fetch(media.url, { headers: { Authorization: basicAuth() } });
  if (!res.ok) throw new Error('Twilio media download failed (' + res.status + ')');
  const buf = Buffer.from(await res.arrayBuffer());
  return { data: buf.toString('base64'), mimeType: String(media.mimeType || res.headers.get('content-type') || 'audio/ogg').split(';')[0].trim() };
}

async function markRead() { /* not available on Twilio */ }

module.exports = { textButtons: true, sendText, sendButtons, downloadMedia, markRead, _reset: () => { lastSend = 0; chain = Promise.resolve(); } };
