# INITIATE SPORTS 官方網店

單一檔案網店（index.html），用 GitHub Pages 上線。訂單傳去 Google Apps Script「INITIATE 網店收單」，寫入試算表「INITIATE 網店訂單」。

## 價目同步（2026-11-25）

- 網頁讀取 #11 `app_shop`（教練 App「家長端 → 網店商品」）：按商品代碼套用早鳥價、原價、價錢、早鳥截止日及上架／下架；讀不到時沿用 index.html 內建價目。套裝、衛衣兩件或以上、運動襪及跳繩袋組合價屬固定規則。
- 網店收單後端須貼上 `tools/shop-backend-patch.gs`（步驟見檔案開首），以同一規則於落單時由伺服器核算。
- 測試：`node tools/check-shop-pricing.mjs`（網頁與後端金額逐一核對）、`node tools/qa-shop.mjs`（Playwright，模擬後端）。
