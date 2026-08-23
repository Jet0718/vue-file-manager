# 🗂 本機檔案管理系統（Vue 3）

以 **Vue 3** 打造的本機檔案管理系統，搭配 Node.js 後端直接存取本機檔案系統。

## 功能

- **複選批量操作**：清單列有勾選框（表頭可全選，Ctrl/⌘+點選亦可切換），勾選後出現批量工具列，可對多個檔案／資料夾執行**複製**（含遞迴複製資料夾）、**搬移**、**備份**（各自到 bak）、**刪除**、**打包 ZIP 下載**（資料夾遞迴含入）
- **Everything 全域搜尋**：頂部搜尋列可呼叫 Windows 的 **Everything** 索引做即時全域搜尋（附 `es.exe`，零設定）；支援 Everything 語法（`ext:`、`file:`、`path:`、`dm:`…）與中文關鍵字，結果依修改日期新→舊排序，可勾選「目前資料夾」限定範圍、直接開啟／預覽／跳至所在資料夾；Everything 不可用時自動降級為本機搜尋
- **常用目錄區（三個分頁）**：
  - **目錄**：樹狀顯示本機常用目錄（家目錄、桌面、文件、下載、圖片、音樂、影片、根目錄等），可逐層展開
  - **喜好**：可標記喜好資料夾（檔案列 ☆ 或上方「☆ 加入喜好」按鈕），標記後收納在此分頁，點選即跳轉
  - **最近**：收納最近有異動的資料夾與檔案清單（**預設最近兩週**，天數可自由調整並自動記憶），可開啟／預覽／跳至所在資料夾
- **檔案列表**：點選資料夾顯示其下的檔案，預設依**修改日期由新到舊**排序（亦可切換名稱／大小排序，可選擇資料夾置頂）
- **檔案類型圖示**：圖片、影片、音樂、PDF、文件、試算表、簡報、壓縮檔、程式碼、執行檔等各有對應圖示與顏色
- **每筆檔案作業**：
  - **開啟**：以系統預設應用程式開啟（WSL 下自動改用 `wslview`／`explorer.exe` 以 Windows 應用程式開啟）
  - **預覽**：文字（.txt）、**Markdown**（.md/.markdown，渲染成 HTML）、**HTML**（.html/.htm，iframe 呈現）可直接在系統內預覽，超過 2MB 或二進位內容會提示
  - **複製**：選擇目的地資料夾後複製
  - **搬移**：選擇目的地資料夾後搬移（跨磁碟自動改為複製＋刪除）
  - **更名**：彈窗輸入新名稱（Enter 確認、Esc 取消），檔案與資料夾皆可；若為喜好資料夾會自動同步路徑
  - **備份**：預設備份至「目前檔案所在資料夾」下的 `bak` 子資料夾（已存在時自動加上時間戳）
  - **下載**／**刪除**（附帶功能）
- **WSL 支援**：在 WSL（Windows Subsystem for Linux）執行時自動偵測，樹狀目錄加入 **Windows 磁碟**（`/mnt/c`、`/mnt/d`…），可完整瀏覽 Windows 目錄；輸入 Windows 路徑（`C:\Users\xxx`）會自動轉譯為 WSL 路徑
- 複製／搬移目的地可用樹狀目錄點選，也可直接輸入路徑；若檔名衝突會自動以 `(1)`、`(2)`…命名，避免覆蓋
- 其他：顯示隱藏檔、搜尋目前資料夾、麵包屑導覽、狀態列

## 執行

```bash
cd file-manager
./start.sh        # 背景常駐啟動（自動記錄 PID，日誌寫入 server.log）
./stop.sh         # 停止
# 或前景執行：node server.js
```

然後在瀏覽器開啟：<http://localhost:4321>

- **WSL 環境**：伺服器自動綁定 `0.0.0.0`，**Windows 端瀏覽器**可直接開 <http://localhost:4321>（WSL2 localhost 轉發）；若不行，可用 WSL IP（啟動日誌會顯示，例如 <http://192.168.136.133:4321>）
- **一般 Linux／macOS**：預設只綁定 `127.0.0.1`（僅本機可存取）
- 可用環境變數覆寫：`PORT`（預設 4321）、`HOST`（預設 WSL 為 `0.0.0.0`，其餘 `127.0.0.1`）

> ⚠️ 安全提醒：WSL 下綁定 `0.0.0.0` 表示同網段其他裝置也能連到本服務（具備檔案刪除權限）。若不需要從其他裝置存取，可設 `HOST=127.0.0.1 node server.js` 只開放本機。

（無需 npm install，前端使用已下載至 `public/vendor/` 的 Vue Global Build，可離線執行。）

## 📦 佈置安裝（Windows + WSL2 完整流程）

### 環境需求

| 項目 | 需求 | 說明 |
| --- | --- | --- |
| 作業系統 | Windows 10/11（含 WSL2）或 Linux／macOS | Windows 上建議用 WSL2 執行 |
| Node.js | ≥ 18 | 僅需 Node 內建模組，**無需 npm install**（前端 Vue/marked 已下載於 `public/vendor/`） |
| WSL2（Windows 限定） | Ubuntu 22.04/24.04 等發行版 | 用於執行伺服器並掛載 Windows 磁碟 |
| Everything（選用） | Windows 端安裝並執行 | 啟用「Everything 全域搜尋」功能（附 `bin/es.exe`，自動偵測） |

### 安裝步驟（Windows）

```bash
# 1) 安裝 WSL2 與 Ubuntu（若尚未安裝）
wsl --install
# 重啟後開啟 Ubuntu，建立使用者，並安裝 Node.js：
sudo apt update && sudo apt install -y nodejs npm
# 或用官方 NodeSource：https://nodejs.org/en/download 下載 LTS 版

# 2) 下載本專案並解壓（或 git clone）
cd ~
git clone https://github.com/<你的帳號>/vue-file-manager.git
cd vue-file-manager

# 3) 啟動（背景常駐）
./start.sh

# 4) Windows 瀏覽器開啟
start http://localhost:4321
```

### 安裝步驟（Linux／macOS）

```bash
# 安裝 Node.js ≥ 18（apt / nvm / brew 皆可）
cd vue-file-manager
node server.js        # 前景執行，或 ./start.sh 背景常駐
# 瀏覽器開啟 http://localhost:4321
```

### Windows 開機自動啟動（選用）

建立 `啟動.vbs` 放入「啟動」資料夾（`shell:startup`），開機即自動常駐：

```vbs
Set sh = CreateObject("WScript.Shell")
sh.Run "wsl -d Ubuntu -e bash -lc 'cd ~/vue-file-manager && ./start.sh'", 0
```

> 亦可用「工作排程器」在登入時執行 `wsl -d Ubuntu -e bash -lc '~/vue-file-manager/start.sh'`。

### 組態（環境變數）

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `PORT` | `4321` | HTTP 埠號 |
| `HOST` | WSL：`0.0.0.0`；其他：`127.0.0.1` | 綁定位址（`0.0.0.0` 讓 Windows 瀏覽器與同網段裝置可連） |
| `FM_DATA_DIR` | `./data` | 喜好資料夾等資料的存放目錄 |
| `FM_RECENT_ROOTS` | 自動 | 「最近」掃描的根目錄（測試用，格式 `路徑:深度,路徑:深度`） |
| `FM_FORCE_WSL` | — | 設 `1` 強制啟用 WSL 模式（測試用） |

### 存取方式

- **Windows 端瀏覽器**：<http://localhost:4321>（WSL2 localhost 轉發）
- **WSL 內**：<http://localhost:4321>
- **其他裝置（同網段）**：`http://<WSL-IP>:4321`（啟動日誌會印出）

### 安全注意事項

> ⚠️ 本工具為個人本機使用而設計，可讀寫／刪除執行帳號權限內的所有檔案。
> - WSL 下預設綁定 `0.0.0.0`（供 Windows 瀏覽器轉發）— 同網段其他裝置也可連，**若不需要請設 `HOST=127.0.0.1`**
> - 請勿在不可信的網路環境中開放存取
> - 若需對外使用，建議在前面加反向代理與身分驗證

## 專案結構

```
file-manager/
├── server.js                  # Node.js 後端（REST API + 靜態檔案）
├── bin/es.exe                 # Everything 命令列介面（官方工具，供搜尋呼叫）
├── package.json
├── public/
│   ├── index.html
│   ├── css/style.css
│   ├── js/templates.js        # Vue 模板（獨立檔案）
│   ├── js/app.js              # Vue 3 應用程式
│   └── vendor/                # 本機離線資源（vue、marked）
└── test/templates-check.js    # 模板語法驗證（npm test）
```

## 疑難排解

| 症狀 | 處理 |
| --- | --- |
| 連不上 http://127.0.0.1:4321 | 先確認伺服器有在跑（`ss -tln | grep 4321` 或 `./start.sh`）；本機瀏覽建議用 `localhost` 而非 `127.0.0.1` |
| WSL 中 Windows 瀏覽器連不上 | 確認伺服器綁定 `0.0.0.0`（WSL 下預設即是）；改用 WSL IP 存取（啟動日誌會印出） |
| Port 4321 被佔用 | 設 `PORT=其他埠 ./start.sh`，或先 `./stop.sh` |

## API 一覽

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/api/roots` | 常用目錄清單（WSL 下含 Windows 磁碟） |
| GET | `/api/meta` | 環境資訊（平台、是否 WSL、家目錄） |
| GET | `/api/favorites` | 喜好資料夾清單（持久化於 data/favorites.json） |
| POST / DELETE | `/api/favorites` | 加入／移除喜好資料夾（body: `{ path }`） |
| POST | `/api/copy` / `/api/move` | 複製／搬移（body: `{ srcs: [路徑…], destDir }`，單一亦可傳 `src`） |
| POST | `/api/backup` | 備份（body: `{ paths: [路徑…] }`） |
| POST | `/api/rename` | 更名（body: `{ path, newName }`，僅大小寫變更亦允許） |
| POST | `/api/delete` | 刪除（body: `{ paths: [路徑…] }`） |
| POST | `/api/zip` / GET `/api/zipfile` | 選取項目打包 ZIP 下載（資料夾遞迴） |
| GET | `/api/recent?days=14` | 最近 N 天內有異動的資料夾與檔案（掃描家目錄、標準子目錄與 WSL 磁碟，30 秒快取） |
| GET | `/api/search?q=…&limit=50&folder=…` | 全域搜尋：優先透過 Everything（es.exe），不可用時降級本機搜尋 |
| GET | `/api/search/status` | Everything 可用狀態偵測 |
| GET | `/api/dirs?path=…` | 資料夾下的子資料夾（樹狀展開用） |
| GET | `/api/files?path=…` | 資料夾下的所有項目（含大小、修改時間、類型） |
| GET | `/api/stat?path=…` | 路徑是否存在／是否為資料夾（WSL 下自動轉譯 Windows 路徑） |
| GET | `/api/preview?path=…` | 文字／Markdown／HTML 檔案內容預覽（≤2MB） |
| GET | `/api/download?path=…` | 下載檔案 |
| POST | `/api/open` | 以系統預設應用程式開啟 |
| POST | `/api/copy` | 複製（`{ src, destDir }`） |
| POST | `/api/move` | 搬移（`{ src, destDir }`） |
| POST | `/api/backup` | 備份至來源資料夾的 `bak` 子資料夾 |
| POST | `/api/delete` | 刪除 |

> 安全性備註：此工具僅綁定 `127.0.0.1`，為個人本機使用而設計，可存取執行帳號權限內的完整檔案系統。
