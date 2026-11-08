import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { syncFolder, FolderAccessError } from "./sync";
import { authPlugin } from "./auth";
import { pickFolder } from "./dialog";
import "dotenv/config";

const clients = new Set<any>();

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

const app = new Elysia()

  .use(staticPlugin({
    assets: "public",
    prefix: ""
  }))

  .use(authPlugin)

  .post("/api/pick-folder", async ({ body }: any) => {
    return await pickFolder(body?.currentPath);
  })

  .post("/api/exit", () => {
    setTimeout(() => process.exit(0), 400);
    return { success: true };
  })

  .ws("/logs", {
    open(ws) {
      clients.add(ws);
    },
    close(ws) {
      clients.delete(ws);
    }
  })

  .post("/sync", async ({ body }: any) => {

    const send = (msg: string) => {
      clients.forEach(c => c.send(msg));
    };

    // Run sync with auto-retry in background
    (async () => {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          send(`[SYNC] Starting sync (attempt ${attempt}/${MAX_RETRIES})...`);
          await syncFolder(body.folderId, body.target, send);
          send("[DONE] Sync completed successfully!");
          return; // success, no retry needed
        } catch (err: any) {
          const errorMsg = err?.message || String(err);
          if (err instanceof FolderAccessError) {
            send(`[ERROR] ${errorMsg}`);
            return; // retrying won't fix access/permission problems
          }

          send(`[FAIL] Sync crashed: ${errorMsg}`);

          if (attempt < MAX_RETRIES) {
            send(`[RETRY] Retrying in ${RETRY_DELAY_MS / 1000}s... (attempt ${attempt + 1}/${MAX_RETRIES})`);
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          } else {
            send(`[ERROR] All ${MAX_RETRIES} attempts failed. Please check your connection and try again.`);
          }
        }
      }
    })();

    return { status: "started" };

  })

  .listen(Number(process.env.PORT || 3000));

console.log(`running http://localhost:${process.env.PORT || 3000}`);