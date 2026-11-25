#!/usr/bin/env node
/* 量度正式版（index.html）與預覽版（preview/index.html）在模擬 4G 下的載入時間。
 * 只在本機伺服器量度；所有外部請求（字型、收單後端）一律攔截，兩版條件相同，不會連接正式後端。
 *
 *   PLAYWRIGHT_PATH=/opt/node22/lib/node_modules/playwright node tools/measure-shop-load.mjs [截圖資料夾]
 *
 * 網絡設定（Chrome DevTools Protocol Network.emulateNetworkConditions）：
 *   慢速 4G（Lighthouse 流動裝置標準）：下載 1.6 Mbps、上載 750 kbps、延遲 150 ms
 *   一般 4G：下載 9 Mbps、上載 1.5 Mbps、延遲 60 ms
 * 每項量度 3 次（全新瀏覽器環境、停用快取），取中位數。 */
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
const SHOTS = process.argv[2] || '';
if (SHOTS) await mkdir(SHOTS, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
  const f = join(ROOT, p); if (!f.startsWith(ROOT) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(await readFile(f));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const NETS = {
  '慢速 4G': { latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 },
  '一般 4G': { latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 }
};
const PAGES = { '正式版 index.html': '/index.html', '預覽版 preview/': '/preview/' };
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const browser = await chromium.launch();
async function once(path, net, shot) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  await ctx.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...net });
  let bytes = 0, reqs = 0;
  cdp.on('Network.loadingFinished', e => { bytes += e.encodedDataLength; reqs++; });
  await page.addInitScript(() => {
    window.__lcp = 0; window.__hero = 0;
    const tick = () => {
      const im = [...document.querySelectorAll('.hero-art img')];
      if (im.length && im.every(i => i.complete && i.naturalWidth > 0)) { window.__hero = performance.now(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  const t0 = Date.now();
  await page.goto(BASE + path, { waitUntil: 'load', timeout: 180000 });
  const wall = Date.now() - t0;
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    const fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0;
    const hero = [...document.querySelectorAll('.hero-art img')].every(i => i.complete && i.naturalWidth > 0);
    return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, fcp, lcp: window.__lcp, heroAt: window.__hero, hero };
  });
  const loadBytes = bytes, loadReqs = reqs;
  if (shot) await page.screenshot({ path: shot });
  await ctx.close();
  return { ...m, wall, bytes: loadBytes, reqs: loadReqs };
}

const rows = [];
for (const [netName, net] of Object.entries(NETS)) {
  for (const [pageName, path] of Object.entries(PAGES)) {
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await once(path, net, SHOTS && i === 0 && netName === '慢速 4G' ? join(SHOTS, `F-shop-${path === '/index.html' ? 'prod' : 'preview'}-pixel.png`) : ''));
    const k = f => median(runs.map(r => r[f]));
    rows.push({ net: netName, page: pageName, fcp: k('fcp'), heroAt: k('heroAt'), dcl: k('dcl'), load: k('load'), bytes: k('bytes'), reqs: k('reqs'), hero: runs.every(r => r.hero) });
  }
}
await browser.close(); server.close();

const s = ms => (ms / 1000).toFixed(2) + ' 秒';
const kb = b => (b / 1024).toFixed(0) + ' KB';
const size = f => statSync(join(ROOT, f)).size;
console.log(`\n檔案大小：正式 index.html ${kb(size('index.html'))}；預覽 preview/index.html ${kb(size('preview/index.html'))}\n`);
console.log('| 網絡 | 頁面 | 首次內容繪製 FCP | 首屏主圖顯示 | 可操作（DOMContentLoaded，網店程式已執行） | load 完成 | 載入期間傳輸量 | 請求數 |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.net} | ${r.page} | ${s(r.fcp)} | ${s(r.heroAt)} | ${s(r.dcl)} | ${s(r.load)} | ${kb(r.bytes)} | ${r.reqs} |`);
if (rows.some(r => !r.hero)) { console.error('✗ 有版本首屏主圖未能顯示'); process.exit(1); }
