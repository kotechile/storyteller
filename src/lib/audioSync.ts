import { StoryboardManifest, WordTimestamp, StoryboardScene, SyncHint, CanvasElement } from '../types/storyboard';

export interface SceneFrameBoundary {
  sceneNumber: number;
  startFrame: number;
  durationInFrames: number;
  startSeconds: number;
  durationSeconds: number;
}

/**
 * Aligns Storyboard sync hints and explicit revealSyncPhrases with TTS word timestamps.
 * Guarantees:
 * 1) Image reveals AT THE START of the narration clause/sentence introducing that image!
 * 2) Elements stay permanently visible on the whiteboard canvas across scenes.
 * 3) Highlight overlays appear AT or AFTER target element reveals, NEVER earlier.
 */
export function alignStoryboardWithTimestamps(
  manifest: StoryboardManifest,
  wordTimestamps: WordTimestamp[],
  fps = 30
): { alignedManifest: StoryboardManifest; sceneBoundaries: SceneFrameBoundary[] } {
  const sceneBoundaries: SceneFrameBoundary[] = [];
  let currentWordIndex = 0;
  let currentFrame = 0;
  let currentSeconds = 0;

  const alignedScenes: StoryboardScene[] = manifest.scenes.map((scene) => {
    const sceneWords = scene.narration.trim().split(/\s+/).filter(Boolean);
    const sceneWordCount = sceneWords.length;

    let sceneStartSec = currentSeconds;
    let sceneEndSec = currentSeconds + (scene.duration || 5);

    if (wordTimestamps.length > 0 && currentWordIndex < wordTimestamps.length) {
      sceneStartSec = wordTimestamps[currentWordIndex].start;
      const targetEndIndex = Math.min(
        currentWordIndex + sceneWordCount - 1,
        wordTimestamps.length - 1
      );
      if (targetEndIndex >= 0 && wordTimestamps[targetEndIndex]) {
        sceneEndSec = wordTimestamps[targetEndIndex].end;
      }
    }

    const durationSeconds = Math.max(sceneEndSec - sceneStartSec, 1.0);
    const durationInFrames = Math.max(Math.round(durationSeconds * fps), 30);

    sceneBoundaries.push({
      sceneNumber: scene.sceneNumber,
      startFrame: currentFrame,
      durationInFrames,
      startSeconds: sceneStartSec,
      durationSeconds,
    });

    // Step 1: Align sync hints to clause start
    const alignedHints: SyncHint[] = scene.syncHints.map((hint) => {
      const matchIndex = findClauseStartWordIndex(wordTimestamps, hint.text, currentWordIndex);
      if (matchIndex !== -1 && wordTimestamps[matchIndex]) {
        const start = wordTimestamps[matchIndex].start;
        const end = wordTimestamps[matchIndex].end;
        return {
          ...hint,
          audioStart: start,
          audioEnd: end,
        };
      }

      return {
        ...hint,
        audioStart: sceneStartSec + 0.5,
        audioEnd: sceneStartSec + 1.5,
      };
    });

    // Step 2: Align element reveal timings based on revealSyncPhrase or matching reveal sync hint
    const processedElements: CanvasElement[] = (scene.layout?.elements || []).map((element) => {
      let revealTimeSec = sceneStartSec;
      const syncPhrase = element.revealSyncPhrase || element.content || element.id;

      const matchingHint = alignedHints.find((h) => h.targetElementId === element.id && h.triggerAction === 'reveal');
      if (matchingHint && matchingHint.audioStart !== undefined) {
        revealTimeSec = matchingHint.audioStart;
      } else {
        const matchIndex = findClauseStartWordIndex(wordTimestamps, syncPhrase, currentWordIndex);
        if (matchIndex !== -1 && wordTimestamps[matchIndex]) {
          revealTimeSec = wordTimestamps[matchIndex].start;
        }
      }

      const relativeDelaySec = Math.max(0, revealTimeSec - sceneStartSec);

      // Primary scene image reveals promptly within 0.5s of scene start so images never stay invisible
      const isPrimarySceneImage = element.type === 'image' && scene.layout?.elements?.find((e) => e.type === 'image')?.id === element.id;
      const effectiveDelaySec = isPrimarySceneImage
        ? Math.min(relativeDelaySec, 0.5)
        : relativeDelaySec;

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
      // Connector timing sync: Connector A -> B reveals along with (5 frames before) destination image B!
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

      // Highlight overlay timing sync:
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

    currentWordIndex += sceneWordCount;
    currentFrame += durationInFrames;
    currentSeconds += durationSeconds;

    return {
      ...scene,
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
 * Searches for a target phrase in timestamps, then backtracks to the START of that spoken clause/sentence.
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
