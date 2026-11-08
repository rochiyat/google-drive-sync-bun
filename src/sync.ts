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

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Drive allows any character in names; the local filesystem doesn't. */
export function sanitizeName(name: string): string {
  let out = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  if (!out) out = '_';
  if (WINDOWS_RESERVED.test(out)) out = `_${out}`;
  return out;
}

/** Drive error bodies arrive as an ArrayBuffer when responseType is arraybuffer. */
function driveErrorReason(error: any): { reason?: string; message?: string } {
  let body = error?.response?.data;
  try {
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
      body = JSON.parse(Buffer.from(body as ArrayBuffer).toString('utf8'));
    } else if (typeof body === 'string') {
      body = JSON.parse(body);
    }
  } catch {
    body = undefined;
  }
  const err = body?.error;
  return {
    reason: err?.errors?.[0]?.reason ?? error?.errors?.[0]?.reason,
    message: err?.message,
  };
}

/** Not retryable: the folder is missing or the current account can't see it. */
export class FolderAccessError extends Error {}

async function currentAccountEmail(drive: any): Promise<string> {
  try {
    const res = await drive.about.get({ fields: 'user(emailAddress)' });
    return res.data.user?.emailAddress || 'akun tidak diketahui';
  } catch {
    return 'akun tidak diketahui';
  }
}

// Drive returns an empty list (not an error) for folders the account can't
// access, so check the root folder explicitly before listing.
async function assertFolderAccessible(drive: any, folderId: string) {
  let meta: any;
  try {
    const res = await withTimeout(
      drive.files.get({
        fileId: folderId,
        fields: 'id,name,mimeType',
        supportsAllDrives: true,
      }),
      60_000,
      'files.get'
    );
    meta = (res as any).data;
  } catch (error: any) {
    const status = error?.code ?? error?.response?.status;
    const reason = error?.errors?.[0]?.reason;
    // A disabled Drive API is also a 403, but sharing the folder won't fix it.
    if (reason === 'accessNotConfigured' || /has not been used in project|is disabled/i.test(error?.message || '')) {
      throw new FolderAccessError(
        `Google Drive API belum aktif di project Google Cloud milik credential ini. ${error.message}`
      );
    }
    if (status === 404 || status === 403) {
      const email = await currentAccountEmail(drive);
      throw new FolderAccessError(
        `Folder ${folderId} tidak ditemukan atau tidak bisa diakses oleh ${email}. ` +
          `Share folder tersebut ke email ini (minimal Viewer), atau login dengan akun pemilik folder.`
      );
    }
    throw error;
  }

  if (meta.mimeType !== 'application/vnd.google-apps.folder') {
    throw new FolderAccessError(
      `"${meta.name}" bukan folder Google Drive. Masukkan URL atau ID folder.`
    );
  }
  return meta;
}

export async function syncFolder(
  folderIdInput: string,
  target: string,
  send?: (msg: string) => void,
  isRoot = true
) {
  const folderId =
    folderIdInput.match(/\/folders\/([a-zA-Z0-9-_]+)/)?.[1] ||
    folderIdInput.trim();

  const drive = await driveClient();

  if (isRoot) {
    const meta = await assertFolderAccessible(drive, folderId);
    send?.(`[INFO] Folder: ${meta.name}`);
  }

  fs.mkdirSync(target, { recursive: true });

  // ── Collect all files with pagination ──
  const files: any[] = [];
  let pageToken: string | undefined = undefined;

  do {
    const result = await withTimeout(
      drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields:
          'nextPageToken, files(id,name,mimeType,modifiedTime,exportLinks,capabilities/canDownload)',
        pageSize: 1000,
        pageToken: pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
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
      let local = path.join(target, sanitizeName(file.name!));

      // ── Subfolder: recurse ──
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        send?.(`${progress} 📁 FOLDER ${file.name}`);
        await syncFolder(file.id!, local, send, false);
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

      if (file.capabilities?.canDownload === false) {
        send?.(`${progress} ⏭ SKIP (download dinonaktifkan pemilik) ${file.name}`);
        continue;
      }

      // Already up-to-date
      if (isUpToDate(file.id!, file.modifiedTime || '')) {
        send?.(`${progress} ⏭ SKIP ${file.name}`);
        continue;
      }

      // ── Download as arraybuffer (no streams — Bun-safe) ──
      let data: ArrayBuffer | Buffer;

      if (exportConfig) {
        try {
          const res = await withTimeout(
            drive.files.export(
              { fileId: file.id!, mimeType: exportConfig.mimeType },
              { responseType: 'arraybuffer' }
            ),
            FILE_TIMEOUT_MS,
            `export ${file.name}`
          );
          data = res.data as ArrayBuffer;
        } catch (error: any) {
          // files.export caps output at 10MB; exportLinks don't have that cap.
          const link = file.exportLinks?.[exportConfig.mimeType];
          if (driveErrorReason(error).reason !== 'exportSizeLimitExceeded' || !link) {
            throw error;
          }
          const auth = (drive as any).context._options.auth;
          const res = await withTimeout(
            auth.request({ url: link, responseType: 'arraybuffer' }),
            FILE_TIMEOUT_MS,
            `export (large) ${file.name}`
          );
          data = (res as any).data as ArrayBuffer;
        }
      } else {
        const res = await withTimeout(
          drive.files.get(
            { fileId: file.id!, alt: 'media', supportsAllDrives: true },
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
      const { reason, message } = driveErrorReason(error);
      let msg = message || error?.message || String(error);
      if (reason === 'exportSizeLimitExceeded') {
        msg = 'File terlalu besar untuk di-export oleh Google (batas 10MB)';
      } else if (reason === 'cannotDownloadFile' || reason === 'cannotExportFile') {
        msg = 'Pemilik file menonaktifkan download/export untuk akun ini';
      }
      if (reason) msg += ` [${reason}]`;
      send?.(`${progress} ❌ ERROR ${file.name}: ${msg}`);
      // Continue to next file — never crash the loop
    }
  }
}
