/**
 * Region-to-Narration Sync Engine (v14 — Pure EasyOCR).
 *
 * Pipeline:
 * 1. EasyOCR reads ALL visible text from the image (via backend /detect with empty prompts)
 * 2. Match each OCR label against the narration — only keep what's spoken
 * 3. Find ElevenLabs timestamps for matched text
 * 4. Show boxes at spoken times
 */

import {
  WordTimestamp,
  StoryboardScene,
  RegionFocusEvent,
  DetectedRegion,
} from "../types/storyboard";
import { detectRegions, isGroundingDinoAvailable, DetectedRegion as DinoRegion } from "./groundingDinoClient";

function cleanText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function findWordTimestamps(
  phrase: string,
  timestamps: WordTimestamp[],
  sceneDuration: number,
): [number, number] {
  if (!timestamps.length || !phrase.trim()) return [-1, -1];

  const targetWords = cleanText(phrase).split(/\s+/).filter(w => w.length > 1);
  if (targetWords.length === 0) return [-1, -1];

  const cleanTS = timestamps.map((t) => ({
    start: t.start, end: t.end,
    word: cleanText(t.word),
  })).filter(t => t.word.length > 0);

  let bestStart = -1, bestLen = 0;

  for (let i = cleanTS.length - 1; i >= 0; i--) {
    let matched = 0;
    for (let j = 0; j < targetWords.length; j++) {
      const ti = i + matched;
      if (ti < cleanTS.length && cleanTS[ti].word === targetWords[j]) {
        matched++;
      } else if (ti < cleanTS.length && targetWords[j].length > 2 &&
                 (cleanTS[ti].word.includes(targetWords[j]) || targetWords[j].includes(cleanTS[ti].word))) {
        matched++;
      } else {
        break;
      }
    }
    if (matched >= Math.max(1, Math.ceil(targetWords.length * 0.5)) && matched > bestLen) {
      bestLen = matched;
      bestStart = cleanTS[i].start;
    }
  }

  if (bestStart >= 0) {
    const computed = bestStart + 2.5;
    const capped = Math.min(computed, sceneDuration);
    console.log(`[RegionSync]   timestamps for "${phrase}": bestStart=${bestStart.toFixed(3)}, +2.5=${computed.toFixed(3)}, sceneDuration=${sceneDuration.toFixed(1)}, capped=${capped.toFixed(3)}`);
    return [bestStart, capped];
  }
  return [-1, -1];
}

function dinoToDetected(dr: DinoRegion, id: string): DetectedRegion {
  return { id, label: dr.label, boundingBox: dr.box, confidence: dr.confidence };
}

export interface RegionSyncResult {
  detectedRegions: DetectedRegion[];
  regionFocusEvents: RegionFocusEvent[];
  imageWidth: number;
  imageHeight: number;
}

export async function generateRegionFocusEvents(
  scene: StoryboardScene,
  wordTimestamps: WordTimestamp[],
  imageUrl?: string,
): Promise<RegionSyncResult> {
  const empty: RegionSyncResult = { detectedRegions: [], regionFocusEvents: [], imageWidth: 0, imageHeight: 0 };
  
  // Skip region detection for video scenes — no diagram elements to highlight
  const sceneAnim = (scene as any).animationStrategy;
  if (sceneAnim === 'text_to_video' || sceneAnim === 'image_to_video') {
    console.log(`[RegionSync] Scene ${scene.sceneNumber}: skipping (${sceneAnim} — no highlights for video scenes)`);
    return empty;
  }

  const imageElement = scene.layout?.elements?.find((el) => el.type === "image");
  if (!imageElement || !imageUrl) return empty;

  const ok = await isGroundingDinoAvailable();
  if (!ok) { console.warn("[RegionSync] Backend unavailable."); return empty; }

  // Use the last word timestamp as scene boundary, not scene.duration (which may be stale)
  const sceneDuration = wordTimestamps.length > 0
    ? wordTimestamps[wordTimestamps.length - 1].end + 1.0
    : (scene.duration || 12);
  const narrationLower = cleanText(scene.narration);
  const hasTimestamps = wordTimestamps.length > 0;
  if (!hasTimestamps) {
    console.warn(`[RegionSync] Scene ${scene.sceneNumber}: no word timestamps — regenerate voice first (🔄 Voice button)`);
  }

  // Step 1: EasyOCR reads ALL visible text (empty prompts = OCR-only mode)
  const detectResult = await detectRegions(imageUrl, [], 0.15, 0.15, []);
  if (!detectResult.regions.length) {
    console.log(`[RegionSync] Scene ${scene.sceneNumber}: no text found.`);
    return empty;
  }

  console.log(`[RegionSync] Scene ${scene.sceneNumber}: ${detectResult.regions.length} EasyOCR results:`,
    detectResult.regions.map(r => `"${r.label}" (${r.confidence.toFixed(2)})`));

  // Step 2: Filter — keep labels whose words appear in narration
  const matched: Array<{ region: DinoRegion; startSec: number; endSec: number; label: string }> = [];

  for (const dr of detectResult.regions) {
    // Skip huge/small boxes
    if (dr.box.width > 90 || dr.box.height > 90) {
      console.log(`[RegionSync]   SKIP big "${dr.label}" (${dr.box.width.toFixed(0)}x${dr.box.height.toFixed(0)})`);
      continue;
    }
    if (dr.box.width < 1 || dr.box.height < 1) continue;

    const labelClean = cleanText(dr.label);
    // Allow single-character labels (e.g., numbers like "44")
    if (labelClean.length < 1) continue;

    // Check if label words appear in narration
    const words = labelClean.split(/\s+/).filter(w => w.length >= 1);
    if (words.length === 0) continue;

    if (words.length === 1) {
      // Single word: must appear in narration
      if (!narrationLower.includes(words[0])) {
        console.log(`[RegionSync]   SKIP "${dr.label}" — not in narration`);
        continue;
      }
    } else {
      // Multi-word: the full cleaned phrase must appear as contiguous substring
      if (!narrationLower.includes(labelClean)) {
        // For 3+ word labels: allow if >= 80% of content words appear
        if (words.length >= 3) {
          const contentWords = words.filter(w => w.length > 2);
          if (contentWords.length === 0) {
            console.log(`[RegionSync]   SKIP "${dr.label}" — no content words`);
            continue;
          }
          const matched = contentWords.filter(w => narrationLower.includes(w));
          if (matched.length < Math.ceil(contentWords.length * 0.8)) {
            console.log(`[RegionSync]   SKIP "${dr.label}" — phrase not in narration (${matched.length}/${contentWords.length} words match)`);
            continue;
          }
        } else {
          // 2-word: must appear exactly as a phrase
          console.log(`[RegionSync]   SKIP "${dr.label}" — phrase not in narration`);
          continue;
        }
      }
    }

    // Find timestamps — try full label first, requiring exact or high-quality match
    let [startSec, endSec] = findWordTimestamps(dr.label, wordTimestamps, sceneDuration);

    if (startSec < 0 && words.length >= 2) {
      // Try multi-word sub-phrases (e.g. "vulnerability score" from "VULNERABILITY SCORE (Real-time risk adjustments)")
      const multiWordPhrases = [
        words.slice(0, 2).join(" "),
        words.filter(w => w.length > 3).join(" "),
      ].filter(p => p.trim().length > 3);

      for (const phrase of multiWordPhrases) {
        const [ps, pe] = findWordTimestamps(phrase, wordTimestamps, sceneDuration);
        if (ps >= 0) { startSec = ps; endSec = pe; break; }
      }
    }

    if (startSec < 0) {
      // Fall back to key individual words (only words > 3 chars to avoid matching common short words)
      const keyWords = words.filter(w => w.length > 3);
      for (const w of keyWords) {
        const [ws, we] = findWordTimestamps(w, wordTimestamps, sceneDuration);
        if (ws >= 0 && (startSec < 0 || ws < startSec)) { startSec = ws; endSec = we; }
      }
    }

    if (startSec < 0) {
      console.log(`[RegionSync]   NO TIMESTAMPS for "${dr.label}" — regenerate voice first`);
      continue;
    }

    matched.push({ region: dr, startSec, endSec, label: dr.label });
    console.log(`[RegionSync]   FOUND "${dr.label}" → [${startSec.toFixed(1)}s-${endSec.toFixed(1)}s] box=(${dr.box.x.toFixed(0)},${dr.box.y.toFixed(0)})`);
  }

  if (!matched.length) {
    console.log(`[RegionSync] Scene ${scene.sceneNumber}: no matches.`);
    return empty;
  }

  // Step 3: Sort by time, dedup by label
  matched.sort((a, b) => a.startSec - b.startSec);

  const deduped: typeof matched = [];
  const seen = new Set<string>();
  for (const m of matched) {
    const key = m.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }

  // Adjust timings
  for (let i = 0; i < deduped.length; i++) {
    if (deduped[i].endSec - deduped[i].startSec < 1.5) {
      deduped[i].endSec = Math.min(deduped[i].startSec + 1.5, sceneDuration - 0.1);
    }
    if (i < deduped.length - 1 && deduped[i].endSec > deduped[i + 1].startSec) {
      deduped[i].endSec = deduped[i + 1].startSec - 0.15;
    }
  }

  // Step 4: Build output
  const detectedRegions: DetectedRegion[] = [];
  const events: RegionFocusEvent[] = deduped.map((m, idx) => {
    const did = `region_${scene.sceneNumber}_${idx}`;
    detectedRegions.push(dinoToDetected(m.region, did));
    return {
      regionId: did,
      elementId: imageElement.id,
      startSeconds: m.startSec,
      endSeconds: m.endSec,
      label: m.label,
      pointerEnabled: true,
      transition: idx === 0 ? "instant" : "smooth",
    } as RegionFocusEvent;
  });

  console.log(`[RegionSync] Scene ${scene.sceneNumber}: ${events.length} final:`,
    events.map(e => `"${e.label}" [${e.startSeconds.toFixed(1)}s-${e.endSeconds.toFixed(1)}s]`).join(" | "));

  return {
    detectedRegions,
    regionFocusEvents: events,
    imageWidth: detectResult.imageWidth,
    imageHeight: detectResult.imageHeight,
  };
}
