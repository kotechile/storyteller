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

from detector import load_model, fetch_image, detect, get_device, extract_text_ocr

# ── Request / Response Models ──────────────────────────────

class DetectRequest(BaseModel):
    image_url: str
    prompts: list[str]
    labels: Optional[list[str]] = None
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
    matched_label: Optional[str] = None


class DetectResponse(BaseModel):
    regions: list[DetectedRegion]
    image_width: int
    image_height: int


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    device: str


class OcrRequest(BaseModel):
    image_url: str


class OcrTextRegion(BaseModel):
    text: str
    x: float
    y: float
    width: float
    height: float


class OcrResponse(BaseModel):
    regions: list[OcrTextRegion]
    image_width: int
    image_height: int


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
            labels=req.labels,
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


@app.post("/ocr", response_model=OcrResponse)
async def ocr_image(req: OcrRequest):
    """Extract all visible text from an image with bounding boxes."""
    try:
        image = await fetch_image(req.image_url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to download image: {e}")

    regions = extract_text_ocr(image)

    return OcrResponse(
        regions=regions,
        image_width=image.size[0],
        image_height=image.size[1],
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
