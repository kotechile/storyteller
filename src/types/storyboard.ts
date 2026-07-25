import { z } from 'zod';

// ==========================================
// 1. Ingestion & Vision Types
// ==========================================

export interface ImageRegion {
  id: string; // e.g. "region_1"
  label: string; // e.g. "Step 1: Data Collection"
  boundingBox: {
    x: number; // 0-100 percentage
    y: number; // 0-100 percentage
    width: number; // 0-100 percentage
    height: number; // 0-100 percentage
  };
  description: string;
}

export interface VisionAnalysis {
  description: string;
  regions: ImageRegion[];
  textContent: string;
}

export interface ArticleAsset {
  id: string; // "asset_1"
  url: string;
  altText: string;
  caption?: string | null;
  position: number;
  width: number;
  height: number;
  classification?: 'diagram' | 'photo' | 'chart' | 'icon' | 'screenshot';
  visionAnalysis?: VisionAnalysis;
}

export interface ArticleData {
  title: string;
  textContent: string;
  excerpt: string;
  wordCount: number;
  assets: ArticleAsset[];
}

// ==========================================
// 2. Storyboard & Canvas Types (PRD v0.2)
// ==========================================

export type ElementType = 'image' | 'text' | 'highlight_overlay' | 'connector';

export interface ElementAnimation {
  type: 'fade_in' | 'slide_up' | 'scale_in' | 'zoom_in';
  duration: number; // In frames (at 30fps)
  delay: number; // Delay within scene in frames
}

export interface HighlightOverlayConfig {
  targetAssetId: string;
  targetRegion: string; // e.g. "region_1" or "full"
  style: 'glow' | 'dim_others' | 'border';
}

export interface CanvasElement {
  id: string;
  type: ElementType;
  sourceAssetId?: string;
  fromElementId?: string;
  toElementId?: string;
  replacesElementId?: string;
  label?: string;
  connectorStyle?: 'arrow' | 'dashed' | 'curved' | 'line';
  content?: string; // Text for text elements or connector labels
  imageDescription?: string; // Detailed visual description for AI image generation (Flux/DALL-E)
  revealSyncPhrase?: string; // Narration phrase that triggers the element reveal on timeline
  revealTimeSeconds?: number; // Calculated start time in seconds for element reveal
  x: number; // 0-100% canvas width
  y: number; // 0-100% canvas height
  width: number; // 0-100% canvas width
  height: number; // 0-100% canvas height
  zIndex: number;
  enterAnimation?: ElementAnimation;
  highlightOverlay?: HighlightOverlayConfig;
}

export type TriggerAction = 'reveal' | 'highlight_off' | 'highlight_on' | 'focus_zoom';

export interface SyncHint {
  text: string; // Substring of narration to sync with
  triggerAction: TriggerAction;
  targetElementId: string;
  targetRegionId?: string;
  audioStart?: number; // In seconds
  audioEnd?: number; // In seconds
}

export interface SceneBackground {
  type: 'image' | 'gradient' | 'solid';
  value: string; // Asset ID, gradient CSS string, or Hex color
}

export interface StoryboardScene {
  sceneNumber: number;
  narration: string;
  duration: number; // Estimated seconds
  layout: {
    background: SceneBackground;
    clearCanvas?: boolean; // If true, wipes previous scene elements clean for a fresh chapter/finale
    canvasMode?: 'accumulate' | 'clear_canvas';
    elements: CanvasElement[];
  };
  syncHints: SyncHint[];
}

export type ImageStylePreset = 'photo-realistic' | 'illustration' | 'whiteboard' | 'chalk-drawing';
export type StoryStylePreset = ImageStylePreset | 'cinematic' | 'flat-vector' | 'infographic';

export interface StoryboardManifest {
  meta: {
    title: string;
    targetDuration: number;
    stylePreset: StoryStylePreset;
    primaryColor?: string;
    fontFamily?: string;
  };
  scenes: StoryboardScene[];
}

// ==========================================
// 3. Audio & Timestamp Sync Types
// ==========================================

export interface WordTimestamp {
  word: string;
  start: number; // Seconds from start
  end: number; // Seconds from start
}

export interface TTSOutput {
  audioUrl: string;
  wordTimestamps: WordTimestamp[];
  duration: number; // In seconds
}

export interface ExplainerCompositionProps {
  articleUrl?: string;
  manifest?: StoryboardManifest;
  wordTimestamps?: WordTimestamp[];
  audioUrl?: string;
  fps?: number;
}

// ==========================================
// 4. Zod Validation Schemas
// ==========================================

export const imageRegionSchema = z.object({
  id: z.string(),
  label: z.string(),
  boundingBox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  description: z.string(),
});

export const visionAnalysisSchema = z.object({
  description: z.string(),
  regions: z.array(imageRegionSchema),
  textContent: z.string(),
});

export const articleAssetSchema = z.object({
  id: z.string(),
  url: z.string(),
  altText: z.string(),
  caption: z.string().nullable().optional(),
  position: z.number(),
  width: z.number(),
  height: z.number(),
  classification: z.enum(['diagram', 'photo', 'chart', 'icon', 'screenshot']).optional(),
  visionAnalysis: visionAnalysisSchema.optional(),
});

export const elementAnimationSchema = z.object({
  type: z.enum(['fade_in', 'slide_up', 'scale_in', 'zoom_in']),
  duration: z.number(),
  delay: z.number(),
});

export const highlightOverlayConfigSchema = z.object({
  targetAssetId: z.string(),
  targetRegion: z.string(),
  style: z.enum(['glow', 'dim_others', 'border']),
});

export const canvasElementSchema = z.object({
  id: z.string(),
  type: z.enum(['image', 'text', 'highlight_overlay', 'connector']),
  sourceAssetId: z.string().optional(),
  fromElementId: z.string().optional(),
  toElementId: z.string().optional(),
  replacesElementId: z.string().optional(),
  label: z.string().optional(),
  connectorStyle: z.enum(['arrow', 'dashed', 'curved', 'line']).optional(),
  content: z.string().optional(),
  imageDescription: z.string().optional(),
  revealSyncPhrase: z.string().optional(),
  revealTimeSeconds: z.number().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  zIndex: z.number(),
  enterAnimation: elementAnimationSchema.optional(),
  highlightOverlay: highlightOverlayConfigSchema.optional(),
});

export const syncHintSchema = z.object({
  text: z.string(),
  triggerAction: z.enum(['reveal', 'highlight_off', 'highlight_on', 'focus_zoom']),
  targetElementId: z.string(),
  targetRegionId: z.string().optional(),
  audioStart: z.number().optional(),
  audioEnd: z.number().optional(),
});

export const sceneBackgroundSchema = z.object({
  type: z.enum(['image', 'gradient', 'solid']),
  value: z.string(),
});

export const storyboardSceneSchema = z.object({
  sceneNumber: z.number(),
  narration: z.string(),
  duration: z.number(),
  layout: z.object({
    background: sceneBackgroundSchema,
    elements: z.array(canvasElementSchema),
  }),
  syncHints: z.array(syncHintSchema),
});

export const storyboardManifestSchema = z.object({
  meta: z.object({
    title: z.string(),
    targetDuration: z.number(),
    stylePreset: z.enum(['photo-realistic', 'illustration', 'chalk-drawing', 'cinematic', 'flat-vector', 'whiteboard', 'infographic']),
    primaryColor: z.string().optional(),
    fontFamily: z.string().optional(),
  }),
  scenes: z.array(storyboardSceneSchema),
});

export const wordTimestampSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
});

export const explainerCompositionSchema = z.object({
  articleUrl: z.string().optional(),
  manifest: storyboardManifestSchema.optional(),
  wordTimestamps: z.array(wordTimestampSchema).optional(),
  audioUrl: z.string().optional(),
  fps: z.number().optional(),
});
