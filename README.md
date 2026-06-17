# Google Drive Sync Bun

Production-ready Google Drive -> Local Folder sync.

Features:
- Bun + Elysia backend
- Google Service Account JSON
- Recursive folder download
- Preserve Google Drive folder structure
- SQLite sync history
- Skip existing files
- Browser UI

## Setup

1. Install Bun
2. Run:

```bash
bun install
cp .env.example .env
```

3. Put Google service account file:
credentials.json

4. Start:

```bash
bun start
```

Open:

http://localhost:3000