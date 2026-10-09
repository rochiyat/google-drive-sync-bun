/**
 * Standalone entry point — compiled into a single executable (.exe / mac binary)
 *
 * Differences from src/index.ts:
 *  - HTML is embedded (no @elysiajs/static needed)
 *  - Resolves paths relative to exe location
 *  - Auto-opens app window on startup
 *  - Supports both Google OAuth 2.0 and Service Account
 *  - Supports native OS folder picker dialog
 *  - Auto-shuts down when window is closed
 */
import { Elysia } from "elysia";
import { syncFolder } from "./sync";
import { authPlugin, getAuthenticatedOAuth2Client, hasServiceAccount } from "./auth";
import { pickFolder } from "./dialog";
import { launchAppWindow } from "./window";
import { HTML } from "./_html.gen";
import fs from "fs";
import path from "path";

// ── Resolve paths relative to exe location ──
const APP_DIR = path.dirname(process.execPath || process.argv[0]);
try {
  process.chdir(APP_DIR);
} catch {
  // Ignore
}
process.env.DB_PATH = path.join(APP_DIR, "sync.db");

// ── Auto-create .env with defaults if missing ──
const envPath = path.join(APP_DIR, ".env");
if (!fs.existsSync(envPath)) {
  fs.writeFileSync(
    envPath,
    "PORT=3000\n# GOOGLE_OAUTH_CLIENT_ID=\n# GOOGLE_OAUTH_CLIENT_SECRET=\n# GOOGLE_CREDENTIAL=credential.json\n"
  );
}

// ── Load .env manually (no dotenv dependency needed) ──
if (fs.existsSync(envPath)) {
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
}

// ── Resolve credential path if specified ──
const credFile = process.env.GOOGLE_CREDENTIAL || "credential.json";
const credPath = path.isAbsolute(credFile) ? credFile : path.join(APP_DIR, credFile);
if (fs.existsSync(credPath)) {
  process.env.GOOGLE_CREDENTIAL = credPath;
}

startServer();

function startServer() {
  const PORT = Number(process.env.PORT || 3000);
  const clients = new Set<any>();
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 5000;

  let clientEverConnected = false;
  let disconnectTimer: any = null;

  const app = new Elysia()

    // Serve embedded HTML
    .get("/", () => {
      return new Response(HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    })

    // Mount Auth Plugin
    .use(authPlugin)

    // Mount Native Folder Picker API
    .post("/api/pick-folder", async ({ body }: any) => {
      return await pickFolder(body?.currentPath);
    })

    // Exit API
    .post("/api/exit", () => {
      setTimeout(() => process.exit(0), 400);
      return { success: true };
    })

    .ws("/logs", {
      open(ws) {
        clientEverConnected = true;
        if (disconnectTimer) {
          clearTimeout(disconnectTimer);
          disconnectTimer = null;
        }
        clients.add(ws);
      },
      close(ws) {
        clients.delete(ws);
        if (clientEverConnected && clients.size === 0) {
          // If no window/tab open for 45s, auto-shutdown server
          disconnectTimer = setTimeout(() => {
            if (clients.size === 0) {
              console.log("No active clients. Exiting...");
              process.exit(0);
            }
          }, 45000);
        }
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

  // ── Determine Auth Status for Banner ──
  const isOAuth = Boolean(getAuthenticatedOAuth2Client());
  const hasSA = hasServiceAccount();
  let authStatusText = "Belum login (Buka dashboard untuk login Google)";
  if (isOAuth) {
    authStatusText = "Terhubung via Google OAuth";
  } else if (hasSA) {
    authStatusText = `Service Account aktif (${path.basename(credPath)})`;
  }

  // ── Console banner ──
  console.log("");
  console.log("══════════════════════════════════════════════════");
  console.log("  🔄  Drive Sync — Google Drive Backup Tool");
  console.log("══════════════════════════════════════════════════");
  console.log("");
  console.log(`  🌐  Dashboard:     http://localhost:${PORT}`);
  console.log(`  📁  App folder:    ${APP_DIR}`);
  console.log(`  🔐  Autentikasi:   ${authStatusText}`);
  console.log("");
  console.log("  Jangan tutup window ini selama sync berjalan.");
  console.log("  Tekan Ctrl+C untuk menghentikan server.");
  console.log("");

  // ── Auto-open dedicated app window ──
  try {
    launchAppWindow(`http://localhost:${PORT}`);
  } catch {
    // Silently ignore if window can't open
  }
}
