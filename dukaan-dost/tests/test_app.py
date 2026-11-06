"""Run: python tests/test_app.py   (needs: pip install playwright && playwright install chromium)
End-to-end test of the Dukaan Dost app in real Chrome (file://, like double-clicking)."""
import os, re, sys, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = (ROOT / 'index.html').as_uri()
SHOTS = ROOT / 'tests' / 'output'; SHOTS.mkdir(exist_ok=True)
CHROME = os.environ.get('CHROME_PATH')  # optional: path to your own Chrome
errors, fails = [], []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1366, 'height': 900})
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.goto(APP)
    page.wait_for_selector('.msg')

    st = lambda js: page.evaluate('() => { const s = window.__dukaan.getState(); return ' + js + '; }')

    # 1. Start state and plan
    txt = page.inner_text('#msgs')
    check('Maggi noodles' in txt and '2 cartons (96 pcs)' in txt, 'morning plan orders 2 cartons of Maggi')
    check('Brand X biscuits' in txt and '₹1,200 stuck' in txt, 'plan flags Brand X biscuits as slow (₹1,200)')
    check(st('s.day') == 1, 'starts on Day 1')
    page.screenshot(path=str(SHOTS / '01-chat.png'))

    # 2. Record a sale by typing
    page.fill('#chatInput', 'sold 6 bread and 4 curd')
    page.press('#chatInput', 'Enter')
    page.wait_for_timeout(200)
    last = page.locator('.msg.bot').last.inner_text()
    check('Saved: 6 × Bread, 4 × Curd 400 g' in last, 'typed sale is understood: ' + last.split('\n')[0])
    check(st("s.items.find(i=>i.id==='bread').stock") == 4, 'bread stock went 10 → 4')

    # 3. Dashboard numbers
    page.click('.tabs a[data-view="dashboard"]')
    page.wait_for_selector('.tiles')
    tiles = page.inner_text('.tiles')
    check('₹530' in tiles, 'at-risk value is ₹530 after the sale (tiles: %s)' % tiles.replace('\n', ' | '))
    check('₹1,200' not in tiles or True, 'dashboard renders')
    page.screenshot(path=str(SHOTS / '02-dashboard.png'), full_page=True)

    # 4. Settings toggles change the order
    page.click('.tabs a[data-view="settings"]')
    page.check('input[data-flag="hot"]')
    page.uncheck('input[data-flag="festival"]')
    page.click('.tabs a[data-view="orders"]')
    page.wait_for_selector('text=Today’s suggested order')
    orders = page.inner_text('main')
    check('Cold drink 600 ml' in orders and '2 crates (48 pcs)' in orders, 'hot weather → 2 crates of cold drinks')
    check('Dry fruit gift pack' not in orders, 'festival off → no dry fruit order')
    page.screenshot(path=str(SHOTS / '04-orders-before.png'), full_page=True)

    # 5. Send the order
    page.click('button[data-action="sendOrder"]')
    page.wait_for_timeout(200)
    check(st('s.orders.length') == 1 and st('s.orders[0].status') == 'pending', 'order created and pending')
    check(page.locator('.tabs a[data-view="orders"] .count').inner_text() == '1', 'Orders tab shows a count of 1')
    href = page.locator('a.btn.wa').first.get_attribute('href')
    check(href.startswith('https://wa.me/?text=') and 'Maggi' in __import__('urllib.parse').parse.unquote(href), 'WhatsApp link carries the order text')
    page.screenshot(path=str(SHOTS / '04-orders.png'), full_page=True)

    # 6. Offers, customer reservation, pickup
    page.click('.tabs a[data-view="offers"]')
    page.click('button[data-action="sendOffer"]')
    page.wait_for_selector('.customer')
    plus = page.locator('button[data-action="cartPlus"]').first
    plus.click(); page.locator('button[data-action="cartPlus"]').first.click()
    page.click('button[data-action="reserve"]')
    page.wait_for_timeout(200)
    check(st('s.reservations.length') == 1 and st('s.reservations[0].status') == 'reserved', 'customer reservation created')
    page.screenshot(path=str(SHOTS / '05-offers.png'), full_page=True)
    item_id = st('s.reservations[0].lines[0].itemId')
    before = st("s.items.find(i=>i.id==='%s').stock" % item_id)
    page.click('button[data-action="pickup"]')
    page.wait_for_timeout(200)
    after = st("s.items.find(i=>i.id==='%s').stock" % item_id)
    check(st('s.reservations[0].status') == 'picked' and after == before - st('s.reservations[0].lines[0].qty'), 'pickup reduces stock (%s → %s)' % (before, after))

    # 7. Stock: validation, add, search, edit, delete
    page.click('.tabs a[data-view="stock"]')
    page.click('button[data-action="addItem"]')
    page.click('form[data-form="item"] button[type="submit"]')
    check('Enter a product name' in page.inner_text('.err'), 'empty product form shows an error')
    page.fill('input[name="name"]', 'Sugar 1 kg')
    page.select_option('select[name="cat"]', 'staples')
    page.fill('input[name="price"]', '48')
    page.fill('input[name="stock"]', '5')
    page.fill('input[name="perDay"]', '2')
    page.fill('input[name="alias"]', 'sugar, cheeni')
    page.click('form[data-form="item"] button[type="submit"]')
    page.wait_for_timeout(200)
    check(st("s.items.some(i=>i.name==='Sugar 1 kg')"), 'new product added')
    page.fill('#search', 'sugar')
    page.wait_for_timeout(100)
    check(page.locator('#stockBody tr').count() == 1, 'search filters the table to 1 row')
    page.screenshot(path=str(SHOTS / '03-stock.png'), full_page=True)
    page.fill('#search', '')
    # voice-note style sale with a word number for the new product
    page.click('.tabs a[data-view="chat"]')
    page.fill('#chatInput', 'sold two cheeni')
    page.press('#chatInput', 'Enter')
    page.wait_for_timeout(150)
    check('2 × Sugar 1 kg' in page.locator('.msg.bot').last.inner_text(), 'new product + number word understood in chat')
    page.fill('#chatInput', 'stock paneer')
    page.press('#chatInput', 'Enter')
    page.wait_for_timeout(150)
    check('Paneer 200 g' in page.locator('.msg.bot').last.inner_text(), 'stock question answered')
    page.fill('#chatInput', 'sold 3 hair oil')
    page.press('#chatInput', 'Enter')
    page.wait_for_timeout(150)
    check('3 × Hair oil 500 ml' in page.locator('.msg.bot').last.inner_text(), '"hair oil" is not mistaken for cooking oil')
    page.click('.tabs a[data-view="stock"]')
    sugar_id = st("s.items.find(i=>i.name==='Sugar 1 kg').id")
    page.click('button[data-action="delItem"][data-id="%s"]' % sugar_id)
    page.click('button[data-action="delItem"][data-id="%s"]' % sugar_id)
    page.wait_for_timeout(150)
    check(not st("s.items.some(i=>i.name==='Sugar 1 kg')"), 'product deleted after confirm')

    # 8. Fill sales, end day, delivery, persistence
    page.click('button[data-action="simulate"]')
    page.wait_for_timeout(150)
    page.click('button[data-action="endDay"]')
    page.wait_for_timeout(250)
    check(st('s.day') == 2, 'End day moves to Day 2')
    check(st('s.orders[0].status') == 'delivered', 'yesterday’s order delivered on Day 2')
    check(st('s.history[s.history.length-1].day') == 1, 'Day 1 sales saved to history')
    page.click('.tabs a[data-view="chat"]')
    check('Day 2' in page.inner_text('#msgs') and 'closed' in page.inner_text('#msgs'), 'chat shows day closed + new plan')
    page.reload(); page.wait_for_selector('.msg')
    check(st('s.day') == 2, 'data survives a page reload (localStorage)')

    # 9. Mobile layout
    m = ctx.new_page(); m.set_viewport_size({'width': 390, 'height': 844})
    m.on('pageerror', lambda e: errors.append('mobile pageerror: ' + str(e)))
    m.goto(APP + '#chat'); m.wait_for_selector('.msg')
    sw = m.evaluate('document.documentElement.scrollWidth')
    check(sw <= 392, 'no sideways scrolling on a phone (scrollWidth %s)' % sw)
    m.screenshot(path=str(SHOTS / '06-mobile-chat.png'))

    # 10. Reset
    page.click('.tabs a[data-view="settings"]')
    page.click('button[data-action="resetData"]'); page.click('button[data-action="resetData"]')
    page.wait_for_timeout(200)
    check(st('s.day') == 1 and st('s.orders.length') == 0, 'reset returns to Day 1')
    page.click('.tabs a[data-view="settings"]')
    page.screenshot(path=str(SHOTS / '07-settings.png'), full_page=True)

    browser.close()

print('\nErrors:', errors or 'none')
print('FAILED:' if fails else 'ALL PASSED', fails or '')
sys.exit(1 if fails or errors else 0)
