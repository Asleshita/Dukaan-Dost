/*
 * Dukaan Dost – the language brain (Google Gemini)
 *
 * 1. understand(): reads a typed message OR a voice note in any Indian language
 *    (or English, or mixed like Hinglish) and returns what the owner wants as JSON.
 * 2. translate(): rewrites the bot’s English reply in the owner’s language and script.
 *
 * Uses only Node’s built-in fetch (Node 18+). No npm packages.
 */
'use strict';

const API = 'https://generativelanguage.googleapis.com/v1beta/models/';

// Model names change over time, so we try these in order and remember the first that works.
// Set GEMINI_MODEL to force a specific one.
const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash'
].filter(Boolean);

let workingModel = null;

function enabled() { return Boolean(process.env.GEMINI_API_KEY); }

async function callGemini(parts, json) {
  const models = workingModel ? [workingModel] : MODEL_CANDIDATES;
  let lastError = null;
  for (const model of models) {
    const res = await fetch(API + encodeURIComponent(model) + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: parts }],
        generationConfig: json ? { temperature: 0, responseMimeType: 'application/json' } : { temperature: 0.2 }
      })
    });
    if (res.status === 404 || res.status === 400) {
      const body = await res.text();
      // Unknown model name → try the next one. Other 400s are real errors.
      if (res.status === 404 || /not found|not supported|unknown model/i.test(body)) {
        lastError = new Error('Gemini model ' + model + ' unavailable');
        continue;
      }
      throw new Error('Gemini error 400: ' + body.slice(0, 300));
    }
    if (!res.ok) throw new Error('Gemini error ' + res.status + ': ' + (await res.text()).slice(0, 300));
    const data = await res.json();
    if (!workingModel) { workingModel = model; console.log('[ai] using model', model); }
    const cand = data.candidates && data.candidates[0];
    const text = cand && cand.content && cand.content.parts ? cand.content.parts.map((p) => p.text || '').join('') : '';
    if (!text) throw new Error('Gemini returned no text');
    return text;
  }
  throw lastError || new Error('No Gemini model available');
}

function parseJson(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

function catalogText(items) {
  return items.map((it) => '- ' + it.id + ': ' + it.name + (it.alias && it.alias.length ? ' (also: ' + it.alias.join(', ') + ')' : '')).join('\n');
}

const INTENTS = ['sales', 'plan', 'send_order', 'send_offer', 'stock', 'summary', 'end_day', 'help', 'greeting', 'reset', 'other'];

/*
 * input: { text?: string, audio?: { data: base64, mimeType: string }, items: product list }
 * returns: { transcript, english, language, script, intent, items: [{product_id, qty}], product_id }
 */
async function understand(input) {
  const prompt = [
    'You are the language brain of "Dukaan Dost", a WhatsApp stock assistant for small kirana stores in India.',
    'The shop owner may write or speak in ANY Indian language (Hindi, Telugu, Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati, Punjabi, Odia, Assamese, Urdu and others), in English, or mixed (like Hinglish), in any script.',
    '',
    'Products in this shop (id: name, other names):',
    catalogText(input.items),
    '',
    'Work out what the owner wants. Reply with JSON only, in exactly this shape:',
    '{"transcript": "the message as written or heard, in its original language",',
    ' "english": "an English translation",',
    ' "language": "the language name in English, e.g. Hindi, Telugu, Tamil, English",',
    ' "script": "native" if written in the language\'s own script or spoken, "latin" if an Indian language typed in English letters,',
    ' "intent": one of ' + INTENTS.map((i) => '"' + i + '"').join(', ') + ',',
    ' "items": [{"product_id": "id from the list", "qty": whole number}],',
    ' "product_id": "id from the list or null"}',
    '',
    'Intent guide: "sales" = the owner reports what sold (fill items). "plan" = wants today\'s plan or what to order. ',
    '"send_order" = wants to send the order to the distributor. "send_offer" = wants to send the discount offer to customers. ',
    '"stock" = asks how much of one product is left (fill product_id). "summary" = asks about today\'s sales. ',
    '"end_day" = closing the shop for the day. "help" = asks what you can do. "greeting" = hello or namaste only. ',
    '"reset" = wants to start the demo again. "other" = anything else.',
    'Numbers may be words in any language (Hindi "do" = 2, "paanch" = 5; Telugu "rendu" = 2; Tamil "moonu" = 3). ',
    'Map local product words to the ids above (for example "dahi" = curd, "doodh" = milk if listed). Leave out products not in the list.'
  ].join('\n');

  const parts = [{ text: prompt }];
  if (input.audio) {
    parts.push({ text: 'The owner sent this voice note:' });
    parts.push({ inline_data: { mime_type: input.audio.mimeType, data: input.audio.data } });
  } else {
    parts.push({ text: 'The owner wrote: ' + input.text });
  }

  const out = parseJson(await callGemini(parts, true));
  const ids = new Set(input.items.map((i) => i.id));
  return {
    transcript: String(out.transcript || input.text || ''),
    english: String(out.english || ''),
    language: String(out.language || 'English'),
    script: out.script === 'latin' ? 'latin' : 'native',
    intent: INTENTS.indexOf(out.intent) !== -1 ? out.intent : 'other',
    items: Array.isArray(out.items)
      ? out.items.filter((x) => x && ids.has(x.product_id) && Number(x.qty) > 0).map((x) => ({ product_id: x.product_id, qty: Math.round(Number(x.qty)) }))
      : [],
    product_id: ids.has(out.product_id) ? out.product_id : null
  };
}

/* Rewrite an English bot message in the owner’s language and script. */
async function translate(text, language, script) {
  if (!language || /^english$/i.test(language)) return text;
  const prompt = [
    'Rewrite this WhatsApp message from a shop assistant bot for an Indian kirana shop owner, in ' + language + '.',
    script === 'latin'
      ? 'Write it in English letters (Latin script), the way people type ' + language + ' on WhatsApp.'
      : 'Write it in the normal script of ' + language + '.',
    'Use simple, everyday words a shopkeeper uses. Keep every number, ₹ amount, line break, bullet (•) and WhatsApp *bold* marker.',
    'Common product names (Maggi, bread, chips) can stay as people say them. Reply with the message only.',
    '',
    text
  ].join('\n');
  return (await callGemini([{ text: prompt }], false)).trim();
}

module.exports = { enabled, understand, translate, _reset: () => { workingModel = null; } };
