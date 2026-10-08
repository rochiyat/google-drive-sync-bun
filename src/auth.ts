import { Elysia } from 'elysia';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import {
  getAuthState,
  setAuthState,
  deleteAuthState,
} from './database';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * Resolves OAuth Client ID and Secret from:
 * 1. Environment variables
 * 2. SQLite auth_state table
 * 3. Local JSON files (oauth_credentials.json or client_secret*.json)
 */
export function getOAuthConfig(): OAuthConfig {
  // 1. Environment variables
  let clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
  let clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';

  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }

  // 2. Database auth_state
  const dbClientId = getAuthState('oauth_client_id');
  const dbClientSecret = getAuthState('oauth_client_secret');
  if (dbClientId && dbClientSecret) {
    return { clientId: dbClientId, clientSecret: dbClientSecret };
  }

  // 3. Check JSON files in app directory
  const appDir = path.dirname(process.execPath || process.argv[0]);
  const candidates = [
    path.join(process.cwd(), 'oauth_credentials.json'),
    path.join(appDir, 'oauth_credentials.json'),
    path.join(process.cwd(), 'client_secret.json'),
    path.join(appDir, 'client_secret.json'),
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const config = raw.web || raw.installed;
        if (config?.client_id && config?.client_secret) {
          return {
            clientId: config.client_id,
            clientSecret: config.client_secret,
          };
        }
      } catch {
        // Continue checking
      }
    }
  }

  return { clientId, clientSecret };
}

/**
 * Returns a configured google.auth.OAuth2 instance
 */
export function getOAuth2Client(customRedirectUri?: string) {
  const { clientId, clientSecret } = getOAuthConfig();
  if (!clientId || !clientSecret) return null;

  const port = Number(process.env.PORT || 3000);
  const redirectUri = customRedirectUri || `http://localhost:${port}/auth/callback`;

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Returns an authenticated OAuth2 instance if user is logged in
 */
export function getAuthenticatedOAuth2Client() {
  const client = getOAuth2Client();
  if (!client) return null;

  const tokensRaw = getAuthState('oauth_tokens');
  if (!tokensRaw) return null;

  try {
    const tokens = JSON.parse(tokensRaw);
    client.setCredentials(tokens);

    // Auto-update tokens in database when refreshed
    client.on('tokens', (newTokens) => {
      const merged = { ...tokens, ...newTokens };
      setAuthState('oauth_tokens', JSON.stringify(merged));
    });

    return client;
  } catch {
    return null;
  }
}

/**
 * Checks if Service Account is available
 */
export function hasServiceAccount(): boolean {
  const credFile = process.env.GOOGLE_CREDENTIAL || 'credential.json';
  const appDir = path.dirname(process.execPath || process.argv[0]);
  const paths = [credFile, path.join(appDir, credFile)];
  return paths.some((p) => {
    try {
      if (fs.existsSync(p)) {
        const content = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return content.type === 'service_account';
      }
    } catch {
      return false;
    }
    return false;
  });
}

/**
 * Elysia Auth Plugin
 */
export const authPlugin = new Elysia({ prefix: '/auth' })

  // GET /auth/status — Check current authentication state
  .get('/status', async () => {
    const oauthClient = getAuthenticatedOAuth2Client();
    const config = getOAuthConfig();
    const hasSA = hasServiceAccount();

    if (oauthClient) {
      let userInfo = null;
      const userRaw = getAuthState('oauth_user_info');
      if (userRaw) {
        try {
          userInfo = JSON.parse(userRaw);
        } catch {
          // Ignore
        }
      }

      return {
        authenticated: true,
        mode: 'oauth' as const,
        user: userInfo,
        oauthConfigured: true,
        hasServiceAccount: hasSA,
      };
    }

    if (hasSA) {
      return {
        authenticated: true,
        mode: 'service_account' as const,
        user: null,
        oauthConfigured: Boolean(config.clientId && config.clientSecret),
        hasServiceAccount: true,
      };
    }

    return {
      authenticated: false,
      mode: 'none' as const,
      user: null,
      oauthConfigured: Boolean(config.clientId && config.clientSecret),
      hasServiceAccount: false,
    };
  })

  // GET /auth/login — Redirect to Google OAuth consent page
  .get('/login', ({ redirect, set }) => {
    const client = getOAuth2Client();
    if (!client) {
      set.status = 400;
      return {
        error: 'OAuth Client ID & Secret belum dikonfigurasi. Silakan isi di form konfigurasi terlebih dahulu.',
      };
    }

    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
    });

    return redirect(authUrl);
  })

  // GET /auth/callback — Google redirects here with ?code=...
  .get('/callback', async ({ query, set }) => {
    const code = query?.code as string | undefined;
    if (!code) {
      set.status = 400;
      return new Response('<h3>Error: Authorization code tidak ditemukan.</h3>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const client = getOAuth2Client();
    if (!client) {
      set.status = 500;
      return new Response('<h3>Error: OAuth client tidak terkonfigurasi.</h3>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    try {
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);
      setAuthState('oauth_tokens', JSON.stringify(tokens));

      // Fetch user profile info
      try {
        const oauth2 = google.oauth2({ version: 'v2', auth: client });
        const res = await oauth2.userinfo.get();
        if (res.data) {
          setAuthState(
            'oauth_user_info',
            JSON.stringify({
              email: res.data.email,
              name: res.data.name,
              picture: res.data.picture,
            })
          );
        }
      } catch (err) {
        console.warn('Gagal mengambil data profil Google:', err);
      }

      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Login Berhasil — Drive Sync</title>
  <style>
    body {
      background: #0a0a12;
      color: #f5f5f7;
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      text-align: center;
    }
    .box {
      background: rgba(17, 17, 28, 0.95);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 20px;
      padding: 48px 40px;
      max-width: 420px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.5);
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h2 { margin: 0 0 10px; color: #38bdf8; font-size: 24px; }
    p { color: #a1a1aa; font-size: 14px; line-height: 1.5; margin-bottom: 24px; }
    a {
      display: inline-block;
      padding: 12px 24px;
      background: #38bdf8;
      color: #000;
      font-weight: 600;
      text-decoration: none;
      border-radius: 12px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">🎉</div>
    <h2>Login Berhasil!</h2>
    <p>Akun Google Anda telah terhubung. Anda dapat menutup tab ini atau kembali ke dashboard.</p>
    <a href="/">Kembali ke Dashboard</a>
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
      setTimeout(() => window.close(), 1200);
    } else {
      setTimeout(() => { window.location.href = '/'; }, 1500);
    }
  </script>
</body>
</html>`;

      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    } catch (err: any) {
      set.status = 500;
      return new Response(
        `<h3>Gagal menukar token otorisasi: ${err?.message || String(err)}</h3>`,
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }
  })

  // POST /auth/logout — Logout user
  .post('/logout', () => {
    deleteAuthState('oauth_tokens');
    deleteAuthState('oauth_user_info');
    return { success: true };
  })

  // GET /auth/config — Check if OAuth client ID & secret are configured
  .get('/config', () => {
    const config = getOAuthConfig();
    return {
      hasClientId: Boolean(config.clientId),
      clientIdMasked: config.clientId
        ? config.clientId.slice(0, 10) + '...' + config.clientId.slice(-15)
        : '',
      hasClientSecret: Boolean(config.clientSecret),
    };
  })

  // POST /auth/config — Save Client ID & Secret
  .post('/config', ({ body }: any) => {
    const { clientId, clientSecret } = body || {};
    if (!clientId || !clientSecret) {
      return { success: false, message: 'Client ID dan Client Secret wajib diisi.' };
    }

    setAuthState('oauth_client_id', clientId.trim());
    setAuthState('oauth_client_secret', clientSecret.trim());
    return { success: true };
  });
