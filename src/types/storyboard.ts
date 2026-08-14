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

export type AnimationStrategy = 'static' | 'programmatic' | 'image_to_video' | 'text_to_video';

export type EnterAnimationType = 'fade_in' | 'slide_up' | 'scale_in' | 'zoom_in' | 'draw_in' | 'wipe_right';
export type SequencingMode = 'immediate' | 'staggered' | 'progressive';

export interface ElementAnimation {
  type: EnterAnimationType;
  duration: number; // In frames (at 30fps)
  delay: number; // Delay within scene in frames
  sequencing?: SequencingMode; // How elements sequence within the scene
  staggerOffset?: number; // Frames between each element when sequencing='staggered' (default: 10)
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
  /** URL to a generated video (image-to-video or text-to-video). When set, renders as <OffthreadVideo> instead of static <img>. */
  videoUrl?: string;
  enterAnimation?: ElementAnimation;
  highlightOverlay?: HighlightOverlayConfig;
}

export interface DetectedRegion {
  id: string; // "region_server_icon"
  label: string; // "blue server icon"
  boundingBox: {
    x: number; // 0-100%, relative to the IMAGE element (not canvas)
    y: number;
    width: number;
    height: number;
  };
  confidence: number; // 0-1
}

/** A timed focus event: at time T, highlight region R on element E */
export interface RegionFocusEvent {
  regionId: string;
  elementId: string; // CanvasElement.id of the image this region belongs to
  startSeconds: number; // When to start the highlight
  endSeconds: number; // When to stop the highlight
  label: string; // Display label
  pointerEnabled: boolean; // Whether to show the moving pointer for this event
  transition: 'instant' | 'smooth'; // Pointer movement style between regions
}

export type TriggerAction = 'reveal' | 'highlight_off' | 'highlight_on' | 'focus_zoom' | 'focus_region';

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
  /** Scene animation classification — determines render path (programmatic, image_to_video, text_to_video, static) */
  animationStrategy?: AnimationStrategy;
  /** Custom video generation prompt — overrides imageDescription for text_to_video/image_to_video scenes */
  videoPrompt?: string;
  layout: {
    background: SceneBackground;
    clearCanvas?: boolean; // If true, wipes previous scene elements clean for a fresh chapter/finale
    canvasMode?: 'accumulate' | 'clear_canvas';
    elements: CanvasElement[];
  };
  syncHints: SyncHint[];
  detectedRegions?: DetectedRegion[];
  regionFocusEvents?: RegionFocusEvent[];
  /** Original image dimensions from Grounding DINO, for aspect-ratio alignment */
  detectedImageWidth?: number;
  detectedImageHeight?: number;
  /** Per-scene camera instruction (overrides composition-level camera for this scene) */
  camera?: CameraInstruction;
}

export type ImageStylePreset = 'photo-realistic' | 'illustration' | 'whiteboard' | 'chalkboard' | 'chalk-drawing';
export type StoryStylePreset = ImageStylePreset | 'cinematic' | 'flat-vector' | 'infographic';

export interface CameraInstruction {
  preset: 'slow_dolly_in' | 'macro_focus_pull' | 'dutch_angle' | 'crane_up' | 'static' | 'push_to_element' | 'pan_across' | 'parallax_reveal';
  intensity: number;
  durationFrames: number;
  targetElementId?: string;
}

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

/** Per-scene audio produced by synthesizePerSceneSpeech() */
export interface SceneAudio {
  sceneNumber: number;
  audioUrl: string;         // e.g. "scene_1.mp3"
  wordTimestamps: WordTimestamp[];  // isolated to this scene, times relative to 0
  durationSeconds: number;  // from ElevenLabs
}

export interface SubtitleConfig {
  /** Enable subtitle rendering */
  enabled?: boolean;
  /** Font size in px (default 32) */
  fontSize?: number;
  /** Text color hex (default '#FFFFFF') */
  color?: string;
  /** Background bar color behind text (default 'rgba(0,0,0,0.65)') */
  backgroundColor?: string;
  /** Whether to highlight the current spoken word in a different color */
  highlightActiveWord?: boolean;
  /** Color for the currently spoken word (defaults to color) */
  activeWordColor?: string;
}

export interface AnnotationConfig {
  /** Highlight box border color (hex) */
  highlightColor?: string;
  /** Highlight box border width in px */
  highlightBorderWidth?: number;
  /** Laser pointer dot color (hex) */
  pointerColor?: string;
  /** Show highlight boxes at all */
  showHighlights?: boolean;
  /** Show laser pointer dot */
  showPointer?: boolean;
  /** Show slide title and subtitle overlay */
  showTitle?: boolean;
  /** Subtitle configuration */
  subtitle?: SubtitleConfig;
}

export interface ExplainerCompositionProps {
  articleUrl?: string;
  manifest?: StoryboardManifest;
  sceneAudio?: SceneAudio[];
  bgMusicUrl?: string;
  bgMusicTrackId?: string;
  sfxCues?: Array<{
    sceneNumber: number;
    startSeconds: number;
    durationSeconds: number;
    soundType: string;
    volume: number;
  }>;
  camera?: CameraInstruction;
  lighting?: string;
  fps?: number;
  annotationConfig?: AnnotationConfig;
  /** Optional company logo URL — displayed in Scene 1 and closing card */
  logoUrl?: string;
  /** Base URL for serving audio files (e.g. http://localhost:3001) */
  audioBaseUrl?: string;
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
  type: z.enum(['fade_in', 'slide_up', 'scale_in', 'zoom_in', 'draw_in', 'wipe_right']),
  duration: z.number(),
  delay: z.number(),
  sequencing: z.enum(['immediate', 'staggered', 'progressive']).optional(),
  staggerOffset: z.number().optional(),
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
  videoUrl: z.string().optional(),
  enterAnimation: elementAnimationSchema.optional(),
  highlightOverlay: highlightOverlayConfigSchema.optional(),
}); 

export const detectedRegionSchema = z.object({
  id: z.string(),
  label: z.string(),
  boundingBox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  confidence: z.number(),
});

export const regionFocusEventSchema = z.object({
  regionId: z.string(),
  elementId: z.string(),
  startSeconds: z.number(),
  endSeconds: z.number(),
  label: z.string(),
  pointerEnabled: z.boolean(),
  // eslint-disable-next-line @remotion/non-pure-animation -- Zod schema, not a component
  transition: z.enum(['instant', 'smooth']),
});

export const syncHintSchema = z.object({
  text: z.string(),
  triggerAction: z.enum(['reveal', 'highlight_off', 'highlight_on', 'focus_zoom', 'focus_region']),
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
  animationStrategy: z.enum(['static', 'programmatic', 'image_to_video', 'text_to_video']).optional(),
  videoPrompt: z.string().optional(),
  layout: z.object({
    background: sceneBackgroundSchema,
    clearCanvas: z.boolean().default(true),
    canvasMode: z.enum(['accumulate', 'clear_canvas']).default('clear_canvas'),
    elements: z.array(canvasElementSchema),
  }),
  syncHints: z.array(syncHintSchema),
  detectedRegions: z.array(detectedRegionSchema).optional(),
  regionFocusEvents: z.array(regionFocusEventSchema).optional(),
  detectedImageWidth: z.number().optional(),
  detectedImageHeight: z.number().optional(),
  camera: z.object({
    preset: z.enum(['slow_dolly_in', 'macro_focus_pull', 'dutch_angle', 'crane_up', 'static', 'push_to_element', 'pan_across', 'parallax_reveal']),
    intensity: z.number(),
    durationFrames: z.number(),
    targetElementId: z.string().optional(),
  }).optional(),
});

export const storyboardManifestSchema = z.object({
  meta: z.object({
    title: z.string(),
    targetDuration: z.number(),
    stylePreset: z.enum(['photo-realistic', 'illustration', 'chalkboard', 'chalk-drawing', 'cinematic', 'flat-vector', 'whiteboard', 'infographic']),
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

export const sceneAudioSchema = z.object({
  sceneNumber: z.number(),
  audioUrl: z.string(),
  wordTimestamps: z.array(wordTimestampSchema),
  durationSeconds: z.number(),
});

export const explainerCompositionSchema = z.object({
  articleUrl: z.string().optional(),
  manifest: storyboardManifestSchema.optional(),
  sceneAudio: z.array(sceneAudioSchema).optional(),
  fps: z.number().optional(),
});
