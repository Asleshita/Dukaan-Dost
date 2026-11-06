/*
 * Dukaan Dost – saving data
 * Everything is kept in the browser’s localStorage, so the demo remembers
 * products, sales, orders and chat after you close the tab. No server needed.
 */
var DD = window.DD || (window.DD = {});

DD.store = (function () {
  'use strict';
  var KEY = 'dukaanDost.v1';

  function load() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(KEY));
      if (saved && saved.version === 1 && Array.isArray(saved.items)) return saved;
    } catch (e) { /* storage blocked or data damaged: start fresh */ }
    return DD.defaultState();
  }

  function save(state) {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
  }

  function reset() {
    try { window.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    return DD.defaultState();
  }

  return { load: load, save: save, reset: reset };
})();
