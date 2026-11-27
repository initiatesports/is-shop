# INITIATE SPORTS 官方網店

網店用 GitHub Pages 上線。2026-11-27 起原始檔（內嵌圖片）在 `tools/shop-src/index.html`；正式 `index.html`（圖片抽離、延遲載入、結帳穩定性修正 `shopfix.js`）及預覽版均由 `node tools/build-shop-preview.mjs` 產生，請只改原始檔再重新產生（CI 會檢查同步）。家長 App 商品快照：`python3 tools/build-app-shop.py <is-shop>/tools/shop-src/index.html`。訂單傳去 Google Apps Script「INITIATE 網店收單」，寫入試算表「INITIATE 網店訂單」。

## 預覽版（/preview/，隱藏網址，不公開連結）

圖片抽離及延遲載入的預覽版本，由正式 `index.html` 自動產生，正式頁面不受影響。

- 產生：`node tools/build-shop-preview.mjs`（正式 `index.html` 有改動後須重新執行，CI 會檢查是否同步）
- 守衛：`node tools/check-shop-preview.mjs`
- 端到端測試（Playwright，本機，不連接後端）：`node tools/qa-shop-preview.mjs`
- 模擬 4G 量度：`node tools/measure-shop-load.mjs`

預覽版加入 noindex，並攔截向收單後端提交訂單（只回覆 `PREVIEW-` 模擬編號），測試時不會產生真實訂單。
