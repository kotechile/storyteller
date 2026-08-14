import { ArticleData, StoryboardManifest } from '../types/storyboard';
import { resolveLlmModel } from './supabaseClient';
import { generateStoryboardFromArticle, NarrativeEngineOptions, callLlm, refineImagePromptsWithArtDirector } from './narrativeEngine';
import { resolveManifestImageAssets, resolveManifestVideoAssets, resolveManifestTextToVideoAssets } from './assetCatalogManager';

export type ContentType = 'tutorial' | 'news_briefing' | 'cinematic_story' | 'technical_explainer';

export interface ContentContext {
  contentType: ContentType;
  targetAudience: string;
  recommendedSceneCount: number;
  narrativeTone: string;
  estimatedVideoDurationMinutes: number;
}

export interface ContentEngineResult {
  context: ContentContext;
  manifest: StoryboardManifest;
  usedFallback: boolean;
}

/**
 * Pre-processes input article to determine content type, target audience, and ideal scene count before storyboard creation.
 */
export async function generateContextAwareStoryboard(
  article: ArticleData,
  options: NarrativeEngineOptions = {}
): Promise<ContentEngineResult> {
  const llmConfig = await resolveLlmModel('content_classification');

  let context: ContentContext = {
    contentType: 'technical_explainer',
    targetAudience: 'Professionals aged 22-35 interested in learning',
    recommendedSceneCount: 6,
    narrativeTone: 'Relaxed solo podcaster: conversational, analogy-rich, story-driven, with rhetorical questions and direct audience engagement',
    estimatedVideoDurationMinutes: 8,
  };

  if (llmConfig.apiKey) {
    try {
      const classificationPrompt = `Analyze this article and return JSON with these fields:
- "contentType": one of "tutorial", "news_briefing", "cinematic_story", "technical_explainer"
- "targetAudience": who this content is for (e.g., "software engineers", "marketing professionals")
- "recommendedSceneCount": number between 5 and 15 (more scenes for complex or technical topics, fewer for simple news briefings)
- "narrativeTone": brief description (e.g., "authoritative and technical", "casual and story-driven")
- "estimatedVideoDurationMinutes": number between 5 and 15

Article Title: "${article.title}"
Article Excerpt: "${article.excerpt}"
Article Content (first 2000 chars): "${article.textContent.substring(0, 2000)}"

Return ONLY valid JSON.`;

      const text = await callLlm(llmConfig, classificationPrompt, true);
      if (text) {
        const parsed = JSON.parse(text);
        if (parsed.contentType) context = { ...context, ...parsed };
      }
    } catch (err) {
      console.warn('[ContextEngine] Classification failed, using defaults:', err);
    }
  }

  const { manifest, usedFallback } = await generateStoryboardFromArticle(article, {
    ...options,
    recommendedSceneCount: context.recommendedSceneCount,
    contentType: context.contentType,
    focusTopics: options.focusTopics,
  });

  // Art Director refinement: Gemini analyzes each scene's narration and
  // rewrites imageDescriptions into structured diagram prompts
  console.log('[ContextEngine] Running Art Director refinement on image descriptions...');
  const directedManifest = await refineImagePromptsWithArtDirector(manifest, article.title, options.stylePreset);

  console.log('[ContextEngine] Resolving AI image assets for all storyboard scenes...');
  const resolvedManifest = await resolveManifestImageAssets(
    directedManifest,
    article.assets || [],
    options.stylePreset || 'whiteboard',
    options.bypassCache || false
  );

  // NOTE: Video generation now runs in the background AFTER the editor opens.
  // See StoryStudio.tsx → generateVideosInBackground()

  return { context, manifest: resolvedManifest, usedFallback };
}

/**
 * Runs video generation in the background for scenes with animationStrategy.
 * Call this AFTER the editor is visible so it doesn't block the UI.
 */
export async function generateVideosForManifest(
  manifest: StoryboardManifest,
  onProgress?: (msg: string) => void,
  onSceneProgress?: (sceneNum: number, status: 'started' | 'completed' | 'failed') => void,
  onComplete?: (updatedManifest: StoryboardManifest) => void
): Promise<StoryboardManifest> {
  // Phase 2: Animate image_to_video scenes
  onProgress?.('Generating image-to-video animations...');
  console.log('[ContextEngine] Resolving AI video assets for image_to_video scenes...');
  let videoManifest = manifest;
  try {
    // Track per-scene progress
    const i2vScenes = manifest.scenes.filter(s => (s as any).animationStrategy === 'image_to_video');
    for (const scene of i2vScenes) {
      onSceneProgress?.(scene.sceneNumber, 'started');
    }
    videoManifest = await resolveManifestVideoAssets(manifest);
    for (const scene of i2vScenes) {
      onSceneProgress?.(scene.sceneNumber, 'completed');
    }
  } catch (err: any) {
    console.warn('[ContextEngine] Image-to-video generation failed (non-fatal):', err.message);
    manifest.scenes
      .filter(s => (s as any).animationStrategy === 'image_to_video')
      .forEach(s => onSceneProgress?.(s.sceneNumber, 'failed'));
  }

  // Phase 3: Generate full text_to_video
  onProgress?.('Generating text-to-video cinematic scenes...');
  console.log('[ContextEngine] Resolving AI video assets for text_to_video scenes...');
  let finalManifest = videoManifest;
  try {
    const t2vScenes = videoManifest.scenes.filter(s => (s as any).animationStrategy === 'text_to_video');
    for (const scene of t2vScenes) {
      onSceneProgress?.(scene.sceneNumber, 'started');
    }
    finalManifest = await resolveManifestTextToVideoAssets(videoManifest);
    for (const scene of t2vScenes) {
      onSceneProgress?.(scene.sceneNumber, 'completed');
    }
  } catch (err: any) {
    console.warn('[ContextEngine] Text-to-video generation failed (non-fatal):', err.message);
    videoManifest.scenes
      .filter(s => (s as any).animationStrategy === 'text_to_video')
      .forEach(s => onSceneProgress?.(s.sceneNumber, 'failed'));
  }

  onComplete?.(finalManifest);
  return finalManifest;
}
