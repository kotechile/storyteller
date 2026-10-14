/**
 * Beat/cue sync against the brag track presets.
 *
 * Upstream brag ships precomputed cue JSON per bundled track (tempo + a beat grid + strong cues), so
 * sequential reveals can land on the music instead of on arbitrary frame numbers.
 *
 * IMPORTANT: `loadCuePreset` touches the filesystem, so it is only usable from the Node side
 * (orchestrator/CLI). The resolved values are baked into composition props — the renderer never
 * reads files, which keeps Remotion renders deterministic and reproducible.
 */
import fs from 'fs';
import path from 'path';

export interface CueBeat {
  time: number;
  intensity: number;
}

export interface CuePreset {
  trackStem: string;
  durationSeconds: number;
  /** Beats per minute. */
  tempo: number;
  beats: CueBeat[];
  /** Highest-scoring moments — good targets for major visual beats. */
  strongCues: number[];
}

/** Parses the upstream cue JSON. Pure, so it can be tested without a filesystem. */
export function parseCuePreset(raw: unknown, fallbackStem = ''): CuePreset {
  const d = (raw ?? {}) as Record<string, unknown>;

  const beatsRaw = Array.isArray(d.beats) ? d.beats : [];
  const beats: CueBeat[] = beatsRaw
    .map((b) => {
      const beat = (b ?? {}) as Record<string, unknown>;
      return { time: Number(beat.time), intensity: Number(beat.intensity) || 0 };
    })
    .filter((b) => Number.isFinite(b.time))
    .sort((a, b) => a.time - b.time);

  const strongCues = (Array.isArray(d.strongCues) ? d.strongCues : [])
    .map((c) => Number(((c ?? {}) as Record<string, unknown>).time))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  const source = (d.source ?? {}) as Record<string, unknown>;

  return {
    trackStem: String(source.trackStem ?? fallbackStem),
    durationSeconds: Number(d.duration) || 0,
    tempo: Number(d.tempo) || 0,
    beats,
    strongCues,
  };
}

/** Loads a cue preset from <publicDir>/brag/cues/. Returns null when the file is absent. */
export function loadCuePreset(publicDir: string, cueFileName: string): CuePreset | null {
  const full = path.join(publicDir, 'brag', 'cues', cueFileName);
  if (!fs.existsSync(full)) return null;
  try {
    return parseCuePreset(JSON.parse(fs.readFileSync(full, 'utf-8')), cueFileName.replace(/\.music-cues\.json$/, ''));
  } catch (err) {
    console.warn(`[beatSync] Could not parse cue preset ${full}: ${(err as Error).message}`);
    return null;
  }
}

/** Nudges a time onto the nearest beat when one is within `toleranceSeconds`. */
export function snapToBeat(t: number, preset: CuePreset | null, toleranceSeconds = 0.12): number {
  if (!preset || preset.beats.length === 0) return t;
  let best = t;
  let bestDelta = toleranceSeconds;
  for (const beat of preset.beats) {
    const delta = Math.abs(beat.time - t);
    if (delta <= bestDelta) {
      bestDelta = delta;
      best = beat.time;
    }
  }
  return best;
}

/** The nearest strong cue to `t` within `windowSeconds`, or null. */
export function nearestStrongCue(t: number, preset: CuePreset | null, windowSeconds = 2.5): number | null {
  if (!preset || preset.strongCues.length === 0) return null;
  let best: number | null = null;
  let bestDelta = windowSeconds;
  for (const cue of preset.strongCues) {
    const delta = Math.abs(cue - t);
    if (delta <= bestDelta) {
      bestDelta = delta;
      best = cue;
    }
  }
  return best;
}

/**
 * Beat times inside a window. `skip` thins the grid — brag's guidance is that beat-grid reveals at
 * 110+ BPM land ~0.5 s apart, which is fine for accents but too fast for readable *text*, so
 * sequential text should take every 2nd beat or hold the full set afterwards.
 */
export function beatGridBetween(from: number, to: number, preset: CuePreset | null, skip = 1): number[] {
  if (!preset || to <= from) return [];
  const step = Math.max(1, Math.round(skip));
  return preset.beats.filter((_, i) => i % step === 0).map((b) => b.time).filter((t) => t >= from && t <= to);
}

/**
 * Chooses where a sequence of element reveals should land so that individual items hit beats but
 * each item still gets `minSpacingSeconds` on screen (the reading floor wins over the grid).
 */
export function planBeatAlignedReveals(opts: {
  startSeconds: number;
  endSeconds: number;
  count: number;
  minSpacingSeconds: number;
  preset: CuePreset | null;
}): { times: number[]; beatAlignedCount: number; fallbackCount: number } {
  const { startSeconds, endSeconds, count, minSpacingSeconds, preset } = opts;
  if (count <= 0) return { times: [], beatAlignedCount: 0, fallbackCount: 0 };

  const window = Math.max(0, endSeconds - startSeconds);
  if (!preset || preset.beats.length === 0) {
    // No cue data: even spacing, and say so via the counters rather than pretending it is beat-synced.
    const step = window / (count + 1);
    return { times: Array.from({ length: count }, (_, i) => startSeconds + step * (i + 1)), beatAlignedCount: 0, fallbackCount: count };
  }

  const beats = beatGridBetween(startSeconds, endSeconds, preset).filter((_, i, arr) => {
    if (i === 0) return true;
    return arr[i] - arr[i - 1] >= Math.max(0.05, minSpacingSeconds - 0.02);
  });

  if (beats.length < count) {
    const step = window / (count + 1);
    return {
      times: Array.from({ length: count }, (_, i) => startSeconds + step * (i + 1)),
      beatAlignedCount: 0,
      fallbackCount: count,
    };
  }

  // Evenly sample the available beats so reveals spread across the scene instead of clumping early.
  const picked = Array.from({ length: count }, (_, i) => {
    const idx = Math.round(((i + 1) / (count + 1)) * (beats.length - 1));
    return beats[Math.min(beats.length - 1, Math.max(0, idx))];
  });

  // Enforce spacing monotonically — the reading floor must not be violated by grid snapping.
  for (let i = 1; i < picked.length; i++) {
    const min = picked[i - 1] + minSpacingSeconds;
    if (picked[i] < min) picked[i] = Math.min(min, endSeconds);
  }

  return { times: picked, beatAlignedCount: count, fallbackCount: 0 };
}
