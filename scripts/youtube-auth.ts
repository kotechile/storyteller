#!/usr/bin/env tsx
/**
 * youtube-auth.ts — One-time OAuth 2.0 helper to mint a YouTube refresh token.
 *
 * Usage:
 *   npm run youtube:auth
 *
 * Prerequisites:
 *   1. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in your .env
 *   2. In Google Cloud Console → APIs & Services → OAuth consent screen,
 *      make sure "YouTube Data API v3" is enabled.
 *   3. Your OAuth client must have http://localhost:3456/callback as an
 *      authorized redirect URI.
 *
 * What it does:
 *   - Starts a tiny local HTTP server on port 3456
 *   - Opens your browser to Google's consent page
 *   - Catches the redirect, exchanges the code for tokens
 *   - Prints the YOUTUBE_REFRESH_TOKEN for you to paste into .env
 */

import http from 'node:http';
import { URL, URLSearchParams } from 'node:url';
import { execSync } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config();

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3456/callback';
const PORT = 3456;

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    '❌  YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET must be set in .env',
  );
  process.exit(1);
}

// ── 1. Build the consent URL ──────────────────────────────────────────────────
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES.join(' '));
authUrl.searchParams.set('access_type', 'offline');   // ← this is what gives us the refresh token
authUrl.searchParams.set('prompt', 'consent');         // force consent so we always get refresh_token

console.log('\n🔑  YouTube OAuth — Refresh Token Generator\n');
console.log('Opening your browser to authorize…\n');
console.log(`   ${authUrl.toString()}\n`);

// Open browser (macOS)
try {
  execSync(`open "${authUrl.toString()}"`);
} catch {
  console.log('⚠️  Could not auto-open browser. Please open the URL above manually.');
}

// ── 2. Local server to catch the redirect ─────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname !== '/callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`<h1>❌ Authorization failed</h1><p>${error}</p>`);
    console.error(`\n❌  Authorization failed: ${error}`);
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h1>❌ No code received</h1>');
    return;
  }

  // ── 3. Exchange authorization code for tokens ─────────────────────────────
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID!,
        client_secret: CLIENT_SECRET!,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }).toString(),
    });

    const tokens = (await tokenRes.json()) as Record<string, unknown>;

    if (!tokenRes.ok || !tokens.refresh_token) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(
        `<h1>❌ Token exchange failed</h1><pre>${JSON.stringify(tokens, null, 2)}</pre>`,
      );
      console.error('\n❌  Token exchange failed:', tokens);
      process.exit(1);
    }

    const refreshToken = tokens.refresh_token as string;

    // Success page
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html><body style="font-family:system-ui;max-width:600px;margin:4rem auto;text-align:center">
        <h1>✅ Authorized!</h1>
        <p>Your refresh token has been printed in the terminal.<br>
        You can close this tab.</p>
      </body></html>
    `);

    // Print to terminal
    console.log('─'.repeat(60));
    console.log('✅  Success! Add this to your .env:\n');
    console.log(`YOUTUBE_REFRESH_TOKEN=${refreshToken}`);
    console.log('─'.repeat(60));
    console.log('\nAccess token (for testing, expires in ~1h):', tokens.access_token);

    // Shut down
    server.close(() => process.exit(0));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h1>❌ Error</h1><pre>${String(err)}</pre>`);
    console.error('\n❌  Error exchanging code:', err);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}/callback …`);
  console.log('Waiting for Google to redirect back…\n');
});
