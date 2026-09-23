# AFTERLIGHT — 最後一盞燈

雨夜裡的俯視角生存射擊網頁遊戲。移動、瞄準、擊退影子，撐到黎明。

## 開始遊玩

直接用瀏覽器開啟 `index.html` 即可，無需安裝或建置。也可以用 VS Code 的 Live Server 等靜態伺服器開啟。

## 操作

- **移動：** WASD 或方向鍵
- **瞄準：** 移動滑鼠
- **射擊：** 按住滑鼠左鍵或空白鍵
- **手機／平板：** 左下搖桿移動，右下按鈕射擊
- **重新開始：** 遊戲結束後按 Enter

## 多人連線設定

遊戲已包含 6 位房間碼、Presence 玩家狀態、房主開始同步，以及玩家移動／射擊和敵人事件的即時 Broadcast。多人房間使用 Supabase Realtime；沒設定服務時仍可玩單人模式。

1. 建立免費 [Supabase 專案](https://supabase.com/dashboard)。
2. 在專案的 Connect/API Keys 區複製 Project URL 和 **publishable key**（舊專案也可用 anon key；不可使用 service_role/secret key）。
3. 複製 `config.example.js` 為 `config.js`，填入 `url` 和 `anonKey`。
4. 連線設定不能提交在公開儲存庫中。若在本機使用，直接打開已設定的網站；若要讓 Pages 公開網站啟用多人，請在儲存庫 Settings → Secrets and variables → Actions 加入 `AFTERLIGHT_SUPABASE_URL` 和 `AFTERLIGHT_SUPABASE_ANON_KEY`，並把這兩個值帶入 Pages 部署前的 `config.js` 產生步驟。

按「建立房間」分享顯示的 6 位碼，其他玩家輸入同一房間碼並選擇「加入」。房主按「開始生存」後一起開始。Supabase 免費 Realtime 方案目前列出每專案 200 個同時連線與每秒 100 則訊息；本遊戲將更新頻率限制在每位玩家每秒約 13 次。

## 部署

此專案是純靜態網站。GitHub Pages 自動部署工作流程已設好：在 GitHub 儲存庫的 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**，再執行一次 Actions 工作流程即可發佈。

也可部署至 [Cloudflare Pages](https://pages.cloudflare.com/) 等靜態網站代管服務。
