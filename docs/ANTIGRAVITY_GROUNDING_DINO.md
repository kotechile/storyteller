# Grounding DINO Backend + Sub-Region Highlighting — Implementation Spec

> **For:** Antigravity Engineering Team  
> **Project:** Remotion Explainer Video Pipeline  
> **Feature:** Zero-shot object detection for region-level image highlighting with animated pointer  
> **Date:** 2026-07-30

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Phase 1 — Backend: Grounding DINO Service](#phase-1--backend-grounding-dino-service)
4. [Phase 2 — Frontend: TypeScript Client](#phase-2--frontend-typescript-client)
5. [Phase 3 — New Types](#phase-3--new-types)
6. [Phase 4 — Region-to-Narration Sync Engine](#phase-4--region-to-narration-sync-engine)
7. [Phase 5 — Implement VectorAnnotation Component](#phase-5--implement-vectorannotation-component)
8. [Phase 6 — Implement PointerLaser Component](#phase-6--implement-pointerlaser-component)
9. [Phase 7 — Wire into ElementRenderer](#phase-7--wire-into-elementrenderer)
10. [Phase 8 — Pipeline Orchestration](#phase-8--pipeline-orchestration)
11. [Testing & Verification](#testing--verification)
12. [VPS Deployment](#vps-deployment)
13. [Appendix: How Grounding DINO Works](#appendix-how-grounding-dino-works)

---

## Overview

### What we're building

When the voiceover in an explainer video talks about a specific part of an image (e.g., "this blue server icon here"), the video will:

1. **Highlight** that exact sub-region with a glowing bounding box
2. **Optionally animate a pointer dot** that moves to that region

### How it works (30-second version)

```
Narration text  →  Extract key phrases  →  Send to Grounding DINO  →  Get bounding boxes
                                                                             ↓
"the blue server       ["blue server",      POST /detect              [{ label: "blue server",
 icon on the left"      "red arrow"]         image + prompts           box: {x:12, y:34, w:8, h:12} }]
                                                                             ↓
                                                                     Map to narration timestamps
                                                                             ↓
                                                                     Render VectorAnnotation
                                                                     + PointerLaser at runtime
```

### What already exists

| Component | File | Status |
|---|---|---|
| `ImageRegion` + `VisionAnalysis` types | `src/types/storyboard.ts:7-35` | ✅ Defined, attached to assets |
| `HighlightOverlay` (full-element highlight) | `src/compositions/storyteller/HighlightOverlay.tsx` | ✅ Working |
| `PointerLaser` component | `src/compositions/storyteller/PointerLaser.tsx` | ❌ Stub — returns `null` |
| `VectorAnnotation` component | `src/compositions/storyteller/VectorAnnotation.tsx` | ❌ Stub — returns `null` |
| Word-level timestamps from ElevenLabs | `src/lib/elevenlabsTts.ts` | ✅ Working |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  GENERATION PIPELINE (Node.js / TypeScript)                      │
│                                                                  │
│  narrativeEngine.ts                                              │
│    → generates scenes with narration + images                    │
│                                                                  │
│  groundingDinoClient.ts  ◀ NEW                                  │
│    → HTTP POST to backend                                        │
│    → caches results per image+prompt hash                        │
│                                                                  │
│  regionSync.ts  ◀ NEW                                           │
│    → extracts key phrases from narration                         │
│    → matches phrases to detected regions (fuzzy)                 │
│    → computes start/end times from word timestamps               │
│    → produces RegionFocusEvent[]                                 │
│                                                                  │
│  audioSync.ts (existing)                                         │
│    → already computes revealTimeSeconds per element              │
│    → same word timestamps used for region sync                   │
└──────────────────────┬───────────────────────────────────────────┘
                       │ HTTP (localhost:8001 in dev)
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  GROUNDING DINO BACKEND (Python 3.11+ / FastAPI)                 │
│                                                                  │
│  backend/                                                        │
│  ├── main.py              FastAPI app with lifecycle             │
│  ├── detector.py          Grounding DINO model wrapper           │
│  ├── requirements.txt     Python dependencies                    │
│  ├── Dockerfile           Multi-stage, ~4GB image                │
│  └── docker-compose.yml   Dev + prod configs                     │
│                                                                  │
│  Endpoints:                                                      │
│    POST /detect     { image_url, prompts[] } → { regions[] }    │
│    GET  /health     → { status: "ok", model_loaded: true }      │
│                                                                  │
│  Model: IDEO-Research/grounding-dino-base (Hugging Face)         │
│  Loads once at startup, stays in GPU/CPU memory                  │
└──────────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  REMOTION RENDERING (React / runtime)                            │
│                                                                  │
│  ElementRenderer.tsx                                             │
│    → reads RegionFocusEvent[] from scene data                    │
│    → determines active region based on currentTimeMs             │
│    → renders VectorAnnotation + PointerLaser as children         │
│                                                                  │
│  VectorAnnotation.tsx  ◀ IMPLEMENT STUB                         │
│    → glowing box, dashed border, or spotlight on sub-region      │
│                                                                  │
│  PointerLaser.tsx  ◀ IMPLEMENT STUB                             │
│    → animated dot that moves between region centers              │
└──────────────────────────────────────────────────────────────────┘
```

---

## Phase 1 — Backend: Grounding DINO Service

### Directory Structure

```
backend/
├── main.py
├── detector.py
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

### 1a. `backend/requirements.txt`

```txt
fastapi==0.115.6
uvicorn[standard]==0.34.0
transformers==4.48.3
torch==2.5.1
Pillow==11.1.0
httpx==0.28.1
python-dotenv==1.0.1
pydantic==2.10.4
accelerate==1.3.0
```

> **Note:** `transformers>=4.47.0` is required — Grounding DINO was integrated into Hugging Face transformers starting at v4.47.0. The model will be auto-downloaded from Hugging Face on first run (~700MB).

### 1b. `backend/detector.py`

This is the core model wrapper. It loads Grounding DINO once and provides a `detect()` function.

```python
"""
Grounding DINO zero-shot object detector.
Loads the model once at startup; provides a detect() function for inference.
"""
import torch
from PIL import Image
from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
import io
import httpx
from typing import Optional

# Model ID on Hugging Face
MODEL_ID = "IDEA-Research/grounding-dino-base"

# Global model instance (loaded once at startup)
_processor: Optional[AutoProcessor] = None
_model: Optional[AutoModelForZeroShotObjectDetection] = None
_device: Optional[torch.device] = None


def get_device() -> torch.device:
    """Auto-detect best available device."""
    if torch.cuda.is_available():
        return torch.device("cuda")
    elif torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def load_model(device_str: Optional[str] = None) -> tuple:
    """
    Load Grounding DINO model and processor.
    Call once at startup. Subsequent calls return cached instances.
    """
    global _processor, _model, _device

    if _model is not None:
        return _processor, _model, _device

    _device = torch.device(device_str) if device_str else get_device()
    print(f"[detector] Loading Grounding DINO on device: {_device}")

    _processor = AutoProcessor.from_pretrained(MODEL_ID)
    _model = AutoModelForZeroShotObjectDetection.from_pretrained(MODEL_ID).to(_device)
    _model.eval()

    print(f"[detector] Model loaded successfully.")
    return _processor, _model, _device


async def fetch_image(url: str) -> Image.Image:
    """Download an image from a URL into a PIL Image."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return Image.open(io.BytesIO(resp.content)).convert("RGB")


def detect(
    image: Image.Image,
    prompts: list[str],
    box_threshold: float = 0.25,
    text_threshold: float = 0.20,
) -> list[dict]:
    """
    Run zero-shot object detection on an image.

    Args:
        image: PIL Image in RGB mode
        prompts: List of text queries (e.g., ["blue server icon", "red arrow"])
        box_threshold: Minimum confidence for bounding boxes (0-1)
        text_threshold: Minimum confidence for text-prompt match (0-1)

    Returns:
        List of detected regions:
        [
            {
                "label": "blue server icon",
                "box": { "x": 12.5, "y": 34.2, "width": 8.1, "height": 11.7 },
                "confidence": 0.87
            },
            ...
        ]
        Coordinates are normalized 0-100%.
    """
    if _model is None or _processor is None:
        raise RuntimeError("Model not loaded. Call load_model() first.")

    # Grounding DINO expects a single text string with prompts separated by " . "
    text = " . ".join(prompts) + " ."

    inputs = _processor(images=image, text=text, return_tensors="pt").to(_device)

    with torch.no_grad():
        outputs = _model(**inputs)

    # Post-process: convert model outputs to normalized bounding boxes
    results = _processor.post_process_grounded_object_detection(
        outputs,
        inputs.input_ids,
        box_threshold=box_threshold,
        text_threshold=text_threshold,
        target_sizes=[image.size[::-1]],  # (height, width)
    )

    detections = results[0]
    regions = []

    w, h = image.size

    for box, label, score in zip(
        detections["boxes"], detections["labels"], detections["scores"]
    ):
        x1, y1, x2, y2 = box.tolist()
        regions.append({
            "label": label,
            "box": {
                "x": round((x1 / w) * 100, 2),
                "y": round((y1 / h) * 100, 2),
                "width": round(((x2 - x1) / w) * 100, 2),
                "height": round(((y2 - y1) / h) * 100, 2),
            },
            "confidence": round(score.item(), 4),
        })

    # Sort by confidence descending
    regions.sort(key=lambda r: r["confidence"], reverse=True)
    return regions
```

### 1c. `backend/main.py`

FastAPI application with model lifecycle management.

```python
"""
Grounding DINO REST API for zero-shot object detection.
Run: uvicorn main:app --host 0.0.0.0 --port 8001
"""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import os

from detector import load_model, fetch_image, detect, get_device

# ── Request / Response Models ──────────────────────────────

class DetectRequest(BaseModel):
    image_url: str
    prompts: list[str]
    box_threshold: float = 0.25
    text_threshold: float = 0.20


class BoundingBox(BaseModel):
    x: float
    y: float
    width: float
    height: float


class DetectedRegion(BaseModel):
    label: str
    box: BoundingBox
    confidence: float


class DetectResponse(BaseModel):
    regions: list[DetectedRegion]
    image_width: int
    image_height: int


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    device: str


# ── App Lifecycle ──────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup, clean up on shutdown."""
    device_str = os.getenv("GROUNDING_DINO_DEVICE")
    load_model(device_str)
    yield

app = FastAPI(
    title="Grounding DINO API",
    version="1.0.0",
    lifespan=lifespan,
)


# ── Endpoints ──────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        model_loaded=True,
        device=str(get_device()),
    )


@app.post("/detect", response_model=DetectResponse)
async def detect_objects(req: DetectRequest):
    if not req.prompts:
        raise HTTPException(status_code=400, detail="prompts must not be empty")
    if len(req.prompts) > 20:
        raise HTTPException(status_code=400, detail="Maximum 20 prompts per request")

    try:
        image = await fetch_image(req.image_url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to download image: {e}")

    try:
        regions = detect(
            image,
            req.prompts,
            box_threshold=req.box_threshold,
            text_threshold=req.text_threshold,
        )
    except Exception as e:
        logging.exception("Detection failed")
        raise HTTPException(status_code=500, detail=f"Detection error: {e}")

    return DetectResponse(
        regions=regions,
        image_width=image.size[0],
        image_height=image.size[1],
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
```

### 1d. `backend/Dockerfile`

Multi-stage build for smaller final image. Uses PyTorch CPU image as base (swap for GPU variant on VPS with NVIDIA GPU).

```dockerfile
# ── CPU-only base (for local dev / CPU VPS) ──
FROM python:3.11-slim-bookworm

WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY main.py detector.py ./

# Hugging Face cache dir (persist across rebuilds via volume)
ENV HF_HOME=/app/.cache/huggingface
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface

EXPOSE 8001

# Pre-download the model at build time (optional — speeds up first run)
# RUN python -c "from detector import load_model; load_model()"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
```

> **GPU variant:** Replace the base image with `pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime` and remove the `libgl1` system deps.

### 1e. `backend/docker-compose.yml`

```yaml
version: "3.8"

services:
  grounding-dino:
    build: .
    ports:
      - "8001:8001"
    volumes:
      # Persist the HF model cache so it doesn't re-download on rebuild
      - hf_cache:/app/.cache/huggingface
    environment:
      - GROUNDING_DINO_DEVICE=cpu
      # For MPS on macOS host: remove the env var (auto-detects)
      # For CUDA: set GROUNDING_DINO_DEVICE=cuda
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8001/health')"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  hf_cache:
```

### 1f. `backend/.env.example`

```env
# Device override: cpu | cuda | mps
# Leave empty for auto-detection
GROUNDING_DINO_DEVICE=
```

---

## Phase 2 — Frontend: TypeScript Client

### 2a. New file: `src/lib/groundingDinoClient.ts`

HTTP client that calls the Python backend. Includes caching (in-memory map keyed by image URL + prompts) so repeated generation runs don't re-detect.

```typescript
/**
 * Grounding DINO HTTP client.
 * Calls the Python backend at GROUNDING_DINO_URL (default: http://localhost:8001).
 * Results are cached in-memory per imageUrl+prompts hash.
 */

export interface DetectedRegion {
  label: string;
  box: {
    x: number;      // 0-100%, relative to the image
    y: number;
    width: number;
    height: number;
  };
  confidence: number; // 0-1
}

interface DetectResponse {
  regions: DetectedRegion[];
  image_width: number;
  image_height: number;
}

const BASE_URL = process.env.GROUNDING_DINO_URL || "http://localhost:8001";

// In-memory cache: key = `${imageUrl}::${prompts.sort().join(",")}`
const cache = new Map<string, DetectedRegion[]>();

function cacheKey(imageUrl: string, prompts: string[]): string {
  return `${imageUrl}::${[...prompts].sort().join(",")}`;
}

/**
 * Check if the Grounding DINO backend is reachable.
 */
export async function isGroundingDinoAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Run zero-shot object detection on an image.
 *
 * @param imageUrl - Publicly accessible image URL (or data: URI)
 * @param prompts - Text descriptions to search for (e.g., ["blue server", "red arrow"])
 * @param boxThreshold - Minimum confidence for bounding boxes (default: 0.25)
 * @param textThreshold - Minimum confidence for prompt-text matching (default: 0.20)
 * @returns Detected regions sorted by confidence (highest first)
 */
export async function detectRegions(
  imageUrl: string,
  prompts: string[],
  boxThreshold: number = 0.25,
  textThreshold: number = 0.20,
): Promise<DetectedRegion[]> {
  const key = cacheKey(imageUrl, prompts);

  if (cache.has(key)) {
    console.log(`[GroundingDINO] Cache hit for ${prompts.length} prompts`);
    return cache.get(key)!;
  }

  console.log(`[GroundingDINO] Detecting ${prompts.length} prompts on image...`);

  const res = await fetch(`${BASE_URL}/detect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: imageUrl,
      prompts,
      box_threshold: boxThreshold,
      text_threshold: textThreshold,
    }),
    signal: AbortSignal.timeout(60000), // 60s timeout for first run (cold model)
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[GroundingDINO] Detection failed: ${res.status} ${errText}`);
    return [];
  }

  const data: DetectResponse = await res.json();
  cache.set(key, data.regions);

  console.log(
    `[GroundingDINO] Found ${data.regions.length} regions:`,
    data.regions.map((r) => `${r.label} (${r.confidence.toFixed(2)})`).join(", "),
  );

  return data.regions;
}

/**
 * Extract key noun phrases from narration text for use as Grounding DINO prompts.
 * Simple heuristic: extract 2-4 word noun phrases that describe visual objects.
 */
export function extractVisualPhrases(narration: string, maxPhrases: number = 8): string[] {
  // Common patterns for visual objects in explainer narration
  const patterns: RegExp[] = [
    /\b(the|this|that|a|an)\s+((?:\w+\s+){1,3}(?:icon|button|arrow|box|server|node|chart|graph|diagram|cluster|database|cloud|container|switch|router|module|component|layer|section|panel|area|region))\b/gi,
    /\b((?:\w+\s+){0,2}(?:blue|red|green|yellow|orange|purple|dark|light|highlighted|glowing|flashing)\s+(?:\w+\s+){0,2}(?:icon|button|arrow|box|circle|line|bar|dot|marker|label|badge))\b/gi,
  ];

  const phrases = new Set<string>();

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(narration)) !== null) {
      const phrase = (match[2] || match[1] || match[0])
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ");
      if (phrase.length > 3 && phrase.length < 60) {
        phrases.add(phrase);
      }
    }
    pattern.lastIndex = 0; // Reset since we use the same regex in a loop
  }

  return Array.from(phrases).slice(0, maxPhrases);
}
```

---

## Phase 3 — New Types

### 3a. Add to `src/types/storyboard.ts`

Insert these types after the existing `ImageRegion` interface (around line 23):

```typescript
// ── Grounding DINO Detection Types ────────────────────────

/** A sub-region detected on a specific image by Grounding DINO */
export interface DetectedRegion {
  id: string;                    // "region_server_icon"
  label: string;                 // "blue server icon"
  boundingBox: {
    x: number;    // 0-100%, relative to the IMAGE element (not canvas)
    y: number;
    width: number;
    height: number;
  };
  confidence: number;            // 0-1
}

/** A timed focus event: at time T, highlight region R on element E */
export interface RegionFocusEvent {
  regionId: string;
  elementId: string;             // CanvasElement.id of the image this region belongs to
  startSeconds: number;          // When to start the highlight
  endSeconds: number;            // When to stop the highlight
  label: string;                 // Display label
  pointerEnabled: boolean;       // Whether to show the moving pointer for this event
  transition: 'instant' | 'smooth'; // Pointer movement style between regions
}
```

Then extend `StoryboardScene` (around line 101) to include the new field:

```typescript
export interface StoryboardScene {
  sceneNumber: number;
  narration: string;
  duration: number;
  layout: { /* ... existing ... */ };
  syncHints: SyncHint[];
  regionFocusEvents?: RegionFocusEvent[];  // ◀ NEW
}
```

Also extend `SyncHint.triggerAction` union (line 85) to include:

```typescript
export type TriggerAction =
  | 'reveal'
  | 'highlight_off'
  | 'highlight_on'
  | 'focus_zoom'
  | 'focus_region';  // ◀ NEW
```

And update the Zod schemas accordingly (add `regionFocusEventSchema`, `detectedRegionSchema`, add to `storyboardSceneSchema`).

---

## Phase 4 — Region-to-Narration Sync Engine

### 4a. New file: `src/lib/regionSync.ts`

This module takes detected regions + narration + word timestamps and produces `RegionFocusEvent[]`.

```typescript
/**
 * Region-to-Narration Sync Engine.
 *
 * For each scene with an image:
 * 1. Extract key visual phrases from the narration
 * 2. Run Grounding DINO to detect those regions on the scene image
 * 3. Match detected regions to narration phrases using fuzzy matching
 * 4. Compute start/end times from ElevenLabs word timestamps
 * 5. Return RegionFocusEvent[] for rendering
 */

import {
  WordTimestamp,
  StoryboardScene,
  CanvasElement,
  RegionFocusEvent,
  DetectedRegion,
} from "../types/storyboard";
import { detectRegions, extractVisualPhrases, isGroundingDinoAvailable } from "./groundingDinoClient";

/**
 * Simple fuzzy match: checks if the region label appears (or nearly appears)
 * as a substring of the narration text.
 */
function fuzzyMatchLabelInText(label: string, text: string): boolean {
  const cleanLabel = label.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const cleanText = text.toLowerCase().replace(/[^a-z0-9\s]/g, "");

  if (cleanText.includes(cleanLabel)) return true;

  // Check if individual words from the label appear closely together in text
  const labelWords = cleanLabel.split(/\s+/).filter((w) => w.length > 2);
  if (labelWords.length >= 2) {
    const matchCount = labelWords.filter((w) => cleanText.includes(w)).length;
    return matchCount >= labelWords.length * 0.6; // 60% word overlap
  }

  return false;
}

/**
 * Find the timestamp range where a phrase is spoken in narration.
 * Returns [startSeconds, endSeconds] or null if not found.
 */
function findPhraseTimeWindow(
  phrase: string,
  timestamps: WordTimestamp[],
): [number, number] | null {
  const phraseWords = phrase.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/);
  if (phraseWords.length === 0) return null;

  // Sliding window search
  for (let i = 0; i <= timestamps.length - phraseWords.length; i++) {
    let matchCount = 0;
    for (let j = 0; j < phraseWords.length; j++) {
      const tw = timestamps[i + j].word.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (tw === phraseWords[j] || tw.includes(phraseWords[j]) || phraseWords[j].includes(tw)) {
        matchCount++;
      }
    }
    if (matchCount >= phraseWords.length * 0.6) {
      const start = timestamps[i].start;
      const end = timestamps[i + phraseWords.length - 1]?.end || timestamps[i].end;
      return [start, end];
    }
  }

  return null;
}

/**
 * Main function: generates RegionFocusEvent[] for a scene.
 *
 * @param scene - The storyboard scene with narration and elements
 * @param wordTimestamps - ElevenLabs word-level timestamps for this scene (relative to scene start)
 * @param imageUrl - Resolved URL of the scene's primary image
 * @returns Array of timed region focus events
 */
export async function generateRegionFocusEvents(
  scene: StoryboardScene,
  wordTimestamps: WordTimestamp[],
  imageUrl?: string,
): Promise<RegionFocusEvent[]> {
  // Find the primary image element in this scene
  const imageElement: CanvasElement | undefined = scene.layout?.elements?.find(
    (el) => el.type === "image",
  );

  if (!imageElement || !imageUrl) {
    return [];
  }

  // Check if backend is available; skip gracefully if not
  const backendAvailable = await isGroundingDinoAvailable();
  if (!backendAvailable) {
    console.warn("[RegionSync] Grounding DINO backend unavailable. Skipping region detection.");
    return [];
  }

  // 1. Extract visual phrases from the narration
  const visualPhrases = extractVisualPhrases(scene.narration, 8);
  if (visualPhrases.length === 0) {
    return [];
  }

  console.log(
    `[RegionSync] Scene ${scene.sceneNumber}: extracted phrases:`,
    visualPhrases,
  );

  // 2. Run Grounding DINO detection
  const detectedRegions = await detectRegions(imageUrl, visualPhrases, 0.20, 0.18);

  if (detectedRegions.length === 0) {
    console.log(`[RegionSync] Scene ${scene.sceneNumber}: no regions detected.`);
    return [];
  }

  // 3. Match detected regions to narration phrases → compute time windows
  const events: RegionFocusEvent[] = [];
  let regionIdx = 0;

  for (const region of detectedRegions) {
    // Check if this region's label is referenced in the narration
    if (!fuzzyMatchLabelInText(region.label, scene.narration)) {
      continue;
    }

    const timeWindow = findPhraseTimeWindow(region.label, wordTimestamps);

    if (timeWindow) {
      events.push({
        regionId: `region_${scene.sceneNumber}_${regionIdx}`,
        elementId: imageElement.id,
        startSeconds: timeWindow[0],
        endSeconds: timeWindow[1],
        label: region.label,
        pointerEnabled: true,
        transition: regionIdx === 0 ? "instant" : "smooth",
      });
      regionIdx++;
    }
  }

  // Sort by start time
  events.sort((a, b) => a.startSeconds - b.startSeconds);

  // Extend each event's end time to the start of the next event (or narration end)
  for (let i = 0; i < events.length; i++) {
    if (i < events.length - 1) {
      events[i].endSeconds = Math.min(
        events[i].endSeconds + 1.5, // Add a small buffer
        events[i + 1].startSeconds - 0.1, // Don't overlap next event
      );
    }
  }

  console.log(
    `[RegionSync] Scene ${scene.sceneNumber}: generated ${events.length} events:`,
    events.map((e) => `${e.label} [${e.startSeconds.toFixed(1)}s-${e.endSeconds.toFixed(1)}s]`),
  );

  return events;
}
```

---

## Phase 5 — Implement VectorAnnotation Component

### 5a. Replace `src/compositions/storyteller/VectorAnnotation.tsx`

Currently a stub that returns `null`. Replace with:

```tsx
import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

interface VectorAnnotationProps {
  /** Bounding box relative to parent (0-100%) */
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Whether the annotation is currently active */
  active: boolean;
  /** Visual style */
  style?: "glow" | "border" | "spotlight";
  /** Optional label shown above the box */
  label?: string;
  /** Fade duration in frames */
  fadeFrames?: number;
}

export const VectorAnnotation: React.FC<VectorAnnotationProps> = ({
  boundingBox,
  active,
  style = "glow",
  label,
  fadeFrames = 12,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Pulsing opacity for glow effect
  const pulse = interpolate(
    Math.sin((frame / fps) * Math.PI * 2), // 2Hz pulse
    [-1, 1],
    [0.6, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  if (!active) return null;

  if (style === "spotlight") {
    return (
      <>
        {/* Dim overlay covering the entire image */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.55)",
            zIndex: 20,
            pointerEvents: "none",
            // Cut out the spotlight region using a box-shadow trick
            boxShadow: `0 0 0 9999px rgba(15, 23, 42, 0.55)`,
            clipPath: `polygon(
              0% 0%, 0% 100%,
              ${boundingBox.x}% 100%,
              ${boundingBox.x}% ${boundingBox.y}%,
              ${boundingBox.x + boundingBox.width}% ${boundingBox.y}%,
              ${boundingBox.x + boundingBox.width}% ${boundingBox.y + boundingBox.height}%,
              ${boundingBox.x}% ${boundingBox.y + boundingBox.height}%,
              ${boundingBox.x}% 100%,
              100% 100%, 100% 0%
            )`,
          }}
        />
        {/* Bright border around the spotlight region */}
        <div
          style={{
            position: "absolute",
            left: `${boundingBox.x}%`,
            top: `${boundingBox.y}%`,
            width: `${boundingBox.width}%`,
            height: `${boundingBox.height}%`,
            border: "3px solid #3b82f6",
            borderRadius: 8,
            boxShadow: `0 0 24px rgba(59, 130, 246, ${0.5 * pulse})`,
            zIndex: 21,
            pointerEvents: "none",
          }}
        />
      </>
    );
  }

  if (style === "border") {
    return (
      <div
        style={{
          position: "absolute",
          left: `${boundingBox.x}%`,
          top: `${boundingBox.y}%`,
          width: `${boundingBox.width}%`,
          height: `${boundingBox.height}%`,
          border: "3px dashed #f59e0b",
          borderRadius: 8,
          boxShadow: `0 0 16px rgba(245, 158, 11, ${0.4 * pulse})`,
          zIndex: 20,
          pointerEvents: "none",
        }}
      >
        {label && (
          <span
            style={{
              position: "absolute",
              top: -22,
              left: 4,
              backgroundColor: "#f59e0b",
              color: "#0f172a",
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 4,
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </span>
        )}
      </div>
    );
  }

  // Default: "glow" style
  return (
    <div
      style={{
        position: "absolute",
        left: `${boundingBox.x}%`,
        top: `${boundingBox.y}%`,
        width: `${boundingBox.width}%`,
        height: `${boundingBox.height}%`,
        border: "2.5px solid #3b82f6",
        borderRadius: 10,
        backgroundColor: `rgba(59, 130, 246, ${0.08 * pulse})`,
        boxShadow: `
          0 0 20px rgba(59, 130, 246, ${0.4 * pulse}),
          inset 0 0 12px rgba(59, 130, 246, ${0.1 * pulse})
        `,
        zIndex: 20,
        pointerEvents: "none",
      }}
    >
      {label && (
        <span
          style={{
            position: "absolute",
            top: -24,
            left: 4,
            backgroundColor: "#3b82f6",
            color: "#ffffff",
            fontSize: 11,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 4,
            whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(59, 130, 246, 0.4)",
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
};
```

---

## Phase 6 — Implement PointerLaser Component

### 6a. Replace `src/compositions/storyteller/PointerLaser.tsx`

Currently a stub that returns `null`. Replace with:

```tsx
import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

interface PointerLaserProps {
  /** Current target position relative to parent (0-100%) */
  targetX: number;
  targetY: number;
  /** Previous target position (for smooth transition) */
  prevX?: number;
  prevY?: number;
  /** Whether the pointer is visible */
  active: boolean;
  /** Transition style */
  transition?: "instant" | "smooth";
  /** Transition duration in frames */
  transitionFrames?: number;
}

export const PointerLaser: React.FC<PointerLaserProps> = ({
  targetX,
  targetY,
  prevX = targetX,
  prevY = targetY,
  active,
  transition = "smooth",
  transitionFrames = 15,
}) => {
  const frame = useCurrentFrame();

  if (!active) return null;

  // Interpolate position for smooth movement
  const effectiveFrames = transition === "instant" ? 1 : transitionFrames;
  const progress = Math.min(frame / effectiveFrames, 1);

  const currentX = interpolate(progress, [0, 1], [prevX, targetX], {
    extrapolateRight: "clamp",
  });
  const currentY = interpolate(progress, [0, 1], [prevY, targetY], {
    extrapolateRight: "clamp",
  });

  // Scale pulse on arrival
  const scale = interpolate(
    Math.sin(frame * 0.3) * 0.5 + 0.5,
    [0, 1],
    [0.85, 1.15],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <div
      style={{
        position: "absolute",
        left: `${currentX}%`,
        top: `${currentY}%`,
        transform: `translate(-50%, -50%) scale(${scale})`,
        zIndex: 30,
        pointerEvents: "none",
      }}
    >
      {/* Outer glow ring */}
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          backgroundColor: "rgba(59, 130, 246, 0.15)",
          border: "2px solid rgba(59, 130, 246, 0.4)",
          boxShadow: "0 0 18px rgba(59, 130, 246, 0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          animation: "none",
        }}
      >
        {/* Inner white dot */}
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: "#ffffff",
            boxShadow: "0 0 6px rgba(59, 130, 246, 0.8)",
          }}
        />
      </div>
    </div>
  );
};
```

---

## Phase 7 — Wire into ElementRenderer

### 7a. Modify `src/compositions/storyteller/ElementRenderer.tsx`

In the image rendering branch (around line 243, inside the `if (element.type === 'image')` block), add the annotation + pointer layers as children of the image container `div`.

**Before** the closing `</div>` of the image container (currently line 297), insert:

```tsx
{/* Region-level annotations (Grounding DINO) */}
{sceneRegionEvents && sceneRegionEvents.length > 0 && (() => {
  // sceneRegionEvents must be passed down. See Phase 8 for the prop.
  // Find the active region for this frame
  const currentTimeSec = currentTimeMs / 1000;
  const activeEvent = sceneRegionEvents.find(
    (ev) =>
      ev.elementId === element.id &&
      currentTimeSec >= ev.startSeconds &&
      currentTimeSec <= ev.endSeconds
  );

  if (!activeEvent) {
    // No active region — hide annotations
    return null;
  }

  // Find the detected region data for this event
  const detectedRegion = sceneDetectedRegions?.find(
    (r) => r.id === activeEvent.regionId
  );

  if (!detectedRegion) return null;

  // Find previous event for pointer transition
  const eventIndex = sceneRegionEvents.indexOf(activeEvent);
  const prevEvent = eventIndex > 0 ? sceneRegionEvents[eventIndex - 1] : null;
  const prevRegion = prevEvent
    ? sceneDetectedRegions?.find((r) => r.id === prevEvent.regionId)
    : null;

  return (
    <>
      <VectorAnnotation
        boundingBox={detectedRegion.boundingBox}
        active={true}
        style="glow"
        label={activeEvent.label}
      />
      {activeEvent.pointerEnabled && (
        <PointerLaser
          targetX={
            detectedRegion.boundingBox.x +
            detectedRegion.boundingBox.width / 2
          }
          targetY={
            detectedRegion.boundingBox.y +
            detectedRegion.boundingBox.height / 2
          }
          prevX={
            prevRegion
              ? prevRegion.boundingBox.x + prevRegion.boundingBox.width / 2
              : undefined
          }
          prevY={
            prevRegion
              ? prevRegion.boundingBox.y + prevRegion.boundingBox.height / 2
              : undefined
          }
          active={true}
          transition={activeEvent.transition}
        />
      )}
    </>
  );
})()}
```

The `ElementRenderer` will need two new optional props: `sceneRegionEvents?: RegionFocusEvent[]` and `sceneDetectedRegions?: DetectedRegion[]`. These are passed down from `SceneCanvas` → `ElementRenderer`.

---

## Phase 8 — Pipeline Orchestration

### 8a. Modify the generation pipeline

The region detection + sync must run **after** storyboard generation and TTS, but **before** the manifest is saved/serialized.

The integration point is in the pipeline orchestrator (currently `src/generateStoryFromUrl.ts` or `src/lib/contextEngine.ts`). After `generateStoryboardFromArticle()` and `synthesizePerSceneSpeech()`, but before rendering:

```typescript
// ── After storyboard + TTS are generated ──

import { generateRegionFocusEvents } from "./regionSync";
import { isGroundingDinoAvailable } from "./groundingDinoClient";

// Check if the backend is available
const dinoAvailable = await isGroundingDinoAvailable();

if (dinoAvailable) {
  console.log("[Pipeline] Grounding DINO backend detected. Running region detection...");

  for (let i = 0; i < manifest.scenes.length; i++) {
    const scene = manifest.scenes[i];
    const audio = sceneAudio.find((sa) => sa.sceneNumber === scene.sceneNumber);

    // Find the primary image element and resolve its URL
    const imageElement = scene.layout?.elements?.find((el) => el.type === "image");
    const imageUrl = imageElement?.sourceAssetId
      ? resolveAssetUrl(imageElement.sourceAssetId) // You'll need to implement this
      : undefined;

    if (imageUrl && audio?.wordTimestamps) {
      const events = await generateRegionFocusEvents(
        scene,
        audio.wordTimestamps,
        imageUrl,
      );
      scene.regionFocusEvents = events;
    }
  }
} else {
  console.log("[Pipeline] Grounding DINO backend not available. Skipping region detection.");
}
```

### 8b. Pass region data through to the renderer

In `SceneCanvas.tsx`, pass the region events down to `ElementRenderer`:

```tsx
{sortedElements.map((element) => (
  <ElementRenderer
    key={element.id}
    element={element}
    allSceneElements={sortedElements}
    currentTimeMs={currentTimeMs}
    fps={fps}
    sceneRegionEvents={scene.regionFocusEvents}     // ◀ NEW
    sceneDetectedRegions={scene.detectedRegions}     // ◀ NEW
  />
))}
```

---

## Testing & Verification

### Backend (local)

```bash
# Terminal 1: Start the backend
cd backend
docker compose up --build
# First run downloads the model (~700MB). Wait for "Model loaded successfully."

# Terminal 2: Test the health endpoint
curl http://localhost:8001/health
# → {"status":"ok","model_loaded":true,"device":"cpu"}

# Test detection
curl -X POST http://localhost:8001/detect \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://picsum.photos/800/600",
    "prompts": ["person", "building", "tree"],
    "box_threshold": 0.2,
    "text_threshold": 0.15
  }'
# → {"regions": [...], "image_width": 800, "image_height": 600}
```

### Frontend (manual test)

```bash
# In the Remotion project root:
npx tsx -e "
import { detectRegions, extractVisualPhrases, isGroundingDinoAvailable } from './src/lib/groundingDinoClient';

(async () => {
  const available = await isGroundingDinoAvailable();
  console.log('Backend available:', available);

  if (available) {
    const regions = await detectRegions(
      'https://picsum.photos/800/600',
      ['person', 'building']
    );
    console.log('Regions:', JSON.stringify(regions, null, 2));
  }

  const phrases = extractVisualPhrases(
    'Look at the blue server icon on the left. The red arrow points to the database cluster.'
  );
  console.log('Extracted phrases:', phrases);
})();
"
```

### Full pipeline test

1. Start the Grounding DINO backend (`docker compose up`)
2. Run the story generation with a test URL:
   ```bash
   npx tsx src/generateStoryFromUrl.ts --url "https://example.com/tech-article"
   ```
3. Check the generated manifest JSON for `regionFocusEvents` on scenes
4. Open Remotion Studio and verify annotations appear on images during playback

---

## VPS Deployment

### Option A: Single VPS (simplest)

On a VPS with at least 8GB RAM and Docker installed:

```bash
# Clone the repo
git clone <repo-url> /opt/remotion-pipeline
cd /opt/remotion-pipeline/backend

# Build and start
docker compose -f docker-compose.yml up -d --build

# Verify
curl http://localhost:8001/health
```

For the TypeScript pipeline to reach the backend, set the environment variable:
```bash
export GROUNDING_DINO_URL=http://localhost:8001
```

Or if the pipeline runs on a different machine:
```bash
export GROUNDING_DINO_URL=http://<vps-ip>:8001
```

### Option B: GPU VPS (for production throughput)

Use a cloud GPU instance (e.g., Lambda Labs, RunPod, or AWS g4dn.xlarge):

1. Provision an instance with NVIDIA GPU + Docker + nvidia-container-toolkit
2. Switch the Dockerfile base image to the GPU variant:
   ```dockerfile
   FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime
   ```
3. In `docker-compose.yml`, add GPU access:
   ```yaml
   services:
     grounding-dino:
       deploy:
         resources:
           reservations:
             devices:
               - driver: nvidia
                 count: 1
                 capabilities: [gpu]
   ```
4. Set `GROUNDING_DINO_DEVICE=cuda` in the environment

GPU inference is ~10-20x faster than CPU. A single detection request goes from ~3-5s (CPU) to ~150-300ms (GPU).

### Option C: Serverless (future)

For a fully serverless approach, the model can be hosted on:
- **Hugging Face Inference Endpoints** — managed GPU hosting, pay-per-use
- **Replicate** — simplest, but not self-hosted

These can be swapped in by changing the `groundingDinoClient.ts` to call a different endpoint. The REST API contract (`POST /detect` → `{ regions[] }`) is the same.

---

## Appendix: How Grounding DINO Works

**Grounding DINO** is a zero-shot object detection model. Unlike traditional detectors (which can only find classes they were trained on, like "person", "car", "dog"), Grounding DINO can find **anything you describe in natural language**.

### How it works

```
Input:  Image + Text prompt ("blue server icon")
         ↓
1. Image encoder (DINOv2/Swin Transformer) → visual features
2. Text encoder (BERT) → text features
3. Cross-modal fusion → find regions where visual + text features align
4. Output: Bounding boxes + confidence scores

Key difference from traditional OD:
  Traditional:  Can only detect "person", "car", "dog" (trained classes)
  Grounding DINO: Can detect "blue server icon", "red arrow pointing left",
                  "database cylinder with green label" (any text description)
```

### Prompt engineering tips

Grounding DINO works best with **short, specific, visual descriptions**:

| Good prompts | Bad prompts |
|---|---|
| `"blue server icon"` | `"the icon that represents the server which is colored blue"` |
| `"red arrow"` | `"an arrow that is pointing to something important"` |
| `"database cylinder"` | `"the cylindrical shape that stores data"` |
| `"green checkmark"` | `"a symbol indicating success or completion"` |

- Use 2-4 word phrases
- Include color when relevant
- Be specific about shape/type (icon, arrow, button, box, circle)
- Separate multiple prompts with `" . "` (the model expects this delimiter)

### Confidence thresholds

- `box_threshold` (default: 0.25): Minimum confidence for a bounding box. Lower = more boxes (including false positives).
- `text_threshold` (default: 0.20): Minimum confidence for text-prompt matching. Lower = more matches (including incorrect ones).

For explainer videos with annotated diagrams, we recommend:
- `box_threshold: 0.20` — slightly lower to catch smaller elements
- `text_threshold: 0.18` — slightly lower since our prompts are very specific

---

## Summary of All Files

| File | Action | Phase |
|---|---|---|
| `backend/main.py` | **New** — FastAPI app | 1 |
| `backend/detector.py` | **New** — Model wrapper | 1 |
| `backend/requirements.txt` | **New** — Python deps | 1 |
| `backend/Dockerfile` | **New** — Docker build | 1 |
| `backend/docker-compose.yml` | **New** — Dev/prod compose | 1 |
| `backend/.env.example` | **New** — Env template | 1 |
| `src/lib/groundingDinoClient.ts` | **New** — TypeScript HTTP client | 2 |
| `src/types/storyboard.ts` | **Edit** — Add new types + extend scene | 3 |
| `src/lib/regionSync.ts` | **New** — Narration→region sync engine | 4 |
| `src/compositions/storyteller/VectorAnnotation.tsx` | **Replace stub** — Glowing region overlay | 5 |
| `src/compositions/storyteller/PointerLaser.tsx` | **Replace stub** — Animated pointer dot | 6 |
| `src/compositions/storyteller/ElementRenderer.tsx` | **Edit** — Wire annotations into image render | 7 |
| `src/compositions/storyteller/SceneCanvas.tsx` | **Edit** — Pass region data down | 7 |
| `src/generateStoryFromUrl.ts` | **Edit** — Call region sync in pipeline | 8 |

---

## Estimated Effort

| Phase | Effort | Risk |
|---|---|---|
| 1 — Backend | 1-2 days | Low (standard FastAPI + transformers) |
| 2 — TS Client | 0.5 day | Low (simple HTTP + cache) |
| 3 — Types | 0.5 day | Low (existing patterns) |
| 4 — Region Sync | 1 day | Medium (fuzzy matching tuning) |
| 5 — VectorAnnotation | 0.5 day | Low (CSS/Rect component) |
| 6 — PointerLaser | 0.5 day | Low (interpolate animation) |
| 7 — Wiring | 0.5 day | Low (prop drilling) |
| 8 — Pipeline | 0.5 day | Low (function call insertion) |
| **Total** | **~5-6 days** | |
