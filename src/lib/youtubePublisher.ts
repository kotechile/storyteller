/**
 * YouTube publishing.
 *
 * Implemented with plain `fetch` rather than the `googleapis` package: this needs exactly three
 * endpoints (token refresh, resumable upload init/put, thumbnails.set, videos.list) and googleapis
 * is a very large dependency to carry for that. It also keeps error handling consistent with the rest
 * of this codebase, which surfaces provider errors verbatim.
 *
 * A **resumable** upload is used deliberately: it needs no multipart/related body construction (which
 * fetch/FormData cannot produce directly — YouTube rejects multipart/form-data) and it survives a
 * dropped connection.
 *
 * Quota warning that shapes the design: `videos.insert` is expensive. The commonly documented cost is
 * 1,600 units against a default 10,000 units/day, i.e. roughly **6 uploads per day**. Therefore every
 * validation that can happen before the upload DOES — a rejected title must never cost a quota unit.
 */
import fs from 'fs';
import path from 'path';
import type { BragPlan } from '../types/brag';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/youtube/v3/videos';
const THUMBNAIL_ENDPOINT = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set';
const VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** YouTube's documented limits. Violating one is a hard API error, so we check before spending quota. */
export const YOUTUBE_LIMITS = {
  title: 100,
  description: 5000,
  tagsTotalChars: 500,
  tagChars: 100,
} as const;

export interface YouTubeCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface VideoMetadata {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacyStatus: 'private' | 'unlisted' | 'public';
  madeForKids: boolean;
}

export interface PublishResult {
  videoId: string;
  watchUrl: string;
  shortsUrl: string;
  /** YouTube's own view of the upload, read back after the fact. */
  verified: { title: string; privacyStatus: string; uploadStatus?: string };
  isShort: boolean;
  thumbnailSet: boolean;
  warnings: string[];
}

export class YouTubePublishError extends Error {
  constructor(
    message: string,
    /** Raw provider response body, when there was one. Never swallowed. */
    readonly providerBody?: string,
  ) {
    super(message);
    this.name = 'YouTubePublishError';
  }
}

// ── Validation (runs BEFORE any quota is spent) ────────────────────────────────────────────────────

/** YouTube rejects `<` and `>` in titles, descriptions and tags. */
const hasAngleBrackets = (s: string): boolean => /[<>]/.test(s);

export function validateMetadata(meta: VideoMetadata): string[] {
  const problems: string[] = [];

  const titleChars = [...meta.title].length; // count code points, not UTF-16 units
  if (titleChars === 0) problems.push('title is empty');
  if (titleChars > YOUTUBE_LIMITS.title) {
    problems.push(`title is ${titleChars} characters; the limit is ${YOUTUBE_LIMITS.title}. Shorten it once, specifically.`);
  }
  if (hasAngleBrackets(meta.title)) problems.push('title may not contain "<" or ">"');

  const descBytes = Buffer.byteLength(meta.description, 'utf-8');
  if (descBytes > YOUTUBE_LIMITS.description) {
    problems.push(`description is ${descBytes} bytes; the limit is ${YOUTUBE_LIMITS.description}.`);
  }
  if (hasAngleBrackets(meta.description)) problems.push('description may not contain "<" or ">"');

  const tagsTotal = meta.tags.reduce((n, t) => n + [...t].length, 0);
  if (tagsTotal > YOUTUBE_LIMITS.tagsTotalChars) {
    problems.push(`tags total ${tagsTotal} characters; the limit is ${YOUTUBE_LIMITS.tagsTotalChars}.`);
  }
  for (const tag of meta.tags) {
    if ([...tag].length > YOUTUBE_LIMITS.tagChars) problems.push(`tag "${tag.slice(0, 30)}…" exceeds ${YOUTUBE_LIMITS.tagChars} characters`);
    if (hasAngleBrackets(tag)) problems.push(`tag "${tag}" contains "<" or ">"`);
    if (tag.includes(',')) problems.push(`tag "${tag}" contains a comma — tags are passed as an array, not a comma string`);
  }

  if (!/^\d+$/.test(meta.categoryId)) problems.push(`categoryId "${meta.categoryId}" must be numeric`);

  return problems;
}

/** Clamps text to a code-point budget, preferring a word boundary. Reports whether it clipped. */
function clampText(text: string, maxChars: number, minWordBoundary = 60): { text: string; clipped: boolean } {
  const chars = [...text];
  if (chars.length <= maxChars) return { text, clipped: false };
  let cut = chars.slice(0, maxChars).join('');
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace >= minWordBoundary) cut = cut.slice(0, lastSpace);
  return { text: cut.trim(), clipped: true };
}

/** Truncates to a UTF-8 byte budget (descriptions are byte-limited, not character-limited). */
function clampBytes(text: string, maxBytes: number): { text: string; clipped: boolean } {
  if (Buffer.byteLength(text, 'utf-8') <= maxBytes) return { text, clipped: false };
  let out = '';
  let bytes = 0;
  for (const ch of text) {
    const size = Buffer.byteLength(ch, 'utf-8');
    if (bytes + size > maxBytes) break;
    out += ch;
    bytes += size;
  }
  return { text: out.trimEnd(), clipped: true };
}

/**
 * Builds upload metadata from the brag plan. The plan's own `youtube` block wins (Claude wrote it with
 * the source in front of it); anything missing is derived from the hook/outro/share copy.
 *
 * HARD LIMITS ARE ENFORCED HERE, not left to fail at the API. A rejected upload wastes a whole render
 * and a quota unit, so anything over budget is clamped — and every clamp is reported in `warnings`
 * so the run log states exactly what changed rather than silently shipping a shortened title.
 *
 * Shorts: a vertical video of at most 3 minutes is treated as a Short, and `#Shorts` helps discovery
 * — appended for vertical renders, with room reserved so the suffix cannot push past the limit.
 */
export function buildMetadata(opts: {
  plan: BragPlan;
  privacy: VideoMetadata['privacyStatus'];
  categoryId: string;
  madeForKids: boolean;
  defaultTags?: string[];
  isVertical: boolean;
  durationSeconds: number;
  overrides?: { title?: string; description?: string; tags?: string[] };
  sourceUrl?: string;
}): VideoMetadata & { autoTags: string[]; warnings: string[] } {
  const { plan } = opts;
  const warnings: string[] = [];
  const isShort = opts.isVertical && opts.durationSeconds <= 180;

  const rawTitle =
    (opts.overrides?.title ?? plan.youtube.title ?? '').trim() || plan.hook.trim() || plan.appName;
  const suffix = isShort && !/#shorts/i.test(rawTitle) ? ' #Shorts' : '';

  // Reserve room for the suffix BEFORE clamping, so the result can never exceed the limit.
  const titleBudget = YOUTUBE_LIMITS.title - [...suffix].length;
  const clampedTitle = clampText(rawTitle, titleBudget);
  if (clampedTitle.clipped) {
    warnings.push(
      `Title was ${[...rawTitle].length} characters and was truncated to ${[...clampedTitle.text].length} to fit YouTube's ${YOUTUBE_LIMITS.title}-character limit.`,
    );
  }
  const title = `${clampedTitle.text}${suffix}`;

  let description =
    (opts.overrides?.description ?? plan.youtube.description ?? '').trim() ||
    [plan.shareCopy, '', plan.keyConcepts.length ? `What it covers: ${plan.keyConcepts.join(' · ')}` : '']
      .filter(Boolean)
      .join('\n');

  if (isShort && !/#shorts/i.test(description)) description = `${description}\n\n#Shorts`;
  if (opts.sourceUrl) description = `${description}\n\nSource: ${opts.sourceUrl}`;

  // Clamp last, so the reserved tail (the source credit) survives where possible.
  const clampedDescription = clampBytes(description, YOUTUBE_LIMITS.description);
  if (clampedDescription.clipped) {
    warnings.push(
      `Description exceeded YouTube's ${YOUTUBE_LIMITS.description}-byte limit and was truncated — the source credit may have been cut.`,
    );
  }

  const autoTags = [
    ...(opts.defaultTags ?? []),
    ...(plan.youtube.tags ?? []),
    ...(opts.overrides?.tags ?? []),
    ...(isShort ? ['shorts'] : []),
    ...plan.keyConcepts.slice(0, 3).map((c) => c.toLowerCase()),
  ];

  // Dedupe case-insensitively, drop anything single-character, then respect the 500-char budget.
  const seen = new Set<string>();
  const tags: string[] = [];
  let dropped = 0;
  let budget = YOUTUBE_LIMITS.tagsTotalChars;
  for (const raw of autoTags) {
    const tag = raw.trim();
    if (tag.length < 2 || hasAngleBrackets(tag) || tag.includes(',')) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    if ([...tag].length > budget) {
      dropped++;
      continue;
    }
    seen.add(key);
    tags.push(tag);
    budget -= [...tag].length;
  }
  if (dropped > 0) {
    warnings.push(`${dropped} tag(s) were dropped to stay within the ${YOUTUBE_LIMITS.tagsTotalChars}-character tag budget.`);
  }

  return {
    title,
    description: clampedDescription.text,
    tags,
    categoryId: opts.categoryId,
    privacyStatus: opts.privacy,
    madeForKids: opts.madeForKids,
    autoTags,
    warnings,
  };
}

// ── Auth ──────────────────────────────────────────────────────────────────────────────────────────

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Exchanges the stored refresh token for a short-lived access token. */
export async function getAccessToken(creds: YouTubeCredentials, timeoutMs = 30_000): Promise<string> {
  for (const [label, value] of Object.entries(creds)) {
    if (!value) {
      throw new YouTubePublishError(
        `[youtube] Missing ${label}. Set YOUTUBE_${label.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()} in .env. ` +
          'Mint a refresh token with: npm run youtube:auth',
      );
    }
  }

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });

  const raw = await res.text();
  let json: TokenResponse = {};
  try {
    json = JSON.parse(raw) as TokenResponse;
  } catch {
    /* fall through to the shape check below */
  }

  // Check the SHAPE, not just the status — the same discipline used for kie.ai.
  if (!json.access_token) {
    const detail = json.error_description || json.error || raw.slice(0, 300);
    throw new YouTubePublishError(
      `[youtube] Could not obtain an access token (HTTP ${res.status}): ${detail}\n` +
        '  · invalid_grant usually means the refresh token was revoked, or was minted for a different OAuth client.\n' +
        '  · Re-run: npm run youtube:auth',
      raw.slice(0, 400),
    );
  }
  return json.access_token;
}

/** Revokes a refresh token at Google. Used by the auth helper's --revoke path. */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const res = await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(refreshToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) {
    throw new YouTubePublishError(`[youtube] Revoke failed (HTTP ${res.status})`, (await res.text()).slice(0, 300));
  }
}

// ── Upload ───────────────────────────────────────────────────────────────────────────────────────

/** Extracts Google's error message from an arbitrary response body. */
function describeGoogleError(raw: string, status: number): string {
  try {
    const j = JSON.parse(raw) as { error?: { message?: string; errors?: { reason?: string; message?: string }[] } };
    const msg = j.error?.message;
    const reasons = (j.error?.errors ?? []).map((e) => e.reason).filter(Boolean);
    if (msg) return `HTTP ${status}: ${msg}${reasons.length ? ` [${reasons.join(', ')}]` : ''}`;
  } catch {
    /* not JSON */
  }
  return `HTTP ${status}: ${raw.slice(0, 300)}`;
}

/**
 * Uploads a video using a resumable session, then optionally sets a thumbnail.
 *
 * `dryRun` performs auth + file checks + session-free validation and returns a plan of what WOULD be
 * sent — it deliberately does NOT initiate a session, so it cannot consume upload quota.
 */
export async function uploadVideo(opts: {
  videoPath: string;
  metadata: VideoMetadata;
  creds: YouTubeCredentials;
  thumbnailPath?: string;
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
}): Promise<PublishResult> {
  const { metadata } = opts;
  const warnings: string[] = [];
  const isShort = /#shorts/i.test(`${metadata.title}\n${metadata.description}`);

  // ── pre-flight: everything that can fail, fails before a single quota unit is spent ──
  const problems = validateMetadata(metadata);
  if (problems.length > 0) {
    throw new YouTubePublishError(
      `[youtube] Metadata would be rejected by the API (nothing uploaded):\n  - ${problems.join('\n  - ')}\n` +
        'Fix the plan or pass explicit title/description/tags.',
    );
  }

  if (!fs.existsSync(opts.videoPath)) {
    throw new YouTubePublishError(`[youtube] Video not found: ${opts.videoPath}`);
  }
  const stat = fs.statSync(opts.videoPath);
  if (stat.size === 0) throw new YouTubePublishError(`[youtube] Video is empty: ${opts.videoPath}`);
  if (!opts.videoPath.toLowerCase().endsWith('.mp4')) {
    warnings.push(`Video is not an .mp4 (${path.extname(opts.videoPath)}); YouTube may reject the container.`);
  }
  if (opts.thumbnailPath && !fs.existsSync(opts.thumbnailPath)) {
    throw new YouTubePublishError(`[youtube] Thumbnail not found: ${opts.thumbnailPath} (set it, or omit the thumbnail).`);
  }

  opts.onProgress?.(`pre-flight ok: ${(stat.size / 1_048_576).toFixed(2)} MB, title ${[...metadata.title].length} chars, ${metadata.tags.length} tags`);

  if (opts.dryRun) {
    return {
      videoId: '(dry-run)',
      watchUrl: '(dry-run)',
      shortsUrl: '(dry-run)',
      verified: { title: metadata.title, privacyStatus: metadata.privacyStatus },
      isShort,
      thumbnailSet: false,
      warnings: [...warnings, 'DRY RUN — no upload was performed and no quota was consumed.'],
    };
  }

  const accessToken = await getAccessToken(opts.creds);
  opts.onProgress?.('access token acquired');

  // ── 1. initiate the resumable session ──
  const initRes = await fetch(`${UPLOAD_ENDPOINT}?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(stat.size),
    },
    body: JSON.stringify({
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        categoryId: metadata.categoryId,
      },
      status: {
        // Set explicitly — never let the API default decide whether something goes public.
        privacyStatus: metadata.privacyStatus,
        selfDeclaredMadeForKids: metadata.madeForKids,
      },
    }),
  });

  const initRaw = await initRes.text();
  if (!initRes.ok) {
    throw new YouTubePublishError(`[youtube] Could not start the upload: ${describeGoogleError(initRaw, initRes.status)}`, initRaw.slice(0, 500));
  }
  const sessionUri = initRes.headers.get('location');
  if (!sessionUri) {
    throw new YouTubePublishError(
      '[youtube] Upload session started but no Location header was returned — cannot continue.',
      initRaw.slice(0, 300),
    );
  }
  opts.onProgress?.('resumable session created, uploading bytes…');

  // ── 2. upload the bytes ──
  const bytes = fs.readFileSync(opts.videoPath);
  const putRes = await fetch(sessionUri, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length) },
    body: bytes,
  });
  const putRaw = await putRes.text();

  let videoResource: { id?: string; snippet?: { title?: string }; status?: { privacyStatus?: string; uploadStatus?: string } } = {};
  try {
    videoResource = JSON.parse(putRaw) as typeof videoResource;
  } catch {
    /* handled below */
  }

  if (!putRes.ok || !videoResource.id) {
    throw new YouTubePublishError(
      `[youtube] Upload failed: ${putRes.ok ? 'no video id in the response' : describeGoogleError(putRaw, putRes.status)}`,
      putRaw.slice(0, 500),
    );
  }

  const videoId = videoResource.id;
  opts.onProgress?.(`uploaded: ${videoId}`);

  // ── 3. thumbnail (best effort — a failure here must not lose the successful upload) ──
  let thumbnailSet = false;
  if (opts.thumbnailPath) {
    try {
      const thumbBytes = fs.readFileSync(opts.thumbnailPath);
      const thumbRes = await fetch(`${THUMBNAIL_ENDPOINT}?videoId=${videoId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'image/jpeg', 'Content-Length': String(thumbBytes.length) },
        body: thumbBytes,
      });
      if (!thumbRes.ok) {
        warnings.push(`Thumbnail was not set: ${describeGoogleError((await thumbRes.text()).slice(0, 300), thumbRes.status)}`);
      } else {
        thumbnailSet = true;
      }
    } catch (err) {
      warnings.push(`Thumbnail was not set: ${(err as Error).message}`);
    }
  }

  // ── 4. read back — the upload claiming success is not the same as the video being what we asked for ──
  const verified = await verifyUpload(videoId, accessToken);
  if (verified.title !== metadata.title) {
    warnings.push(`Read-back title differs: YouTube reports "${verified.title}" but we sent "${metadata.title}".`);
  }
  if (verified.privacyStatus !== metadata.privacyStatus) {
    warnings.push(`Read-back privacy differs: YouTube reports "${verified.privacyStatus}" but we requested "${metadata.privacyStatus}".`);
  }

  return {
    videoId,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    shortsUrl: `https://www.youtube.com/shorts/${videoId}`,
    verified,
    isShort,
    thumbnailSet,
    warnings,
  };
}

/** Reads the video back from the API so we can assert what actually landed. */
export async function verifyUpload(
  videoId: string,
  accessToken: string,
): Promise<{ title: string; privacyStatus: string; uploadStatus?: string }> {
  const res = await fetch(`${VIDEOS_ENDPOINT}?id=${encodeURIComponent(videoId)}&part=snippet,status`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new YouTubePublishError(`[youtube] Could not read the video back: ${describeGoogleError(raw, res.status)}`, raw.slice(0, 400));
  }
  const json = JSON.parse(raw) as {
    items?: { snippet?: { title?: string }; status?: { privacyStatus?: string; uploadStatus?: string } }[];
  };
  const item = json.items?.[0];
  if (!item) {
    throw new YouTubePublishError(
      `[youtube] Video ${videoId} uploaded but is not readable via videos.list — it may have been removed, or the token lacks the youtube.readonly scope.`,
      raw.slice(0, 300),
    );
  }
  return {
    title: item.snippet?.title ?? '(no title)',
    privacyStatus: item.status?.privacyStatus ?? '(unknown)',
    uploadStatus: item.status?.uploadStatus,
  };
}
