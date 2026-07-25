import fs from 'fs';
import path from 'path';
import { generateFluxImage, FluxGenerationResult } from './fluxImageGen';
import { ImageStylePreset } from '../types/storyboard';
import { getApiKey } from './supabaseClient';

export interface CatalogEntry {
  conceptKey: string;
  imageUrl: string;
  provider: string;
  prompt: string;
  generatedAt: string;
}

export type AssetCatalogMap = Record<string, CatalogEntry>;

const CATALOG_PATH = path.join(process.cwd(), 'public', 'asset_catalog.json');
const GENERATED_ASSETS_DIR = path.join(process.cwd(), 'public', 'generated_assets');

/**
 * Ensures the public asset catalog JSON and image storage directories exist.
 */
function ensureCatalogStorage() {
  if (!fs.existsSync(GENERATED_ASSETS_DIR)) {
    fs.mkdirSync(GENERATED_ASSETS_DIR, { recursive: true });
  }
  if (!fs.existsSync(CATALOG_PATH)) {
    fs.writeFileSync(CATALOG_PATH, JSON.stringify({}, null, 2));
  }
}

/**
 * Loads the persistent asset catalog from public/asset_catalog.json.
 */
export function loadAssetCatalog(): AssetCatalogMap {
  ensureCatalogStorage();
  try {
    const raw = fs.readFileSync(CATALOG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[AssetCatalogManager] Error reading catalog file, initializing empty catalog.', err);
    return {};
  }
}

/**
 * Saves an entry into the persistent JSON asset catalog.
 */
export function saveCatalogEntry(entry: CatalogEntry): AssetCatalogMap {
  const catalog = loadAssetCatalog();
  catalog[entry.conceptKey] = entry;
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
  console.log(`[AssetCatalogManager] Saved '${entry.conceptKey}' to catalog: ${entry.imageUrl}`);
  return catalog;
}

/**
 * Downloads a remote image URL or writes a Base64 string to public/generated_assets/
 */
async function downloadAndSaveImage(imageUrl: string, conceptKey: string): Promise<string> {
  ensureCatalogStorage();
  const filename = `${conceptKey}_${Date.now()}.png`;
  const relativePath = `generated_assets/${filename}`;
  const absolutePath = path.join(process.cwd(), 'public', relativePath);

  if (imageUrl.startsWith('data:image')) {
    const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(absolutePath, Buffer.from(base64Data, 'base64'));
    return relativePath;
  }

  if (imageUrl.startsWith('http')) {
    try {
      const response = await fetch(imageUrl);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(absolutePath, Buffer.from(arrayBuffer));
        return relativePath;
      }
    } catch (err) {
      console.warn(`[AssetCatalogManager] Failed to download image from ${imageUrl}, storing URL directly.`, err);
    }
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
  stylePreset: ImageStylePreset = 'photo-realistic'
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
  if (catalog[cleanKey]) {
    const existing = catalog[cleanKey];
    console.log(`[AssetCatalogManager] 🎯 Cache Hit! Reusing catalog image for '${cleanKey}': ${existing.imageUrl}`);
    return {
      imageUrl: existing.imageUrl,
      fromCache: true,
      provider: existing.provider,
    };
  }

  // 2. Not in catalog: Fetch API key from Supabase (or fallback env) and generate with Flux
  console.log(`[AssetCatalogManager] 🎨 Concept '${cleanKey}' (${stylePreset}) not in catalog. Generating with Flux API...`);
  
  // Also check if Supabase has a flux / replicate / openai key
  const fluxKey = (await getApiKey('flux')) || (await getApiKey('replicate')) || (await getApiKey('kie.ai'));
  if (fluxKey) {
    console.log(`[AssetCatalogManager] Resolved Flux API key from Supabase/Env.`);
  }

  const genResult: FluxGenerationResult = await generateFluxImage({
    prompt: prompt || conceptName,
    stylePreset,
    aspectRatio: '1:1',
    width: 1024,
    height: 1024,
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
