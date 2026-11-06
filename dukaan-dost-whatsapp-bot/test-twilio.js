/*
 * Offline test for the Twilio Sandbox route: fakes Twilio and Gemini. Run: node test-twilio.js
 */
'use strict';
const assert = require('assert');

process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'secret';
process.env.TWILIO_MIN_GAP_MS = '0';
process.env.GEMINI_API_KEY = 'fake-key';
process.env.DISTRIBUTOR_NUMBER = '919800000001';
['WHATSAPP_TOKEN', 'PHONE_NUMBER_ID', 'VERIFY_TOKEN', 'APP_SECRET', 'CUSTOMER_NUMBERS', 'GEMINI_MODEL'].forEach((k) => delete process.env[k]);

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  if (url.startsWith('https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json')) {
    assert.strictEqual(opts.headers.Authorization, 'Basic ' + Buffer.from('ACtest:secret').toString('base64'));
    const p = new URLSearchParams(opts.body);
    sent.push({ from: p.get('From'), to: p.get('To'), body: p.get('Body') });
    return json({ sid: 'SM' + sent.length }, 201);
  }
  if (url.startsWith('https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages/MM1/Media/ME1')) {
    assert.ok(opts.headers.Authorization.startsWith('Basic '));
    return new Response(Buffer.from('OggS-fake'), { status: 200, headers: { 'content-type': 'audio/ogg' } });
  }
  if (url.includes('generativelanguage.googleapis.com')) {
    const req = JSON.parse(opts.body);
    const parts = req.contents[0].parts;
    const all = parts.map((p) => p.text || '').join('\n');
    if (req.generationConfig.responseMimeType === 'application/json') {
      let out = { language: 'English', script: 'native', intent: 'other', items: [], product_id: null };
      if (parts.some((p) => p.inline_data)) out = { transcript: 'aaj ka plan batao', language: 'Hindi', script: 'native', intent: 'plan', items: [], product_id: null };
      else if (all.includes('The owner wrote: namaste')) out = { language: 'Hindi', script: 'latin', intent: 'greeting', items: [], product_id: null };
      else if (all.includes('The owner wrote: 3 maggi bechi')) out = { language: 'Hindi', script: 'latin', intent: 'sales', items: [{ product_id: 'maggi', qty: 3 }], product_id: null };
      return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] });
    }
    const msg = all.split('\n\n').slice(1).join('\n\n');
    return json({ candidates: [{ content: { parts: [{ text: '[hi] ' + msg }] } }] });
  }
  throw new Error('Unexpected fetch: ' + url);
};

const { server, _queues } = require('./server.js');
async function settle() { for (let i = 0; i < 20; i++) { await Promise.all([..._queues.values()]); await new Promise((r) => setTimeout(r, 10)); } }

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  let n = 0;
  const post = (fields) => fetch(base + '/twilio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.assign({ MessageSid: 'SMin' + (++n), From: 'whatsapp:+919999999999', To: 'whatsapp:+14155238886', NumMedia: '0' }, fields)).toString()
  });
  const pass = (m) => console.log('PASS', m);

  let r = await post({ Body: 'namaste' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(await r.text(), '<Response></Response>');
  await settle();
  assert.strictEqual(sent.length, 3);
  assert.ok(sent.every((m) => m.from === 'whatsapp:+14155238886' && m.to === 'whatsapp:+919999999999'));
  assert.ok(sent[0].body.startsWith('[hi] Namaste, Ramesh!'));
  assert.ok(sent[2].body.includes('Reply with a number:\n1 – '));
  pass('Twilio "namaste" → welcome, plan and numbered options (1/2/3) in Hindi');

  sent.length = 0;
  await post({ Body: '3 maggi bechi' }); await settle();
  assert.ok(sent[0].body.startsWith('[hi] Saved: 3 × Maggi noodles.'));
  pass('Hinglish sale recorded');

  sent.length = 0;
  await post({ Body: '1' }); await settle();
  assert.ok(sent[0].body.includes('Order #O'));
  assert.ok(sent.some((m) => m.to === 'whatsapp:+919800000001' && m.body.startsWith('Namaste! New order')));
  pass('reply "1" sends the order (and a copy to the distributor)');

  sent.length = 0;
  await post({ NumMedia: '1', MediaContentType0: 'audio/ogg', MediaUrl0: 'https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages/MM1/Media/ME1', Body: '' }); await settle();
  assert.ok(sent[0].body.startsWith('[hi] *Good morning!'));
  pass('voice note downloaded from Twilio and understood');

  sent.length = 0;
  await post({ NumMedia: '1', MediaContentType0: 'image/jpeg', MediaUrl0: 'https://example.com/x.jpg', Body: '' }); await settle();
  assert.ok(sent[0].body.startsWith('Please send a text or a voice note'));
  pass('photos get a polite reply');

  r = await fetch(base + '/');
  assert.ok((await r.text()).includes('WhatsApp via Twilio'));
  pass('health page shows Twilio mode');

  server.close();
  console.log('\nALL TWILIO TESTS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
