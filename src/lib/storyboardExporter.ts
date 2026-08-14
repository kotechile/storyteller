import { StoryboardManifest, SceneAudio } from '../types/storyboard';

/**
 * Format a StoryboardManifest and SceneAudio into a clean, human-readable text script.
 * Excludes binary images and base64 data URIs.
 */
export function formatManifestAsText(manifest: StoryboardManifest, sceneAudio?: SceneAudio[]): string {
  const m = manifest as any;
  const meta = m.meta || {};
  let out = `================================================================================\n`;
  out += `STORYBOARD SCRIPT & SCENE BREAKDOWN\n`;
  if (meta.title) out += `Title: ${meta.title}\n`;
  if (meta.topic) out += `Topic: ${meta.topic}\n`;
  out += `Total Duration: ${meta.targetDuration || 0}s | Scenes: ${manifest.scenes?.length || 0}\n`;
  out += `================================================================================\n\n`;

  manifest.scenes?.forEach((scene: any, index: number) => {
    const sa = sceneAudio?.find((s) => s.sceneNumber === scene.sceneNumber);
    const dur = sa?.durationSeconds || scene.duration || 10;
    out += `--- SCENE ${scene.sceneNumber || index + 1}: ${scene.title || `Scene ${scene.sceneNumber || index + 1}`} (Duration: ${dur.toFixed(1)}s) ---\n`;
    if (scene.visualDescription) {
      out += `Visual Description: ${scene.visualDescription}\n`;
    }
    out += `Narration:\n"${scene.narration || ''}"\n\n`;

    const elements = scene.layout?.elements || [];
    if (elements.length > 0) {
      out += `Layout Elements:\n`;
      elements.forEach((el: any) => {
        let content = el.content || el.imageDescription || el.label || '';
        if (content.startsWith('data:')) {
          content = '[Binary Image Data]';
        }
        out += `  - [${(el.type || 'element').toUpperCase()}] ${content} (x:${el.x}%, y:${el.y}%, w:${el.width}%, h:${el.height}%)\n`;
      });
      out += `\n`;
    }
    out += `--------------------------------------------------------------------------------\n\n`;
  });

  return out;
}

/**
 * Returns a clean JSON object representation of the storyboard without binary images/base64 strings.
 */
export function cleanManifestForJson(manifest: StoryboardManifest, sceneAudio?: SceneAudio[]): object {
  const cleanedScenes = manifest.scenes?.map((scene: any) => {
    const elements = scene.layout?.elements?.map((el: any) => {
      let content = el.content || el.imageDescription || el.label || '';
      if (content.startsWith('data:')) {
        content = `[Binary Image Data: ${content.substring(0, 40)}...]`;
      }
      return {
        id: el.id,
        type: el.type,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        zIndex: el.zIndex,
        content,
      };
    });

    const sa = sceneAudio?.find((s: any) => s.sceneNumber === scene.sceneNumber);

    return {
      sceneNumber: scene.sceneNumber,
      title: scene.title || `Scene ${scene.sceneNumber}`,
      durationSeconds: sa?.durationSeconds || scene.duration || 10,
      visualDescription: scene.visualDescription || '',
      narration: scene.narration,
      audioUrl: sa?.audioUrl || `scene_${scene.sceneNumber}.mp3`,
      layout: scene.layout ? { ...scene.layout, elements } : undefined,
    };
  });

  return {
    meta: manifest.meta,
    scenes: cleanedScenes,
  };
}
