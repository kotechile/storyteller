# Antigravity Instructions: Visual Style Preset Fix + Edit Screen Enhancements

## Overview

Two changes:
1. **Fix "Photo Realistic"** — stop being a document image pass-through; generate cinematic images that make viewers relate narration to visuals, while still keeping technical diagrams from the source.
2. **Edit screen enhancements** — add manual image upload on existing scenes and the ability to create brand-new scenes with custom narration.

---

## Part 1: Fix the "Photo Realistic" Preset

### Current Behavior (the bug)

In `src/lib/assetCatalogManager.ts:251-275`, `photo-realistic` is the ONLY preset that passes the `!isNonPhotoStyle` check, causing:

```typescript
// Line 252 — "whiteboard", "illustration", "chalk-drawing" are non-photo → go through classifyArticleAsset()
// Everything else (including "photo-realistic") → SKIP all AI generation, use document image directly
const isNonPhotoStyle = stylePreset === 'whiteboard' || stylePreset === 'illustration' || stylePreset === 'chalk-drawing';
```

The user's complaint: "Photo Realistic is just randomly using the images from the document being ingested." That's exactly what's happening — lines 268-275 unconditionally replace `sourceAssetId` with the document URL and `continue` past all image generation.

### Desired Behavior

**Photo Realistic should:**
1. **Generate cinematic AI images** for narrative scenes — these should be evocative, relatable images (not just isolated objects). Think: "a person at a laptop in a coffee shop, warm evening light streaming through the window" — images that make the viewer FEEL the concept being described.
2. **Still keep technical diagrams from the source** when they exist — same as what whiteboard/illustration already does via `classifyArticleAsset()`.
3. **Technical diagrams should be shown synced with their relevant voiceover** — not randomly, but when the narration discusses that specific diagram.

### Implementation

#### Phase 1A: Add `photo-realistic` to the `isNonPhotoStyle` check

**File:** `src/lib/assetCatalogManager.ts`
**Current line 252:**
```typescript
const isNonPhotoStyle = stylePreset === 'whiteboard' || stylePreset === 'illustration' || stylePreset === 'chalk-drawing';
```

**Replace with:**
```typescript
// All presets use the same asset strategy: keep technical diagrams, generate AI images for the rest.
// Only difference between presets is the visual style of generated images (handled by buildStylePrompt).
const isNonPhotoStyle = true; // All presets now follow the same classify-or-generate path
```

**Delete lines 268-275** (the entire `if (!isNonPhotoStyle ...)` block that short-circuits for photo-realistic):
```typescript
// DELETE THIS ENTIRE BLOCK:
// Photorealistic style: always reuse article assets
if (!isNonPhotoStyle && element.sourceAssetId && element.sourceAssetId.startsWith('asset_')) {
  const sourceAsset = articleAssets.find((a: any) => a.id === element.sourceAssetId);
  if (sourceAsset?.url) {
    element.sourceAssetId = sourceAsset.url;
    continue;
  }
}
```

Now ALL presets follow the same path: `classifyArticleAsset()` → keep technical diagrams → generate AI images for non-technical.

#### Phase 1B: Update the `buildStylePrompt` for `photo-realistic`

**File:** `src/lib/fluxImageGen.ts`
**Current lines 38-41:**
```typescript
case 'photo-realistic':
default:
  return `clean professional infographic diagram with high-contrast dark readable sans-serif text labels on light background, ${prompt}, photorealistic 3D render with realistic materials and textures, crisp dark typography against bright white, clean white studio background hex #ffffff, high key lighting, sharp focus, no surrounding room, no vignetting, no gray border, 8k resolution`;
```

**Replace with:**
```typescript
case 'photo-realistic':
default:
  return `cinematic 35mm photography style, ${prompt}, photorealistic scene with natural lighting and shallow depth of field, authentic environment and context that evokes emotion, rich colors with filmic color grading, soft bokeh background, shot on high-end DSLR with wide aperture, 8k resolution, no text overlays, no watermarks, no UI elements`;
```

**Key change:** Removed "no surrounding room" and "white studio background" — we WANT the scene/environment. Removed "infographic diagram" and "text labels" — this is cinematic photography, not a diagram. The Art Director will handle diagram-specific prompts separately.

#### Phase 1C: Update the Art Director style instructions for photo-realistic

**File:** `src/lib/narrativeEngine.ts`
**Current line 747:**
```typescript
'photo-realistic': 'clean photorealistic 3D render on white background, sharp black Helvetica labels, sleek metallic connector lines, realistic objects and textures',
```

**Replace with:**
```typescript
'photo-realistic': 'cinematic 35mm film photography, natural environmental lighting with shallow depth of field, authentic real-world scenes with human context and emotional resonance, rich color grading with filmic contrast, shot on high-end DSLR with wide aperture, evocative compositions that tell a visual story',
```

#### Phase 1D: Update the Art Director diagram prompt for photo-realistic

**File:** `src/lib/narrativeEngine.ts`
**Current lines 752-764** (the `diagramPrompt` template):

The Art Director currently generates a JSON diagram prompt for ALL styles. For photo-realistic, instead of a labeled diagram, it should generate a cinematic scene prompt:

Add a style-specific branch in the `refineImagePromptsWithArtDirector` function. After line 752 (`const diagramPrompt = ...`), wrap the prompt construction:

```typescript
// After line 750 (const styleGuide = ...)
const isCinematicStyle = stylePreset === 'photo-realistic';

const diagramPrompt = isCinematicStyle
  ? `You are an expert cinematographer and visual art director. Output valid JSON describing a cinematic scene in ${stylePreset} style that evokes the emotional core of this narration.

Visual style: ${styleGuide}

{
  "imagePrompt": "one descriptive paragraph (80-150 words) describing a CINEMATIC SCENE — include environment, lighting, human context, composition, mood, and a SPECIFIC relatable situation that mirrors what the narration describes. Use film language: wide shot, close-up, shallow depth of field, golden hour, etc.",
  "layout": { "title": "Main Title: Descriptive subtitle explaining what the scene shows", "labels": [], "connectors": [] }
}

imagePrompt rules: cinematic 35mm photography style, describe a REAL SCENE with context (not an isolated object on white), include human element when possible, use spatial and atmospheric words, describe lighting conditions and mood.
layout: title as "Main Topic: One-line descriptive subtitle".

Article: "${articleTitle}"  |  Narration: "${scene.narration}"
Output ONLY valid JSON:`
  : `You are an expert visual art director. Output valid JSON describing a labeled explanatory diagram in ${stylePreset} style.

Visual style: ${styleGuide}

{
  "imagePrompt": "one descriptive paragraph (80-150 words) describing what the VIEWER SEES",
  "layout": { "title": "Main Title: Descriptive subtitle explaining what the scene shows", "labels": ["key term 1", "key term 2"], "connectors": [{"from":"hub","to":"label 1"}] }

imagePrompt rules: ${stylePreset} style, flowing paragraph, embed labels naturally as "titled 'X'", "labeled 'Y'", use spatial words, describe connectors and layout within the image itself.
layout: title as "Main Topic: One-line descriptive subtitle", labels 2-4 short terms, connectors simple hub-to-label.

Article: "${articleTitle}"  |  Narration: "${scene.narration}"
Output ONLY valid JSON:`;
```

#### Phase 1E: Fix the `layout` handling for cinematic style

In the `refineImagePromptsWithArtDirector` function, the layout processing at lines 784-795 strips connectors and keeps only images + first title text. For cinematic style, this is correct (cinematic images don't need connector arrows). But the element sizing at lines 775-780 should remain the same (`x:6, y:12, w:88, h:78`) — the large image format works for both diagrams and cinematic photos.

No changes needed to the layout processing — the existing code already handles this correctly.

---

## Part 2: Edit Screen — Manual Image Upload + New Scene Creation

### Current State

The edit screen (`src/components/studio/StoryStudio.tsx`) currently:
- Shows scenes as read-only cards with narration text and a "Regenerate Voice" button
- Has a `CanvasEditor` overlay for dragging/resizing existing elements
- Has no way to upload a custom image for a scene
- Has no way to create a new scene from scratch

### Phase 2A: Add "Replace Image" button to scene cards

**File:** `src/components/studio/StoryStudio.tsx`

Add state for the file input ref:
```typescript
// Add near other useState declarations (around line 130)
const sceneImageInputRef = useRef<HTMLInputElement>(null);
const [uploadTargetSceneIdx, setUploadTargetSceneIdx] = useState<number | null>(null);
```

Add the image upload handler:
```typescript
// Add near other handlers (around line 330)
const handleSceneImageUpload = (sceneIdx: number, file: File) => {
  const reader = new FileReader();
  reader.onload = (event) => {
    const dataUrl = event.target?.result as string;
    if (!dataUrl) return;

    setManifest((prev) => ({
      ...prev,
      scenes: prev.scenes.map((sc, idx) => {
        if (idx !== sceneIdx) return sc;
        const elements = (sc.layout?.elements || []).map((el) => {
          // Replace the first image element's sourceAssetId with the uploaded data URL
          if (el.type === 'image') {
            return { ...el, sourceAssetId: dataUrl };
          }
          return el;
        });
        return {
          ...sc,
          layout: { ...sc.layout, elements },
        };
      }),
    }));
  };
  reader.readAsDataURL(file);
};
```

Modify the scene card JSX (around line 1929, inside the Action Footer section) to add an image upload button:

```tsx
{/* Add AFTER the "Regenerate Voice" button, inside the Action Footer div */}
<div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      setUploadTargetSceneIdx(idx);
      sceneImageInputRef.current?.click();
    }}
    title="Replace the image in this scene with your own upload"
    style={{
      padding: '5px 10px',
      borderRadius: '8px',
      border: '1px solid #D1D5DB',
      backgroundColor: '#FFFFFF',
      color: '#374151',
      display: 'flex',
      alignItems: 'center',
      gap: '5px',
      fontSize: '11px',
      fontWeight: 600,
      cursor: 'pointer',
      transition: 'all 0.15s ease',
    }}
    className="hover:bg-gray-100"
  >
    <span>🖼️</span>
    <span>Replace Image</span>
  </button>
</div>
```

Add the hidden file input at the bottom of the component (before the closing `</div>` of the main wrapper, around line 2040):

```tsx
{/* Hidden file input for scene image upload */}
<input
  ref={sceneImageInputRef}
  type="file"
  accept="image/*"
  style={{ display: 'none' }}
  onChange={(e) => {
    const file = e.target.files?.[0];
    if (file && uploadTargetSceneIdx !== null) {
      handleSceneImageUpload(uploadTargetSceneIdx, file);
      setUploadTargetSceneIdx(null);
    }
    // Reset so the same file can be re-selected
    e.target.value = '';
  }}
/>
```

### Phase 2B: Add "Add Scene" button

**File:** `src/components/studio/StoryStudio.tsx`

Add state for the new scene modal:
```typescript
// Add near other useState declarations (around line 130)
const [isAddSceneModalOpen, setIsAddSceneModalOpen] = useState(false);
const [newSceneNarration, setNewSceneNarration] = useState('');
const [newSceneImageFile, setNewSceneImageFile] = useState<File | null>(null);
const [newSceneImagePreview, setNewSceneImagePreview] = useState<string | null>(null);
```

Add handlers:
```typescript
// Add near other handlers (around line 330)
const handleNewSceneImageSelect = (file: File) => {
  setNewSceneImageFile(file);
  const reader = new FileReader();
  reader.onload = (e) => setNewSceneImagePreview(e.target?.result as string);
  reader.readAsDataURL(file);
};

const handleAddNewScene = () => {
  if (!newSceneNarration.trim()) return;

  const maxSceneNumber = manifest.scenes.reduce((max, s) => Math.max(max, s.sceneNumber), 0);
  const newSceneNumber = maxSceneNumber + 1;

  const elements: any[] = [];
  
  // Add title text element
  elements.push({
    id: `sc${newSceneNumber}_title`,
    type: 'text',
    content: `Scene ${newSceneNumber}`,
    x: 6,
    y: 4,
    width: 50,
    height: 8,
    zIndex: 10,
    enterAnimation: { type: 'slide_up', duration: 15, delay: 0 },
  });

  // Add image element
  if (newSceneImagePreview) {
    elements.push({
      id: `sc${newSceneNumber}_img`,
      type: 'image',
      sourceAssetId: newSceneImagePreview,
      content: 'Uploaded image',
      x: 6,
      y: 12,
      width: 88,
      height: 78,
      zIndex: 1,
      enterAnimation: { type: 'scale_in', duration: 15, delay: 15 },
    });
  }

  const newScene = {
    sceneNumber: newSceneNumber,
    narration: newSceneNarration.trim(),
    duration: 8, // Default duration, user can adjust in timeline
    layout: {
      background: { type: 'solid' as const, value: '#f8fafc' },
      clearCanvas: true,
      canvasMode: 'clear_canvas' as const,
      elements,
    },
    syncHints: [],
  };

  setManifest((prev) => ({
    ...prev,
    meta: {
      ...prev.meta,
      targetDuration: prev.meta.targetDuration + 8,
    },
    scenes: [...prev.scenes, newScene],
  }));

  // Reset state
  setIsAddSceneModalOpen(false);
  setNewSceneNarration('');
  setNewSceneImageFile(null);
  setNewSceneImagePreview(null);
};
```

Add the "Add Scene" button to the scenes sidebar header (around line 1865, inside the `flex items-center justify-between` div that contains "🎬 Scenes"):

```tsx
{/* Add BEFORE the existing buttons in the header */}
<button
  type="button"
  onClick={() => setIsAddSceneModalOpen(true)}
  title="Add a new custom scene with your own image and narration"
  style={{
    padding: '6px 12px',
    borderRadius: '8px',
    border: '1px dashed #6366F1',
    backgroundColor: '#EEF2FF',
    color: '#4F46E5',
    fontSize: '11px',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  }}
  className="hover:bg-indigo-100"
>
  <span>+ Add Scene</span>
</button>
```

Add the modal for creating a new scene (add before the closing `</div>` of the main wrapper, around line 2040, BEFORE the `VoiceSelectionModal`):

```tsx
{/* Add Scene Modal */}
{isAddSceneModalOpen && (
  <div
    style={{
      position: 'fixed',
      inset: 0,
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.5)',
      backdropFilter: 'blur(4px)',
    }}
    onClick={() => setIsAddSceneModalOpen(false)}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: '20px',
        padding: '32px',
        maxWidth: '520px',
        width: '90%',
        boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0F172A', margin: 0 }}>
          ✨ Add Custom Scene
        </h3>
        <button
          type="button"
          onClick={() => setIsAddSceneModalOpen(false)}
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '8px',
            border: '1px solid #E2E8F0',
            backgroundColor: '#FFFFFF',
            color: '#64748B',
            cursor: 'pointer',
            fontWeight: 700,
          }}
        >
          ✕
        </button>
      </div>

      {/* Narration Input */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Narration Script
        </label>
        <textarea
          value={newSceneNarration}
          onChange={(e) => setNewSceneNarration(e.target.value)}
          placeholder="Write the narration for this scene... (e.g., 'Now let's look at how this actually works in practice.')"
          rows={4}
          style={{
            width: '100%',
            padding: '14px 16px',
            backgroundColor: '#F8FAFC',
            border: '1px solid #CBD5E1',
            borderRadius: '12px',
            fontSize: '14px',
            color: '#0F172A',
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'Inter, system-ui, sans-serif',
            lineHeight: '1.6',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Image Upload */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Scene Image <span style={{ fontWeight: 400, color: '#94A3B8', textTransform: 'none' }}>(optional)</span>
        </label>
        
        {newSceneImagePreview ? (
          <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', border: '1px solid #E2E8F0' }}>
            <img
              src={newSceneImagePreview}
              alt="Preview"
              style={{ width: '100%', maxHeight: '200px', objectFit: 'cover', display: 'block' }}
            />
            <button
              type="button"
              onClick={() => {
                setNewSceneImageFile(null);
                setNewSceneImagePreview(null);
              }}
              style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                backgroundColor: 'rgba(0,0,0,0.6)',
                color: '#FFFFFF',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '14px',
              }}
            >
              ✕
            </button>
          </div>
        ) : (
          <label
            style={{
              width: '100%',
              minHeight: '120px',
              border: '2px dashed #CBD5E1',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
              cursor: 'pointer',
              backgroundColor: '#F8FAFC',
              boxSizing: 'border-box',
            }}
          >
            <span style={{ fontSize: '24px', display: 'block', marginBottom: '4px' }}>🖼️</span>
            <span style={{ fontSize: '13px', fontWeight: 500, color: '#64748B' }}>Click to upload image</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleNewSceneImageSelect(file);
              }}
              style={{ display: 'none' }}
            />
          </label>
        )}
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', paddingTop: '8px' }}>
        <button
          type="button"
          onClick={() => setIsAddSceneModalOpen(false)}
          style={{
            padding: '10px 20px',
            borderRadius: '12px',
            border: '1px solid #CBD5E1',
            backgroundColor: '#FFFFFF',
            color: '#374151',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleAddNewScene}
          disabled={!newSceneNarration.trim()}
          style={{
            padding: '10px 24px',
            borderRadius: '12px',
            border: 'none',
            backgroundColor: '#4F46E5',
            color: '#FFFFFF',
            fontSize: '14px',
            fontWeight: 700,
            cursor: newSceneNarration.trim() ? 'pointer' : 'not-allowed',
            boxShadow: '0 4px 12px rgba(79, 70, 229, 0.25)',
            opacity: newSceneNarration.trim() ? 1 : 0.5,
          }}
        >
          Add Scene
        </button>
      </div>
    </div>
  </div>
)}
```

### Phase 2C: Update the Zod schema for `ImageStylePreset`

**File:** `src/types/storyboard.ts`
**Line 142:**

No changes needed — `ImageStylePreset` already includes `'photo-realistic'`. The type is fine; we're just fixing the behavior.

### Phase 2D: Update the Zod schema for `storyboardManifestSchema`

**File:** `src/types/storyboard.ts`
**Lines 362-371:**

The `stylePreset` enum in the schema already includes all values. No changes needed.

---

## Verification Checklist

After implementing, verify:

### Part 1 — Photo Realistic Fix
- [ ] `src/lib/assetCatalogManager.ts`: `isNonPhotoStyle` always `true`, dead photo-realistic pass-through block removed
- [ ] `src/lib/fluxImageGen.ts`: `buildStylePrompt` for `photo-realistic` uses cinematic 35mm language (no "white background", no "infographic", no "no surrounding room")
- [ ] `src/lib/narrativeEngine.ts`: Art Director `styleInstructions` updated for photo-realistic cinematic language
- [ ] `src/lib/narrativeEngine.ts`: Art Director `diagramPrompt` branches on `isCinematicStyle` — cinematic prompt for photo-realistic, diagram prompt for others
- [ ] Generate a video with "Photo Realistic" preset — images should be AI-generated cinematic scenes, not original document photos
- [ ] Document with technical diagrams: those diagrams should still be kept (same as other presets)
- [ ] `npx tsc --noEmit` passes with zero errors

### Part 2 — Edit Screen Enhancements
- [ ] "Replace Image" button appears on each scene card in the edit sidebar
- [ ] Clicking "Replace Image" opens file picker; selecting a file updates the scene's first image element
- [ ] Image updates are visible in the Remotion Player preview immediately
- [ ] "+ Add Scene" button appears in the scenes sidebar header
- [ ] Clicking "+ Add Scene" opens modal with narration textarea and image upload
- [ ] Filling narration + optional image and clicking "Add Scene" creates a new scene
- [ ] New scene appears at the end of the scene list with sequential scene number
- [ ] New scene's elements include title text and uploaded image with correct positioning
- [ ] New scene appears in the Timeline
- [ ] Empty narration blocks the "Add Scene" button (disabled state)
- [ ] Clicking outside the modal or "Cancel" closes it without adding a scene
- [ ] `npx tsc --noEmit` passes with zero errors

---

## Files Modified Summary

| File | Changes |
|---|---|
| `src/lib/assetCatalogManager.ts` | Remove photo-realistic pass-through, all presets use same classify-or-generate path |
| `src/lib/fluxImageGen.ts` | Update `buildStylePrompt` photo-realistic to cinematic 35mm |
| `src/lib/narrativeEngine.ts` | Update Art Director style instructions + branch on cinematic vs diagram prompts |
| `src/components/studio/StoryStudio.tsx` | Add Replace Image button, Add Scene modal, handlers, file inputs |
| `src/types/storyboard.ts` | No changes needed (type already correct) |

---

## Do NOT Change

- Do NOT modify the `ImageStylePreset` type definition — it already has the correct values
- Do NOT modify `src/lib/contextEngine.ts` — the `stylePreset` passthrough is correct
- Do NOT modify `src/compositions/storyteller/ExplainerStoryComposition.tsx` — rendering is unaffected
- Do NOT modify the other three presets (whiteboard, illustration, chalk-drawing) — they work correctly
- Do NOT remove `classifyArticleAsset()` — it's needed for all presets to detect technical diagrams
- Do NOT modify the Vite proxy (`/api/generate-image`) — it already uses `generateFluxImage()` which calls `buildStylePrompt()`
