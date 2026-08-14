import { resolveVideoModel, ResolvedVideoConfig } from './supabaseClient';
import { fetchWithRetry } from './ingest';

// ── Types ──

export type VideoProvider = 'runway' | 'luma' | 'kling' | 'sora' | 'kie';

export interface ImageToVideoOptions {
  /** The static image URL to animate */
  imageUrl: string;
  /** Optional motion guidance prompt. Defaults to "subtle camera motion, smooth parallax" */
  prompt?: string;
  /** Provider override — defaults to resolved Supabase model */
  provider?: VideoProvider;
  /** Duration in seconds (4, 5, or 10 depending on provider) */
  duration?: number;
  /** Motion strength 0-1 (default 0.3 for subtle corporate explainer motion) */
  motionStrength?: number;
}

export interface ImageToVideoResult {
  videoUrl: string;
  provider: string;
  generationId: string;
}

// ── Provider API Implementations ──

async function animateWithRunway(
  imageUrl: string,
  prompt: string,
  config: ResolvedVideoConfig,
  duration: number = 5,
): Promise<ImageToVideoResult> {
  const apiKey = config.apiKey;
  if (!apiKey) throw new Error('[ImageToVideo] No API key for Runway');

  const baseUrl = config.baseUrl || 'https://api.runwayml.com';

  console.log(`[ImageToVideo] Runway: submitting image-to-video generation...`);
  const submitRes = await fetchWithRetry(`${baseUrl}/v1/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mode: 'image_to_video',
      image_url: imageUrl,
      prompt_text: prompt,
      duration: duration,
      watermark: false,
    }),
  });

  if (!submitRes.ok) {
    const errBody = await submitRes.text();
    throw new Error(`[ImageToVideo] Runway submission failed (${submitRes.status}): ${errBody}`);
  }

  let submitData: any;
  try { submitData = await submitRes.json(); } catch { submitData = {}; }
  const generationId = submitData.id || submitData.generation_id;

  if (!generationId) {
    throw new Error(`[ImageToVideo] Runway: no generation ID in response: ${JSON.stringify(submitData)}`);
  }

  console.log(`[ImageToVideo] Runway generation ID: ${generationId}. Polling for completion...`);

  // Poll for completion (max 5 minutes)
  const maxAttempts = 60;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 5000)); // 5s between polls

    const pollRes = await fetch(`${baseUrl}/v1/generations/${generationId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!pollRes.ok) {
      console.warn(`[ImageToVideo] Runway poll failed (${pollRes.status}), retrying...`);
      continue;
    }

    const pollData = await pollRes.json();
    const status = pollData.status || pollData.state;

    if (status === 'SUCCEEDED' || status === 'COMPLETED' || status === 'succeeded') {
      const videoUrl = pollData.output?.video_url || pollData.video_url || pollData.output_url;
      if (!videoUrl) throw new Error('[ImageToVideo] Runway: completed but no video URL in response');
      console.log(`[ImageToVideo] Runway complete: ${videoUrl.substring(0, 80)}...`);
      return { videoUrl, provider: 'runway', generationId };
    }

    if (status === 'FAILED' || status === 'failed' || status === 'error') {
      throw new Error(`[ImageToVideo] Runway generation failed: ${pollData.error || pollData.failure_reason || 'unknown error'}`);
    }

    console.log(`[ImageToVideo] Runway status: ${status} (attempt ${attempt + 1}/${maxAttempts})`);
  }

  throw new Error(`[ImageToVideo] Runway: timed out after ${maxAttempts * 5}s`);
}

async function animateWithLuma(
  imageUrl: string,
  prompt: string,
  config: ResolvedVideoConfig,
  duration: number = 5,
): Promise<ImageToVideoResult> {
  const apiKey = config.apiKey;
  if (!apiKey) throw new Error('[ImageToVideo] No API key for Luma');

  const baseUrl = config.baseUrl || 'https://api.lumalabs.ai';

  console.log(`[ImageToVideo] Luma: submitting image-to-video generation...`);
  const submitRes = await fetchWithRetry(`${baseUrl}/dream-machine/v1/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      generation_type: 'image_to_video',
      image_url: imageUrl,
      prompt: prompt,
      duration: `${duration}s`,
      loop: false,
    }),
  });

  if (!submitRes.ok) {
    const errBody = await submitRes.text();
    throw new Error(`[ImageToVideo] Luma submission failed (${submitRes.status}): ${errBody}`);
  }

  let submitData: any;
  try { submitData = await submitRes.json(); } catch { submitData = {}; }
  const generationId = submitData.id || submitData.generation_id;

  if (!generationId) {
    throw new Error(`[ImageToVideo] Luma: no generation ID in response: ${JSON.stringify(submitData)}`);
  }

  console.log(`[ImageToVideo] Luma generation ID: ${generationId}. Polling for completion...`);

  const maxAttempts = 60;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 5000));

    const pollRes = await fetch(`${baseUrl}/dream-machine/v1/generations/${generationId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!pollRes.ok) {
      console.warn(`[ImageToVideo] Luma poll failed (${pollRes.status}), retrying...`);
      continue;
    }

    const pollData = await pollRes.json();
    const status = pollData.status || pollData.state;

    if (status === 'completed' || status === 'COMPLETED') {
      const videoUrl = pollData.assets?.video || pollData.video_url || pollData.output?.video_url;
      if (!videoUrl) throw new Error('[ImageToVideo] Luma: completed but no video URL in response');
      console.log(`[ImageToVideo] Luma complete: ${videoUrl.substring(0, 80)}...`);
      return { videoUrl, provider: 'luma', generationId };
    }

    if (status === 'failed' || status === 'FAILED') {
      throw new Error(`[ImageToVideo] Luma generation failed: ${pollData.failure_reason || pollData.error || 'unknown error'}`);
    }

    console.log(`[ImageToVideo] Luma status: ${status} (attempt ${attempt + 1}/${maxAttempts})`);
  }

  throw new Error(`[ImageToVideo] Luma: timed out after ${maxAttempts * 5}s`);
}

async function animateWithKling(
  imageUrl: string,
  prompt: string,
  config: ResolvedVideoConfig,
  duration: number = 5,
): Promise<ImageToVideoResult> {
  const apiKey = config.apiKey;
  if (!apiKey) throw new Error('[ImageToVideo] No API key for Kling');

  const baseUrl = config.baseUrl || 'https://api.kling.ai';

  console.log(`[ImageToVideo] Kling: submitting image-to-video generation...`);
  const submitRes = await fetchWithRetry(`${baseUrl}/v1/videos/image2video`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model_name: 'kling-v1',
      image: imageUrl,
      prompt: prompt,
      duration: duration,
      mode: 'std',
    }),
  });

  if (!submitRes.ok) {
    const errBody = await submitRes.text();
    throw new Error(`[ImageToVideo] Kling submission failed (${submitRes.status}): ${errBody}`);
  }

  let submitData: any;
  try { submitData = await submitRes.json(); } catch { submitData = {}; }
  const data = submitData.data;
  const generationId = data?.task_id || data?.generation_id || submitData.task_id;

  if (!generationId) {
    throw new Error(`[ImageToVideo] Kling: no task ID in response: ${JSON.stringify(submitData)}`);
  }

  console.log(`[ImageToVideo] Kling task ID: ${generationId}. Polling for completion...`);

  const maxAttempts = 60;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 5000));

    const pollRes = await fetch(`${baseUrl}/v1/videos/image2video/${generationId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!pollRes.ok) {
      console.warn(`[ImageToVideo] Kling poll failed (${pollRes.status}), retrying...`);
      continue;
    }

    const pollData = await pollRes.json();
    const taskData = pollData.data;
    const status = taskData?.task_status || pollData.status;

    if (status === 'succeed' || status === 'SUCCEED' || status === 'completed') {
      const videoUrl = taskData?.task_result?.videos?.[0]?.url || pollData.video_url;
      if (!videoUrl) throw new Error('[ImageToVideo] Kling: completed but no video URL in response');
      console.log(`[ImageToVideo] Kling complete: ${videoUrl.substring(0, 80)}...`);
      return { videoUrl, provider: 'kling', generationId };
    }

    if (status === 'failed' || status === 'FAILED') {
      throw new Error(`[ImageToVideo] Kling generation failed: ${taskData?.task_status_msg || 'unknown error'}`);
    }

    console.log(`[ImageToVideo] Kling status: ${status} (attempt ${attempt + 1}/${maxAttempts})`);
  }

  throw new Error(`[ImageToVideo] Kling: timed out after ${maxAttempts * 5}s`);
}

// ── Main Entry Point ──

/**
 * Animates a static image into a video using the configured image-to-video provider.
 *
 * Provider resolution order:
 * 1. Explicit `options.provider` override
 * 2. Supabase `llm_models_video` table (via `llm_used_for.llm_video_id`)
 * 3. Default fallback: Runway
 */
export async function animateImage(options: ImageToVideoOptions): Promise<ImageToVideoResult> {
  const { imageUrl, prompt, provider: providerOverride, duration = 5, motionStrength = 0.3 } = options;

  // Build motion prompt incorporating strength
  const strengthDesc = motionStrength < 0.2 ? 'very subtle micro-motion, barely perceptible' :
    motionStrength < 0.5 ? 'subtle camera motion, smooth parallax, gentle dolly' :
    'moderate camera movement, smooth tracking shots';
  const motionPrompt = prompt || `${strengthDesc}, no rapid movements, professional cinematic quality`;

  // Resolve video model from Supabase
  const videoConfig = await resolveVideoModel('diagram_creator');

  // Normalize provider name (Supabase may store "kie.ai" but code uses "kie")
  const rawProvider = (providerOverride || videoConfig.provider || 'runway').toLowerCase();
  let provider: VideoProvider;
  if (rawProvider === 'kie.ai' || rawProvider === 'seedance') provider = 'kie';
  else if (rawProvider === 'luma.ai' || rawProvider === 'lumaai') provider = 'luma';
  else if (rawProvider === 'kling.ai' || rawProvider === 'klingai') provider = 'kling';
  else if (rawProvider === 'sora.ai' || rawProvider === 'soraai' || rawProvider === 'openai') provider = 'sora';
  else provider = rawProvider as VideoProvider;

  if (!videoConfig.apiKey && provider !== 'runway') {
    console.warn(`[ImageToVideo] No API key for ${provider}. Trying with env vars...`);
  }

  console.log(`[ImageToVideo] Animating image with provider "${provider}" (model: ${videoConfig.modelName}, duration: ${duration}s)...`);

  switch (provider) {
    case 'runway':
      return animateWithRunway(imageUrl, motionPrompt, videoConfig, duration);
    case 'luma':
      return animateWithLuma(imageUrl, motionPrompt, videoConfig, duration);
    case 'kling':
      return animateWithKling(imageUrl, motionPrompt, videoConfig, duration);
    case 'kie':
      return animateWithKie(imageUrl, motionPrompt, videoConfig, duration);
    default:
      throw new Error(`[ImageToVideo] Unsupported provider: ${provider}. Supported: runway, luma, kling, kie`);
  }
}

// ── Text-to-Video Types ──

export interface TextToVideoOptions {
  /** Full cinematic prompt for video generation */
  prompt: string;
  /** Provider override */
  provider?: VideoProvider;
  /** Duration in seconds */
  duration?: number;
  /** Aspect ratio (default 16:9) */
  aspectRatio?: '16:9' | '9:16' | '1:1';
}

// ── Text-to-Video Provider Implementations ──

async function generateWithRunwayText(
  prompt: string,
  config: ResolvedVideoConfig,
  duration: number = 5,
): Promise<ImageToVideoResult> {
  const apiKey = config.apiKey;
  if (!apiKey) throw new Error('[TextToVideo] No API key for Runway');

  const baseUrl = config.baseUrl || 'https://api.runwayml.com';

  console.log('[TextToVideo] Runway: submitting text-to-video generation...');
  const submitRes = await fetchWithRetry(`${baseUrl}/v1/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mode: 'text_to_video',
      prompt_text: prompt,
      duration,
      watermark: false,
      ratio: '16:9',
    }),
  });

  if (!submitRes.ok) {
    const errBody = await submitRes.text();
    throw new Error(`[TextToVideo] Runway submission failed (${submitRes.status}): ${errBody}`);
  }

  let submitData: any;
  try { submitData = await submitRes.json(); } catch { submitData = {}; }
  const generationId = submitData.id || submitData.generation_id;

  if (!generationId) {
    throw new Error(`[TextToVideo] Runway: no generation ID in response`);
  }

  console.log(`[TextToVideo] Runway generation ID: ${generationId}. Polling...`);

  const maxAttempts = 120; // text-to-video takes longer
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 5000));

    const pollRes = await fetch(`${baseUrl}/v1/generations/${generationId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!pollRes.ok) continue;

    const pollData = await pollRes.json();
    const status = pollData.status || pollData.state;

    if (status === 'SUCCEEDED' || status === 'COMPLETED' || status === 'succeeded') {
      const videoUrl = pollData.output?.video_url || pollData.video_url || pollData.output_url;
      if (!videoUrl) throw new Error('[TextToVideo] Runway: completed but no video URL');
      console.log(`[TextToVideo] Runway complete: ${videoUrl.substring(0, 80)}...`);
      return { videoUrl, provider: 'runway', generationId };
    }

    if (status === 'FAILED' || status === 'failed') {
      throw new Error(`[TextToVideo] Runway failed: ${pollData.error || pollData.failure_reason || 'unknown'}`);
    }

    if (attempt % 6 === 0) {
      console.log(`[TextToVideo] Runway status: ${status} (attempt ${attempt + 1}/${maxAttempts})`);
    }
  }

  throw new Error(`[TextToVideo] Runway: timed out after ${maxAttempts * 5}s`);
}

async function generateWithKlingText(
  prompt: string,
  config: ResolvedVideoConfig,
  duration: number = 5,
): Promise<ImageToVideoResult> {
  const apiKey = config.apiKey;
  if (!apiKey) throw new Error('[TextToVideo] No API key for Kling');

  const baseUrl = config.baseUrl || 'https://api.kling.ai';

  console.log('[TextToVideo] Kling: submitting text-to-video generation...');
  const submitRes = await fetchWithRetry(`${baseUrl}/v1/videos/text2video`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model_name: 'kling-v1',
      prompt,
      duration,
      mode: 'std',
      aspect_ratio: '16:9',
    }),
  });

  if (!submitRes.ok) {
    const errBody = await submitRes.text();
    throw new Error(`[TextToVideo] Kling submission failed (${submitRes.status}): ${errBody}`);
  }

  let submitData: any;
  try { submitData = await submitRes.json(); } catch { submitData = {}; }
  const generationId = submitData.data?.task_id || submitData.task_id;

  if (!generationId) {
    throw new Error('[TextToVideo] Kling: no task ID in response');
  }

  console.log(`[TextToVideo] Kling task ID: ${generationId}. Polling...`);

  const maxAttempts = 120;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 5000));

    const pollRes = await fetch(`${baseUrl}/v1/videos/text2video/${generationId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!pollRes.ok) continue;

    const pollData = await pollRes.json();
    const status = pollData.data?.task_status || pollData.status;

    if (status === 'succeed' || status === 'completed') {
      const videoUrl = pollData.data?.task_result?.videos?.[0]?.url || pollData.video_url;
      if (!videoUrl) throw new Error('[TextToVideo] Kling: completed but no video URL');
      console.log(`[TextToVideo] Kling complete: ${videoUrl.substring(0, 80)}...`);
      return { videoUrl, provider: 'kling', generationId };
    }

    if (status === 'failed') {
      throw new Error(`[TextToVideo] Kling failed: ${pollData.data?.task_status_msg || 'unknown'}`);
    }

    if (attempt % 6 === 0) {
      console.log(`[TextToVideo] Kling status: ${status} (attempt ${attempt + 1}/${maxAttempts})`);
    }
  }

  throw new Error(`[TextToVideo] Kling: timed out after ${maxAttempts * 5}s`);
}

async function generateWithLumaText(
  prompt: string,
  config: ResolvedVideoConfig,
  duration: number = 5,
): Promise<ImageToVideoResult> {
  const apiKey = config.apiKey;
  if (!apiKey) throw new Error('[TextToVideo] No API key for Luma');

  const baseUrl = config.baseUrl || 'https://api.lumalabs.ai';

  console.log('[TextToVideo] Luma: submitting text-to-video generation...');
  const submitRes = await fetchWithRetry(`${baseUrl}/dream-machine/v1/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      generation_type: 'text_to_video',
      prompt,
      duration: `${duration}s`,
      aspect_ratio: '16:9',
      loop: false,
    }),
  });

  if (!submitRes.ok) {
    const errBody = await submitRes.text();
    throw new Error(`[TextToVideo] Luma submission failed (${submitRes.status}): ${errBody}`);
  }

  let submitData: any;
  try { submitData = await submitRes.json(); } catch { submitData = {}; }
  const generationId = submitData.id || submitData.generation_id;

  if (!generationId) {
    throw new Error('[TextToVideo] Luma: no generation ID in response');
  }

  console.log(`[TextToVideo] Luma generation ID: ${generationId}. Polling...`);

  const maxAttempts = 120;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 5000));

    const pollRes = await fetch(`${baseUrl}/dream-machine/v1/generations/${generationId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!pollRes.ok) continue;

    const pollData = await pollRes.json();
    const status = pollData.status || pollData.state;

    if (status === 'completed' || status === 'COMPLETED') {
      const videoUrl = pollData.assets?.video || pollData.video_url || pollData.output?.video_url;
      if (!videoUrl) throw new Error('[TextToVideo] Luma: completed but no video URL');
      console.log(`[TextToVideo] Luma complete: ${videoUrl.substring(0, 80)}...`);
      return { videoUrl, provider: 'luma', generationId };
    }

    if (status === 'failed') {
      throw new Error(`[TextToVideo] Luma failed: ${pollData.failure_reason || pollData.error || 'unknown'}`);
    }

    if (attempt % 6 === 0) {
      console.log(`[TextToVideo] Luma status: ${status} (attempt ${attempt + 1}/${maxAttempts})`);
    }
  }

  throw new Error(`[TextToVideo] Luma: timed out after ${maxAttempts * 5}s`);
}

// ── Kie.ai Video Generation (Callback + Polling) ──

/**
 * Submits a video generation task via kie.ai's professional API.
 * POST /api/v1/jobs/createTask → { code: 200, data: { taskId } }
 * Then polls GET /api/v1/jobs/recordInfo?taskId={id} until complete.
 * Supports models: bytedance/seedance-2, veo-3-fast, wan-2.7-text-to-video
 */

interface KieTaskInput {
  prompt: string;
  first_frame_url?: string;
  last_frame_url?: string;
  reference_image_urls?: string[];
  resolution?: string;
  aspect_ratio?: string;
  duration?: number;
  generate_audio?: boolean;
  web_search?: boolean;
}

async function submitKieTask(
  model: string,
  input: KieTaskInput,
  apiKey: string,
  baseUrl: string,
): Promise<string> {
  console.log(`[kie.ai] Submitting task (model: ${model})...`);
  const submitRes = await fetchWithRetry(`${baseUrl}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, input }),
  });

  if (!submitRes.ok) {
    const errBody = await submitRes.text();
    throw new Error(`[kie.ai] Submission failed (${submitRes.status}): ${errBody.substring(0, 300)}`);
  }

  let data: any;
  try { data = await submitRes.json(); } catch {
    throw new Error('[kie.ai] Failed to parse submission response');
  }

  if (data.code !== 200 || !data.data?.taskId) {
    throw new Error(`[kie.ai] Unexpected submit response: ${JSON.stringify(data).substring(0, 300)}`);
  }

  const taskId = data.data.taskId;
  console.log(`[kie.ai] Task created: ${taskId}`);
  return taskId;
}

async function pollKieTask(
  taskId: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<ImageToVideoResult> {
  console.log(`[kie.ai] Polling task ${taskId} every 10s...`);
  const statusEndpoint = `${baseUrl}/api/v1/jobs/recordInfo?taskId=${taskId}`;
  const resultEndpoint = `${baseUrl}/api/v1/jobs/result?taskId=${taskId}`;
  const maxAttempts = 60; // 10 min

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 10000));

    const pollRes = await fetch(statusEndpoint, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!pollRes.ok) {
      console.warn(`[kie.ai] Poll failed (${pollRes.status}), retrying...`);
      continue;
    }

    let pollData: any;
    try { pollData = await pollRes.json(); } catch { continue; }

    if (pollData.code !== 200) {
      console.warn(`[kie.ai] Poll returned code ${pollData.code}, retrying...`);
      continue;
    }

    const state = (pollData.data?.state || '').toLowerCase();

    if (state === 'success') {
      // Try multiple known paths for the video URL, including resultJson
      const data = pollData.data || {};
      let videoUrl =
        data.videoInfo?.videoUrl ||
        data.videoInfo?.url ||
        data.videoUrl ||
        data.video_url ||
        data.url ||
        data.output?.videoUrl ||
        data.result?.videoUrl ||
        data.result?.url;

      // Parse resultJson — kie.ai stores results as JSON string in resultJson field
      if (!videoUrl && data.resultJson) {
        try {
          const parsed = typeof data.resultJson === 'string'
            ? JSON.parse(data.resultJson)
            : data.resultJson;
          videoUrl = parsed?.resultUrls?.[0] || parsed?.videoUrl || parsed?.url;
          if (videoUrl) {
            console.log(`[kie.ai] Extracted URL from resultJson.resultUrls[0]: ${videoUrl.substring(0, 80)}...`);
          }
        } catch { /* ignore parse errors */ }
      }
      if (!videoUrl) {
        // Try the result endpoint — recordInfo only returns status, not the video
        try {
          console.log(`[kie.ai] Trying result endpoint...`);
          const resultRes = await fetch(resultEndpoint, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
          });
          if (resultRes.ok) {
            const resultData = await resultRes.json();
            const resultUrl =
              resultData.data?.videoInfo?.videoUrl ||
              resultData.data?.videoUrl ||
              resultData.data?.url ||
              resultData.data?.output?.videoUrl ||
              resultData.data?.result?.url;
            if (resultUrl) {
              console.log(`[kie.ai] Complete (${model}): ${resultUrl.substring(0, 80)}...`);
              return { videoUrl: resultUrl, provider: 'kie', generationId: taskId };
            }
            console.warn(`[kie.ai] Result endpoint also has no videoUrl. Keys:`, JSON.stringify(Object.keys(resultData.data || {})));
          }
        } catch (resultErr) {
          console.warn(`[kie.ai] Result endpoint failed:`, resultErr);
        }
        const dataKeys = Object.keys(data);
        const fullStr = JSON.stringify(pollData);
        console.warn(`[kie.ai] Task succeeded but videoUrl not found. Data keys: ${JSON.stringify(dataKeys)}. Full (2000 chars):`, fullStr.substring(0, 2000));
        if (attempt > 5) {
          console.error(`[kie.ai] Full response:`, fullStr);
          throw new Error(`[kie.ai] Task succeeded but no videoUrl. Data keys: ${JSON.stringify(dataKeys)}`);
        }
        continue;
      }
      console.log(`[kie.ai] Complete (${model}): ${videoUrl.substring(0, 80)}...`);
      return { videoUrl, provider: 'kie', generationId: taskId };
    }

    if (state === 'failed' || state === 'error') {
      const msg = pollData.data?.errorMsg || pollData.data?.message || 'unknown';
      throw new Error(`[kie.ai] Task failed: ${msg}`);
    }

    if (attempt % 3 === 0) {
      console.log(`[kie.ai] State: "${state}" (attempt ${attempt + 1}/${maxAttempts})`);
    }
  }

  throw new Error(`[kie.ai] Timed out after ${maxAttempts * 10}s`);
}

// ── Text-to-Video ──

async function generateWithKieText(
  prompt: string,
  config: ResolvedVideoConfig,
  duration: number = 5,
): Promise<ImageToVideoResult> {
  const apiKey = config.apiKey;
  if (!apiKey) throw new Error('[TextToVideo] No API key for kie.ai');

  const baseUrl = config.baseUrl || 'https://api.kie.ai';
  const model = config.modelName || 'bytedance/seedance-2';

  const taskId = await submitKieTask(model, {
    prompt,
    duration,
    aspect_ratio: '16:9',
    resolution: '720p',
    generate_audio: false,
  }, apiKey, baseUrl);

  return pollKieTask(taskId, apiKey, baseUrl, model);
}

// ── Image-to-Video ──

async function animateWithKie(
  imageUrl: string,
  prompt: string,
  config: ResolvedVideoConfig,
  duration: number = 5,
): Promise<ImageToVideoResult> {
  const apiKey = config.apiKey;
  if (!apiKey) throw new Error('[ImageToVideo] No API key for kie.ai');

  const baseUrl = config.baseUrl || 'https://api.kie.ai';
  const model = config.modelName || 'bytedance/seedance-2';

  const taskId = await submitKieTask(model, {
    prompt,
    first_frame_url: imageUrl,
    duration,
    aspect_ratio: '16:9',
    resolution: '720p',
    generate_audio: false,
  }, apiKey, baseUrl);

  return pollKieTask(taskId, apiKey, baseUrl, model);
}

// ── Main Text-to-Video Entry Point ──

/**
 * Generates a video from a text prompt.
 * Composes prompt from `imageDescription` + `narration` for cinematic scenes.
 * For use with scenes tagged `animationStrategy: "text_to_video"`.
 */
export async function generateVideo(options: TextToVideoOptions): Promise<ImageToVideoResult> {
  const { prompt, provider: providerOverride, duration = 5 } = options;

  if (!prompt || prompt.trim().length < 10) {
    throw new Error('[TextToVideo] Prompt too short — need at least 10 characters');
  }

  // Resolve video model from Supabase
  const videoConfig = await resolveVideoModel('diagram_creator');

  // Normalize provider name
  const rawProvider = (providerOverride || videoConfig.provider || 'runway').toLowerCase();
  let provider: VideoProvider;
  if (rawProvider === 'kie.ai' || rawProvider === 'seedance') provider = 'kie';
  else if (rawProvider === 'luma.ai' || rawProvider === 'lumaai') provider = 'luma';
  else if (rawProvider === 'kling.ai' || rawProvider === 'klingai') provider = 'kling';
  else if (rawProvider === 'sora.ai' || rawProvider === 'soraai' || rawProvider === 'openai') provider = 'sora';
  else provider = rawProvider as VideoProvider;

  console.log(`[TextToVideo] Generating video with provider "${provider}" (duration: ${duration}s, prompt: ${prompt.substring(0, 100)}...)`);

  switch (provider) {
    case 'runway':
      return generateWithRunwayText(prompt, videoConfig, duration);
    case 'kling':
      return generateWithKlingText(prompt, videoConfig, duration);
    case 'luma':
      return generateWithLumaText(prompt, videoConfig, duration);
    case 'sora':
      // Sora uses the same endpoint structure as Runway in many integrations
      return generateWithRunwayText(prompt, videoConfig, duration);
    case 'kie':
      return generateWithKieText(prompt, videoConfig, duration);
    default:
      throw new Error(`[TextToVideo] Unsupported provider: ${provider}. Supported: runway, kling, luma, sora, kie`);
  }
}

/**
 * Convenience: animates multiple images in parallel.
 * Capped at 2 concurrent to avoid API rate limits.
 */
export async function animateImages(
  imageOptions: ImageToVideoOptions[],
  concurrency: number = 2,
): Promise<ImageToVideoResult[]> {
  const results: ImageToVideoResult[] = [];

  for (let i = 0; i < imageOptions.length; i += concurrency) {
    const batch = imageOptions.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(opt => animateImage(opt))
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        console.error('[ImageToVideo] Batch generation failed:', result.reason);
      }
    }

    // Brief delay between batches
    if (i + concurrency < imageOptions.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return results;
}
