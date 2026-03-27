# NTUST Notify 專案講稿

> 主題：專案架構與使用說明
> 
> 適合用途：課堂報告、專題展示、程式架構介紹、系統 demo 前講稿

---

# 1. 開場介紹

大家好，今天我要介紹的是 **NTUST Notify**，這是一個用來追蹤 **台科大課程名額狀態** 的網站系統。

這個專案的核心目標很明確：

- 幫助使用者查詢課程
- 把有興趣的課程加入追蹤清單
- 當課程從額滿變成有名額時，自動通知使用者

簡單來說，它是一個結合了 **課程查詢、即時監控、通知提醒** 的工具。

這個系統不只是單純前端畫面，而是包含：

- 前端網頁介面
- 後端 API 服務
- Firebase 驗證與資料儲存
- 背景輪詢機制
- Email / Discord 通知整合

所以它是一個完整的全端專案。

---

# 2. 專案想解決的問題

在選課的情境裡，很多課程一開始會額滿，但之後可能有人退選，名額又會釋出。

傳統做法通常是：

- 使用者自己不斷重整頁面
- 一直重新查詢同一門課
- 花很多時間盯著名額變化

這種方式很沒效率，也很容易錯過名額剛開放的時機。

所以這個專案想解決的問題是：

**讓系統幫使用者自動追蹤課程，一旦名額釋出，就主動通知。**

---

# 3. 專案整體架構

這個專案採用前後端分離架構，可以分成三個主要部分：

1. **Frontend 前端**
2. **Backend 後端**
3. **Firebase 雲端服務**

## 3.1 Frontend 前端

前端是使用：

- **React** 建立介面
- **Vite** 作為開發與打包工具

前端負責：

- 顯示登入畫面
- 顯示搜尋表單
- 顯示課程查詢結果
- 顯示 watchlist（追蹤清單）
- 顯示通知設定畫面
- 顯示即時提示訊息，例如課程名額剛釋出時的 toast

## 3.2 Backend 後端

後端是使用：

- **Node.js**
- **Express**

後端負責：

- 提供 API 給前端呼叫
- 代理 NTUST 的課程查詢 API
- 驗證 Firebase token
- 管理通知輪詢邏輯
- 根據使用者設定發送 Email 或 Discord 通知
- 提供診斷資訊，例如 poller 狀態與快取狀態

## 3.3 Firebase

Firebase 在這個系統中主要負責兩件事：

### 第一，Authentication
- 使用 **Google 登入**
- 讓每位使用者有自己的帳號與資料

### 第二，Firestore
- 儲存使用者資料
- 儲存追蹤課程列表
- 儲存通知偏好設定

也就是說，Firebase 幫我們處理了登入身分與資料同步。

---

# 4. 技術選型

這個專案使用的主要技術如下：

## 前端
- React
- Vite
- Firebase Client SDK

## 後端
- Node.js
- Express
- Axios
- Nodemailer
- Firebase Admin SDK
- express-rate-limit
- helmet
- cors

## 通知與整合
- Email SMTP
- Discord Webhook

## 部署相關
- Docker
- docker-compose

這樣的技術選型有幾個優點：

- React 適合做互動型介面
- Express 架構輕量、開發快
- Firebase 很適合快速處理登入與雲端資料同步
- Docker 方便部署與移植

---

# 5. 前端架構介紹

接下來我介紹前端的主要組成。

## 5.1 `main.jsx`

這是前端進入點。

它的功能是：

- 將 React App 掛載到 root DOM
- 用 `AuthProvider` 包住整個 App
- 啟用 React Strict Mode

也就是說，它負責啟動整個前端應用程式。

## 5.2 `App.jsx`

這是前端主要控制中心。

它會先判斷目前使用者的登入狀態：

- 如果 Firebase 還在初始化，就顯示 loading
- 如果尚未登入，就顯示登入頁面
- 如果已登入，就進入主功能頁面

登入後的主功能包含三個主要 tab：

- Search：搜尋課程
- Watchlist：追蹤清單
- Notifications：通知設定

`App.jsx` 也管理了：

- 查詢條件
- 查詢結果
- polling 狀態
- 錯誤訊息
- toast 通知
- 最後更新時間

所以可以把它看成前端主要的頁面協調者。

## 5.3 `SearchForm.jsx`

這個元件負責課程查詢輸入。

使用者可以輸入：

- Semester
- Course No.
- Course Name
- Teacher

按下搜尋後，系統會送出查詢請求。

如果啟動 polling，就會持續重新查詢。

## 5.4 `CourseTable.jsx`

這個元件負責顯示課程列表。

它會展示：

- 課號
- 課名
- 教師
- 修課人數
- 學分
- 教室
- 上課時間
- 課程狀態（FULL / OPEN）

另外也提供互動按鈕：

- 星號：加入或移除 watchlist
- 鈴鐺：開啟或關閉該課程通知

這個元件裡還有一個 `formatNode()` 函式，會把 NTUST 原始的節次格式轉成人類比較容易閱讀的時間表示。

## 5.5 `LoginPage.jsx`

這是登入頁面。

目前登入方式是：

- Google Sign-In

登入成功後，會進入主畫面；如果失敗，會顯示錯誤訊息。

## 5.6 `UserMenu.jsx`

這個元件顯示使用者資訊，包含：

- 使用者頭像
- 名稱
- Email
- 登出按鈕

它的作用是提供目前登入狀態的操作入口。

## 5.7 `NotifyPrefsPanel.jsx`

這個元件是通知設定頁面的重要核心。

在這裡，使用者可以設定：

- 是否啟用 Email 通知
- 是否啟用 Discord 通知
- Discord Webhook URL
- 是否 tag 自己
- Discord User ID
- Poll interval（多久檢查一次）

此外，這個頁面還提供兩個很實用的功能：

### 第一，Test Notification
可以立刻送出測試通知，確認 Email 或 Discord 設定是否成功。

### 第二，Poller Diagnostics
可以看到後端目前的監控狀態，例如：

- poller 是否準備完成
- 上次輪詢時間
- 某門課目前是否被跳過
- 快取資料多久前更新
- NTUST API 最近成功或失敗狀況

這讓整個系統更透明，也更容易除錯。

## 5.8 `NotifySettingsModal.jsx`

這是一個 modal 版本的通知設定介面。

從目前程式看起來，它像是另一種通知設定 UI 寫法，可能是先前版本或備用設計。

## 5.9 前端 Hooks

前端使用了兩個自訂 hook：

### `useNotifyPrefs.js`
用途：
- 讀取使用者通知偏好
- 即時同步 Firestore 的 `notifyPrefs`
- 提供 `savePrefs()` 去更新設定

### `useWatchedCourses.js`
用途：
- 同步使用者 watchlist
- 新增追蹤課程
- 移除追蹤課程
- 切換 notifyEnabled 狀態
- 檢查某門課是否已被追蹤

這兩個 hook 把資料存取邏輯從畫面元件中抽離，讓元件更乾淨、更好維護。

## 5.10 `AuthContext.jsx`

這個檔案用 React Context 管理整個應用程式的登入狀態。

它負責：

- 監聽 Firebase auth state
- 提供 `signInWithGoogle()`
- 提供 `signOut()`
- 把 `user` 狀態提供給整個 App 使用

另外，登入成功後還會把使用者資料寫進 Firestore 的 `users/{uid}` 文件中。

---

# 6. 後端架構介紹

後端的主程式集中在 `server/index.js`。

雖然檔案目前是單檔設計，但裡面其實分成幾個明確區塊。

## 6.1 基礎設定與中介層

後端一開始會設定：

- `dotenv`：讀取環境變數
- `helmet`：增加安全性 header
- `cors`：限制允許的來源
- `express.json()`：解析 JSON request body
- `express-rate-limit`：限制請求頻率

這部分的目的是提高基本安全性與穩定性。

## 6.2 Firebase Admin

後端透過 Firebase Admin SDK：

- 驗證前端傳來的 Firebase token
- 存取 Firestore

如果 Firebase 沒有正確設定，後端仍然可以啟動，但通知輪詢功能就會停用。

## 6.3 SMTP Mailer

如果環境變數裡有設定 SMTP 資訊，後端就會建立 Nodemailer transport。

這樣當課程有空位時，就可以寄出 Email 通知。

如果沒有 SMTP 設定，Email 通知會自動停用，但系統其他功能不會因此壞掉。

## 6.4 主要 API 路由

### `/health`
用來確認伺服器是否正常運作。

### `/api/courses`
這是課程搜尋 API。

它的功能不是直接自己查資料庫，而是：

- 接收前端的查詢條件
- 組成 NTUST API 所需格式
- 代理呼叫 NTUST 官方查詢 API
- 把結果回傳給前端

所以它本質上是一個 proxy API。

### `/api/poll-options`
提供目前使用者可選擇的 polling interval。

一般使用者與授權使用者能選的最小間隔不同。

### `/api/notify/test`
用來立即發送測試通知。

這個 API 會模擬一門假的課程資料，然後：

- 如果有啟用 Discord，就送 Discord 測試訊息
- 如果有啟用 Email，就寄 Email 測試信

### `/api/notify/status`
回傳目前通知輪詢狀態與診斷資訊。

這對前端偵錯很重要，因為可以看到：

- poller 是否 ready
- 是否有通知管道可用
- 要求的 polling interval 與實際生效 interval
- 每門 watched course 的 cache 狀態
- 最近成功或失敗的抓取資訊

---

# 7. 通知機制的核心設計

這個專案最關鍵的地方，其實就是通知輪詢邏輯。

## 7.1 為什麼需要輪詢

因為 NTUST 原始系統並沒有提供 webhook 或即時事件通知。

所以我們只能採用：

- 定期查詢
- 比較目前狀態與先前狀態
- 當狀態發生變化時發通知

## 7.2 輪詢的資料來源

後端不是每次輪詢都去直接查 Firestore，而是先用 Firestore 的 `onSnapshot` 建立即時同步的 in-memory cache。

也就是說：

- `usersData`：快取使用者資料
- `watchedCoursesData`：快取每個使用者追蹤的課程
- `watchListeners`：管理各使用者子集合的 listener

這樣做的優點是：

- 減少 Firestore 重複讀取
- 輪詢時效能更好
- 架構上比較乾淨

## 7.3 去重與快取

如果很多使用者都追蹤同一門課，系統不會重複打 NTUST API。

它會先建立一個 `courseMap`，把相同課程合併，再處理 subscribers。

也就是說：

- 課程資料只抓一次
- 通知可以發給多個不同使用者

此外，後端還用了 `courseCache`：

- 以 `semester::courseNo` 為 key
- 快取最近抓到的課程資料
- 避免太密集地重複打上游 API

## 7.4 狀態轉移判斷

通知不是只要課程 open 就一直發，而是只有在：

**FULL → OPEN**

這個轉換發生時才發通知。

這個邏輯透過 `stateMap` 來實作，裡面記錄：

- `wasFull`
- `notifiedOpen`

這樣可以保證：

- 第一次啟動時不亂發通知
- 同一次 open 狀態只通知一次
- 當課程再次變 full，再重新 open 時，才會再發新通知

這是這個專案在通知邏輯上很重要的設計點。

## 7.5 stale data 保護

如果 NTUST API 抓取失敗，但本地有舊快取，系統不會直接用舊資料去更新狀態。

原因是：

- 舊資料可能已經過期
- 如果直接更新狀態，可能會錯過真正的 FULL → OPEN 轉變

所以這裡的策略是：

- 可以保留 stale cache 當參考
- 但不要用 stale data 改寫通知狀態

這代表系統在一致性設計上有考慮到錯誤情境。

---

# 8. 通知方式

目前支援兩種通知方式：

## 8.1 Email 通知

當課程有空位時，後端會用 Nodemailer 發送 HTML email。

內容包含：

- 課號
- 課名
- 教師
- 修課人數
- 學分
- 教室
- 上課時間
- 回到 NTUST 查詢頁面的連結

## 8.2 Discord 通知

後端也可以透過 Discord Webhook 發送 embed 訊息。

Discord 訊息的內容同樣包含課程資訊，並且可以：

- 發到指定頻道
- 視情況 tag 使用者本人

這讓通知更有彈性，也符合不同使用者的習慣。

---

# 9. 資料流與使用流程

接下來我用使用者的角度說明整個系統流程。

## Step 1：登入
使用者先透過 Google 登入。

登入後，系統會：

- 在 Firebase Auth 建立 session
- 在 Firestore 的 `users/{uid}` 建立或更新使用者文件

## Step 2：搜尋課程
使用者在 Search 頁面輸入：

- 學期
- 課號
- 課名
- 教師

前端把這些條件送到後端 `/api/courses`。

後端再代理呼叫 NTUST API，把查詢結果傳回前端。

## Step 3：加入 watchlist
如果使用者對某門課有興趣，就可以按星號把它加入 watchlist。

這時候資料會寫進：

- `users/{uid}/watchedCourses/{courseNo}`

## Step 4：設定通知
使用者可以到 Notifications 頁面選擇：

- Email 通知
- Discord 通知
- polling interval

## Step 5：開啟課程通知
使用者在 watchlist 中針對特定課程打開鈴鐺。

只有這些開啟鈴鐺的課程，才會被後端通知系統納入監控。

## Step 6：後端輪詢
後端定期檢查這些 watched course：

- 若仍額滿 → 不通知
- 若從額滿變成有空位 → 發送通知

這樣就完成整個自動提醒流程。

---

# 10. 安全性與穩定性設計

這個專案雖然規模不算超大，但有做一些基本而實用的防護。

## 安全性
- 使用 Firebase token 驗證使用者身分
- 使用 CORS 限制來源
- 使用 helmet 加上安全性 HTTP headers
- 使用 rate limit 避免 API 被濫用

## 穩定性
- 有快取機制，降低上游壓力
- 有 stale data 保護，避免狀態誤判
- 使用 recursive `setTimeout`，避免輪詢重疊執行
- 即使 Firebase 或 SMTP 未設定，系統仍能部分運作

這些設計讓系統比較接近實際可部署的服務，而不只是單純 demo。

---

# 11. 部署方式

後端提供了：

- `Dockerfile`
- `docker-compose.yaml`

這代表後端可以直接容器化部署。

部署流程大致上是：

1. 設定 `.env`
2. 準備 Firebase service account
3. 用 docker compose 啟動服務

前端則可以透過 Vite build 後部署成靜態網站。

因此整體上部署可以拆成：

- 前端：靜態 hosting
- 後端：Node/Express 容器
- Firebase：雲端 Auth + Firestore

---

# 12. 專案特色與亮點

如果要總結這個專案的亮點，我會整理成以下幾點：

## 第一，解決真實問題
這不是純練習題，而是對應真實選課痛點。

## 第二，全端整合完整
包含：
- 前端互動介面
- 後端 API
- 身分驗證
- 資料庫
- 通知系統
- 部署設定

## 第三，通知邏輯設計有完整性
不是簡單一直查，而是有考慮：
- 去重
- 狀態轉移
- 快取
- stale data
- per-user interval

## 第四，擴充性不錯
未來如果要加：
- Line Notify / Telegram 通知
- 更多查詢條件
- 後台管理頁面
- 監控 dashboard

其實都可以在現在架構上延伸。

---

# 13. 未來可以改進的方向

如果未來要繼續優化，我認為有幾個方向：

## 13.1 後端模組化
目前後端集中在單一 `index.js`，之後可以拆成：

- routes
- services
- notification
- polling
- firebase
- utils

這樣會更容易維護。

## 13.2 前後端型別化
可以考慮改用：

- TypeScript

這樣可以讓資料結構更清楚，減少錯誤。

## 13.3 更完整的 UI 狀態管理
如果功能再擴大，可以導入：

- Zustand
- Redux Toolkit

不過以目前規模來說，React hooks 已經夠用。

## 13.4 更完整的測試
未來可以補：

- 前端元件測試
- 後端 API 測試
- 通知流程測試

## 13.5 背景工作排程最佳化
如果之後使用者更多，可以考慮把 polling 拆成獨立 worker，甚至使用 queue 系統。

---

# 14. 簡短結論

最後總結一下，**NTUST Notify** 是一個用來追蹤課程名額變化並主動通知使用者的全端系統。

它的價值不只是在查課，而是在於：

- 把重複、枯燥的手動查詢自動化
- 提升使用者搶到課程的機會
- 透過完整的前後端整合，實現真正可用的工具

從技術角度來看，這個專案展示了：

- React 前端設計
- Express 後端 API 設計
- Firebase 驗證與資料同步
- 背景輪詢邏輯
- 通知系統整合
- Docker 部署能力

所以它不只是單一功能頁面，而是一個具有完整系統思維的專案。

---

# 15. Demo 時可以怎麼講（精簡版）

如果是 demo 現場，時間比較短，可以用下面這個版本：

大家好，這個專案叫做 **NTUST Notify**，它的目的是幫助使用者自動追蹤台科大課程的名額狀態。

使用者可以先用 Google 登入，接著搜尋課程，把有興趣的課程加入 watchlist，並設定 Email 或 Discord 通知。

系統後端會定期輪詢這些課程的狀態，當課程從額滿變成有名額時，就會主動發通知給使用者。

在技術上，前端使用 React + Vite，後端使用 Node.js + Express，登入與資料同步使用 Firebase，通知則整合了 SMTP email 和 Discord webhook。

這個專案的重點不只是查詢功能，而是背後的通知邏輯：它有做狀態轉移判斷、快取、去重與 per-user polling 控制，因此可以比較穩定地執行。

如果未來要擴充，也可以很容易加入更多通知平台或把後端模組化。

---

# 16. 一頁式簡報大綱（超精簡）

## 專案名稱
NTUST Notify

## 專案目的
自動追蹤課程名額，釋出時主動通知使用者

## 使用技術
- Frontend: React + Vite
- Backend: Node.js + Express
- Auth / DB: Firebase Auth + Firestore
- Notification: SMTP Email / Discord Webhook
- Deployment: Docker

## 核心功能
- Google 登入
- 課程搜尋
- Watchlist
- 通知偏好設定
- 名額釋出提醒
- Poller diagnostics

## 架構重點
- 前後端分離
- 後端代理 NTUST API
- Firestore 即時同步
- 背景輪詢 + 狀態轉移判斷
- 快取與重複請求合併

## 專案亮點
- 解決真實選課痛點
- 全端功能完整
- 通知邏輯設計實用
- 易於擴充與部署

---

# 17. 建議報告順序

如果你要正式上台報告，我建議順序是：

1. 先講問題背景
2. 再講專案目標
3. 再講整體架構
4. 接著講前端功能
5. 再講後端通知機制
6. 最後講技術亮點與未來優化

這樣聽眾會比較容易跟上，也比較能理解這個專案的價值。

---

如果你要，我下一步也可以幫你補：

1. **PPT 版 8~10 頁投影片大綱**
2. **3 分鐘口語版講稿**
3. **5 分鐘口語版講稿**
4. **老師問答可能題目與回答**
