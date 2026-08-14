# Post-Audit Fix Instructions for AI Coding Agent

> **Target Repo:** `/Users/jorgefernandezilufi/Documents/_article_research/remotion/`
> **Current Commit:** `1307375` (main, clean)
> **Validation:** `npx tsc --noEmit` must pass after all fixes
> **Branch Rule:** `git checkout -b fix-<descriptive-slug>` before any edits

---

## FIX 1 — 🔴 CRITICAL: Add `clearCanvas` and `canvasMode` to Zod Schema

### Why
`narrativeEngine.ts` now validates all LLM output through `storyboardManifestSchema.safeParse()`. But the schema at `storyboardSceneSchema` lacks `clearCanvas` and `canvasMode` fields. Zod strips unknown keys by default, so every validated manifest loses its canvas clearing instructions. The whiteboard accumulation logic in `ExplainerStoryComposition` will never trigger canvas wipes.

### File to edit
`/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/types/storyboard.ts`

### Exact change — lines 243-252

**FIND this block:**
```typescript
export const storyboardSceneSchema = z.object({
  sceneNumber: z.number(),
  narration: z.string(),
  duration: z.number(),
  layout: z.object({
    background: sceneBackgroundSchema,
    elements: z.array(canvasElementSchema),
  }),
  syncHints: z.array(syncHintSchema),
});
```

**REPLACE with this block:**
```typescript
export const storyboardSceneSchema = z.object({
  sceneNumber: z.number(),
  narration: z.string(),
  duration: z.number(),
  layout: z.object({
    background: sceneBackgroundSchema,
    clearCanvas: z.boolean().optional(),
    canvasMode: z.enum(['accumulate', 'clear_canvas']).optional(),
    elements: z.array(canvasElementSchema),
  }),
  syncHints: z.array(syncHintSchema),
});
```

### Validation
- [ ] `npx tsc --noEmit` passes
- [ ] `clearCanvas` and `canvasMode` survive a `storyboardManifestSchema.safeParse()` round-trip

---

## FIX 2 — 🔴 CRITICAL: Fix Gemini Vision to Send Actual Image Bytes

### Why
`classifyAndAnalyzeImage()` in `ingest.ts` has a Gemini branch that sends the image URL as plain text inside the prompt: `{ text: "${promptText}\nImage URL: ${imageUrl}" }`. Gemini cannot fetch URLs from text prompts — it needs the actual image bytes as `inlineData` (base64) or a `fileData` Google Cloud URI. Currently every Gemini vision call classifies based on alt text alone, not actual image content.

### File to edit
`/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/ingest.ts`

### Exact change — lines 177-201

**FIND this block (the Gemini branch inside `classifyAndAnalyzeImage()`):**
```typescript
    if (llmConfig.provider === 'gemini') {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${llmConfig.modelName}:generateContent?key=${llmConfig.apiKey}`;
      const res = await fetchWithRetry(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: `${promptText}\nImage URL: ${imageUrl}` }
                ]
              }
            ],
            generationConfig: { responseMimeType: 'application/json' }
          })
        },
        2,
        1000
      );
      const data = await res.json();
      rawJsonResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
```

**REPLACE with this block:**
```typescript
    if (llmConfig.provider === 'gemini') {
      // Download the image and convert to base64 for Gemini's inlineData
      let base64Image: string;
      let mimeType = 'image/png';
      try {
        const imgResponse = await fetchWithRetry(imageUrl, {}, 2, 1000);
        const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
        base64Image = imgBuffer.toString('base64');
        // Detect MIME type from Content-Type header or URL extension
        const contentType = imgResponse.headers.get('content-type') || '';
        if (contentType.includes('jpeg') || contentType.includes('jpg') || imageUrl.endsWith('.jpg') || imageUrl.endsWith('.jpeg')) {
          mimeType = 'image/jpeg';
        } else if (contentType.includes('webp') || imageUrl.endsWith('.webp')) {
          mimeType = 'image/webp';
        } else if (contentType.includes('gif') || imageUrl.endsWith('.gif')) {
          mimeType = 'image/gif';
        }
      } catch (downloadErr) {
        console.warn('[IngestEngine] Failed to download image for Gemini vision, falling back to URL text:', downloadErr);
        // Fallback: send URL as text (Gemini may still reason about it)
        base64Image = '';
      }

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${llmConfig.modelName}:generateContent?key=${llmConfig.apiKey}`;
      const parts: any[] = [{ text: promptText }];
      if (base64Image) {
        parts.push({ inlineData: { mimeType, data: base64Image } });
      }

      const res = await fetchWithRetry(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseMimeType: 'application/json' }
          })
        },
        2,
        1000
      );
      const data = await res.json();
      rawJsonResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
```

### Validation
- [ ] `npx tsc --noEmit` passes
- [ ] Gemini vision calls now receive actual image bytes
- [ ] Falls back gracefully if image download fails

---

## FIX 3 — 🔴 CRITICAL: Wire Camera and Lighting Props Through ExplainerStoryComposition

### Why
`SceneCanvas.tsx` accepts `camera` and `lighting` props and passes them to `CameraRig` and `BackgroundRenderer`. But `ExplainerStoryComposition.tsx` never receives these props and never passes them to `SceneCanvas`. The Director's Chair controls in `StoryStudio.tsx` change state but have zero effect on the rendered video.

### Files to edit

**File 1:** `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/types/storyboard.ts`

**Find** the `ExplainerCompositionProps` interface (around line 151):

```typescript
export interface ExplainerCompositionProps {
  articleUrl?: string;
  manifest?: StoryboardManifest;
  wordTimestamps?: WordTimestamp[];
  audioUrl?: string;
  bgMusicUrl?: string;
  sfxCues?: any[];
  fps?: number;
}
```

**Replace** with:

```typescript
export interface ExplainerCompositionProps {
  articleUrl?: string;
  manifest?: StoryboardManifest;
  wordTimestamps?: WordTimestamp[];
  audioUrl?: string;
  bgMusicUrl?: string;
  sfxCues?: any[];
  camera?: CameraInstruction;
  lighting?: string;
  fps?: number;
}
```

**File 2:** `/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/compositions/storyteller/ExplainerStoryComposition.tsx`

**Find** the destructured props (lines 12-18):

```typescript
export const ExplainerStoryComposition: React.FC<ExplainerCompositionProps> = ({
  manifest = sampleStoryboardManifest,
  wordTimestamps = sampleWordTimestamps,
  audioUrl = "narration.mp3",
  bgMusicUrl,
  sfxCues: inputSfxCues,
}) => {
```

**Replace** with:

```typescript
export const ExplainerStoryComposition: React.FC<ExplainerCompositionProps> = ({
  manifest = sampleStoryboardManifest,
  wordTimestamps = sampleWordTimestamps,
  audioUrl = "narration.mp3",
  bgMusicUrl,
  sfxCues: inputSfxCues,
  camera,
  lighting,
}) => {
```

**Find** the `<SceneCanvas>` invocation (line 187):

```typescript
            <SceneCanvas scene={persistentScene} fps={fps} />
```

**Replace** with:

```typescript
            <SceneCanvas scene={persistentScene} fps={fps} camera={camera} lighting={lighting as any} />
```

### Validation
- [ ] `npx tsc --noEmit` passes
- [ ] Camera preset and lighting preset now flow from `ExplainerCompositionProps` → `SceneCanvas` → `CameraRig`/`BackgroundRenderer`

---

## FIX 4 — 🟠 HIGH: Fix `sfxCues` Type from `any[]` to `SfxCue[]`

### Why
The `ExplainerCompositionProps` interface uses `any[]` for SFX cues, defeating TypeScript's type safety on the entire SFX layer.

### File to edit
`/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/types/storyboard.ts`

### Step A — Add import at top (after existing imports, around line 1):

```typescript
import { z } from 'zod';
import type { SfxCue } from '../lib/sfxEngine';  // ADD THIS LINE
```

**Wait — this creates a potential circular dependency issue.** `sfxEngine.ts` imports from `./audioSync` which imports from `../types/storyboard`. Adding an import of `sfxEngine` from `storyboard.ts` creates a cycle: `storyboard.ts` → `sfxEngine.ts` → `audioSync.ts` → `storyboard.ts`.

### Solution: Use an inline type instead

**Find** line 157:

```typescript
  sfxCues?: any[];
```

**Replace** with:

```typescript
  sfxCues?: Array<{
    sceneNumber: number;
    startSeconds: number;
    durationSeconds: number;
    soundType: string;
    volume: number;
  }>;
```

This avoids the circular import while providing type safety.

### Validation
- [ ] `npx tsc --noEmit` passes
- [ ] No circular dependency warnings

---

## FIX 5 — 🟠 HIGH: Inject `contentType` Into Narrative Engine Prompts

### Why
`contextEngine.ts` classifies content type (tutorial/news_briefing/cinematic_story/technical_explainer) and passes it to `generateStoryboardFromArticle()`, but the narrative prompts never use this field. A tutorial and a cinematic story get identical prompt engineering. This wastes the classification LLM call.

### File to edit
`/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/narrativeEngine.ts`

### Change 1 — Lines 34-53 (Step 1 prompt)

**FIND** the prompt1Text template literal (lines 35-53). **INSERT** after line 38 (after "Audience: A young professional..." line) and before the "Writing Rules & Style" section:

```
Content Type: "${options.contentType || 'technical_explainer'}"
${options.contentType === 'tutorial' ? '- Structure: Step-by-step learning journey. Each scene builds on the previous with clear progression.' : ''}
${options.contentType === 'news_briefing' ? '- Structure: Lead with the most important fact. Keep scenes concise and fact-dense.' : ''}
${options.contentType === 'cinematic_story' ? '- Structure: Hero's journey arc. Open with a hook, build tension, deliver resolution.' : ''}
${options.contentType === 'technical_explainer' ? '- Structure: Break down complex systems visually. Use diagrams and flow metaphors.' : ''}
```

### Change 2 — Lines 75-125 (Step 2 prompt)

**FIND** the prompt2Text template. **INSERT** after line 79 (after "Visual Style: Hybrid Whiteboard..." description) and before "Title Collision & Safe-Zone Rules":

```
Content Type Format: ${options.contentType === 'tutorial' ? 'Number scenes sequentially (Step 1, Step 2...). Use instructional tone.' : options.contentType === 'news_briefing' ? 'Label scenes as News Segments. Keep visuals high-impact and fact-focused.' : options.contentType === 'cinematic_story' ? 'Label scenes as Story Beats. Build dramatic arc with visual crescendos.' : 'Label scenes as System Components. Focus on architecture diagrams and flow visualizations.'}
```

### Validation
- [ ] `npx tsc --noEmit` passes
- [ ] Different content types produce different narrative structures
- [ ] Works with `contentType: undefined` (falls through to `technical_explainer` default)

---

## FIX 6 — 🟡 MEDIUM: Add PDF Detection to StoryStudio

### Why
`StoryStudio.tsx` hardcodes `ingestUrl()` in its `handleIngest` function. Pasting a PDF URL will fail. The orchestrator (`generateStoryFromUrl.ts`) correctly detects PDFs but the Studio does not.

### File to edit
`/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/components/studio/StoryStudio.tsx`

### Change — Lines 37-43

**FIND:**
```typescript
    try {
      const article = await ingestUrl(urlInput);
      const result = await generateContextAwareStoryboard(article, {
```

**REPLACE with:**
```typescript
    try {
      const isPdf = urlInput.toLowerCase().endsWith('.pdf') || (urlInput.startsWith('/') && urlInput.endsWith('.pdf'));
      const article = isPdf ? await ingestPdf(urlInput) : await ingestUrl(urlInput);
      const result = await generateContextAwareStoryboard(article, {
```

### Also add import at top (around line 7):

**FIND:**
```typescript
import { ingestUrl } from '../../lib/ingest';
```

**REPLACE with:**
```typescript
import { ingestUrl, ingestPdf } from '../../lib/ingest';
```

### Validation
- [ ] `npx tsc --noEmit` passes
- [ ] Pasting a PDF URL in the Studio triggers `ingestPdf()` instead of `ingestUrl()`

---

## FIX 7 — 🟡 MEDIUM: Extend Sample Word Timestamps to Cover Full Narration

### Why
`sampleWordTimestamps` has only 8 entries covering ~3 seconds. The sample manifest has 4 scenes with ~40 seconds of narration. The Remotion preview shows no timing data for 90%+ of the narration, making the audio sync feature invisible in development.

### File to edit
`/Users/jorgefernandezilufi/Documents/_article_research/remotion/src/lib/sampleData.ts`

### Change — Starting at line 208

**FIND** the entire `sampleWordTimestamps` array (lines 208-217).
**REPLACE** with an expanded set that covers all 4 scenes. Generate ~90-100 word timestamps spanning ~40 seconds:

```typescript
export const sampleWordTimestamps: WordTimestamp[] = [
  // Scene 1: Introduction (~10s)
  { word: 'Modern', start: 0.2, end: 0.6 },
  { word: 'software', start: 0.7, end: 1.0 },
  { word: 'development', start: 1.1, end: 1.6 },
  { word: 'is', start: 1.7, end: 1.8 },
  { word: 'undergoing', start: 1.9, end: 2.4 },
  { word: 'a', start: 2.5, end: 2.6 },
  { word: 'fundamental', start: 2.7, end: 3.2 },
  { word: 'shift.', start: 3.3, end: 3.8 },
  { word: 'By', start: 4.0, end: 4.2 },
  { word: 'pairing', start: 4.3, end: 4.6 },
  { word: 'intelligent', start: 4.7, end: 5.2 },
  { word: 'orchestration', start: 5.3, end: 5.9 },
  { word: 'with', start: 6.0, end: 6.2 },
  { word: 'fast', start: 6.3, end: 6.5 },
  { word: 'rendering', start: 6.6, end: 7.0 },
  { word: 'pipelines,', start: 7.1, end: 7.5 },
  { word: 'teams', start: 7.6, end: 7.8 },
  { word: 'can', start: 7.9, end: 8.1 },
  { word: 'automate', start: 8.2, end: 8.6 },
  { word: 'complex', start: 8.7, end: 9.0 },
  { word: 'workflows', start: 9.1, end: 9.5 },
  { word: 'seamlessly.', start: 9.6, end: 10.2 },

  // Scene 2: Processing Pipeline (~10s)
  { word: 'At', start: 10.8, end: 11.0 },
  { word: 'the', start: 11.1, end: 11.2 },
  { word: 'core', start: 11.3, end: 11.5 },
  { word: 'of', start: 11.6, end: 11.7 },
  { word: 'this', start: 11.8, end: 12.0 },
  { word: 'system,', start: 12.1, end: 12.4 },
  { word: 'incoming', start: 12.5, end: 12.8 },
  { word: 'unstructured', start: 12.9, end: 13.4 },
  { word: 'data', start: 13.5, end: 13.7 },
  { word: 'passes', start: 13.8, end: 14.1 },
  { word: 'through', start: 14.2, end: 14.5 },
  { word: 'vision', start: 14.6, end: 14.9 },
  { word: 'classification', start: 15.0, end: 15.6 },
  { word: 'and', start: 15.7, end: 15.8 },
  { word: 'LLM', start: 15.9, end: 16.2 },
  { word: 'reasoning', start: 16.3, end: 16.8 },
  { word: 'engines.', start: 16.9, end: 17.4 },
  { word: 'This', start: 17.5, end: 17.7 },
  { word: 'creates', start: 17.8, end: 18.1 },
  { word: 'structured', start: 18.2, end: 18.7 },
  { word: 'storyboard', start: 18.8, end: 19.3 },
  { word: 'blueprints', start: 19.4, end: 19.9 },
  { word: 'in', start: 20.0, end: 20.1 },
  { word: 'milliseconds.', start: 20.2, end: 20.9 },

  // Scene 3: Multi-Track Execution (~12s)
  { word: 'The', start: 21.5, end: 21.7 },
  { word: 'pipeline', start: 21.8, end: 22.2 },
  { word: 'splits', start: 22.3, end: 22.6 },
  { word: 'execution', start: 22.7, end: 23.2 },
  { word: 'across', start: 23.3, end: 23.6 },
  { word: 'three', start: 23.7, end: 23.9 },
  { word: 'parallel', start: 24.0, end: 24.4 },
  { word: 'streams:', start: 24.5, end: 24.9 },
  { word: 'synthetic', start: 25.0, end: 25.4 },
  { word: 'voice', start: 25.5, end: 25.7 },
  { word: 'generation,', start: 25.8, end: 26.3 },
  { word: 'Flux', start: 26.4, end: 26.6 },
  { word: 'image', start: 26.7, end: 27.0 },
  { word: 'synthesis,', start: 27.1, end: 27.5 },
  { word: 'and', start: 27.6, end: 27.7 },
  { word: 'automated', start: 27.8, end: 28.2 },
  { word: 'sound', start: 28.3, end: 28.5 },
  { word: 'design', start: 28.6, end: 28.9 },
  { word: 'cueing.', start: 29.0, end: 29.5 },

  // Scene 4: Final Output (~8s)
  { word: 'The', start: 31.5, end: 31.7 },
  { word: 'final', start: 31.8, end: 32.1 },
  { word: 'result', start: 32.2, end: 32.5 },
  { word: 'is', start: 32.6, end: 32.7 },
  { word: 'a', start: 32.8, end: 32.9 },
  { word: 'broadcast-ready', start: 33.0, end: 33.6 },
  { word: 'explainer', start: 33.7, end: 34.1 },
  { word: 'video,', start: 34.2, end: 34.5 },
  { word: 'delivered', start: 34.6, end: 35.0 },
  { word: 'rapidly', start: 35.1, end: 35.4 },
  { word: 'with', start: 35.5, end: 35.7 },
  { word: 'full', start: 35.8, end: 36.0 },
  { word: 'temporal', start: 36.1, end: 36.5 },
  { word: 'alignment', start: 36.6, end: 37.1 },
  { word: 'and', start: 37.2, end: 37.3 },
  { word: 'cinematic', start: 37.4, end: 37.9 },
  { word: 'audio', start: 38.0, end: 38.3 },
  { word: 'balance.', start: 38.4, end: 39.0 },
];
```

### Validation
- [ ] `npx tsc --noEmit` passes
- [ ] Sample timestamps span ~39 seconds, matching the sample manifest's ~40s target duration

---

## SUMMARY: All File Changes

| Fix | File | What Changes |
|---|---|---|
| 1 | `src/types/storyboard.ts:243-252` | Add `clearCanvas` + `canvasMode` to `storyboardSceneSchema` |
| 2 | `src/lib/ingest.ts:177-201` | Gemini branch: download image → base64 → `inlineData` |
| 3a | `src/types/storyboard.ts:151-159` | Add `camera` + `lighting` to `ExplainerCompositionProps` |
| 3b | `src/compositions/storyteller/ExplainerStoryComposition.tsx:12-18` | Destructure `camera` + `lighting` from props |
| 3c | `src/compositions/storyteller/ExplainerStoryComposition.tsx:187` | Pass `camera` + `lighting` to `<SceneCanvas>` |
| 4 | `src/types/storyboard.ts:157` | Change `sfxCues?: any[]` to typed array |
| 5 | `src/lib/narrativeEngine.ts:35-53,75-125` | Inject `contentType` into Step 1 and Step 2 prompts |
| 6a | `src/components/studio/StoryStudio.tsx:7` | Import `ingestPdf` |
| 6b | `src/components/studio/StoryStudio.tsx:37-43` | Add PDF detection before `ingestUrl()` |
| 7 | `src/lib/sampleData.ts:208-217` | Expand sample timestamps to ~90 words covering all 4 scenes |
