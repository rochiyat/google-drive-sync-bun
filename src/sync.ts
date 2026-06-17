import fs from 'fs';
import path from 'path';
import { driveClient } from './drive';
import { isUpToDate, saveFile } from './database';

const FILE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per file operation

const GOOGLE_EXPORT_MAP: Record<string, { mimeType: string; ext: string }> = {
  'application/vnd.google-apps.document': {
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: '.docx',
  },
  'application/vnd.google-apps.spreadsheet': {
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: '.xlsx',
  },
  'application/vnd.google-apps.presentation': {
    mimeType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ext: '.pptx',
  },
  'application/vnd.google-apps.drawing': {
    mimeType: 'image/png',
    ext: '.png',
  },
};

/** Wraps a promise with a timeout — rejects if it takes too long */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout after ${ms / 1000}s: ${label}`)),
      ms
    );
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export async function syncFolder(
  folderIdInput: string,
  target: string,
  send?: (msg: string) => void
) {
  const folderId =
    folderIdInput.match(/\/folders\/([a-zA-Z0-9-_]+)/)?.[1] ||
    folderIdInput.trim();

  const drive = await driveClient();

  fs.mkdirSync(target, { recursive: true });

  // ── Collect all files with pagination ──
  const files: any[] = [];
  let pageToken: string | undefined = undefined;

  do {
    const result = await withTimeout(
      drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'nextPageToken, files(id,name,mimeType,modifiedTime)',
        pageSize: 1000,
        pageToken: pageToken,
      }),
      60_000,
      'files.list'
    );

    if (result.data.files) {
      files.push(...result.data.files);
    }

    pageToken = result.data.nextPageToken || undefined;
  } while (pageToken);

  send?.(`[INFO] Found ${files.length} items in folder`);

  // ── Process each file ──
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const progress = `[${i + 1}/${files.length}]`;

    try {
      let local = path.join(target, file.name!);

      // ── Subfolder: recurse ──
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        send?.(`${progress} 📁 FOLDER ${file.name}`);
        await syncFolder(file.id!, local, send);
        continue;
      }

      const exportConfig = GOOGLE_EXPORT_MAP[file.mimeType || ''];

      // Unsupported Google Workspace type
      if (
        file.mimeType?.startsWith('application/vnd.google-apps.') &&
        !exportConfig
      ) {
        send?.(`${progress} ⏭ SKIP (unsupported) ${file.name}`);
        continue;
      }

      // Append extension for exported files
      if (
        exportConfig &&
        !file.name!.toLowerCase().endsWith(exportConfig.ext)
      ) {
        local += exportConfig.ext;
      }

      // Already up-to-date
      if (isUpToDate(file.id!, file.modifiedTime || '')) {
        send?.(`${progress} ⏭ SKIP ${file.name}`);
        continue;
      }

      // ── Download as arraybuffer (no streams — Bun-safe) ──
      let data: ArrayBuffer | Buffer;

      if (exportConfig) {
        const res = await withTimeout(
          drive.files.export(
            { fileId: file.id!, mimeType: exportConfig.mimeType },
            { responseType: 'arraybuffer' }
          ),
          FILE_TIMEOUT_MS,
          `export ${file.name}`
        );
        data = res.data as ArrayBuffer;
      } else {
        const res = await withTimeout(
          drive.files.get(
            { fileId: file.id!, alt: 'media' },
            { responseType: 'arraybuffer' }
          ),
          FILE_TIMEOUT_MS,
          `download ${file.name}`
        );
        data = res.data as ArrayBuffer;
      }

      // Write to disk
      fs.writeFileSync(local, Buffer.from(data));

      // Record in DB
      saveFile(file.id!, file.name!, local, file.modifiedTime || '');
      send?.(`${progress} ✅ ${file.name}`);
    } catch (error: any) {
      const msg = error?.message || String(error);
      send?.(`${progress} ❌ ERROR ${file.name}: ${msg}`);
      // Continue to next file — never crash the loop
    }
  }
}
