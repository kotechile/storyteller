/**
 * Storyteller MCP server (stdio) — the unattended URL → narrated explainer pipeline.
 *
 * Exposes the real generation engine (nano-banana-pro / Flux 2 images + infographics, Seedance
 * animated scenes, ElevenLabs narration, `StorytellerExplainer` render) as MCP tools so an agent can
 * hand over a URL and get a finished video back. This is NOT the /brag promo route: there is no
 * marketing-storyboard layer here and no `BragPromo` composition.
 *
 * ── THE ONE RULE OF A STDIO MCP SERVER ────────────────────────────────────────────────────────────
 * stdout is the protocol channel. One stray `console.log` corrupts the JSON-RPC stream and the client
 * reports a confusing parse error. The pipeline logs generously, so stdout is redirected to stderr
 * below, before any tool can run. Never use console.log in this file — use log().
 *
 * ── WHY generate RETURNS IMMEDIATELY ─────────────────────────────────────────────────────────────
 * A run is minutes (image generation + a Seedance queue that can sit in "waiting" for 20 min + a
 * Remotion render). MCP calls must return promptly, so `storyteller_generate` enqueues, returns a
 * `runId` at once, and the caller polls `storyteller_status`. Progress is also checkpointed to
 * `runs/<runId>/run.json`, so status survives an agent restart.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// ── stdout redirection MUST happen before anything logs ──────────────────────────────────────────
console.log = (...args: unknown[]): void => {
  console.error(...args);
};
console.info = console.log;

/**
 * ── WHY THIS SERVER RELOCATES ITSELF ─────────────────────────────────────────────────────────────
 * `hermes mcp add` has no --cwd option, so the process inherits the host agent's directory.
 * Everything downstream is cwd-relative: `.env`, `public/`, `runs/`, `src/index.ts` for the render.
 * So the project root is derived from this file's own location (mcp/storyteller.mts → ..) and we
 * chdir before loading `.env`. Heavy modules are imported DYNAMICALLY after the chdir, because
 * static ESM imports are hoisted above it and `src/storyteller.ts` does `import 'dotenv/config'`.
 */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(PROJECT_ROOT);
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const { runStoryteller, readRun, listRuns, makeRunId } = await import('../src/storyteller');
const { loadStorytellerConfig, STYLE_PRESETS, FORMATS } = await import('../src/lib/storytellerConfig');
type StorytellerRequest = import('../src/storyteller').StorytellerRequest;
type StorytellerRun = import('../src/storyteller').StorytellerRun;
type StorytellerStatus = import('../src/storyteller').StorytellerStatus;

/** Diagnostics go to stderr only. */
function log(msg: string): void {
  console.error(`[storyteller-mcp] ${msg}`);
}

// ── Run queue ────────────────────────────────────────────────────────────────────────────────────
// Renders are CPU-bound and the pipeline writes into a shared public/ tree, so runs are serialised.
// Queued runs live in memory so status can answer before the first checkpoint file exists.
const MAX_CONCURRENT = Math.max(1, Number(process.env.STORYTELLER_MAX_CONCURRENT_RUNS) || 1);

interface QueuedRun {
  runId: string;
  request: StorytellerRequest;
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

    // Deliberately not awaited: the tool call already returned. runStoryteller records the failure in
    // run.json before rethrowing, so swallowing the rejection here loses nothing.
    void runStoryteller(entry.request)
      .then((run) => log(`run ${run.runId} → ${run.status}${run.videoPath ? ` (${run.videoPath})` : ''}`))
      .catch((err) => log(`run ${entry.runId} failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`))
      .finally(() => {
        active.delete(entry.runId);
        pump();
      });
  }
}

/** Trimmed view for tool responses — the raw run.json is ~10 KB with a full stage log. */
function summarize(run: StorytellerRun): Record<string, unknown> {
  return {
    runId: run.runId,
    status: run.status,
    partial: run.partial || undefined,
    url: run.url,
    title: run.title,
    style: run.style,
    aspect: run.aspect,
    sceneCount: run.sceneCount,
    animatedScenes: run.animatedScenes,
    durationSeconds: run.durationSeconds,
    meanVolumeDb: run.meanVolumeDb ?? undefined,
    videoPath: run.videoPath,
    posterPath: run.posterPath,
    warnings: run.warnings,
    corrections: run.corrections,
    error: run.error,
    runDir: run.runDir,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    recentLog: (run.log || []).slice(-8),
  };
}

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const failure = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

// ── Server ───────────────────────────────────────────────────────────────────────────────────────

const server = new McpServer({ name: 'storyteller', version: '1.0.0' });

server.tool(
  'storyteller_generate',
  [
    'Turn a URL (or PDF) into a narrated explainer video: LLM storyboard → nano-banana-pro / Flux 2',
    'images and infographics → Seedance animated scenes → ElevenLabs narration → Remotion render,',
    'with a poster baked as frame 0. Returns immediately with a runId; poll storyteller_status until',
    'status is "done" or "failed" (minutes — a Seedance scene can queue for up to 20 min).',
    'Every argument is optional and falls back to .env defaults; url may also come from',
    'STORYTELLER_DEFAULT_URL, so calling with {} is valid. Call with {until:"storyboarding"} to verify',
    'plumbing cheaply, before any image generation is paid for.',
  ].join(' '),
  {
    url: z.string().optional().describe('Source http(s) URL or path to a .pdf. Falls back to STORYTELLER_DEFAULT_URL.'),
    style: z.string().optional().describe(`Image style preset: ${STYLE_PRESETS.join(' | ')}. Infographic-ish styles route to nano-banana-pro; "photo-realistic" routes to Flux 2.`),
    aspect: z.enum(['16:9', '9:16', '1:1']).optional().describe('Output aspect ratio (default 16:9 → 1920x1080).'),
    voice: z.boolean().optional().describe('ElevenLabs narration. On by default; a silent result is treated as a failure, not shipped.'),
    voiceId: z.string().optional().describe('ElevenLabs voice id. Falls back to STORYTELLER_VOICE_ID.'),
    speed: z.number().optional().describe('Narration speed 0.7–1.2 (default 0.95).'),
    videoScenes: z.boolean().optional().describe('Animate image_to_video / text_to_video scenes with Seedance. Default STORYTELLER_VIDEO_SCENES.'),
    videoMaxScenes: z.number().optional().describe('Cost guard: max scenes to animate (each is ~80 credits and can queue 20 min). Default STORYTELLER_VIDEO_MAX_SCENES (4).'),
    regionHighlights: z.boolean().optional().describe('Word-synced highlight/pointer overlays. Requires the EasyOCR/DINO backend on :8001; fails loudly if it is not reachable.'),
    research: z.boolean().optional().describe('Allow the planner to research externally (replaces the old interactive prompt). Default STORYTELLER_RESEARCH.'),
    focusTopics: z.array(z.string()).optional().describe('Restrict planning to these topic labels, or ["all"].'),
    until: z.enum(['ingesting', 'storyboarding', 'images', 'video', 'voice', 'regions', 'localizing', 'rendering', 'poster']).optional().describe('Stop cleanly AFTER this stage (partial verification run — nothing after it is paid for or rendered).'),
  },
  async (args) => {
    const cfg = loadStorytellerConfig();

    // Fail fast rather than queueing work that can only fail.
    if (!args.url && !cfg.defaultUrl) {
      return failure(
        'No URL supplied and STORYTELLER_DEFAULT_URL is not set. Pass `url`, or set STORYTELLER_DEFAULT_URL in .env ' +
          'for argument-free runs.',
      );
    }

    const runId = makeRunId();
    const request: StorytellerRequest = {
      runId,
      url: args.url,
      style: args.style,
      aspect: args.aspect,
      voice: args.voice,
      voiceId: args.voiceId,
      speed: args.speed,
      videoScenes: args.videoScenes,
      videoMaxScenes: args.videoMaxScenes,
      regionHighlights: args.regionHighlights,
      research: args.research,
      focusTopics: args.focusTopics,
      until: args.until as StorytellerStatus | undefined,
    };

    const entry: QueuedRun = { runId, request, queuedAt: new Date().toISOString() };
    queue.push(entry);
    pending.set(runId, entry);
    const queuePosition = queue.length + active.size;
    log(`queued ${runId} (position ${queuePosition})`);
    pump();

    return text({
      runId,
      runDir: path.join(cfg.paths.runsDir, runId),
      queuePosition,
      note:
        (queuePosition > 1 ? `Queued behind ${queuePosition - 1} run(s). ` : '') +
        'Poll storyteller_status {runId} — expect minutes (image generation + a Seedance queue that can take 20 min + the render).',
    });
  },
);

server.tool(
  'storyteller_status',
  'Check a run started by storyteller_generate. Reads runs/<runId>/run.json, so it works across agent restarts. Returns stage, scene counts, artifact paths, warnings, corrections and the last log lines.',
  {
    runId: z.string().describe('Run id (or an unambiguous prefix) returned by storyteller_generate.'),
    verbose: z.boolean().optional().describe('Include the full stage log (large). Default: last 8 lines only.'),
  },
  async (args) => {
    const cfg = loadStorytellerConfig();
    const run = readRun(args.runId, cfg.paths.runsDir);
    if (!run) {
      const queued = pending.get(args.runId);
      if (queued) {
        return text({ runId: args.runId, status: 'queued-in-memory', queuePosition: queue.indexOf(queued) + 1, active: [...active] });
      }
      return failure(`No run "${args.runId}". Use storyteller_list_runs to see recent runs.`);
    }
    const summary = summarize(run);
    if (args.verbose) summary.log = run.log;
    return text(summary);
  },
);

server.tool(
  'storyteller_list_runs',
  'List recent storyteller runs, newest first, with status and artifact paths.',
  { limit: z.number().optional().describe('How many runs to return (default 10).') },
  async (args) => {
    const cfg = loadStorytellerConfig();
    const runs = listRuns(args.limit ?? 10, cfg.paths.runsDir);
    return text({ count: runs.length, active: [...active], queued: queue.map((q) => q.runId), runs: runs.map(summarize) });
  },
);

server.tool(
  'storyteller_defaults',
  'Show the effective defaults an argument-free storyteller_generate call would use (from .env), plus the available styles, aspects and the resolved project root. Useful before spending on a render.',
  {},
  async () => {
    const cfg = loadStorytellerConfig();
    return text({
      defaults: {
        url: cfg.defaultUrl || null,
        style: cfg.style,
        aspect: cfg.aspect,
        resolution: cfg.resolution,
        voice: cfg.voice.enabled,
        voiceId: cfg.voice.voiceId,
        voiceSpeed: cfg.voice.speed,
        ttsModel: cfg.voice.modelId,
        captions: cfg.captions,
        videoScenes: cfg.video.enabled,
        videoMaxScenes: cfg.video.maxScenes,
        regionHighlights: cfg.regionHighlights,
        research: cfg.storyboard.research,
        focusTopics: cfg.storyboard.focusTopics,
        musicTrackId: cfg.music.trackId || null,
      },
      expectedModels: cfg.expected,
      styles: STYLE_PRESETS,
      aspects: Object.keys(FORMATS),
      maxConcurrentRuns: MAX_CONCURRENT,
      projectRoot: PROJECT_ROOT,
      note: cfg.defaultUrl ? undefined : 'storyteller_generate requires a url, because STORYTELLER_DEFAULT_URL is not set.',
    });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
log(`ready (projectRoot=${PROJECT_ROOT}, concurrency=${MAX_CONCURRENT})`);
