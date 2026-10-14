import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClientInstance: SupabaseClient | null = null;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<any>>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data as T;
  }
  cache.delete(key);
  return null;
}

function setCached<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

function getEnvVar(name: string): string | undefined {
  // Explicit property lookups match Vite's static define replacements
  try {
    if (name === 'SUPABASE_URL') {
      const v = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (v) return v;
    }
    if (name === 'SUPABASE_SERVICE_ROLE_KEY') {
      const v = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
      if (v) return v;
    }
    if (name === 'SUPABASE_KEY') {
      const v = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
      if (v) return v;
    }
  } catch {
    // ignore
  }

  // Dynamic lookup fallback
  try {
    if (typeof process !== 'undefined' && process?.env) {
      const val = process.env[name];
      if (val) return val;
    }
  } catch {
    // ignore
  }

  return undefined;
}

/**
 * Initializes Supabase Client checking service role keys first, falling back to anon key.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClientInstance) return supabaseClientInstance;

  const url = getEnvVar('SUPABASE_URL');
  const key = getEnvVar('SUPABASE_SERVICE_ROLE_KEY') || getEnvVar('SUPABASE_KEY');

  if (!url || !key) {
    console.warn('[SupabaseClient] Missing SUPABASE_URL or SUPABASE_KEY in environment.');
    return null;
  }

  try {
    supabaseClientInstance = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    console.log('[SupabaseClient] Connected to Supabase at:', url);
    return supabaseClientInstance;
  } catch (err) {
    console.error('[SupabaseClient] Failed to initialize Supabase client:', err);
    return null;
  }
}

/**
 * Dynamic API Key Retrieval from `api_keys` table.
 */
export async function getApiKey(provider: string): Promise<string | null> {
  const providerClean = provider.trim().toLowerCase();
  const cacheKey = `apikey:${providerClean}`;
  if (cache.has(cacheKey)) {
    const cached = getCached<string | null>(cacheKey);
    if (cached !== null || cache.has(cacheKey)) return cached;
  }

  let result: string | null = null;
  const client = getSupabaseClient();

  if (client) {
    try {
      // 1. Try exact match
      const { data } = await client
        .from('api_keys')
        .select('key_value')
        .eq('provider', providerClean)
        .limit(1)
        .maybeSingle();

      if (data && data.key_value) {
        result = data.key_value;
      } else {
        // 2. Fallback: ILIKE query
        const { data: fallbackData } = await client
          .from('api_keys')
          .select('key_value')
          .ilike('provider', `%${providerClean}%`)
          .limit(1)
          .maybeSingle();

        if (fallbackData && fallbackData.key_value) {
          result = fallbackData.key_value;
        }
      }
    } catch (err) {
      console.warn(`[SupabaseClient] Error fetching API key for ${provider}:`, err);
    }
  }

  if (!result) {
    // 3. Fallback to provider aliases (e.g. 'flux' -> 'replicate', 'kie.ai', 'openrouter', 'fal', 'bfl')
    const aliases: Record<string, string[]> = {
      flux: ['replicate', 'kie.ai', 'openrouter', 'fal', 'bfl', 'blackforestlabs'],
      replicate: ['flux', 'bfl'],
      gemini: ['google'],
      google: ['gemini'],
    };

    const providerAliases = aliases[providerClean] || [];
    for (const alias of providerAliases) {
      if (client) {
        try {
          const { data: aliasData } = await client
            .from('api_keys')
            .select('key_value')
            .ilike('provider', `%${alias}%`)
            .limit(1)
            .maybeSingle();
          if (aliasData?.key_value) {
            result = aliasData.key_value;
            console.log(`[SupabaseClient] Resolved API key for provider "${providerClean}" via alias "${alias}".`);
            break;
          }
        } catch (_err) {}
      }
    }
  }

  if (!result) {
    // 4. Fallback to env vars (e.g. GEMINI_API_KEY, REPLICATE_API_KEY, FLUX_API_KEY, OPENAI_API_KEY)
    const envKeyName = `${providerClean.toUpperCase()}_API_KEY`;
    result = getEnvVar(envKeyName) || null;
    if (!result && providerClean === 'gemini') {
      result = getEnvVar('GOOGLE_API_KEY') || null;
    }
    if (!result && providerClean === 'flux') {
      result = getEnvVar('REPLICATE_API_KEY') || getEnvVar('KIE_API_KEY') || getEnvVar('OPENROUTER_API_KEY') || getEnvVar('FAL_API_KEY') || null;
    }
  }

  if (result) {
    console.log(`[SupabaseClient] Resolved API key for provider "${providerClean}".`);
  } else {
    console.warn(`[SupabaseClient] No API key found for provider "${providerClean}" in Supabase or environment.`);
  }

  setCached(cacheKey, result);
  return result;
}

async function resolveApiKeyFromModel(modelRow: any, client: SupabaseClient): Promise<string | null> {
  if (modelRow.api_keys_id) {
    try {
      console.log(`[SupabaseClient] Fetching api_keys_id "${modelRow.api_keys_id}" for model "${modelRow.model_name || modelRow.name}"...`);
      const { data: keyRow, error: keyErr } = await client
        .from('api_keys')
        .select('key_value, provider')
        .eq('id', modelRow.api_keys_id)
        .maybeSingle();

      if (keyErr) {
        console.warn(`[SupabaseClient] Error fetching api_keys_id ${modelRow.api_keys_id}:`, keyErr);
      } else if (keyRow?.key_value) {
        console.log(`[SupabaseClient] Successfully resolved API key from api_keys table for provider "${keyRow.provider || modelRow.provider}".`);
        return keyRow.key_value;
      }
    } catch (err) {
      console.warn(`[SupabaseClient] Exception fetching api_keys_id ${modelRow.api_keys_id}:`, err);
    }
  }

  // Fallback to provider lookup
  return getApiKey(modelRow.provider);
}

export interface ResolvedLlmConfig {
  modelName: string;
  provider: string;
  apiKey: string | null;
  baseUrl?: string;
}

/**
 * Resolves Text LLM configuration dynamically from Supabase `llm_models` table.
 * Strictly selects the model row with `is_default = true`.
 */
export async function resolveLlmModel(taskRole?: string): Promise<ResolvedLlmConfig> {
  const cacheKey = `llm:${taskRole || 'default'}`;
  const cached = getCached<ResolvedLlmConfig>(cacheKey);
  if (cached) return cached;

  // 1. Try server proxy endpoint first in browser mode
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/llm-config');
      if (res.ok) {
        const data = await res.json();
        if (data.modelName) {
          console.log(`[SupabaseClient] Resolved is_default model via server proxy: "${data.modelName}" (provider: ${data.provider}). Key present: ${!!data.apiKey}`);
          setCached(cacheKey, data);
          return data;
        }
      }
    } catch (err) {
      console.warn('[SupabaseClient] Server proxy /api/llm-config failed, falling back to direct client:', err);
    }
  }

  // 2. Direct client query (for Node environment or production SSR)
  const client = getSupabaseClient();
  if (client) {
    for (const tableName of ['llm_models', 'llm_modelss']) {
      try {
        console.log(`[SupabaseClient] Querying Supabase table "${tableName}" for models (taskRole: ${taskRole || 'default'})...`);
        
        // Fetch ALL rows and filter client-side — avoids "column X does not exist" errors
        // when task_role/purpose columns don't exist on the table
        const { data: allModels, error: fetchErr } = await client.from(tableName).select('*');

        if (fetchErr) {
          console.warn(`[SupabaseClient] Table "${tableName}" fetch error:`, fetchErr);
        } else if (allModels && allModels.length > 0) {
          let model: any;

          if (taskRole) {
            // Client-side filtering: check all known task-role column names including array/JSON formats
            const roleClean = taskRole.toLowerCase().replace(/[^a-z0-9_]/g, '');
            const match = allModels.find((m: any) => {
              const fields = [m.task_role, m.purpose, m.use_for, m.used_for];
              return fields.some((f) => {
                if (!f) return false;
                const str = (typeof f === 'string' ? f : JSON.stringify(f)).toLowerCase().replace(/[^a-z0-9_]/g, '');
                return str.includes(roleClean);
              });
            });
            if (match) {
              model = match;
              console.log(`[SupabaseClient] Found task-specific model for "${taskRole}": "${model.model_name || model.name}"`);
            } else {
              // No task-specific match — fall back to is_default
              console.log(`[SupabaseClient] No task-specific match for "${taskRole}". Falling back to default...`);
              model = allModels.find((m: any) => m.is_default === true || m.is_default === 'true' || m.is_default === 1) || allModels[0];
            }
          } else {
            // No task role — pick is_default or first
            model = allModels.find((m: any) => m.is_default === true || m.is_default === 'true' || m.is_default === 1) || allModels[0];
          }

          const apiKey = await resolveApiKeyFromModel(model, client);
          const provider = (model.provider || 'deepseek').trim().toLowerCase();
          const modelName = model.model_name || model.name || 'deepseek-v4-flash';

          const config: ResolvedLlmConfig = {
            modelName,
            provider,
            apiKey,
            // NOTE: `baseUrl` MUST be a *chat-completions* base — every consumer appends
            // '/chat/completions' (narrativeEngine.buildChatCompletionsUrl, dinoPromptRefiner).
            // kie.ai's Claude exposes the Anthropic Messages API at /claude/v1/messages instead,
            // so it is routed explicitly in narrativeEngine.callLlm() and deliberately leaves this
            // field undefined rather than handing callers an endpoint they would mangle.
            baseUrl:
              model.base_url ||
              (provider === 'deepseek' ? 'https://api.deepseek.com/v1' : undefined),
          };

          console.log(`[SupabaseClient] Selected model: "${config.modelName}" (provider: ${config.provider}, task: ${taskRole || 'default'}). Key present: ${!!config.apiKey}`);
          if (config.apiKey) setCached(cacheKey, config); // only cache valid configs
          return config;
        }
      } catch (err) {
        console.warn(`[SupabaseClient] Query on table "${tableName}" threw error:`, err);
      }
    }
  }

  // Standalone fallback config
  const fallbackKey = getEnvVar('DEEPSEEK_API_KEY') || getEnvVar('OPENAI_API_KEY') || getEnvVar('GEMINI_API_KEY') || null;
  const defaultConfig: ResolvedLlmConfig = {
    modelName: 'deepseek-v4-flash',
    provider: 'deepseek',
    apiKey: fallbackKey,
    baseUrl: 'https://api.deepseek.com/v1',
  };
  if (defaultConfig.apiKey) setCached(cacheKey, defaultConfig);
  return defaultConfig;
}

export interface ResolvedImageConfig {
  modelName: string;
  displayName: string;
  provider: string;
  apiKey: string | null;
  baseUrl?: string;
}

export interface ResolvedVideoConfig {
  modelName: string;
  provider: string;
  apiKey: string | null;
  baseUrl?: string;
}

/**
 * Resolves Image Generation model via the `llm_used_for` junction table.
 *
 * llm_models_image has NO used_for column — the mapping lives in llm_used_for.
 *
 * Lookup chain:
 * 1. Query `llm_used_for` where `used_for = 'diagram_creator'` → get `llm_image_id`
 * 2. Query `llm_models_image` where `id = llm_image_id` → get model config
 * 3. Resolve API key from `api_keys` table by `api_keys_id` FK
 */
export async function resolveImageModel(targetModelName?: string, taskRole?: string): Promise<ResolvedImageConfig> {
  const actualTaskRole = taskRole || 'diagram_creator';
  const cacheKey = `image:${targetModelName || actualTaskRole}`;
  const cached = getCached<ResolvedImageConfig>(cacheKey);
  if (cached) return cached;

  const client = getSupabaseClient();

  // Explicit model-name request (e.g. resolveImageModel('flux-2')): look the model row up by
  // name. Previously this parameter only fed the cache key and was silently ignored, so any
  // caller asking for a specific model got the task-role model instead.
  if (client && targetModelName) {
    try {
      const { data: namedRow } = await client
        .from('llm_models_image')
        .select('*')
        .ilike('model_name', `%${targetModelName}%`)
        .limit(1)
        .maybeSingle();
      if (namedRow) {
        let apiKey: string | null = null;
        if (namedRow.api_keys_id) {
          const { data: keyRow } = await client
            .from('api_keys')
            .select('key_value')
            .eq('id', namedRow.api_keys_id)
            .maybeSingle();
          if (keyRow?.key_value) apiKey = keyRow.key_value;
        }
        if (!apiKey) apiKey = await getApiKey(namedRow.provider);
        const named: ResolvedImageConfig = {
          modelName: (namedRow.model_name || '').replace(/\s*\/\s*/g, '/').trim(),
          displayName: namedRow.display_name,
          provider: namedRow.provider,
          apiKey,
          baseUrl: namedRow.base_url || undefined,
        };
        console.log(`[SupabaseClient] Resolved image model by name "${targetModelName}" -> "${named.modelName}" (provider: ${named.provider}). Key present: ${!!named.apiKey}`);
        if (named.apiKey) setCached(cacheKey, named);
        return named;
      }
      console.warn(`[SupabaseClient] No llm_models_image row matching model_name~"${targetModelName}"`);
    } catch (err) {
      console.warn('[SupabaseClient] Image model lookup by name failed:', err);
    }
  }

  if (client) {
    try {
      // Step 1: Query llm_used_for junction table
      console.log(`[SupabaseClient] Looking up image model via llm_used_for (used_for="${actualTaskRole}")...`);
      const { data: usedForRow, error: usedForErr } = await client
        .from('llm_used_for')
        .select('llm_image_id')
        .eq('used_for', actualTaskRole)
        .limit(1)
        .maybeSingle();

      if (usedForErr) {
        console.warn('[SupabaseClient] llm_used_for query error:', usedForErr);
      } else {
        console.log(`[SupabaseClient] llm_used_for result:`, usedForRow);
      }

      if (usedForRow?.llm_image_id) {
        const imageId = usedForRow.llm_image_id;
        console.log(`[SupabaseClient] Found llm_image_id="${imageId}" for used_for="${actualTaskRole}"`);

        // Step 2: Query llm_models_image table by ID
        const { data: imageRow, error: imageErr } = await client
          .from('llm_models_image')
          .select('*')
          .eq('id', imageId)
          .maybeSingle();

        if (imageErr) {
          console.warn('[SupabaseClient] llm_models_image query error:', imageErr);
        }

        if (imageRow) {
          console.log(`[SupabaseClient] Found image model: "${imageRow.model_name}" (provider: ${imageRow.provider})`);

          // Step 3: Resolve API key
          let apiKey: string | null = null;
          if (imageRow.api_keys_id) {
            const { data: keyRow } = await client
              .from('api_keys')
              .select('key_value')
              .eq('id', imageRow.api_keys_id)
              .maybeSingle();
            if (keyRow?.key_value) apiKey = keyRow.key_value;
          }
          if (!apiKey) {
            apiKey = await getApiKey(imageRow.provider);
          }

          const config: ResolvedImageConfig = {
            modelName: imageRow.model_name.replace(/\s*\/\s*/g, '/').trim(),
            displayName: imageRow.display_name,
            provider: imageRow.provider,
            apiKey,
            baseUrl: imageRow.base_url || undefined,
          };
          if (config.apiKey) setCached(cacheKey, config);
          console.log(`[SupabaseClient] Resolved image model: "${config.modelName}" (provider: ${config.provider}). Key present: ${!!config.apiKey}`);
          return config;
        } else {
          console.warn(`[SupabaseClient] No llm_models_image row found for id="${imageId}"`);
        }
      } else {
        console.warn(`[SupabaseClient] No llm_used_for row found for used_for="${actualTaskRole}"`);
      }
    } catch (err) {
      console.warn('[SupabaseClient] Image model resolution error:', err);
    }
  }

  // No fake fallback. This used to return `pollinations-flux` with an empty key whenever the
  // llm_used_for lookup missed — a provider that is not configured and is no longer supported
  // anywhere in the pipeline (the Pollinations path was removed). A silent miss here produced
  // blurry off-model images; instead, fail loudly and name the row that is missing.
  throw new Error(
    `[SupabaseClient] No image model resolved for used_for="${actualTaskRole}". ` +
      `Add an llm_used_for row (used_for="${actualTaskRole}", llm_image_id=<an llm_models_image id with a working api_keys_id>). ` +
      `Expected today: "image_infographic" -> nano-banana-pro, "image_realistic" -> flux-2/pro-text-to-image.`,
  );
}

/**
 * Resolves Video Generation model via the `llm_used_for` junction table.
 *
 * Lookup chain:
 * 1. Query `llm_used_for` where `used_for = 'diagram_creator'` → get `llm_video_id`
 * 2. Query `llm_models_video` where `id = llm_video_id` → get model config
 * 3. Resolve API key from `api_keys` table by `api_keys_id` FK
 */
export async function resolveVideoModel(taskRole: string = 'diagram_creator'): Promise<ResolvedVideoConfig> {
  const cacheKey = `video:${taskRole}`;
  const cached = getCached<ResolvedVideoConfig>(cacheKey);
  if (cached) return cached;

  // In browser, use server proxy to avoid Supabase secret key restrictions
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/video-config');
      if (res.ok) {
        const data = await res.json();
        if (data.modelName) {
          console.log(`[SupabaseClient] Resolved video model via server proxy: "${data.modelName}" (provider: ${data.provider}). Key present: ${!!data.apiKey}`);
          setCached(cacheKey, data);
          return data;
        }
      }
    } catch (err) {
      console.warn('[SupabaseClient] Server proxy /api/video-config failed, falling back to direct client:', err);
    }
  }

  const client = getSupabaseClient();

  if (client) {
    try {
      const { data: usedForRow, error: usedForErr } = await client
        .from('llm_used_for')
        .select('llm_video_id')
        .eq('used_for', taskRole)
        .limit(1)
        .maybeSingle();

      if (usedForErr) {
        console.warn('[SupabaseClient] llm_used_for query error:', usedForErr);
      }

      if (usedForRow?.llm_video_id) {
        const videoId = usedForRow.llm_video_id;

        const { data: videoRow, error: videoErr } = await client
          .from('llm_models_video')
          .select('*')
          .eq('id', videoId)
          .maybeSingle();

        if (videoErr) {
          console.warn('[SupabaseClient] llm_models_video query error:', videoErr);
        }

        if (videoRow) {
          let apiKey: string | null = null;
          if (videoRow.api_keys_id) {
            const { data: keyRow } = await client
              .from('api_keys')
              .select('key_value')
              .eq('id', videoRow.api_keys_id)
              .maybeSingle();
            if (keyRow?.key_value) apiKey = keyRow.key_value;
          }
          if (!apiKey) {
            apiKey = await getApiKey(videoRow.provider);
          }

          const config: ResolvedVideoConfig = {
            modelName: (videoRow.model_name || 'bytedance/seedance-2-mini').replace(/\s*\/\s*/g, '/').trim(),
            provider: (videoRow.provider || 'kie').trim().toLowerCase().replace('.ai', ''),
            apiKey,
            baseUrl: videoRow.base_url || undefined,
          };
          if (config.apiKey) setCached(cacheKey, config);
          console.log(`[SupabaseClient] Resolved video model: "${config.modelName}" (provider: ${config.provider}). Key present: ${!!config.apiKey}`);
          return config;
        }
      }
    } catch (err) {
      console.warn('[SupabaseClient] Video model resolution error:', err);
    }
  }

  // No fake fallback. This used to return `runway-gen3` with an empty key — a provider with no
  // api_keys row here, so every miss degraded into a run that could never generate video. Fail
  // loudly instead and name the row that is missing.
  throw new Error(
    `[SupabaseClient] No video model resolved for used_for="${taskRole}". ` +
      `Add an llm_used_for row (used_for="${taskRole}", llm_video_id=<an llm_models_video id with a working api_keys_id>). ` +
      `Expected today: "diagram_creator" / "video_generation" -> bytedance/seedance-2-mini.`,
  );
}
