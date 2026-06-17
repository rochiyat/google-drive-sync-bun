# 🔄 Drive Sync

> Production-ready Google Drive → Local Folder backup tool built with **Bun** + **Elysia**.

![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun&logoColor=000)
![Elysia](https://img.shields.io/badge/framework-Elysia-a855f7)
![SQLite](https://img.shields.io/badge/database-SQLite-003B57?logo=sqlite&logoColor=fff)
![License](https://img.shields.io/badge/license-MIT-22c55e)

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔐 **Service Account Auth** | Authenticate via Google Service Account JSON credential |
| 📂 **Recursive Sync** | Recursively downloads all files and subfolders |
| 📄 **Google Workspace Export** | Auto-converts Docs → `.docx`, Sheets → `.xlsx`, Slides → `.pptx` |
| 🗄️ **SQLite Tracking** | Tracks downloaded files to skip duplicates and detect updates |
| ♻️ **Resumable** | Safely resume interrupted syncs — already downloaded files are skipped |
| 🔁 **Auto-Retry** | Retries up to 3 times on failure with 5s delay |
| ⏱️ **Timeout Protection** | Per-file timeout prevents hangs on slow/stalled connections |
| 🖥️ **Web Dashboard** | Real-time progress, stats, and color-coded activity log |
| 🔗 **URL or ID Input** | Accepts full Google Drive folder URL or just the folder ID |

---

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.0+
- Google Cloud Service Account with Drive API enabled

### Installation

```bash
# Clone the repository
git clone https://github.com/rochiyat/google-drive-sync-bun.git
cd google-drive-sync-bun

# Install dependencies
bun install

# Configure environment
cp .env.example .env
```

### Configuration

1. **Create a Google Service Account** in [Google Cloud Console](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. **Enable Google Drive API** for your project
3. **Download the JSON key** and save it as `credential.json` in the project root
4. **Share your Google Drive folder** with the service account email (found in `credential.json` → `client_email`)

```env
# .env
PORT=3000
GOOGLE_CREDENTIAL=credential.json
```

### Run

```bash
# Development (with hot reload)
bun dev

# Production
bun start
```

Open **http://localhost:3000** in your browser.

---

## 📖 Usage

1. Open the web dashboard at `http://localhost:3000`
2. Paste your **Google Drive folder URL** or **folder ID**
3. Set the **target directory** (default: `./downloads`)
4. Click **Start Sync** and monitor the real-time progress

### Accepted Input Formats

```
# Full URL
https://drive.google.com/drive/folders/1aBcDeFgHiJkLmNoPqRsTuVwXyZ

# URL with sharing params
https://drive.google.com/drive/folders/1aBcDeFgHiJkLmNoPqRsTuVwXyZ?usp=drive_link

# Folder ID only
1aBcDeFgHiJkLmNoPqRsTuVwXyZ
```

---

## 🏗️ Project Structure

```
drive-sync-bun/
├── public/
│   └── index.html          # Web dashboard UI
├── src/
│   ├── index.ts             # Elysia server & WebSocket handler
│   ├── sync.ts              # Core sync logic with retry & timeout
│   ├── drive.ts             # Google Drive API client setup
│   └── database.ts          # SQLite operations (tracking synced files)
├── .env.example             # Environment template
├── package.json
└── README.md
```

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `GOOGLE_CREDENTIAL` | `credential.json` | Path to Google Service Account JSON key |

---

## 🛡️ Error Handling

- **Per-file error isolation** — A single file failure never crashes the entire sync
- **Automatic retry** — Up to 3 attempts with exponential backoff
- **Download timeout** — 5-minute timeout per file prevents infinite hangs
- **API timeout** — 60-second timeout on Google Drive API list calls
- **Graceful skip** — Unsupported Google Workspace file types are logged and skipped

---

## 📄 License

MIT © [Rochiyat](https://github.com/rochiyat)