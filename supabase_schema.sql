-- Supabase Schema for URL-to-Storyteller Application
-- Stores encrypted API keys, text LLM models, image generation models, and job metadata.

-- 1. api_keys Table
CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE, -- e.g. 'elevenlabs', 'flux', 'openai', 'anthropic', 'linkup', etc.
  key_value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. llm_models Table (Text Generation Models)
CREATE TABLE IF NOT EXISTS public.llm_models (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL, -- lowercase provider identifier
  model_name TEXT NOT NULL, -- e.g. 'gpt-4o', 'claude-3-5-sonnet'
  api_keys_id UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,
  base_url TEXT,
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  used_for TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. llm_models_image Table (Image Generation Models)
CREATE TABLE IF NOT EXISTS public.llm_models_image (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  model_name TEXT NOT NULL, -- e.g. 'flux-2/schnell', 'stable-diffusion-xl'
  display_name TEXT NOT NULL,
  provider TEXT NOT NULL, -- e.g. 'kie.ai', 'flux', 'stability'
  api_keys_id UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. llm_used_for Table (Task Role Mapping Table)
CREATE TABLE IF NOT EXISTS public.llm_used_for (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  llm_models_id UUID REFERENCES public.llm_models(id) ON DELETE CASCADE,
  used_for TEXT NOT NULL, -- e.g. 'script_generation', 'storyboard_planning', 'research'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. storyboard_jobs Table
CREATE TABLE IF NOT EXISTS public.storyboard_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT,
  title TEXT,
  status TEXT DEFAULT 'queued', -- queued, processing, complete, failed
  manifest JSONB,
  audio_url TEXT,
  video_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for fast dynamic retrieval
CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON public.api_keys(provider);
CREATE INDEX IF NOT EXISTS idx_llm_modelss_provider ON public.llm_modelss(provider);
CREATE INDEX IF NOT EXISTS idx_llm_modelss_image_provider ON public.llm_modelss_image(provider);
