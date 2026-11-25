#!/usr/bin/env node
/* 網店價錢「兩邊一定一致」核對（不連任何正式後端）：
 *  1. 網頁 index.html 與網店收單後端修補檔 tools/shop-backend-patch.gs 的 SHOP-CMS-CORE 區段逐字相同；
 *  2. 以同一批購物車及同一份 #11 app_shop，分別執行網頁計價 totals() 及後端 shopPriceCms_()（套用於舊版 shopPrice_ 快照），
 *     金額必須完全相同（包括冬季套裝組合、衛衣兩件或以上、運動襪 3 對、早鳥／原價切換、#11 不可用時沿用內建價目）；
 *  3. 覆寫規則：格式不符的價錢不採用、運動襪單價不受覆寫、下架商品後端拒絕落單、快取及網頁金額不符時重新讀取。
 * 用法：node tools/check-shop-pricing.mjs */
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';
const R = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = R('index.html'), gs = R('tools/shop-backend-patch.gs'), snap = R('tools/fixtures/shop-order-pricing.snapshot.gs');
const core = src => { const a = src.indexOf('/* SHOP-CMS-CORE:BEGIN'), b = src.indexOf('/* SHOP-CMS-CORE:END */'); assert(a >= 0 && b > a, 'core markers'); return src.slice(a, b); };
assert.equal(core(html), core(gs), 'SHOP-CMS-CORE 區段必須逐字相同（網頁與後端）');

/* ── 網頁計價：PRODUCTS＋SHOP-PRICING 區段 ── */
const prodLine = html.match(/^const PRODUCTS = (\[.*\]);$/m)[1];
const pricing = html.slice(html.indexOf('/* SHOP-PRICING:BEGIN'), html.indexOf('/* SHOP-PRICING:END */'));
assert(/function totals\(list\)/.test(pricing) && /const BUNDLES = /.test(pricing) && /function shopApplyPricing\(/.test(pricing), 'pricing block complete');
const fe = vm.createContext({ JSON, Date, Math, Object, Array, String, Number, isFinite });
vm.runInContext(`const PRODUCTS = ${prodLine}; let cart = [];\n${pricing}\nthis.api = { totals, shopApplyPricing, shopCmsParse_, PRODUCTS, BUNDLES, get EARLY() { return EARLY; } };`, fe);
const F = fe.api;
const feTotal = (ov, items, now) => { F.shopApplyPricing(ov, now.getTime()); return F.totals(items.map(i => ({ id: i.sku, size: i.size, qty: i.qty }))).grand; };

/* ── 後端計價：舊版快照＋修補檔，模擬 UrlFetchApp／CacheService ── */
let homeResp = null, fetches = 0, cacheStore = {};
const be = vm.createContext({ JSON, Date, Math, Object, Array, String, Number, isFinite, Logger: { log() {} },
  UrlFetchApp: { fetch() { fetches++; if (homeResp === 'down') throw Error('down'); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(homeResp) }; } },
  CacheService: { getScriptCache: () => ({ get: k => cacheStore[k] ?? null, put: (k, v) => { cacheStore[k] = v; } }) } });
vm.runInContext(snap + '\n' + gs, be);
const beTotal = (items, now, client) => vm.runInContext('shopPriceCms_', be)(items, now, client).amount;

const shopRow = v => ({ settings: [{ key: 'knowledge_posts', value: '[]' }, { key: 'app_shop', value: JSON.stringify(v) }] });
const prods = (over) => ['winter-ls-top', 'winter-jacket', 'jogger-pants', 'hoodie-2023', 'socks-1', 'socks-2', 'socks-3', 'socks-4'].map(id => Object.assign({ id, category: /^socks/.test(id) ? 'socks' : id === 'hoodie-2023' ? 'hoodie' : 'winter-kit', name_zh: id }, over[id] || {}));
const SCEN = {
  'no app_shop (built-in)': { settings: [{ key: 'knowledge_posts', value: '[]' }] },
  'app_shop same as built-in': shopRow({ v: 1, earlyUntil: '2026-12-01', products: prods({ 'winter-ls-top': { price_hkd: 120, price_early: 120, price_regular: 140 }, 'winter-jacket': { price_hkd: 199, price_early: 199, price_regular: 230 }, 'jogger-pants': { price_hkd: 180, price_early: 180, price_regular: 200 }, 'hoodie-2023': { price_hkd: 199 }, 'socks-1': { price_hkd: 39 } }) }),
  'coach changed prices + earlier early-bird end': shopRow({ v: 1, earlyUntil: '2026-11-28', products: prods({ 'winter-ls-top': { price_hkd: 110, price_early: 110, price_regular: 150 }, 'winter-jacket': { price_early: 210, price_regular: 250 }, 'jogger-pants': { price_hkd: 170 }, 'hoodie-2023': { price_hkd: 189 }, 'socks-1': { price_hkd: 45, price_early: 30, price_regular: 45 } }) }),
  'early-bird removed (blank date)': shopRow({ v: 1, earlyUntil: '', products: prods({ 'winter-ls-top': { price_early: 110, price_regular: 150 }, 'hoodie-2023': { price_hkd: 215 } }) }),
  'invalid values ignored (fallback per item)': shopRow({ v: 1, earlyUntil: '2026-02-31', products: prods({ 'winter-ls-top': { price_early: 0, price_regular: 140.5 }, 'winter-jacket': { price_early: 260, price_regular: 230 }, 'jogger-pants': { price_hkd: '150' }, 'hoodie-2023': { price_hkd: 99999 } }) }),
  'malformed app_shop': { settings: [{ key: 'app_shop', value: '{bad json' }] },
  'wrong version': shopRow({ v: 2, products: prods({ 'winter-ls-top': { price_hkd: 1 } }) })
};
const it = (sku, qty, size) => ({ sku, size: size || (/^socks/.test(sku) ? '兒童均碼' : 'M'), qty });
const CARTS = [
  [it('winter-ls-top', 1), it('winter-jacket', 1), it('jogger-pants', 1)],
  [it('winter-ls-top', 2), it('winter-jacket', 1), it('jogger-pants', 3)],
  [it('winter-jacket', 2), it('jogger-pants', 1)],
  [it('winter-ls-top', 1)], [it('jogger-pants', 2), it('winter-ls-top', 1)],
  [it('hoodie-2023', 1)], [it('hoodie-2023', 3)],
  [it('socks-1', 1)], [it('socks-1', 2), it('socks-2', 2)], [it('socks-3', 7)],
  [it('winter-ls-top', 3), it('winter-jacket', 2), it('jogger-pants', 2), it('hoodie-2023', 2), it('socks-1', 4), it('socks-4', 1)]
];
const TIMES = ['2026-11-25T12:00:00+08:00', '2026-11-28T23:59:59+08:00', '2026-11-29T00:00:00+08:00', '2026-12-01T23:59:59+08:00', '2026-12-02T00:00:01+08:00'].map(t => new Date(t));
let n = 0;
for (const [label, home] of Object.entries(SCEN)) {
  const ov = F.shopCmsParse_(home);
  for (const now of TIMES) for (const items of CARTS) {
    homeResp = home; cacheStore = {};
    const a = feTotal(ov, items, now), b = beTotal(items, now, a);
    assert.equal(a, b, `${label} @ ${now.toISOString()} ${JSON.stringify(items)}：網頁 ${a} ≠ 後端 ${b}`); n++;
  }
}
/* 規則抽查（網頁與後端同值，且數值符合預期） */
const chk = (home, now, items, want, msg) => { homeResp = home; cacheStore = {}; const ov = F.shopCmsParse_(home), a = feTotal(ov, items, new Date(now)), b = beTotal(items, new Date(now), a); assert.equal(a, want, msg + ' 網頁'); assert.equal(b, want, msg + ' 後端'); };
chk(SCEN['no app_shop (built-in)'], '2026-11-25T12:00:00+08:00', CARTS[0], 420, '內建早鳥三件套');
chk(SCEN['no app_shop (built-in)'], '2026-12-02T00:00:01+08:00', CARTS[0], 480, '內建原價三件套');
chk(SCEN['coach changed prices + earlier early-bird end'], '2026-11-25T12:00:00+08:00', [it('winter-ls-top', 1)], 110, '#11 早鳥價');
chk(SCEN['coach changed prices + earlier early-bird end'], '2026-11-29T00:00:00+08:00', [it('winter-ls-top', 1)], 150, '#11 早鳥截止日（11-28 23:59:59 後即原價）');
chk(SCEN['coach changed prices + earlier early-bird end'], '2026-11-25T12:00:00+08:00', [it('hoodie-2023', 1)], 189, '#11 衛衣單件價');
chk(SCEN['coach changed prices + earlier early-bird end'], '2026-11-25T12:00:00+08:00', [it('hoodie-2023', 2)], 358, '衛衣兩件或以上固定每件 179');
chk(SCEN['coach changed prices + earlier early-bird end'], '2026-11-25T12:00:00+08:00', [it('socks-1', 4)], 99 + 39, '運動襪單價不受覆寫（3 對 99＋1 對 39）');
chk(SCEN['early-bird removed (blank date)'], '2026-11-25T12:00:00+08:00', [it('winter-ls-top', 1)], 150, '早鳥截止日留空＝不設早鳥');
chk(SCEN['invalid values ignored (fallback per item)'], '2026-11-25T12:00:00+08:00', [it('winter-ls-top', 1), it('winter-jacket', 1), it('jogger-pants', 1), it('hoodie-2023', 1)], 420 + 199, '不合規格的價錢及日期沿用內建');

/* 下架：網頁不顯示、後端拒絕落單 */
const hid = shopRow({ v: 1, products: prods({ 'hoodie-2023': { price_hkd: 199, hidden: true } }) });
F.shopApplyPricing(F.shopCmsParse_(hid), Date.now()); assert.equal(F.PRODUCTS.find(p => p.id === 'hoodie-2023').hidden, true);
homeResp = hid; cacheStore = {};
assert.match(vm.runInContext('shopCmsHiddenError_', be)([it('hoodie-2023', 1)]), /已下架/);
assert.equal(vm.runInContext('shopCmsHiddenError_', be)([it('winter-ls-top', 1)]), '');
/* 網頁 gear 商品亦按 #11 價錢（後端如以 SHOP_CATALOG 計價即一致） */
F.shopApplyPricing(F.shopCmsParse_(shopRow({ v: 1, products: [{ id: 'gear-speedrope', category: 'gear', name_zh: 'x', price_hkd: 85 }] })), Date.now());
assert.equal(F.totals([{ id: 'gear-speedrope', size: '白柄・白芯', qty: 2 }]).grand, 170);

/* 後端快取：5 分鐘內不重複讀取；網頁金額不同時即時重新讀取一次；#11 讀不到時沿用最近成功價目，再不然沿用內建 */
const cms1 = SCEN['coach changed prices + earlier early-bird end'], now = new Date('2026-11-25T12:00:00+08:00'), one = [it('winter-ls-top', 1)];
cacheStore = {}; fetches = 0; homeResp = cms1;
assert.equal(beTotal(one, now), 110); assert.equal(beTotal(one, now), 110); assert.equal(fetches, 1, '快取命中');
homeResp = shopRow({ v: 1, products: prods({ 'winter-ls-top': { price_early: 105, price_regular: 150 } }) });
assert.equal(beTotal(one, now, 110), 110, '網頁金額與快取一致 → 不重新讀取'); assert.equal(fetches, 1);
assert.equal(beTotal(one, now, 105), 105, '教練剛更新價錢：網頁金額不同 → 重新讀取後一致'); assert.equal(fetches, 2);
assert.equal(beTotal(one, now, 1), 105, '網頁金額被改動亦只會採用伺服器價目');
homeResp = 'down'; delete cacheStore.shop_cms_ov_v1; assert.equal(beTotal(one, now), 105, '#11 暫時讀不到 → 沿用最近成功價目');
cacheStore = {}; assert.equal(beTotal(one, now), 120, '#11 讀不到且無記錄 → 內建價目');
/* 計價後 SHOP_CATALOG／SHOP_EARLY_END 還原 */
assert.equal(vm.runInContext('SHOP_CATALOG["winter-ls-top"].early + "/" + SHOP_CATALOG["winter-ls-top"].regular + "/" + SHOP_EARLY_END.toISOString()', be), '120/140/2026-12-01T15:59:59.000Z');
console.log(`✓ 網店價錢：SHOP-CMS-CORE 兩邊逐字相同；${n} 組（購物車×價目×時間）網頁與後端金額完全一致；套裝／衛衣／運動襪規則、早鳥切換、格式不符沿用內建、下架拒絕落單、後端快取及重新讀取均通過`);
