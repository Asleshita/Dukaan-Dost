/*
 * Offline test: fakes Meta’s WhatsApp API and Google Gemini, then sends the bot
 * real-looking webhook messages. Run: node test-bot.js
 */
'use strict';
const assert = require('assert');
const crypto = require('crypto');

process.env.WHATSAPP_TOKEN = 'test-token';
process.env.PHONE_NUMBER_ID = '111111111111111';
process.env.VERIFY_TOKEN = 'dukaan-secret';
process.env.GEMINI_API_KEY = 'fake-key';
process.env.APP_SECRET = 'app-secret';
process.env.DISTRIBUTOR_NUMBER = '919800000001';
process.env.CUSTOMER_NUMBERS = '919800000002, 919800000003';
delete process.env.GEMINI_MODEL;

const sent = [];        // messages the bot sent to WhatsApp
const geminiCalls = []; // prompts sent to Gemini
let geminiDown = false;
const realFetch = globalThis.fetch;

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  if (url.includes('graph.facebook.com') && url.endsWith('/messages')) {
    const body = JSON.parse(opts.body);
    if (!body.status) sent.push(body);
    return json({ messages: [{ id: 'wamid.out' + sent.length }] });
  }
  if (url.includes('graph.facebook.com') && url.includes('MEDIA123')) {
    assert.strictEqual(opts.headers.Authorization, 'Bearer test-token');
    return json({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=MEDIA123', mime_type: 'audio/ogg; codecs=opus' });
  }
  if (url.includes('lookaside.fbsbx.com')) return new Response(Buffer.from('OggS-fake-voice-note'), { status: 200 });
  if (url.includes('generativelanguage.googleapis.com')) {
    const model = decodeURIComponent(url.split('/models/')[1].split(':')[0]);
    if (model === 'gemini-3.8-flash') return json({ error: { message: 'models/gemini-3.8-flash is not found' } }, 404);
    if (geminiDown) return json({ error: { message: 'overloaded' } }, 503);
    const req = JSON.parse(opts.body);
    const parts = req.contents[0].parts;
    const all = parts.map((p) => p.text || '').join('\n');
    const wantsJson = req.generationConfig.responseMimeType === 'application/json';
    geminiCalls.push({ model, all, parts, wantsJson });
    let out;
    if (wantsJson) {
      if (parts.some((p) => p.inline_data)) {
        out = { transcript: 'ఈరోజు ప్లాన్ చెప్పు', english: 'Tell me today’s plan', language: 'Telugu', script: 'native', intent: 'plan', items: [], product_id: null };
      } else if (all.includes('aaj 6 bread aur 4 dahi bika')) {
        out = { transcript: 'aaj 6 bread aur 4 dahi bika', english: 'Today 6 bread and 4 curd sold', language: 'Hindi', script: 'latin', intent: 'sales', items: [{ product_id: 'bread', qty: 6 }, { product_id: 'curd', qty: 4 }, { product_id: 'unknown', qty: 2 }], product_id: null };
      } else if (all.includes('The owner wrote: hi')) {
        out = { transcript: 'hi', english: 'hi', language: 'English', script: 'native', intent: 'greeting', items: [], product_id: null };
      } else if (all.includes('பனீர் எவ்வளவு இருக்கு')) {
        out = { transcript: 'பனீர் எவ்வளவு இருக்கு', english: 'How much paneer is left', language: 'Tamil', script: 'native', intent: 'stock', items: [], product_id: 'paneer' };
      } else {
        out = { transcript: '', english: '', language: 'English', script: 'native', intent: 'other', items: [], product_id: null };
      }
      return json({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(out) + '\n```' }] } }] });
    }
    // translation request: echo with a language tag
    const lang = (all.match(/in (\w+)\./) || [])[1];
    const msg = all.split('\n\n').slice(1).join('\n\n');
    return json({ candidates: [{ content: { parts: [{ text: '[' + lang + (all.includes('English letters') ? '-latin' : '') + '] ' + msg }] } }] });
  }
  throw new Error('Unexpected fetch: ' + url);
};

const { server, _queues } = require('./server.js');

function sign(body) { return 'sha256=' + crypto.createHmac('sha256', 'app-secret').update(body).digest('hex'); }
let n = 0;
function payload(msg) {
  n += 1;
  return JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { phone_number_id: process.env.PHONE_NUMBER_ID },
    contacts: [{ wa_id: msg.from || '919999999999' }],
    messages: [Object.assign({ from: '919999999999', id: msg.id || 'wamid.in' + n, timestamp: '1762390000' }, msg)]
  } }] }] });
}
async function settle() {
  for (let i = 0; i < 20; i++) { await Promise.all([..._queues.values()]); await new Promise((r) => setTimeout(r, 10)); }
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (body, sig) => fetch(base + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig === undefined ? sign(body) : sig }, body });
  const pass = (m) => console.log('PASS', m);

  // 1. Webhook verification
  let r = await fetch(base + '/webhook?hub.mode=subscribe&hub.verify_token=dukaan-secret&hub.challenge=12345');
  assert.strictEqual(r.status, 200); assert.strictEqual(await r.text(), '12345');
  r = await fetch(base + '/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1');
  assert.strictEqual(r.status, 403);
  pass('Meta webhook verification (right token 200, wrong token 403)');

  // 2. Bad signature rejected
  r = await post(payload({ type: 'text', text: { body: 'hi' } }), 'sha256=bad');
  assert.strictEqual(r.status, 401);
  await settle(); assert.strictEqual(sent.length, 0);
  pass('messages with a wrong signature are rejected');

  // 3. "hi" in English → welcome, plan, buttons
  r = await post(payload({ type: 'text', text: { body: 'hi' } }));
  assert.strictEqual(r.status, 200); await settle();
  assert.strictEqual(sent.length, 3);
  assert.ok(sent[0].text.body.startsWith('Namaste, Ramesh!'));
  assert.ok(sent[1].text.body.includes('Maggi noodles: 2 cartons (96 pcs)'));
  assert.strictEqual(sent[2].type, 'interactive');
  assert.deepStrictEqual(sent[2].interactive.action.buttons.map((b) => b.reply.id), ['send_order', 'send_offer', 'summary']);
  assert.ok(geminiCalls.every((c) => c.model === 'gemini-3.5-flash-lite'));
  pass('greeting → welcome + morning plan + 3 buttons (fell back past an unavailable model name)');

  // 4. Hinglish sales typed in English letters → saved, reply in Hindi (latin script)
  sent.length = 0;
  await post(payload({ type: 'text', text: { body: 'aaj 6 bread aur 4 dahi bika' } })); await settle();
  assert.strictEqual(sent.length, 1);
  assert.ok(sent[0].text.body.startsWith('[Hindi-latin] Saved: 6 × Bread, 4 × Curd 400 g.'), sent[0].text.body);
  pass('Hinglish "aaj 6 bread aur 4 dahi bika" → saved, reply in Hindi in English letters');

  // 5. Telugu voice note → media downloaded, sent to Gemini as audio, plan in Telugu + translated buttons
  sent.length = 0; geminiCalls.length = 0;
  await post(payload({ type: 'audio', audio: { id: 'MEDIA123', mime_type: 'audio/ogg; codecs=opus', voice: true } })); await settle();
  const audioCall = geminiCalls.find((c) => c.parts.some((p) => p.inline_data));
  assert.ok(audioCall && audioCall.parts.find((p) => p.inline_data).inline_data.mime_type === 'audio/ogg');
  assert.ok(sent[0].text.body.startsWith('[Telugu] *Good morning!'));
  assert.strictEqual(sent[1].type, 'interactive');
  pass('Telugu voice note → downloaded, understood as audio, plan + buttons in Telugu');

  // 6. Tap "Send order" button → order + copy to distributor
  sent.length = 0;
  await post(payload({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'send_order', title: 'Send order' } } })); await settle();
  assert.ok(sent[0].to === '919999999999' && sent[0].text.body.includes('Order #O'));
  const dist = sent.find((m) => m.to === '919800000001');
  assert.ok(dist && dist.text.body.startsWith('Namaste! New order from Ramesh Kirana Store'));
  pass('"Send order" button → order confirmed to owner + order message to the distributor');

  // 7. Send offer → customers get it
  sent.length = 0;
  await post(payload({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'send_offer', title: 'Send offer' } } })); await settle();
  assert.strictEqual(sent.filter((m) => m.to === '919800000002' || m.to === '919800000003').length, 2);
  assert.ok(sent.find((m) => m.to === '919800000002').text.body.includes('10% off today only'));
  pass('"Send offer" button → offer sent to 2 customer numbers');

  // 8. Tamil stock question
  sent.length = 0;
  await post(payload({ type: 'text', text: { body: 'பனீர் எவ்வளவு இருக்கு' } })); await settle();
  assert.ok(sent[0].text.body.startsWith('[Tamil] *Paneer 200 g:* 6 on the shelf'));
  pass('Tamil stock question → stock answer in Tamil');

  // 9. Same message id twice is handled once
  sent.length = 0;
  const dup = payload({ id: 'wamid.DUP', type: 'text', text: { body: 'hi' } });
  await post(dup); await post(dup); await settle();
  assert.strictEqual(sent.length, 3);
  pass('Meta retries of the same message are ignored');

  // 10. Gemini down → simple English reader still records sales
  sent.length = 0; geminiDown = true;
  await post(payload({ from: '918888888888', type: 'text', text: { body: 'sold 2 bread' } })); await settle();
  assert.ok(sent[0].text.body.startsWith('Saved: 2 × Bread.'), sent[0].text.body);
  geminiDown = false;
  pass('if the AI is down, English sales still work');

  // 11. No AI key → English works, voice notes get a clear message
  delete process.env.GEMINI_API_KEY; sent.length = 0;
  await post(payload({ from: '917777777777', type: 'text', text: { body: 'plan' } })); await settle();
  assert.ok(sent[0].text.body.includes('Order today'));
  await post(payload({ from: '917777777777', type: 'audio', audio: { id: 'MEDIA123' } })); await settle();
  assert.ok(sent[sent.length - 1].text.body.startsWith('Voice notes need the AI key'));
  pass('without an AI key: English commands work, voice notes explain what is missing');

  // 12. End day via text without AI
  sent.length = 0;
  await post(payload({ from: '917777777777', type: 'text', text: { body: 'end day' } })); await settle();
  assert.ok(sent[0].text.body.startsWith('*Day 1 closed.*'));
  assert.ok(sent[1].text.body.includes('(Day 2)'));
  pass('"end day" closes the day and sends the next plan');

  // 13. Unsupported message type (image)
  sent.length = 0;
  await post(payload({ from: '917777777777', type: 'image', image: { id: 'IMG' } })); await settle();
  assert.ok(sent[0].text.body.startsWith('Please send a text or a voice note'));
  pass('photos and other types get a polite reply');

  // 14. Health page
  r = await fetch(base + '/');
  assert.ok((await r.text()).startsWith('Dukaan Dost WhatsApp bot is running'));
  pass('health page responds');

  server.close();
  console.log('\nALL BOT TESTS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
