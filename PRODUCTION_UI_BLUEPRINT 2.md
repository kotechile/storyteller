# OmniCast — Production UI Redesign Blueprint

> **Current file to replace:** `src/components/studio/StoryStudio.tsx` (685 lines)
> **Design goal:** Transform developer-looking NLE into a consumer-grade video creation wizard
> **Reference aesthetic:** Linear, Vercel, Stripe — clean, confident, minimal chrome

---

## Design Principles

1. **Progressive disclosure** — Show only what's needed at each step. Don't overwhelm with all controls at once.
2. **Clear CTAs** — Every screen has one primary action. Users always know what to do next.
3. **Visual confidence** — Large type, generous whitespace, subtle animations. No cramped toolbars.
4. **Content-first** — The video preview is the hero. Controls orbit around it, not the reverse.
5. **Professional restraint** — Indigo/white palette. One accent color. No emoji in labels.

---

## Three-Step Wizard Flow

```
┌─────────────────────────────────────────────────┐
│  STEP 1: Import        STEP 2: Edit       STEP 3: Export  │
│  [────●────────────────────○────────────────────○────]    │
└─────────────────────────────────────────────────┘
```

### Step 1 — Import Your Content
- Large centered URL input (hero element)
- PDF drag-and-drop zone below it
- Style preset cards (Photo-realistic / Illustration / Whiteboard)
- Music track cards in a horizontal scroll
- "Generate Storyboard" CTA button

### Step 2 — Edit Your Storyboard  
- Video preview (large, left 60%)
- Scene cards (right 40%) — scrollable, editable
- Each scene card: thumbnail, narration textarea, image prompt input
- Floating toolbar: camera, lighting, music (collapsible)
- "Preview" and "Render" buttons

### Step 3 — Export
- Final video player (full-width)
- Download button
- Cost summary
- "Create New" button to restart

---

## Color System

```
Background:  #FAFAFA (light) / #0A0A0A (dark)
Surface:     #FFFFFF / #141414
Border:      #E5E5E5 / #262626
Primary:     #4F46E5 (indigo-600)
PrimaryHover:#4338CA
Text:        #171717 / #FAFAFA
TextMuted:   #737373 / #A3A3A3
Success:     #059669
Warning:     #D97706
```

---

## Typography

- Font: Inter (already loaded)
- Hero text: 32px / 700 weight
- Section headers: 18px / 600 weight  
- Body: 14px / 400 weight
- Labels: 12px / 500 weight / uppercase tracking

---

## Component Tree

```
<StoryStudio>
  <StepIndicator />           // Top wizard progress bar
  <Step1Import />             // URL, PDF, style, music
  <Step2Edit />               // Preview + scene cards
  <Step3Export />             // Final video + download
</StoryStudio>
```

### State Machine

```
IDLE → IMPORTING → EDITING → RENDERING → DONE
         ↑            │           │
         └────────────┘           │
         (re-ingest)              │
                                  ↓
                              (download)
```

### State Variables Needed

```typescript
step: 'import' | 'edit' | 'export'
isProcessing: boolean
progressMessage: string
importMode: 'url' | 'pdf'
pdfFile: File | null
stylePreset: ImageStylePreset
manifest: StoryboardManifest | null
context: ContentContext | null
error: string | null
```

---

## Step 1 — Import Screen Layout

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│              🎬  OmniCast                            │
│     Turn any article into a cinematic video          │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  📎  Paste article URL or drop a PDF...        │  │
│  │                                                │  │
│  │  [          https://example.com/article       ] │  │
│  │                                                │  │
│  │  ── or ──                                     │  │
│  │                                                │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │     📄  Drop PDF here or click to upload │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Visual Style                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ 📷       │ │ ✏️       │ │ 🎨       │            │
│  │ Photo    │ │ White-   │ │ Illust-  │            │
│  │ Realistic│ │ board    │ │ ration   │            │
│  └──────────┘ └──────────┘ └──────────┘            │
│                                                      │
│  Background Music                                    │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │
│  │ Lo-Fi  │ │Corp-   │ │Ambi-   │ │ Custom │  →    │
│  │ Focus  │ │orate   │ │ent     │ │ Upload │       │
│  └────────┘ └────────┘ └────────┘ └────────┘       │
│                                                      │
│           [ ✨ Generate Storyboard ]                 │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Implementation Notes for Step 1:

**URL Input:** Large 56px tall input with icon, rounded-xl, subtle shadow. Auto-detects PDF vs URL. Shows loading spinner during fetch.

**PDF Drop Zone:** Dashed border, 120px tall. Accepts drag-and-drop. Shows filename after selection. Uses `ingestPdf()`.

**Style Cards:** Three selectable cards in a row. Each 160x120px with icon, label, subtle description. Active card has indigo border + light indigo bg. Uses `ImageStylePreset`.

**Music Cards:** Horizontal scrollable row of music track cards. Each 140x80px with track name, genre pill, mood tag. Active card has indigo border. "Upload" card at the end triggers file input. Uses `getTrackList()` from musicLibrary.

**CTA Button:** Large indigo button, 48px tall, full text "Generate Storyboard". Shows spinner + progress messages during generation. Disabled when no URL/PDF is provided.

---

## Step 2 — Edit Screen Layout

```
┌──────────────────────────────────────────────────────┐
│ ← Back to Import          [Preview ▶] [Render ⚡]    │
├─────────────────────┬────────────────────────────────┤
│                     │  Scene 1 · 10s                 │
│                     │  ┌──────────────────────────┐  │
│    VIDEO            │  │ In today's rapidly...    │  │
│    PREVIEW          │  │                          │  │
│    16:9             │  │ [textarea: narration]    │  │
│                     │  └──────────────────────────┘  │
│                     │                                │
│                     │  Scene 2 · 12s                 │
│                     │  ┌──────────────────────────┐  │
│                     │  │ At the core of this...   │  │
│                     │  └──────────────────────────┘  │
│                     │                                │
│                     │  Scene 3 · 15s                 │
│                     │  ┌──────────────────────────┐  │
│                     │  │ The pipeline splits...   │  │
│                     │  └──────────────────────────┘  │
│                     │                                │
├─────────────────────┴────────────────────────────────┤
│ 🎥 Camera: [▼ Static]  💡 Light: [▼ Flat]  🎵 [▼ Lo-Fi] │
└──────────────────────────────────────────────────────┘
```

### Implementation Notes for Step 2:

**Video Preview:** Remotion Player, 16:9, fills left 60%. Border radius, subtle shadow. Updates live as scenes are edited.

**Scene Cards:** Right column, scrollable. Each card is a collapsible accordion:
- **Collapsed:** Scene number, first 60 chars of narration, duration badge, image count badge
- **Expanded:** Full narration textarea, image prompt inputs for each element, position/size display
- Click to expand. Only one expanded at a time.
- Drag handles on left edge for reordering (optional, Phase 2)

**Bottom Toolbar:** Thin bar with camera, lighting, and music selectors. Collapsible. Uses the existing `DirectorState`.

**Preview Button:** Opens a fullscreen preview modal with the Remotion Player at full size.

**Render Button:** Advances to Step 3 and triggers the render pipeline.

---

## Step 3 — Export Screen Layout

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│                    ✨  Your video is ready!           │
│                                                      │
│              ┌──────────────────────────┐            │
│              │                          │            │
│              │     FINAL VIDEO          │            │
│              │     PLAYER               │            │
│              │                          │            │
│              └──────────────────────────┘            │
│                                                      │
│     📹  generated_video.mp4                          │
│     ⏱  2m 34s  ·  1920×1080  ·  H.264              │
│                                                      │
│     Cost Breakdown                                   │
│     LLM Generation        $0.024                     │
│     Voice Synthesis       $0.018                     │
│     Image Generation      $0.040                     │
│     ───────────────────────────                     │
│     Total                 $0.082                     │
│                                                      │
│     [ 📥 Download Video ]    [ 🔄 Create New ]       │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Implementation Notes for Step 3:

**Video Player:** Full Remotion Player, 720px wide max. Auto-plays on mount.

**File Info:** Shows filename, duration, resolution, codec.

**Cost Breakdown:** Uses the existing `estimateCost()` function, displayed as a clean table.

**Download Button:** Triggers browser download of the MP4.

**Create New:** Resets all state and returns to Step 1.

---

## File Changes Required

### 1. COMPLETELY REWRITE: `src/components/studio/StoryStudio.tsx`

Replace the entire 685-line file with the new wizard-based UI. Approximate new file size: ~500-600 lines.

**Key structural changes:**
- Remove the cramped 3-panel layout
- Remove the Director's Chair toolbar
- Replace with step-based rendering
- Add `step` state variable
- Split rendering into 3 conditional sections

### 2. NO changes needed to these files:
- `src/lib/ingest.ts` — ingestUrl/ingestPdf unchanged
- `src/lib/contextEngine.ts` — generateContextAwareStoryboard unchanged
- `src/lib/musicLibrary.ts` — getTrackList unchanged
- `src/compositions/storyteller/ExplainerStoryComposition.tsx` — unchanged
- All other lib files — unchanged

### 3. MINOR change: `src/Root.tsx`

The `StorytellerExplainer` composition's `calculateMetadata` may need adjustment for the new props. No structural changes needed.

---

## Implementation Order

### Phase A: Step 1 (Import Screen)
1. Create the `StepIndicator` component (3-dot progress bar)
2. Build the URL input hero section
3. Build the PDF drop zone  
4. Build style preset cards
5. Build music track cards
6. Wire the "Generate Storyboard" CTA
7. Show loading states during generation

### Phase B: Step 2 (Edit Screen)
1. Build the split layout (preview left, scenes right)
2. Build scene cards with expand/collapse
3. Wire narration editing
4. Wire image prompt editing
5. Build the floating bottom toolbar
6. Wire preview and render buttons

### Phase C: Step 3 (Export Screen)
1. Build the video player section
2. Build the cost breakdown table
3. Wire download and "create new" buttons

### Phase D: Polish
1. Add transition animations between steps
2. Add hover states to all interactive elements
3. Add responsive breakpoints
4. Test all flows end-to-end

---

## Complete StoryStudio.tsx Implementation

Below is the FULL replacement code. Copy this entire file over the existing one.

Key things the code does:
- 3-step wizard with progress indicator
- URL input with auto PDF detection
- PDF drag-and-drop zone
- Style preset cards (click to select)
- Music track cards (horizontal scroll, click to select)
- Upload custom music
- Scene cards with expandable narration/image editing
- Video preview panel
- Camera/lighting/music toolbar
- Export screen with cost breakdown
- Loading states with progress messages
