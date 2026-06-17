/**
 * Standalone entry point — compiled into a single .exe
 *
 * Differences from src/index.ts:
 *  - HTML is embedded (no @elysiajs/static needed)
 *  - Resolves credential.json relative to exe location
 *  - Auto-opens browser on startup
 *  - Shows helpful console banner
 *  - Creates .env with defaults if not present
 */
import { Elysia } from "elysia";
import { syncFolder } from "./sync";
import { HTML } from "./_html.gen";
import fs from "fs";
import path from "path";

// ── Resolve paths relative to exe location ──
const APP_DIR = path.dirname(process.execPath || process.argv[0]);

// ── Auto-create .env with defaults if missing ──
const envPath = path.join(APP_DIR, ".env");
if (!fs.existsSync(envPath)) {
  fs.writeFileSync(envPath, "PORT=3000\nGOOGLE_CREDENTIAL=credential.json\n");
}

// ── Load .env manually (no dotenv dependency needed) ──
const envContent = fs.readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx > 0) {
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

// ── Resolve credential path ──
const credFile = process.env.GOOGLE_CREDENTIAL || "credential.json";
const credPath = path.isAbsolute(credFile) ? credFile : path.join(APP_DIR, credFile);
process.env.GOOGLE_CREDENTIAL = credPath;

// ── Check credential exists ──
if (!fs.existsSync(credPath)) {
  console.log("");
  console.log("══════════════════════════════════════════════════");
  console.log("  ❌  credential.json tidak ditemukan!");
  console.log("══════════════════════════════════════════════════");
  console.log("");
  console.log("  Letakkan file credential.json di folder:");
  console.log(`  ${APP_DIR}`);
  console.log("");
  console.log("  Cara mendapatkan credential:");
  console.log("  1. Buka https://console.cloud.google.com");
  console.log("  2. Buat Service Account → Download JSON key");
  console.log("  3. Enable Google Drive API");
  console.log("  4. Share folder Drive ke email service account");
  console.log("");
  console.log("  Tekan Enter untuk keluar...");

  // Wait for Enter on Windows
  process.stdin.resume();
  process.stdin.once("data", () => process.exit(1));
} else {
  startServer();
}

function startServer() {
  const PORT = Number(process.env.PORT || 3000);
  const clients = new Set<any>();
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 5000;

  const app = new Elysia()

    // Serve embedded HTML
    .get("/", () => {
      return new Response(HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    })

    .ws("/logs", {
      open(ws) {
        clients.add(ws);
      },
      close(ws) {
        clients.delete(ws);
      },
    })

    .post("/sync", async ({ body }: any) => {
      const send = (msg: string) => {
        clients.forEach((c) => c.send(msg));
      };

      // Run sync with auto-retry in background
      (async () => {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            send(`[SYNC] Starting sync (attempt ${attempt}/${MAX_RETRIES})...`);
            await syncFolder(body.folderId, body.target, send);
            send("[DONE] Sync completed successfully!");
            return;
          } catch (err: any) {
            const errorMsg = err?.message || String(err);
            send(`[FAIL] Sync crashed: ${errorMsg}`);

            if (attempt < MAX_RETRIES) {
              send(
                `[RETRY] Retrying in ${RETRY_DELAY_MS / 1000}s... (attempt ${attempt + 1}/${MAX_RETRIES})`
              );
              await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            } else {
              send(
                `[ERROR] All ${MAX_RETRIES} attempts failed. Please check your connection and try again.`
              );
            }
          }
        }
      })();

      return { status: "started" };
    })

    .listen(PORT);

  // ── Console banner ──
  console.log("");
  console.log("══════════════════════════════════════════════════");
  console.log("  🔄  Drive Sync — Google Drive Backup Tool");
  console.log("══════════════════════════════════════════════════");
  console.log("");
  console.log(`  🌐  Dashboard:  http://localhost:${PORT}`);
  console.log(`  📁  App folder: ${APP_DIR}`);
  console.log(`  🔐  Credential: ${credPath}`);
  console.log("");
  console.log("  Jangan tutup window ini selama sync berjalan.");
  console.log("  Tekan Ctrl+C untuk menghentikan server.");
  console.log("");

  // ── Auto-open browser ──
  try {
    const opener =
      process.platform === "win32"
        ? "start"
        : process.platform === "darwin"
          ? "open"
          : "xdg-open";

    if (process.platform === "win32") {
      Bun.spawn(["cmd", "/c", "start", `http://localhost:${PORT}`]);
    } else {
      Bun.spawn([opener, `http://localhost:${PORT}`]);
    }
  } catch {
    // Silently ignore if browser can't open
  }
}
