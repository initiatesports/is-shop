# INITIATE SPORTS 官方網店

單一檔案網店（index.html），用 GitHub Pages 上線。訂單傳去 Google Apps Script「INITIATE 網店收單」，寫入試算表「INITIATE 網店訂單」。

## 預覽版（/preview/，隱藏網址，不公開連結）

圖片抽離及延遲載入的預覽版本，由正式 `index.html` 自動產生，正式頁面不受影響。

- 產生：`node tools/build-shop-preview.mjs`（正式 `index.html` 有改動後須重新執行，CI 會檢查是否同步）
- 守衛：`node tools/check-shop-preview.mjs`
- 端到端測試（Playwright，本機，不連接後端）：`node tools/qa-shop-preview.mjs`
- 模擬 4G 量度：`node tools/measure-shop-load.mjs`

預覽版加入 noindex，並攔截向收單後端提交訂單（只回覆 `PREVIEW-` 模擬編號），測試時不會產生真實訂單。
