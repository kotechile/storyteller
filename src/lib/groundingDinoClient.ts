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
  matched_label?: string; // which keyword this region corresponds to
}

export interface DetectResult {
  regions: DetectedRegion[];
  imageWidth: number;
  imageHeight: number;
}

interface DetectResponse {
  regions: DetectedRegion[];
  image_width: number;
  image_height: number;
}

const BASE_URL =
  typeof window !== 'undefined'
    ? '/api/dino'
    : process.env.GROUNDING_DINO_URL || 'http://127.0.0.1:8001';

// In-memory cache: key = `${imageUrl}::${prompts.sort().join(",")}`
const cache = new Map<string, DetectResult>();

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
  boxThreshold: number = 0.15,
  textThreshold: number = 0.15,
  labels?: string[],
): Promise<DetectResult> {
  const key = cacheKey(imageUrl, prompts);

  if (cache.has(key)) {
    console.log(`[GroundingDINO] Cache hit for ${prompts.length} prompts`);
    return cache.get(key)!;
  }

  console.log(`[GroundingDINO] Detecting ${prompts.length} prompts on image...`);

  const body: Record<string, unknown> = {
    image_url: imageUrl,
    prompts,
    box_threshold: boxThreshold,
    text_threshold: textThreshold,
  };
  if (labels && labels.length > 0) {
    body.labels = labels;
  }

  const res = await fetch(`${BASE_URL}/detect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000), // 60s timeout for first run (cold model)
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[GroundingDINO] Detection failed: ${res.status} ${errText}`);
    return { regions: [], imageWidth: 0, imageHeight: 0 };
  }

  const data: DetectResponse = await res.json();
  const result: DetectResult = {
    regions: data.regions,
    imageWidth: data.image_width,
    imageHeight: data.image_height,
  };
  cache.set(key, result);

  console.log(
    `[GroundingDINO] Found ${data.regions.length} regions (image: ${data.image_width}x${data.image_height}):`,
    data.regions.map((r) => `${r.label} (${r.confidence.toFixed(2)})`).join(", "),
  );

  return result;
}

/**
 * Extract key noun phrases from narration text for use as Grounding DINO prompts.
 * Enhanced: extracts technical objects (gpu, cpu, server, hardware, hub, cloud, etc.)
 * plus standard visual descriptor patterns.
 */
export function extractVisualPhrases(narration: string, maxPhrases: number = 8): string[] {
  const phrases = new Set<string>();

  // 1. Direct tech & visual object terms common in explainer diagrams
  const directTerms: RegExp[] = [
    /\b(power consumption|thermal management|heavy power consumption|skeletons|demanding thermal management|multi-gpu battle station|battle station|multi-gpu|gpu|cpu|ai compute hub|compute hub|cloud provider|cloud rental|local hardware|hardware|server|database|cluster|diagram|meter|arrow|box|fan|cooler|heatsink|hidden operational costs|spikes|constant draw)\b/gi,
  ];

  for (const regex of directTerms) {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(narration)) !== null) {
      phrases.add(m[0].toLowerCase().trim());
    }
  }

  // 2. Pattern matching for descriptors + nouns
  const patterns: RegExp[] = [
    /\b(the|this|that|a|an)\s+((?:\w+[\s-]){1,3}(?:gpu|cpu|icon|button|arrow|box|server|node|chart|graph|diagram|cluster|database|cloud|container|hub|switch|router|module|component|layer|section|panel|area|region|hardware|fan|meter|station))\b/gi,
    /\b((?:\w+[\s-]){0,2}(?:blue|red|green|yellow|orange|purple|dark|light|heavy-duty|highlighted|glowing|flashing|power|thermal|cooling)\s+(?:\w+[\s-]){0,2}(?:gpu|cpu|icon|button|arrow|box|circle|line|bar|dot|marker|label|badge|hub|server|hardware|consumption|management|fan|meter))\b/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(narration)) !== null) {
      const phrase = (match[2] || match[1] || match[0])
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ");
      if (phrase.length > 2 && phrase.length < 60) {
        phrases.add(phrase);
      }
    }
    pattern.lastIndex = 0;
  }

  return Array.from(phrases).slice(0, maxPhrases);
}
