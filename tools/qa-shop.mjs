#!/usr/bin/env node
/* 網店網頁端到端測試（Playwright＋模擬後端；不連任何正式後端、不會落單）：
 *  #11 app_shop 價目套用（商品卡、套裝卡、衛衣、橫額、早鳥日期文字、下架）、購物車合計＝送出的 clientAmount、
 *  #11 不可用時沿用內建價目、售罄顯示照常。用法：node tools/qa-shop.mjs [截圖資料夾] */
import { createRequire } from 'node:module'; import { createServer } from 'node:http'; import { readFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const pw = (() => { for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node22/lib/node_modules/playwright']) { try { if (p) return require(p); } catch (e) {} } throw new Error('找不到 Playwright'); })();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), SHOTS = process.argv[2] || join(ROOT, '..', 'shots-shop'); await mkdir(SHOTS, { recursive: true });
const server = createServer(async (req, res) => { if (req.url.split('?')[0] !== '/' && req.url.split('?')[0] !== '/index.html') { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(await readFile(join(ROOT, 'index.html'))); });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const BASE = `http://localhost:${server.address().port}/`;
const CMS_ID = 'AKfycbxzzac6FfgGka9220y26AqbCkN4AIMsFwCqB_G-X6tN0-5gzcBIQ60mAU4j-8npduEB', SHOP_ID = 'AKfycbx-z8a_INdsP7xB4Sgki6kAyucooYGRvNRBD3dW-E6Y2ouwIfM3LI7xiazOaYhtiz1-';
let ST;
const CMS = { v: 1, earlyUntil: '2026-11-28', products: [
  { id: 'winter-ls-top', category: 'winter-kit', name_zh: '長袖（家長 App 名稱，不影響網店）', price_hkd: 110, price_early: 110, price_regular: 150 },
  { id: 'hoodie-2023', category: 'hoodie', name_zh: '衛衣', price_hkd: 189 },
  { id: 'gear-speedrope', category: 'gear', name_zh: '速度膠繩', price_hkd: 80, hidden: true },
  { id: 'socks-1', category: 'socks', name_zh: '襪', price_hkd: 45 }] };
async function wire(ctx) {
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.route('https://fonts.gstatic.com/**', r => r.fulfill({ status: 404, body: '' }));
  await ctx.route('https://script.google.com/**', async r => {
    const u = new URL(r.request().url()), m = r.request().method();
    if (u.pathname.includes(CMS_ID)) { ST.cmsReads++; if (ST.cmsDown) return r.abort('internetdisconnected'); return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ settings: [{ key: 'knowledge_posts', value: '[]' }].concat(ST.cms ? [{ key: 'app_shop', value: JSON.stringify(ST.cms) }] : []) }) }); }
    if (u.pathname.includes(SHOP_ID)) {
      if (m === 'GET' && u.searchParams.get('action') === 'soldout') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, soldout: ST.soldout }) });
      if (m === 'POST') { const b = JSON.parse(r.request().postData() || '{}'); ST.orders.push(b); return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'IS-S261125-001', amount: b.clientAmount }) }); }
    }
    r.fulfill({ status: 404, body: '' });
  });
}
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const browser = await pw.chromium.launch();
async function openAt(time, o) {
  ST = Object.assign({ cms: null, cmsDown: false, cmsReads: 0, soldout: [], orders: [] }, o || {});
  const ctx = await browser.newContext({ ...pw.devices['iPhone 13'], defaultBrowserType: undefined, locale: 'zh-HK', timezoneId: 'Asia/Hong_Kong' }); await wire(ctx);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e))); page._errs = errs;
  await page.clock.install({ time: new Date(time) });
  await page.goto(BASE); await page.waitForSelector('#gridKit .tile'); await page.waitForTimeout(600); return { ctx, page };
}
const tileText = (page, name) => page.locator('.tile', { hasText: name }).first().innerText();
async function addToCart(page, id, size, times) {
  await page.evaluate(i => openProduct(i), id); await page.waitForSelector('#pdDlg[open]');
  await page.locator(`#pdSizes input[value="${size}"]`).check({ force: true });
  for (let i = 1; i < (times || 1); i++) await page.click('#qPlus');
  await page.click('#addBtn'); await page.evaluate(() => document.getElementById('pdDlg').close());
}
try {
  console.log('# 未設定 app_shop：內建價目（早鳥期內）');
  let { ctx, page } = await openAt('2026-11-25T12:00:00+08:00');
  ok(/HK\$120/.test(await tileText(page, '冬季長袖訓練服')) && /12月2號起 HK\$140/.test(await tileText(page, '冬季長袖訓練服')), 'built-in early price + after-date');
  ok(/HK\$199/.test(await page.locator('[data-pprice="hoodie-2023"]').innerText()), 'built-in hoodie price');
  ok(/12月1號（星期二）晚上 11:59/.test(await page.locator('#sets').innerText()), 'built-in early-bird end text');
  ok(await page.locator('#gridGear .tile', { hasText: '速度膠繩' }).count() >= 1, 'gear listed');
  ok(page._errs.length === 0, 'no page errors ' + page._errs.join('|'));
  await ctx.close();

  console.log('# #11 app_shop：價錢、早鳥截止日、下架、售罄');
  ({ ctx, page } = await openAt('2026-11-25T12:00:00+08:00', { cms: CMS, soldout: [{ id: 'winter-jacket', size: 'M' }, ...['兒童均碼', '成人均碼'].map(size => ({ id: 'socks-2', size }))] }));
  await page.waitForFunction(() => /HK\$110/.test(document.getElementById('gridKit').innerText), null, { timeout: 5000 }).catch(() => {});
  const t1 = await tileText(page, '冬季長袖訓練服');
  ok(/HK\$110/.test(t1) && /11月29號起 HK\$150/.test(t1), 'CMS early price + new after-date on tile');
  ok(!/家長 App 名稱/.test(await page.locator('#gridKit').innerText()), 'product names stay as shop built-in');
  ok(/HK\$189/.test(await page.locator('[data-pprice="hoodie-2023"]').innerText()), 'CMS hoodie price');
  ok(await page.locator('#gridGear .tile', { hasText: /^速度膠繩/ }).count() === 0 && await page.locator('#gridGear .tile', { hasText: '速度膠繩替換繩芯' }).count() === 1, 'hidden product removed (others kept)');
  ok(/11月28號（星期六）晚上 11:59/.test(await page.locator('#sets').innerText()) && /11月29號起恢復原價/.test(await page.locator('#sets').innerText()), 'early-bird text follows CMS date');
  ok(/HK\$39/.test(await tileText(page, '運動襪・藍色雙槓')), 'socks single price fixed by pack rule');
  ok(await page.locator('.tile.so', { hasText: '運動襪・純白大標誌' }).count() === 1, 'sold-out marking still applied after re-render');
  await page.screenshot({ path: join(SHOTS, 'shop-cms-kit.png') });
  await page.evaluate(() => openProduct('winter-jacket')); await page.waitForSelector('#pdDlg[open]');
  ok(await page.locator('#pdSizes input[value="M"]').isDisabled(), 'sold-out size disabled in product dialog');
  ok(/早鳥優惠價至 11月28號/.test(await page.locator('#pdPrice').innerText()), 'product dialog early-bird date');
  await page.evaluate(() => document.getElementById('pdDlg').close());
  await page.evaluate(() => { location.search = '?p=gear-speedrope'; }); await page.waitForSelector('#gridKit .tile'); await page.waitForTimeout(800);
  ok(!(await page.locator('#pdDlg').evaluate(d => d.open)), 'deep link to hidden product does not open');
  // 購物車：合計與送出金額
  await addToCart(page, 'winter-ls-top', 'M'); await addToCart(page, 'winter-jacket', 'S'); await addToCart(page, 'jogger-pants', 'S');
  await addToCart(page, 'hoodie-2023', '120'); await addToCart(page, 'socks-1', '兒童均碼', 4);
  const expect = await page.evaluate(() => totals().grand);
  // 三件套 420＋衛衣 189＋襪 99+39 = 747
  ok(expect === 420 + 189 + 99 + 39, 'cart total uses CMS prices + fixed bundle rules (' + expect + ')');
  await page.click('#cartBtn'); await page.waitForSelector('#cartDlg[open]');
  ok(new RegExp('合計\\s*HK\\$' + expect).test(await page.locator('#totals').innerText()), 'cart shows same total');
  await page.screenshot({ path: join(SHOTS, 'shop-cms-cart.png') });
  await page.click('#toCheckout'); await page.fill('#vBuyer [name=student]', '測試學生'); await page.fill('#vBuyer [name=cls]', '星期六 10:00'); await page.fill('#vBuyer [name=phone]', '91234567'); await page.fill('#vBuyer [name=email]', 'test@example.com');
  await page.click('#vBuyer [type=submit]'); await page.check('#vPay [value=cash]'); await page.check('#vPay [name=agree]'); await page.click('#vPay [type=submit]'); await page.waitForSelector('#vDone:not([hidden])');
  ok(ST.orders.length === 1 && ST.orders[0].clientAmount === expect && JSON.parse(ST.orders[0].items).length === 5, 'order submitted with clientAmount = displayed total');
  ok(page._errs.length === 0, 'no page errors ' + page._errs.join('|'));
  await ctx.close();

  console.log('# 早鳥截止後（#11 日期）及 #11 不可用');
  ({ ctx, page } = await openAt('2026-11-29T09:00:00+08:00', { cms: CMS }));
  await page.waitForTimeout(500);
  ok(/HK\$150/.test(await tileText(page, '冬季長袖訓練服')) && !/早鳥/.test(await tileText(page, '冬季長袖訓練服')), 'after CMS early end → regular price');
  ok(/HK\$480/.test(await page.locator('[data-bundle="set3"] .now').innerText()) && await page.locator('#strip.static').count() === 1, 'bundles at regular price; strip static');
  await ctx.close();
  ({ ctx, page } = await openAt('2026-11-25T12:00:00+08:00', { cmsDown: true }));
  ok(/HK\$120/.test(await tileText(page, '冬季長袖訓練服')), '#11 unreachable → built-in prices');
  ok(page._errs.length === 0, 'no page errors ' + page._errs.join('|'));
  await ctx.close();
} catch (e) { fail++; console.error('FATAL', e); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
