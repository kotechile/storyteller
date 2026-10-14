/**
 * Tone presets — the machine-readable half of prompts/brag/tones.md.
 *
 * Transcribed from the upstream brag tone reference. The planner prompt gets the prose; the
 * composition gets these values, so pacing/personality decisions are consistent between what the
 * model planned and what Remotion draws.
 *
 * FONT NOTE (no silent lies): this repo only loads `Outfit` from @remotion/google-fonts
 * (src/Root.tsx). Rendering an arbitrary font name scraped from a source site would silently fall
 * back to a system font and look broken. So each tone carries a stack that is guaranteed to resolve
 * on this machine, and `googleFontCandidate` records the ideal family for a future loader.
 */
/* eslint-disable @remotion/non-pure-animation -- This module is a pure data table of tone presets.
   The rule mis-fires on object keys such as `textEnter` / `holdBias`; no animation runs here — the
   composition that consumes these values is what must stay useCurrentFrame()-pure. */
import type { BragTone, TransitionMood } from '../types/brag';

export interface TonePreset {
  id: BragTone;
  energy: string;
  /** How many scenes this tone wants. */
  sceneTarget: [number, number];
  /** Seconds per scene this tone wants. */
  perSceneSeconds: [number, number];
  /** CSS font stack — always resolvable here. */
  displayFont: string;
  bodyFont: string;
  weight: number;
  letterSpacing: string;
  textTransform: 'none' | 'uppercase';
  /** 0 = accent used sparingly, 1 = accent dominates the frame. */
  accentDominance: number;
  textEnter: 'fade' | 'slide' | 'scale' | 'slam';
  /** Entrance duration in seconds — brag keeps these fast (0.3–0.6 s). */
  enterSeconds: number;
  /** Multiplies the reading floor's settled hold. >1 = more breathing room. */
  holdBias: number;
  transition: TransitionMood;
  musicMood: string;
  sfxPosture: 'sparse' | 'moderate' | 'dense';
  /** The family we would load if a font loader is added later. */
  googleFontCandidate: string;
}

const SANS = "'Outfit', 'Inter', system-ui, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export const TONE_PRESETS: Record<BragTone, TonePreset> = {
  default: {
    id: 'default',
    energy: 'Playful, clean, postable',
    sceneTarget: [4, 5],
    perSceneSeconds: [3, 5],
    displayFont: SANS,
    bodyFont: SANS,
    weight: 600,
    letterSpacing: '-0.01em',
    textTransform: 'none',
    accentDominance: 0.35,
    textEnter: 'slide',
    enterSeconds: 0.45,
    holdBias: 1,
    transition: 'clean',
    musicMood: 'upbeat',
    sfxPosture: 'moderate',
    googleFontCandidate: 'Outfit',
  },
  polished: {
    id: 'polished',
    energy: 'Serious, elegant, restraint as the creative choice',
    sceneTarget: [3, 4],
    perSceneSeconds: [4, 6],
    displayFont: SANS,
    bodyFont: SANS,
    weight: 300,
    letterSpacing: '0.04em',
    textTransform: 'none',
    accentDominance: 0.15,
    textEnter: 'fade',
    enterSeconds: 0.6,
    holdBias: 1.3,
    transition: 'soft',
    musicMood: 'cinematic',
    sfxPosture: 'sparse',
    googleFontCandidate: 'Inter',
  },
  'yc-parody': {
    id: 'yc-parody',
    energy: 'Deadpan startup launch, played completely straight',
    sceneTarget: [4, 5],
    perSceneSeconds: [3, 4],
    displayFont: SANS,
    bodyFont: MONO,
    weight: 500,
    letterSpacing: '0',
    textTransform: 'none',
    accentDominance: 0.25,
    textEnter: 'slide',
    enterSeconds: 0.35,
    holdBias: 1.15,
    transition: 'hard',
    musicMood: 'warm',
    sfxPosture: 'sparse',
    googleFontCandidate: 'Inter',
  },
  chaotic: {
    id: 'chaotic',
    energy: 'Fast, loud, unhinged',
    sceneTarget: [6, 8],
    perSceneSeconds: [1.6, 4],
    displayFont: SANS,
    bodyFont: SANS,
    weight: 800,
    letterSpacing: '-0.02em',
    textTransform: 'uppercase',
    accentDominance: 0.7,
    textEnter: 'slam',
    enterSeconds: 0.3,
    holdBias: 0.9,
    transition: 'chaotic',
    musicMood: 'chaotic',
    sfxPosture: 'dense',
    googleFontCandidate: 'Archivo Black',
  },
  deadpan: {
    id: 'deadpan',
    energy: 'Calm, dry, nothing registers as unusual',
    sceneTarget: [3, 4],
    perSceneSeconds: [4, 7],
    displayFont: SANS,
    bodyFont: SANS,
    weight: 400,
    letterSpacing: '-0.01em',
    textTransform: 'none',
    accentDominance: 0.1,
    textEnter: 'fade',
    enterSeconds: 0.6,
    holdBias: 1.6,
    transition: 'soft',
    musicMood: 'deadpan',
    sfxPosture: 'sparse',
    googleFontCandidate: 'Inter',
  },
  cinematic: {
    id: 'cinematic',
    energy: 'Dramatic, trailer-scale',
    sceneTarget: [4, 5],
    perSceneSeconds: [3, 5],
    displayFont: SANS,
    bodyFont: SANS,
    weight: 700,
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
    accentDominance: 0.45,
    textEnter: 'scale',
    enterSeconds: 0.55,
    holdBias: 1.2,
    transition: 'dramatic',
    musicMood: 'cinematic',
    sfxPosture: 'moderate',
    googleFontCandidate: 'Outfit',
  },
  'app-store': {
    id: 'app-store',
    energy: 'Clean, professional, feature-forward',
    sceneTarget: [4, 6],
    perSceneSeconds: [3, 4],
    displayFont: SANS,
    bodyFont: SANS,
    weight: 600,
    letterSpacing: '0',
    textTransform: 'none',
    accentDominance: 0.4,
    textEnter: 'slide',
    enterSeconds: 0.4,
    holdBias: 1,
    transition: 'clean',
    musicMood: 'warm',
    sfxPosture: 'moderate',
    googleFontCandidate: 'Inter',
  },
};

/** Maps freeform tone direction onto the nearest preset (brag: preserve the user's words, borrow the pacing). */
export function nearestTonePreset(direction: string): BragTone {
  const d = direction.toLowerCase();
  if (/(chaos|unhinged|loud|hype|wild|fast)/.test(d)) return 'chaotic';
  if (/(deadpan|dry|understat|calm|quiet joke)/.test(d)) return 'deadpan';
  if (/(yc|startup|pitch|series a|venture|launch deck)/.test(d)) return 'yc-parody';
  if (/(cinematic|trailer|epic|blockbuster|dramatic)/.test(d)) return 'cinematic';
  if (/(app.?store|product page|feature card|clean corporate|b2b)/.test(d)) return 'app-store';
  if (/(elegant|premium|serious|museum|luxury|restrained)/.test(d)) return 'polished';
  return 'default';
}

/**
 * Resolves the effective preset: a known preset name wins; freeform direction maps to the nearest
 * preset (keeping the user's words as the creative direction).
 */
export function resolveTone(requested: string | undefined): { preset: BragTone; direction: string } {
  const raw = (requested ?? '').trim();
  if (!raw) return { preset: 'default', direction: '' };
  const lower = raw.toLowerCase();
  if (lower in TONE_PRESETS) return { preset: lower as BragTone, direction: '' };
  return { preset: nearestTonePreset(raw), direction: raw };
}
