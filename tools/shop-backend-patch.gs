/**
 * INITIATE 網店收單 — #11 app_shop 價目同步（2026-11-25 老闆：「確保兩邊一定一致」）
 * ════════════════════════════════════════════════════════════════════════════
 * 作用：網上商店（is-shop）網頁已改為讀取 #11 app_shop（教練 App「家長端 → 網店商品」）的價錢、早鳥價、原價、
 *       早鳥截止日及上架／下架。本檔令收單後端在落單時以「同一套規則、同一份價目」由伺服器重新核算金額，
 *       兩邊金額必定一致；套裝價、衛衣兩件或以上、運動襪 3 對等組合規則完全沿用現有 shopPrice_。
 *       讀不到 #11 或內容格式不符 → 沿用 SHOP_CATALOG 內建價目（與網頁後備相同）。
 *
 * 貼上步驟（Apps Script 編輯器，專案「INITIATE 網店收單」）：
 *  1. 新增指令碼檔案，命名 shopCms.gs，把本檔「全部內容」貼上（不要改動 SHOP-CMS-CORE 區段，須與網頁逐字相同）。
 *  2. 確認 SHOP_EARLY_END 是以 var 宣告（例如 var SHOP_EARLY_END = new Date('2026-12-01T23:59:59+08:00');）。
 *     如是 const／let，改為 var（本檔計價時會暫時套用早鳥截止日，計完即還原）。
 *  3. 在 shopOrder_ 內：
 *     (a) 建立 items 清單之後、取鎖（LockService）之前，加入：
 *           var hiddenErr = shopCmsHiddenError_(items); if (hiddenErr) return shopJson_({ ok: false, err: hiddenErr });
 *     (b) 把
 *           var price = shopPrice_(items, now);
 *         改為
 *           var price = shopPriceCms_(items, now, body.clientAmount);
 *     （其餘不變。shopPrice_ 本身毋須修改。）
 *  4. 如 appsscript.json 有列明 oauthScopes，加入 "https://www.googleapis.com/auth/script.external_request"。
 *  5. 在編輯器選 shopCmsSelfTest_ → 執行 → 按提示授權「連接外部服務」→ 查看執行記錄：應列出讀取到的覆寫價目，
 *     以及幾個購物車在「內建價目」與「#11 價目」下的金額（未設定 app_shop 時兩者相同）。
 *  6. 部署 → 管理部署 → 編輯現有部署 → 版本選「新版本」→ 部署（網址不變）。
 *
 * 快取：#11 價目快取 5 分鐘（CacheService）；網頁顯示金額與伺服器計算不同時，即時重新讀取 #11 一次再計算
 *       （例如教練剛更新價錢），伺服器金額仍為最終收費。#11 暫時讀不到時沿用最近一次成功讀取的價目（6 小時內），
 *       否則沿用內建價目。
 */
/* SHOP-CMS-CORE:BEGIN — 網店價目覆寫規則（#11 app_shop）。網店網頁 index.html 與網店收單後端（shop-backend-patch.gs）逐字相同，
   tools/check-shop-pricing.mjs 核對兩邊一致；只用 ES5，Apps Script 及瀏覽器皆可執行。修改時兩邊必須同步。
   規則：按商品代碼配對；早鳥價＋原價（皆為 1–50000 整數且早鳥價不高於原價）→ 按早鳥截止日選用；否則「價錢」→ 早鳥及原價相同；
   其餘情況沿用內建價目。運動襪按組合規則（單對／3 對）計價，不受覆寫。早鳥截止日 YYYY-MM-DD → 當日 23:59:59（香港時間）；
   空白 → 不設早鳥；欠缺或格式不符 → 沿用內建。hidden:true → 下架（網頁不顯示、後端不接受落單）。 */
var SHOP_CMS_URL = 'https://script.google.com/macros/s/AKfycbxzzac6FfgGka9220y26AqbCkN4AIMsFwCqB_G-X6tN0-5gzcBIQ60mAU4j-8npduEB/exec?action=home';
function shopCmsMoney_(v) { return typeof v === 'number' && isFinite(v) && v >= 1 && v <= 50000 && Math.floor(v) === v; }
function shopCmsParse_(home) {
  var rows = home && home.settings, raw = null, v = null, i, m, out, p, it, t;
  if (!rows || typeof rows.length !== 'number') return null;
  for (i = 0; i < rows.length; i++) if (rows[i] && rows[i].key === 'app_shop') { raw = rows[i].value; break; }
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch (e) { return null; } } else v = raw;
  if (!v || typeof v !== 'object' || v.v !== 1 || !v.products || typeof v.products.length !== 'number') return null;
  out = { earlyEnd: null, hasEnd: false, items: {} };
  if (typeof v.earlyUntil === 'string') {
    if (v.earlyUntil === '') { out.earlyEnd = 0; out.hasEnd = true; }
    else {
      m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.earlyUntil);
      if (m) { t = Date.UTC(+m[1], +m[2] - 1, +m[3], 15, 59, 59); if (new Date(t).getUTCDate() === +m[3] && new Date(t).getUTCMonth() === +m[2] - 1) { out.earlyEnd = t; out.hasEnd = true; } }
    }
  }
  for (i = 0; i < v.products.length; i++) {
    p = v.products[i];
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(p.id) || Object.prototype.hasOwnProperty.call(out.items, p.id)) continue;
    it = { hidden: p.hidden === true, early: null, regular: null };
    if (p.category !== 'socks' && !/^socks-/.test(p.id)) {
      if (shopCmsMoney_(p.price_early) && shopCmsMoney_(p.price_regular) && p.price_early <= p.price_regular) { it.early = p.price_early; it.regular = p.price_regular; }
      else if (shopCmsMoney_(p.price_hkd)) { it.early = p.price_hkd; it.regular = p.price_hkd; }
    }
    out.items[p.id] = it;
  }
  return out;
}
function shopCmsUnit_(ov, id, baseEarly, baseRegular) {
  var it = ov && ov.items && Object.prototype.hasOwnProperty.call(ov.items, id) ? ov.items[id] : null;
  return it && it.early != null && it.regular != null ? { early: it.early, regular: it.regular } : { early: baseEarly, regular: baseRegular };
}
function shopCmsEarlyEnd_(ov, baseEndMs) { return ov && ov.hasEnd ? ov.earlyEnd : baseEndMs; }
function shopCmsHidden_(ov, id) { return !!(ov && ov.items && Object.prototype.hasOwnProperty.call(ov.items, id) && ov.items[id].hidden); }
/* SHOP-CMS-CORE:END */

var SHOP_CMS_CACHE_KEY_ = 'shop_cms_ov_v1', SHOP_CMS_LAST_KEY_ = 'shop_cms_ov_last_v1';
/* 讀取 #11 app_shop 覆寫價目；fresh=true 時略過 5 分鐘快取。回傳 null＝沿用內建價目。 */
function shopCmsOverrides_(fresh) {
  var cache = null; try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }
  if (!fresh && cache) { var c = cache.get(SHOP_CMS_CACHE_KEY_); if (c) { try { return JSON.parse(c).ov; } catch (e) {} } }
  var ok = false, ov = null;
  try {
    var res = UrlFetchApp.fetch(SHOP_CMS_URL, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() === 200) {
      var home = JSON.parse(res.getContentText());
      if (home && home.settings && typeof home.settings.length === 'number') { ov = shopCmsParse_(home); ok = true; }
    }
  } catch (e) { ok = false; }
  if (ok) {
    var packed = JSON.stringify({ ov: ov });
    if (cache) { try { cache.put(SHOP_CMS_CACHE_KEY_, packed, 300); cache.put(SHOP_CMS_LAST_KEY_, packed, 21600); } catch (e) {} }
    return ov;
  }
  if (cache) { var last = cache.get(SHOP_CMS_LAST_KEY_); if (last) { try { return JSON.parse(last).ov; } catch (e) {} } }
  return null;
}
/* 以指定覆寫價目計價：暫時套用至 SHOP_CATALOG（每個 sku 的 early／regular）及 SHOP_EARLY_END，呼叫原有 shopPrice_，計完還原。 */
function shopPriceWith_(ov, items, now) {
  var saved = {}, savedEnd = SHOP_EARLY_END, sku;
  try {
    for (sku in SHOP_CATALOG) if (Object.prototype.hasOwnProperty.call(SHOP_CATALOG, sku)) {
      var c = SHOP_CATALOG[sku], u = shopCmsUnit_(ov, sku, c.early, c.regular);
      saved[sku] = { early: c.early, regular: c.regular }; c.early = u.early; c.regular = u.regular;
    }
    SHOP_EARLY_END = new Date(shopCmsEarlyEnd_(ov, savedEnd.getTime()));
    return shopPrice_(items, now);
  } finally {
    for (sku in saved) { SHOP_CATALOG[sku].early = saved[sku].early; SHOP_CATALOG[sku].regular = saved[sku].regular; }
    SHOP_EARLY_END = savedEnd;
  }
}
/* 取代 shopOrder_ 內的 shopPrice_(items, now)。clientAmount＝網頁顯示金額（只用作觸發重新讀取，絕不採用）。 */
function shopPriceCms_(items, now, clientAmount) {
  var price = shopPriceWith_(shopCmsOverrides_(false), items, now);
  if (clientAmount != null && clientAmount !== '' && isFinite(Number(clientAmount)) && Number(clientAmount) !== price.amount) price = shopPriceWith_(shopCmsOverrides_(true), items, now);
  return price;
}
/* 下架商品不接受落單：回傳錯誤訊息（書面語），全部可落單時回傳空字串。 */
function shopCmsHiddenError_(items) {
  var ov = shopCmsOverrides_(false), names = [], i, sku;
  for (i = 0; i < items.length; i++) { sku = items[i].sku; if (shopCmsHidden_(ov, sku)) { var n = (SHOP_CATALOG[sku] && SHOP_CATALOG[sku].name) || sku; if (names.indexOf(n) < 0) names.push(n); } }
  return names.length ? '「' + names.join('、') + '」已下架，請重新整理頁面後再選購' : '';
}
/* 編輯器手動執行：核對讀取結果及計價（不寫入任何資料）。 */
function shopCmsSelfTest_() {
  var ov = shopCmsOverrides_(true), now = new Date();
  Logger.log('#11 app_shop 覆寫：' + (ov ? JSON.stringify(ov) : '未設定或讀取失敗（沿用內建價目）'));
  var carts = [[{ sku: 'winter-ls-top', size: 'M', qty: 1 }, { sku: 'winter-jacket', size: 'M', qty: 1 }, { sku: 'jogger-pants', size: 'M', qty: 1 }],
    [{ sku: 'winter-jacket', size: 'S', qty: 2 }, { sku: 'jogger-pants', size: 'S', qty: 1 }], [{ sku: 'hoodie-2023', size: 'M', qty: 1 }], [{ sku: 'socks-1', size: '兒童均碼', qty: 4 }]];
  carts.forEach(function (items) {
    var valid = items.filter(function (it) { return SHOP_CATALOG[it.sku]; });
    if (valid.length !== items.length) return;
    Logger.log(JSON.stringify(items) + ' → 內建 HK$' + shopPriceWith_(null, valid, now).amount + '／#11 HK$' + shopPriceWith_(ov, valid, now).amount);
  });
}
