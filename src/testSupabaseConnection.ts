import 'dotenv/config';
import { getSupabaseClient, getApiKey, resolveLlmModel, resolveImageModel } from './lib/supabaseClient';

async function main() {
  console.log('--- Supabase Connection & Key Resolution Test ---');
  
  const client = getSupabaseClient();
  if (!client) {
    console.error('❌ Failed to initialize Supabase client. Please check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    return;
  }
  console.log('✅ Supabase Client Initialized successfully.');

  try {
    const elevenLabsKey = await getApiKey('elevenlabs');
    console.log('🔊 ElevenLabs API Key:', elevenLabsKey ? `${elevenLabsKey.substring(0, 8)}...` : 'Not found');

    const fluxConfig = await resolveImageModel('flux');
    console.log('🎨 Flux Image Config:', {
      modelName: fluxConfig.modelName,
      provider: fluxConfig.provider,
      apiKey: fluxConfig.apiKey ? `${fluxConfig.apiKey.substring(0, 8)}...` : 'Not found',
    });

    const llmConfig = await resolveLlmModel();
    console.log('🤖 Text LLM Config:', {
      modelName: llmConfig.modelName,
      provider: llmConfig.provider,
      apiKey: llmConfig.apiKey ? `${llmConfig.apiKey.substring(0, 8)}...` : 'Not found',
    });

    console.log('--- Test Completed ---');
  } catch (err) {
    console.error('❌ Exception querying Supabase tables:', err);
  }
}

main();
