#!/usr/bin/env tsx
/**
 * youtube-auth.ts — one-time OAuth 2.0 helper to mint a YouTube refresh token.
 *
 * Usage:
 *   npm run youtube:auth              # authorize, write the token to a 0600 file
 *   npm run youtube:auth -- --print   # also print the token to stdout (for pasting into .env)
 *   npm run youtube:auth -- --revoke <token>   # revoke a refresh token at Google
 *
 * Prerequisites:
 *   1. YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env
 *   2. "YouTube Data API v3" enabled in Google Cloud Console → APIs & Services
 *   3. http://localhost:3456/callback registered as an authorized redirect URI on the OAuth client
 *
 * Hardening decisions (see the Phase 7 review):
 *   · `state` nonce — verified on the callback. Without it, any local process or web page that can
 *     reach the loopback port could inject an authorization code and bind this app's stored refresh
 *     token to a flow of their choosing (authorization-code injection).
 *   · PKCE (S256) — an intercepted code is useless without the verifier, which never leaves memory.
 *   · Least-privilege scopes — upload + thumbnail + read-back only. The previous version requested
 *     `auth/youtube`, i.e. full read/write on the channel (delete videos, edit playlists). A refresh
 *     token does not expire, so that scope is a standing credential with far more power than needed.
 *     NOTE: narrowing scopes only takes effect when you RE-MINT.
 *   · Secrets are written to a 0600 file rather than printed, so they stay out of terminal scrollback,
 *     screen shares and captured logs. `--print` is opt-in.
 *   · No shell interpolation (`spawn` with an args array, not `execSync` with a template string).
 *   · `server.listen` has an error handler, so a busy port produces a readable message.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { URL, URLSearchParams, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import { revokeRefreshToken } from '../src/lib/youtubePublisher';

// Self-locating, so running the script from another directory does not silently lose .env
// (the same fix applied to mcp/server.mts, which has no --cwd when registered with Hermes).
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(PROJECT_ROOT);
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const REDIRECT_URI = 'http://localhost:3456/callback';
const PORT = 3456;
const TOKEN_FILE = path.join(PROJECT_ROOT, '.youtube-refresh-token');

/**
 * Least privilege: upload a video, set its thumbnail, and read it back to verify what landed.
 * Deliberately NOT `auth/youtube`, which grants delete/edit across the whole channel.
 */
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.force-ssl', // thumbnails.set + captions
  'https://www.googleapis.com/auth/youtube.readonly', // videos.list read-back
];

const base64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ── 0. --revoke path ─────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes('--revoke')) {
  const token = argv[argv.indexOf('--revoke') + 1] || process.env.YOUTUBE_REFRESH_TOKEN;
  if (!token) {
    console.error('❌  Pass a token: npm run youtube:auth -- --revoke <refresh_token>');
    process.exit(1);
  }
  try {
    await revokeRefreshToken(token);
    console.log('✅  Refresh token revoked. Mint a new one with: npm run youtube:auth');
    process.exit(0);
  } catch (err) {
    const body = (err as { providerBody?: string }).providerBody ?? '';
    // Revoking an already-dead token is the NORMAL case (you revoke the old token after re-minting),
    // and Google answers 400 invalid_token. The desired end state is already true, so this is not a
    // failure — but it is stated, not swallowed.
    if (/"error"\s*:\s*"invalid_token"/.test(body)) {
      console.log(
        'ℹ️   Google reports this token as already invalid (invalid_token) — it was already revoked,\n' +
          '     expired, or never valid. Nothing to revoke.',
      );
      process.exit(0);
    }
    console.error(`❌  Revoke failed: ${(err as Error).message}`);
    if (body) console.error(`    Google said: ${body}`);
    process.exit(1);
  }
}

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌  YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

// ── 1. Per-run secrets: CSRF state + PKCE verifier ───────────────────────────
const state = base64url(crypto.randomBytes(24));
const codeVerifier = base64url(crypto.randomBytes(48));
const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES.join(' '));
authUrl.searchParams.set('access_type', 'offline'); // what makes Google issue a refresh token
authUrl.searchParams.set('prompt', 'consent'); // force consent so we always receive one
authUrl.searchParams.set('state', state);
authUrl.searchParams.set('code_challenge', codeChallenge);
authUrl.searchParams.set('code_challenge_method', 'S256');

console.log('\n🔑  YouTube OAuth — Refresh Token Generator\n');
console.log('Scopes requested (least privilege):');
for (const s of SCOPES) console.log(`   · ${s.replace('https://www.googleapis.com/auth/', '')}`);
console.log('\nOpening your browser to authorize…\n');
console.log(`   ${authUrl.toString()}\n`);

// spawn with an args array — no shell, so nothing in the URL can be interpreted as a command.
try {
  spawn('open', [authUrl.toString()], { stdio: 'ignore', detached: true }).unref();
} catch {
  console.log('⚠️  Could not auto-open a browser. Open the URL above manually.');
}

// ── 2. Local server to catch the redirect ────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname !== '/callback') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const fail = (heading: string, detail: string): void => {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`<h1>❌ ${heading}</h1><pre>${detail}</pre>`);
    console.error(`\n❌  ${heading}: ${detail}`);
    server.close(() => process.exit(1));
  };

  const returnedState = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');

  // Verify state BEFORE the code is used: a mismatch means this callback was not initiated by us.
  if (returnedState !== state) {
    fail('State mismatch', 'This authorization response did not originate from the request this script made. Ignored.');
    return;
  }
  if (error) {
    fail('Authorization failed', error);
    return;
  }
  if (!code) {
    fail('No code received', 'Google redirected back without an authorization code.');
    return;
  }

  // ── 3. Exchange the code (with the PKCE verifier) for tokens ───────────────
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
        code_verifier: codeVerifier,
      }).toString(),
    });

    const tokens = (await tokenRes.json()) as Record<string, unknown>;
    const refreshToken = tokens.refresh_token as string | undefined;

    if (!tokenRes.ok || !refreshToken) {
      // Print the provider's own error — silently swallowing it makes re-auth guesswork.
      fail('Token exchange failed', JSON.stringify(tokens, null, 2));
      return;
    }

    // Write the secret to a locked-down file instead of stdout.
    fs.writeFileSync(TOKEN_FILE, `${refreshToken}\n`, { mode: 0o600 });
    const masked = `${refreshToken.slice(0, 6)}…${refreshToken.slice(-4)}`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html><body style="font-family:system-ui;max-width:620px;margin:4rem auto;text-align:center">
        <h1>✅ Authorized</h1>
        <p>Your refresh token was saved to<br><code>.youtube-refresh-token</code> (mode 0600).</p>
        <p>Add it to <code>.env</code> and you can close this tab.</p>
      </body></html>
    `);

    console.log('─'.repeat(64));
    console.log('✅  Authorized.\n');
    console.log(`   Token written to : ${TOKEN_FILE}  (${masked}, mode 0600)`);
    console.log('   Add to .env      : YOUTUBE_REFRESH_TOKEN=<contents of that file>');
    console.log('\n   To print it (careful — terminal scrollback persists):');
    console.log('     npm run youtube:auth -- --print   (after re-running the flow)');
    console.log(`   Or read it:      cat ${path.relative(PROJECT_ROOT, TOKEN_FILE)}`);
    console.log('\n   Delete the file once it is in .env:');
    console.log(`     rm ${path.relative(PROJECT_ROOT, TOKEN_FILE)}`);
    console.log('─'.repeat(64));

    if (argv.includes('--print')) {
      console.log('\nYOUTUBE_REFRESH_TOKEN=' + refreshToken + '\n');
    }

    server.close(() => process.exit(0));
  } catch (err) {
    fail('Error exchanging code', String(err));
  }
});

// A busy port must read as a clear message, not an unhandled EADDRINUSE stack trace.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `❌  Port ${PORT} is already in use, so the OAuth redirect cannot be captured.\n` +
        `   Find it with:  lsof -i :${PORT}\n` +
        `   Free it, then re-run: npm run youtube:auth`,
    );
  } else {
    console.error('❌  Local server error:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Listening on ${REDIRECT_URI} …`);
  console.log('Waiting for Google to redirect back…\n');
});
