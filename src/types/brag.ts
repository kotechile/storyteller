/**
 * The BragPlan contract — the typed boundary between the Claude creative layer and the Remotion
 * renderer.
 *
 * The Zod schema is deliberately strict about the things that *break a video* and lenient about
 * anything cosmetic (nullish / defaulted), because every over-strict field is another round-trip
 * with the model. Semantic gates that need a good error message (duration window, reading floors,
 * "show the thing") live in src/lib/bragPlanner.ts, not here.
 */
import { z } from 'zod';

export const BRAG_TONES = [
  'default',
  'polished',
  'yc-parody',
  'chaotic',
  'deadpan',
  'cinematic',
  'app-store',
] as const;

export const BRAG_FORMATS = ['vertical', 'landscape', 'square'] as const;

/** Where a scene's visual comes from. Ordered strongest → weakest. */
export const VISUAL_SOURCES = ['screenshot', 'article_asset', 'generated', 'typographic'] as const;

export const TRANSITION_MOODS = ['clean', 'hard', 'dramatic', 'soft', 'chaotic'] as const;

export const bragToneSchema = z.enum(BRAG_TONES);
export const bragFormatSchema = z.enum(BRAG_FORMATS);
export const visualSourceSchema = z.enum(VISUAL_SOURCES);
export const transitionMoodSchema = z.enum(TRANSITION_MOODS);

export const bragSceneSchema = z.object({
  name: z.string().min(1),
  seconds: z.number().positive(),
  onScreen: z.string().min(1),
  /** Lines a viewer must read, in reveal order. May be empty for a pure-visual scene. */
  text: z.array(z.string()).default([]),
  visualSource: visualSourceSchema,
  visualRef: z.string().nullish(),
  sequential: z.string().nullish(),
  interaction: z.string().nullish(),
  revealHoldSeconds: z.number().nullish(),
  transitionMood: transitionMoodSchema,
  sfxMoment: z.string().nullish(),
});

export const bragPlanSchema = z.object({
  appName: z.string().min(1),
  whatIsThisApp: z.string().min(1),
  angle: z.string().min(1),
  hook: z.string().min(1),
  keyMoments: z.array(z.string()).default([]),
  /** The "explain" half of the brief. Code-enforced minimum of 2. */
  keyConcepts: z.array(z.string()).default([]),
  outro: z.string().min(1),
  userFlow: z.array(z.string()).default([]),
  /** Redactions, missing material, and guesses — surfaced to the operator, never rendered. */
  notes: z.string().nullish(),
  tone: z.object({
    preset: bragToneSchema,
    direction: z.string().default(''),
    interpretation: z.string().default(''),
  }),
  /** Advisory only: the request/format config wins. */
  format: z
    .object({ name: bragFormatSchema, width: z.number(), height: z.number() })
    .optional(),
  durationSeconds: z.number(),
  visualIdentity: z.object({
    background: z.string().default('#0b0b0f'),
    accent: z.string().default('#ff5c39'),
    text: z.string().default('#ffffff'),
    displayFont: z.string().default('Inter'),
    bodyFont: z.string().default('Inter'),
    strongestVisualElement: z.string().default(''),
  }),
  shareCopy: z.string().min(1),
  youtube: z
    .object({
      title: z.string().default(''),
      description: z.string().default(''),
      tags: z.array(z.string()).default([]),
    })
    .default({ title: '', description: '', tags: [] }),
  audio: z.object({
    role: z.string().default('warm bed'),
    musicMood: z.string().default('upbeat'),
    sfxPosture: z.string().default('sparse'),
    restraintRule: z.string().default(''),
  }),
  storyboard: z.array(bragSceneSchema).min(2),
});

export type BragPlan = z.infer<typeof bragPlanSchema>;
export type BragScene = z.infer<typeof bragSceneSchema>;
export type BragTone = (typeof BRAG_TONES)[number];
export type BragFormatName = (typeof BRAG_FORMATS)[number];
export type VisualSource = (typeof VISUAL_SOURCES)[number];
export type TransitionMood = (typeof TRANSITION_MOODS)[number];

/**
 * Reading floor from the brag creative laws: how long a set of lines must stay **settled** on
 * screen for a viewer to actually read them.
 *
 * A 1–3 word label: ~0.8 s. A longer line: ~0.3 s per word, minimum ~1.2 s.
 */
export function requiredReadSeconds(line: string): number {
  const words = line.trim().split(/\s+/).filter(Boolean).length;
  if (words <= 3) return 0.8;
  return Math.max(1.2, words * 0.3);
}

/** The longest single-line reading requirement across a scene's text. */
export function sceneReadFloor(scene: Pick<BragScene, 'text'>): number {
  return scene.text.reduce((max, line) => Math.max(max, requiredReadSeconds(line)), 0);
}
