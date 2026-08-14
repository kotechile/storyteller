# Implementation Blueprint: Relaxed Storyteller Narration

**Branch:** `hermes-relaxed-storyteller`
**Date:** 2026-07-27
**Status:** Ready for implementation
**Source Article:** "Engineering High-Fidelity Single-Narrator Instructional Scripts: Adapting Multi-Agent Conversational Architectures for Video Modalities"

---

## Executive Summary

The article provides a rigorous framework for transforming LLM-generated narration from "dry academic summary" into the relaxed, context-rich, podcast-style delivery exemplified by Google's NotebookLM. The current `narrativeEngine.ts` master prompt (lines 51-102) is technically proficient at layout control but produces narration that is fundamentally **lecture-style summary**, not **relaxed storytelling**.

This blueprint rewrites the master prompt following the article's System Prompt Architecture (Role Definition → Behavioral Constraints → Output Specification → Chain-of-Thought) and adds a narration quality QA step. The existing JSON structure, Zod validation, and layout rules are preserved — only the **narration generation instructions** change.

### What Changes vs. What Stays

| Component | Change | Rationale |
|---|---|---|
| Master prompt role definition | **Rewrite** | "Charismatic solo podcaster + instructional designer" replaces "award-winning documentary director" |
| Narrative style constraints | **New section** | 5 explicit linguistic rules: conversational tone, illusion of dialogue, audience engagement, contextual storytelling, analogical anchoring |
| Chain-of-Thought directive | **New section** | Internal reasoning before output: analyze → identify analogies → build arc → draft |
| Few-shot examples | **New section** | 2 example narration blocks showing desired style |
| Narration per-scene rules | **Rewrite + expand** | 25-50 words (was 15-35), must include at least one rhetorical device |
| Layout rules | **Preserve** | Existing connector, positioning, safe-zone rules remain untouched |
| QA review step (reviewStoryboardLayout) | **Add narration quality check** | Rule 10: checks for rhetorical questions, analogies, conversational markers |
| contextEngine.ts classification prompt | **Minor update** | Add narrativeTone guidance aligned with new style |
| Everything else | **No change** | JSON format, Zod schemas, orchestrator, rendering — all untouched |

---

## Phase 1: Rewrite the Master Prompt (`narrativeEngine.ts` lines 51-102)

### OLD (lines 51-70):
```typescript
const masterPrompt = `Role: You are an award-winning documentary director and whiteboard video producer.

Task: Transform the article below into a complete, cinematic, multi-scene whiteboard explainer video storyboard JSON.

Audience: Young professionals (ages 22-35). Intelligent, curious, conversational TED Talk / Netflix documentary style.

${contentTypeInfo}

Rules & Safe-Zone Guidelines:
- Storytelling: Write engaging, immersive, professional voiceover narration for each scene (15-35 words per scene). Do NOT repeat words or phrases. Ensure clean, natural, fluid speech flow without stuttering.
- Number of Scenes: Create 5 to 10 distinct, logically progressing scenes. Each scene MUST feature a unique visual centerpiece concept representing the core idea of that scene.
- ... [layout rules continue]
```

### NEW (replaces lines 51-70):
```typescript
const masterPrompt = `ROLE AND PRIMARY OBJECTIVE
You are an elite instructional designer, narrative strategist, and charismatic solo podcaster. Your primary objective is to convert the provided article into a highly engaging, single-narrator explainer video script formatted as a storyboard JSON. You do not merely summarize — you transform dense information into a relaxed, story-driven journey that a layperson would eagerly watch to completion.

AUDIENCE
Young professionals (ages 22-35). They are intelligent and curious but have ZERO background knowledge on this topic. They are not reading a textbook — they want to be entertained while learning.

${contentTypeInfo}

═══════════════════════════════════════
NARRATIVE STYLE AND TONAL CONSTRAINTS
═══════════════════════════════════════

1. CONVERSATIONAL AND ACCESSIBLE
Your language must be inherently informal, warm, and energetic. Use contractions (can't, you'll, it's), natural conversational filler, and colloquialisms. Read your narration aloud in your head — if it sounds like a textbook, rewrite it. If it sounds like something you'd say to a friend over coffee, it's right.

2. THE ILLUSION OF DIALOGUE (CRITICAL)
You are a SINGLE narrator — there is no co-host to banter with. You must simulate conversational momentum alone. Achieve this by:
  - Posing rhetorical questions at transitions: "Now, why does that matter?" / "Sounds counterintuitive, doesn't it?" / "So how does that actually work?"
  - Acknowledging the topic's complexity: "This is where it gets really interesting." / "Stick with me here — this part is worth it."
  - Then answering your own question conversationally, as if responding to a curious friend.

3. DIRECT AUDIENCE ENGAGEMENT
Address the viewer directly and naturally. Use phrases like:
  - "You might be wondering..."
  - "Picture this for a second..."
  - "Let's unpack that together."
  - "Here's the thing..."
  - "Think about it this way..."

4. CONTEXTUAL STORYTELLING (CRITICAL)
DO NOT merely summarize, parrot, or regurgitate the article text. You MUST wrap core concepts in surrounding context:
  - Where did this idea come from? (origin)
  - How does it actually work under the hood? (mechanism)
  - Why does it matter in the real world? (implication)
  - What happens if we ignore it? (stakes)
Every scene should feel like you're revealing a new layer of a story, not reading bullet points.

5. ANALOGICAL ANCHORING
Whenever a complex, abstract, or technical concept appears, IMMEDIATELY follow it with an accessible, everyday analogy. Use structures like:
  - "Think of it like..."
  - "It's essentially the same as..."
  - "Imagine you're..."
  - "It's a bit like when you..."
The analogy must be genuinely illuminating, not forced. If there is no natural analogy for a concept, use a concrete real-world example instead.

═══════════════════════════════════════
NARRATION REQUIREMENTS PER SCENE
═══════════════════════════════════════

- Length: 25-50 words per scene narration (longer than before — gives room for storytelling)
- EVERY narration MUST include at least ONE of these rhetorical devices:
  ✓ A rhetorical question ("But why does that matter?")
  ✓ An everyday analogy ("Think of it like...")
  ✓ A direct audience address ("You might be wondering...")
  ✓ A contextual "why" or "how" expansion beyond the article text
- NEVER repeat the same rhetorical device twice in a row — vary across scenes
- NEVER start two consecutive scenes with the same phrase pattern
- Transitions between scenes must feel fluid: "So we've established X, which brings us perfectly to Y." / "Now here's where it gets really fascinating..." / "But that's only half the story..."

═══════════════════════════════════════
INTERNAL PROCESSING PROTOCOL (Chain-of-Thought)
═══════════════════════════════════════

Before generating the storyboard JSON, process these steps internally:

Step 1 — ANALYZE: Extract the 3-5 core themes, key facts, and the central "aha" insight from the article.
Step 2 — IDENTIFY ANALOGIES: For each complex concept, determine the best everyday analogy or concrete example. If an article concept is abstract (e.g., "latent space"), plan an accessible anchor (e.g., "Think of it like a map where similar ideas live close together").
Step 3 — BUILD THE NARRATIVE ARC:
  - Hook (Scene 1): Open with a surprising fact, provocative question, or relatable scenario. Do NOT start with "In today's world..." or "Welcome to..."
  - Progressive Build (Scenes 2-N-1): Each scene deepens understanding, layering context and implications. Concepts build on each other.
  - Climax / "Aha" Moment: The scene where everything clicks — the key insight that reframes the topic.
  - Satisfying Conclusion (Final scene): One memorable takeaway. End with forward-looking energy, not a dry summary.
Step 4 — DRAFT: Write every scene's narration following ALL tonal constraints above. Then place the visual elements.

═══════════════════════════════════════
LAYOUT AND STRUCTURAL CONSTRAINTS
═══════════════════════════════════════

- Number of Scenes: Create 6 to 12 distinct, logically progressing scenes. Complex topics need more scenes.
- Image Descriptions: Every image element MUST have a rich 2-3 sentence imageDescription. Describe a coherent multi-object visual diagram, not a single generic word.
- Style: "${stylePreset}". ${imageDescStyleGuide}
- Canvas Layout: Section Title at top Y: 4-12%. Hub images at Y: 16-34%. Child text/cards at Y: 65-85%. Leave Y: 35-64% open for connector arrows.
- Connectors: EVERY scene with a hub image AND child text MUST have connector arrows from hub to EACH child. Format: { "id": "conn_X", "type": "connector", "connectorStyle": "arrow", "fromElementId": "hub_id", "toElementId": "child_id", "x": 0, "y": 0, "width": 0, "height": 0, "zIndex": 2 }
- MANDATORY IMAGE PER SCENE: EVERY scene MUST include at least one image element representing the main visual concept.
- Safe Margins: 6% ≤ X ≤ 94%. Elements must not overlap.
- Source Images: Use sourceAssetId from Available Source Assets when possible (e.g. "asset_1"). Do NOT invent image URLs.

═══════════════════════════════════════
FEW-SHOT EXAMPLES OF DESIRED NARRATION STYLE
═══════════════════════════════════════

Example 1 — Opening Hook (Technical Topic):
"Here's a wild thought: every time you send an email, you're renting a tiny slice of a warehouse-sized computer somewhere in Virginia. You don't own it, you don't maintain it, you just... use it. That's cloud computing in a nutshell. But how did we get here — and more importantly, why should you care?"

Example 2 — Mid-Video Analogy (Abstract Concept):
"So what exactly is a 'latent space'? I know, it sounds like something out of a sci-fi novel. But think of it like this: imagine you have a giant map where every song you've ever heard lives at a specific coordinate. Sad songs cluster together in one neighborhood, upbeat dance tracks in another. A latent space is exactly that — a map where similar ideas live close together. And once you have that map, you can navigate it. You can say 'take me halfway between a ballad and an electronic track' and actually get there."

Example 3 — Transition with Rhetorical Question:
"We've seen how these models process information. But here's the question that keeps engineers up at night: what happens when the model is confidently wrong? That's the hallucination problem — and it's a bigger deal than most people realize."

${assetInjectionSection}

Respond STRICTLY with a valid JSON object matching this structure:
{
  "meta": { "title": "${cleanTitle}", "targetDuration": 90, "stylePreset": "${stylePreset}" },
  "scenes": [
    {
      "sceneNumber": 1,
      "narration": "A relaxed, conversational hook that opens with a surprising fact or question...",
      "duration": 12,
      "layout": {
        "clearCanvas": true,
        "canvasMode": "clear_canvas",
        "background": { "type": "solid", "value": "#ffffff" },
        "elements": [
          { "id": "sc1_title", "type": "text", "content": "Section Title", "x": 6, "y": 4, "width": 44, "height": 8, "zIndex": 10 },
          { "id": "sc1_hub", "type": "image", "sourceAssetId": "asset_1", "content": "Main Concept", "revealSyncPhrase": "key phrase from narration", "imageDescription": "${imageDescStyleGuide}", "x": 10, "y": 18, "width": 26, "height": 22, "zIndex": 1 },
          { "id": "sc1_child1", "type": "text", "content": "Detail A", "x": 10, "y": 72, "width": 20, "height": 8, "zIndex": 5 },
          { "id": "sc1_child2", "type": "text", "content": "Detail B", "x": 55, "y": 72, "width": 20, "height": 8, "zIndex": 5 },
          { "id": "conn1", "type": "connector", "connectorStyle": "arrow", "fromElementId": "sc1_hub", "toElementId": "sc1_child1", "x": 0, "y": 0, "width": 0, "height": 0, "zIndex": 2 },
          { "id": "conn2", "type": "connector", "connectorStyle": "arrow", "fromElementId": "sc1_hub", "toElementId": "sc1_child2", "x": 0, "y": 0, "width": 0, "height": 0, "zIndex": 2 }
        ]
      },
      "syncHints": [{ "text": "key phrase from narration", "triggerAction": "reveal", "targetElementId": "sc1_hub" }]
    }
  ]
}`;
```

### Validation Checklist for Phase 1:
- [ ] New prompt replaces old lines 51-102 completely
- [ ] Role is "elite instructional designer, narrative strategist, and charismatic solo podcaster"
- [ ] 5 narrative style constraints are present with explicit rules
- [ ] Chain-of-Thought section with 4 steps exists
- [ ] Narration requirements: 25-50 words, must include rhetorical device, vary across scenes
- [ ] 3 few-shot examples present
- [ ] Layout/JSON format constraints preserved from original
- [ ] `assetInjectionSection` variable still interpolated correctly
- [ ] Runs: `npx tsc --noEmit`

---

## Phase 2: Add Narration Quality Check to QA Review (`narrativeEngine.ts` lines 130-184)

### OLD: `reviewStoryboardLayout` has 9 quality rules (layout-only)
### NEW: Add Rule 10 for narration quality

Find the `reviewStoryboardLayout` function (line 130). Replace the `reviewPrompt` template literal (lines 134-164) by adding Rule 10 to the Quality Checklist:

### PATCH (add after line 159 — Rule 9):
```typescript
10. NARRATIVE QUALITY: Verify EVERY scene's narration meets these criteria:
   a) Contains at least ONE of: a rhetorical question, an everyday analogy, a direct audience address ("you might be wondering", "picture this"), or a contextual "why/how" expansion.
   b) Does NOT start with generic openers like "In today's world...", "Welcome to...", "Let's talk about...", or "In this video..."
   c) Sounds like a human podcaster speaking, not a textbook reading. Uses contractions, natural phrasing, conversational rhythm.
   d) Scene 1 (the hook) MUST open with a surprising fact, provocative question, or relatable scenario — NOT a definition or topic introduction.
   For any scene that fails these criteria, REWRITE the narration to comply. Preserve all factual content, only change the delivery style.
```

Also update the review prompt's intro paragraph to mention narrative quality:

### PATCH (line 134 — the intro sentence):
```
Task: Inspect the draft storyboard JSON below and fix EVERY layout AND narration quality issue. You MUST return the FULL corrected JSON.
```

### Validation Checklist for Phase 2:
- [ ] Rule 10 added to the QA checklist
- [ ] Intro sentence updated to say "layout AND narration quality issue"
- [ ] Runs: `npx tsc --noEmit`

---

## Phase 3: Update Context Engine Tone Guidance (`contextEngine.ts` line 34)

The contextEngine's `narrativeTone` default is `"Conversational and accessible"` but should be more aligned with the new style.

### OLD (line 34):
```typescript
narrativeTone: 'Conversational and accessible',
```

### NEW:
```typescript
narrativeTone: 'Relaxed solo podcaster: conversational, analogy-rich, story-driven, with rhetorical questions and direct audience engagement',
```

### Validation Checklist for Phase 3:
- [ ] Default narrativeTone updated
- [ ] Runs: `npx tsc --noEmit`

---

## Phase 4: Sanitizer Update for Longer Narrations

The sanitizer in `sanitizeStoryboardObj` (line 198) doesn't enforce the new narration quality rules programmatically — that's the LLM's job via the prompt. But we should increase the default duration to match longer narrations.

### PATCH (line 204):
```
// OLD: const duration = typeof scene.duration === 'number' ? scene.duration : 10;
// NEW: longer default for richer narration
const duration = typeof scene.duration === 'number' ? scene.duration : 12;
```

Also need to ensure the meta targetDuration calculation accounts for 12s default:
Line 264 already uses `Number(s.duration) || 10` — change to `|| 12`:

### PATCH (line 264):
```typescript
// OLD: targetDuration: Array.isArray(obj.scenes) ? obj.scenes.reduce((a: number, s: any) => a + (Number(s.duration) || 10), 0) : 60,
// NEW:
targetDuration: Array.isArray(obj.scenes) ? obj.scenes.reduce((a: number, s: any) => a + (Number(s.duration) || 12), 0) : 90,
```

Also update the default in meta (line 263):
```typescript
// OLD: targetDuration: obj.meta.targetDuration = Number(obj.meta.targetDuration) || 60;
// NEW:
obj.meta.targetDuration = Number(obj.meta.targetDuration) || 90;
```

### Validation Checklist for Phase 4:
- [ ] Default scene duration updated to 12
- [ ] Default meta.targetDuration updated to 90
- [ ] Fallback calculation uses 12 not 10
- [ ] Runs: `npx tsc --noEmit`

---

## Phase 5: BuildCinematicWhiteboardFallback — Narration Style Update

The fallback (line 398-581) produces generic narration like "In today's rapidly evolving landscape..." — this is exactly the anti-pattern the article warns against. Update all 4 fallback narration strings.

### PATCH all fallback narration strings:

**Scene 1 (line 406):**
```
// OLD:
narration: `In today's rapidly evolving landscape, ${cleanTitle} has emerged as a critical topic. Let's break down what it means and why it matters.`,
// NEW:
narration: `Here's something that might surprise you: ${cleanTitle} isn't just another tech buzzword — it's quietly reshaping how we work, think, and make decisions. And most people have no idea. Let's fix that.`,
```

**Scene 2 (line 441):**
```
// OLD:
narration: `Understanding the underlying structure requires looking at how components interact. Each element plays a specific role in driving the overall result.`,
// NEW:
narration: `Think of it like an orchestra. You've got violins, cellos, horns — each playing a completely different part. But when they come together under a conductor, something magical happens. That's exactly how the components here fit together.`,
```

**Scene 3 (line 505):**
```
// OLD:
narration: `When we look at real-world applications, automated workflows transform complexity into seamless execution, reducing errors and saving valuable time.`,
// NEW:
narration: `So where does this actually show up in your life? Picture your morning routine — alarm, coffee, commute. Now imagine if every step just... handled itself. That's the promise here, and it's closer than you think.`,
```

**Scene 4 (line 539):**
```
// OLD:
narration: `By taking a systematic approach, teams can achieve long-term efficiency and scalability, turning abstract concepts into measurable results.`,
// NEW:
narration: `Here's the bottom line: this isn't about technology for technology's sake. It's about getting back the one thing none of us can buy more of — time. And that's a story worth paying attention to.`,
```

### Validation Checklist for Phase 5:
- [ ] All 4 fallback narrations replaced
- [ ] No "In today's world" or "Let's talk about" openers
- [ ] Each narration includes a rhetorical device
- [ ] Runs: `npx tsc --noEmit`

---

## Full File Map of Changes

| File | Lines | Change |
|---|---|---|
| `src/lib/narrativeEngine.ts` | 51-102 | Master prompt complete rewrite |
| `src/lib/narrativeEngine.ts` | 134-164 | QA review: add narration Rule 10 + update intro |
| `src/lib/narrativeEngine.ts` | 204 | Default duration: 10 → 12 |
| `src/lib/narrativeEngine.ts` | 263-264 | Default targetDuration: 60 → 90, fallback: 10 → 12 |
| `src/lib/narrativeEngine.ts` | 406, 441, 505, 539 | Fallback narration strings: 4 rewrites |
| `src/lib/contextEngine.ts` | 34 | Default narrativeTone updated |

**Files NOT modified:**
- `src/types/storyboard.ts` — No schema changes needed
- `src/generateStoryFromUrl.ts` — No orchestrator changes
- `src/lib/elevenlabsTts.ts`, `src/lib/audioSync.ts`, `src/lib/assetCatalogManager.ts` — Unrelated to narration style
- All composition files — Rendering unchanged

---

## Anticipated Effects

### Narration Quality Improvements
- **Before:** "Understanding the underlying structure requires looking at how components interact. Each element plays a specific role in driving the overall result."
- **After:** "Think of it like an orchestra. Each instrument plays a different part, but the magic happens when they sync up. That's what's going on under the hood — and it's way more elegant than it sounds."

### Potential Downsides (to Monitor)
1. **Longer narrations** → longer video duration. The TTS will naturally produce more audio. Mitigation: The orchestrator already handles this.
2. **Hallucination risk** — the article warns that contextual storytelling can drift from source facts. Mitigation: The prompt explicitly says "tightly tethered to provided text" and the QA review verifies.
3. **Token cost increase** — the master prompt is ~2x longer with few-shot examples. Mitigation: Few-shot examples are worth the cost for quality improvement.

---

## Test Command

```bash
cd /Users/jorgefernandezilufi/Documents/_article_research/remotion
npx tsc --noEmit
```

Then run a test generation:
```bash
npx tsx src/generateStoryFromUrl.ts "https://en.wikipedia.org/wiki/Cloud_computing" "whiteboard"
```

Inspect `out/storyboard_checkpoint.json` — narrations should contain rhetorical questions, analogies, and conversational language.
