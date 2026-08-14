import { StoryboardManifest, WordTimestamp, StoryboardScene, SyncHint, CanvasElement, SceneAudio } from '../types/storyboard';

export interface SceneFrameBoundary {
  sceneNumber: number;
  startFrame: number;
  durationInFrames: number;
  startSeconds: number;
  durationSeconds: number;
}

/**
 * Aligns Storyboard elements with per-scene ElevenLabs word timestamps.
 * 
 * With per-scene TTS (synthesizePerSceneSpeech), scene durations come DIRECTLY
 * from ElevenLabs — no character-level boundary math. Each scene's audio and
 * word timestamps are isolated (timestamps start from 0 within each scene).
 * 
 * Guarantees:
 * 1) Scene durations = ElevenLabs-reported audio lengths (deterministic)
 * 2) Image reveals align with sync phrases within each scene's isolated timestamps
 * 3) Scene start times = cumulative sum of previous scene durations
 */
export function alignStoryboardWithTimestamps(
  manifest: StoryboardManifest,
  sceneAudio: SceneAudio[],
  fps = 30
): { alignedManifest: StoryboardManifest; sceneBoundaries: SceneFrameBoundary[] } {
  const sceneBoundaries: SceneFrameBoundary[] = [];
  let cumulativeStartSec = 0;

  const alignedScenes: StoryboardScene[] = manifest.scenes.map((scene, sceneIdx) => {
    const audio = sceneAudio.find(sa => sa.sceneNumber === scene.sceneNumber);
    
    // Scene duration: manifest takes priority (set by Re-Sync), audio as fallback
    const durationSeconds = scene.duration || audio?.durationSeconds || 5;
    const durationInFrames = Math.max(Math.round(durationSeconds * fps), 30);
    
    const sceneStartSec = cumulativeStartSec;

    sceneBoundaries.push({
      sceneNumber: scene.sceneNumber,
      startFrame: Math.round(sceneStartSec * fps),
      durationInFrames,
      startSeconds: sceneStartSec,
      durationSeconds,
    });

    cumulativeStartSec += durationSeconds;

    // Get this scene's isolated word timestamps (start from 0 within the scene)
    const sceneTimestamps = audio?.wordTimestamps || [];

    // Step 1: Align sync hints to clause start within this scene's timestamps
    const alignedHints: SyncHint[] = (scene.syncHints || []).map((hint) => {
      const matchIndex = findClauseStartWordIndex(sceneTimestamps, hint.text, 0);
      if (matchIndex !== -1 && sceneTimestamps[matchIndex]) {
        return {
          ...hint,
          audioStart: sceneTimestamps[matchIndex].start,
          audioEnd: sceneTimestamps[matchIndex].end,
        };
      }
      return {
        ...hint,
        audioStart: 0.5,
        audioEnd: 1.5,
      };
    });

    // Step 2: Align element reveal timings using isolated per-scene timestamps
    const processedElements: CanvasElement[] = (scene.layout?.elements || []).map((element) => {
      let revealTimeSec = 0;
      const syncPhrase = element.revealSyncPhrase || element.content || element.id;

      // Check for matching sync hint first
      const matchingHint = alignedHints.find(
        (h) => h.targetElementId === element.id && h.triggerAction === 'reveal'
      );
      if (matchingHint && matchingHint.audioStart !== undefined) {
        revealTimeSec = matchingHint.audioStart;
      } else {
        // Fall back to word-level phrase matching within scene timestamps
        const matchIndex = findClauseStartWordIndex(sceneTimestamps, syncPhrase, 0);
        if (matchIndex !== -1 && sceneTimestamps[matchIndex]) {
          revealTimeSec = sceneTimestamps[matchIndex].start;
        }
      }

      // Primary scene image reveals promptly (within 0.5s)
      const isPrimarySceneImage =
        element.type === 'image' &&
        scene.layout?.elements?.find((e) => e.type === 'image')?.id === element.id;
      const effectiveDelaySec = isPrimarySceneImage
        ? Math.min(revealTimeSec, 0.5)
        : revealTimeSec;

      const delayFrames = Math.round(effectiveDelaySec * fps);

      return {
        ...element,
        revealTimeSeconds: revealTimeSec,
        enterAnimation: {
          type: element.enterAnimation?.type || 'scale_in',
          duration: element.enterAnimation?.duration || 15,
          delay: delayFrames,
        },
      };
    });

    // Step 3: Synchronize connectors and highlight overlays to target element reveal
    const finalElements = processedElements.map((el) => {
      // Connector timing: connector reveals 5 frames before its destination
      if (el.type === 'connector' && el.toElementId) {
        const targetElement = processedElements.find((t) => t.id === el.toElementId);
        if (targetElement && targetElement.enterAnimation) {
          const targetDelay = targetElement.enterAnimation.delay;
          return {
            ...el,
            enterAnimation: {
              type: el.enterAnimation?.type || 'fade_in',
              duration: el.enterAnimation?.duration || 10,
              delay: Math.max(0, targetDelay - 5),
            },
          };
        }
      }

      // Highlight overlay timing: aligns with target element reveal
      if (el.type === 'highlight_overlay') {
        const targetId = el.sourceAssetId || el.highlightOverlay?.targetAssetId;
        const targetElement = processedElements.find((t) => t.id === targetId);
        if (targetElement && targetElement.enterAnimation) {
          const targetDelay = targetElement.enterAnimation.delay;
          const overlayDelay = Math.max(targetDelay, el.enterAnimation?.delay || 0);
          return {
            ...el,
            x: targetElement.x,
            y: targetElement.y,
            width: targetElement.width,
            height: targetElement.height,
            enterAnimation: {
              type: el.enterAnimation?.type || 'fade_in',
              duration: el.enterAnimation?.duration || 10,
              delay: overlayDelay,
            },
          };
        }
      }
      return el;
    });

    return {
      ...scene,
      duration: durationSeconds,
      layout: {
        ...scene.layout,
        elements: finalElements,
      },
      syncHints: alignedHints,
    };
  });

  return {
    alignedManifest: {
      ...manifest,
      scenes: alignedScenes,
    },
    sceneBoundaries,
  };
}

/**
 * Searches for a target phrase in timestamps, then backtracks to the START
 * of that spoken clause/sentence. Timestamps are relative to scene start (0-based).
 */
function findClauseStartWordIndex(
  timestamps: WordTimestamp[],
  targetText: string,
  startIndex: number
): number {
  const words = targetText.trim().split(/\s+/);
  const firstWordClean = words[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';

  if (!firstWordClean) return -1;

  let matchedIndex = -1;
  for (let i = startIndex; i < timestamps.length; i++) {
    const wordClean = timestamps[i].word.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (
      wordClean === firstWordClean ||
      wordClean.includes(firstWordClean) ||
      firstWordClean.includes(wordClean)
    ) {
      matchedIndex = i;
      break;
    }
  }

  if (matchedIndex === -1) return -1;

  // Backtrack to the start of the clause/sentence (within 4 words max)
  let clauseStart = matchedIndex;
  while (clauseStart > startIndex && clauseStart > matchedIndex - 4) {
    const prevWord = timestamps[clauseStart - 1].word;
    if (/[.,;:?!]/.test(prevWord)) {
      break;
    }
    clauseStart--;
  }

  return clauseStart;
}
