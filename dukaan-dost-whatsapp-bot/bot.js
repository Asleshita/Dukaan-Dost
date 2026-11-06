/*
 * Dukaan Dost – the conversation
 * Turns one incoming WhatsApp message into replies, using:
 *   ai.js        to understand any Indian language (text or voice) and translate replies
 *   engine.js    the same decision engine as the web app (orders, slow sellers, expiry risk)
 *   whatsapp.js  to send messages
 * Each phone number gets its own demo shop (sample data), kept in memory.
 */
'use strict';

function createBot(deps) {
  const DD = deps.DD;
  const E = DD.engine;
  const ai = deps.ai;
  const wa = deps.wa;
  const env = deps.env || process.env;
  const shops = new Map();

  const rupees = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
  const listNumbers = (s) => String(s || '').split(',').map((x) => x.replace(/[^\d]/g, '')).filter(Boolean);

  function shopFor(phone) {
    // language/script = what we reply in now; preferred = the default for neutral messages (English commands, "hi", "namaste")
    if (!shops.has(phone)) shops.set(phone, { state: DD.defaultState(), language: 'English', script: 'native', preferred: { language: 'English', script: 'native' } });
    return shops.get(phone);
  }

  /* ---------- Replies, written in English first ---------- */
  const HELP =
    'You can send me (in any language, typed or as a voice note):\n' +
    '• Sales, like *sold 6 bread and 4 curd*\n' +
    '• *plan* for today’s plan\n' +
    '• *stock paneer* to check one item\n' +
    '• *send order* or *send offer*\n' +
    '• *summary* for today’s sales\n' +
    '• *end day* to close the day';

  function planText(s) {
    const p = E.plan(s);
    let t = '*Good morning! Here’s today’s plan* (Day ' + s.day + ')\n\n*Order today*\n';
    t += p.reorder.length
      ? p.reorder.map((r) => '• ' + r.item.name + ': ' + E.unitText(r.item, r.a.packs) + (r.a.reasons.length ? ' (' + r.a.reasons.join(', ') + ')' : '')).join('\n')
      : '• Nothing to order today';
    t += '\n\n*Don’t reorder*\n';
    t += p.slow.length ? p.slow.map((r) => '• ' + r.item.name + ': ' + rupees(r.a.stuckValue) + ' stuck').join('\n') : '• No slow sellers';
    t += '\n\n*Expiring soon*\n';
    t += p.risk.length
      ? p.risk.map((r) => '• ' + r.item.name + ': ' + r.a.riskQty + ' may expire in ' + r.item.expiry + ' days').join('\n') + '\n' + rupees(p.riskValue) + ' at risk. Send them as an offer?'
      : '• Nothing at risk';
    return t;
  }

  function summaryText(s) {
    const sold = s.items.filter((it) => it.today > 0).sort((a, b) => b.today * b.price - a.today * a.price);
    if (!sold.length) return 'No sales recorded yet today. Send me a voice note like *sold 5 bread*.';
    return 'Today so far: *' + rupees(E.todaySales(s)) + '* from ' + sold.length + ' products.\nTop seller: ' + sold[0].name + ' (' + sold[0].today + ' sold).';
  }

  function stockText(s, productId) {
    const it = s.items.find((x) => x.id === productId);
    if (!it) return 'Which item? Try *stock bread* or *stock maggi*.';
    const a = E.analyse(it, s.flags);
    let t = '*' + it.name + ':* ' + it.stock + ' on the shelf, sells about ' + a.daily.toFixed(1) + ' a day.';
    if (a.status === 'slow') t += '\nSlow seller: ' + rupees(a.stuckValue) + ' is stuck. Don’t reorder.';
    else if (a.packs > 0) t += '\nOrder ' + E.unitText(it, a.packs) + '.';
    else t += '\nEnough stock for now.';
    if (a.riskQty > 0) t += '\n' + a.riskQty + ' may expire in ' + it.expiry + ' days.';
    return t;
  }

  function recordSales(s, items) {
    const matches = items.map((x) => ({ item: s.items.find((it) => it.id === x.product_id), qty: x.qty })).filter((m) => m.item);
    if (!matches.length) return 'Sorry, I didn’t catch an item with a number. Try *sold 5 bread*, or type *help*.';
    const applied = E.applySales(s, matches);
    const saved = applied.filter((a) => a.qty > 0);
    const short = applied.filter((a) => a.qty < a.asked);
    let t = saved.length ? 'Saved: ' + saved.map((a) => a.qty + ' × ' + a.item.name).join(', ') + '.' : 'Nothing saved.';
    if (short.length) t += '\nOnly ' + short.map((a) => a.qty + ' ' + a.item.name).join(', ') + ' were on the shelf, so I saved that.';
    t += '\nToday’s sales so far: *' + rupees(E.todaySales(s)) + '*.';
    return t;
  }

  function makeOrder(s) {
    const existing = s.orders.find((o) => o.day === s.day && o.status === 'pending');
    if (existing) return { text: 'Today’s order #' + existing.id + ' is already with ' + s.shop.distributor + '. It arrives tomorrow morning.' };
    const p = E.plan(s);
    if (!p.reorder.length) return { text: 'Nothing needs ordering today. Your shelves are well stocked.' };
    s.nextId += 1;
    const o = {
      id: 'O' + s.nextId, day: s.day, status: 'pending', value: p.orderValue,
      lines: p.reorder.map((r) => ({ itemId: r.item.id, name: r.item.name, packs: r.a.packs, units: r.a.units, qtyText: E.unitText(r.item, r.a.packs) }))
    };
    s.orders.unshift(o);
    const list = o.lines.map((l) => '• ' + l.qtyText + ' – ' + l.name).join('\n');
    return {
      order: o,
      text: '*Order #' + o.id + ' sent to ' + s.shop.distributor + '*\n' + list + '\nDelivery: tomorrow morning.',
      forDistributor: 'Namaste! New order from ' + s.shop.name + ' (#' + o.id + '):\n' + list + '\nPlease deliver tomorrow morning. Thank you!'
    };
  }

  function makeOffer(s) {
    const live = s.offers.find((of) => of.status === 'live');
    if (live) return { text: 'Offer #' + live.id + ' is already live for ' + live.sentTo + ' nearby customers.' };
    const p = E.plan(s);
    if (!p.risk.length) return { text: 'Nothing is at risk of expiring, so no offer is needed today.' };
    s.nextId += 1;
    const d = s.discount;
    const of = {
      id: 'F' + s.nextId, day: s.day, status: 'live', discount: d, sentTo: s.shop.customers,
      lines: p.risk.map((r) => ({ itemId: r.item.id, name: r.item.name, qty: r.a.riskQty, left: r.a.riskQty, price: r.item.price, offerPrice: Math.round(r.item.price * (100 - d) / 100) }))
    };
    s.offers.unshift(of);
    const list = of.lines.map((l) => '• ' + l.name + ': ' + rupees(l.price) + ' → *' + rupees(l.offerPrice) + '*').join('\n');
    return {
      offer: of,
      text: '*Offer #' + of.id + ' sent to ' + of.sentTo + ' nearby customers:* ' + d + '% off on ' + of.lines.length + ' items that expire soon.\n' + list,
      forCustomers: '*' + s.shop.name + ': ' + d + '% off today only!*\n' + list + '\nReply to reserve. Pay when you pick up.'
    };
  }

  function endDayText(s) {
    const sum = E.endDay(s);
    const wasted = sum.wasted.reduce((t, w) => t + w.value, 0);
    let t = '*Day ' + sum.day + ' closed.* Sales: ' + rupees(sum.sales) + '.';
    t += sum.wasted.length ? '\nExpired and thrown away: ' + sum.wasted.map((w) => w.qty + ' ' + w.name).join(', ') + ' (' + rupees(wasted) + ').' : '\nNothing expired.';
    if (sum.delivered.length) t += '\n' + s.shop.distributor + ' delivered order ' + sum.delivered.map((o) => '#' + o.id).join(', ') + '. Stock is updated.';
    return t;
  }

  /* ---------- Understanding without AI (English keywords only) ---------- */
  function simpleUnderstand(text, s) {
    const low = String(text || '').toLowerCase().trim();
    const base = { transcript: text, english: text, language: 'English', script: 'native', items: [], product_id: null };
    if (/^(hi|hello|hey|namaste)\b/.test(low)) return Object.assign(base, { intent: 'greeting' });
    if (/\bhelp\b/.test(low)) return Object.assign(base, { intent: 'help' });
    if (/\bsend order\b|^order$/.test(low)) return Object.assign(base, { intent: 'send_order' });
    if (/\bsend offer\b|^offer$/.test(low)) return Object.assign(base, { intent: 'send_offer' });
    if (/\bplan\b/.test(low)) return Object.assign(base, { intent: 'plan' });
    if (/\bsummary\b/.test(low)) return Object.assign(base, { intent: 'summary' });
    if (/\bend day\b|\bclose day\b/.test(low)) return Object.assign(base, { intent: 'end_day' });
    if (/^reset\b/.test(low)) return Object.assign(base, { intent: 'reset' });
    const wanted = simpleLanguage(low);
    if (wanted) return Object.assign(base, { intent: 'set_language', reply_language: wanted });
    if (/^(stock|check|how many)\b/.test(low) && !/\d/.test(low)) {
      const r = E.parseNote('1 ' + low.replace(/^(stock|check|how many)\s*(of)?/, ''), s.items);
      return Object.assign(base, { intent: 'stock', product_id: r.matches.length ? r.matches[0].item.id : null });
    }
    const r = E.parseNote(text, s.items);
    if (r.matches.length) return Object.assign(base, { intent: 'sales', items: r.matches.map((m) => ({ product_id: m.item.id, qty: m.qty })) });
    return Object.assign(base, { intent: 'other' });
  }

  /* Plain English commands are answered straight away, without asking the AI (faster). */
  function quickIntent(text) {
    const low = String(text || '').toLowerCase().replace(/[!.?,\s]+$/, '').trim();
    if (/^(hi+|hello|hey|namaste|start|menu)$/.test(low)) return 'greeting';
    if (/^help$/.test(low)) return 'help';
    if (/^(plan|today'?s plan|todays plan)$/.test(low)) return 'plan';
    if (/^(send order|order)$/.test(low)) return 'send_order';
    if (/^(send offer|offer)$/.test(low)) return 'send_offer';
    if (/^summary$/.test(low)) return 'summary';
    if (/^(end day|close day)$/.test(low)) return 'end_day';
    if (/^reset$/.test(low)) return 'reset';
    return null;
  }

  const LANG_NAMES = ['English', 'Hindi', 'Telugu', 'Tamil', 'Kannada', 'Malayalam', 'Bengali', 'Marathi', 'Gujarati', 'Punjabi', 'Odia', 'Assamese', 'Urdu'];
  function simpleLanguage(low) {
    const m = /^(?:language|lang|reply in|speak|talk in)\s+([a-z]+)$/.exec(low);
    if (!m) return null;
    return LANG_NAMES.find((l) => l.toLowerCase() === m[1]) || null;
  }

  /* ---------- Sending, in the owner’s language ---------- */
  async function say(to, shop, english) {
    let text = english;
    if (ai.enabled() && !/^english$/i.test(shop.language)) {
      try { text = await ai.translate(english, shop.language, shop.script); } catch (e) { console.error('[bot] translate failed, sending English:', e.message); }
    }
    await wa.sendText(to, text);
    return text;
  }

  async function askNext(to, shop) {
    let body = 'What should I do next?';
    let titles = ['Send order', 'Send offer', 'Today’s summary'];
    if (ai.enabled() && !/^english$/i.test(shop.language)) {
      try {
        const t = await ai.translate(body + '\n' + titles.join('\n'), shop.language, shop.script);
        const lines = t.split('\n').map((x) => x.replace(/^[•\-\d.)\s]+/, '').trim()).filter(Boolean);
        if (lines.length >= 4) { body = lines[0]; titles = lines.slice(1, 4); }
      } catch (e) { /* keep English buttons */ }
    }
    await wa.sendButtons(to, body, [
      { id: 'send_order', title: titles[0] },
      { id: 'send_offer', title: titles[1] },
      { id: 'summary', title: titles[2] }
    ]);
  }

  /* Twilio can’t show buttons, so the 1/2/3 menu goes inside the same message: one message, one translation, much faster. */
  const MENU = 'What next? Reply with a number:\n1 – Send order\n2 – Send offer\n3 – Today’s summary';
  async function sayWithMenu(to, shop, english) {
    if (wa.textButtons) return say(to, shop, english + '\n\n' + MENU);
    await say(to, shop, english);
    await askNext(to, shop);
  }

  async function forward(numbers, text) {
    for (const n of numbers) {
      try { await wa.sendText(n, text); } catch (e) { console.error('[bot] could not reach', n, '(they must message the bot once first):', e.message); }
    }
  }

  /* ---------- One incoming message ---------- */
  async function handle(msg) {
    const from = msg.from;
    const shop = shopFor(from);
    const s = shop.state;

    // Numbered replies (used where tap buttons aren’t available): 1 = order, 2 = offer, 3 = summary
    const numbered = /^\s*([123])\s*[.)]?\s*$/.exec(msg.text || '');
    if (numbered && !msg.buttonId) msg.buttonId = ['send_order', 'send_offer', 'summary'][Number(numbered[1]) - 1];

    // 1. Understand it
    let u;
    if (msg.buttonId) {
      u = { intent: msg.buttonId, items: [], product_id: null, language: shop.language, script: shop.script };
    } else if (msg.audio) {
      if (!ai.enabled()) { await wa.sendText(from, 'Voice notes need the AI key (GEMINI_API_KEY). Please type your message for now.'); return; }
      try {
        const audio = await wa.downloadMedia(msg.audio);
        u = await ai.understand({ audio: audio, items: s.items });
      } catch (e) {
        console.error('[bot] voice note failed:', e.message);
        await say(from, shop, 'Sorry, I couldn’t understand that voice note. Please try again, or type it.');
        return;
      }
    } else if (quickIntent(msg.text)) {
      u = { transcript: msg.text, intent: quickIntent(msg.text), items: [], product_id: null, language: 'English', script: 'native', quick: true };
    } else if (ai.enabled()) {
      try { u = await ai.understand({ text: msg.text, items: s.items }); } catch (e) {
        console.error('[bot] AI failed, using simple reader:', e.message);
        u = simpleUnderstand(msg.text, s);
      }
    } else {
      u = simpleUnderstand(msg.text, s);
    }
    // Which language to reply in:
    //  - "reply in Tamil" → Tamil from now on (for neutral messages too)
    //  - English commands, "hi", "namaste" → the preferred language (English unless changed)
    //  - anything in an Indian language (typed or voice) → that same language
    //  - number replies 1/2/3 → keep the language we were just using
    if (!msg.buttonId) {
      if (u.intent === 'set_language' && u.reply_language) {
        shop.preferred = { language: u.reply_language, script: 'native' };
        shop.language = shop.preferred.language; shop.script = shop.preferred.script;
      } else if (u.quick || !u.language || /^english$/i.test(u.language)) {
        shop.language = shop.preferred.language; shop.script = shop.preferred.script;
      } else {
        shop.language = u.language; shop.script = u.script || 'native';
      }
    }
    console.log('[bot]', from, '| heard:', u.transcript || msg.text || msg.buttonId, '|', shop.language, '|', u.intent);

    // 2. Act on it
    switch (u.intent) {
      case 'greeting':
        await sayWithMenu(from, shop, 'Namaste, ' + s.shop.owner + '! I’m *Dukaan Dost*, your stock assistant. Talk to me in any language, typed or as a voice note. Send *help* to see everything I can do.\n\n' + planText(s));
        break;
      case 'set_language':
        await say(from, shop, 'Okay! I’ll reply in ' + shop.language + ' now. You can still write or speak to me in any language. Send *plan* to see today’s plan.');
        break;
      case 'help':
        await say(from, shop, HELP);
        break;
      case 'plan':
        await sayWithMenu(from, shop, planText(s));
        break;
      case 'send_order': {
        const r = makeOrder(s);
        await say(from, shop, r.text);
        if (r.forDistributor) await forward(listNumbers(env.DISTRIBUTOR_NUMBER), r.forDistributor);
        break;
      }
      case 'send_offer': {
        const r = makeOffer(s);
        await say(from, shop, r.text);
        if (r.forCustomers) await forward(listNumbers(env.CUSTOMER_NUMBERS), r.forCustomers);
        break;
      }
      case 'stock':
        await say(from, shop, stockText(s, u.product_id));
        break;
      case 'summary':
        await say(from, shop, summaryText(s));
        break;
      case 'end_day':
        await sayWithMenu(from, shop, endDayText(s) + '\n\n' + planText(s));
        break;
      case 'reset':
        shop.state = DD.defaultState();
        await sayWithMenu(from, shop, 'Demo shop reset to Day 1.\n\n' + planText(shop.state));
        break;
      case 'sales':
        await say(from, shop, recordSales(s, u.items));
        break;
      default:
        await say(from, shop, 'Sorry, I didn’t understand that. ' + HELP);
    }
  }

  return { handle: handle, _shops: shops, _planText: planText };
}

module.exports = { createBot };
