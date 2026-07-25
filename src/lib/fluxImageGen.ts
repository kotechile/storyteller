import { resolveImageModel } from './supabaseClient';
import { ImageStylePreset } from '../types/storyboard';

export interface FluxGenerationOptions {
  prompt: string;
  conceptType?: 'checking_hub' | 'emergency_reserve' | 'growth_engine' | 'system_architecture';
  stylePreset?: ImageStylePreset;
  width?: number;
  height?: number;
  aspectRatio?: '16:9' | '1:1' | '9:16';
}

export interface FluxGenerationResult {
  imageUrl: string;
  modelUsed: string;
  provider: string;
}

/**
 * Builds a prompt tailored to the specified image style preset:
 * 1) photo-realistic: High resolution 35mm photography
 * 2) illustration: Vibrant clean graphic design digital vector illustration
 * 3) whiteboard: Clean hand-drawn dry-erase whiteboard marker line art on seamless white background
 */
export function buildStylePrompt(prompt: string, stylePreset: ImageStylePreset | string = 'photo-realistic'): string {
  const normalizedStyle = stylePreset === 'chalk-drawing' ? 'whiteboard' : stylePreset;

  switch (normalizedStyle) {
    case 'illustration':
      return `isolated 3D digital vector illustration of ${prompt}, modern graphic design icon style, rich flat colors, smooth gradients, crisp outlines, isolated on pure solid white background hex #ffffff, no background elements, no vignetting, no gray border, high resolution`;
    case 'whiteboard':
      return `simple clean whiteboard marker line drawing of ${prompt}, hand-drawn with black and navy blue dry-erase markers on a pure seamless solid white background hex #ffffff, minimalist visual diagram sketch, crisp marker lines, isolated drawing on white background, no room photo, no slate, no background shadows, no vignetting, no gray border frame`;
    case 'photo-realistic':
    default:
      return `isolated high-definition studio photograph of ${prompt}, placed on pure solid white background hex #ffffff, high key studio lighting, sharp focus, vibrant natural color palette, crisp edges, no surrounding room, no background elements, no vignetting, no gray border, 8k resolution`;
  }
}

/**
 * Generates high-definition images using Flux AI with parameterized style presets.
 */
export async function generateFluxImage(
  options: FluxGenerationOptions
): Promise<FluxGenerationResult> {
  const imageConfig = await resolveImageModel('flux');
  const stylePreset = options.stylePreset || 'photo-realistic';
  const detailedPrompt = buildStylePrompt(options.prompt, stylePreset);

  // 1. Try paid Flux / Kie.ai API if key exists
  if (imageConfig.apiKey) {
    try {
      const response = await fetch('https://api.kie.ai/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${imageConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: imageConfig.modelName,
          prompt: detailedPrompt,
          aspect_ratio: options.aspectRatio || '1:1',
          width: options.width || 1024,
          height: options.height || 1024,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const imageUrl = data.data?.[0]?.url || data.image_url;
        if (imageUrl) {
          return {
            imageUrl,
            modelUsed: imageConfig.modelName,
            provider: imageConfig.provider,
          };
        }
      }
    } catch (err) {
      console.warn('[FluxImageGen] Paid Flux API call failed, using Pollinations 1024x1024 Flux engine:', err);
    }
  }

  // 2. Square 1024x1024 AI Generation API (Pollinations Flux Engine)
  const reqWidth = options.width || 1024;
  const reqHeight = options.height || 1024;
  const encodedPrompt = encodeURIComponent(detailedPrompt);
  const generatedUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${reqWidth}&height=${reqHeight}&model=flux&nologo=true&seed=${Math.floor(Math.random() * 10000)}`;

  return {
    imageUrl: generatedUrl,
    modelUsed: `pollinations_flux_${stylePreset}`,
    provider: 'pollinations_ai',
  };
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
