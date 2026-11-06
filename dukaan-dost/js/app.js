/*
 * Dukaan Dost – the app screens
 * Draws each section (Chat, Dashboard, Stock, Orders, Offers, Settings) from the saved state,
 * and turns taps, typing and voice notes into updates. Every change is saved, then redrawn.
 */
(function () {
  'use strict';

  var E = DD.engine;
  var state = DD.store.load();
  var ui = { view: 'welcome', search: '', editing: null, confirmDelete: null, confirmReset: false, confirmEnd: false, cart: {}, listening: false, formError: '' };
  var VIEWS = ['welcome', 'home', 'chat', 'dashboard', 'stock', 'orders', 'offers', 'settings'];
  var t = DD.t;
  DD.setLang(DD.lang);
  var viewEl = document.getElementById('view');

  /* ---------- Small helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function rupees(n) { return '₹' + Math.round(n || 0).toLocaleString('en-IN'); }
  function rupeesShort(n) { return n >= 1000 ? '₹' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : '₹' + Math.round(n); }
  function fmt(text) { return esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>'); }
  function findItem(id) { for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i]; return null; }
  function findBy(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function dateFor(day) { var d = new Date(state.startDate + 'T00:00:00'); d.setDate(d.getDate() + day - 1); return d; }
  function dayName(day) { return dateFor(day).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function shortDay(day) { return dateFor(day).toLocaleDateString('en-IN', { weekday: 'short' }); }
  function timeNow() { return new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
  function newId(prefix) { state.nextId += 1; return prefix + state.nextId; }
  function save() { DD.store.save(state); }
  function commit() { save(); render(); }

  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2800);
  }

  var ICON = {
    logo: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0F3D2E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9h18"/><path d="M9 20v-6h6v6"/></svg>',
    mic: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F1F7F2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>',
    micSmall: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/></svg>',
    send: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0F3D2E" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>'
  };

  /* ---------- Chat messages ---------- */
  function push(from, text, extra) {
    var msg = { from: from, text: text || '', time: timeNow(), day: state.day };
    if (extra) for (var k in extra) msg[k] = extra[k];
    state.chat.push(msg);
    if (state.chat.length > 150) state.chat = state.chat.slice(-150);
  }
  function bot(text, extra) { push('bot', text, extra); }
  function me(text, extra) { push('me', text, extra); }

  function planSnapshot() {
    var p = E.plan(state);
    return {
      day: state.day,
      order: p.reorder.map(function (r) { return { name: r.item.name, qty: E.unitText(r.item, r.a.packs), why: r.a.reasons.join(' · ') || 'stock running down' }; }),
      slow: p.slow.map(function (r) { return { name: r.item.name, stuck: r.a.stuckValue }; }),
      risk: p.risk.map(function (r) { return { name: r.item.name, qty: r.a.riskQty, expiry: r.item.expiry }; }),
      stuck: p.stuck,
      riskValue: p.riskValue
    };
  }
  function postPlan() { bot('', { kind: 'plan', plan: planSnapshot() }); }

  function orderText(o) {
    return 'Namaste! New order from ' + state.shop.name + ' (' + dayName(o.day) + '):\n' +
      o.lines.map(function (l) { return '• ' + l.qtyText + ' – ' + l.name; }).join('\n') +
      '\nPlease deliver tomorrow morning. Thank you!';
  }
  function offerText(of) {
    return state.shop.name + ': ' + of.discount + '% off today only!\n' +
      of.lines.map(function (l) { return '• ' + l.name + ': ' + rupees(l.price) + ' → ' + rupees(l.offerPrice); }).join('\n') +
      '\nReply to reserve. Pay when you pick up.';
  }
  function waLink(text) { return 'https://wa.me/?text=' + encodeURIComponent(text); }

  function pendingOrderToday() {
    for (var i = 0; i < state.orders.length; i++) if (state.orders[i].day === state.day && state.orders[i].status === 'pending') return state.orders[i];
    return null;
  }
  function liveOffer() {
    for (var i = 0; i < state.offers.length; i++) if (state.offers[i].status === 'live') return state.offers[i];
    return null;
  }

  function sendOrder() {
    var existing = pendingOrderToday();
    if (existing) {
      bot('Today’s order **#' + existing.id + '** is already with ' + state.shop.distributor + '. It arrives tomorrow morning.', { kind: 'order', orderId: existing.id });
      return null;
    }
    var p = E.plan(state);
    if (!p.reorder.length) { bot('Nothing needs ordering today. Your shelves are well stocked.'); return null; }
    var o = {
      id: newId('O'), day: state.day, status: 'pending', value: p.orderValue,
      lines: p.reorder.map(function (r) { return { itemId: r.item.id, name: r.item.name, packs: r.a.packs, units: r.a.units, qtyText: E.unitText(r.item, r.a.packs) }; })
    };
    state.orders.unshift(o);
    bot('**Order #' + o.id + ' sent to ' + state.shop.distributor + ':** ' +
      o.lines.map(function (l) { return l.qtyText + ' ' + l.name; }).join(', ') + '.\nDelivery: tomorrow morning.', { kind: 'order', orderId: o.id });
    return o;
  }

  function sendOffer() {
    var live = liveOffer();
    if (live) {
      bot('Offer **#' + live.id + '** is already live for ' + live.sentTo + ' nearby customers.', { kind: 'offer', offerId: live.id });
      return null;
    }
    var p = E.plan(state);
    if (!p.risk.length) { bot('Nothing is at risk of expiring, so no offer is needed today.'); return null; }
    var d = state.discount;
    var of = {
      id: newId('F'), day: state.day, status: 'live', discount: d, sentTo: state.shop.customers,
      lines: p.risk.map(function (r) {
        return { itemId: r.item.id, name: r.item.name, qty: r.a.riskQty, left: r.a.riskQty, price: r.item.price, offerPrice: Math.round(r.item.price * (100 - d) / 100) };
      })
    };
    state.offers.unshift(of);
    ui.cart = {};
    bot('**Offer #' + of.id + ' sent to ' + of.sentTo + ' nearby customers:** ' + d + '% off on ' + of.lines.length + ' items that expire soon.', { kind: 'offer', offerId: of.id });
    return of;
  }

  var HELP = 'You can send me:\n• Sales, like **sold 5 bread and 2 curd**\n• **plan** for today’s plan\n• **stock maggi** to check one item\n• **send order** or **send offer**\n• **summary** for today’s sales';

  function summaryText() {
    var sold = state.items.filter(function (it) { return it.today > 0; });
    if (!sold.length) return 'No sales recorded yet today. Send me a voice note like **sold 5 bread**.';
    sold.sort(function (a, b) { return b.today * b.price - a.today * a.price; });
    return 'Today so far: **' + rupees(E.todaySales(state)) + '** from ' + sold.length + ' products.\nTop seller: ' + sold[0].name + ' (' + sold[0].today + ' sold).';
  }

  function stockReply(text) {
    var res = E.parseNote('1 ' + text.replace(/^(stock|check|how many)\s*(of)?/, ''), state.items);
    if (!res.matches.length) return 'Which item? Try **stock bread** or **stock maggi**.';
    var it = res.matches[0].item;
    var a = E.analyse(it, state.flags);
    var line = '**' + it.name + ':** ' + it.stock + ' on the shelf · sells about ' + a.daily.toFixed(1) + ' a day';
    if (a.status === 'slow') line += '\nSlow seller: ' + rupees(a.stuckValue) + ' is stuck. Don’t reorder.';
    else if (a.packs > 0) line += '\nOrder ' + E.unitText(it, a.packs) + '.';
    else line += '\nEnough stock for now.';
    if (a.riskQty > 0) line += '\n' + a.riskQty + ' may expire in ' + it.expiry + ' days.';
    return line;
  }

  function handleOwner(text, viaVoice) {
    var t = String(text || '').trim();
    if (!t) return;
    me(t, viaVoice ? { voice: true } : null);
    var low = t.toLowerCase();
    if (/^(hi|hello|hey|namaste)\b/.test(low)) { bot('Namaste, ' + state.shop.owner + '! ' + HELP); return; }
    if (/\bhelp\b/.test(low)) { bot(HELP); return; }
    if (/\bsend order\b|^order$/.test(low)) { sendOrder(); return; }
    if (/\bsend offer\b|^offer$/.test(low)) { sendOffer(); return; }
    if (/\bplan\b/.test(low)) { postPlan(); return; }
    if (/\bsummary\b|\btoday'?s sales\b/.test(low)) { bot(summaryText()); return; }
    if (/^(stock|check|how many)\b/.test(low) && !/\d/.test(low)) { bot(stockReply(low)); return; }

    var res = E.parseNote(t, state.items);
    if (!res.matches.length) {
      bot('Sorry, I didn’t catch an item with a number. Try **sold 5 bread**, or type **help**.');
      return;
    }
    var applied = E.applySales(state, res.matches);
    var saved = applied.filter(function (a) { return a.qty > 0; });
    var short = applied.filter(function (a) { return a.qty < a.asked; });
    var msg = saved.length
      ? 'Saved: ' + saved.map(function (a) { return a.qty + ' × ' + a.item.name; }).join(', ') + '.'
      : 'Nothing saved.';
    if (short.length) msg += '\nOnly ' + short.map(function (a) { return a.qty + ' ' + a.item.name; }).join(', ') + ' were on the shelf, so I saved that.';
    if (res.unknown.length) msg += '\nNot in your stock list: ' + res.unknown.join(', ') + '. Add it in Stock.';
    msg += '\nToday’s sales so far: **' + rupees(E.todaySales(state)) + '**.';
    bot(msg);
  }

  /* ---------- Voice notes (uses the browser’s speech recognition when available) ---------- */
  var recog = null;
  function updateMic() {
    var b = document.querySelector('[data-action="voice"]');
    if (b) { b.classList.toggle('on', ui.listening); b.setAttribute('aria-pressed', ui.listening ? 'true' : 'false'); }
  }
  function startVoice() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Voice input isn’t supported in this browser. Type the sale instead.'); return; }
    if (ui.listening && recog) { recog.stop(); return; }
    recog = new SR();
    recog.lang = 'en-IN';
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    recog.onresult = function (e) {
      var said = e.results[0][0].transcript;
      handleOwner(said, true);
      commit();
    };
    recog.onerror = function (e) {
      toast(e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? 'Microphone is blocked here. Type the sale instead.'
        : 'Couldn’t hear that. Try again, or type it.');
    };
    recog.onend = function () { ui.listening = false; updateMic(); };
    try {
      recog.start();
      ui.listening = true;
      updateMic();
      toast('Listening… say something like “sold 5 bread”.');
    } catch (err) {
      toast('Couldn’t start the microphone. Type the sale instead.');
    }
  }

  /* ---------- Shared bits of markup ---------- */
  function tag(status) {
    var map = { slow: ['slow', 'Slow seller'], risk: ['risk', 'May expire'], reorder: ['reorder', 'Reorder'], ok: ['ok', 'OK'] };
    var m = map[status] || map.ok;
    return '<span class="tag ' + m[0] + '">' + m[1] + '</span>';
  }

  function planCard(p) {
    var h = '<div class="plan-head"><small>' + esc(t('morningPlan')) + ' · ' + esc(t('day')) + ' ' + p.day + ' · ' + esc(dayName(p.day)) + '</small><b>Good morning! Here’s today’s plan.</b></div><div class="plan-body">';
    h += '<div class="plan-sec"><h4>' + esc(t('orderToday')) + '</h4>';
    h += p.order.length ? p.order.map(function (o) {
      return '<div class="plan-row"><b>' + esc(o.name) + '</b><span>' + esc(o.qty) + '</span></div><p class="plan-why">' + esc(o.why) + '</p>';
    }).join('') : '<p class="plan-why">Nothing to order today.</p>';
    h += '</div><div class="plan-sec"><h4>' + esc(t('dontReorder')) + '</h4>';
    h += p.slow.length ? p.slow.map(function (s) {
      return '<div class="plan-row"><b>' + esc(s.name) + '</b><span>' + rupees(s.stuck) + ' stuck</span></div>';
    }).join('') : '<p class="plan-why">No slow sellers.</p>';
    h += '</div><div class="plan-sec"><h4>' + esc(t('expiringSoon')) + '</h4>';
    h += p.risk.length ? p.risk.map(function (r) {
      return '<div class="plan-row"><b>' + esc(r.name) + '</b><span>' + r.qty + ' may expire in ' + r.expiry + 'd</span></div>';
    }).join('') + '<p class="plan-why">' + rupees(p.riskValue) + ' at risk. Send them as an offer to nearby customers?</p>' : '<p class="plan-why">Nothing at risk.</p>';
    h += '</div><div class="row-gap">' +
      '<button class="btn amber small" type="button" data-action="say" data-text="send order">' + esc(t('sendOrder')) + '</button>' +
      '<button class="btn outline small" type="button" data-action="say" data-text="send offer">' + esc(t('sendOffer')) + '</button></div></div>';
    return h;
  }

  function renderMsg(m, i, all) {
    var out = '';
    var prev = all[i - 1];
    if (!prev || prev.day !== m.day) out += '<p class="daybreak">Day ' + m.day + ' · ' + esc(dayName(m.day)) + '</p>';
    if (m.kind === 'plan') return out + '<div class="msg bot wide">' + planCard(m.plan) + '<span class="time">' + esc(m.time) + '</span></div>';
    var extra = '';
    if (m.kind === 'order') {
      var o = findBy(state.orders, m.orderId);
      if (o) extra = '<div class="actions"><a class="btn wa small" target="_blank" rel="noopener" href="' + esc(waLink(orderText(o))) + '">Open in WhatsApp</a><a class="btn ghost small" href="#orders">View order</a></div>';
    }
    if (m.kind === 'offer') {
      var of = findBy(state.offers, m.offerId);
      if (of) extra = '<div class="actions"><a class="btn wa small" target="_blank" rel="noopener" href="' + esc(waLink(offerText(of))) + '">Share on WhatsApp</a><a class="btn ghost small" href="#offers">See customer view</a></div>';
    }
    var voice = m.voice ? '<span class="voice-tag">' + ICON.micSmall + ' Voice note</span>' : '';
    return out + '<div class="msg ' + (m.from === 'me' ? 'me' : 'bot') + '">' + voice + '<div>' + fmt(m.text) + '</div>' + extra + '<span class="time">' + esc(m.time) + '</span></div>';
  }

  function barChart(data) {
    var W = 640, H = 240, L = 58, R = 12, T = 18, B = 34;
    var max = 1;
    data.forEach(function (d) { if (d.value > max) max = d.value; });
    var p = Math.pow(10, Math.floor(Math.log(max) / Math.LN10));
    var top = Math.ceil(max / p) * p;
    var plotH = H - T - B;
    var bw = (W - L - R) / data.length;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Sales value per day for the last week and today">';
    [0, 0.5, 1].forEach(function (f) {
      var y = T + plotH - f * plotH;
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="#CFE3D4" stroke-width="1"/>';
      s += '<text x="' + (L - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="12" fill="#4F6B5C">' + rupeesShort(top * f) + '</text>';
    });
    data.forEach(function (d, i) {
      var h = Math.max(2, (d.value / top) * plotH);
      var x = L + i * bw + bw * 0.18;
      var y = T + plotH - h;
      s += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw * 0.64).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="6" fill="' + (d.highlight ? '#F2B33D' : '#2FA36B') + '"><title>' + esc(d.label) + ': ' + rupees(d.value) + '</title></rect>';
      s += '<text x="' + (L + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle" font-size="12" fill="#3E5A4C">' + esc(d.label) + '</text>';
    });
    return s + '</svg>';
  }

  /* ---------- Indian touches: rangoli with a diya ---------- */
  function petals(n, r, len, w, color) {
    var s = '';
    for (var i = 0; i < n; i++) {
      s += '<path d="M0,' + (-r) + ' C' + w + ',' + (-r + len * 0.35) + ' ' + w + ',' + (-r + len * 0.75) + ' 0,' + (-r + len) +
        ' C' + (-w) + ',' + (-r + len * 0.75) + ' ' + (-w) + ',' + (-r + len * 0.35) + ' 0,' + (-r) + 'Z" fill="' + color + '" transform="rotate(' + (360 / n * i) + ')"/>';
    }
    return s;
  }
  function dots(n, r, size, color) {
    var s = '';
    for (var i = 0; i < n; i++) {
      var a = (Math.PI * 2 / n) * i;
      s += '<circle cx="' + (Math.cos(a) * r).toFixed(1) + '" cy="' + (Math.sin(a) * r).toFixed(1) + '" r="' + size + '" fill="' + color + '"/>';
    }
    return s;
  }
  function rangoli(cls) {
    return '<svg class="rangoli ' + (cls || '') + '" viewBox="-200 -200 400 400" aria-hidden="true">' +
      '<g class="pop p1"><g class="spin r1">' + dots(48, 192, 3, '#FFD166') + petals(16, 182, 72, 24, '#F28C28') + petals(16, 176, 46, 11, '#FFC93C') + '</g></g>' +
      '<g class="pop p2"><g class="spin r2">' + petals(12, 124, 58, 22, '#E8476A') + petals(12, 118, 34, 9, '#FFB3C1') + dots(24, 98, 5, '#FFF3D6') + '</g></g>' +
      '<g class="pop p3"><g class="spin r3">' + petals(8, 86, 46, 19, '#2FA36B') + petals(8, 82, 26, 7, '#B7E4C7') + '</g></g>' +
      '<g class="pop p4"><circle r="40" fill="#F2B33D"/><circle r="31" fill="#14513A"/>' +
      '<path d="M-20,6 Q0,26 20,6 Z" fill="#E07B2A"/><rect x="-21" y="3" width="42" height="5" rx="2.5" fill="#B5541B"/>' +
      '<path class="flame" d="M0,-24 C9,-11 7,0 0,3 C-7,0 -9,-11 0,-24 Z" fill="#FFC93C"/>' +
      '<path class="flame" d="M0,-14 C4,-7 3,0 0,2 C-3,0 -4,-7 0,-14 Z" fill="#FF8A3D"/></g>' +
      '</svg>';
  }

  function tilesHtml(p) {
    return '<div class="tiles">' +
      '<div class="tile"><div class="num">' + rupees(p.todaySales) + '</div><span>' + esc(t('salesToday')) + '</span></div>' +
      '<div class="tile"><div class="num">' + rupees(p.stuck) + '</div><span>' + esc(t('stuck')) + '</span></div>' +
      '<div class="tile"><div class="num">' + p.reorder.length + '</div><span>' + esc(t('toReorder')) + '</span></div>' +
      '<div class="tile"><div class="num">' + rupees(p.riskValue) + '</div><span>' + esc(t('atRisk')) + '</span></div>' +
    '</div>';
  }

  function langChips() {
    return DD.LANGS.map(function (l) {
      return '<button type="button" class="lang-chip' + (l.code === DD.lang ? ' on' : '') + '" data-action="setLang" data-code="' + l.code + '" aria-pressed="' + (l.code === DD.lang) + '" lang="' + l.code + '">' + esc(l.name) + '</button>';
    }).join('');
  }

  function renderWelcome() {
    var falling = '';
    for (var i = 0; i < 14; i++) {
      falling += '<span class="petal" style="left:' + ((i * 7.3 + 3) % 100).toFixed(1) + '%;animation-delay:' + (i * 0.7).toFixed(1) + 's;animation-duration:' + (7 + (i % 5)) + 's"></span>';
    }
    return '<section class="welcome">' +
      '<div class="toran" aria-hidden="true"></div>' +
      '<div class="petals" aria-hidden="true">' + falling + '</div>' +
      '<div class="welcome-inner">' +
        rangoli('big') +
        '<h1 class="welcome-title">Dukaan Dost</h1>' +
        '<p class="welcome-deva" lang="hi">दुकान दोस्त</p>' +
        '<p class="welcome-tag">' + esc(t('appTag')) + '</p>' +
        '<p class="welcome-line">' + esc(t('welcomeLine')) + '</p>' +
        '<h2 class="welcome-choose">' + esc(t('chooseLang')) + '</h2>' +
        '<div class="lang-row">' + langChips() + '</div>' +
        '<button class="btn amber big-start" type="button" data-action="start">' + esc(t('start')) + ' →</button>' +
      '</div>' +
    '</section>';
  }

  var HOME_ICONS = {
    chat: '<path d="M4 5h16v11H8l-4 4z"/>',
    dashboard: '<path d="M4 20V11"/><path d="M10 20V5"/><path d="M16 20v-7"/><path d="M21 20H3"/>',
    stock: '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
    orders: '<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    offers: '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'
  };

  function renderHome() {
    var p = E.plan(state);
    var cards = ['chat', 'dashboard', 'stock', 'orders', 'offers', 'settings'].map(function (k, i) {
      return '<a class="home-card c' + (i % 3) + '" href="#' + k + '">' +
        '<span class="home-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + HOME_ICONS[k] + '</svg></span>' +
        '<span class="home-text"><b>' + esc(t(k)) + '</b><small>' + esc(t(k === 'dashboard' ? 'dashDesc' : k + 'Desc')) + '</small></span></a>';
    }).join('');
    var top = p.reorder.slice(0, 3).map(function (r) {
      return '<li><span><b>' + esc(r.item.name) + '</b><small>' + esc(r.a.reasons.join(' · ') || 'stock running down') + '</small></span><span>' + esc(E.unitText(r.item, r.a.packs)) + '</span></li>';
    }).join('');
    return '<section class="home-hero">' +
        '<div class="home-hero-text">' +
          '<p class="home-greet">' + esc(t('namaste')) + ', ' + esc(state.shop.owner) + ' ji</p>' +
          '<h2>' + esc(t('homeSub')) + '</h2>' +
          '<p class="home-date">' + esc(state.shop.name) + ' · ' + esc(t('day')) + ' ' + state.day + ' · ' + esc(dayName(state.day)) + '</p>' +
          '<div class="row-gap"><a class="btn amber" href="#chat">' + esc(t('morningPlan')) + ' →</a><a class="btn ghost-light" href="#dashboard">' + esc(t('dashboard')) + '</a></div>' +
        '</div>' + rangoli('small') +
      '</section>' +
      '<div class="toran slim" aria-hidden="true"></div>' +
      tilesHtml(p) +
      '<div class="home-grid">' + cards + '</div>' +
      '<div style="height:16px"></div>' +
      '<div class="card"><h3>' + esc(t('orderToday')) + '</h3>' + (top ? '<ul class="list">' + top + '</ul>' : '<p class="muted">Nothing to order today.</p>') +
        (p.reorder.length > 3 ? '<p class="muted">+' + (p.reorder.length - 3) + ' more in <a href="#orders">' + esc(t('orders')) + '</a></p>' : '') + '</div>';
  }

  /* ---------- Views ---------- */
  function renderChat() {
    var msgs = state.chat.map(renderMsg).join('');
    var examples = ['sold 6 bread and 4 curd', '10 chips, 2 cup cakes', 'sold 12 maggi and 3 oil', 'stock paneer', 'summary'];
    return '<div class="chat-layout">' +
      '<section class="phone" aria-label="Owner chat with Dukaan Dost">' +
        '<div class="phone-top"><span class="logo" style="width:40px;height:40px">' + ICON.logo + '</span><div><b>Dukaan Dost</b><small>Chat for ' + esc(state.shop.name) + ' · works like WhatsApp</small></div></div>' +
        '<div class="msgs" id="msgs" aria-live="polite">' + (msgs || '<p class="muted center">No messages yet.</p>') + '</div>' +
        '<div class="quick">' +
          '<button class="chip" type="button" data-action="say" data-text="plan">Morning plan</button>' +
          '<button class="chip" type="button" data-action="say" data-text="send order">Send order</button>' +
          '<button class="chip" type="button" data-action="say" data-text="send offer">Send offer</button>' +
          '<button class="chip" type="button" data-action="say" data-text="summary">Today’s summary</button>' +
          '<button class="chip" type="button" data-action="say" data-text="help">Help</button>' +
        '</div>' +
        '<form class="composer" data-form="chat">' +
          '<label class="sr" for="chatInput">Message Dukaan Dost</label>' +
          '<input id="chatInput" name="msg" autocomplete="off" placeholder="Type a sale, e.g. sold 5 bread">' +
          '<button type="button" class="icon-btn' + (ui.listening ? ' on' : '') + '" data-action="voice" aria-label="Record a voice note" aria-pressed="' + (ui.listening ? 'true' : 'false') + '">' + ICON.mic + '</button>' +
          '<button type="submit" class="icon-btn send" aria-label="Send message">' + ICON.send + '</button>' +
        '</form>' +
      '</section>' +
      '<aside class="stack">' +
        '<div class="card"><h3>Try it</h3><p class="muted">Tap an example to send it, or tap the mic and speak.</p><div class="chips">' +
          examples.map(function (x) { return '<button class="chip" type="button" data-action="say" data-text="' + esc(x) + '">“' + esc(x) + '”</button>'; }).join('') +
        '</div></div>' +
        '<div class="card"><h3>How Dukaan Dost decides</h3><ol class="rules">' +
          '<li><b>Order</b> = expected sales for the next few days − stock on the shelf, rounded up to full packs.</li>' +
          '<li><b>Slow seller</b> = sells less than 1 every 3 days, with ₹500 or more stuck.</li>' +
          '<li><b>Expiry risk</b> = stock that won’t sell before it expires.</li>' +
        '</ol><p class="muted">Festival week, salary week and hot weather raise expected sales. Change them in <a href="#settings">Settings</a>.</p></div>' +
        '<div class="card"><h3>Move through days</h3><p class="muted">Tap <b>Fill today’s sales</b> to add a realistic day of sales, then <b>End day</b>. Orders arrive the next morning and expired stock is thrown away.</p></div>' +
      '</aside></div>';
  }

  function renderDashboard() {
    var p = E.plan(state);
    var wasted = 0;
    state.waste.forEach(function (w) { wasted += w.value; });
    var pending = state.orders.filter(function (o) { return o.status === 'pending'; }).length;
    var live = liveOffer();
    var waiting = state.reservations.filter(function (r) { return r.status === 'reserved'; }).length;

    var hist = state.history.slice(-7).map(function (h) { return { label: shortDay(h.day), value: h.total }; });
    hist.push({ label: 'Today', value: p.todaySales, highlight: true });

    var f = state.flags;
    var names = function (cats) {
      return state.items.filter(function (it) { return cats.indexOf(it.cat) !== -1; }).map(function (it) { return it.name; }).join(', ') || 'No products yet';
    };
    var events = [];
    if (f.festival) events.push({ name: 'Festival week', effect: '+60% / +15%', items: 'Festival items +60%: ' + names(['festival']) + '. Snacks +15%: ' + names(['snacks']) + '.' });
    if (f.salary) events.push({ name: 'Salary week', effect: '+25%', items: 'Staples: ' + names(['staples']) + '.' });
    if (f.hot) events.push({ name: 'Hot weather', effect: '+40%', items: 'Drinks: ' + names(['drinks']) + '.' });
    var boostsHtml = (events.length ? '<ul class="list">' + events.map(function (ev) {
      return '<li><span><b>' + esc(ev.name) + '</b><small>' + esc(ev.items) + '</small></span><b>' + esc(ev.effect) + '</b></li>';
    }).join('') + '</ul>' : '<p class="muted">No special events this week.</p>') +
      '<p class="muted">Turn events on or off in <a href="#settings">Settings</a>. Expected sales change instantly.</p>';

    function listCard(title, rows, render, empty, link) {
      return '<div class="card"><h3>' + title + '</h3>' + (rows.length ? '<ul class="list">' + rows.map(render).join('') + '</ul>' : '<p class="muted">' + empty + '</p>') + (link || '') + '</div>';
    }

    return '<div class="view-head"><div><h2>' + esc(t('dashboard')) + '</h2><p class="muted">' + esc(state.shop.name) + ' · Day ' + state.day + ' · ' + esc(dayName(state.day)) + '</p></div></div>' +
      tilesHtml(p) +
      '<div class="stats">' +
        '<div class="stat"><b>' + pending + '</b><span>orders on the way</span></div>' +
        '<div class="stat"><b>' + (live ? live.discount + '% off live' : 'None') + '</b><span>customer offer</span></div>' +
        '<div class="stat"><b>' + waiting + '</b><span>reservations to hand over</span></div>' +
        '<div class="stat"><b>' + rupees(wasted) + '</b><span>thrown away so far</span></div>' +
      '</div>' +
      '<div class="grid2">' +
        '<div class="card chart"><h3>Sales, last 7 days and today</h3>' + barChart(hist) + '</div>' +
        '<div class="card"><h3>This week’s demand boosts</h3>' + boostsHtml + '</div>' +
      '</div><div style="height:16px"></div>' +
      '<div class="grid3">' +
        listCard(esc(t('orderToday')), p.reorder, function (r) { return '<li><span><b>' + esc(r.item.name) + '</b><small>' + esc(r.a.reasons.join(' · ') || 'stock running down') + '</small></span><span>' + esc(E.unitText(r.item, r.a.packs)) + '</span></li>'; }, 'Nothing to order.', '<p><a href="#orders">Go to orders →</a></p>') +
        listCard(esc(t('slowSellers')), p.slow, function (r) { return '<li><span><b>' + esc(r.item.name) + '</b><small>' + r.a.daily.toFixed(1) + ' sold a day</small></span><span>' + rupees(r.a.stuckValue) + '</span></li>'; }, 'No slow sellers.') +
        listCard(esc(t('expiringSoon')), p.risk, function (r) { return '<li><span><b>' + esc(r.item.name) + '</b><small>expires in ' + r.item.expiry + ' days</small></span><span>' + r.a.riskQty + ' at risk</span></li>'; }, 'Nothing at risk.', '<p><a href="#offers">Go to offers →</a></p>') +
      '</div>';
  }

  function stockRows() {
    var q = ui.search.trim().toLowerCase();
    var rows = state.items.filter(function (it) {
      if (!q) return true;
      return it.name.toLowerCase().indexOf(q) !== -1 || (it.alias || []).join(' ').indexOf(q) !== -1 || (DD.CATEGORIES[it.cat] || '').toLowerCase().indexOf(q) !== -1;
    });
    if (!rows.length) return '<tr><td colspan="9" class="muted">No products match “' + esc(ui.search) + '”.</td></tr>';
    return rows.map(function (it) {
      var a = E.analyse(it, state.flags);
      var confirm = ui.confirmDelete === it.id;
      return '<tr>' +
        '<td><b>' + esc(it.name) + '</b><small>' + esc(DD.CATEGORIES[it.cat] || it.cat) + '</small></td>' +
        '<td class="num-cell">' + rupees(it.price) + '</td>' +
        '<td class="num-cell">' + it.stock + '</td>' +
        '<td class="num-cell">' + it.today + '</td>' +
        '<td class="num-cell">' + a.daily.toFixed(1) + '</td>' +
        '<td class="num-cell">' + a.forecast + ' <small>next ' + it.days + 'd</small></td>' +
        '<td>' + (it.expiry != null ? 'in ' + it.expiry + 'd' : '<span class="muted">—</span>') + '</td>' +
        '<td>' + tag(a.status) + '</td>' +
        '<td><div class="row-gap"><button class="btn ghost small" type="button" data-action="editItem" data-id="' + esc(it.id) + '">Edit</button>' +
        '<button class="btn ' + (confirm ? 'danger' : 'ghost') + ' small" type="button" data-action="delItem" data-id="' + esc(it.id) + '">' + (confirm ? 'Confirm delete' : 'Delete') + '</button></div></td>' +
        '</tr>';
    }).join('');
  }

  function itemForm() {
    var isNew = ui.editing === 'new';
    var it = isNew ? { name: '', cat: 'snacks', price: '', stock: '', pack: 1, unit: ['pack', 'packs'], shelfLife: '', days: 7, alias: [] } : findItem(ui.editing);
    if (!it) { ui.editing = null; return ''; }
    function field(name, label, value, type, extra, hint) {
      return '<label class="field">' + label + '<input name="' + name + '" type="' + (type || 'text') + '" value="' + esc(value) + '" ' + (extra || '') + '>' + (hint ? '<small>' + hint + '</small>' : '') + '</label>';
    }
    var cats = Object.keys(DD.CATEGORIES).map(function (k) { return '<option value="' + k + '"' + (it.cat === k ? ' selected' : '') + '>' + DD.CATEGORIES[k] + '</option>'; }).join('');
    return '<form class="card" data-form="item" novalidate>' +
      '<h3>' + (isNew ? 'Add a product' : 'Edit ' + esc(it.name)) + '</h3>' +
      '<div class="form-grid">' +
        field('name', 'Product name', it.name, 'text', 'required maxlength="40"') +
        '<label class="field">Category<select name="cat">' + cats + '</select></label>' +
        field('price', 'Selling price (₹)', it.price, 'number', 'min="1" step="1"') +
        field('stock', 'Stock on the shelf', it.stock, 'number', 'min="0" step="1"') +
        field('pack', 'Units per pack from distributor', it.pack, 'number', 'min="1" step="1"', 'e.g. 48 packets in a carton') +
        field('unitS', 'Pack name', it.unit[0], 'text', 'maxlength="20"', 'e.g. carton') +
        field('unitP', 'Pack name (plural)', it.unit[1], 'text', 'maxlength="20"', 'e.g. cartons') +
        field('days', 'Order for how many days', it.days, 'number', 'min="1" max="30" step="1"', 'Fresh items: 2–3, others: 7') +
        field('shelfLife', 'Shelf life in days', it.shelfLife == null ? '' : it.shelfLife, 'number', 'min="1" step="1"', 'Leave empty if it lasts for months') +
        (isNew ? field('perDay', 'Expected sales per day', '', 'number', 'min="0" step="0.5"', 'Used until real sales come in') : '') +
        field('alias', 'Words for voice notes', (it.alias || []).join(', '), 'text', 'maxlength="80"', 'Comma separated, e.g. maggi, noodle') +
      '</div>' +
      '<p class="err" role="alert">' + esc(ui.formError) + '</p>' +
      '<div class="row-gap"><button class="btn green" type="submit">Save product</button><button class="btn ghost" type="button" data-action="cancelEdit">Cancel</button></div>' +
      '</form><div style="height:16px"></div>';
  }

  function renderStock() {
    return '<div class="view-head"><div><h2>Stock</h2><p class="muted">' + state.items.length + ' products · forecasts update as you record sales</p></div>' +
      '<div class="row-gap"><label class="sr" for="search">Search products</label><input id="search" class="search" type="search" placeholder="Search products" value="' + esc(ui.search) + '">' +
      '<button class="btn green" type="button" data-action="addItem">+ Add product</button></div></div>' +
      (ui.editing ? itemForm() : '') +
      '<div class="card"><div class="table-wrap"><table><thead><tr><th>Product</th><th class="num-cell">Price</th><th class="num-cell">In stock</th><th class="num-cell">Sold today</th><th class="num-cell">Avg / day</th><th class="num-cell">Expected sales</th><th>Expires</th><th>Status</th><th>Actions</th></tr></thead>' +
      '<tbody id="stockBody">' + stockRows() + '</tbody></table></div></div>';
  }

  function renderOrders() {
    var p = E.plan(state);
    var sent = pendingOrderToday();
    var lines = p.reorder.map(function (r) { return { name: r.item.name, qtyText: E.unitText(r.item, r.a.packs), why: r.a.reasons.join(' · ') || 'stock running down' }; });
    var preview = { day: state.day, lines: lines };
    var suggested = '<div class="card"><h3>Today’s suggested order</h3>' +
      (lines.length ? '<ul class="list">' + lines.map(function (l) { return '<li><span><b>' + esc(l.name) + '</b><small>' + esc(l.why) + '</small></span><span>' + esc(l.qtyText) + '</span></li>'; }).join('') + '</ul>' +
        '<p class="muted">Worth about ' + rupees(p.orderValue) + ' at shelf price · goes to ' + esc(state.shop.distributor) + '</p>' : '<p class="muted">Nothing needs ordering today.</p>') +
      '<div class="row-gap">' +
        (sent ? '<span class="tag pending">Order #' + esc(sent.id) + ' sent today</span>' : '<button class="btn amber" type="button" data-action="sendOrder"' + (lines.length ? '' : ' disabled') + '>Send order</button>') +
        (lines.length ? '<a class="btn wa" target="_blank" rel="noopener" href="' + esc(waLink(orderText(sent || preview))) + '">Open in WhatsApp</a>' : '') +
      '</div></div>';

    var hist = state.orders.length ? '<div class="table-wrap"><table><thead><tr><th>Order</th><th>Placed</th><th>Items</th><th class="num-cell">Value</th><th>Status</th><th></th></tr></thead><tbody>' +
      state.orders.map(function (o) {
        return '<tr><td><b>#' + esc(o.id) + '</b></td><td>Day ' + o.day + '<small>' + esc(dayName(o.day)) + '</small></td>' +
          '<td>' + o.lines.map(function (l) { return esc(l.qtyText + ' ' + l.name); }).join('<br>') + '</td>' +
          '<td class="num-cell">' + rupees(o.value) + '</td>' +
          '<td>' + (o.status === 'pending' ? '<span class="tag pending">On the way</span>' : '<span class="tag done">Delivered day ' + o.deliveredDay + '</span>') + '</td>' +
          '<td>' + (o.status === 'pending' ? '<button class="btn outline small" type="button" data-action="deliver" data-id="' + esc(o.id) + '">Mark delivered</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">No orders yet. Send today’s order to see it here.</p>';

    return '<div class="view-head"><div><h2>Orders</h2><p class="muted">Orders go to ' + esc(state.shop.distributor) + ' and arrive the next morning.</p></div></div>' +
      '<div class="grid2">' + suggested + '<div class="card"><h3>How it works</h3><ol class="rules"><li>Dukaan Dost suggests what to order every morning.</li><li>One tap sends it; <b>Open in WhatsApp</b> sends the same message to the distributor for real.</li><li>When the stock arrives, it’s added to the shelf automatically.</li></ol></div></div>' +
      '<div style="height:16px"></div><div class="card"><h3>Order history</h3>' + hist + '</div>';
  }

  function renderOffers() {
    var p = E.plan(state);
    var live = liveOffer();
    var d = state.discount;

    var riskCard = '<div class="card"><h3>Items at risk of expiring</h3>' +
      (p.risk.length ? '<div class="table-wrap"><table><thead><tr><th>Product</th><th class="num-cell">At risk</th><th>Expires</th><th class="num-cell">Price</th><th class="num-cell">Offer price</th></tr></thead><tbody>' +
        p.risk.map(function (r) {
          return '<tr><td><b>' + esc(r.item.name) + '</b></td><td class="num-cell">' + r.a.riskQty + '</td><td>in ' + r.item.expiry + 'd</td><td class="num-cell">' + rupees(r.item.price) + '</td><td class="num-cell"><b>' + rupees(Math.round(r.item.price * (100 - d) / 100)) + '</b></td></tr>';
        }).join('') + '</tbody></table></div><p class="muted">' + rupees(p.riskValue) + ' at risk · ' + d + '% discount (change it in Settings)</p>'
        : '<p class="muted">Nothing is at risk right now.</p>') +
      '<div class="row-gap">' +
        (live ? '<span class="tag live">Offer #' + esc(live.id) + ' is live</span><a class="btn wa" target="_blank" rel="noopener" href="' + esc(waLink(offerText(live))) + '">Share on WhatsApp</a>'
          : '<button class="btn amber" type="button" data-action="sendOffer"' + (p.risk.length ? '' : ' disabled') + '>Send offer to ' + state.shop.customers + ' customers</button>') +
      '</div></div>';

    var resv = state.reservations.length ? '<div class="table-wrap"><table><thead><tr><th>Code</th><th>Items</th><th class="num-cell">Total</th><th>Status</th><th></th></tr></thead><tbody>' +
      state.reservations.map(function (r) {
        var st = r.status === 'reserved' ? '<span class="tag pending">Waiting</span>' : r.status === 'picked' ? '<span class="tag done">Picked up</span>' : '<span class="tag ok">Expired</span>';
        return '<tr><td><b>' + esc(r.code) + '</b><small>Day ' + r.day + '</small></td><td>' + r.lines.map(function (l) { return esc(l.qty + ' × ' + l.name); }).join('<br>') + '</td><td class="num-cell">' + rupees(r.total) + '</td><td>' + st + '</td>' +
          '<td>' + (r.status === 'reserved' ? '<button class="btn outline small" type="button" data-action="pickup" data-id="' + esc(r.id) + '">Mark picked up</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">No reservations yet. Reserve items in the customer view to try it.</p>';

    var customer;
    if (live) {
      var total = 0, count = 0, saving = 0;
      var lines = live.lines.map(function (l) {
        var q = ui.cart[l.itemId] || 0;
        total += q * l.offerPrice; count += q; saving += q * (l.price - l.offerPrice);
        return '<div class="offer-line"><div class="info"><b>' + esc(l.name) + '</b><br><small class="muted">' + l.left + ' left</small></div>' +
          '<div><s>' + rupees(l.price) + '</s><b>' + rupees(l.offerPrice) + '</b></div>' +
          '<div class="stepper"><button type="button" data-action="cartMinus" data-id="' + esc(l.itemId) + '" aria-label="Remove one ' + esc(l.name) + '">−</button><b>' + q + '</b>' +
          '<button type="button" data-action="cartPlus" data-id="' + esc(l.itemId) + '" aria-label="Add one ' + esc(l.name) + '">+</button></div></div>';
      }).join('');
      customer = '<section class="customer" aria-label="What a nearby customer sees">' +
        '<div class="offer-head"><small>Message from ' + esc(state.shop.name) + '</small><h3>' + live.discount + '% off fresh items</h3><p>Today only. Reserve now, pay when you pick up.</p></div>' +
        lines +
        '<div class="offer-foot"><div><b>' + (count ? rupees(total) + ' · ' + count + (count === 1 ? ' item' : ' items') : 'Pick items to reserve') + '</b><br><small class="muted">' + (count ? 'You save ' + rupees(saving) : 'Use + to add') + '</small></div>' +
        '<button class="btn amber" type="button" data-action="reserve"' + (count ? '' : ' disabled') + '>Reserve</button></div></section>';
    } else {
      customer = '<div class="card"><h3>Customer view</h3><p class="muted">No offer is live. Send one to see exactly what nearby customers receive.</p></div>';
    }

    return '<div class="view-head"><div><h2>Offers</h2><p class="muted">Sell stock before it expires instead of throwing it away.</p></div></div>' +
      '<div class="grid2"><div class="stack">' + riskCard + '<div class="card"><h3>Reservations</h3>' + resv + '</div></div>' +
      '<div class="stack"><p class="muted" style="margin:0">What a nearby customer sees:</p>' + customer + '</div></div>';
  }

  function renderSettings() {
    var f = state.flags;
    function check(key, label, hint) {
      return '<label class="toggle"><input type="checkbox" data-flag="' + key + '"' + (f[key] ? ' checked' : '') + '> <span><b>' + label + '</b><br><small class="muted">' + hint + '</small></span></label>';
    }
    return '<div class="view-head"><div><h2>Settings</h2><p class="muted">Changes save automatically on this device.</p></div></div>' +
      '<div class="grid2"><div class="stack">' +
        '<div class="card"><h3>What’s happening this week?</h3><div class="stack" style="gap:10px">' +
          check('festival', 'Festival week', 'Festival items +60%, snacks +15%') +
          check('salary', 'Salary week', 'Staples like oil, dal and rice +25%') +
          check('hot', 'Hot weather', 'Cold drinks +40%') +
        '</div></div>' +
        '<form class="card" data-form="shop" novalidate><h3>Shop details</h3><div class="form-grid">' +
          '<label class="field">Shop name<input name="name" maxlength="40" value="' + esc(state.shop.name) + '"></label>' +
          '<label class="field">Owner’s name<input name="owner" maxlength="30" value="' + esc(state.shop.owner) + '"></label>' +
          '<label class="field">Distributor<input name="distributor" maxlength="40" value="' + esc(state.shop.distributor) + '"></label>' +
          '<label class="field">Customers who get offers<input name="customers" type="number" min="0" step="1" value="' + esc(state.shop.customers) + '"></label>' +
          '<label class="field">Offer discount: <b id="discOut">' + state.discount + '%</b><input name="discount" type="range" min="5" max="30" step="5" value="' + state.discount + '" data-range="discount"></label>' +
        '</div><button class="btn green" type="submit">Save details</button></form>' +
      '</div><div class="stack">' +
        '<div class="card"><h3>' + esc(t('language')) + '</h3><p class="muted">Menus and buttons change language. On WhatsApp, the AI chats in any Indian language.</p><div class="lang-row left">' + langChips() + '</div></div>' +
        '<div class="card"><h3>Your data</h3><p class="muted">Everything is stored in this browser. Download a copy, or start the demo again from Day 1.</p><div class="row-gap">' +
          '<button class="btn outline" type="button" data-action="exportData">Download data (JSON)</button>' +
          '<button class="btn ' + (ui.confirmReset ? 'danger' : 'ghost') + '" type="button" data-action="resetData">' + (ui.confirmReset ? 'Tap again to reset everything' : 'Reset demo data') + '</button>' +
        '</div></div>' +
        '<div class="card"><h3>About</h3><p class="muted">Dukaan Dost is a FlairQuest 2.0 project (Track 04). This version runs fully in the browser with sample data. The real product would run the same rules on a server and talk to owners through the WhatsApp Business API.</p></div>' +
      '</div></div>';
  }

  /* ---------- Draw ---------- */
  function render() {
    document.body.classList.toggle('on-welcome', ui.view === 'welcome');
    document.getElementById('shopLine').textContent = state.shop.name;
    document.getElementById('dayLabel').textContent = t('day') + ' ' + state.day + ' · ' + dayName(state.day);
    var simBtn = document.querySelector('.top-actions [data-action="simulate"]');
    var endBtn = document.querySelector('.top-actions [data-action="endDay"]');
    if (simBtn) simBtn.textContent = t('fillSales');
    if (endBtn) endBtn.textContent = t('endDay');
    var langSel = document.getElementById('langSelect');
    if (langSel) langSel.value = DD.lang;
    var pending = state.orders.filter(function (o) { return o.status === 'pending'; }).length;
    var waiting = state.reservations.filter(function (r) { return r.status === 'reserved'; }).length;
    var counts = { orders: pending, offers: waiting };
    Array.prototype.forEach.call(document.querySelectorAll('.tabs a'), function (a) {
      var v = a.getAttribute('data-view');
      var on = v === ui.view;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      a.innerHTML = esc(t(v)) + (counts[v] ? '<span class="count">' + counts[v] + '</span>' : '');
    });
    var draw = { welcome: renderWelcome, home: renderHome, chat: renderChat, dashboard: renderDashboard, stock: renderStock, orders: renderOrders, offers: renderOffers, settings: renderSettings }[ui.view];
    viewEl.innerHTML = draw();
    if (ui.view === 'chat') scrollChat();
  }

  /* Keep the newest message in view, also after fonts finish loading and change sizes. */
  function scrollChat() {
    var go = function () { var m = document.getElementById('msgs'); if (m) m.scrollTop = m.scrollHeight; };
    go();
    if (window.requestAnimationFrame) window.requestAnimationFrame(go);
    setTimeout(go, 300);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (ui.view === 'chat') scrollChat(); });

  /* ---------- Taps ---------- */
  var actions = {
    setLang: function (el) { DD.setLang(el.getAttribute('data-code')); render(); },
    start: function () { location.hash = '#home'; },
    say: function (el) { handleOwner(el.getAttribute('data-text')); commit(); },
    voice: function () { startVoice(); },
    simulate: function () {
      if (state.simulatedDay === state.day) { toast('Today’s sales are already filled. Tap End day to move on.'); return; }
      var r = E.simulateDay(state);
      state.simulatedDay = state.day;
      bot('Billing sync (demo): recorded **' + rupees(r.total) + '** of sales across ' + r.lines + ' products today.');
      ui.confirmEnd = false;
      commit();
      toast('Added a day of sales worth ' + rupees(r.total) + '.');
    },
    endDay: function () {
      if (E.todaySales(state) === 0 && !ui.confirmEnd) {
        ui.confirmEnd = true;
        toast('No sales recorded today. Tap End day again to close anyway, or fill today’s sales first.');
        return;
      }
      ui.confirmEnd = false;
      var s = E.endDay(state);
      var wastedValue = 0;
      s.wasted.forEach(function (w) { wastedValue += w.value; });
      bot('**Day ' + s.day + ' closed.** Sales: ' + rupees(s.sales) + '.' +
        (s.wasted.length ? '\nExpired and thrown away: ' + s.wasted.map(function (w) { return w.qty + ' ' + w.name; }).join(', ') + ' (' + rupees(wastedValue) + ').' : '\nNothing expired.'));
      if (s.delivered.length) bot('Good morning! ' + state.shop.distributor + ' delivered order ' + s.delivered.map(function (o) { return '#' + o.id; }).join(', ') + '. Stock is updated.');
      postPlan();
      ui.cart = {};
      commit();
      toast('Day ' + state.day + ' started. The morning plan is in Chat.');
    },
    addItem: function () { ui.editing = 'new'; ui.formError = ''; commit(); },
    editItem: function (el) { ui.editing = el.getAttribute('data-id'); ui.formError = ''; ui.confirmDelete = null; commit(); window.scrollTo(0, 0); },
    cancelEdit: function () { ui.editing = null; ui.formError = ''; commit(); },
    delItem: function (el) {
      var id = el.getAttribute('data-id');
      if (ui.confirmDelete === id) {
        var it = findItem(id);
        state.items = state.items.filter(function (x) { return x.id !== id; });
        ui.confirmDelete = null;
        if (ui.editing === id) ui.editing = null;
        commit();
        toast((it ? it.name : 'Product') + ' deleted.');
      } else {
        ui.confirmDelete = id;
        render();
      }
    },
    sendOrder: function () { var o = sendOrder(); commit(); if (o) toast('Order #' + o.id + ' sent to ' + state.shop.distributor + '.'); },
    sendOffer: function () { var of = sendOffer(); commit(); if (of) toast('Offer sent to ' + of.sentTo + ' customers.'); },
    deliver: function (el) {
      var o = findBy(state.orders, el.getAttribute('data-id'));
      if (o && E.deliverOrder(state, o)) {
        bot('Order **#' + o.id + '** delivered. Stock is updated.');
        commit();
        toast('Order #' + o.id + ' added to stock.');
      }
    },
    cartPlus: function (el) {
      var live = liveOffer(); if (!live) return;
      var id = el.getAttribute('data-id');
      var line = null; live.lines.forEach(function (l) { if (l.itemId === id) line = l; });
      var q = ui.cart[id] || 0;
      if (line && q < line.left) ui.cart[id] = q + 1; else toast('No more left at this price.');
      render();
    },
    cartMinus: function (el) {
      var id = el.getAttribute('data-id');
      if (ui.cart[id]) ui.cart[id] -= 1;
      render();
    },
    reserve: function () {
      var live = liveOffer(); if (!live) return;
      var lines = [], total = 0;
      live.lines.forEach(function (l) {
        var q = Math.min(ui.cart[l.itemId] || 0, l.left);
        if (q > 0) { lines.push({ itemId: l.itemId, name: l.name, qty: q, price: l.offerPrice }); total += q * l.offerPrice; l.left -= q; }
      });
      if (!lines.length) return;
      var r = { id: newId('R'), offerId: live.id, day: state.day, lines: lines, total: total, code: String(1000 + Math.floor(Math.random() * 9000)), status: 'reserved' };
      state.reservations.unshift(r);
      ui.cart = {};
      bot('**New reservation, code ' + r.code + ':** ' + lines.map(function (l) { return l.qty + ' × ' + l.name; }).join(', ') + ' (' + rupees(total) + '). Keep it aside for pickup.');
      commit();
      toast('Reserved! Pickup code ' + r.code + '.');
    },
    pickup: function (el) {
      var r = findBy(state.reservations, el.getAttribute('data-id'));
      if (!r || r.status !== 'reserved') return;
      r.lines.forEach(function (l) {
        var it = findItem(l.itemId);
        if (!it) return;
        var q = Math.min(l.qty, it.stock);
        it.stock -= q;
        it.today += q;
      });
      r.status = 'picked';
      bot('Reservation **' + r.code + '** picked up. ' + rupees(r.total) + ' saved from going to waste.');
      commit();
      toast('Picked up. Stock and sales updated.');
    },
    exportData: function () {
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'dukaan-dost-data.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    },
    resetData: function () {
      if (!ui.confirmReset) { ui.confirmReset = true; render(); return; }
      state = DD.store.reset();
      ui.confirmReset = false; ui.cart = {}; ui.editing = null;
      welcome();
      commit();
      toast('Demo data reset to Day 1.');
    }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    var fn = actions[el.getAttribute('data-action')];
    if (fn) { e.preventDefault(); fn(el); }
  });

  /* ---------- Forms ---------- */
  var forms = {
    chat: function (f) {
      var input = f.elements.msg;
      var text = input.value;
      if (!text.trim()) { input.focus(); return; }
      handleOwner(text);
      commit();
      var again = document.getElementById('chatInput');
      if (again) again.focus();
    },
    item: function (f) {
      var v = function (n) { return f.elements[n] ? String(f.elements[n].value).trim() : ''; };
      var name = v('name'), price = Number(v('price')), stock = Number(v('stock')), pack = Number(v('pack')), days = Number(v('days'));
      var shelf = v('shelfLife') === '' ? null : Number(v('shelfLife'));
      var err = '';
      if (!name) err = 'Enter a product name.';
      else if (!(price > 0)) err = 'Enter a selling price above ₹0.';
      else if (!(stock >= 0) || Math.floor(stock) !== stock || v('stock') === '') err = 'Enter the stock as a whole number (0 or more).';
      else if (!(pack >= 1) || Math.floor(pack) !== pack) err = 'Units per pack must be a whole number, 1 or more.';
      else if (!(days >= 1 && days <= 30)) err = 'Order days must be between 1 and 30.';
      else if (shelf !== null && !(shelf >= 1)) err = 'Shelf life must be 1 day or more, or left empty.';
      var dupe = state.items.some(function (x) { return x.name.toLowerCase() === name.toLowerCase() && x.id !== ui.editing; });
      if (!err && dupe) err = 'A product with this name already exists.';
      if (err) { ui.formError = err; render(); return; }

      var alias = v('alias').toLowerCase().split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!alias.length) alias = [name.toLowerCase()];
      var unit = [v('unitS') || 'pack', v('unitP') || v('unitS') || 'packs'];

      if (ui.editing === 'new') {
        var perDay = Math.max(0, Number(v('perDay')) || 0);
        var sales = [];
        for (var i = 0; i < 7; i++) sales.push(Math.round(perDay * (i + 1)) - Math.round(perDay * i));
        state.items.push({ id: newId('I'), name: name, cat: v('cat'), price: price, stock: stock, sales: sales, today: 0, days: days, pack: pack, unit: unit, shelfLife: shelf, expiry: shelf && stock > 0 ? shelf : null, alias: alias });
        toast(name + ' added.');
      } else {
        var it = findItem(ui.editing);
        if (it) {
          it.name = name; it.cat = v('cat'); it.price = price; it.stock = stock; it.pack = pack; it.unit = unit; it.days = days; it.alias = alias;
          if (shelf === null) it.expiry = null;
          else if (it.shelfLife !== shelf || it.expiry == null) it.expiry = stock > 0 ? shelf : null;
          it.shelfLife = shelf;
          toast(name + ' updated.');
        }
      }
      ui.editing = null;
      ui.formError = '';
      commit();
    },
    shop: function (f) {
      var name = f.elements.name.value.trim();
      var owner = f.elements.owner.value.trim();
      var dist = f.elements.distributor.value.trim();
      var cust = Number(f.elements.customers.value);
      if (!name || !owner || !dist) { toast('Fill in the shop, owner and distributor names.'); return; }
      if (!(cust >= 0)) { toast('Customers must be 0 or more.'); return; }
      state.shop.name = name; state.shop.owner = owner; state.shop.distributor = dist; state.shop.customers = Math.round(cust);
      state.discount = Number(f.elements.discount.value) || 10;
      commit();
      toast('Shop details saved.');
    }
  };

  document.addEventListener('submit', function (e) {
    var fn = forms[e.target.getAttribute('data-form')];
    if (fn) { e.preventDefault(); fn(e.target); }
  });

  document.addEventListener('change', function (e) {
    var flag = e.target.getAttribute && e.target.getAttribute('data-flag');
    if (flag) {
      state.flags[flag] = e.target.checked;
      commit();
      toast('Forecast updated for this week.');
    }
    if (e.target.getAttribute && e.target.getAttribute('data-range') === 'discount') {
      state.discount = Number(e.target.value);
      save();
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'search') {
      ui.search = e.target.value;
      var body = document.getElementById('stockBody');
      if (body) body.innerHTML = stockRows();
    }
    if (e.target.getAttribute && e.target.getAttribute('data-range') === 'discount') {
      var out = document.getElementById('discOut');
      if (out) out.textContent = e.target.value + '%';
    }
  });

  /* ---------- Sections (address bar #chat, #stock …) ---------- */
  function route() {
    var v = (location.hash || '#welcome').slice(1);
    ui.view = VIEWS.indexOf(v) === -1 ? 'welcome' : v;
    window.scrollTo(0, 0);
    ui.confirmDelete = null; ui.confirmReset = false;
    render();
  }
  window.addEventListener('hashchange', function () { route(); viewEl.focus({ preventScroll: true }); });

  function welcome() {
    bot('Namaste, ' + state.shop.owner + '! I’m **Dukaan Dost**, your stock assistant. Every morning I’ll tell you what to order, what to stop ordering and what’s about to expire.\n\nSend me your sales any time, like **sold 5 bread and 2 curd**. Type **help** to see everything I can do.');
    postPlan();
  }

  if (!state.chat.length) { welcome(); save(); }
  route();

  // Exposed for automated tests only.
  window.__dukaan = { getState: function () { return state; }, handleOwner: handleOwner, actions: actions, render: render };
})();
