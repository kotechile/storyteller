import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createClient } from '@supabase/supabase-js';
import { buildStylePrompt } from './src/lib/fluxImageGen';

function supabaseApiProxyPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'supabase-api-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // 1. Endpoint: /api/llm-config
        if (req.url?.startsWith('/api/llm-config')) {
          try {
            const url = env.SUPABASE_URL || process.env.SUPABASE_URL || 'https://urxwwvgrlrcnfqgwwahv.supabase.co';
            const key =
              env.SUPABASE_SERVICE_ROLE_KEY ||
              env.SUPABASE_SERVICE_KEY ||
              env.SUPABASE_KEY ||
              process.env.SUPABASE_SERVICE_ROLE_KEY ||
              process.env.SUPABASE_KEY ||
              '';

            const supabase = createClient(url, key, {
              auth: { persistSession: false, autoRefreshToken: false },
            });

            // Fetch llm_models selecting row where is_default = true
            const { data: models, error: modelsErr } = await supabase
              .from('llm_models')
              .select('*');

            if (modelsErr || !models || models.length === 0) {
              console.warn('[ViteServerProxy] Error fetching llm_models:', modelsErr);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: modelsErr?.message || 'No models found in llm_models table' }));
              return;
            }

            // Pick the default model (preferring rows with a valid linked API key)
            let defaultModel = models.find(
              (m) => (m.is_default === true || m.is_default === 'true' || m.is_default === 1) && m.api_keys_id
            );
            if (!defaultModel) {
              defaultModel = models.find((m) => m.is_default === true || m.is_default === 'true' || m.is_default === 1) || models[0];
            }
            let apiKey: string | null = null;

            // Resolve API key from api_keys table via api_keys_id foreign key
            if (defaultModel.api_keys_id) {
              const { data: keyRow, error: keyErr } = await supabase
                .from('api_keys')
                .select('key_value')
                .eq('id', defaultModel.api_keys_id)
                .maybeSingle();

              if (keyRow?.key_value) {
                apiKey = keyRow.key_value;
              } else if (keyErr) {
                console.warn('[ViteServerProxy] Error querying api_keys by api_keys_id:', keyErr);
              }
            }

            // Fallback 1: search api_keys table by provider name
            if (!apiKey) {
              const { data: keyRow } = await supabase
                .from('api_keys')
                .select('key_value')
                .ilike('provider', `%${defaultModel.provider}%`)
                .limit(1)
                .maybeSingle();
              if (keyRow?.key_value) apiKey = keyRow.key_value;
            }

            // Fallback 2: fallback to environment variables (GEMINI_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY)
            if (!apiKey) {
              apiKey =
                env.GEMINI_API_KEY ||
                env.OPENAI_API_KEY ||
                env.DEEPSEEK_API_KEY ||
                process.env.GEMINI_API_KEY ||
                process.env.OPENAI_API_KEY ||
                process.env.DEEPSEEK_API_KEY ||
                null;
            }

            const provider = (defaultModel.provider || 'deepseek').trim().toLowerCase();
            const modelName = defaultModel.model_name || defaultModel.name || 'deepseek-v4-flash';

            console.log(`[ViteServerProxy] Resolved is_default model: "${modelName}" (provider: ${provider}). Key present: ${!!apiKey}`);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                modelName,
                provider,
                apiKey,
                baseUrl: defaultModel.base_url || (provider === 'deepseek' ? 'https://api.deepseek.com' : undefined),
              })
            );
          } catch (err: any) {
            console.error('[ViteServerProxy] Exception resolving LLM config:', err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message || err }));
          }
          return;
        }

        // 1.5. Endpoint: /api/video-config (resolve video model from Supabase — server-side only)
        if (req.url?.startsWith('/api/video-config')) {
          try {
            const { resolveVideoModel } = await import('./src/lib/supabaseClient');
            const config = await resolveVideoModel('diagram_creator');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(config));
          } catch (err: any) {
            console.error('[ViteServerProxy] Exception resolving video config:', err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message || err }));
          }
          return;
        }

        // 2. Endpoint: /api/proxy-llm (executes LLM calls in Node.js server context to avoid CORS / path errors)
        if (req.url?.startsWith('/api/proxy-llm')) {
          let bodyStr = '';
          req.on('data', (chunk) => {
            bodyStr += chunk;
          });
          req.on('end', async () => {
            try {
              const { endpoint, headers, body } = JSON.parse(bodyStr);
              console.log(`[ViteServerProxy] Proxying LLM request to: ${endpoint} (model: ${body?.model || 'unknown'})`);

              const llmRes = await fetch(endpoint, {
                method: 'POST',
                headers: headers || { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });

              const resText = await llmRes.text();
              res.statusCode = llmRes.status;
              res.setHeader('Content-Type', 'application/json');
              res.end(resText);
            } catch (err: any) {
              console.error('[ViteServerProxy] Proxy LLM exception:', err);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: { message: err.message || 'LLM Proxy Server Error' } }));
            }
          });
          return;
        }

        // 3. Endpoint: /api/generate-image (browser-safe image generation via Gemini → Pollinations fallback)
        if (req.url?.startsWith('/api/generate-image')) {
          let bodyStr = '';
          req.on('data', (chunk) => { bodyStr += chunk; });
          req.on('end', async () => {
            try {
              const { prompt, stylePreset, infographicLabels, referenceImage } = JSON.parse(bodyStr);
              const { buildStylePrompt } = await import('./src/lib/fluxImageGen');
              const wrappedPrompt = buildStylePrompt(prompt, stylePreset || 'illustration', infographicLabels, referenceImage);
              console.log(`[ViteServerProxy] Generating ${stylePreset || 'illustration'} image with Nano Banana Pro prompt assembly...`);

              // 1. Try the configured image model (Gemini, Flux, Kie.ai, etc.)
              try {
                const { generateFluxImage } = await import('./src/lib/fluxImageGen');
                const result = await generateFluxImage({
                  prompt: prompt, // raw prompt — generateFluxImage wraps it with buildStylePrompt
                  stylePreset: (stylePreset || 'illustration') as any,
                  width: 1920,
                  height: 1080,
                  aspectRatio: '16:9',
                  infographicLabels,
                  referenceImage,
                });
                console.log(`[ViteServerProxy] Image result: provider=${result.provider}, model=${result.modelUsed}, url=${result.imageUrl.substring(0, 60)}...`);
                // Only use if it's NOT Pollinations fallback
                if (result.provider !== 'pollinations' && result.provider !== 'pollinations_ai') {
                  console.log(`[ViteServerProxy] Generated with ${result.provider} (${result.modelUsed})`);
                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ imageUrl: result.imageUrl, provider: result.provider }));
                  return;
                }
                console.log(`[ViteServerProxy] Got Pollinations fallback (${result.provider}), trying direct Pollinations URL...`);
              } catch (err: any) {
                console.warn('[ViteServerProxy] Image model failed, falling back to Pollinations:', err.message);
              }

              // 2. Fallback: Pollinations free API with retry
              let lastError: Error | null = null;
              for (let attempt = 0; attempt < 4; attempt++) {
                try {
                  const encoded = encodeURIComponent(wrappedPrompt);
                  const pollinationsUrl = `https://image.pollinations.ai/prompt/${encoded}?width=1920&height=1080&model=flux&nologo=true&seed=${Math.floor(Math.random() * 10000)}`;
                  const imageRes = await fetch(pollinationsUrl);
                  if (imageRes.status === 429) {
                    const delay = Math.pow(2, attempt) * 1500 + Math.random() * 1000;
                    console.log(`[ViteServerProxy] Rate limited (429), retrying in ${(delay/1000).toFixed(1)}s (attempt ${attempt + 1}/4)...`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                  }
                  if (!imageRes.ok) throw new Error(`Pollinations returned ${imageRes.status}`);
                  const imageBuffer = await imageRes.arrayBuffer();
                  const base64 = Buffer.from(imageBuffer).toString('base64');
                  const dataUrl = `data:image/png;base64,${base64}`;
                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ imageUrl: dataUrl, provider: 'pollinations' }));
                  return;
                } catch (err: any) {
                  lastError = err;
                  if (err.message?.includes('429')) continue;
                  break; // non-rate-limit error — don't retry
                }
              }
              throw lastError || new Error('Pollinations failed after retries');
            } catch (err: any) {
              console.error('[ViteServerProxy] Image generation failed:', err.message);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }

        // 4. Endpoint: /api/generate-tts-per-scene (per-scene ElevenLabs synthesis)
        // MUST be checked BEFORE /api/generate-tts to avoid prefix collision
        if (req.url?.startsWith('/api/generate-tts-per-scene')) {
          let bodyStr = '';
          req.on('data', (chunk) => { bodyStr += chunk; });
          req.on('end', async () => {
            try {
              const { scenes, voiceId, stability, similarityBoost, speed } = JSON.parse(bodyStr);
              const { synthesizePerSceneSpeech } = await import('./src/lib/elevenlabsTts');
              const result = await synthesizePerSceneSpeech(
                scenes,
                { voiceId: voiceId || undefined, stability, similarityBoost, speed }
              );
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, sceneAudio: result }));
            } catch (err: any) {
              console.error('[ViteServerProxy] Per-scene TTS generation failed:', err.message);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }

        // 5. Endpoint: /api/save-manifest (persist manifest + sceneAudio to disk)
        if (req.url?.startsWith('/api/save-manifest') && req.method === 'POST') {
          let bodyStr = '';
          req.on('data', (chunk) => { bodyStr += chunk; });
          req.on('end', async () => {
            try {
              const fs = await import('fs');
              const path = await import('path');
              const { manifest, sceneAudio, annotationConfig } = JSON.parse(bodyStr);
              const outDir = path.join(process.cwd(), 'public');
              fs.mkdirSync(outDir, { recursive: true });
              const outputPath = path.join(outDir, 'latest_manifest.json');
              // Save full state: manifest + sceneAudio + annotationConfig for reload survival
              const payload: any = { manifest };
              if (sceneAudio && sceneAudio.length > 0) {
                payload.sceneAudio = sceneAudio;
              }
              if (annotationConfig) {
                payload.annotationConfig = annotationConfig;
              }
              fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }

        // 6. Endpoint: /api/render-video (save state + spawn remotion render)
        if (req.url?.startsWith('/api/render-video') && req.method === 'POST') {
          let bodyStr = '';
          req.on('data', (chunk) => { bodyStr += chunk; });
          req.on('end', async () => {
            try {
              const fs = await import('fs');
              const path = await import('path');
              const { manifest, sceneAudio, bgMusicUrl, camera, lighting, annotationConfig, logoUrl } = JSON.parse(bodyStr);

              const outDir = path.join(process.cwd(), 'out');
              fs.mkdirSync(outDir, { recursive: true });

              // Compute scene boundaries
              let cumulative = 0;
              const sceneBoundaries = manifest.scenes.map((s: any) => {
                const sa = (sceneAudio || []).find((a: any) => a.sceneNumber === s.sceneNumber);
                const dur = s.duration || sa?.durationSeconds || 10;
                const b = { sceneNumber: s.sceneNumber, startSeconds: cumulative, durationSeconds: dur };
                cumulative += dur;
                return b;
              });

              const payload = {
                manifest,
                sceneAudio: sceneAudio || [],
                sceneBoundaries,
                sfxCues: [],
                audioDurationSeconds: cumulative,
                bgMusicUrl: bgMusicUrl || undefined,
                camera: camera || undefined,
                lighting: lighting || undefined,
                annotationConfig: annotationConfig || undefined,
                logoUrl: logoUrl || undefined,
              };

              const payloadPath = path.join(outDir, 'generated_storyboard.json');
              fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2));

              // Write clean text file (without binary images) and clean JSON export
              const txtExportPath = path.join(outDir, 'storyboard.txt');
              const jsonExportPath = path.join(outDir, 'storyboard_clean.json');
              fs.writeFileSync(txtExportPath, formatManifestAsText(manifest, sceneAudio));
              fs.writeFileSync(jsonExportPath, JSON.stringify(cleanManifestForJson(manifest, sceneAudio), null, 2));

              // Also save for Remotion Studio preview
              const srcLibDir = path.join(process.cwd(), 'src', 'lib');
              fs.mkdirSync(srcLibDir, { recursive: true });
              fs.writeFileSync(path.join(srcLibDir, 'latestStory.json'), JSON.stringify(payload, null, 2));

              const videoPath = path.join(outDir, 'generated_video.mp4');
              // Remove old render if exists so status endpoint can detect fresh output
              try { fs.unlinkSync(videoPath); } catch {}

              const remotionBin = path.join(process.cwd(), 'node_modules', '.bin', 'remotion');
              const useLocalBin = fs.existsSync(remotionBin);
              const cmd = useLocalBin ? remotionBin : 'npx';
              const args = useLocalBin
                ? ['render', 'src/index.ts', 'StorytellerExplainer', videoPath, `--props=${payloadPath}`, '--codec=h264', '--concurrency=1']
                : ['remotion', 'render', 'src/index.ts', 'StorytellerExplainer', videoPath, `--props=${payloadPath}`, '--codec=h264', '--concurrency=1'];

              console.log(`[RenderProc] Executing: ${cmd} ${args.join(' ')}`);

              // Reset current render job tracking state
              (globalThis as any).__currentRenderJob = {
                id: String(Date.now()),
                done: false,
                success: false,
                renderedFrames: 0,
                totalFrames: 0,
                percent: 0,
                error: '',
              };

              // Spawn render in background
              const { spawn } = await import('child_process');
              const renderProc = spawn(cmd, args, {
                cwd: process.cwd(),
                stdio: 'pipe',
              });

              const logPath = path.join(outDir, 'render_log.txt');
              const logStream = fs.createWriteStream(logPath);

              renderProc.stdout?.on('data', (chunk) => {
                logStream.write(chunk);
                const text = chunk.toString();
                const match = text.match(/Rendered\s+(\d+)\/(\d+)/i);
                const job = (globalThis as any).__currentRenderJob;
                if (match && job) {
                  job.renderedFrames = parseInt(match[1], 10);
                  job.totalFrames = parseInt(match[2], 10);
                  if (job.totalFrames > 0) {
                    job.percent = Math.min(99, Math.round((job.renderedFrames / job.totalFrames) * 100));
                  }
                }
              });

              renderProc.stderr?.on('data', (chunk) => {
                logStream.write(chunk);
              });

              renderProc.on('close', (code: number) => {
                fs.appendFileSync(logPath, `\n[Render] Exit code: ${code}\n`);
                console.log(`[RenderProc] Process finished with exit code ${code}`);
                const job = (globalThis as any).__currentRenderJob;
                if (job) {
                  job.done = true;
                  job.success = code === 0;
                  job.percent = code === 0 ? 100 : job.percent;
                  if (code !== 0) {
                    job.error = `Render process exited with code ${code}. Check out/render_log.txt for details.`;
                  }
                }
              });

              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                success: true,
                jobId: (globalThis as any).__currentRenderJob.id,
                message: 'Render started',
                duration: cumulative,
                scenes: manifest.scenes.length,
              }));
            } catch (err: any) {
              console.error('[ViteServerProxy] Render prep failed:', err.message);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }

        // 7. Endpoint: /api/render-status (poll render progress)
        if (req.url?.startsWith('/api/render-status')) {
          try {
            const fs = await import('fs');
            const path = await import('path');
            const videoPath = path.join(process.cwd(), 'out', 'generated_video.mp4');
            const exists = fs.existsSync(videoPath);
            const size = exists ? fs.statSync(videoPath).size : 0;
            const job = (globalThis as any).__currentRenderJob;

            const isDone = job ? job.done : (exists && size > 100000);
            const isSuccess = job ? job.success : true;
            const percent = job ? job.percent : (isDone ? 100 : 0);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              done: isDone,
              success: isSuccess,
              percent,
              renderedFrames: job?.renderedFrames || 0,
              totalFrames: job?.totalFrames || 0,
              error: job?.error || '',
              size,
              path: videoPath,
            }));
          } catch (err: any) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ done: false, percent: 0, size: 0 }));
          }
          return;
        }

        // 8. Serve static files from out/ directory (e.g. /out/generated_video.mp4)
        if (req.url?.startsWith('/out/')) {
          try {
            const fs = await import('fs');
            const path = await import('path');
            const relativePath = req.url.split('?')[0].replace(/^\/out\//, '');
            const filePath = path.join(process.cwd(), 'out', relativePath);
            if (fs.existsSync(filePath)) {
              const stat = fs.statSync(filePath);
              const isVideo = filePath.endsWith('.mp4');
              res.writeHead(200, {
                'Content-Type': isVideo ? 'video/mp4' : 'application/octet-stream',
                'Content-Length': stat.size,
                'Accept-Ranges': 'bytes',
              });
              fs.createReadStream(filePath).pipe(res);
              return;
            }
          } catch (err) {}
        }

        // 9. Endpoint: /api/dino — proxy to Grounding DINO Python backend
        if (req.url?.startsWith('/api/dino')) {
          try {
            const targetPath = req.url!.replace('/api/dino', '');
            const dinoUrl = `http://127.0.0.1:8001${targetPath}`;

            let bodyStr = '';
            req.on('data', (chunk) => { bodyStr += chunk; });
            req.on('end', async () => {
              try {
                const dinoRes = await fetch(dinoUrl, {
                  method: req.method || 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: bodyStr || undefined,
                });
                const resText = await dinoRes.text();
                res.statusCode = dinoRes.status;
                res.setHeader('Content-Type', 'application/json');
                res.end(resText);
              } catch (err: any) {
                res.statusCode = 502;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: `DINO backend unreachable: ${err.message}` }));
              }
            });
          } catch (err: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // Inject env vars into process.env so dynamic imports (proxy middleware) can read them
  for (const [key, value] of Object.entries(env)) {
    if (!process.env[key]) process.env[key] = value;
  }

  const supabaseUrl = env.SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseKey =
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_KEY ||
    env.SUPABASE_KEY ||
    env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    '';

  return {
    plugins: [
      react(),
      tailwindcss(),
      supabaseApiProxyPlugin(env),
      {
        name: 'root-redirect',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url === '/' || req.url === '/index.html') {
              res.writeHead(302, { Location: '/studio.html' });
              res.end();
              return;
            }
            next();
          });
        },
      },
    ],
    root: '.',
    define: {
      'process.env.SUPABASE_URL': JSON.stringify(supabaseUrl),
      'process.env.SUPABASE_SERVICE_ROLE_KEY': JSON.stringify(supabaseKey),
      'process.env.SUPABASE_KEY': JSON.stringify(supabaseKey),
      'process.env.SUPABASE_ANON_KEY': JSON.stringify(supabaseKey),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || ''),
      'process.env.ELEVENLABS_API_KEY': JSON.stringify(env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY || ''),
      'process.env.FLUX_API_KEY': JSON.stringify(env.FLUX_API_KEY || process.env.FLUX_API_KEY || ''),
      'process.env.OPENAI_API_KEY': JSON.stringify(env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || ''),
      'process.env.GROUNDING_DINO_URL': JSON.stringify('/api/dino'),
    },
    build: {
      outDir: 'dist-studio',
      rollupOptions: {
        input: 'studio.html',
        external: ['pdf-img-convert', 'fs', 'path'],
      },
    },
    optimizeDeps: {
      exclude: ['pdf-img-convert'],
    },
    server: {
      port: 3001,
      open: '/studio.html',
      proxy: {
        '/api/dino': {
          target: 'http://127.0.0.1:8001',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/dino/, ''),
        },
      },
      watch: {
        ignored: [
          '**/public/latest_manifest.json',
          '**/src/lib/latestStory.json',
          '**/public/scene_*.mp3',
          '**/out/**',
        ],
      },
      headers: {},
      middlewareMode: false,
    },
  };
});

function formatManifestAsText(manifest: any, sceneAudio?: any[]): string {
  const meta = manifest.meta || {};
  let out = `================================================================================\n`;
  out += `STORYBOARD SCRIPT & SCENE BREAKDOWN\n`;
  if (meta.topic) out += `Topic: ${meta.topic}\n`;
  out += `Total Duration: ${meta.targetDuration || 0}s | Scenes: ${manifest.scenes?.length || 0}\n`;
  out += `================================================================================\n\n`;

  manifest.scenes?.forEach((scene: any, index: number) => {
    const sa = sceneAudio?.find((s) => s.sceneNumber === scene.sceneNumber);
    const dur = sa?.durationSeconds || scene.duration || 10;
    out += `--- SCENE ${scene.sceneNumber || index + 1}: ${scene.title || 'Untitled'} (Duration: ${dur.toFixed(1)}s) ---\n`;
    if (scene.visualDescription) {
      out += `Visual Description: ${scene.visualDescription}\n`;
    }
    out += `Narration:\n"${scene.narration || ''}"\n\n`;

    const elements = scene.layout?.elements || [];
    if (elements.length > 0) {
      out += `Layout Elements:\n`;
      elements.forEach((el: any) => {
        let content = el.content || '';
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

function cleanManifestForJson(manifest: any, sceneAudio?: any[]): object {
  const cleanedScenes = manifest.scenes?.map((scene: any) => {
    const elements = scene.layout?.elements?.map((el: any) => {
      let content = el.content || '';
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
      title: scene.title,
      durationSeconds: sa?.durationSeconds || scene.duration || 10,
      visualDescription: scene.visualDescription,
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
