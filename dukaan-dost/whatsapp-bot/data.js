/*
 * Dukaan Dost – sample data
 * All shop names, products, prices and sales below are made-up demo data.
 *
 * Each product:
 *   sales     units sold on each of the last 7 completed days (oldest first)
 *   today     units sold so far today
 *   days      how many days ahead we stock for (fresh items are ordered more often)
 *   pack      units in one pack the distributor sells (e.g. 48 packets in a carton)
 *   unit      pack name [singular, plural]
 *   shelfLife days a fresh delivery lasts (null = long-lasting)
 *   expiry    days until the stock on the shelf expires (null = not expiring soon)
 *   alias     words the voice note reader recognises
 */
var DD = window.DD || (window.DD = {});

DD.CATEGORIES = {
  snacks: 'Snacks',
  festival: 'Festival',
  staples: 'Staples',
  drinks: 'Drinks',
  personal: 'Personal care',
  bakery: 'Bakery',
  dairy: 'Dairy'
};

DD.SAMPLE_ITEMS = [
  { id: 'maggi',  name: 'Maggi noodles',        cat: 'snacks',   price: 14,  stock: 30, sales: [7, 8, 9, 10, 12, 13, 14], days: 7, pack: 48, unit: ['carton', 'cartons'], shelfLife: null, expiry: null, alias: ['maggi', 'noodle'] },
  { id: 'dry',    name: 'Dry fruit gift pack',  cat: 'festival', price: 350, stock: 10, sales: [0, 1, 1, 1, 2, 2, 3],      days: 7, pack: 1,  unit: ['pack', 'packs'],     shelfLife: null, expiry: null, alias: ['dry fruit', 'dryfruit', 'kaju', 'badam'] },
  { id: 'oil',    name: 'Cooking oil 1 L',      cat: 'staples',  price: 150, stock: 23, sales: [3, 4, 3, 4, 4, 5, 5],      days: 7, pack: 1,  unit: ['bottle', 'bottles'], shelfLife: null, expiry: null, alias: ['cooking oil', 'oil'] },
  { id: 'dal',    name: 'Toor dal 1 kg',        cat: 'staples',  price: 160, stock: 10, sales: [2, 2, 3, 2, 2, 3, 2],      days: 7, pack: 1,  unit: ['pack', 'packs'],     shelfLife: null, expiry: null, alias: ['toor', 'dal'] },
  { id: 'rice',   name: 'Rice 5 kg',            cat: 'staples',  price: 320, stock: 6,  sales: [1, 1, 2, 1, 1, 2, 1],      days: 7, pack: 1,  unit: ['bag', 'bags'],       shelfLife: null, expiry: null, alias: ['rice', 'chawal'] },
  { id: 'cold',   name: 'Cold drink 600 ml',    cat: 'drinks',   price: 40,  stock: 30, sales: [5, 6, 4, 5, 6, 7, 6],      days: 7, pack: 24, unit: ['crate', 'crates'],   shelfLife: null, expiry: null, alias: ['cold drink', 'soft drink', 'drink'] },
  { id: 'tea',    name: 'Tea 250 g',            cat: 'staples',  price: 120, stock: 8,  sales: [2, 1, 2, 2, 1, 2, 2],      days: 7, pack: 1,  unit: ['pack', 'packs'],     shelfLife: null, expiry: null, alias: ['tea', 'chai'] },
  { id: 'bisc',   name: 'Brand X biscuits',     cat: 'snacks',   price: 30,  stock: 40, sales: [0, 0, 1, 0, 0, 0, 0],      days: 7, pack: 1,  unit: ['pack', 'packs'],     shelfLife: null, expiry: null, alias: ['biscuit'] },
  { id: 'hair',   name: 'Hair oil 500 ml',      cat: 'personal', price: 180, stock: 10, sales: [0, 0, 0, 1, 0, 0, 0],      days: 7, pack: 1,  unit: ['bottle', 'bottles'], shelfLife: null, expiry: null, alias: ['hair oil'] },
  { id: 'soup',   name: 'Instant soup',         cat: 'snacks',   price: 45,  stock: 25, sales: [0, 1, 0, 0, 1, 0, 0],      days: 7, pack: 1,  unit: ['pack', 'packs'],     shelfLife: null, expiry: null, alias: ['soup'] },
  { id: 'bread',  name: 'Bread',                cat: 'bakery',   price: 45,  stock: 10, sales: [3, 4, 3, 4, 5, 4, 4],      days: 2, pack: 1,  unit: ['loaf', 'loaves'],    shelfLife: 3,    expiry: 2,    alias: ['bread', 'pav'] },
  { id: 'curd',   name: 'Curd 400 g',           cat: 'dairy',    price: 50,  stock: 8,  sales: [2, 1, 2, 2, 1, 2, 2],      days: 3, pack: 1,  unit: ['tub', 'tubs'],       shelfLife: 5,    expiry: 3,    alias: ['curd', 'dahi'] },
  { id: 'paneer', name: 'Paneer 200 g',         cat: 'dairy',    price: 90,  stock: 6,  sales: [1, 1, 2, 1, 1, 1, 2],      days: 3, pack: 1,  unit: ['pack', 'packs'],     shelfLife: 5,    expiry: 4,    alias: ['paneer'] },
  { id: 'cake',   name: 'Cup cakes, pack of 4', cat: 'bakery',   price: 40,  stock: 8,  sales: [1, 0, 1, 1, 0, 1, 1],      days: 3, pack: 1,  unit: ['pack', 'packs'],     shelfLife: 7,    expiry: 5,    alias: ['cup cake', 'cupcake', 'cake'] },
  { id: 'chips',  name: 'Potato chips',         cat: 'snacks',   price: 20,  stock: 30, sales: [2, 3, 2, 3, 2, 3, 3],      days: 7, pack: 12, unit: ['box', 'boxes'],      shelfLife: 60,   expiry: 7,    alias: ['chips', 'wafer'] }
];

/* A fresh copy of the whole app state, used on first run and on "Reset demo data". */
DD.defaultState = function () {
  var items = DD.SAMPLE_ITEMS.map(function (it) {
    var copy = JSON.parse(JSON.stringify(it));
    copy.today = 0;
    return copy;
  });

  // Daily sales value (₹) for the 7 days before Day 1, rebuilt from the sample sales.
  var history = [];
  for (var i = 0; i < 7; i++) {
    var total = 0;
    items.forEach(function (it) { total += it.sales[i] * it.price; });
    history.push({ day: i - 6, total: total });
  }

  // Day 1 = today’s date on this computer (local time, not UTC).
  var now = new Date();
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var startDate = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());

  return {
    version: 1,
    startDate: startDate,
    day: 1,
    shop: { name: 'Ramesh Kirana Store', owner: 'Ramesh', distributor: 'Sharma Distributors', customers: 42 },
    flags: { festival: true, salary: true, hot: false },
    discount: 10,
    items: items,
    chat: [],
    orders: [],
    offers: [],
    reservations: [],
    waste: [],
    history: history,
    simulatedDay: 0,
    nextId: 100
  };
};
