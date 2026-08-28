import { assembleNanoBananaPrompt, parsePromptToComponents } from './nanoBananaPromptEngine';
import { resolveImageModel } from './supabaseClient';
import { ImageStylePreset } from '../types/storyboard';
import { fetchWithRetry } from './ingest';

export interface FluxGenerationOptions {
  prompt: string;
  conceptType?: 'checking_hub' | 'emergency_reserve' | 'growth_engine' | 'system_architecture';
  stylePreset?: ImageStylePreset;
  width?: number;
  height?: number;
  aspectRatio?: '16:9' | '1:1' | '9:16';
  infographicLabels?: string[];
  referenceImage?: string;
}

export interface FluxGenerationResult {
  imageUrl: string;
  modelUsed: string;
  provider: string;
}

/**
 * Builds a structured prompt for Nano Banana Pro API following the exact format:
 * [Subject] + [Action] + [Location/context] + [Composition] + [Style]
 * plus hardcoded positive style constraints, infographic labels, and character reference anchors.
 */
export function buildStylePrompt(
  prompt: string,
  stylePreset: ImageStylePreset | string = 'illustration',
  infographicLabels: string[] = [],
  referenceImage?: string
): string {
  const components = parsePromptToComponents(prompt, stylePreset);
  if (infographicLabels && infographicLabels.length > 0) {
    components.infographicLabels = infographicLabels;
    // Keep SCVD Data Points in sync with the display labels unless already explicit
    if (!components.dataPoints || components.dataPoints.length === 0) {
      components.dataPoints = infographicLabels;
    }
  }
  if (referenceImage) {
    components.referenceImage = referenceImage;
  }
  return assembleNanoBananaPrompt(components, stylePreset);
}

/**
 * Generates an image via kie.ai's nano-banana-pro task-based API.
 * POST /api/v1/jobs/createTask → poll GET /api/v1/jobs/recordInfo?taskId=...
 * (kie.ai has no OpenAI-compatible /images/generations endpoint for image models.)
 */
async function generateKieImage(
  prompt: string,
  apiKey: string,
  modelName: string,
  options: FluxGenerationOptions,
  baseUrl?: string
): Promise<{ imageUrl: string; provider: string } | null> {
  const rawBase = (baseUrl || 'https://api.kie.ai').replace(/\/+$/, '').replace(/\/v1$/, '');
  const createTaskUrl = `${rawBase}/api/v1/jobs/createTask`;
  const recordInfoUrl = `${rawBase}/api/v1/jobs/recordInfo`;

  // Map requested width to kie.ai resolution enum (1K / 2K / 4K)
  const w = options.width || 1920;
  const resolution = w >= 3840 ? '4K' : w >= 1920 ? '2K' : '1K';

  // image_input: only hosted URLs (kie.ai rejects base64 data URLs)
  const refImg =
    options.referenceImage && options.referenceImage.startsWith('http')
      ? [options.referenceImage]
      : [];

  const input = {
    prompt,
    image_input: refImg,
    aspect_ratio: options.aspectRatio || '16:9',
    resolution,
    output_format: 'png',
  };

  // kie.ai tasks occasionally get stuck — retry once with a fresh task before giving up.
  for (let round = 0; round < 2; round++) {
    const imageUrl = await submitAndPollKieImage(createTaskUrl, recordInfoUrl, modelName, input, apiKey, round);
    if (imageUrl) return { imageUrl, provider: 'kie' };
  }
  return null;
}

async function submitAndPollKieImage(
  createTaskUrl: string,
  recordInfoUrl: string,
  modelName: string,
  input: { prompt: string; image_input: string[]; aspect_ratio: string; resolution: string; output_format: string },
  apiKey: string,
  round: number
): Promise<string | null> {
  console.log(`[KieImage] Submitting nano-banana-pro task (model: ${modelName}, aspect: ${input.aspect_ratio}, res: ${input.resolution}, round ${round + 1}/2)...`);

  const submitRes = await fetchWithRetry(
    createTaskUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelName, input }),
      signal: AbortSignal.timeout(60000),
    },
    2,
    1000
  );

  if (!submitRes.ok) {
    const errBody = await submitRes.text().catch(() => '');
    console.warn(`[KieImage] Submission failed (${submitRes.status}): ${errBody.substring(0, 300)}`);
    return null;
  }

  let submitData: any;
  try { submitData = await submitRes.json(); } catch {
    console.warn('[KieImage] Failed to parse submission response');
    return null;
  }

  if (submitData.code !== 200 || !submitData.data?.taskId) {
    console.warn(`[KieImage] Unexpected submit response: ${JSON.stringify(submitData).substring(0, 300)}`);
    return null;
  }

  const taskId = submitData.data.taskId;
  console.log(`[KieImage] Task created: ${taskId}`);

  // Poll for completion (up to ~10 min, 120 × 5s — nano-banana-pro 2K can be slow)
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));
    const pollRes = await fetch(`${recordInfoUrl}?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!pollRes.ok) continue;
    let pollData: any;
    try { pollData = await pollRes.json(); } catch { continue; }
    if (pollData.code !== 200) continue;

    const state = (pollData.data?.state || '').toLowerCase();
    if (state === 'success') {
      const data = pollData.data || {};
      let imageUrl = data.url || data.imageUrl || data.image_url || data.output?.imageUrl;
      if (!imageUrl && data.resultJson) {
        try {
          const parsed = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : data.resultJson;
          imageUrl =
            parsed?.resultUrls?.[0] || parsed?.imageUrls?.[0] || parsed?.images?.[0]?.url || parsed?.url;
        } catch { /* ignore parse errors */ }
      }
      if (imageUrl) {
        console.log(`[KieImage] Complete: ${imageUrl.substring(0, 80)}...`);
        return imageUrl;
      }
      console.warn(`[KieImage] Task success but no image URL. Keys: ${Object.keys(data).join(', ')}`);
      return null;
    }
    if (state === 'failed' || state === 'error') {
      console.warn(`[KieImage] Task failed: ${JSON.stringify(pollData.data).substring(0, 300)}`);
      return null;
    }
  }

  console.warn(`[KieImage] Timed out polling task ${taskId} (round ${round + 1}/2)`);
  return null;
}

/**
 * Generates images using the configured image model from Supabase llm_models_image table.
 * Optimized for Nano Banana Pro / Gemini / Flux image generation.
 */
export async function generateFluxImage(
  options: FluxGenerationOptions
): Promise<FluxGenerationResult> {
  const imageConfig = await resolveImageModel(undefined, 'diagram_creator');
  console.log(`[FluxImageGen] Resolved image model from Supabase: "${imageConfig.modelName}" (provider: ${imageConfig.provider}, apiKey: ${imageConfig.apiKey ? 'PRESENT' : 'MISSING'}, baseUrl: ${imageConfig.baseUrl || 'N/A'})`);
  const stylePreset = options.stylePreset || 'illustration';
  const detailedPrompt = buildStylePrompt(
    options.prompt,
    stylePreset,
    options.infographicLabels,
    options.referenceImage
  );
  const provider = (imageConfig.provider || 'pollinations').toLowerCase();

  // 1. Google/Gemini image generation
  if (provider === 'google' || provider === 'gemini' || provider === 'imagen' || provider === 'vertex') {
    if (imageConfig.apiKey) {
      try {
        const result = await generateGoogleImage(detailedPrompt, imageConfig.apiKey, imageConfig.modelName);
        if (result) {
          return {
            imageUrl: result.imageUrl,
            modelUsed: imageConfig.modelName,
            provider: result.provider,
          };
        }
      } catch (err) {
        console.warn('[FluxImageGen] Google image generation failed:', err);
      }
    }
  }

  // 2. OpenRouter (supports Flux, Nano Banana 2, DALL-E, etc.)
  if (provider === 'openrouter' && imageConfig.apiKey) {
    try {
      const response = await fetchWithRetry(
        'https://openrouter.ai/api/v1/images/generations',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${imageConfig.apiKey}`,
          },
          body: JSON.stringify({
            model: imageConfig.modelName,
            prompt: detailedPrompt,
            n: 1,
            size: `${options.width || 1920}x${options.height || 1080}`,
          }),
          signal: AbortSignal.timeout(60000),
        },
        2,
        1000
      );

      if (response.ok) {
        const data = await response.json();
        const imageUrl = data.data?.[0]?.url || data.image_url || data.url;
        if (imageUrl) {
          return {
            imageUrl,
            modelUsed: imageConfig.modelName,
            provider: 'openrouter',
          };
        }
      }
    } catch (err) {
      console.warn(`[FluxImageGen] OpenRouter image gen failed for ${imageConfig.modelName}:`, err);
    }
  }

  // 3. Kie.ai — nano-banana-pro task-based API (POST /api/v1/jobs/createTask → poll recordInfo)
  if ((provider.includes('kie') || provider.includes('banana')) && imageConfig.apiKey) {
    const kieResult = await generateKieImage(detailedPrompt, imageConfig.apiKey, imageConfig.modelName, options, imageConfig.baseUrl);
    if (kieResult) {
      return {
        imageUrl: kieResult.imageUrl,
        modelUsed: imageConfig.modelName,
        provider: 'kie',
      };
    }
  }

  // 4. Generic OpenAI-compatible endpoint (custom baseUrl)
  if (imageConfig.apiKey && imageConfig.baseUrl) {
    try {
      const response = await fetchWithRetry(
        `${imageConfig.baseUrl}/images/generations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${imageConfig.apiKey}`,
          },
          body: JSON.stringify({
            model: imageConfig.modelName,
            prompt: detailedPrompt,
            n: 1,
            size: `${options.width || 1920}x${options.height || 1080}`,
          }),
          signal: AbortSignal.timeout(60000),
        },
        2,
        1000
      );

      if (response.ok) {
        const data = await response.json();
        const imageUrl = data.data?.[0]?.url || data.image_url || data.url;
        if (imageUrl) {
          return {
            imageUrl,
            modelUsed: imageConfig.modelName,
            provider: imageConfig.provider,
          };
        }
      }
    } catch (err) {
      console.warn(`[FluxImageGen] Generic image gen failed for ${imageConfig.modelName}:`, err);
    }
  }

  // No fake fallback — surface the error instead of silently degrading to Pollinations.
  throw new Error(
    `[FluxImageGen] All image providers failed (model: "${imageConfig.modelName}", provider: "${imageConfig.provider}"). ` +
    `No image was generated. Fix the provider config or retry.`
  );
}

/**
 * Generates rich full-color digital landscape & 3D illustrations with realistic depth and lighting.
 */
export function createTopicVectorSvg(
  conceptType: 'checking_hub' | 'emergency_reserve' | 'growth_engine' | 'system_architecture',
  label: string
): string {
  const cleanLabel = label.toLowerCase();
  let svgContent = '';

  if (cleanLabel.includes('waterfall') || conceptType === 'system_architecture') {
    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
      <defs>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#bae6fd"/><stop offset="100%" stop-color="#e0f2fe"/></linearGradient>
        <linearGradient id="waterGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#38bdf8"/><stop offset="50%" stop-color="#0284c7"/><stop offset="100%" stop-color="#0369a1"/></linearGradient>
        <linearGradient id="rockGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#475569"/><stop offset="100%" stop-color="#1e293b"/></linearGradient>
      </defs>
      <rect width="1920" height="1080" rx="40" fill="url(#skyGrad)"/>
      <circle cx="1600" cy="200" r="100" fill="#fef08a" opacity="0.9"/>
      <polygon points="300,500 500,280 700,500" fill="#94a3b8"/>
      <polygon points="1100,500 1400,240 1700,500" fill="#64748b"/>
      <path d="M 0,500 L 700,500 L 650,1080 L 0,1080 Z" fill="url(#rockGrad)"/>
      <path d="M 1100,500 L 1920,500 L 1920,1080 L 1200,1080 Z" fill="url(#rockGrad)"/>
      <path d="M 700,500 Q 900,550 1100,500 L 1200,1080 L 650,1080 Z" fill="url(#waterGrad)"/>
      <ellipse cx="920" cy="980" rx="600" ry="80" fill="#0284c7" opacity="0.8"/>
      <text x="960" y="1020" font-family="sans-serif" font-size="48" font-weight="800" fill="#ffffff" text-anchor="middle">Waterfall Allocation System</text>
    </svg>`;
  } else {
    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
      <defs>
        <linearGradient id="genBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0284c7"/><stop offset="100%" stop-color="#0f172a"/></linearGradient>
      </defs>
      <rect width="1920" height="1080" rx="40" fill="url(#genBg)"/>
      <circle cx="960" cy="480" r="220" fill="#ffffff" opacity="0.15"/>
      <rect x="600" y="360" width="720" height="320" rx="40" fill="#10b981" stroke="#ffffff" stroke-width="8"/>
      <circle cx="960" cy="520" r="80" fill="#ffffff"/>
      <text x="960" y="550" font-family="sans-serif" font-size="75" font-weight="900" fill="#047857" text-anchor="middle">$</text>
      <text x="960" y="940" font-family="sans-serif" font-size="48" font-weight="800" fill="#ffffff" text-anchor="middle">${label}</text>
    </svg>`;
  }

  const base64 =
    typeof window !== 'undefined'
      ? btoa(unescape(encodeURIComponent(svgContent)))
      : Buffer.from(svgContent).toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

// ═══════════════════════════════════════════════════
// GOOGLE IMAGEN 3 / GEMINI IMAGE GENERATION
// ═══════════════════════════════════════════════════

/**
 * Generates an image using Google's Gemini image generation API.
 * Uses the resolved model name from Supabase (e.g. gemini-3-pro-image).
 * Imagen 3 is skipped — it requires a Vertex AI service account, not an API key.
 */
export async function generateGoogleImage(
  prompt: string,
  apiKey: string,
  modelName?: string
): Promise<{ imageUrl: string; provider: string } | null> {
  const geminiModel = modelName || 'gemini-2.0-flash-exp-image-generation';

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;
    const response = await fetchWithRetry(
      geminiUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: `Generate a clean diagram image: ${prompt}` }],
          }],
          generationConfig: {
            responseModalities: ['Text', 'Image'],
            imageConfig: {
              aspectRatio: '16:9',
            },
          },
        }),
        signal: AbortSignal.timeout(60000),
      },
      2,
      2000
    );

    if (response.ok) {
      const data = await response.json();
      for (const part of data.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData?.data) {
          return {
            imageUrl: `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`,
            provider: 'gemini',
          };
        }
      }
    } else {
      const text = await response.text().catch(() => '');
      console.warn(`[GoogleImage] Gemini ${response.status} for ${geminiModel}: ${text.substring(0, 200)}`);
    }
  } catch (err) {
    console.warn(`[GoogleImage] Gemini call failed for ${geminiModel}:`, err);
  }

  return null;
}
