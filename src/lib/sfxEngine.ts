import { StoryboardManifest } from '../types/storyboard';
import { SceneFrameBoundary } from './audioSync';

export interface SfxCue {
  sceneNumber: number;
  startSeconds: number;
  durationSeconds: number;
  soundType: 'typing' | 'cash_register' | 'whoosh' | 'ambient_office' | 'click' | 'reveal' | 'none';
  volume: number; // 0.0 - 1.0
}

export const SFX_MAP: Record<string, string> = {
  // Local SFX files: drop .mp3 files into public/sfx/ and uncomment the matching line.
  // Example: place 'reveal.mp3' in public/sfx/ → uncomment: reveal: 'sfx/reveal.mp3',
  typing: '',           // 'sfx/typing.mp3'
  whoosh: '',           // 'sfx/whoosh.mp3'
  click: '',            // 'sfx/click.mp3'
  reveal: '',           // 'sfx/reveal.mp3'
  cash_register: '',    // 'sfx/cash_register.mp3'
  ambient_office: '',   // 'sfx/ambient_office.mp3'
};

/**
 * Generates automated SFX cues (whooshes on transitions, reveals on element reveals)
 * mapped to scene boundaries and sync hint timestamps.
 */
export function generateSfxCues(
  manifest: StoryboardManifest,
  sceneBoundaries: SceneFrameBoundary[]
): SfxCue[] {
  const cues: SfxCue[] = [];

  for (let i = 0; i < manifest.scenes.length; i++) {
    const scene = manifest.scenes[i];
    const boundary = sceneBoundaries[i];
    if (!boundary) continue;

    // Whoosh on every scene transition
    cues.push({
      sceneNumber: scene.sceneNumber,
      startSeconds: boundary.startSeconds,
      durationSeconds: 0.5,
      soundType: 'whoosh',
      volume: 0.3,
    });

    // Reveal sound when images appear (based on syncHints)
    for (const hint of scene.syncHints || []) {
      if (hint.triggerAction === 'reveal' && hint.audioStart) {
        cues.push({
          sceneNumber: scene.sceneNumber,
          startSeconds: hint.audioStart,
          durationSeconds: 0.3,
          soundType: 'reveal',
          volume: 0.4,
        });
      }
    }
  }

  return cues;
}
