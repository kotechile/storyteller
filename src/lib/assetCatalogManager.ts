import { generateFluxImage, FluxGenerationResult } from './fluxImageGen';
import { ImageStylePreset, StoryboardManifest, ArticleAsset, CanvasElement } from '../types/storyboard';
import { getApiKey } from './supabaseClient';
import { fetchWithRetry } from './ingest';
import { animateImage, generateVideo } from './imageToVideo';

export interface CatalogEntry {
  conceptKey: string;
  imageUrl: string;
  provider: string;
  prompt: string;
  generatedAt: string;
}

export type AssetCatalogMap = Record<string, CatalogEntry>;

const isServer = typeof window === 'undefined';

function getStoragePaths() {
  if (!isServer) return { catalogPath: '', assetsDir: '' };
  try {
    const pathMod = eval('require')('path');
    const catalogPath = pathMod.join(process.cwd(), 'public', 'asset_catalog.json');
    const assetsDir = pathMod.join(process.cwd(), 'public', 'generated_assets');
    return { catalogPath, assetsDir };
  } catch {
    return { catalogPath: '', assetsDir: '' };
  }
}

function ensureCatalogStorage() {
  if (!isServer) return;
  try {
    const fsMod = eval('require')('fs');
    const { catalogPath, assetsDir } = getStoragePaths();
    if (!catalogPath || !assetsDir) return;
    if (!fsMod.existsSync(assetsDir)) {
      fsMod.mkdirSync(assetsDir, { recursive: true });
    }
    if (!fsMod.existsSync(catalogPath)) {
      fsMod.writeFileSync(catalogPath, JSON.stringify({}, null, 2));
    }
  } catch (err) {
    console.warn('[AssetCatalogManager] Storage init skipped:', err);
  }
}

export function loadAssetCatalog(): AssetCatalogMap {
  if (!isServer) return {};
  ensureCatalogStorage();
  try {
    const fsMod = eval('require')('fs');
    const { catalogPath } = getStoragePaths();
    if (!catalogPath || !fsMod.existsSync(catalogPath)) return {};
    const raw = fsMod.readFileSync(catalogPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[AssetCatalogManager] Error reading catalog file:', err);
    return {};
  }
}

export function saveCatalogEntry(entry: CatalogEntry): AssetCatalogMap {
  if (!isServer) return {};
  const catalog = loadAssetCatalog();
  catalog[entry.conceptKey] = entry;
  try {
    const fsMod = eval('require')('fs');
    const { catalogPath } = getStoragePaths();
    if (catalogPath) {
      fsMod.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
      console.log(`[AssetCatalogManager] Saved '${entry.conceptKey}' to catalog: ${entry.imageUrl}`);
    }
  } catch (err) {
    console.warn('[AssetCatalogManager] Could not save catalog entry:', err);
  }
  return catalog;
}

async function downloadAndSaveImage(imageUrl: string, conceptKey: string): Promise<string> {
  if (!isServer) return imageUrl;
  ensureCatalogStorage();
  const { assetsDir } = getStoragePaths();
  if (!assetsDir) return imageUrl;

  const filename = `${conceptKey}_${Date.now()}.png`;
  const relativePath = `generated_assets/${filename}`;

  try {
    const pathMod = eval('require')('path');
    const fsMod = eval('require')('fs');
    const absolutePath = pathMod.join(process.cwd(), 'public', relativePath);

    if (imageUrl.startsWith('data:image')) {
      const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, '');
      fsMod.writeFileSync(absolutePath, Buffer.from(base64Data, 'base64'));
      return relativePath;
    }

    if (imageUrl.startsWith('http')) {
      const response = await fetchWithRetry(imageUrl, {}, 2, 1000);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        fsMod.writeFileSync(absolutePath, Buffer.from(arrayBuffer));
        return relativePath;
      }
    }
  } catch (err) {
    console.warn(`[AssetCatalogManager] Failed to download image from ${imageUrl}, storing URL directly.`, err);
  }

  return imageUrl;
}

/**
 * Main Lookup & Generation Pipeline:
 * 1. Checks public/asset_catalog.json. If existing high-quality image exists, reuses it immediately (0 API calls).
 * 2. If missing, resolves Supabase / env keys and generates with Flux / DALL-E using parameterized stylePreset.
 * 3. Saves newly generated image locally & registers it automatically in asset_catalog.json.
 */
export async function getOrGenerateConceptImage(
  conceptName: string,
  prompt: string,
  stylePreset: ImageStylePreset = 'photo-realistic',
  bypassCache = false
): Promise<{ imageUrl: string; fromCache: boolean; provider: string }> {
  const rawKey = conceptName
    .toLowerCase()
    .replace(/^asset:/, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .trim();

  const cleanKey = `${rawKey}_${stylePreset}`;
  const catalog = loadAssetCatalog();

  // 1. Check if concept already exists in persistent catalog for this specific style preset
  if (!bypassCache && catalog[cleanKey]) {
    const existing = catalog[cleanKey];
    console.log(`[AssetCatalogManager] 🎯 Cache Hit! Reusing catalog image for '${cleanKey}': ${existing.imageUrl}`);
    return {
      imageUrl: existing.imageUrl,
      fromCache: true,
      provider: existing.provider,
    };
  }

  // 2. Not in catalog or bypassCache: Fetch API key from Supabase (or fallback env) and generate with Flux
  console.log(`[AssetCatalogManager] 🎨 Concept '${cleanKey}' (${stylePreset}) [bypassCache=${bypassCache}]. Generating with Flux API...`);
  
  // Also check if Supabase has a flux / replicate / openai key
  const fluxKey = (await getApiKey('flux')) || (await getApiKey('replicate')) || (await getApiKey('kie.ai'));
  if (fluxKey) {
    console.log(`[AssetCatalogManager] Resolved Flux API key from Supabase/Env.`);
  }

  const genResult: FluxGenerationResult = await generateFluxImage({
    prompt: prompt || conceptName,
    stylePreset,
    aspectRatio: '16:9',
    width: 1920,
    height: 1080,
  });

  // 3. Save generated image & automatically update JSON catalog
  let savedLocalPath = genResult.imageUrl;
  if (genResult.imageUrl.startsWith('http') || genResult.imageUrl.startsWith('data:image')) {
    savedLocalPath = await downloadAndSaveImage(genResult.imageUrl, cleanKey);
  }

  const newEntry: CatalogEntry = {
    conceptKey: cleanKey,
    imageUrl: savedLocalPath,
    provider: genResult.provider,
    prompt: prompt || conceptName,
    generatedAt: new Date().toISOString(),
  };

  saveCatalogEntry(newEntry);

  return {
    imageUrl: savedLocalPath,
    fromCache: false,
    provider: genResult.provider,
  };
}

/**
 * Classifies an article asset as a technical diagram/infographic/screenshot vs generic photo.
 * Uses the Grounding DINO backend's EasyOCR to check text density.
 * Returns true if the image should be kept as-is (diagram/screenshot).
 */
async function classifyArticleAsset(imageUrl: string): Promise<boolean> {
  try {
    const backendUrl = 'http://localhost:8001/detect';
    const res = await fetch(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        prompts: [],
        box_threshold: 0.15,
        text_threshold: 0.15,
      }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    const regions: any[] = data.regions || [];
    if (regions.length >= 5) return true;
    if (regions.length >= 2 && data.image_width && data.image_height) {
      const imgArea = data.image_width * data.image_height;
      const textArea = regions.reduce((sum: number, r: any) => {
        const w = (r.box.width / 100) * data.image_width;
        const h = (r.box.height / 100) * data.image_height;
        return sum + w * h;
      }, 0);
      if (textArea / imgArea > 0.1) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**\n * Resolves AI images for all image elements in a StoryboardManifest.\n */
export async function resolveManifestImageAssets(
  manifest: StoryboardManifest,
  articleAssets: ArticleAsset[] = [],
  stylePreset: ImageStylePreset | string = 'photo-realistic',
  bypassCache = false
): Promise<StoryboardManifest> {
  const updatedManifest = JSON.parse(JSON.stringify(manifest));

  // Collect all image elements across all scenes
  const imageElements: any[] = [];
  for (const scene of updatedManifest.scenes) {
    for (const element of (scene.layout?.elements || [])) {
      if (element.type === 'image') {
        imageElements.push(element);
      }
    }
  }

  // Track Scene 1 reference output for character and visual consistency across subsequent scenes
  let scene1ReferenceImage: string | undefined = undefined;

  for (const scene of updatedManifest.scenes) {
    const sceneImages = (scene.layout?.elements || []).filter((el: any) => el.type === 'image');

    for (const element of sceneImages) {
      if (element.sourceAssetId && element.sourceAssetId.startsWith('http')) {
        console.log(`[AssetCatalogManager] Re-resolving expired URL for element '${element.id}'`);
      }

      // Check if article asset is a technical diagram/screenshot — keep those
      if (element.sourceAssetId && element.sourceAssetId.startsWith('asset_')) {
        const sourceAsset = articleAssets.find((a: any) => a.id === element.sourceAssetId);
        if (sourceAsset?.url) {
          try {
            const isTechnical = await classifyArticleAsset(sourceAsset.url);
            if (isTechnical) {
              console.log(`[AssetCatalogManager] Keeping technical diagram: ${sourceAsset.id}`);
              element.sourceAssetId = sourceAsset.url;
              if (scene.sceneNumber === 1 && !scene1ReferenceImage) {
                scene1ReferenceImage = sourceAsset.url;
              }
              continue;
            }
          } catch { /* fall through to generate */ }
        }
      }

      const rawAsset = element.content || element.sourceAssetId || 'concept';
      const detailedPrompt = element.imageDescription || element.content || rawAsset;

      // Extract explicit text labels for infographic diagram elements
      const childTexts = (scene.layout?.elements || [])
        .filter((el: any) => el.type === 'text' && el.content)
        .map((el: any) => el.content);

      try {
        let imageUrl: string;
        if (typeof window !== 'undefined') {
          const proxyRes = await fetch('/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: detailedPrompt,
              stylePreset,
              infographicLabels: childTexts,
              referenceImage: scene.sceneNumber > 1 ? scene1ReferenceImage : undefined,
            }),
          });
          if (!proxyRes.ok) throw new Error(`Image proxy returned ${proxyRes.status}`);
          const json = await proxyRes.json();
          imageUrl = json.imageUrl;
        } else {
          const resolved = await getOrGenerateConceptImage(
            rawAsset,
            detailedPrompt,
            stylePreset as ImageStylePreset,
            bypassCache
          );
          imageUrl = resolved.imageUrl;
        }

        element.sourceAssetId = imageUrl;

        // Save Scene 1 output as the reference image signature for subsequent scenes
        if ((scene.sceneNumber === 1 || !scene1ReferenceImage) && imageUrl) {
          scene1ReferenceImage = imageUrl;
          console.log(`[AssetCatalogManager] 📌 Locked Scene 1 reference image signature for character consistency.`);
        }

        console.log(`[AssetCatalogManager] Resolved element '${element.id}' (${stylePreset}): ${imageUrl.substring(0, 60)}...`);
      } catch (err) {
        console.warn(`[AssetCatalogManager] Error resolving image for element '${element.id}':`, err);
      }

      // Delay between requests to avoid rate limits
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return updatedManifest;
}

/**
 * Resolves AI-generated video for scenes classified as `image_to_video`.
 * After images are generated by `resolveManifestImageAssets()`, this function
 * animates the static images into subtle-motion video clips.
 *
 * Only processes scenes where `animationStrategy === 'image_to_video'`.
 * Each image element in qualifying scenes gets a `videoUrl` set.
 */
export async function resolveManifestVideoAssets(
  manifest: StoryboardManifest,
): Promise<StoryboardManifest> {
  const updatedManifest = JSON.parse(JSON.stringify(manifest));

  // Collect all image elements from image_to_video scenes
  const videoScenes = updatedManifest.scenes.filter(
    (s: any) => s.animationStrategy === 'image_to_video'
  );

  if (videoScenes.length === 0) {
    console.log('[AssetCatalogManager] No image_to_video scenes to animate.');
    return updatedManifest;
  }

  console.log(`[AssetCatalogManager] Animating ${videoScenes.length} image_to_video scene(s)...`);

  for (const scene of videoScenes) {
    const imageElements = (scene.layout?.elements || []).filter(
      (e: CanvasElement) => e.type === 'image'
    );

    for (const element of imageElements) {
      const imageUrl = element.sourceAssetId;
      if (!imageUrl) {
        console.warn(`[AssetCatalogManager] No source image for element "${element.id}", skipping video gen.`);
        continue;
      }

      // Skip base64 data URLs — kie.ai requires hosted URLs
      if (imageUrl.startsWith('data:')) {
        console.warn(`[AssetCatalogManager] Element "${element.id}" has base64 image, skipping image-to-video (needs hosted URL).`);
        continue;
      }

      // Build a prompt from the image description
      // For diagram scenes tagged image_to_video, the LLM has rewritten
      // imageDescription to describe animation/motion. Pass it through fully.
      const prompt = element.imageDescription
        ? `${element.imageDescription}. Smooth camera motion, professional quality.`
        : 'subtle camera motion, smooth parallax, professional quality';

      try {
        console.log(`[AssetCatalogManager] Generating video for element "${element.id}" (scene ${scene.sceneNumber})...`);
        const result = await animateImage({
          imageUrl,
          prompt,
          duration: 5,
          motionStrength: 0.3,
        });

        element.videoUrl = result.videoUrl;
        console.log(`[AssetCatalogManager] Video generated for "${element.id}": ${result.videoUrl.substring(0, 60)}...`);
      } catch (err) {
        console.warn(`[AssetCatalogManager] Video generation failed for element "${element.id}":`, err);
        // Fall back to static image — videoUrl stays undefined
      }

      // Delay between video generations to avoid rate limits
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  return updatedManifest;
}

/**
 * Generates full AI video for scenes classified as `text_to_video`.
 * Composes a cinematic prompt from `imageDescription` + `narration`.
 *
 * Only processes scenes where `animationStrategy === 'text_to_video'`.
 * Each scene gets a `videoUrl` on its first image element.
 */
export async function resolveManifestTextToVideoAssets(
  manifest: StoryboardManifest,
): Promise<StoryboardManifest> {
  const updatedManifest = JSON.parse(JSON.stringify(manifest));

  const textToVideoScenes = updatedManifest.scenes.filter(
    (s: any) => s.animationStrategy === 'text_to_video'
  );

  if (textToVideoScenes.length === 0) {
    console.log('[AssetCatalogManager] No text_to_video scenes to generate.');
    return updatedManifest;
  }

  console.log(`[AssetCatalogManager] Generating text-to-video for ${textToVideoScenes.length} scene(s)...`);

  for (const scene of textToVideoScenes) {
    let imageElements = (scene.layout?.elements || []).filter(
      (e: CanvasElement) => e.type === 'image'
    );

    if (imageElements.length === 0) {
      console.log(`[AssetCatalogManager] Scene ${scene.sceneNumber}: no image elements, creating placeholder for video.`);
      const placeholder: CanvasElement = {
        id: `video_placeholder_${scene.sceneNumber}`,
        type: 'image',
        x: 0, y: 0, width: 100, height: 100, zIndex: 1,
        imageDescription: scene.narration || 'Cinematic scene',
      };
      scene.layout = scene.layout || { background: { type: 'solid', value: '#0f172a' }, elements: [] };
      scene.layout.elements = [placeholder, ...(scene.layout.elements || [])];
      imageElements = [placeholder];
    }

    // Compose prompt: use manual videoPrompt if set, otherwise imageDescription + narration
    const customVideoPrompt = (scene as any).videoPrompt;
    const imageDesc = imageElements[0].imageDescription || '';
    const narration = scene.narration || '';

    const prompt = customVideoPrompt
      ? `${customVideoPrompt}. High quality photorealistic render, smooth cinematic motion, professional animation.`
      : imageDesc
        ? `${imageDesc}. Narration context: ${narration.substring(0, 200)}. High quality photorealistic render, smooth cinematic motion, professional animation.`
        : `${narration.substring(0, 300)}. Cinematic motion, professional quality.`;

    try {
      console.log(`[AssetCatalogManager] Generating text-to-video for scene ${scene.sceneNumber}...`);
      const result = await generateVideo({
        prompt,
        duration: Math.min(Math.round(scene.duration || 10), 15), // Match voiceover, max 15s (kie.ai limit)
      });

      // Store video URL on the primary image element
      imageElements[0].videoUrl = result.videoUrl;
      console.log(`[AssetCatalogManager] Text-to-video complete for scene ${scene.sceneNumber}: ${result.videoUrl.substring(0, 60)}...`);
    } catch (err) {
      console.warn(`[AssetCatalogManager] Text-to-video failed for scene ${scene.sceneNumber}:`, err);
      // Fall back to static image
    }

    // Longer delay for text-to-video (more expensive)
    await new Promise(r => setTimeout(r, 5000));
  }

  return updatedManifest;
}
