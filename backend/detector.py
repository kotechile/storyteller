"""
Grounding DINO zero-shot object detector.
Loads the model once at startup; provides a detect() function for inference.
"""
import torch
from PIL import Image
from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
import io
import base64
import httpx
from typing import Optional

# Model ID on Hugging Face
MODEL_ID = "IDEA-Research/grounding-dino-base"

# Global model instance (loaded once at startup)
_processor: Optional[AutoProcessor] = None
_model: Optional[AutoModelForZeroShotObjectDetection] = None
_device: Optional[torch.device] = None
_easyocr_reader = None  # lazy-init in extract_text_ocr


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

    # Pre-load EasyOCR (downloads models on first use)
    global _easyocr_reader
    try:
        import easyocr
        _easyocr_reader = easyocr.Reader(['en'], gpu=False)
        print(f"[detector] EasyOCR reader initialized.")
    except Exception as e:
        print(f"[detector] EasyOCR init skipped: {e}")

    print(f"[detector] Model loaded successfully.")
    return _processor, _model, _device


async def fetch_image(url: str) -> Image.Image:
    """Download an image from a URL or parse a data URI into a PIL Image."""
    if url.startswith("data:"):
        # Handle data URI (e.g. data:image/png;base64,...)
        header, encoded = url.split(",", 1)
        image_data = base64.b64decode(encoded)
        return Image.open(io.BytesIO(image_data)).convert("RGB")

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return Image.open(io.BytesIO(resp.content)).convert("RGB")


def detect(
    image: Image.Image,
    prompts: list[str],
    labels: Optional[list[str]] = None,
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

    regions = []

    if prompts and len(prompts) > 0:
        # Grounding DINO expects a single text string with prompts separated by " . "
        text = " . ".join(prompts) + " ."

        inputs = _processor(images=image, text=text, return_tensors="pt").to(_device)

        with torch.no_grad():
            outputs = _model(**inputs)

        # Post-process: convert model outputs to normalized bounding boxes
        results = _processor.post_process_grounded_object_detection(
            outputs,
            inputs.input_ids,
            threshold=box_threshold,
            text_threshold=text_threshold,
            target_sizes=[image.size[::-1]],  # (height, width)
        )

        detections = results[0]
        w, h = image.size

        for box, label, score in zip(
            detections["boxes"], detections["labels"], detections["scores"]
        ):
            x1, y1, x2, y2 = box.tolist()
            box_w_pct = ((x2 - x1) / w) * 100
            box_h_pct = ((y2 - y1) / h) * 100

            # ── DINO quality filters ──
            label_words = [w for w in label.lower().split() if len(w) > 2]
            if len(label_words) < 2:
                continue
            if box_w_pct < 4 or box_h_pct < 4 or box_w_pct > 80 or box_h_pct > 80:
                continue

            regions.append({
                "label": label,
                "box": {
                    "x": round((x1 / w) * 100, 2),
                    "y": round((y1 / h) * 100, 2),
                    "width": round(box_w_pct, 2),
                    "height": round(box_h_pct, 2),
                },
                "confidence": round(score.item(), 4),
            })

    w, h = image.size

    def _clean_prompt(p: str) -> str:
        """Remove position modifiers like 'text top', 'text center' from prompts."""
        import re
        return re.sub(r'\s*text\s+(top|bottom|left|right|center|middle)\s*', ' ', p, flags=re.IGNORECASE).strip()

    # ── OCR: match clean keywords against OCR text regions ──
    try:
        ocr_regions = extract_text_ocr(image)
        match_targets = labels if labels else prompts

        if not match_targets:
            # Return all extracted EasyOCR text regions directly when no target labels are supplied
            for ocr_item in ocr_regions:
                regions.append({
                    "label": ocr_item["text"],
                    "box": {
                        "x": ocr_item["x"],
                        "y": ocr_item["y"],
                        "width": ocr_item["width"],
                        "height": ocr_item["height"],
                    },
                    "confidence": 0.98,
                    "matched_label": ocr_item["text"],
                })
        else:
            import re
            matched_ocr_texts = set()
            for idx, target in enumerate(match_targets):
                # Clean position hints like " text top left" or " text center" from prompt string
                raw_target = re.sub(r'\s+text\s+(top|bottom|left|right|center|middle|\s+)+$', '', target, flags=re.IGNORECASE).strip()
                target_clean = re.sub(r'[^a-z0-9\s]', '', raw_target.lower()).strip()
                target_words = [w for w in target_clean.split() if len(w) > 1]
                if not target_words:
                    continue

                matching_ocrs = []
                for ocr_item in ocr_regions:
                    ocr_raw = ocr_item["text"].strip()
                    ocr_clean = re.sub(r'[^a-z0-9\s]', '', ocr_raw.lower()).strip()
                    ocr_words = set(ocr_clean.split())
                    
                    if target_clean in ocr_clean or ocr_clean in target_clean:
                        matching_ocrs.append((100 + len(target_clean), ocr_item))
                    else:
                        matched_words = [tw for tw in target_words if any(tw == rw or tw in rw or rw in tw for rw in ocr_words)]
                        if matched_words:
                            matching_ocrs.append((len(matched_words) * 10, ocr_item))

                if matching_ocrs:
                    # Sort by match strength
                    matching_ocrs.sort(key=lambda x: x[0], reverse=True)
                    top_score = matching_ocrs[0][0]
                    # Select all OCR blocks that significantly contribute to the target label
                    selected_ocrs = [item[1] for item in matching_ocrs if item[0] >= max(10, top_score * 0.5)]

                    # If multiple blocks are horizontally adjacent/close (same title line), union their bounding boxes
                    primary_y = selected_ocrs[0]["y"]
                    primary_h = selected_ocrs[0]["height"]
                    aligned_ocrs = [
                        o for o in selected_ocrs
                        if abs(o["y"] - primary_y) <= max(3.0, primary_h * 0.8)
                    ]

                    for o in aligned_ocrs:
                        matched_ocr_texts.add(o["text"].lower())

                    # Calculate union box over all aligned matching blocks
                    min_x = min(o["x"] for o in aligned_ocrs)
                    min_y = min(o["y"] for o in aligned_ocrs)
                    max_x = max(o["x"] + o["width"] for o in aligned_ocrs)
                    max_y = max(o["y"] + o["height"] for o in aligned_ocrs)

                    union_w = max_x - min_x
                    union_h = max_y - min_y

                    # Snug padding (6% horizontal, 6% vertical, min 0.5%) to tightly enclose text without excessive white space or clipping text
                    pad_w = max(0.5, union_w * 0.06)
                    pad_h = max(0.5, union_h * 0.06)

                    box_x = max(0.0, min_x - pad_w)
                    box_y = max(0.0, min_y - pad_h)
                    box_w = min(100.0 - box_x, union_w + pad_w * 2)
                    box_h = min(100.0 - box_y, union_h + pad_h * 2)

                    display_label = labels[idx] if (labels and idx < len(labels)) else raw_target
                    regions.append({
                        "label": display_label,
                        "box": {
                            "x": round(box_x, 2),
                            "y": round(box_y, 2),
                            "width": round(box_w, 2),
                            "height": round(box_h, 2),
                        },
                        "confidence": 0.98,
                        "matched_label": display_label,
                    })

            # Always include unmatched OCR text as fallback so no visible text is missed
            for ocr_item in ocr_regions:
                ocr_text_lower = ocr_item["text"].lower().strip()
                if ocr_text_lower not in matched_ocr_texts and len(ocr_item["text"].split()) >= 2:
                    regions.append({
                        "label": ocr_item["text"],
                        "box": {
                            "x": ocr_item["x"],
                            "y": ocr_item["y"],
                            "width": ocr_item["width"],
                            "height": ocr_item["height"],
                        },
                        "confidence": 0.98,
                        "matched_label": ocr_item["text"],
                    })
    except Exception as e:
        print(f"[detector] OCR matching skipped/failed: {e}")

    # Deduplicate regions with exact same labels only
    unique_regions: list = []
    for r in regions:
        duplicate = False
        for ur in unique_regions:
            if r['label'].lower() == ur['label'].lower():
                duplicate = True
                break
        if not duplicate:
            unique_regions.append(r)

    unique_regions.sort(key=lambda r: r["confidence"], reverse=True)
    return unique_regions[:10]


def extract_text_ocr(image: Image.Image) -> list[dict]:
    """
    Extract ALL visible text from an image using EasyOCR.
    Returns individual text regions with accurate bounding boxes.
    EasyOCR handles multi-column layouts much better than Tesseract.
    """
    try:
        import easyocr
    except ImportError:
        return _extract_text_tesseract(image)

    w, h = image.size

    # Lazy-init EasyOCR reader (cached globally)
    global _easyocr_reader
    if _easyocr_reader is None:
        _easyocr_reader = easyocr.Reader(['en'], gpu=False)

    try:
        import numpy as np
        img_np = np.array(image.convert("RGB"))
        results = _easyocr_reader.readtext(
            img_np,
            detail=1,
            paragraph=False,
            width_ths=0.7,   # Individual word detection (was 0.2 - too aggressive merging)
            height_ths=0.7,  # Individual word detection (was 0.2)
            min_size=5,       # Skip tiny artifacts
        )
    except Exception as e:
        print(f"[detector] EasyOCR failed, falling back to Tesseract: {e}")
        return _extract_text_tesseract(image)

    regions = []
    raw_blocks = []
    for bbox, text, conf in results:
        clean_t = text.strip()
        if conf < 0.15 or len(clean_t) < 2:
            continue
        x1 = min(p[0] for p in bbox)
        y1 = min(p[1] for p in bbox)
        x2 = max(p[0] for p in bbox)
        y2 = max(p[1] for p in bbox)
        raw_blocks.append({
            "text": clean_t,
            "x1": x1, "y1": y1, "x2": x2, "y2": y2,
            "w": x2 - x1, "h": y2 - y1,
        })

    # Post-process: Merge vertically stacked text rows (e.g. "LICENSED" stacked directly above "ACCOUNTABILITY")
    merged_indices = set()
    final_blocks = []

    for i in range(len(raw_blocks)):
        if i in merged_indices:
            continue
        b1 = raw_blocks[i]
        merged_with = [b1]

        for j in range(i + 1, len(raw_blocks)):
            if j in merged_indices:
                continue
            b2 = raw_blocks[j]

            # Check if b1 and b2 are two adjacent lines of the SAME stacked text label
            x_overlap = max(0, min(b1["x2"], b2["x2"]) - max(b1["x1"], b2["x1"]))
            min_w = min(b1["w"], b2["w"])
            # Require at least 60% horizontal overlap (column-aligned)
            has_x_overlap = (x_overlap / max(1.0, min_w)) >= 0.6

            # Require immediate adjacent line gap (vertical distance < 1.2x line height)
            vert_gap = max(0, max(b2["y1"] - b1["y2"], b1["y1"] - b2["y2"]))
            vert_close = vert_gap <= (max(b1["h"], b2["h"]) * 1.2)

            if has_x_overlap and vert_close:
                merged_with.append(b2)
                merged_indices.add(j)

        if len(merged_with) > 1:
            # Sort top to bottom
            merged_with.sort(key=lambda b: b["y1"])
            combined_text = " ".join(b["text"] for b in merged_with)
            mx1 = min(b["x1"] for b in merged_with)
            my1 = min(b["y1"] for b in merged_with)
            mx2 = max(b["x2"] for b in merged_with)
            my2 = max(b["y2"] for b in merged_with)
            final_blocks.append({
                "text": combined_text,
                "x1": mx1, "y1": my1, "x2": mx2, "y2": my2
            })
        else:
            final_blocks.append(b1)

    for fb in final_blocks:
        regions.append({
            "text": fb["text"],
            "x": round((max(0, fb["x1"]) / w) * 100, 2),
            "y": round((max(0, fb["y1"]) / h) * 100, 2),
            "width": round(((fb["x2"] - fb["x1"]) / w) * 100, 2),
            "height": round(((fb["y2"] - fb["y1"]) / h) * 100, 2),
        })

    return regions


def _extract_text_tesseract(image: Image.Image) -> list[dict]:
    """Tesseract fallback when EasyOCR is unavailable."""
    try:
        import pytesseract
    except ImportError:
        return []

    w, h = image.size
    ocr_data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)

    # Group words by line
    regions_by_line: dict[int, list[dict]] = {}
    for i in range(len(ocr_data['text'])):
        word = ocr_data['text'][i].strip()
        conf = float(ocr_data['conf'][i])
        if conf > 40 and len(word) > 1:
            line_num = ocr_data['line_num'][i]
            if line_num not in regions_by_line:
                regions_by_line[line_num] = []
            regions_by_line[line_num].append({
                'word': word,
                'x': ocr_data['left'][i],
                'y': ocr_data['top'][i],
                'w': ocr_data['width'][i],
                'h': ocr_data['height'][i],
            })

    # Build text regions: group words on each line, split by large gaps
    regions = []
    for line_num, words in sorted(regions_by_line.items()):
        if len(words) < 1:
            continue
        # Sort words left-to-right
        words.sort(key=lambda w: w['x'])
        # Split into sub-groups when gap > 15% of image width
        gap_threshold = w * 0.15
        groups: list[list[dict]] = []
        current_group = [words[0]]
        for i in range(1, len(words)):
            prev_right = words[i-1]['x'] + words[i-1]['w']
            gap = words[i]['x'] - prev_right
            if gap > gap_threshold:
                groups.append(current_group)
                current_group = [words[i]]
            else:
                current_group.append(words[i])
        groups.append(current_group)

        for group in groups:
            combined_text = " ".join(w['word'] for w in group)
            if len(combined_text) < 2:
                continue
            min_x = min(w['x'] for w in group)
            min_y = min(w['y'] for w in group)
            max_x = max(w['x'] + w['w'] for w in group)
            max_y = max(w['y'] + w['h'] for w in group)
            pad = 4
            regions.append({
                "text": combined_text,
                "x": round((max(0, min_x - pad) / w) * 100, 2),
                "y": round((max(0, min_y - pad) / h) * 100, 2),
                "width": round(((max_x - min_x + pad * 2) / w) * 100, 2),
                "height": round(((max_y - min_y + pad * 2) / h) * 100, 2),
            })

    return regions
