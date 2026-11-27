#!/usr/bin/env node
/* 網店預覽版產生器：由正式 index.html 產生 /preview/（圖片抽離成獨立檔案＋延遲載入）。
 *
 *   node tools/build-shop-preview.mjs           產生 preview/index.html 及 preview/img/*
 *   node tools/build-shop-preview.mjs --check   只檢查 preview/ 是否與目前 index.html 同步（CI 使用）
 *
 * 規則：
 * 1. 正式 index.html 一律不改；預覽版只是「同一份網店、圖片改為外部檔案」。
 * 2. index.html 內所有 data:image/...;base64 圖片抽出為 preview/img/<名稱>.<webp|jpg|png>，
 *    檔名後加內容雜湊 ?v=xxxxxxxx，日後圖片更新會自動換網址（瀏覽器可長期快取）。
 * 3. 首屏三張主圖保持即時載入（fetchpriority="high"），其餘 <img data-img> 加 loading="lazy" decoding="async"，
 *    並在 HTML 直接寫入 src，令瀏覽器預載掃描器可提早發現首屏圖片。
 * 4. 預覽版加 noindex、頂部「預覽版」提示條，並攔截向收單後端提交訂單（POST），
 *    改為模擬回覆，確保測試時不會產生真實訂單；讀取售罄狀態（GET）照常。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'index.html');
const OUT = join(ROOT, 'preview');
const IMG = join(OUT, 'img');
const CHECK = process.argv.includes('--check');

const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
const HERO = new Set(['jacket_front.png', 'tee_front.png', 'hoodie_render.png']);

export function build(html) {
  const files = new Map();          // 檔名 → Buffer
  const byHash = new Map();         // 內容雜湊 → 相對路徑（相同圖片只存一份）
  const save = (base, mime, b64) => {
    const buf = Buffer.from(b64, 'base64');
    const h = createHash('sha256').update(buf).digest('hex').slice(0, 8);
    if (byHash.has(h)) return byHash.get(h);
    const safe = base.replace(/\.(png|jpe?g|webp|gif)$/i, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'img';
    let name = `${safe}.${EXT[mime] || 'bin'}`;
    for (let i = 2; files.has(name); i++) name = `${safe}-${i}.${EXT[mime] || 'bin'}`;
    files.set(name, buf);
    const rel = `img/${name}?v=${h}`;
    byHash.set(h, rel);
    return rel;
  };

  /* 1) JS 圖片表 const IMAGES = {...}：逐項抽出 */
  const m = html.match(/const IMAGES = (\{[\s\S]*?\});\n/);
  if (!m) throw new Error('找不到 const IMAGES = {...}');
  const table = JSON.parse(m[1]);
  const paths = {};
  for (const [k, v] of Object.entries(table)) {
    const d = /^data:([\w/+.-]+);base64,(.+)$/s.exec(v);
    paths[k] = d ? save(k, d[1], d[2]) : v;
  }
  let out = html.replace(m[0], () => `const IMAGES = ${JSON.stringify(paths)};\n`);

  /* 2) 其餘內嵌圖片（標誌、客服頭像等） */
  let n = 0;
  out = out.replace(/<img([^>]*?)src="data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)"/g, (all, pre, mime, b64, off, whole) => {
    const cls = /class="([^"]+)"/.exec(pre);
    const near = whole.slice(Math.max(0, off - 200), off);
    const base = cls ? cls[1].split(/\s+/)[0] : /class="cs-hd"/.test(near) ? 'cs-avatar' : `inline-${++n}`;
    return `<img${pre}src="${save(base, mime, b64)}"`;
  });
  if (/data:image\/[\w+.-]+;base64,[A-Za-z0-9+/=]{2000,}/.test(out)) throw new Error('仍有大型內嵌圖片未抽離');

  /* 3) 靜態 <img data-img>：直接寫入 src；首屏主圖即時載入，其餘延遲載入 */
  out = out.replace(/<img\b([^>]*?)\bdata-img="([^"]+)"([^>]*)>/g, (all, a, key, b) => {
    let attrs = (a + b).replace(/\s*\bsrc="[^"]*"/, '').replace(/\s*\b(loading|decoding|fetchpriority)="[^"]*"/g, '');
    const src = paths[key] || '';
    const extra = HERO.has(key) && /class="[abc]"/.test(attrs) ? ' fetchpriority="high" decoding="async"' : ' loading="lazy" decoding="async"';
    attrs = attrs.replace(/\s{2,}/g, ' ').replace(/\s+$/, '');
    return `<img${attrs} src="${src}" data-img="${key}"${extra}>`;
  });
  /* 購物車縮圖亦延遲載入 */
  out = out.replace('li.innerHTML = `<img alt="" src="${img(p.images[0])}">', 'li.innerHTML = `<img alt="" loading="lazy" decoding="async" src="${img(p.images[0])}">');

  /* 4) noindex＋預覽提示＋攔截提交訂單 */
  if (!out.includes('<meta name="viewport"')) throw new Error('找不到 viewport meta');
  out = out.replace(/(<meta name="viewport"[^>]*>)/, `$1\n<meta name="robots" content="noindex, nofollow, noarchive">\n<meta name="googlebot" content="noindex, nofollow">`);
  out = out.replace(/<title>([^<]*)<\/title>/, '<title>$1（預覽版）</title>');
  const guard = `<script>/* PREVIEW-GUARD：預覽版不會向收單後端提交訂單，只回覆模擬結果 */
(function () {
  var real = window.fetch.bind(window);
  window.fetch = function (url, opt) {
    var u = String(url && url.url || url || ''), m = String(opt && opt.method || 'GET').toUpperCase();
    if (m !== 'GET' && /script\\.google(usercontent)?\\.com/.test(u)) {
      return new Promise(function (res) { setTimeout(function () {
        res(new Response(JSON.stringify({ ok: true, id: 'PREVIEW-' + Date.now().toString(36).toUpperCase(), amount: null, preview: true }), { headers: { 'Content-Type': 'application/json' } }));
      }, 600); });
    }
    return real(url, opt);
  };
})();
</script>`;
  const banner = `<div class="pv-note" role="note" style="background:#EAF6F8;color:#0F1A28;border-bottom:1px solid #BFE3EA;font:500 13px/1.5 'Noto Sans HK',sans-serif;text-align:center;padding:8px 16px">預覽版：只供測試，提交訂單不會送出，亦不會收取款項。</div>`;
  out = out.replace(/<body([^>]*)>/, (all) => `${all}\n${guard}\n${banner}`);
  // 結帳穩定性修正（2026-11-27）：只注入預覽版，老闆批准後才併入正式 index.html
  out = out.replace('</body>', '<script src="../shopfix.js"></script>\n</body>');
  if (!out.includes('shopfix.js')) throw new Error('未能加入 shopfix.js');
  if (!out.includes('PREVIEW-GUARD')) throw new Error('未能加入訂單攔截');
  return { html: out, files };
}

const src = readFileSync(SRC, 'utf8');
const { html, files } = build(src);

if (CHECK) {
  const errs = [];
  const cur = existsSync(join(OUT, 'index.html')) ? readFileSync(join(OUT, 'index.html'), 'utf8') : '';
  if (cur !== html) errs.push('preview/index.html 與目前 index.html 不同步：請執行 node tools/build-shop-preview.mjs');
  for (const [name, buf] of files) {
    const p = join(IMG, name);
    if (!existsSync(p) || !readFileSync(p).equals(buf)) errs.push(`preview/img/${name} 缺少或內容不同`);
  }
  const extra = existsSync(IMG) ? readdirSync(IMG).filter(f => !files.has(f)) : [];
  for (const f of extra) errs.push(`preview/img/${f} 已無引用，請重新產生`);
  if (errs.length) { console.error('✗ ' + errs.join('\n✗ ')); process.exit(1); }
  console.log(`✓ preview/ 與 index.html 同步（${files.size} 張圖片）`);
} else {
  rmSync(IMG, { recursive: true, force: true });
  mkdirSync(IMG, { recursive: true });
  for (const [name, buf] of files) writeFileSync(join(IMG, name), buf);
  writeFileSync(join(OUT, 'index.html'), html);
  const total = [...files.values()].reduce((s, b) => s + b.length, 0);
  console.log(`✓ preview/index.html ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB；${files.size} 張圖片共 ${(total / 1024).toFixed(1)} KB`);
}
