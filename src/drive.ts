import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { getAuthenticatedOAuth2Client } from './auth';

export async function driveClient() {
  // 1. Try Google OAuth 2.0 first (User Login)
  const oauthClient = getAuthenticatedOAuth2Client();
  if (oauthClient) {
    return google.drive({
      version: 'v3',
      auth: oauthClient,
    });
  }

  // 2. Fall back to Service Account (credential.json)
  const credFile = process.env.GOOGLE_CREDENTIAL || 'credential.json';
  const appDir = path.dirname(process.execPath || process.argv[0]);
  const candidatePaths = [
    credFile,
    path.isAbsolute(credFile) ? credFile : path.join(appDir, credFile),
    path.join(process.cwd(), credFile),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const auth = new google.auth.GoogleAuth({
          keyFile: p,
          scopes: ['https://www.googleapis.com/auth/drive.readonly'],
        });

        return google.drive({
          version: 'v3',
          auth: await auth.getClient(),
        });
      } catch (err: any) {
        console.warn(`Gagal memuat Service Account dari ${p}:`, err?.message);
      }
    }
  }

  throw new Error(
    'Belum terautentikasi! Silakan klik tombol "Login dengan Google" di dashboard atau sediakan file credential.json.'
  );
}
