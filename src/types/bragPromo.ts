/**
 * BragPromo composition props.
 *
 * On the Zod schema being deliberately loose: this schema exists for the Remotion Studio prop editor
 * and for `remotion render --props` validation. brag/audio are strongly typed at *compile* time
 * (src/lib/bragStoryboard.ts, src/lib/bragSfx.ts) — the pipeline always hands the renderer props it
 * generated itself, so a strict runtime re-validation here would add a failure mode without adding
 * safety. What matters instead is failing loudly when props are absent, which assertBragProps does.
 */
import { z } from 'zod';
import { storyboardManifestSchema, sceneAudioSchema } from './storyboard';
import type { StoryboardManifest, SceneAudio } from './storyboard';
import type { BragRenderMeta } from '../lib/bragStoryboard';
import type { BragAudioPlan } from '../lib/bragSfx';

export interface BragPromoProps {
  /** Timing/audio skeleton from the compiler. */
  manifest?: StoryboardManifest;
  /** Brag-specific render metadata (palette, tone, text reveals, visuals). */
  brag?: BragRenderMeta;
  /** Narrated audio, only when OMNICAST_VOICE=1. */
  sceneAudio?: SceneAudio[];
  /** Precomputed music + SFX plan (see src/lib/bragSfx.ts). */
  audio?: BragAudioPlan | null;
  /** Burn in word-level captions (matters for silent autoplay on Shorts). */
  captions?: boolean;
  /**
   * Base URL that serves the project's `public/` directory. Local asset paths (visualSrc, music,
   * sfx) are resolved against it.
   *
   * NOT staticFile(): static serving is broken in this project — a file present in public/ since
   * August 404s from Remotion's render server, verified with and without the bundle cache. The
   * orchestrator therefore serves public/ over an ephemeral HTTP port for the duration of the render
   * (src/lib/assetServer.ts). Defaults to the Vite dev server, which serves public/ during Studio
   * preview.
   */
  assetsBaseUrl?: string;
}

export const bragPromoCompositionSchema = z.object({
  manifest: storyboardManifestSchema.optional(),
  brag: z.any().optional(),
  sceneAudio: z.array(sceneAudioSchema).optional(),
  audio: z.any().optional(),
  captions: z.boolean().optional(),
  assetsBaseUrl: z.string().optional(),
});

export class BragPropsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BragPropsError';
  }
}

/**
 * Fails loudly rather than rendering a blank/black video. A promo missing its brag metadata is a
 * pipeline bug, and a black 20-second render published to YouTube is a much worse outcome than a
 * stack trace.
 */
export function assertBragProps(
  props: BragPromoProps,
): asserts props is BragPromoProps & { manifest: StoryboardManifest; brag: BragRenderMeta } {
  if (!props.manifest) {
    throw new BragPropsError(
      '[BragPromo] Missing `manifest`. Render with the compiled payload, e.g. ' +
        'npx remotion render BragPromo out/brag.mp4 --props=runs/<runId>/brag-props.json',
    );
  }
  if (!props.manifest.scenes?.length) {
    throw new BragPropsError('[BragPromo] `manifest.scenes` is empty — nothing to render.');
  }
  if (!props.brag) {
    throw new BragPropsError(
      '[BragPromo] Missing `brag` metadata (palette/tone/text reveals). This composition is driven by ' +
        'a compiled BragPlan, not by a raw storyboard manifest — use the export from src/lib/bragStoryboard.ts.',
    );
  }
  if (!props.brag.scenes?.length) {
    throw new BragPropsError('[BragPromo] `brag.scenes` is empty — the compiled plan lost its scenes.');
  }
  if (props.brag.scenes.length !== props.manifest.scenes.length) {
    throw new BragPropsError(
      `[BragPromo] Scene count mismatch: manifest has ${props.manifest.scenes.length}, brag has ` +
        `${props.brag.scenes.length}. Both must come from the same bragPlanToStoryboard() call.`,
    );
  }
}
