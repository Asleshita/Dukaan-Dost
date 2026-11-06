/*
 * Dukaan Dost – the decision engine ("the brain")
 *
 * Three simple, explainable rules decide everything:
 *   1. Order       = expected sales for the next few days − stock on the shelf,
 *                    rounded up to full packs.
 *   2. Slow seller = sells less than about 1 every 3 days AND ₹500 or more is stuck on the shelf.
 *   3. Expiry risk = stock that probably won’t sell before it expires.
 *
 * Expected sales = average daily sales (last 7 days) × days ahead × this week’s boosts
 * (festival week, salary week, hot weather).
 */
var DD = window.DD || (window.DD = {});

DD.engine = (function () {
  'use strict';

  var EPS = 1e-6; // guards against tiny floating-point errors before rounding

  function avg(list) {
    if (!list || !list.length) return 0;
    var sum = 0;
    for (var i = 0; i < list.length; i++) sum += list[i];
    return sum / list.length;
  }

  function sum(list, fn) {
    var total = 0;
    list.forEach(function (x) { total += fn(x); });
    return total;
  }

  /* How much this week’s events push demand up, and why. */
  function boost(item, flags) {
    var m = 1;
    var why = [];
    if (flags.festival && item.cat === 'festival') { m *= 1.6; why.push('festival week'); }
    if (flags.festival && item.cat === 'snacks') { m *= 1.15; }
    if (flags.salary && item.cat === 'staples') { m *= 1.25; why.push('salary week'); }
    if (flags.hot && item.cat === 'drinks') { m *= 1.4; why.push('hot weather'); }
    return { m: m, why: why };
  }

  /* "2 cartons (96 pcs)" */
  function unitText(item, packs) {
    var label = packs === 1 ? item.unit[0] : item.unit[1];
    var text = packs + ' ' + label;
    if (item.pack > 1) text += ' (' + packs * item.pack + ' pcs)';
    return text;
  }

  /* Run the three rules on one product. */
  function analyse(item, flags) {
    var daily = avg(item.sales);
    var recent = avg(item.sales.slice(-3));
    var b = boost(item, flags);

    var forecast = Math.max(0, Math.ceil(daily * item.days * b.m - EPS));
    var slow = daily < 0.3 && item.stock * item.price >= 500;
    var need = Math.max(0, forecast - item.stock);
    var packs = slow ? 0 : Math.ceil(need / item.pack - EPS);

    var expiring = item.expiry != null && item.expiry <= 7 && item.stock > 0;
    var riskQty = 0;
    if (expiring) {
      var canSell = Math.floor(daily * item.expiry + EPS);
      riskQty = Math.max(0, item.stock - canSell);
    }

    var reasons = b.why.slice();
    if (daily > 0 && recent > daily * 1.15) reasons.push('selling fast');
    if (daily > 0 && item.stock <= daily * 2) reasons.push('running low');

    var status = 'ok';
    if (slow) status = 'slow';
    else if (riskQty > 0) status = 'risk';
    else if (packs > 0) status = 'reorder';

    return {
      daily: daily,
      recent: recent,
      boost: b.m,
      forecast: forecast,
      need: need,
      packs: packs,
      units: packs * item.pack,
      slow: slow,
      riskQty: riskQty,
      reasons: reasons,
      status: status,
      stuckValue: slow ? item.stock * item.price : 0,
      riskValue: riskQty * item.price
    };
  }

  /* The full morning plan for the shop. */
  function plan(state) {
    var rows = state.items.map(function (item) {
      return { item: item, a: analyse(item, state.flags) };
    });
    var reorder = rows.filter(function (r) { return r.a.packs > 0; });
    var slow = rows.filter(function (r) { return r.a.slow; });
    var risk = rows.filter(function (r) { return r.a.riskQty > 0; });
    return {
      rows: rows,
      reorder: reorder,
      slow: slow,
      risk: risk,
      stuck: sum(slow, function (r) { return r.a.stuckValue; }),
      riskValue: sum(risk, function (r) { return r.a.riskValue; }),
      orderValue: sum(reorder, function (r) { return r.a.units * r.item.price; }),
      todaySales: todaySales(state)
    };
  }

  function todaySales(state) {
    return sum(state.items, function (it) { return it.today * it.price; });
  }

  /* ---------- Reading a voice note / typed message ---------- */

  var NUMBER_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, fifteen: 15, twenty: 20, dozen: 12
  };

  function wordsToDigits(text) {
    return text.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|dozen)\b/g,
      function (w) { return String(NUMBER_WORDS[w]); });
  }

  /* "sold 6 bread and 4 curd" → [{item: Bread, qty: 6}, {item: Curd, qty: 4}] (does not change stock) */
  function parseNote(text, items) {
    var lookup = [];
    items.forEach(function (it) {
      (it.alias || []).concat([it.name]).forEach(function (a) {
        if (a) lookup.push({ a: String(a).toLowerCase(), item: it });
      });
    });
    lookup.sort(function (x, y) { return y.a.length - x.a.length; }); // "hair oil" before "oil"

    var matches = [];
    var unknown = [];
    wordsToDigits(String(text).toLowerCase()).split(/,|;|\band\b|\n|\+|&/).forEach(function (chunk) {
      chunk = chunk.trim();
      if (!chunk) return;
      var num = chunk.match(/\d+/);
      if (!num) return;
      var hit = null;
      for (var i = 0; i < lookup.length; i++) {
        if (chunk.indexOf(lookup[i].a) !== -1) { hit = lookup[i]; break; }
      }
      if (!hit) {
        var word = chunk.replace(/\d+/g, '').replace(/\b(sold|sell|sales|today|pcs|pieces|packets?|packs?|of)\b/g, '').trim();
        if (word) unknown.push(word);
        return;
      }
      var qty = parseInt(num[0], 10);
      if (!(qty > 0)) return;
      var existing = null;
      matches.forEach(function (m) { if (m.item === hit.item) existing = m; });
      if (existing) existing.qty += qty;
      else matches.push({ item: hit.item, qty: qty });
    });
    return { matches: matches, unknown: unknown };
  }

  /* Record sales: stock goes down, today’s sales go up. Never sells more than is on the shelf. */
  function applySales(state, matches) {
    return matches.map(function (m) {
      var qty = Math.min(m.qty, m.item.stock);
      m.item.stock -= qty;
      m.item.today += qty;
      return { item: m.item, asked: m.qty, qty: qty };
    });
  }

  /* Demo helper: fill in a realistic day of sales, as if synced from a billing app. */
  function simulateDay(state, random) {
    random = random || Math.random;
    var total = 0;
    var lines = 0;
    state.items.forEach(function (it) {
      var b = boost(it, state.flags);
      var qty = Math.round(avg(it.sales) * b.m * (0.7 + random() * 0.6));
      qty = Math.min(qty, it.stock);
      if (qty > 0) {
        it.stock -= qty;
        it.today += qty;
        total += qty * it.price;
        lines += 1;
      }
    });
    return { total: total, lines: lines };
  }

  /* A distributor delivery: stock goes up, fresh items get a new expiry date. */
  function deliverOrder(state, order) {
    if (order.status !== 'pending') return false;
    order.lines.forEach(function (line) {
      var it = null;
      state.items.forEach(function (x) { if (x.id === line.itemId) it = x; });
      if (!it) return;
      it.stock += line.units;
      if (it.shelfLife) it.expiry = it.shelfLife;
    });
    order.status = 'delivered';
    order.deliveredDay = state.day;
    return true;
  }

  /* Close the day and open the next one. */
  function endDay(state) {
    var summary = { day: state.day, sales: todaySales(state), wasted: [], delivered: [] };

    // 1. Today’s sales become part of the 7-day history.
    state.items.forEach(function (it) {
      it.sales.push(it.today);
      while (it.sales.length > 7) it.sales.shift();
      it.today = 0;
    });
    state.history.push({ day: state.day, total: summary.sales });
    while (state.history.length > 30) state.history.shift();

    // 2. Fresh items get one day older; anything past its date is thrown away.
    state.items.forEach(function (it) {
      if (it.expiry == null) return;
      it.expiry -= 1;
      if (it.expiry <= 0) {
        if (it.stock > 0) {
          var w = { day: state.day, itemId: it.id, name: it.name, qty: it.stock, value: it.stock * it.price };
          state.waste.push(w);
          summary.wasted.push(w);
        }
        it.stock = 0;
        it.expiry = null;
      }
    });

    // 3. Offers and reservations last one day.
    state.offers.forEach(function (of) { if (of.status === 'live') of.status = 'ended'; });
    state.reservations.forEach(function (r) { if (r.status === 'reserved') r.status = 'expired'; });

    // 4. New morning: yesterday’s orders arrive.
    state.day += 1;
    state.simulatedDay = 0;
    state.orders.forEach(function (o) {
      if (o.status === 'pending' && deliverOrder(state, o)) summary.delivered.push(o);
    });

    return summary;
  }

  return {
    avg: avg,
    boost: boost,
    unitText: unitText,
    analyse: analyse,
    plan: plan,
    todaySales: todaySales,
    parseNote: parseNote,
    applySales: applySales,
    simulateDay: simulateDay,
    deliverOrder: deliverOrder,
    endDay: endDay
  };
})();
