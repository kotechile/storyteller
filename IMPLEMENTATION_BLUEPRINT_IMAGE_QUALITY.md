# Implementation Blueprint: Cinematic Image Prompt Engineering

**Branch:** `hermes-relaxed-storyteller` (extends previous narrative work)
**Date:** 2026-07-27
**Source Article:** "The Architecture of Automated Visual Synthesis: How Story Scripting Tools Engineer Image Prompts for AI Video Generation"

---

## Executive Summary

The article details how production-grade AI video pipelines (Google NotebookLM, etc.) engineer image prompts through a **5-layer framework** that enforces cinematic quality. Currently, our `prompt2Text` generates generic `imageDescription` fields like "A 3D graphic of a server" — flat, dimensionless, and statistically average. The article's framework transforms these into prompts with subject consistency, emotional anchoring, camera direction, lighting design, and environmental cohesion.

Additionally, the article introduces **Visual Test** (is this visualizable?) and **Contrast Test** (does this shot differ from the previous one?) as mandatory quality gates.

### What Changes

| Component | Change |
|---|---|
| `prompt2Text` (narrativeEngine.ts:156-192) | **Rewrite** — from "whiteboard flowchart artist" to "cinematic art director and prompt engineer" with 5-layer framework |
| `prompt1Text` (narrativeEngine.ts:41-124) | **Add** visual anchor concept identification step to Chain-of-Thought |
| QA review `reviewAndOptimizeStoryboard` (narrativeEngine.ts:220-244) | **Add** rules 8-12: image description 5-layer quality, Visual/Contrast tests, source grounding |
| `fluxImageGen.ts` `buildStylePrompt()` | **No change** — already wraps imageDescription with style modifiers correctly |
| Orchestrator, Zod schemas, compositions | **No change** |

---

## Phase 1: Rewrite `prompt2Text` — The Storyboard Generator

### OLD (lines 156-192):
The current prompt is entirely layout-focused ("whiteboard system flowcharts", "Title Collision & Safe-Zone Rules"). It says nothing about HOW to construct a cinematic image description.

### NEW — replaces lines 156-192:

```typescript
    const prompt2Text = `ROLE AND PRIMARY OBJECTIVE
You are an expert cinematic art director, visual prompt engineer, and storyboard artist. Your job is to translate the narrative script below into a storyboard JSON where every image's "imageDescription" is a production-grade, five-layer cinematic prompt that a diffusion model (Flux, Imagen) can render into a rich, professional keyframe.

═══════════════════════════════════════
THE FIVE-LAYER CINEMATIC IMAGE PROMPT FRAMEWORK
═══════════════════════════════════════

Every imageDescription you write MUST incorporate ALL five layers. A vague prompt like "a server room" produces a flat, generic image. A five-layer prompt produces a cinematic keyframe. Here is the mandatory structure:

LAYER 1: SUBJECT — The primary object(s) in the frame. Be ruthlessly specific. Never use generic placeholder words like "concept", "system", "thing", or "element". Name exactly what the viewer sees: "a glass-walled data center with rows of blinking server racks", "a cracked clay piggy bank spilling gold coins onto a wooden table", "a magnifying glass hovering over a circuit board revealing glowing micro-text".

LAYER 2: ACTION & EMOTIONAL ANCHORING — What is happening in the frame, and what does it feel like? Append action verbs and emotional keywords: "shattering mid-air", "gently rising", "looming ominously", "calm and orderly", "tense and urgent", "serene and hopeful". These keywords control the color palette and micro-expressions of the generated image.

LAYER 3: CAMERA & LENS — Specify the cinematic language: shot type (extreme close-up, medium shot, wide establishing shot, bird's eye view, low angle), lens (35mm, 85mm portrait, macro lens, wide-angle 16mm), and depth of field (shallow depth of field with bokeh background, deep focus, tilt-shift). This transforms an AI image into a cinematic keyframe.

LAYER 4: LIGHTING — Describe the light as if it were a character in the scene: "warm golden hour sunlight streaming from the left", "cool blue ambient moonlight with sharp rim lighting", "harsh overhead fluorescent with deep shadows", "soft diffused studio lighting with no shadows", "volumetric god rays through window blinds". Lighting creates depth and texture.

LAYER 5: ENVIRONMENT & STYLISTIC COHESION — Describe the background, atmosphere, and stylistic treatment: "isolated on pure white background", "set against a dark navy blueprint grid", "floating in a clean modern office environment", "surrounded by floating mathematical equations in soft focus", "rendered in flat vector illustration style with bold outlines".

═══════════════════════════════════════
THE VISUAL TEST & CONTRAST TEST (CRITICAL)
═══════════════════════════════════════

VISUAL TEST: Before writing any imageDescription, ask: "Can this concept be explicitly shown as a static image?" If the narration discusses an abstract feeling (e.g., "confidence in the system"), translate it into a physical visual corollary (e.g., "a steady hand pressing a glowing confirmation button"). NEVER write an imageDescription for something that cannot be visually rendered.

CONTRAST TEST: Consecutive scenes MUST vary in visual composition. After writing scene N's imageDescription, scene N+1 MUST differ in at least TWO of these dimensions:
  - Shot type (wide → close-up, establishing → macro detail)
  - Lighting (warm → cool, bright → moody)
  - Camera angle (eye-level → low angle, front-facing → bird's eye)
  - Subject scale (single object → complex scene, macro detail → wide landscape)
This prevents visual monotony across the video.

═══════════════════════════════════════
SOURCE GROUNDING REQUIREMENT
═══════════════════════════════════════

Pull specific, distinctive terminology from the source article text into your imageDescriptions. If the article mentions "SPLADE sparse lexical representations" or "attention mechanisms with query-key-value triples", USE those exact terms as visual anchors. This grounds the generated images in the actual source content rather than generic stock concepts.

${contentTypeFormat}

═══════════════════════════════════════
LAYOUT RULES (Preserved)
═══════════════════════════════════════

- Scenes: 6-12 scenes based on content complexity.
- Layout: Title Y:4-12%. Hub images Y:16-34% (w:24-34%, h:24-34%). Child text Y:65-85%. Connector zone Y:35-64%.
- Connectors: Every hub with child text MUST have arrows from hub to each child.
- Every scene MUST have at least one image element.
- Safe margins: 6% ≤ X ≤ 94%.
- Source images: Use sourceAssetId from Available Source Assets when available (e.g. "asset_1").

Narrative Script:
"${cinematicScript}"
${assetInjectionSection}

Respond STRICTLY with a valid JSON object matching this structure. Note the imageDescription field now contains a FULL five-layer prompt, not a short phrase:
{
  "meta": { "title": "${cleanTitle}", "targetDuration": 90, "stylePreset": "${stylePreset}" },
  "scenes": [
    {
      "sceneNumber": 1,
      "narration": "Narration text...",
      "duration": 12,
      "clearCanvas": true,
      "canvasMode": "clear_canvas",
      "layout": {
        "background": { "type": "solid", "value": "#ffffff" },
        "elements": [
          { "id": "sc1_title", "type": "text", "content": "Section Title", "x": 6, "y": 4, "width": 44, "height": 8, "zIndex": 10 },
          { "id": "sc1_hub", "type": "image", "content": "Subject Name", "revealSyncPhrase": "key phrase", "imageDescription": "[5-LAYER PROMPT: Subject: ... Action/Emotion: ... Camera: ... Lighting: ... Environment: ...]", "x": 10, "y": 18, "width": 26, "height": 22, "zIndex": 1, "sourceAssetId": "asset_1" },
          { "id": "sc1_child1", "type": "text", "content": "Detail A", "x": 10, "y": 72, "width": 20, "height": 8, "zIndex": 5 },
          { "id": "conn1", "type": "connector", "connectorStyle": "arrow", "fromElementId": "sc1_hub", "toElementId": "sc1_child1", "x": 0, "y": 0, "width": 0, "height": 0, "zIndex": 2 }
        ]
      },
      "syncHints": [{ "text": "key phrase", "triggerAction": "reveal", "targetElementId": "sc1_hub" }]
    }
  ]
}`;
```

---

## Phase 2: Add Visual Anchor Concepts to `prompt1Text` Chain-of-Thought

The article describes Gemini (semantic orchestrator) determining which concepts require visual support. Add a step to the Chain-of-Thought:

### PATCH — After Step 2 in the Chain-of-Thought (line 117):

```
Step 2.5 — IDENTIFY VISUAL ANCHORS: For each narrative segment, determine the ONE visual concept that best represents it. What is the single most memorable image for this segment? This becomes the hub image for that scene.
```

---

## Phase 3: Add Image Description Quality Rules to QA Review

The QA review currently has 7 rules (1-5 layout, 6-7 narration). Add rules 8-12 for image quality:

### PATCH — Add after Rule 7 (line 239):

```typescript
8. IMAGE DESCRIPTION QUALITY — 5-LAYER FRAMEWORK (CRITICAL): Verify EVERY image element's imageDescription includes ALL five layers:
   a) SUBJECT: Names a specific, concrete subject (NOT generic words like "concept", "system", "thing", "element")
   b) ACTION/EMOTION: Contains an action verb or emotional keyword
   c) CAMERA/LENS: Specifies shot type, lens, or depth of field
   d) LIGHTING: Describes the light source and quality
   e) ENVIRONMENT: Describes background, atmosphere, or style
   For any imageDescription missing any layer, ADD the missing layers. Do NOT remove existing content.

9. VISUAL TEST: Verify every imageDescription describes something that CAN be rendered as a static image. If a description references an abstract concept with no physical visualization, REWRITE it with a concrete visual corollary.

10. CONTRAST TEST: Verify consecutive scenes' imageDescriptions vary in at least TWO of: shot type, lighting, camera angle, subject scale. If two consecutive scenes have identical compositions (e.g., both are "wide establishing shot with warm lighting"), REWRITE one to create contrast.

11. SOURCE GROUNDING: Verify at least 50% of imageDescriptions contain specific terminology, proper nouns, or distinctive phrases extracted from the source article text. If imageDescriptions are all generic ("a server", "a chart", "a building"), REWRITE them to incorporate source-specific vocabulary.

12. NO GENERIC SINGLE-WORD PROMPTS: Verify NO imageDescription is shorter than 40 words. A single word or short phrase like "Data Center" is AUTO-REJECTED. Every imageDescription must be a multi-sentence description covering all five layers.
```

---

## Phase 4: Update `buildStylePrompt()` Notes

`fluxImageGen.ts` `buildStylePrompt()` (line 26) prepends style-specific modifiers to the imageDescription. The 5-layer prompts are designed to work WITH this function — the style modifiers handle the "isolated on white background" aspect, while the 5-layer prompt handles the creative content. No code change needed, but verify:

The `imageDescription` coming from the LLM should NOT include "isolated on white background" — that's `buildStylePrompt()`'s job. The imageDescription should focus on the 5 layers WITHOUT the isolation wrapper, since `buildStylePrompt()` adds it.

---

## File Map

| File | Line(s) | Change |
|---|---|---|
| `src/lib/narrativeEngine.ts` | 156-192 | prompt2Text: complete rewrite with 5-layer framework, Visual/Contrast tests |
| `src/lib/narrativeEngine.ts` | 116-119 | prompt1Text Chain-of-Thought: add Step 2.5 visual anchor identification |
| `src/lib/narrativeEngine.ts` | 239 (after) | QA review: add rules 8-12 for image description quality |

**Files NOT modified:**
- `src/lib/fluxImageGen.ts` — No change needed; existing style modifiers complement 5-layer prompts
- `src/types/storyboard.ts` — No schema changes; `imageDescription` is already a `string?` field
- All composition files — Rendering unchanged

---

## Test Command

```bash
cd /Users/jorgefernandezilufi/Documents/_article_research/remotion
npx tsc --noEmit
```

Then run a test generation and inspect image descriptions:
```bash
npx tsx src/generateStoryFromUrl.ts "https://en.wikipedia.org/wiki/Cloud_computing" "photo-realistic"
# Inspect: out/storyboard_checkpoint.json → scenes[].layout.elements[].imageDescription
# Each should have 5 layers, 40+ words, source-specific terminology
```
