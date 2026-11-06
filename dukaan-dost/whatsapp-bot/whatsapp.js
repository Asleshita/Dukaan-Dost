/*
 * Dukaan Dost – talking to WhatsApp (Meta WhatsApp Cloud API)
 * Sends text and button messages, and downloads voice notes.
 * Uses only Node’s built-in fetch (Node 18+).
 */
'use strict';

function graph(path) {
  return 'https://graph.facebook.com/' + (process.env.GRAPH_VERSION || 'v23.0') + '/' + path;
}

function authHeaders(json) {
  const h = { Authorization: 'Bearer ' + process.env.WHATSAPP_TOKEN };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function post(payload) {
  const res = await fetch(graph(process.env.PHONE_NUMBER_ID + '/messages'), {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(Object.assign({ messaging_product: 'whatsapp', recipient_type: 'individual' }, payload))
  });
  const body = await res.text();
  if (!res.ok) {
    console.error('[whatsapp] send failed', res.status, body.slice(0, 400));
    throw new Error('WhatsApp send failed (' + res.status + ')');
  }
  return JSON.parse(body);
}

/* A plain text message (max 4096 characters). */
function sendText(to, body) {
  return post({ to: to, type: 'text', text: { preview_url: false, body: String(body).slice(0, 4096) } });
}

/* Up to 3 reply buttons. Titles max 20 characters, ids are what comes back when tapped. */
function sendButtons(to, body, buttons) {
  return post({
    to: to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: String(body).slice(0, 1024) },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: String(b.title).slice(0, 20) } }))
      }
    }
  });
}

/* Voice notes arrive as a media id: look up its URL, then download it with the token. */
async function downloadMedia(media) {
  const mediaId = typeof media === 'object' ? media.id : media;
  const meta = await fetch(graph(mediaId), { headers: authHeaders(false) });
  if (!meta.ok) throw new Error('Media lookup failed (' + meta.status + ')');
  const info = await meta.json();
  const file = await fetch(info.url, { headers: authHeaders(false) });
  if (!file.ok) throw new Error('Media download failed (' + file.status + ')');
  const buf = Buffer.from(await file.arrayBuffer());
  return { data: buf.toString('base64'), mimeType: String(info.mime_type || 'audio/ogg').split(';')[0].trim() };
}

/* Shows the blue ticks and "typing…" while the AI works. Best effort only. */
async function markRead(messageId) {
  try {
    await fetch(graph(process.env.PHONE_NUMBER_ID + '/messages'), {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } })
    });
  } catch (e) { /* not important */ }
}

module.exports = { sendText, sendButtons, downloadMedia, markRead };
