/**
 * Brag sound design: turns a compiled BragPlan into a concrete audio plan (which music file, which
 * SFX files, at what seconds, at what volume).
 *
 * Two reasons this runs in Node and bakes results into composition props:
 *  1. Remotion renders must be deterministic and reproducible — reading JSON off disk mid-render is
 *     neither. The plan is computed once, then it is just data.
 *  2. File selection needs the asset manifest, which only exists on the filesystem.
 *
 * The upstream skill ships an analysis that names 14 usage intents ('card reveal', 'logo payoff',
 * 'sequential item', …) with measured loudness per file. We use those intents instead of guessing at
 * filenames, and normalise volume by measured RMS so a 0.9-peak click never drowns the music.
 */
import fs from 'fs';
import path from 'path';
import type { BragRenderMeta, BragSceneMeta } from './bragStoryboard';
import type { BragTone } from '../types/brag';
import { TONE_PRESETS } from './tonePresets';
import { loadCuePreset, nearestStrongCue, snapToBeat, type CuePreset } from './beatSync';

export interface BragSfxChoice {
  /** Path relative to public/, e.g. "sfx/interface/click_003.ogg". */
  file: string;
  duration: number;
  rms: number;
}

export interface BragTrackEntry {
  id: string;
  file: string;
  cueFile: string | null;
}

export interface BragAssetManifest {
  tracks: BragTrackEntry[];
  sfxIntents: Record<string, BragSfxChoice[]>;
  sfxByCategory: Record<string, string[]>;
  counts: { music: number; cues: number; sfx: number; sfxCategories?: number };
}

export interface BragSfxCue {
  intent: string;
  file: string;
  fromSeconds: number;
  durationSeconds: number;
  volume: number;
  /** Why this file landed here — printed in the run log so choices are auditable. */
  reason: string;
}

export interface BragAudioPlan {
  music: {
    trackId: string;
    file: string;
    cueFile: string | null;
    tempo: number | null;
    volume: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
    /** True only when a cue preset was found and used. */
    beatAligned: boolean;
  } | null;
  sfx: BragSfxCue[];
  warnings: string[];
}

/** The intent vocabulary provided by the upstream sfx analysis. */
export const SFX_INTENTS = [
  'button press',
  'selection',
  'toggle',
  'card reveal',
  'swipe',
  'sequential item',
  'panel opening',
  'soft reveal',
  'success',
  'logo payoff',
  'reveal confirmation',
  'major reveal',
  'hard transition',
  'chaotic accent',
] as const;

export function loadBragAssetManifest(publicDir: string): BragAssetManifest {
  const full = path.join(publicDir, 'brag', 'brag-assets.json');
  if (!fs.existsSync(full)) {
    throw new Error(
      `[bragSfx] Missing ${full}. The brag skill's music/SFX must be synced into public/ first:\n` +
        '  node scripts/sync-brag-assets.mjs\n' +
        '(Remotion can only serve files under public/, so the skill assets cannot be referenced in place.)',
    );
  }
  const parsed = JSON.parse(fs.readFileSync(full, 'utf-8')) as BragAssetManifest;
  if (!parsed.tracks || !parsed.sfxIntents) {
    throw new Error(`[bragSfx] ${full} is malformed — re-run node scripts/sync-brag-assets.mjs`);
  }
  return parsed;
}

/** Volume normalisation: quieter source files get boosted, loud ones tamed, all within bounds. */
function normaliseVolume(base: number, rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return base;
  const scaled = base * (0.12 / Math.max(rms, 0.02));
  return Math.round(Math.min(0.5, Math.max(0.08, scaled)) * 1000) / 1000;
}

/** Deterministic index pick — same scene always gets the same sound across re-renders. */
function pickChoice(choices: BragSfxChoice[], seed: number): BragSfxChoice {
  return choices[Math.abs(seed) % choices.length];
}

/**
 * Maps a scene onto one of the 14 intents. Order matters: an explicit sfxMoment from the plan wins,
 * then the scene's semantics, then tone/transition.
 */
export function chooseSfxIntent(
  scene: BragSceneMeta,
  index: number,
  total: number,
  tone: BragTone,
  transitionMood: BragSceneMeta['transitionMood'],
): { intent: string; reason: string } {
  const moment = (scene.sfxMoment ?? '').toLowerCase();
  const interaction = (scene.interaction ?? '').toLowerCase();

  // 1. The plan's explicit intent, if we can recognise it.
  if (moment) {
    if (/swipe|drag|slide/.test(moment)) return { intent: 'swipe', reason: `plan asked for "${scene.sfxMoment}"` };
    if (/type|keyboard|typ/.test(moment)) return { intent: 'button press', reason: `plan asked for typing ("${scene.sfxMoment}")` };
    if (/click|tap|press|button/.test(moment)) return { intent: 'button press', reason: `plan asked for "${scene.sfxMoment}"` };
    if (/whoosh|swoosh|transition|cut/.test(moment)) return { intent: 'hard transition', reason: `plan asked for "${scene.sfxMoment}"` };
    if (/glitch|chaos|impact|slam/.test(moment)) return { intent: 'chaotic accent', reason: `plan asked for "${scene.sfxMoment}"` };
    if (/reveal|appear|land|pop/.test(moment)) return { intent: 'card reveal', reason: `plan asked for "${scene.sfxMoment}"` };
    if (/bell|logo|logo payoff|payoff/.test(moment)) return { intent: 'logo payoff', reason: `plan asked for "${scene.sfxMoment}"` };
  }

  // 2. Scene semantics.
  if (/swipe/.test(interaction)) return { intent: 'swipe', reason: 'scene simulates a swipe' };
  if (interaction) return { intent: 'button press', reason: `scene simulates interaction ("${scene.interaction}")` };
  if (scene.sequential) return { intent: 'sequential item', reason: `scene reveals items one by one ("${scene.sequential}")` };
  if (index === total - 1) return { intent: 'logo payoff', reason: 'final scene — the payoff' };
  if (index === 0) {
    return tone === 'chaotic'
      ? { intent: 'chaotic accent', reason: 'chaotic hook' }
      : { intent: 'major reveal', reason: 'hook — first two seconds decide everything' };
  }
  if (scene.isConceptScene) return { intent: 'soft reveal', reason: 'concept/teaching scene — restraint' };

  // 3. Transition character.
  if (transitionMood === 'chaotic') return { intent: 'chaotic accent', reason: 'chaotic transition' };
  if (transitionMood === 'hard') return { intent: 'hard transition', reason: 'hard cut into this scene' };
  return { intent: 'soft reveal', reason: 'default reveal accent' };
}

const MUSIC_VOLUME_BY_TONE: Record<BragTone, number> = {
  default: 0.15,
  polished: 0.1,
  'yc-parody': 0.12,
  chaotic: 0.2,
  deadpan: 0.08,
  cinematic: 0.2,
  'app-store': 0.14,
};

export interface BuildAudioPlanOptions {
  brag: BragRenderMeta;
  publicDir: string;
  /** Force a bundled track id; otherwise one is chosen from the tone's music mood. */
  trackId?: string;
  musicEnabled?: boolean;
  sfxEnabled?: boolean;
}

/** Deterministic track choice by tone mood, so the same tone always sounds the same. */
function chooseTrack(manifest: BragAssetManifest, tone: BragTone): BragTrackEntry {
  const seedByTone: Record<BragTone, number> = {
    default: 0,
    polished: 1,
    'yc-parody': 2,
    chaotic: 3,
    deadpan: 4,
    cinematic: 0,
    'app-store': 1,
  };
  return manifest.tracks[Math.abs(seedByTone[tone]) % manifest.tracks.length];
}

export function buildBragAudioPlan(opts: BuildAudioPlanOptions): BragAudioPlan {
  const { brag, publicDir, trackId } = opts;
  const musicEnabled = opts.musicEnabled ?? true;
  const sfxEnabled = opts.sfxEnabled ?? true;
  const warnings: string[] = [];
  const manifest = loadBragAssetManifest(publicDir);

  // ── music ──
  let music: BragAudioPlan['music'] = null;
  let cuePreset: CuePreset | null = null;

  if (musicEnabled) {
    if (manifest.tracks.length === 0) {
      warnings.push('Music was enabled but the brag asset bundle contains no tracks — rendering silent.');
    } else {
      const track = trackId ? manifest.tracks.find((t) => t.id === trackId) : undefined;
      if (trackId && !track) {
        throw new Error(
          `[bragSfx] OMNICAST_MUSIC_TRACK="${trackId}" is not in the bundle. Available: ` +
            manifest.tracks.map((t) => t.id).join(', '),
        );
      }
      const chosen = track ?? chooseTrack(manifest, brag.tone);
      cuePreset = chosen.cueFile ? loadCuePreset(publicDir, chosen.cueFile) : null;
      if (!cuePreset) {
        warnings.push(
          `No cue preset for "${chosen.id}" — reveals use even spacing rather than beat sync. ` +
            'Re-run node scripts/sync-brag-assets.mjs if the cue files are missing.',
        );
      }
      const total = brag.scenes.reduce((s, sc) => s + sc.seconds, 0);
      music = {
        trackId: chosen.id,
        file: `brag/music/${chosen.file}`,
        cueFile: chosen.cueFile,
        tempo: cuePreset?.tempo ?? null,
        volume: MUSIC_VOLUME_BY_TONE[brag.tone],
        fadeInSeconds: brag.tone === 'chaotic' || brag.tone === 'cinematic' ? 0.2 : 0.5,
        fadeOutSeconds: 1.5,
        beatAligned: Boolean(cuePreset),
      };
      if (cuePreset && total > cuePreset.durationSeconds) {
        throw new Error(
          `[bragSfx] Track "${chosen.id}" is ${cuePreset.durationSeconds.toFixed(1)}s but the video needs ` +
            `${total.toFixed(1)}s. Pick a longer track via OMNICAST_MUSIC_TRACK, or shorten the video.`,
        );
      }
    }
  }

  // ── sfx ──
  const sfx: BragSfxCue[] = [];
  if (sfxEnabled) {
    const posture = TONE_PRESETS[brag.tone].sfxPosture;
    const baseVolume = posture === 'dense' ? 0.38 : posture === 'moderate' ? 0.28 : 0.2;
    const available = Object.keys(manifest.sfxIntents);

    if (available.length === 0) {
      warnings.push('SFX were enabled but no intents resolved from the bundle — the promo will have no sound effects.');
    }

    let sceneStart = 0;
    const total = brag.scenes.length;

    brag.scenes.forEach((scene, index) => {
      const { intent, reason } = chooseSfxIntent(scene, index, total, brag.tone, scene.transitionMood);

      // sparse tone: only the beats that matter (hook, payoff, concept scenes).
      const isSignatureBeat = index === 0 || index === total - 1 || scene.isConceptScene;
      if (posture === 'sparse' && !isSignatureBeat) {
        sceneStart += scene.seconds;
        return;
      }

      const choices = manifest.sfxIntents[intent];
      if (!choices || choices.length === 0) {
        warnings.push(`Intent "${intent}" (scene ${index + 1}) has no bundled file; skipping that cue.`);
        sceneStart += scene.seconds;
        return;
      }

      const choice = pickChoice(choices, index + brag.tone.length);
      // Clicks and interactions start with the gesture; reveals land with the payoff.
      const isGesture = intent === 'button press' || intent === 'selection' || intent === 'swipe' || intent === 'toggle';
      let at = sceneStart + (isGesture ? 0 : 0.05);

      // Snap onto the grid when it is close, and onto a strong cue for the payoff.
      if (cuePreset) {
        at = snapToBeat(at, cuePreset, 0.12);
        if (intent === 'logo payoff' || intent === 'major reveal') {
          const strong = nearestStrongCue(at, cuePreset, 1.5);
          if (strong !== null) at = strong;
        }
      }

      sfx.push({
        intent,
        file: `brag/${choice.file}`,
        fromSeconds: Math.round(at * 1000) / 1000,
        durationSeconds: choice.duration,
        volume: normaliseVolume(baseVolume, choice.rms),
        reason,
      });

      // Sequential reveals get one accent per item, thinned to respect the reading floor.
      if (posture === 'dense' && scene.sequential && scene.lines.length > 1) {
        const perItem = scene.seconds / (scene.lines.length + 1);
        scene.lines.slice(1).forEach((line, i) => {
          sfx.push({
            intent: 'sequential item',
            file: `brag/${choice.file}`,
            fromSeconds: Math.round((sceneStart + perItem * (i + 1)) * 1000) / 1000,
            durationSeconds: choice.duration,
            volume: normaliseVolume(baseVolume * 0.75, choice.rms),
            reason: `sequential reveal item ${i + 2}/${scene.lines.length}`,
          });
        });
      }

      sceneStart += scene.seconds;
    });
  }

  return { music, sfx, warnings };
}
