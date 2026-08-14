# OmniCast — Implementation Blueprint for AI Coding Agent

> **Target Repo:** `/Users/jorgefernandezilufi/Documents/_article_research/remotion/`
> **Current Commit:** `666c5c2` (main, clean)
> **Language:** TypeScript 5.9.3, React 19, Remotion 4.0.484
> **Key Deps:** zod 4.3.6, @supabase/supabase-js 2.108.2
> **Lint:** `npx tsc --noEmit` must pass after each phase
> **Git Rule:** Create a new branch per phase (`git checkout -b phase-N-description`). Never modify main directly.

---

## ⚠️ READ THIS FIRST

1. **Branch per phase.** Before touching any file: `git checkout -b phase-0-real-vision`. Commit when done. Report branch name.
2. **TypeScript strict mode.** `tsconfig.json` has `"strict": true` and `"noUnusedLocals": true`. Every variable must be used. Every type must be correct.
3. **Zod validation is mandatory.** Every LLM JSON output must pass through its Zod schema before entering the pipeline. Use `.safeParse()` — never raw `.parse()` without a try/catch.
4. **No new dependencies unless specified.** The only new dependency needed is `pdf-parse` in Phase 1. All other changes use existing dependencies.
5. **Validation after each phase:** `npx tsc --noEmit` must pass. If it doesn't, fix type errors before committing.

---

# PHASE 0 — Critical Fixes (Unblocks the Pipeline)

**Branch name:** `phase-0-critical-fixes`
**Goal:** Replace simulated data with real API calls, add Zod validation, add checkpointing, add retry/backoff, remove hardcoded financial metaphors.
**Estimated time:** 1-2 coding sessions.

---

## Task 0.1: Real Vision Model Image Classification

### File: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/ingest.ts`

### What to change:

**DELETE** lines 75-106 (the `if (isDiagram)` block with fake `visionAnalysis`).
**ADD** a new function `classifyAndAnalyzeImage()` that calls a vision-capable LLM.
**MODIFY** the `parseArticleHtml()` function to call this new function for each image.
**ADD** retry/backoff wrapper for the fetch call.

### New function signature:

```typescript
async function classifyAndAnalyzeImage(
  imageUrl: string,
  altText: string,
  caption: string | null,
  llmConfig: ResolvedLlmConfig
): Promise<{
  classification: 'diagram' | 'photo' | 'chart' | 'icon' | 'screenshot';
  visionAnalysis?: VisionAnalysis;
}>
```

### Logic flow:

```
1. Call vision LLM (GPT-4V / Claude Vision / Gemini Vision) with:
   - The image URL
   - Prompt: "Analyze this image. Return JSON with:
     a) 'classification': one of 'diagram', 'photo', 'chart', 'icon', 'screenshot'
     b) If diagram/chart: 'regions': array of {id, label, boundingBox: {x, y, width, height} as 0-100 percentages, description}
     c) 'textContent': any text visible in the image
     d) 'description': one-sentence description of the image content"

2. Parse the JSON response
3. Return { classification, visionAnalysis } or { classification } for non-technical images

4. On API failure: return { classification: 'photo' } (safe default, no fake regions)
5. Use exponential backoff: 3 retries at 1s, 2s, 4s with ±250ms jitter
```

### Implementation details:

The vision model call should use the existing `resolveLlmModel()` from `supabaseClient.ts` with a new task role like `'vision_analysis'`. The prompt format depends on the provider:

**OpenAI (GPT-4V):**
```typescript
body: JSON.stringify({
  model: llmConfig.modelName,
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'Analyze this image. Return JSON...' },
      { type: 'image_url', image_url: { url: imageUrl } }
    ]
  }],
  response_format: { type: 'json_object' }
})
```

**Gemini Vision:**
```typescript
body: JSON.stringify({
  contents: [{
    parts: [
      { text: 'Analyze this image. Return JSON...' },
      { inlineData: { mimeType: 'image/png', data: base64Image } }
    ]
  }],
  generationConfig: { responseMimeType: 'application/json' }
})
```

**Claude Vision (via Anthropic API):**
Use multi-modal content blocks with `type: 'image'`.

### Modifications to `parseArticleHtml()`:

```typescript
// After line 84 (asset creation), replace the if(isDiagram) block:

// New: after extracting images, classify them
const llmConfig = await resolveLlmModel('vision_analysis');
if (llmConfig.apiKey) {
  const analysis = await classifyAndAnalyzeImage(
    imgSrc, altText, null, llmConfig
  );
  asset.classification = analysis.classification;
  asset.visionAnalysis = analysis.visionAnalysis;
} else {
  // No API key: classify as 'photo' (safe default, no fake data)
  asset.classification = 'photo';
}
```

### Also modify: `generateFallbackArticleData()` (lines 125-178)

Remove the hardcoded `visionAnalysis` from the fallback data. The fallback should return `classification: 'photo'` with no `visionAnalysis`.

### New import needed at top of `ingest.ts`:

```typescript
import { resolveLlmModel, ResolvedLlmConfig } from './supabaseClient';
import { VisionAnalysis } from '../types/storyboard';
```

---

## Task 0.2: Zod Validation of LLM Output in Narrative Engine

### File: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/narrativeEngine.ts`

### What to change:

**ADD** import at top:
```typescript
import { storyboardManifestSchema } from '../types/storyboard';
```

**MODIFY** lines 128-144 (Step 2 JSON parsing):

Replace:
```typescript
const jsonResp = await callLlm(llmConfig, prompt2Text, true);
const parsed = JSON.parse(jsonResp);

if (parsed.scenes && Array.isArray(parsed.scenes)) {
  const draftManifest: StoryboardManifest = { ... };
```

With:
```typescript
const jsonResp = await callLlm(llmConfig, prompt2Text, true);
const parsed = storyboardManifestSchema.safeParse(JSON.parse(jsonResp));

if (parsed.success) {
  const draftManifest: StoryboardManifest = parsed.data;
  // PROMPT 3...
} else {
  console.error('[NarrativeEngine] Schema validation failed:', parsed.error.flatten());
  // Retry once with a repair prompt
  const repairPrompt = `The previous JSON output failed schema validation. Errors: ${JSON.stringify(parsed.error.flatten())}. Return CORRECTED VALID JSON.`;
  const repairedJson = await callLlm(llmConfig, repairPrompt, true);
  const repaired = storyboardManifestSchema.safeParse(JSON.parse(repairedJson));
  if (repaired.success) {
    const draftManifest = repaired.data;
    // Continue to PROMPT 3...
  } else {
    console.error('[NarrativeEngine] Repair also failed. Using fallback.');
    return buildCinematicWhiteboardFallback(cleanTitle, stylePreset);
  }
}
```

**MODIFY** `reviewAndOptimizeStoryboard()` (lines 156-189):

Replace lines 175-183:
```typescript
const reviewedJson = await callLlm(llmConfig, reviewPrompt, true);
const parsed = JSON.parse(reviewedJson);
if (parsed.scenes && Array.isArray(parsed.scenes)) {
  console.log('[NarrativeEngine] Step 3 Complete...');
  return {
    meta: manifest.meta,
    scenes: parsed.scenes,
  };
}
```

With:
```typescript
const reviewedJson = await callLlm(llmConfig, reviewPrompt, true);
const parsed = storyboardManifestSchema.safeParse(JSON.parse(reviewedJson));
if (parsed.success) {
  console.log('[NarrativeEngine] Step 3 Complete. Storyboard QA & Flow Review passed.');
  return parsed.data;
} else {
  console.warn('[NarrativeEngine] Review pass produced invalid JSON:', parsed.error.flatten());
  return manifest; // Fall back to pre-review manifest
}
```

---

## Task 0.3: Exponential Backoff on All API Calls

### Files to modify (5 files):

#### 0.3a: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/narrativeEngine.ts`

**ADD** a retry utility function at the bottom of the file (before `buildCinematicWhiteboardFallback`):

```typescript
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
  baseDelayMs = 1000
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || attempt === retries) return response;
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 250;
      console.warn(`[fetchWithRetry] Attempt ${attempt + 1} failed (${response.status}). Retrying in ${Math.round(delay)}ms...`);
      await new Promise(r => setTimeout(r, delay));
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 250;
      console.warn(`[fetchWithRetry] Attempt ${attempt + 1} network error. Retrying in ${Math.round(delay)}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('fetchWithRetry: max retries exceeded');
}
```

**MODIFY** `callLlm()` (line 191): Replace `const res = await fetch(...)` with `const res = await fetchWithRetry(...)` for both OpenAI and Gemini branches. Increase timeout to 30s by adding `signal: AbortSignal.timeout(30000)` to the fetch options.

#### 0.3b: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/elevenlabsTts.ts`

**ADD** the same `fetchWithRetry` function.
**MODIFY** line 39: Replace `const response = await fetch(...)` with `const response = await fetchWithRetry(...)`. Use 3 retries, 2s base delay, 120s timeout.

#### 0.3c: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/fluxImageGen.ts`

**ADD** the same `fetchWithRetry` function.
**MODIFY** line 52: Replace `const response = await fetch(...)` with `const response = await fetchWithRetry(...)`. Use 2 retries, 1s base delay, 60s timeout.

#### 0.3d: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/assetCatalogManager.ts`

**ADD** the same `fetchWithRetry` function.
**MODIFY** line 74: Replace `const response = await fetch(imageUrl)` with `const response = await fetchWithRetry(imageUrl, {}, 2, 1000)`.

#### 0.3e: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/ingest.ts`

**ADD** the same `fetchWithRetry` function.
**MODIFY** line 11: Replace `const response = await fetch(url, { headers: {...} })` with `const response = await fetchWithRetry(url, { headers: {...} }, 2, 1000)`.

---

## Task 0.4: Stage-Level Checkpointing in Orchestrator

### File: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/generateStoryFromUrl.ts`

### What to change:

**ADD** two helper functions at the top:

```typescript
function loadCheckpoint<T>(filePath: string): T | null {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    }
  } catch (err) {
    console.warn(`[Checkpoint] Failed to load ${filePath}:`, err);
  }
  return null;
}

function saveCheckpoint(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}
```

**MODIFY** the `main()` function to checkpoint after each stage:

```typescript
async function main() {
  const targetUrl = process.argv[2] || 'https://techcrunch.com/article/ai-automation';
  const rawStyleArg = process.argv[3] || 'photo-realistic';
  const imageStyle = /* existing validation */;

  console.log('\n======================================================');
  console.log(`🎬 OmniCast URL-to-Explainer-Video Generator`);
  console.log(`Target URL: ${targetUrl}`);
  console.log(`Image Style Preset: ${imageStyle}`);
  console.log('======================================================\n');

  // ── STAGE 1: Ingestion (skip if checkpoint exists) ──
  const ingestionCheckpointPath = path.join(process.cwd(), 'out', 'ingestion_checkpoint.json');
  let article = loadCheckpoint<ArticleData>(ingestionCheckpointPath);
  if (!article) {
    console.log('1️⃣ Ingesting article content and vision image assets...');
    article = await ingestUrl(targetUrl);
    saveCheckpoint(ingestionCheckpointPath, { url: targetUrl, article, completedAt: new Date().toISOString() });
    console.log('   ✅ Ingestion checkpoint saved.');
  } else {
    console.log('1️⃣ Loaded existing ingestion checkpoint (skipping re-ingest).');
  }

  // ── STAGE 2: Narrative Storyboard (skip if checkpoint exists) ──
  const storyboardCheckpointPath = path.join(process.cwd(), 'out', 'storyboard_checkpoint.json');
  let manifest = loadCheckpoint<StoryboardManifest>(storyboardCheckpointPath);
  if (!manifest) {
    console.log('2️⃣ Generating Narrative Storyboard...');
    manifest = await generateStoryboardFromArticle(article, { stylePreset: imageStyle });
    saveCheckpoint(storyboardCheckpointPath, { manifest, completedAt: new Date().toISOString() });
    console.log('   ✅ Storyboard checkpoint saved.');
  } else {
    console.log('2️⃣ Loaded existing storyboard checkpoint (skipping re-generation).');
  }

  // ── STAGE 2.5: Asset Resolution (always run — catalog is self-checkpointing) ──
  console.log(`🖼️ Resolving Concept Assets via Flux (${imageStyle})...`);
  for (const scene of manifest.scenes) {
    if (scene.layout?.elements) {
      for (const element of scene.layout.elements) {
        if (element.type === 'image') {
          // ... existing asset resolution logic ...
        }
      }
    }
  }

  // ── STAGE 3: TTS (skip if checkpoint exists AND audio file exists) ──
  const ttsCheckpointPath = path.join(process.cwd(), 'out', 'tts_checkpoint.json');
  let ttsResult = loadCheckpoint<TtsSynthesisResult>(ttsCheckpointPath);
  if (!ttsResult || !fs.existsSync(path.join(process.cwd(), 'public', 'narration.mp3'))) {
    console.log('3️⃣ Synthesizing speech & word timestamps...');
    const narrationText = manifest.scenes.map((s) => s.narration).join(' ');
    ttsResult = await synthesizeElevenLabsSpeech(narrationText);
    saveCheckpoint(ttsCheckpointPath, { wordTimestamps: ttsResult.wordTimestamps, durationSeconds: ttsResult.durationSeconds, completedAt: new Date().toISOString() });
    console.log('   ✅ TTS checkpoint saved.');
  } else {
    console.log('3️⃣ Loaded existing TTS checkpoint (skipping re-synthesis).');
  }

  // ── STAGE 4: Audio Sync + Save Final ──
  console.log('4️⃣ Aligning sync hints with audio timestamps...');
  const { alignedManifest, sceneBoundaries } = alignStoryboardWithTimestamps(
    manifest, ttsResult!.wordTimestamps
  );

  const outputPayload = {
    manifest: alignedManifest,
    wordTimestamps: ttsResult!.wordTimestamps,
    sceneBoundaries,
    audioDurationSeconds: ttsResult!.durationSeconds,
    audioUrl: 'narration.mp3',
    costs: {
      // Add cost tracking fields here (Phase 2)
    }
  };

  const outputFilePath = path.join(process.cwd(), 'out', 'generated_storyboard.json');
  const srcLatestPath = path.join(process.cwd(), 'src', 'lib', 'latestStory.json');
  saveCheckpoint(outputFilePath, outputPayload);
  saveCheckpoint(srcLatestPath, outputPayload);

  console.log(`✅ Saved Storyboard Manifest JSON: ${outputFilePath}`);
  console.log(`🎬 Total Scenes: ${alignedManifest.scenes.length}`);
  console.log(`⏱️ Video Duration: ${ttsResult!.durationSeconds.toFixed(1)}s`);

  // ── STAGE 5: Render (skip if video exists) ──
  const videoOutputPath = path.join(process.cwd(), 'out', 'generated_video.mp4');
  if (fs.existsSync(videoOutputPath)) {
    console.log(`5️⃣ Video already exists at ${videoOutputPath}. Skipping render.`);
    return;
  }

  console.log('\n5️⃣ Rendering video with Remotion...');
  try {
    execSync(
      `npx remotion render StorytellerExplainer "${videoOutputPath}" --props="${outputFilePath}" --codec=h264 --concurrency=1`,
      { stdio: 'inherit' }
    );
    console.log('\n======================================================');
    console.log('🎉 Explainer Video Successfully Rendered!');
    console.log(`📹 Output Video: ${videoOutputPath}`);
    console.log('======================================================\n');
  } catch (err) {
    console.error('❌ Error during Remotion rendering:', err);
    console.log('💡 The storyboard JSON is saved. Fix the issue and re-run to resume from checkpoint.');
  }
}
```

### New imports needed:

```typescript
import { ArticleData, StoryboardManifest } from './types/storyboard';
import { TtsSynthesisResult } from './lib/elevenlabsTts';
```

---

## Task 0.5: Remove Hardcoded Financial Metaphors

### Files to modify (3 files):

#### 0.5a: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/narrativeEngine.ts`

**DELETE** lines 62-71 (the "Iconic Object Representation Rules" section — the entire bullet list about waterfalls, vaults, money, rockets, skyscrapers).
**DELETE** lines 81-87 (the "Available Asset Keys" section with hardcoded `asset:waterfall`, `asset:vault`, etc.).

**REPLACE** with dynamic asset injection. After line 51 (cinematic script generated) and before line 55 (prompt2 start), add:

```typescript
// Build dynamic asset descriptions from ArticleData
const availableAssets = article.assets
  .filter(a => a.url && (a.classification === 'diagram' || a.classification === 'chart' || a.classification === 'photo'))
  .map(a => {
    const regions = a.visionAnalysis?.regions
      ? `Regions: ${a.visionAnalysis.regions.map(r => `"${r.id}" (${r.label} at ${r.boundingBox.x}%,${r.boundingBox.y}%)`).join('; ')}`
      : 'No regions identified';
    return `- "${a.id}": ${a.altText} [${a.classification}] — ${a.visionAnalysis?.description || 'No analysis available'}. ${regions}. Source URL: ${a.url}`;
  })
  .join('\n');

const assetInjectionSection = availableAssets
  ? `\nAvailable Source Assets (from the original article — use these for visual references):\n${availableAssets}\n`
  : '\nNo source images available. Use imageDescription fields for Flux AI generation.\n';
```

**INSERT** `assetInjectionSection` into `prompt2Text` where the hardcoded asset keys were (around line 87).

#### 0.5b: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/sampleData.ts`

**REWRITE** the `sampleStoryboardManifest` to be content-type-agnostic. Remove all financial metaphors (waterfall, vault, money, 500 dollars, direct deposit). Replace with a generic technology/automation narrative that works as a demo for any URL.

The new sample should:
- Use Flux-generated images (described via `imageDescription`) rather than hardcoded `asset:money` etc.
- Use generic concepts: "system architecture", "data flow", "automation pipeline"
- Keep the same structure (4-5 scenes, whiteboard layout, connectors) but with neutral content

#### 0.5c: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/narrativeEngine.ts`

**REWRITE** `buildCinematicWhiteboardFallback()` (lines 223-571) to be content-type-agnostic. The fallback should produce a generic explainer structure based on the article title, not a hardcoded financial narrative about "$500/day." Keep the scene structure but make the content dynamic:

```typescript
function buildCinematicWhiteboardFallback(
  cleanTitle: string,
  stylePreset: NarrativeEngineOptions['stylePreset'] = 'whiteboard'
): StoryboardManifest {
  // Generate generic scenes from the title and style preset
  // Use Flux image descriptions, not hardcoded asset keys
  // Keep to 4 scenes max for fallback quality
  const scenes: StoryboardScene[] = [
    {
      sceneNumber: 1,
      narration: `In today's rapidly evolving landscape, ${cleanTitle} has emerged as a critical topic. Let's break down what it means and why it matters.`,
      duration: 8,
      layout: {
        background: { type: 'solid', value: '#f8fafc' },
        elements: [
          {
            id: 'sc1_title',
            type: 'text',
            content: cleanTitle,
            x: 6, y: 4, width: 50, height: 8, zIndex: 10,
            enterAnimation: { type: 'slide_up', duration: 15, delay: 0 },
          },
          {
            id: 'sc1_hero',
            type: 'image',
            content: 'Key Concept Overview',
            revealSyncPhrase: cleanTitle.split(' ').slice(0, 3).join(' '),
            imageDescription: `A professional diagram illustrating the core concepts of ${cleanTitle}, clean modern design, isolated on white background`,
            x: 34, y: 18, width: 32, height: 40, zIndex: 1,
            enterAnimation: { type: 'scale_in', duration: 15, delay: 15 },
          },
        ],
      },
      syncHints: [{ text: cleanTitle.split(' ').slice(0, 3).join(' '), triggerAction: 'reveal', targetElementId: 'sc1_hero' }],
    },
    // ... 3 more generic scenes following the same pattern
  ];

  return {
    meta: {
      title: cleanTitle,
      targetDuration: scenes.reduce((acc, s) => acc + s.duration, 0),
      stylePreset,
    },
    scenes,
  };
}
```

Complete the fallback with 3 more scenes that follow the generic pattern (problem → solution → conclusion) rather than the financial waterfall narrative.

---

## Task 0.6: Increase Text Truncation Limits

### File: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/narrativeEngine.ts`

**Line 49:** Change `article.textContent.substring(0, 2000)` → `article.textContent.substring(0, 12000)`

### File: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/ingest.ts`

**Line 118:** Change `cleanBody.substring(0, 4000)` → `cleanBody.substring(0, 12000)`

---

## Task 0.7: Supabase Query Caching

### File: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/supabaseClient.ts`

### What to add:

A simple in-memory cache with TTL:

```typescript
// Add at the top of the file, after imports
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<any>>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data as T;
  }
  cache.delete(key);
  return null;
}

function setCached<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}
```

### What to modify:

**`getApiKey()` (line 31):** Add cache check before Supabase calls:
```typescript
const cacheKey = `apikey:${providerClean}`;
const cached = getCached<string | null>(cacheKey);
if (cached !== null || cache.has(cacheKey)) return cached;

// ... existing Supabase logic ...

// Before returning, cache the result:
const result = /* resolved key or null */;
setCached(cacheKey, result);
return result;
```

**`resolveLlmModel()` (line 80):** Add cache check:
```typescript
const cacheKey = `llm:${taskRole || 'default'}`;
const cached = getCached<ResolvedLlmConfig>(cacheKey);
if (cached) return cached;

// ... existing resolution logic ...

// Before returning:
setCached(cacheKey, result);
return result;
```

**`resolveImageModel()` (line 175):** Same pattern:
```typescript
const cacheKey = `image:${targetModelName}`;
const cached = getCached<ResolvedImageConfig>(cacheKey);
if (cached) return cached;
// ... existing logic ...
setCached(cacheKey, result);
return result;
```

---

## Phase 0 Validation Checklist

After implementing all Phase 0 tasks, verify:

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] `ingest.ts` no longer contains `const isDiagram = assetIndex % 2 === 1`
- [ ] `ingest.ts` no longer contains hardcoded `{x: 5, y: 20, width: 40, height: 60}` bounding boxes
- [ ] `narrativeEngine.ts` calls `storyboardManifestSchema.safeParse()` at least twice (Step 2 and Step 3)
- [ ] `narrativeEngine.ts` no longer has the "Iconic Object Representation Rules" bullet list
- [ ] `narrativeEngine.ts` no longer has hardcoded "Available Asset Keys" (`asset:waterfall`, etc.)
- [ ] `generateStoryFromUrl.ts` has `loadCheckpoint()` and `saveCheckpoint()` functions
- [ ] `generateStoryFromUrl.ts` skips each stage if its checkpoint file exists
- [ ] All `fetch()` calls in the 5 specified files use `fetchWithRetry()`
- [ ] `supabaseClient.ts` has caching with 5-minute TTL
- [ ] Text truncation in `ingest.ts:118` and `narrativeEngine.ts:49` is at least 12000

---

# PHASE 1 — Ingestion: The Context Engine

**Branch name:** `phase-1-context-engine`
**Goal:** Add content type classification, dynamic scene count, PDF ingestion, source-anchored narrative.
**Prerequisite:** Phase 0 complete.
**New dependency:** `pdf-parse` (install via `npm install pdf-parse`)

---

## Task 1.1: Content Type Classification

### New file: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/contextEngine.ts`

Create a new module that wraps the narrative engine with a pre-processing step:

```typescript
import { ArticleData, StoryboardManifest, StoryStylePreset } from '../types/storyboard';
import { resolveLlmModel } from './supabaseClient';
import { generateStoryboardFromArticle, NarrativeEngineOptions } from './narrativeEngine';

export type ContentType = 'tutorial' | 'news_briefing' | 'cinematic_story' | 'technical_explainer';

export interface ContentContext {
  contentType: ContentType;
  targetAudience: string;
  recommendedSceneCount: number;
  narrativeTone: string;
  estimatedVideoDurationMinutes: number;
}

export interface ContentEngineResult {
  context: ContentContext;
  manifest: StoryboardManifest;
}

export async function generateContextAwareStoryboard(
  article: ArticleData,
  options: NarrativeEngineOptions = {}
): Promise<ContentEngineResult> {
  const llmConfig = await resolveLlmModel('content_classification');

  let context: ContentContext = {
    contentType: 'technical_explainer',
    targetAudience: 'Professionals aged 22-35 interested in learning',
    recommendedSceneCount: 6,
    narrativeTone: 'Conversational and accessible',
    estimatedVideoDurationMinutes: 8,
  };

  // If we have an LLM, classify the content
  if (llmConfig.apiKey) {
    try {
      const classificationPrompt = `Analyze this article and return JSON with these fields:
- "contentType": one of "tutorial", "news_briefing", "cinematic_story", "technical_explainer"
- "targetAudience": who this content is for (e.g., "software engineers", "marketing professionals")
- "recommendedSceneCount": number between 5 and 10
- "narrativeTone": brief description (e.g., "authoritative and technical", "casual and story-driven")
- "estimatedVideoDurationMinutes": number between 5 and 15

Article Title: "${article.title}"
Article Excerpt: "${article.excerpt}"
Article Content (first 2000 chars): "${article.textContent.substring(0, 2000)}"

Return ONLY valid JSON.`;

      const response = await fetchWithRetry(
        `${llmConfig.baseUrl || 'https://api.openai.com/v1'}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${llmConfig.apiKey}`,
          },
          body: JSON.stringify({
            model: llmConfig.modelName,
            messages: [{ role: 'user', content: classificationPrompt }],
            response_format: { type: 'json_object' },
          }),
        },
        2, 1000
      );

      const data = await response.json();
      const parsed = JSON.parse(data.choices[0].message.content);
      if (parsed.contentType) {
        context = { ...context, ...parsed };
      }
    } catch (err) {
      console.warn('[ContextEngine] Classification failed, using defaults:', err);
    }
  }

  // Pass context to narrative engine via article metadata
  // The article object can be extended with context hints
  const enrichedArticle: ArticleData = {
    ...article,
    // We'll add a type extension in Phase 1.3
  };

  const manifest = await generateStoryboardFromArticle(enrichedArticle, {
    ...options,
    // Pass content type as style hint
  });

  return { context, manifest };
}
```

**Note:** The `ArticleData` type will need to be extended in Phase 1.3 to carry context metadata.

### New imports needed in `contextEngine.ts`:

```typescript
// The fetchWithRetry pattern — copy from narrativeEngine.ts or factor out into a shared utility
```

---

## Task 1.2: Dynamic Scene Count in Narrative Prompts

### File: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/narrativeEngine.ts`

### What to modify:

**MODIFY** the Step 2 prompt (around line 56) to accept a dynamic scene count. Add a parameter to the prompt:

```typescript
const recommendedScenes = options.recommendedSceneCount || 6;
```

And in the JSON structure example within the prompt, change:
```
"Generate between 5 and 10 scenes..."
```

The prompt should instruct the LLM: `"You must produce exactly ${recommendedScenes} scenes (give or take 1)."`

### Also add to `NarrativeEngineOptions`:

```typescript
export interface NarrativeEngineOptions {
  stylePreset?: StoryStylePreset;
  recommendedSceneCount?: number;
  contentType?: string;
}
```

---

## Task 1.3: PDF Ingestion

### File: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/ingest.ts`

### New dependency:

```bash
npm install pdf-parse
npm install --save-dev @types/pdf-parse
```

### New function:

```typescript
export async function ingestPdf(pdfPath: string): Promise<ArticleData> {
  console.log(`[IngestEngine] Ingesting PDF: ${pdfPath}...`);

  try {
    // Dynamic import to avoid issues if pdf-parse isn't installed
    const pdfParse = (await import('pdf-parse')).default;

    let pdfBuffer: Buffer;

    if (pdfPath.startsWith('http://') || pdfPath.startsWith('https://')) {
      const response = await fetchWithRetry(pdfPath, {
        headers: { 'User-Agent': 'Mozilla/5.0 ...' }
      }, 2, 1000);
      const arrayBuffer = await response.arrayBuffer();
      pdfBuffer = Buffer.from(arrayBuffer);
    } else {
      pdfBuffer = fs.readFileSync(pdfPath);
    }

    const pdfData = await pdfParse(pdfBuffer);

    const title = pdfData.info?.Title || extractTitleFromText(pdfData.text) || 'Untitled Document';
    const excerpt = pdfData.text.substring(0, 300).replace(/\n/g, ' ').trim();
    const wordCount = pdfData.text.split(/\s+/).length;

    // For PDF images: use a separate extraction step
    // pdf-parse doesn't extract images, so we'll use pdf-img-convert
    // or note that images aren't available from this PDF
    const assets: ArticleAsset[] = [];

    // Try to extract images if pdf-img-convert is available
    try {
      const pdfImgConvert = await import('pdf-img-convert');
      // This is optional — skip if the library isn't installed
      console.log('[IngestEngine] pdf-img-convert available for image extraction');
    } catch {
      console.log('[IngestEngine] pdf-img-convert not installed. PDF images will not be extracted.');
    }

    return {
      title,
      excerpt,
      textContent: pdfData.text.substring(0, 12000),
      wordCount: Math.max(wordCount, 1),
      assets,
    };
  } catch (err) {
    console.error('[IngestEngine] PDF ingestion failed:', err);
    return generateFallbackArticleData(pdfPath);
  }
}

function extractTitleFromText(text: string): string | null {
  const lines = text.split('\n').filter(l => l.trim().length > 10);
  return lines[0]?.trim()?.substring(0, 120) || null;
}
```

### New import needed:

```typescript
import fs from 'fs';
```

### Modify `generateStoryFromUrl.ts` to auto-detect PDF vs URL:

```typescript
const isPdf = targetUrl.toLowerCase().endsWith('.pdf') || targetUrl.startsWith('/') && targetUrl.endsWith('.pdf');
if (isPdf) {
  article = await ingestPdf(targetUrl);
} else {
  article = await ingestUrl(targetUrl);
}
```

---

## Task 1.4: Source-Anchored Narrative Injection

### File: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/narrativeEngine.ts`

### What to modify:

**REPLACE** the current asset key resolution in `generateStoryFromUrl.ts` (lines 34-46) with a source-first strategy:

```typescript
// In generateStoryFromUrl.ts, the asset resolution loop (around line 34):
for (const element of scene.layout.elements) {
  if (element.type === 'image') {
    // PRIORITY 1: Source image match
    if (element.sourceAssetId && element.sourceAssetId.startsWith('asset_')) {
      const sourceAsset = article.assets.find(a => a.id === element.sourceAssetId);
      if (sourceAsset?.url) {
        element.sourceAssetId = sourceAsset.url;
        console.log(`   └─ Element '${element.id}' → SOURCE IMAGE: ${sourceAsset.url}`);
        continue;
      }
    }

    // PRIORITY 2: Catalog cache
    const rawAsset = element.sourceAssetId || element.content || 'concept';
    const detailedPrompt = element.imageDescription || element.content || rawAsset;
    const resolved = await getOrGenerateConceptImage(rawAsset, detailedPrompt, imageStyle);
    element.sourceAssetId = resolved.imageUrl;
    console.log(`   └─ Element '${element.id}' → ${resolved.fromCache ? 'CACHED' : 'FLUX GEN'}: ${resolved.imageUrl}`);
  }
}
```

The key change: source images with IDs like `asset_1`, `asset_2` (from `ArticleData.assets[]`) take priority over Flux-generated concept images.

---

## Phase 1 Validation Checklist

- [ ] `npx tsc --noEmit` passes
- [ ] `contextEngine.ts` exists and exports `generateContextAwareStoryboard()`
- [ ] `ingestPdf()` exists and handles both local files and URLs
- [ ] `narrativeEngine.ts` Step 2 prompt accepts dynamic scene count
- [ ] Source images (IDs like `asset_1`) are resolved before Flux generation
- [ ] `pdf-parse` is in `package.json` dependencies

---

# PHASE 2 — Direction: The Interactive Storyboard

**Branch name:** `phase-2-interactive-storyboard`
**Goal:** Build the NLE timeline UI, camera controls, avatar/voice selection, editable storyboard.
**Prerequisite:** Phase 1 complete.

---

## Task 2.1: Director's Chair — Camera Presets

### File: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/compositions/storyteller/CameraRig.tsx`

### Current state: Empty stub returning `{children}`.

### Implementation:

```typescript
import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

export interface CameraInstruction {
  preset: 'slow_dolly_in' | 'macro_focus_pull' | 'dutch_angle' | 'crane_up' | 'static';
  intensity: number;        // 0.0 - 1.0
  durationFrames: number;
  targetElementId?: string;
}

interface CameraRigProps {
  children: React.ReactNode;
  camera?: CameraInstruction;
  fps?: number;
}

export const CameraRig: React.FC<CameraRigProps> = ({
  children,
  camera,
  fps = 30,
}) => {
  const frame = useCurrentFrame();

  if (!camera || camera.preset === 'static') {
    return <div style={{ width: '100%', height: '100%' }}>{children}</div>;
  }

  // Calculate animation progress
  const progress = Math.min(frame / camera.durationFrames, 1);

  let transform = 'none';
  let filter = 'none';

  switch (camera.preset) {
    case 'slow_dolly_in': {
      const scale = interpolate(progress, [0, 1], [1.0, 1.0 + camera.intensity * 0.2]);
      transform = `scale(${scale})`;
      break;
    }
    case 'macro_focus_pull': {
      const blur = interpolate(progress, [0, 0.3, 0.7, 1], [0, 8, 8, 0]) * camera.intensity;
      const scale = interpolate(progress, [0, 1], [1.0, 1.05]);
      filter = `blur(${blur}px)`;
      transform = `scale(${scale})`;
      break;
    }
    case 'dutch_angle': {
      const rotation = interpolate(progress, [0, 0.2, 0.8, 1], [0, -3, -3, 0]) * camera.intensity;
      transform = `rotate(${rotation}deg)`;
      break;
    }
    case 'crane_up': {
      const translateY = interpolate(progress, [0, 1], [0, -15]) * camera.intensity;
      transform = `translateY(${translateY}%)`;
      break;
    }
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        transform,
        filter,
        transformOrigin: 'center center',
        transition: 'none',
      }}
    >
      {children}
    </div>
  );
};
```

### Add the `CameraInstruction` type to `storyboard.ts`:

Insert after line 114 (after `StoryStylePreset`):
```typescript
export interface CameraInstruction {
  preset: 'slow_dolly_in' | 'macro_focus_pull' | 'dutch_angle' | 'crane_up' | 'static';
  intensity: number;
  durationFrames: number;
  targetElementId?: string;
}
```

---

## Task 2.2: Director's Chair — Lighting Presets

### File: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/compositions/storyteller/BackgroundRenderer.tsx`

### What to add:

Lighting presets as CSS overlays:

```typescript
export type LightingPreset = 'golden_hour' | 'studio_key' | 'dramatic_shadows' | 'flat';

interface BackgroundRendererProps {
  background: SceneBackground;
  lighting?: LightingPreset;
}

export const BackgroundRenderer: React.FC<BackgroundRendererProps> = ({
  background,
  lighting = 'flat',
}) => {
  // Existing background rendering...

  // Lighting overlay
  const lightingOverlays: Record<LightingPreset, React.CSSProperties> = {
    flat: {},
    golden_hour: {
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(135deg, rgba(255, 200, 100, 0.15) 0%, rgba(255, 150, 50, 0.05) 100%)',
      pointerEvents: 'none',
      zIndex: 100,
    },
    studio_key: {
      position: 'absolute',
      inset: 0,
      background: 'radial-gradient(ellipse at 50% 30%, rgba(255,255,255,0.1) 0%, rgba(0,0,0,0.05) 100%)',
      pointerEvents: 'none',
      zIndex: 100,
    },
    dramatic_shadows: {
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.3) 100%)',
      pointerEvents: 'none',
      zIndex: 100,
    },
  };

  return (
    <>
      {/* Existing background divs... */}
      <div style={lightingOverlays[lighting]} />
    </>
  );
};
```

---

## Task 2.3: NLE Timeline UI

### File: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/components/studio/StoryStudio.tsx`

### What to add:

This is the largest UI task. The existing `StoryStudio.tsx` (271 lines) needs to grow into a true NLE.

**New UI sections to add:**

1. **A-Roll Track (Top horizontal bar):**
   - Narration waveform visualization (simplified: colored blocks per scene)
   - Scene duration indicators
   - Click-to-select scene

2. **B-Roll Track (Below A-Roll):**
   - Visual element thumbnails aligned to narration timing
   - Element type badges (image/text/connector/highlight)
   - Drag handles for repositioning

3. **Director's Chair Panel (Collapsible top bar):**
   - Camera preset dropdown: `['static', 'slow_dolly_in', 'macro_focus_pull', 'dutch_angle', 'crane_up']`
   - Intensity slider: 0.0-1.0
   - Lighting preset dropdown: `['flat', 'golden_hour', 'studio_key', 'dramatic_shadows']`

4. **Avatar/Voice Picker (Sidebar or modal):**
   - Voice profile selector: dropdown of ElevenLabs voice IDs
   - Avatar selector: dropdown or grid of available avatars

**State additions to StoryStudio:**

```typescript
interface DirectorState {
  camera: CameraInstruction;
  lighting: LightingPreset;
  voiceId: string;
  avatarId: string;
}

// Add to existing state:
const [directorState, setDirectorState] = useState<DirectorState>({
  camera: { preset: 'static', intensity: 0.5, durationFrames: 90 },
  lighting: 'flat',
  voiceId: '21m00Tcm4TlvDq8ikWAM', // Rachel
  avatarId: 'none',
});

// Narration editing per scene
const [editedNarrations, setEditedNarrations] = useState<Record<number, string>>({});

// Scene reordering
const handleMoveScene = (fromIndex: number, toIndex: number) => {
  const newScenes = [...manifest.scenes];
  const [moved] = newScenes.splice(fromIndex, 1);
  newScenes.splice(toIndex, 0, moved);
  setManifest({ ...manifest, scenes: newScenes });
};
```

**Timeline component (add as a new section between the header and main body):**

```typescript
// Simplified timeline rendering:
<div style={{
  display: 'flex', gap: '2px', padding: '12px 28px',
  backgroundColor: '#0a0e17', borderBottom: '1px solid #1e293b',
  overflowX: 'auto',
}}>
  {/* A-Roll Label */}
  <div style={{ minWidth: '60px', fontSize: '10px', color: '#64748b', fontWeight: 700 }}>
    A-ROLL
  </div>
  {manifest.scenes.map((scene, idx) => (
    <div
      key={scene.sceneNumber}
      onClick={() => setSelectedSceneIndex(idx)}
      style={{
        minWidth: `${Math.max(scene.duration * 12, 60)}px`,
        height: '32px',
        backgroundColor: selectedSceneIndex === idx ? '#6366f1' : '#1e293b',
        borderRadius: '4px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '10px', fontWeight: 600, color: '#e2e8f0',
        cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden',
        textOverflow: 'ellipsis', padding: '0 6px',
        border: selectedSceneIndex === idx ? '2px solid #a5b4fc' : '1px solid #334155',
      }}
    >
      S{scene.sceneNumber}: ~{scene.duration}s
    </div>
  ))}
</div>
```

---

## Task 2.4: Editable Narration and Visual Prompts

### File: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/components/studio/StoryStudio.tsx`

### Modify the right inspector panel (lines 222-267):

Replace the read-only narration display (line 239-241) with an editable textarea:

```typescript
<textarea
  value={editedNarrations[activeScene.sceneNumber] ?? activeScene.narration}
  onChange={(e) => {
    setEditedNarrations(prev => ({
      ...prev,
      [activeScene.sceneNumber]: e.target.value,
    }));
  }}
  onBlur={() => {
    // Apply changes to manifest
    const newScenes = manifest.scenes.map(s =>
      s.sceneNumber === activeScene.sceneNumber
        ? { ...s, narration: editedNarrations[activeScene.sceneNumber] || s.narration }
        : s
    );
    setManifest({ ...manifest, scenes: newScenes });
  }}
  style={{
    width: '100%',
    minHeight: '80px',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '8px',
    padding: '10px',
    color: '#cbd5e1',
    fontSize: '13px',
    lineHeight: '1.5',
    resize: 'vertical',
    outline: 'none',
    fontFamily: 'Inter, system-ui, sans-serif',
  }}
/>
```

Add editable `imageDescription` fields for each canvas element in the inspector.

---

## Task 2.5: Cost Estimator Before Render

### File: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/components/studio/StoryStudio.tsx`

### Add a render panel with cost estimate:

```typescript
const estimateCost = (): { total: string; breakdown: Record<string, string> } => {
  const sceneCount = manifest.scenes.length;
  const imageCount = manifest.scenes.reduce((acc, s) => acc + (s.layout?.elements?.filter(e => e.type === 'image').length || 0), 0);
  const totalNarrationChars = manifest.scenes.reduce((acc, s) => acc + s.narration.length, 0);

  const llmCost = sceneCount * 0.005;          // ~$0.005 per LLM call
  const ttsCost = totalNarrationChars * 0.000015; // ElevenLabs: ~$0.015 per 1k chars
  const imageCost = imageCount * 0.01;         // ~$0.01 per Flux image
  const renderCost = 0.05;                     // Remotion render overhead

  return {
    total: `$${(llmCost + ttsCost + imageCost + renderCost).toFixed(2)}`,
    breakdown: {
      'LLM Generation': `$${llmCost.toFixed(3)}`,
      'Voice Synthesis': `$${ttsCost.toFixed(3)}`,
      'Image Generation': `$${imageCost.toFixed(3)}`,
      'Video Rendering': `$${renderCost.toFixed(2)}`,
    },
  };
};
```

Display this in a "Render" panel with a "Approve & Render" button.

---

## Phase 2 Validation Checklist

- [ ] `npx tsc --noEmit` passes
- [ ] `CameraRig.tsx` implements `slow_dolly_in`, `macro_focus_pull`, `dutch_angle`, `crane_up`
- [ ] `BackgroundRenderer.tsx` supports `golden_hour`, `studio_key`, `dramatic_shadows` lighting
- [ ] `StoryStudio.tsx` has a horizontal timeline with clickable scene blocks
- [ ] Right inspector has editable textarea for narration
- [ ] Director's Chair panel shows camera/lighting dropdowns
- [ ] Cost estimator shows before render button
- [ ] Camera and lighting settings flow through to `SceneCanvas` → `BackgroundRenderer` + `CameraRig`

---

# PHASE 3 — Rendering: Parallel Synthesis

**Branch name:** `phase-3-parallel-rendering`
**Goal:** Parallel asset generation, sound effects, background music, cost tiers.
**Prerequisite:** Phase 2 complete.

---

## Task 3.1: Parallel Asset Generation

### File: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/generateStoryFromUrl.ts`

### What to change:

After the storyboard is locked, run TTS and image generation in parallel:

```typescript
// Lock the manifest
console.log('3️⃣ Generating assets in parallel...');

const narrationText = manifest.scenes.map((s) => s.narration).join(' ');

const [ttsResult, _imageResults] = await Promise.all([
  // TTS
  synthesizeElevenLabsSpeech(narrationText),

  // Images (resolve all in parallel)
  Promise.all(
    manifest.scenes.flatMap(scene =>
      (scene.layout?.elements || [])
        .filter(el => el.type === 'image')
        .map(el => {
          const prompt = el.imageDescription || el.content || 'concept';
          return getOrGenerateConceptImage(
            el.sourceAssetId || el.content || 'concept',
            prompt,
            imageStyle
          ).then(resolved => {
            el.sourceAssetId = resolved.imageUrl;
            return resolved;
          });
        })
    )
  ),
]);
```

---

## Task 3.2: Sound Effects Engine

### New file: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/sfxEngine.ts`

```typescript
export interface SfxCue {
  sceneNumber: number;
  startSeconds: number;
  durationSeconds: number;
  soundType: 'typing' | 'cash_register' | 'whoosh' | 'ambient_office' | 'click' | 'reveal' | 'none';
  volume: number; // 0.0 - 1.0
}

const SFX_MAP: Record<string, string> = {
  typing: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3',
  whoosh: 'https://assets.mixkit.co/active_storage/sfx/2569/2569-preview.mp3',
  click: 'https://assets.mixkit.co/active_storage/sfx/2570/2570-preview.mp3',
  reveal: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',
  cash_register: 'https://assets.mixkit.co/active_storage/sfx/2572/2572-preview.mp3',
  ambient_office: 'https://assets.mixkit.co/active_storage/sfx/2573/2573-preview.mp3',
};

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
    for (const hint of scene.syncHints) {
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
```

---

## Task 3.3: Background Music Support

### File: `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/compositions/storyteller/ExplainerStoryComposition.tsx`

### Add background music with auto-ducking:

```typescript
// Inside ExplainerStoryComposition, after <Audio src={audioSrc} />:

{/* Background Music (ducked during narration) */}
<Audio
  src={staticFile('background_music.mp3')}
  volume={0.15} // -16dB relative to narration
/>

{/* SFX Layer */}
{sceneBoundaries.map((boundary, idx) => {
  const cue = sfxCues.find(c => c.sceneNumber === idx + 1 && c.soundType === 'whoosh');
  if (!cue) return null;
  return (
    <Sequence
      key={`sfx-${idx}`}
      from={Math.round(cue.startSeconds * fps)}
      durationInFrames={Math.round(cue.durationSeconds * fps)}
    >
      <Audio src={SFX_MAP[cue.soundType]} volume={cue.volume} />
    </Sequence>
  );
})}
```

---

## Phase 3 Validation Checklist

- [ ] `npx tsc --noEmit` passes
- [ ] `sfxEngine.ts` exports `generateSfxCues()` and `SfxCue`
- [ ] TTS and image generation run in `Promise.all()`
- [ ] Background music track ducked during narration
- [ ] Sound effects synced to scene boundaries and element reveals

---

# COMPLETE FILE CHANGE SUMMARY

| Phase | File | Action |
|---|---|---|
| 0.1 | `src/lib/ingest.ts` | ADD `classifyAndAnalyzeImage()`, REMOVE fake `visionAnalysis`, ADD `fetchWithRetry` |
| 0.2 | `src/lib/narrativeEngine.ts` | ADD `storyboardManifestSchema.safeParse()` at lines 129, 176 |
| 0.3 | 5 lib files | ADD `fetchWithRetry()` to all 5 files, wrap existing `fetch()` calls |
| 0.4 | `src/generateStoryFromUrl.ts` | ADD `loadCheckpoint()`, `saveCheckpoint()`, stage-gated execution |
| 0.5 | `src/lib/narrativeEngine.ts` | REMOVE hardcoded asset keys, ADD dynamic `assetInjectionSection` |
| 0.5 | `src/lib/sampleData.ts` | REWRITE to content-agnostic narrative |
| 0.5 | `src/lib/narrativeEngine.ts` | REWRITE `buildCinematicWhiteboardFallback()` |
| 0.6 | `src/lib/narrativeEngine.ts:49` | Change `2000` → `12000` |
| 0.6 | `src/lib/ingest.ts:118` | Change `4000` → `12000` |
| 0.7 | `src/lib/supabaseClient.ts` | ADD in-memory cache with 5-min TTL |
| 1.1 | `src/lib/contextEngine.ts` | **NEW FILE** — content classification + context-aware generation |
| 1.2 | `src/lib/narrativeEngine.ts` | ADD `recommendedSceneCount` to options + prompt |
| 1.3 | `src/lib/ingest.ts` | ADD `ingestPdf()` function |
| 1.3 | `package.json` | ADD `pdf-parse` dependency |
| 1.4 | `src/generateStoryFromUrl.ts` | ADD source-first asset resolution priority |
| 2.1 | `src/compositions/storyteller/CameraRig.tsx` | IMPLEMENT camera presets (was stub) |
| 2.1 | `src/types/storyboard.ts` | ADD `CameraInstruction` interface |
| 2.2 | `src/compositions/storyteller/BackgroundRenderer.tsx` | ADD lighting presets |
| 2.3 | `src/components/studio/StoryStudio.tsx` | ADD NLE timeline, Director's Chair panel |
| 2.4 | `src/components/studio/StoryStudio.tsx` | ADD editable narration textarea |
| 2.5 | `src/components/studio/StoryStudio.tsx` | ADD cost estimator panel |
| 3.1 | `src/generateStoryFromUrl.ts` | CONVERT to `Promise.all()` parallel generation |
| 3.2 | `src/lib/sfxEngine.ts` | **NEW FILE** — SFX cue generation |
| 3.3 | `src/compositions/storyteller/ExplainerStoryComposition.tsx` | ADD background music + SFX layers |
