/**
 * Provider-agnostic text completion for the brag workflow.
 *
 * Why: the brag steps were calling kie.ai's Claude directly. When the reseller's upstream returns
 * "Server exception, please try again later" for every model, the workflow has no alternative path —
 * even though a first-class DeepSeek Pro model is already configured in Supabase. This module lets a
 * step pick its provider without changing any prompt or output contract.
 *
 * Both branches keep the same discipline as kieClaude.ts: success is decided by the SHAPE of the
 * response, never by `res.ok`, and a failure throws with the raw provider body attached rather than
 * substituting an empty or placeholder answer.
 *
 * kie.ai requires this because it returns errors as HTTP 200. DeepSeek returns honest status codes,
 * but validating shape in both places means one code path to reason about.
 */
import { getApiKey } from './supabaseClient';
import { callClaude, type ChatMessage } from './kieClaude';

export type TextProvider = 'kie.ai' | 'deepseek';

export interface CallTextOptions {
  provider: TextProvider;
  /** Model alias. Defaults per provider when omitted. */
  model?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface TextResult {
  text: string;
  /** The alias we asked for. */
  requestedModel: string;
  /** The model the provider reports it actually used. */
  upstreamModel?: string;
  provider: TextProvider;
  latencyMs: number;
  creditsConsumed?: number;
  finishReason?: string;
}

/** DeepSeek's OpenAI-compatible surface. `/v1` matches the baseUrl already stored in Supabase. */
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_MODEL: Record<TextProvider, string> = {
  'kie.ai': 'claude-opus-5-5',
  deepseek: 'deepseek-v4-pro',
};

export class TextModelError extends Error {
  constructor(
    message: string,
    readonly attempts: { model: string; reason: string; body?: string }[],
  ) {
    super(message);
    this.name = 'TextModelError';
  }
}

interface DeepSeekResponse {
  choices?: { message?: { content?: string; reasoning_content?: string }; finish_reason?: string }[];
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string };
}

async function callDeepSeek(opts: CallTextOptions, model: string): Promise<TextResult> {
  const apiKey = await getApiKey('deepseek');
  if (!apiKey) {
    throw new TextModelError(
      '[textModel] No DeepSeek API key. Add a row to Supabase api_keys (provider "deepseek") or set DEEPSEEK_API_KEY.',
      [{ model, reason: 'missing api key' }],
    );
  }

  const timeoutMs = opts.timeoutMs ?? 300_000;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  let raw = '';
  try {
    res = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        max_tokens: opts.maxTokens ?? 8192,
        temperature: opts.temperature ?? 0.4,
        stream: false,
      }),
      signal: controller.signal,
    });
    raw = await res.text();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new TextModelError(`[textModel] DeepSeek request failed (${model}): ${reason}`, [{ model, reason }]);
  } finally {
    clearTimeout(timer);
  }

  let parsed: DeepSeekResponse | undefined;
  try {
    parsed = JSON.parse(raw) as DeepSeekResponse;
  } catch {
    parsed = undefined;
  }

  const content = parsed?.choices?.[0]?.message?.content;
  const finish = parsed?.choices?.[0]?.finish_reason;
  const reasoning = parsed?.choices?.[0]?.message?.reasoning_content;

  // Shape check first: a 200 with an error body must not be treated as success.
  if (typeof content !== 'string' || content.length === 0) {
    // DeepSeek Pro is a REASONING model: it streams its thinking into `reasoning_content` and only
    // then writes `content`. If the token budget runs out during reasoning, `content` is legitimately
    // empty and finish_reason is "length" — that is a budget problem, not a provider outage, and it
    // needs to say so or the next person will chase the wrong thing.
    const budget = opts.maxTokens ?? 8192;
    const detail =
      finish === 'length'
        ? `the ${budget}-token budget was exhausted before any answer was produced` +
          (reasoning ? ` — it spent it on ${reasoning.length} characters of reasoning. Raise maxTokens.` : '. Raise maxTokens.')
        : parsed?.error?.message ?? raw.slice(0, 400) ?? '(no body)';
    throw new TextModelError(
      `[textModel] DeepSeek returned no answer (HTTP ${res.status}, model ${model}, finish_reason=${finish ?? 'n/a'}): ${detail}`,
      [{ model, reason: `HTTP ${res.status}, finish_reason=${finish ?? 'n/a'}: ${detail}`, body: raw.slice(0, 2000) }],
    );
  }

  return {
    text: content,
    requestedModel: model,
    upstreamModel: parsed?.model,
    provider: 'deepseek',
    latencyMs: Date.now() - started,
    finishReason: parsed?.choices?.[0]?.finish_reason,
  };
}

/**
 * Calls the chosen provider. `kie.ai` delegates to the existing kieClaude client so its HTTP-200
 * error trap and model-fallback chain stay in one place.
 */
export async function callText(opts: CallTextOptions): Promise<TextResult> {
  const model = opts.model ?? DEFAULT_MODEL[opts.provider];

  if (opts.provider === 'kie.ai') {
    const r = await callClaude({
      messages: opts.messages,
      model,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      timeoutMs: opts.timeoutMs,
    });
    return {
      text: r.text,
      requestedModel: r.requestedModel,
      upstreamModel: r.upstreamModel,
      provider: 'kie.ai',
      latencyMs: r.latencyMs,
      creditsConsumed: r.creditsConsumed,
    };
  }

  return callDeepSeek(opts, model);
}
