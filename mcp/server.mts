/**
 * OmniCast MCP server (stdio).
 *
 * Exposes the whole URL → promo-video pipeline as MCP tools so an agent can hand over a URL and get
 * a finished, publishable video back — with no arguments required beyond the URL (every other
 * default comes from `.env` via src/lib/runtimeConfig.ts).
 *
 * ── THE ONE RULE OF A STDIO MCP SERVER ────────────────────────────────────────────────────────────
 * stdout is the protocol channel. A single stray `console.log` corrupts the JSON-RPC stream and the
 * client reports a confusing parse error. The pipeline and its dependencies log generously
 * (`[omnicast:…]`, `[kieClaude]`, `[SupabaseClient]`), so stdout is redirected to stderr below,
 * before any tool can run. Never use console.log in this file either — use log().
 *
 * ── WHY generate RETURNS IMMEDIATELY ─────────────────────────────────────────────────────────────
 * A run takes ~100 s (plan + render + poster). MCP tool calls are expected to return promptly, and a
 * long call looks like a hang. So `omnicast_generate` enqueues the work, returns a `runId` at once,
 * and the caller polls `omnicast_status`. All progress is also written to `runs/<runId>/run.json`, so
 * status survives an agent restart.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// ── stdout redirection MUST happen before anything logs ──────────────────────────────────────────
// (kept as the first executable statement; the imports above are side-effect free)
const ORIGINAL_STDOUT_LOG = console.log.bind(console);
console.log = (...args: unknown[]): void => {
  console.error(...args);
};
console.info = console.log;

/**
 * ── WHY THIS SERVER RELOCATES ITSELF ─────────────────────────────────────────────────────────────
 * `hermes mcp add` has no --cwd option, so the process inherits whatever directory the host agent was
 * started in. Everything downstream is cwd-relative: `.env` (Supabase + kie.ai keys), `prompts/brag/`,
 * `public/`, and `runs/`. Starting from the wrong directory would silently lose the API keys and
 * write runs into the wrong place.
 *
 * So the project root is derived from this file's own location (mcp/server.ts → ..) and we chdir there
 * before loading `.env`. The heavy modules are then imported DYNAMICALLY, after the chdir, because
 * static ESM imports would be hoisted above it — and src/omnicast.ts itself does `import 'dotenv/config'`,
 * which would otherwise read the wrong directory.
 */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(PROJECT_ROOT);
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const { runOmnicast, readRun, listRuns, makeRunId } = await import('../src/omnicast');
const { loadOmnicastConfig, FORMATS } = await import('../src/lib/runtimeConfig');
type OmnicastRequest = import('../src/omnicast').OmnicastRequest;
type OmnicastRun = import('../src/omnicast').OmnicastRun;
type FormatName = import('../src/lib/runtimeConfig').FormatName;
type OmnicastMode = import('../src/lib/runtimeConfig').OmnicastMode;

/** Diagnostics go to stderr only. */
function log(msg: string): void {
  console.error(`[omnicast-mcp] ${msg}`);
}

// ── Run queue ────────────────────────────────────────────────────────────────────────────────────
// Renders are CPU-bound, so runs are serialised (configurable). Queued runs are tracked in memory so
// `omnicast_status` can answer during the gap before the pipeline writes its first checkpoint file.

const MAX_CONCURRENT = Math.max(1, Number(process.env.OMNICAST_MAX_CONCURRENT_RUNS) || 1);

interface QueuedRun {
  runId: string;
  request: OmnicastRequest;
  queuedAt: string;
}

const queue: QueuedRun[] = [];
const active = new Set<string>();
const pending = new Map<string, QueuedRun>();

function pump(): void {
  while (active.size < MAX_CONCURRENT && queue.length > 0) {
    const entry = queue.shift()!;
    active.add(entry.runId);
    pending.delete(entry.runId);
    log(`starting run ${entry.runId} (${active.size}/${MAX_CONCURRENT} active, ${queue.length} queued)`);

    // Deliberately not awaited: the tool call has already returned. runOmnicast records the failure
    // in run.json before rethrowing, so swallowing here loses nothing.
    void runOmnicast(entry.request)
      .then((run) => log(`run ${run.runId} → ${run.status}`))
      .catch((err: unknown) => log(`run ${entry.runId} failed: ${(err as Error).message.split('\n')[0]}`))
      .finally(() => {
        active.delete(entry.runId);
        pump();
      });
  }
}

/** Compact, agent-friendly view — a full OmnicastRun can be tens of KB. */
function summarise(run: OmnicastRun): Record<string, unknown> {
  return {
    runId: run.runId,
    status: run.status,
    url: run.url,
    title: run.title,
    mode: run.mode,
    tone: run.tone,
    format: run.format,
    durationSeconds: run.durationSeconds,
    model: run.model,
    videoPath: run.videoPath,
    posterPath: run.posterPath,
    shareCopy: run.shareCopy,
    keyConcepts: run.plan?.keyConcepts,
    scenes: run.plan?.storyboard.map((s) => ({
      name: s.name,
      seconds: s.seconds,
      text: s.text,
      visualSource: s.visualSource,
    })),
    warnings: run.warnings,
    corrections: run.corrections,
    error: run.error,
    runDir: run.runDir,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
  };
}

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const failure = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

// ── Server ───────────────────────────────────────────────────────────────────────────────────────

const server = new McpServer({ name: 'omnicast', version: '1.0.0' });

server.tool(
  'omnicast_generate',
  [
    'Turn a URL into a short promo video that also explains the URL\'s key concepts.',
    'Renders a 15-25s vertical (or landscape/square) video with real screenshots of the page, music,',
    'sound effects and a baked poster frame. Returns immediately with a runId — poll omnicast_status',
    'until status is "done" (typically ~100s), then use videoPath.',
    'Every argument except url is optional and falls back to .env defaults; url may also be omitted if',
    'OMNICAST_DEFAULT_URL is set. Call with {} to use all defaults.',
  ].join(' '),
  {
    url: z.string().optional().describe('Source http(s) URL or path to a .pdf. Falls back to OMNICAST_DEFAULT_URL.'),
    mode: z.enum(['promo', 'explainer', 'both']).optional().describe('promo = the 15-25s brag video (default). explainer/both are not yet wired for unattended runs.'),
    tone: z.string().optional().describe("brag preset (default, polished, yc-parody, chaotic, deadpan, cinematic, app-store) or freeform direction like 'fake Series A launch'."),
    format: z.enum(['vertical', 'landscape', 'square']).optional().describe('vertical 1080x1920 (default), landscape 1920x1080, square 1080x1080.'),
    durationSeconds: z.number().optional().describe('Target length in seconds; clamped to 15-25.'),
    voice: z.boolean().optional().describe('ElevenLabs narration. Off by default; if narration overflows a scene the run fails rather than truncating.'),
    voiceId: z.string().optional().describe('ElevenLabs voice id for narration. Falls back to OMNICAST_VOICE_ID, then the built-in default voice. Only used when voice is enabled.'),
    model: z.string().optional().describe('Claude alias for the brag planning pass, e.g. "claude-opus-5-5" or "claude-sonnet-5" (cheaper/faster). Falls back to OMNICAST_BRAG_MODEL, then OMNICAST_BRAG_MODEL_FALLBACKS.'),
    musicTrackId: z.string().optional().describe('Bundled brag track id, e.g. "happy-beats-business-moves-vol-1-by-ende-dot-app". Falls back to OMNICAST_MUSIC_TRACK, then a track picked from the tone. An unknown id fails the run and lists the available tracks.'),
    music: z.boolean().optional().describe('Include the music bed. Default from OMNICAST_MUSIC.'),
    sfx: z.boolean().optional().describe('Include sound effects. Default from OMNICAST_SFX.'),
    captions: z.boolean().optional().describe('Burn in word-level captions (needs voice).'),
    publish: z.boolean().optional().describe('Publish to YouTube after rendering. Privacy comes from YOUTUBE_PRIVACY (unlisted by default).'),
    publishDryRun: z.boolean().optional().describe('With publish: validate YouTube auth + metadata without uploading. Uses no API quota.'),
  },
  async (args) => {
    const cfg = loadOmnicastConfig();
    const request: OmnicastRequest = {
      url: args.url,
      mode: args.mode as OmnicastMode | undefined,
      tone: args.tone,
      format: args.format as FormatName | undefined,
      durationSeconds: args.durationSeconds,
      voice: args.voice,
      voiceId: args.voiceId,
      model: args.model,
      musicTrackId: args.musicTrackId,
      music: args.music,
      sfx: args.sfx,
      captions: args.captions,
      publish: args.publish,
      publishDryRun: args.publishDryRun,
    };

    // Fail fast on a missing URL rather than enqueuing work that can only fail.
    if (!args.url && !cfg.defaultUrl) {
      return failure(
        'No URL supplied and OMNICAST_DEFAULT_URL is not set. Pass `url`, or set OMNICAST_DEFAULT_URL in .env ' +
          'for fully argument-free runs.',
      );
    }

    // Fail fast when the mode that WOULD be used is one the pipeline cannot run unattended. Without
    // this, a stray `OMNICAST_DEFAULT_MODE=both` in .env turns every no-arg call into a queued run
    // that fails ~10s later with an error the caller has to dig out of run.json.
    const effectiveMode = args.mode ?? cfg.defaultMode;
    if (effectiveMode === 'explainer' || effectiveMode === 'both') {
      const source = args.mode ? 'the "mode" argument' : 'OMNICAST_DEFAULT_MODE in .env';
      return failure(
        `Mode "${effectiveMode}" (from ${source}) is not implemented for unattended runs yet. ` +
          'The existing explainer pipeline reads its options from interactive stdin prompts, so it cannot be ' +
          'driven from a tool call. Use mode "promo", or run `npm run generate` manually for the explainer.',
      );
    }

    const runId = makeRunId();
    const entry: QueuedRun = { runId, request: { ...request, runId }, queuedAt: new Date().toISOString() };
    queue.push(entry);
    pending.set(runId, entry);
    log(`queued ${runId} (url=${args.url ?? cfg.defaultUrl}, queue depth ${queue.length})`);
    pump();

    return text({
      runId,
      status: queue.length > 0 && active.size >= MAX_CONCURRENT ? 'queued' : 'starting',
      runDir: `${cfg.paths.runsDir}/${runId}`,
      queuePosition: queue.findIndex((q) => q.runId === runId) + 1 || null,
      pollWith: 'omnicast_status',
      note: 'Runs take roughly 90-120s (plan + render + poster). Poll omnicast_status until status is "done".',
    });
  },
);

server.tool(
  'omnicast_status',
  'Check a run started by omnicast_generate. Returns status (queued/capturing/planning/assets/audio/rendering/poster/publishing/done/failed), the video path when finished, plus warnings and corrections. Reads from disk, so it works across restarts.',
  {
    runId: z.string().describe('Run id from omnicast_generate, or a unique prefix of one.'),
    verbose: z.boolean().optional().describe('Include the full pipeline log (can be long).'),
  },
  async (args) => {
    const run = readRun(args.runId);

    if (!run) {
      const queued = pending.get(args.runId);
      if (queued) {
        return text({ runId: queued.runId, status: 'queued', queuedAt: queued.queuedAt, note: 'Not started yet — the pipeline has not written its first checkpoint.' });
      }
      const recent = listRuns(5).map((r) => r.runId);
      return failure(`No run matching "${args.runId}". Recent runs: ${recent.join(', ') || '(none)'}`);
    }

    const summary = summarise(run);
    if (args.verbose) summary.log = run.log;
    return text(summary);
  },
);

server.tool(
  'omnicast_publish',
  [
    'Publish a finished run to YouTube.',
    'Uploads with a resumable session, sets the poster as the thumbnail, then reads the video back and',
    'asserts the title and privacy actually landed. Refuses before consuming quota if the metadata would',
    'be rejected (title >100 chars, < or > in text, >500 chars of tags, non-numeric category).',
    'Privacy defaults to YOUTUBE_PRIVACY (unlisted) — pass privacy:"public" explicitly to go live.',
    'Pass dryRun:true to validate auth + metadata without uploading.',
  ].join(' '),
  {
    runId: z.string().describe('A run whose status is "done".'),
    privacy: z.enum(['private', 'unlisted', 'public']).optional().describe('Defaults to YOUTUBE_PRIVACY (usually unlisted).'),
    title: z.string().optional().describe('Override the generated title (max 100 chars).'),
    description: z.string().optional().describe('Override the generated description (max 5000 bytes).'),
    tags: z.array(z.string()).optional().describe('Extra tags, merged with the generated ones within the 500-char budget.'),
    dryRun: z.boolean().optional().describe('Validate credentials and metadata without uploading. Uses no API quota.'),
  },
  async (args) => {
    const run = readRun(args.runId);
    if (!run) return failure(`No run matching "${args.runId}".`);
    if (!run.plan) return failure(`Run ${run.runId} has no stored plan, so upload metadata cannot be built.`);
    if (!run.videoPath || !fs.existsSync(run.videoPath)) {
      return failure(`Run ${run.runId} is "${run.status}" and has no video on disk yet. Wait for status "done".`);
    }

    const cfg = loadOmnicastConfig();
    const { buildMetadata, uploadVideo } = await import('../src/lib/youtubePublisher');

    const metadata = buildMetadata({
      plan: run.plan,
      privacy: args.privacy ?? cfg.youtube.privacy,
      categoryId: cfg.youtube.categoryId,
      madeForKids: cfg.youtube.madeForKids,
      defaultTags: cfg.youtube.defaultTags,
      isVertical: run.format === 'vertical',
      durationSeconds: run.durationSeconds,
      overrides: { title: args.title, description: args.description, tags: args.tags },
      sourceUrl: run.url,
    });

    try {
      const result = await uploadVideo({
        videoPath: run.videoPath,
        metadata,
        creds: { clientId: cfg.youtube.clientId, clientSecret: cfg.youtube.clientSecret, refreshToken: cfg.youtube.refreshToken },
        thumbnailPath: run.posterPath,
        dryRun: args.dryRun ?? false,
      });

      // Keep run.json the single source of truth: a later omnicast_status must show the URL.
      if (!args.dryRun) {
        run.youtubeUrl = result.watchUrl;
        run.updatedAt = new Date().toISOString();
        fs.writeFileSync(path.join(run.runDir, 'run.json'), JSON.stringify(run, null, 2));
      }

      return text({
        runId: run.runId,
        dryRun: Boolean(args.dryRun),
        videoId: result.videoId,
        watchUrl: result.watchUrl,
        shortsUrl: result.isShort ? result.shortsUrl : null,
        thumbnailSet: result.thumbnailSet,
        verified: result.verified,
        warnings: result.warnings,
        title: metadata.title,
        privacyStatus: metadata.privacyStatus,
        tags: metadata.tags,
        metadataWarnings: metadata.warnings,
      });
    } catch (err) {
      // Provider errors carry Google's own message plus any reason codes — surface them verbatim.
      const e = err as { message?: string; providerBody?: string };
      return failure(`${e.message ?? String(err)}${e.providerBody ? `\n\nProvider response:\n${e.providerBody}` : ''}`);
    }
  },
);

server.tool(
  'omnicast_list_runs',
  'List recent OmniCast runs, newest first, with their status and video paths.',
  {
    limit: z.number().optional().describe('How many runs to return (default 10).'),
  },
  async (args) => {
    const runs = listRuns(args.limit ?? 10);
    if (runs.length === 0) return text({ runs: [], note: 'No runs yet. Call omnicast_generate first.' });
    return text({ count: runs.length, runs: runs.map(summarise) });
  },
);

server.tool(
  'omnicast_defaults',
  'Show the effective defaults an argument-free omnicast_generate call would use (from .env), plus the available tone presets and formats. Useful before spending a render.',
  {},
  async () => {
    const cfg = loadOmnicastConfig();
    return text({
      defaults: {
        url: cfg.defaultUrl || null,
        mode: cfg.defaultMode,
        tone: cfg.defaultTone,
        format: cfg.defaultFormat,
        durationSeconds: cfg.defaultDurationSeconds,
        voice: cfg.voice.enabled,
        voiceId: cfg.voice.voiceId || null,
        music: cfg.music.enabled,
        musicTrackId: cfg.music.trackId || null,
        sfx: cfg.sfx.enabled,
        captions: cfg.captions,
        publish: cfg.youtube.enabled,
      },
      bragModel: cfg.brag.model,
      bragFallbacks: cfg.brag.modelFallbacks,
      formats: FORMATS,
      tones: ['default', 'polished', 'yc-parody', 'chaotic', 'deadpan', 'cinematic', 'app-store'],
      maxConcurrentRuns: MAX_CONCURRENT,
      // Surface an unimplemented default mode loudly — otherwise it is invisible until a call fails.
      ...(cfg.defaultMode === 'explainer' || cfg.defaultMode === 'both'
        ? {
            warning:
              `OMNICAST_DEFAULT_MODE="${cfg.defaultMode}" is NOT implemented for unattended runs. Calls that omit ` +
              '`mode` will be rejected. Set OMNICAST_DEFAULT_MODE=promo in .env, or pass mode explicitly.',
          }
        : {}),
      // Exposed so a client can verify the server relocated itself to the project root — the keys,
      // prompts and runs/ directory are all resolved relative to this.
      projectRoot: process.cwd(),
      note: cfg.defaultUrl
        ? 'omnicast_generate can be called with {} — a default URL is configured.'
        : 'omnicast_generate requires a url, because OMNICAST_DEFAULT_URL is not set.',
    });
  },
);

// ── Boot ─────────────────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const cfg = loadOmnicastConfig();
  log(`ready — model=${cfg.brag.model} format=${cfg.defaultFormat} tone=${cfg.defaultTone} maxConcurrent=${MAX_CONCURRENT}`);
  log(cfg.defaultUrl ? `default url: ${cfg.defaultUrl}` : 'no default url configured (url is required per call)');

  // Surface the original stdout logger for nothing but an explicit escape hatch.
  void ORIGINAL_STDOUT_LOG;
}

main().catch((err: unknown) => {
  log(`FATAL: ${(err as Error).stack ?? String(err)}`);
  process.exit(1);
});
