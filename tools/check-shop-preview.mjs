#!/usr/bin/env node
/* 網店預覽版守衛（CI）：
 * - preview/index.html 必須 noindex，並有「預覽版」提示及訂單提交攔截（PREVIEW-GUARD）
 * - 預覽版不可再有大型內嵌 base64 圖片；所有 img/ 引用檔案必須存在
 * - 非首屏圖片必須 loading="lazy"
 * - 正式 index.html 不可連結到 preview/（隱藏網址）
 * - 預覽提示條只用淺色底；文字為書面語 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = join(ROOT, 'preview', 'index.html');
const errs = [];
const ok = (c, m) => { if (!c) errs.push(m); };

ok(existsSync(P), '缺少 preview/index.html');
const html = existsSync(P) ? readFileSync(P, 'utf8') : '';
const prod = readFileSync(join(ROOT, 'index.html'), 'utf8');

ok(/<meta name="robots" content="noindex[^"]*">/.test(html), '預覽版缺少 noindex');
ok(html.includes('PREVIEW-GUARD'), '預覽版缺少訂單提交攔截');
const g = html.indexOf('PREVIEW-GUARD'), api = html.indexOf("const API = 'https://script.google.com");
ok(g > -1 && api > -1 && g < api, '訂單攔截必須在網店程式之前載入');
ok(/class="pv-note"/.test(html), '預覽版缺少頂部提示');
ok(!/data:image\/[\w+.-]+;base64,[A-Za-z0-9+/=]{2000,}/.test(html), '預覽版仍有大型內嵌圖片');
ok(Buffer.byteLength(html) < 300 * 1024, `預覽版 HTML 過大（${Buffer.byteLength(html)} bytes）`);

const refs = new Set([...html.matchAll(/["(](img\/[\w.-]+)(?:\?v=[0-9a-f]{8})?["')]/g)].map(m => m[1]));
ok(refs.size >= 20, `預覽版圖片引用數量異常（${refs.size}）`);
for (const r of refs) ok(existsSync(join(ROOT, 'preview', r)), `找不到 preview/${r}`);

for (const m of html.matchAll(/<img\b[^>]*\bdata-img="[^"]+"[^>]*>/g)) {
  const t = m[0];
  if (/fetchpriority="high"/.test(t)) continue;
  ok(/loading="lazy"/.test(t), `非首屏圖片未延遲載入：${t.slice(0, 80)}`);
}
ok(!/preview\//.test(prod), '正式 index.html 不可連結到 preview/');

const note = (html.match(/<div class="pv-note"[^>]*>[^<]*<\/div>/) || [''])[0];
const bg = (note.match(/background:(#[0-9A-Fa-f]{6})/) || [])[1];
if (bg) { const n = parseInt(bg.slice(1), 16), l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)); ok(l > 200, `提示條底色過深（${bg}）`); }
ok(!/[嘅唔咗喺啲佢冇嚟]/.test(note), '提示條須用書面語');

if (errs.length) { console.error('✗ ' + errs.join('\n✗ ')); process.exit(1); }
console.log(`✓ 網店預覽版守衛通過（${refs.size} 個圖片檔案）`);
