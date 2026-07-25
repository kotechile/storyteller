# PRD: URL-to-Explainer-Video Platform

**Product:** Automated explainer video generator that transforms any article/URL into a fully animated, audio-synced video with storyboarded visuals, image-based scene composition, and region-based image highlighting  
**Core Architecture:** Ingestion → NLP → Storyboard JSON → Canvas Timeline → Remotion Render  
**Version:** 0.2 — Revised  
**Date:** 2026-07-23

---

## 1. Executive Summary

A service that ingests a URL, scrapes the article content **and** its embedded images, passes the structured data through an LLM to generate a **Storyboard JSON** (mapping sentences → visual actions), converts the script to speech with **word-level timestamps**, and renders a precise animated explainer video where every visual reveal is synchronized to the spoken word — down to the millisecond.

### Core Innovation

> **The magic is in the Storyboard JSON.**
> Every sentence knows what to show, where to show it, and *exactly when* to reveal it — driven by word-level TTS timestamps.

---

## 2. User Flow

```
User submits URL
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│              1. INGESTION ENGINE                          │
│  - Fetches URL                                            │
│  - Strips HTML boilerplate (Readability.js)               │
│  - Extracts core text, headings, images + alt-text        │
│  - Indexes available image assets with metadata           │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│              2. NARRATIVE ENGINE (LLM)                    │
│  - Generates a cohesive video script                      │
│  - Creates Storyboard JSON:                               │
│    "At sentence 3, show image X in top-left corner"       │
│    "At sentence 7, draw arrow from concept A → B"         │
│    "At sentence 12, move pointer over diagram region"     │
│  - Injected with available image index + alt-text         │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│              3. AUDIO & SYNC ENGINE                       │
│  - Converts script to speech (TTS)                        │
│  - Returns word-level timestamps:                         │
│    [{word: "Reactive", start: 12.4, end: 12.8}, ...]     │
│  - Synchronizes Storyboard events to precise timecodes    │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│              4. CANVAS & TIMELINE ENGINE                  │
│  - Visual workspace (Next.js + Konva.js)                  │
│  - Plots assets on 2D canvas                              │
│  - Maps animation events onto a scrubber timeline         │
│  - Renders real-time preview                              │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│              5. RENDERING ENGINE                          │
│  - Takes final timeline state (position, timing, assets)  │
│  - Feeds into Remotion server-side renderer               │
│  - Compiles to final MP4 with audio mixed in              │
└──────────────────────────────────────────────────────────┘
                       │
                       ▼
               User downloads MP4
```

---

## 3. System Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                          │
│  ┌─────────────┐  ┌────────────────┐  ┌───────────────────┐  │
│  │ URL Input   │  │ Konva.js       │  │ Timeline Scrubber │  │
│  │ & Status    │  │ Canvas Preview │  │ (Zustand state)   │  │
│  └─────────────┘  └────────────────┘  └───────────────────┘  │
└─────────────────────────┬─────────────────────────────────────┘
                          │
                          ▼
┌───────────────────────────────────────────────────────────────┐
│              Orchestration layer (n8n workflows)               │
│                                                                 │
│  Pipeline triggered by HTTP webhook:                           │
│                                                                 │
│  Step 1: [HTTP] Fetch URL → scrape article text + images       │
│  Step 2: [LLM] Generate script + Storyboard JSON               │
│  Step 3: [TTS] Generate speech → word-level timestamps         │
│  Step 4: [Merge] Combine storyboard + timestamps → final JSON  │
│  Step 5: [Webhook] Send result back to frontend / Remotion     │
│                                                                 │
└───────────────────────┬───────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
            ▼                       ▼
┌───────────────────────┐  ┌───────────────────────┐
│   Supabase (DB)        │  │   Remotion Renderer   │
│  - Storyboard JSON     │  │  - Reads final JSON   │
│  - Timeline state      │  │  - Renders frames     │
│  - Slide metadata      │  │  - Outputs MP4        │
│  - User data           │  │                       │
└───────────────────────┘  └───────────────────────┘
```

---

## 4. Detailed Pipeline Steps

### 4.1 Ingestion Engine

**Tool:** `@mozilla/readability` + custom asset extractor  
**Output:** Structured document with indexed assets, including **vision-analyzed image descriptions** for technical images

```typescript
interface Article {
  title: string;
  textContent: string;          // Clean article text
  excerpt: string;
  wordCount: number;
  // Key feature: extracted images with metadata
  assets: ArticleAsset[];
}

interface ArticleAsset {
  id: string;                    // "asset_1", "asset_2"
  url: string;                   // Original image URL
  altText: string;               // <img alt="..."> attribute
  caption: string | null;        // <figcaption> or surrounding text
  position: number;              // Position in article order
  width: number;                 // Original dimensions
  height: number;
  classification?: "diagram" | "photo" | "chart" | "icon" | "screenshot";
  
  // ★ New: Vision-analyzed content for technical images
  visionAnalysis?: {
    description: string;         // "A flowchart showing decision process A→B→C"
    regions: ImageRegion[];      // Named/sectioned parts of the image
    textContent: string;         // Any text extracted from the image
  };
}

interface ImageRegion {
  id: string;                    // "region_1"
  label: string;                 // "Step 1: Automated Sweeps"
  boundingBox: {                 // Percentage-based coordinates within the image
    x: number; y: number;
    width: number; height: number;
  };
  description: string;           // What this region depicts
}
```

**Critical detail:** The ingestion engine downloads each image and passes it through a **vision-capable LLM** (Claude/GPT-4o) to analyze diagrams, charts, and screenshots. The vision model identifies distinct regions within each technical image and assigns labels/bounding boxes. This enables later per-region highlighting during narration.

**Edge cases:**
- Paywalled article → return error "Cannot access content"
- No article content → return error "Not an article"
- < 100 words → return error "Content too short"

### 4.2 Narrative Engine (LLM) — Full-Story Visualization First

**Input:** Article text + indexed assets (with vision analysis for technical images)  
**Tool:** GPT-4o / Claude (or n8n AI node)  
**Output:** Script + **Storyboard JSON**

#### Design Philosophy

> **Plan the entire visual layout first. Everything is an image.**

Unlike approaches that programmatically draw arrows between nodes or move a laser pointer, this system treats every visual element as a **positioned image**:

- **Arrows between concepts** → An arrow image placed at the right coordinates
- **Connections between nodes** → A connecting-line image sized and positioned to bridge them
- **Highlighting a diagram region** → A semi-transparent overlay rectangle placed over that region of the image

This dramatically simplifies the renderer. Remotion only needs to composite images — no vector path calculations, no programmatic arrow drawing, no bezier curve math.

#### The Prompt Engineering (Crucial)

```
You are a documentary video scriptwriter and storyboard director.

You are given:
1. An article's text content
2. A list of available image assets (each with id, url, alt-text)
3. For technical images (diagrams, charts), you also get:
   - A full description of what the image contains
   - Named regions with bounding boxes within each image

Your job:
1. PLAN THE FULL STORY VISUALIZATION FIRST.
   Decide which images go where on the canvas. Everything is an image —
   arrows, labels, and diagrams are all placed as image elements at
   specific x/y positions and sizes.

2. Write a cohesive 60-120 second narration script broken into scenes.

3. For each scene, define the canvas layout:
   - Which images are shown and where (x%, y%, width%, height%)
   - If an arrow is needed between two concepts, place an arrow IMAGE
     at the position that bridges them — do NOT ask the renderer to draw one.
   - For technical images with known regions, use highlight overlays
     over the specific region being discussed.

4. For each sentence/segment, specify sync hints:
   - "reveal" an element (fade in / slide up)
   - "highlight_region" on an image (draw attention to a specific part)
   - "focus_zoom" (zoom into a region of an image)

Available styles: "cinematic", "flat-vector", "whiteboard", "infographic"

Return valid JSON matching the StoryboardScene type below.
```

#### Storyboard JSON Schema

```typescript
interface StoryboardScene {
  sceneNumber: number;
  narration: string;                      // Text for this scene
  duration: number;                       // Estimated seconds
  
  // Visual layout for this scene (planned upfront)
  layout: {
    background: {
      type: "image" | "gradient" | "solid";
      value: string;                      // Asset ID, gradient CSS, or hex
    };
    
    // Elements on the canvas — every element is an image
    elements: CanvasElement[];
  };
  
  // Word-level sync hints (filled later by TTS engine)
  syncHints: SyncHint[];
}

interface CanvasElement {
  id: string;                             // "element_1"
  type: "image" | "text" | "highlight_overlay";
  
  // Source data
  sourceAssetId?: string;                 // References ArticleAsset.id
  content?: string;                       // Text content for text elements
  
  // Position (percentage-based for responsiveness)
  x: number;                              // 0-100 (% of canvas width)
  y: number;                              // 0-100 (% of canvas height)
  width: number;                          // 0-100
  height: number;                         // 0-100
  
  // Z-order (for layering images on top of each other)
  zIndex: number;                         // Higher = on top
  
  // Animation
  enterAnimation?: {
    type: "fade_in" | "slide_up" | "scale_in" | "zoom_in";
    duration: number;                     // In frames (at 30fps)
    delay: number;                        // Delay within scene (frames)
  };
  
  // For highlight overlays on technical images
  highlightOverlay?: {
    targetAssetId: string;                // Which image this overlay targets
    targetRegion: "region_1" | "region_2" | "full";  // Which region to highlight
    style: "glow" | "dim_others" | "border";          // Highlight visual style
  };
}

interface SyncHint {
  text: string;                           // Substring of narration to sync with
  triggerAction: "reveal" | "highlight_off" | "highlight_on" | "focus_zoom";
  targetElementId: string;                // ID of element to affect
  // For region highlights within technical images
  targetRegionId?: string;                // "region_1", "region_2"
}
```

#### Element Types Explained

| Type | How it works | Example |
|---|---|---|
| `image` | A positioned image on the canvas. Can be an article asset, AI-generated image, or even a pre-made arrow/icon | Article screenshot, arrow icon pointing right |
| `text` | On-screen headline or subtitle text | "The Reactive Fear Cycle" |
| `highlight_overlay` | A semi-transparent rectangle overlay placed over a specific region of a parent image. Used when the narrator is explaining a specific part of a diagram | A glowing overlay over "Step 2" of a process diagram |

#### Example Storyboard JSON Output

```json
{
  "scenes": [
    {
      "sceneNumber": 1,
      "narration": "Every business faces the Reactive Fear Cycle — a pattern where urgent problems trigger hasty decisions.",
      "duration": 8,
      "layout": {
        "background": { "type": "gradient", "value": "linear-gradient(135deg, #1a1a2e, #16213e)" },
        "elements": [
          {
            "id": "title_text",
            "type": "text",
            "content": "The Reactive Fear Cycle",
            "x": 10, "y": 10, "width": 80, "height": 15,
            "zIndex": 10,
            "enterAnimation": { "type": "slide_up", "duration": 20, "delay": 0 }
          },
          {
            "id": "cycle_diagram",
            "type": "image",
            "sourceAssetId": "asset_3",
            "x": 15, "y": 30, "width": 70, "height": 60,
            "zIndex": 1,
            "enterAnimation": { "type": "fade_in", "duration": 15, "delay": 10 }
          }
        ]
      },
      "syncHints": [
        { "text": "Every business faces", "triggerAction": "reveal", "targetElementId": "title_text" },
        { "text": "Reactive Fear Cycle", "triggerAction": "focus_zoom", "targetElementId": "cycle_diagram" }
      ]
    },
    {
      "sceneNumber": 2,
      "narration": "Here at point A, we have Automated Sweeps generating consistent leads. And at point B, we see High Mental Energy driving team performance.",
      "duration": 12,
      "layout": {
        "background": { "type": "gradient", "value": "linear-gradient(135deg, #0f2027, #203a43)" },
        "elements": [
          {
            "id": "point_a_img",
            "type": "image",
            "sourceAssetId": "asset_1",
            "x": 5, "y": 25, "width": 40, "height": 50,
            "zIndex": 1,
            "enterAnimation": { "type": "fade_in", "duration": 15, "delay": 0 }
          },
          {
            "id": "arrow_image",
            "type": "image",
            "sourceAssetId": "asset_arrow_right",  // Pre-made arrow image
            "x": 43, "y": 42, "width": 14, "height": 10,
            "zIndex": 2,
            "enterAnimation": { "type": "fade_in", "duration": 10, "delay": 25 }
          },
          {
            "id": "point_b_img",
            "type": "image",
            "sourceAssetId": "asset_2",
            "x": 55, "y": 25, "width": 40, "height": 50,
            "zIndex": 1,
            "enterAnimation": { "type": "fade_in", "duration": 15, "delay": 35 }
          },
          {
            "id": "highlight_a",
            "type": "highlight_overlay",
            "sourceAssetId": "asset_1",
            "x": 5, "y": 25, "width": 40, "height": 50,
            "zIndex": 5,
            "highlightOverlay": {
              "targetAssetId": "asset_1",
              "targetRegion": "full",
              "style": "glow"
            },
            "enterAnimation": { "type": "fade_in", "duration": 8, "delay": 2 }
          },
          {
            "id": "highlight_b",
            "type": "highlight_overlay",
            "sourceAssetId": "asset_2",
            "x": 55, "y": 25, "width": 40, "height": 50,
            "zIndex": 5,
            "highlightOverlay": {
              "targetAssetId": "asset_2",
              "targetRegion": "full",
              "style": "glow"
            },
            "enterAnimation": { "type": "fade_in", "duration": 8, "delay": 37 }
          }
        ]
      },
      "syncHints": [
        { "text": "point A",                  "triggerAction": "highlight_on", "targetElementId": "highlight_a" },
        { "text": "Automated Sweeps",          "triggerAction": "highlight_on", "targetElementId": "highlight_a" },
        { "text": "point B",                  "triggerAction": "highlight_off", "targetElementId": "highlight_a" },
        { "text": "point B",                  "triggerAction": "highlight_on", "targetElementId": "highlight_b" },
        { "text": "High Mental Energy",        "triggerAction": "highlight_on", "targetElementId": "highlight_b" }
      ]
    },
    {
      "sceneNumber": 3,
      "narration": "Looking at this process diagram, the first step is data collection, where raw information enters the system from multiple sources.",
      "duration": 8,
      "layout": {
        "background": { "type": "gradient", "value": "linear-gradient(135deg, #1a1a2e, #16213e)" },
        "elements": [
          {
            "id": "process_diagram",
            "type": "image",
            "sourceAssetId": "asset_diagram",    // Technical diagram from article
            "x": 10, "y": 15, "width": 80, "height": 70,
            "zIndex": 1,
            "enterAnimation": { "type": "fade_in", "duration": 20, "delay": 0 }
          },
          {
            "id": "step1_highlight",
            "type": "highlight_overlay",
            "x": 10, "y": 15, "width": 80, "height": 70,
            "zIndex": 2,
            "highlightOverlay": {
              "targetAssetId": "asset_diagram",
              "targetRegion": "region_1",          // "Data Collection" box in diagram
              "style": "glow"
            },
            "enterAnimation": { "type": "fade_in", "duration": 10, "delay": 15 }
          }
        ]
      },
      "syncHints": [
        { "text": "first step is data collection", "triggerAction": "highlight_on", "targetElementId": "step1_highlight", "targetRegionId": "region_1" }
      ]
    }
  ]
}
```

### 4.3 Audio & Synchronization Engine

**Input:** Script text (concatenated narration from all scenes)  
**Tool:** Deepgram / OpenAI Whisper TTS API / ElevenLabs  
**Output:** Audio buffer + word-level timestamp array

```typescript
interface WordTimestamp {
  word: string;
  start: number;          // Seconds from audio start
  end: number;            // Seconds from audio start
}

interface TTSOutput {
  audioBuffer: Buffer;    // MP3 or WAV
  wordTimestamps: WordTimestamp[];
  duration: number;       // Total audio duration in seconds
}
```

#### The Critical Sync Step

After getting TTS output, an **alignment process** maps each storyboard `syncHint` to its exact timecode:

```typescript
// 1. Concatenate all scene narrations into one full script
const fullScript = scenes.map(s => s.narration).join(" ");

// 2. Send to TTS → get wordTimestamps array

// 3. For each scene's syncHints, find matching words in timestamps
for (const scene of storyboard.scenes) {
  for (const hint of scene.syncHints) {
    // Find the audio time range for this text fragment
    const startWord = wordTimestamps.find(w => hint.text.startsWith(w.word));
    const endWord = wordTimestamps.find(w => hint.text.endsWith(w.word));
    
    hint.audioStart = startWord.start;
    hint.audioEnd = endWord.end;
  }
}
```

This is what enables **millisecond-precise sync** — the pointer reaches point B exactly as the voice says "High Mental Energy."

### 4.4 Canvas & Timeline Engine (Frontend)

**Framework:** Next.js + **Konva.js** (2D canvas library)  
**State Management:** Zustand (tracks playhead position, animation progress)

#### Konva.js Canvas Structure

```typescript
// Each scene becomes a Konva.Layer
// Each element becomes a Konva node:
//   - Konva.Image for image elements
//   - Konva.Text for text elements
//   - Konva.Rect for highlight overlays (semi-transparent, animated opacity)

// The playhead position (in ms) drives all animations:
//   - opacity = lerp(0, 1, (playhead - element.startTime) / element.duration)
//   - Image highlights: a semi-transparent glowing Konva.Rect
//     is placed at the exact position/size of the target region
//   - Dim others: a full-canvas dark overlay with a cutout
//     over the highlighted region
```

#### Timeline UI Components

| Component | Description |
|---|---|
| **Playhead / Scrubble** | Draggable timeline showing total duration, scene boundaries |
| **Animation Tracks** | Horizontal bars per element showing when they appear/disappear |
| **Waveform** | Audio waveform rendered from the TTS audio buffer |
| **Keyframe Markers** | Dots on the timeline where sync events fire |
| **Zoom** | Time-scale zoom (frames, seconds, scene-level) |

#### Zustand Store

```typescript
interface TimelineStore {
  playheadPosition: number;         // In ms
  isPlaying: boolean;
  currentScene: number;
  
  scenes: StoryboardScene[];
  wordTimestamps: WordTimestamp[];
  audioDuration: number;
  
  // Derived: active elements at current playhead
  activeElements: (sceneIndex: number, playheadMs: number) => CanvasElement[];
  
  // Actions
  setPlayhead: (ms: number) => void;
  play: () => void;
  pause: () => void;
  scrubTo: (ms: number) => void;
}
```

#### Image Highlight Overlays

The primary visual mechanism for directing attention is the **highlight overlay** — a semi-transparent shape placed over an image or a region of an image.

```typescript
// Three highlight styles:

// 1. GLOW: Semi-transparent bright overlay on the target region
//    Everything else stays at normal brightness
const glowOverlay = new Konva.Rect({
  x: regionX, y: regionY,
  width: regionWidth, height: regionHeight,
  fill: 'rgba(59, 130, 246, 0.15)',  // Blue glow
  stroke: '#3b82f6',
  strokeWidth: 3,
  shadowColor: '#3b82f6',
  shadowBlur: 20,
  shadowOpacity: 0.5,
});

// 2. DIM OTHERS: Full-canvas dark overlay with a cutout over target
//    Uses Konva.Layer with a transparent hole using compositing
//    Alternatively: render a separate Rect per non-target region
const dimOverlay = new Konva.Rect({
  x: 0, y: 0,
  width: canvasWidth, height: canvasHeight,
  fill: 'rgba(0, 0, 0, 0.4)',  // Darkens everything
});
// The target region stays at full brightness because
// the overlay is not drawn over it (hole-punch compositing)

// 3. BORDER: Just a colored border drawn around the region
const borderOverlay = new Konva.Rect({
  x: regionX - 2, y: regionY - 2,
  width: regionWidth + 4, height: regionHeight + 4,
  stroke: '#f59e0b',
  strokeWidth: 4,
  cornerRadius: 4,
  dash: [10, 5],  // Animated dash for attention
});
```

### 4.5 Rendering Engine (Remotion)

**Input:** The final timeline state (Storyboard JSON + audio timestamps + asset URLs)  
**Output:** MP4 video

#### Architecture: Canvas State → Remotion Props

The frontend's Zustand state IS the source of truth. When the user hits "Export," the frontend serializes the current timeline state and passes it to Remotion:

```typescript
// Frontend serializes:
const renderPayload = {
  scenes: store.scenes,                // Storyboard JSON
  wordTimestamps: store.wordTimestamps,
  audioUrl: "/audio/narration.mp3",   // Uploaded to Supabase storage
  audioDuration: store.audioDuration,
  fps: 30,
  resolution: { width: 1920, height: 1080 },
};
```

#### Remotion Composition

```tsx
// Each scene is a <Sequence> whose length is determined
// by audio word-timestamps, not estimated duration

const ExplainerVideo: React.FC<{
  scenes: StoryboardScene[];
  wordTimestamps: WordTimestamp[];
  audioUrl: string;
  fps: number;
}> = ({ scenes, wordTimestamps, audioUrl, fps }) => {
  
  // Calculate scene boundaries from word timestamps
  const sceneBoundaries = calculateSceneFrames(scenes, wordTimestamps, fps);
  
  return (
    <Composition>
      <Audio src={audioUrl} />
      
      {scenes.map((scene, i) => (
        <Sequence
          key={scene.sceneNumber}
          from={sceneBoundaries[i].startFrame}
          durationInFrames={sceneBoundaries[i].frameCount}
        >
          <SceneCanvas scene={scene} fps={fps} />
        </Sequence>
      ))}
    </Composition>
  );
};

// SceneCanvas mirrors the Konva.js frontend but renders
// everything as <Img> + <div> + overlay divs (no Konva in Remotion)
const SceneCanvas: React.FC<{ scene: StoryboardScene; fps: number }> = ({
  scene,
  fps,
}) => {
  const frame = useCurrentFrame();
  const currentTimeMs = (frame / fps) * 1000;
  
  return (
    <div style={{ width: 1920, height: 1080, position: 'relative' }}>
      {/* Background */}
      <BackgroundRenderer background={scene.layout.background} />
      
      {/* Elements, ordered by zIndex */}
      {[...scene.layout.elements]
        .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
        .map((el) => (
          <ElementRenderer
            key={el.id}
            element={el}
            currentTimeMs={currentTimeMs}
            fps={fps}
          />
        ))}
    </div>
  );
};

const ElementRenderer: React.FC<{
  element: CanvasElement;
  currentTimeMs: number;
  fps: number;
}> = ({ element, currentTimeMs }) => {
  if (element.type === "image") {
    return (
      <Img
        src={element.sourceAssetId}
        style={{
          position: 'absolute',
          left: `${element.x}%`, top: `${element.y}%`,
          width: `${element.width}%`, height: `${element.height}%`,
          // Ken Burns slow zoom
          transform: `scale(${interpolate(
            useCurrentFrame(), [0, 150], [1.0, 1.04]
          )})`,
          opacity: interpolate(useCurrentFrame(), [0, 10], [0, 1]),
        }}
      />
    );
  }

  if (element.type === "text") {
    return (
      <div style={{
        position: 'absolute',
        left: `${element.x}%`, top: `${element.y}%`,
        width: `${element.width}%`, height: `${element.height}%`,
        opacity: interpolate(useCurrentFrame(), [0, 15], [0, 1]),
        transform: `translateY(${interpolate(useCurrentFrame(), [0, 15], [20, 0])}px)`,
        fontFamily: 'Inter, sans-serif',
        fontSize: 48, fontWeight: 700, color: 'white',
        textShadow: '0 2px 10px rgba(0,0,0,0.3)',
      }}>
        {element.content}
      </div>
    );
  }

  if (element.type === "highlight_overlay") {
    // Renders a glowing overlay on top of a target region
    const isActive = element.highlightOverlay?.targetRegion === "full"
      ? true  // Animated via syncHints (highlight_on / highlight_off)
      : false;
    
    return (
      <div style={{
        position: 'absolute',
        left: `${element.x}%`, top: `${element.y}%`,
        width: `${element.width}%`, height: `${element.height}%`,
        border: '3px solid rgba(255, 255, 0, 0.8)',
        borderRadius: 8,
        boxShadow: '0 0 30px rgba(59, 130, 246, 0.5), inset 0 0 30px rgba(59, 130, 246, 0.1)',
        backgroundColor: 'rgba(59, 130, 246, 0.08)',
        pointerEvents: 'none',
        opacity: interpolate(useCurrentFrame(), [0, 8], [0, 1]),
      }} />
    );
  }

  return null;
};
```

#### Remotion Rendering Command

```bash
npx remotion render \
  --concurrency=2 \
  --quality=100 \
  --props='{"scenes": [...], "wordTimestamps": [...], "audioUrl": "..."}' \
  src/ExplainerVideo.tsx ExplainerVideo \
  out/final_video.mp4
```

#### Post-Processing (FFmpeg)

Add background music, audio ducking, and final encode:

```bash
# Mix background music with ducking and overlay on Remotion output
ffmpeg -i final_video.mp4 -i background_music.mp3 \
  -filter_complex "
    [1:a]volume=0.25,adelay=500|500[music];
    [0:a][music]amix=inputs=2:duration=first:weights=1 0.3
  " \
  -c:v copy \
  -c:a aac -b:a 192k \
  -shortest output_with_music.mp4
```

---

## 5. Key Engineering Challenges & Solutions

### 5.1 The Article-to-Visuals Link

**Problem:** How does the system know which image to show at which part of the script?

**Solution:** The ingestion engine passes an **index of available assets** (image URLs + alt-text) directly into the LLM prompt. The prompt instructs: *"When discussing system logic, utilize asset_3.jpg and place it in the center. You have these images available: [asset_1: "photo of team meeting", asset_2: "diagram of sales funnel"]"*

### 5.2 Audio-Visual Sync

**Problem:** How does the highlight overlay appear over the right region exactly as the narrator describes it?

**Solution:** **Word-level timestamps** from the TTS provider. Every word gets a start/end time in seconds:

```
wordTimestamps = [
  { word: "Reactive", start: 12.4, end: 12.8 },
  { word: "Fear", start: 12.9, end: 13.2 },
  { word: "Cycle", start: 13.3, end: 13.7 },
]
```

Each `syncHint` maps a text phrase to a `highlight_on` / `highlight_off` trigger. The alignment engine finds the word-timestamp range for each phrase and sets the highlight's fade-in/fade-out window. The result: the overlay glows exactly as the narrator says the corresponding concept, and fades when moving to the next.

### 5.3 Image Region Highlighting

**Problem:** How does the system draw attention to a specific part of a complex technical diagram while narrating?

**Solution:** No pointer, no arrows — **region-based image overlays** driven by vision-analyzed bounding boxes:

1. **Vision analysis** during ingestion: When a diagram/chart/screenshot is found, it's sent to a vision LLM that identifies distinct regions with bounding boxes and labels (e.g., "Step 1: Data Collection" at `{x:5, y:15, w:40, h:30}`).

2. **Highlight overlay element**: The Storyboard JSON includes `highlight_overlay` elements that sit on top of the target image. Each overlay matches the position and dimensions of the target region.

3. **Sync-triggered visibility**: The `syncHints` array contains `highlight_on` / `highlight_off` actions tied to word timestamps. When the narrator says "the first step is data collection," a blue glowing overlay fades in over "region_1" of the diagram.

4. **Highlight styles**:
   - **Glow**: Semi-transparent blue fill + colored border + box-shadow
   - **Dim others**: Full-canvas dark overlay with a hole-punch over the target region
   - **Border**: Animated dashed border around the region

This approach requires **no pointer path calculations, no coordinate interpolation, no easing functions** — just simple overlay opacity toggling on a timeline.

### 5.4 Visual Consistency Across Scenes

**Problem:** Each scene is generated independently — colors, fonts, and styles drift.

**Solution:** A **"Style Guide" JSON** injected into every LLM call:

```json
{
  "brand": {
    "primaryColor": "#2563eb",
    "secondaryColor": "#1e40af",
    "fontFamily": "Inter, sans-serif",
    "accentColor": "#f59e0b"
  },
  "animationPreset": "professional",
  "backgroundPreset": "gradient-dark"
}
```

### 5.5 Remotion Video Performance

**Problem (from experience):** Remotion renders choppy with real video clips.

**Solution (same as before):**
- **Zero `<Video>` elements** in Remotion — everything is `<Img>`, SVG, CSS animations
- Audio is a *single* `<Audio>` element, not per-scene clips
- All images pre-downloaded to disk before rendering starts
- `--concurrency=2` to avoid Chrome memory issues
- WebM output codec for faster encode

---

## 6. Technology Stack

| Layer | Technology | Why |
|---|---|---|
| **Frontend** | Next.js + React | App router, server components, easy Remotion interop |
| **Canvas** | Konva.js | 2D canvas with groups, arrows, tweens, hit detection |
| **State Mgmt** | Zustand | Lightweight, selector-based, no boilerplate for timeline state |
| **Database** | Supabase (PostgreSQL) | Stores deeply nested Storyboard JSON, timeline state, slide metadata |
| **File Storage** | Supabase Storage | Stores generated images, TTS audio, final videos |
| **Pipeline Orc.** | n8n | Visual workflow builder for the multi-stage AI pipeline |
| **LLM** | Claude / GPT-4o | Script generation + Storyboard JSON output |
| **TTS** | Deepgram / ElevenLabs | Word-level timestamping critical |
| **Image Gen** | DALL·E 3 / SD 3.5 | Generate images for scenes without article assets |
| **Video Render** | Remotion | React-based programmatic video rendering |
| **Post-Process** | FFmpeg | Audio mixing, background music, final encode |
| **Hosting** | Coolify on VPS (Docker) | Isolated containers for rendering tasks |

---

## 7. API Design

### POST `/api/render`

```json
{
  "url": "https://example.com/article",
  "options": {
    "voice": "rachel",
    "style": "flat-vector",
    "brand": {
      "primaryColor": "#2563eb",
      "fontFamily": "Inter"
    },
    "musicGenre": "cinematic",
    "maxDuration": 120
  },
  "webhook": "https://myapp.com/callback"
}
```

**Response (202 Accepted):**
```json
{ "jobId": "abc123", "statusUrl": "/api/status/abc123" }
```

### GET `/api/status/:jobId`

```json
{
  "jobId": "abc123",
  "status": "processing",
  "progress": 0.45,
  "stage": "generating_script",
  "storyboardPreviewUrl": "/api/preview/abc123",
  "estimatedRemaining": 45
}
```

States: `queued → scraping → scripting → storyboarding → generating_audio → syncing → generating_images → rendering → post_processing → complete | failed`

### GET `/api/storyboard/:jobId`

Returns the intermediate Storyboard JSON for preview/editing before rendering.

### GET `/api/download/:jobId`

Returns the final MP4 file.

---

## 8. n8n Workflow Design

The pipeline is orchestrated as an n8n workflow with these nodes:

```
[Webhook Trigger] → Receive URL + options
       │
       ▼
[HTTP Request] → Fetch URL content
       │
       ▼
[Function Node] → Run Readability.js to extract text + images
       │
       ▼
[OpenAI/Claude Node] → Generate script + Storyboard JSON
       │                  (injected with image index)
       ▼
[Deepgram Node] → Generate TTS with word-level timestamps
       │
       ▼
[Code Node] → Align storyboard syncHints with timestamps
       │
       ▼
[Supabase Node] → Store storyboard + audio URL
       │
       ▼
[HTTP Request] → Trigger frontend update (WebSocket)
       │
       ▼
[Wait] → Wait for user editing (or auto-proceed)
       │
       ▼
[Remotion CLI Node] → Render video via Docker container
       │
       ▼
[FFmpeg Node] → Mix background music, final encode
       │
       ▼
[Supabase Node] → Store final video URL
       │
       ▼
[Webhook Response] → Send download link
```

---

## 9. Cost Estimates (Per 2-min Video)

| Component | Cost |
|---|---|
| LLM (script + storyboard gen) | ~$0.03 |
| TTS with word-level timestamps | ~$0.04 |
| Image gen (if needed, 4 scenes × $0.04) | ~$0.16 |
| Remotion render (server) | ~$0.02 (electricity) |
| FFmpeg processing | free |
| Supabase storage | negligible |
| **Total** | **~$0.25 per video** |

---

## 10. MVP vs. V2

### MVP (Build This First)
- URL input → scrape → vision-analyze images → generate Storyboard JSON
- Full-story visualization: LLM plans ALL element positions upfront
- Konva.js frontend preview with synchronized playhead
- Image composition only (no arrow drawing, no pointer paths)
- Region-based highlight overlays on technical images
- 1 voice, 1 style preset
- Remotion export to MP4 (image-only, zero video clips)
- Single-threaded rendering pipeline

### V2
- Web-based editor (drag elements, edit text, tweak timing)
- Multiple visual styles and voice options
- Brand color customization
- Multi-language narration
- User-uploaded images as assets
- Remotion Lambda for parallel rendering
- Chapter markers / social clip extraction

---

## 11. Directory Structure

```
project/
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx                     # URL input + status
│   │   │   ├── editor/
│   │   │   │   └── [jobId]/page.tsx         # Canvas + timeline editor
│   │   │   └── api/
│   │   ├── components/
│   │   │   ├── canvas/
│   │   │   │   ├── CanvasStage.tsx          # Konva Stage wrapper
│   │   │   │   ├── SceneLayer.tsx           # Per-scene layer
│   │   │   │   ├── ElementRenderer.tsx      # Element → Konva node (image/text/overlay)
│   │   │   │   └── HighlightOverlay.tsx     # Glowing region overlay on images
│   │   │   ├── timeline/
│   │   │   │   ├── Timeline.tsx             # Main timeline bar
│   │   │   │   ├── Playhead.tsx             # Draggable playhead
│   │   │   │   ├── AnimationTrack.tsx       # Per-element track
│   │   │   │   └── Waveform.tsx             # Audio waveform
│   │   │   └── ui/                          # Buttons, sliders, etc.
│   │   ├── store/
│   │   │   └── timelineStore.ts             # Zustand store
│   │   ├── lib/
│   │   │   ├── types.ts                     # All TypeScript types
│   │   │   ├── animations.ts                # Tween/easing helpers
│   │   │   ├── highlight.ts                 # Overlay positioning from region data
│   │   │   └── sync.ts                      # Word-timestamp alignment
│   │   └── remotion/
│   │       ├── ExplainerVideo.tsx           # Main composition
│   │       ├── SceneCanvas.tsx              # Scene renderer
│   │       ├── ElementRenderer.tsx          # Element → div/SVG
│   │       ├── PointerRenderer.tsx          # Pointer in Remotion
│   │       └── BackgroundRenderer.tsx       # Background styles
│   ├── public/
│   │   └── fonts/
│   └── package.json
├── backend/
│   ├── n8n-workflows/
│   │   └── url-to-video.json               # Exportable n8n workflow
│   ├── supabase/
│   │   └── schema.sql                       # Tables for storyboards
│   └── docker/
│       ├── docker-compose.yml               # Supabase + n8n + remotion
│       └── Dockerfile.remotion              # Remotion render container
└── README.md
```

---

## 12. Open Questions

1. **n8n vs. custom orchestrator?** n8n is faster to build but harder to debug. A custom Node.js orchestrator with BullMQ gives more control. Decision: start with n8n for prototyping, migrate to custom if bottlenecked.
2. **Word-level timestamps from which provider?** Deepgram offers the best word-level API for TTS ($0.015/min). ElevenLabs has better voice quality but word-level timestamps require post-hoc alignment with Whisper.
3. **Canvas state → Remotion fidelity gap?** Animations that look perfect in Konva.js (eases, filters, shadows) may not render identically in Remotion's headless browser. Need a pixel-comparison test suite.
4. **Vision analysis cost?** Running every article image through a vision LLM adds latency and cost ($0.01-0.03 per image). Consider caching analyzed results or only analyzing images >100KB with detected text/diagram structure.
5. **Image rights?** Article images may be copyrighted. The platform needs a disclaimer and fallback AI-generated images for commercial use.
6. **Arrow images library?** The system needs a small set of pre-made arrow/connection/pointer images in multiple styles (flat, gradient, white) that the LLM can reference as "asset_arrow_right", "asset_arrow_curved", etc.
