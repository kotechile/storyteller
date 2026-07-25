import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClientInstance: SupabaseClient | null = null;

/**
 * Initializes Supabase Client checking service role keys first, falling back to anon key.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClientInstance) return supabaseClientInstance;

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.warn('[SupabaseClient] Missing SUPABASE_URL or SUPABASE_KEY in environment.');
    return null;
  }

  supabaseClientInstance = createClient(url, key);
  return supabaseClientInstance;
}

/**
 * Dynamic API Key Retrieval from `api_keys` table.
 */
export async function getApiKey(provider: string): Promise<string | null> {
  const client = getSupabaseClient();
  const providerClean = provider.trim().toLowerCase();

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
        return data.key_value;
      }

      // 2. Fallback: ILIKE query
      const { data: fallbackData } = await client
        .from('api_keys')
        .select('key_value')
        .ilike('provider', `%${providerClean}%`)
        .limit(1)
        .maybeSingle();

      if (fallbackData && fallbackData.key_value) {
        return fallbackData.key_value;
      }
    } catch (err) {
      console.warn(`[SupabaseClient] Error fetching API key for ${provider}:`, err);
    }
  }

  // 3. Fallback to process.env
  const envKeyName = `${providerClean.toUpperCase()}_API_KEY`;
  return process.env[envKeyName] || null;
}

export interface ResolvedLlmConfig {
  modelName: string;
  provider: string;
  apiKey: string | null;
  baseUrl?: string;
}

/**
 * Resolves Text LLM configuration from `llm_models` (or `llm_modelss`) and `api_keys`.
 */
export async function resolveLlmModel(taskRole?: string): Promise<ResolvedLlmConfig> {
  const client = getSupabaseClient();

  if (client) {
    for (const tableName of ['llm_models', 'llm_modelss']) {
      try {
        // 1. Task role mapping via `llm_used_for` table if provided
        if (taskRole) {
          const { data: roleMapping } = await client
            .from('llm_used_for')
            .select('llm_models_id')
            .eq('used_for', taskRole)
            .limit(1)
            .maybeSingle();

          if (roleMapping?.llm_models_id) {
            const { data: modelRow } = await client
              .from(tableName)
              .select('*')
              .eq('id', roleMapping.llm_models_id)
              .maybeSingle();

            if (modelRow) {
              const apiKey = await getApiKey(modelRow.provider);
              return {
                modelName: modelRow.model_name,
                provider: modelRow.provider,
                apiKey,
                baseUrl: modelRow.base_url || undefined,
              };
            }
          }
        }

        // 2. Default active provider row
        const { data: defaultModel } = await client
          .from(tableName)
          .select('*')
          .eq('is_active', true)
          .eq('is_default', true)
          .limit(1)
          .maybeSingle();

        if (defaultModel) {
          const apiKey = await getApiKey(defaultModel.provider);
          return {
            modelName: defaultModel.model_name,
            provider: defaultModel.provider,
            apiKey,
            baseUrl: defaultModel.base_url || undefined,
          };
        }

        // 3. First active provider
        const { data: firstActive } = await client
          .from(tableName)
          .select('*')
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();

        if (firstActive) {
          const apiKey = await getApiKey(firstActive.provider);
          return {
            modelName: firstActive.model_name,
            provider: firstActive.provider,
            apiKey,
            baseUrl: firstActive.base_url || undefined,
          };
        }
      } catch {
        // Try fallback table
      }
    }
  }

  // Fallback defaults
  const openAiKey = await getApiKey('openai');
  return {
    modelName: 'gpt-4o',
    provider: 'openai',
    apiKey: openAiKey,
  };
}

export interface ResolvedImageConfig {
  modelName: string;
  displayName: string;
  provider: string;
  apiKey: string | null;
}

/**
 * Resolves Image Generation model (e.g. Flux) from `llm_models_image` and `api_keys` by provider lookup.
 */
export async function resolveImageModel(targetModelName = 'flux-2/schnell'): Promise<ResolvedImageConfig> {
  const client = getSupabaseClient();

  if (client) {
    for (const tableName of ['llm_models_image', 'llm_modelss_image']) {
      try {
        const { data: imageModel } = await client
          .from(tableName)
          .select('*')
          .or(`model_name.ilike.%${targetModelName}%,display_name.ilike.%${targetModelName}%,provider.ilike.%flux%`)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();

        if (imageModel) {
          const apiKey = await getApiKey(imageModel.provider);
          return {
            modelName: imageModel.model_name,
            displayName: imageModel.display_name,
            provider: imageModel.provider,
            apiKey,
          };
        }
      } catch {
        // Try fallback table
      }
    }
  }

  // Fallback default
  const fluxKey = (await getApiKey('flux')) || (await getApiKey('kie.ai'));
  return {
    modelName: 'flux-2/schnell',
    displayName: 'Flux 2 Schnell',
    provider: 'kie.ai',
    apiKey: fluxKey,
  };
}
