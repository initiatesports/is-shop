#!/usr/bin/env node
/* 網店預覽版（/preview/）端到端測試：Playwright，本機伺服器，所有外部請求一律攔截（不會連接收單後端）。
 * 測試：首屏只載入少量圖片（延遲載入生效）、捲動後商品圖片載入、商品視窗、加入購物車、
 *       以虛構資料走完落單流程（現金付款，不上載任何檔案），確認預覽版攔截提交並顯示 PREVIEW 訂單編號。
 *   PLAYWRIGHT_PATH=... node tools/qa-shop-preview.mjs [截圖資料夾] */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pw = (() => { for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node22/lib/node_modules/playwright']) { try { if (p) return require(p); } catch (e) {} } throw new Error('找不到 Playwright'); })();
const { chromium, devices } = pw;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.argv[2] || join(ROOT, '..', 'shots');
await mkdir(SHOTS, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
  const f = join(ROOT, p); if (!f.startsWith(ROOT) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' }); res.end(await readFile(f));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const fails = [];
const check = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails.push(m); };
const browser = await chromium.launch();
const DEV = { iphone: devices['iPhone 13'], pixel: devices['Pixel 7'], desktop: { viewport: { width: 1366, height: 900 } } };

for (const [name, dev] of Object.entries(DEV)) {
  const ctx = await browser.newContext({ ...dev });
  const external = [], imgs = new Set();
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(BASE)) { if (/\/preview\/img\//.test(u)) imgs.add(u.split('?')[0]); return r.continue(); }
    external.push(r.request().method() + ' ' + u.split('?')[0]);
    if (/script\.google\.com/.test(u) && r.request().method() === 'GET') return r.fulfill({ contentType: 'application/json', body: '{"ok":true,"soldout":[]}' });
    return r.abort();
  });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/preview/', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const first = imgs.size;
  check(first > 0 && first <= 20, `${name}：首屏只載入 ${first} 張圖片（共 54 張）`);
  check(await page.locator('.pv-note').isVisible(), `${name}：顯示預覽版提示`);
  check(await page.evaluate(() => [...document.querySelectorAll('.hero-art img')].every(i => i.naturalWidth > 0)), `${name}：首屏主圖已顯示`);
  await page.screenshot({ path: join(SHOTS, `F-shop-preview-${name}.png`) });
  for (let y = 0; y < 12; y++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(120); }
  await page.waitForTimeout(500);
  check(imgs.size > first, `${name}：捲動後再載入商品圖片（${first} → ${imgs.size}）`);
  const broken = await page.evaluate(() => [...document.querySelectorAll('img')].filter(i => i.complete && i.getAttribute('src') && i.naturalWidth === 0 && i.loading !== 'lazy').map(i => i.getAttribute('src')));
  check(broken.length === 0, `${name}：沒有損壞圖片 ${broken.join(',')}`);

  if (name !== 'desktop') { await ctx.close(); check(errors.length === 0, `${name}：沒有 JavaScript 錯誤 ${errors.join(';')}`); continue; }

  /* 落單流程（虛構資料、現金付款） */
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('button.btn-primary[data-open="hoodie-2023"]').click();
  await page.waitForSelector('#pdDlg[open], dialog[open]');
  const size = page.locator('#pdSizes label:not(.so) input').first();
  await size.check({ force: true });
  await page.locator('#addBtn').click();
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await page.locator('#cartBtn').click();
  await page.screenshot({ path: join(SHOTS, 'F-shop-preview-cart.png') });
  await page.locator('#toCheckout').click();
  await page.fill('[name=student]', '陳示範');
  await page.fill('[name=cls]', '星期三 5–6pm 花式跳繩（測試）');
  await page.fill('[name=phone]', '91234567');
  await page.fill('[name=email]', 'preview@example.com');
  await page.locator('#vBuyer [type=submit]').click();
  await page.locator('[name=pay][value=cash]').check();
  await page.locator('[name=agree]').check();
  await page.locator('#vPay [type=submit]').click();
  await page.waitForSelector('#vDone:not([hidden])', { timeout: 10000 });
  const no = await page.locator('#orderNo').textContent();
  check(/^PREVIEW-/.test(no || ''), `desktop：預覽版落單只回覆模擬編號（${no}）`);
  check(!external.some(x => x.startsWith('POST')), 'desktop：沒有任何 POST 請求離開本機（未向收單後端提交）');
  await page.screenshot({ path: join(SHOTS, 'F-shop-preview-done.png') });
  check(errors.length === 0, `${name}：沒有 JavaScript 錯誤 ${errors.join(';')}`);
  await ctx.close();
}
await browser.close(); server.close();
if (fails.length) { console.error(`\n✗ ${fails.length} 項未通過`); process.exit(1); }
console.log('\n✓ 網店預覽版測試全部通過');
