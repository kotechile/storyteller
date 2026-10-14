/**
 * Claude via kie.ai — the client behind every "skill" task in OmniCast (brag planning,
 * YouTube metadata, plan repair).
 *
 * Contract, verified live on 2026-10-11 (see scripts/probe-kie-claude.ts):
 *
 *   POST https://api.kie.ai/claude/v1/messages
 *   headers: Authorization: Bearer <key>   (+ x-api-key: Bearer <key>)
 *   body:    { model, max_tokens, messages: [{role, content}] }
 *   ok:      { role, content: [{type:'text', text}], model, usage, stop_reason, credits_consumed }
 *
 * THE TRAP: kie.ai reports failures with **HTTP 200** and a body like
 * `{"code":500,"msg":"The page does not exist"}` (that is what an unknown model alias looks
 * like). Checking `res.ok` therefore *passes* on a failure, and a naive client would hand the
 * string "The page does not exist" to the storyboard planner as if it were a video script.
 * Success is defined here by response SHAPE, never by status code.
 *
 * SECOND TRAP: claude-opus-5-5 measured ~92 s cold for a 4-token reply, so the default timeout is
 * 240 s. A 30 s timeout would look like an outage on every first call.
 */
import { getApiKey } from './supabaseClient';
import { loadOmnicastConfig } from './runtimeConfig';

export const KIE_CLAUDE_ENDPOINT = 'https://api.kie.ai/claude/v1/messages';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeCallResult {
  text: string;
  /** The alias we asked for. */
  requestedModel: string;
  /** The model the provider reports it actually used (can differ from the alias). */
  upstreamModel?: string;
  creditsConsumed?: number;
  latencyMs: number;
}

/** A single content block from the Anthropic Messages response. */
interface AnthropicContentBlock {
  type?: string;
  text?: string;
}

/**
 * The response shape kie.ai returns: a superset of the Anthropic Messages response that ALSO
 * carries provider errors (`code`/`msg`) on HTTP 200 when something is wrong.
 */
interface MessagesResponse {
  role?: string;
  content?: AnthropicContentBlock[];
  model?: string;
  stop_reason?: string;
  credits_consumed?: number;
  code?: string | number;
  msg?: string;
  message?: string;
}

/** Thrown when every candidate model/attempt failed. Carries the raw provider bodies — never hides them. */
export class KieClaudeError extends Error {
  constructor(
    message: string,
    readonly attempts: { model: string; reason: string; body?: string }[],
  ) {
    super(message);
    this.name = 'KieClaudeError';
  }
}

export interface CallClaudeOptions {
  messages: ChatMessage[];
  /** Overrides the configured primary model. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Transport-level retries per model (network errors / aborts only). Default 2. */
  transportRetries?: number;
  signal?: AbortSignal;
}

/** Splits an SSE response body (in case `stream` is ever on) into concatenated text deltas. */
function parseSseText(raw: string): string {
  const parts: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const evt = JSON.parse(payload);
      for (const block of evt?.content_block_delta ? [evt.delta] : evt?.content ?? []) {
        if (typeof block?.text === 'string') parts.push(block.text);
      }
    } catch {
      /* non-JSON keepalive line */
    }
  }
  return parts.join('');
}

interface AttemptFailure {
  reason: string;
  /** Raw provider body, when there was one. Absent for network/timeout failures. */
  body?: string;
}

/** One HTTP attempt against one model. Returns text on success, or a classified failure. */
async function attempt(
  model: string,
  opts: CallClaudeOptions,
  apiKey: string,
  timeoutMs: number,
): Promise<{ text: string; upstreamModel?: string; credits?: number; body: string } | { failure: AttemptFailure }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onOuterAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });

  try {
    const res = await fetch(KIE_CLAUDE_ENDPOINT, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'x-api-key': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 8192,
        temperature: opts.temperature ?? 1,
        stream: false,
        messages: opts.messages,
      }),
    });

    const raw = await res.text();

    // ── The trap: HTTP 200 does NOT mean success. Validate shape, not status. ──
    let parsed: MessagesResponse;
    try {
      parsed = JSON.parse(raw) as MessagesResponse;
    } catch {
      if (raw.includes('event:')) {
        const text = parseSseText(raw);
        if (text) return { text, body: raw.slice(0, 400) };
        return { failure: { reason: `SSE response contained no text (HTTP ${res.status})`, body: raw.slice(0, 400) } };
      }
      return { failure: { reason: `Non-JSON body (HTTP ${res.status})`, body: raw.slice(0, 400) } };
    }

    // Provider-reported error riding on a 200 (unknown model alias, upstream failure, …).
    if (parsed && typeof parsed.code !== 'undefined' && !parsed.content) {
      return {
        failure: {
          reason: `Provider error code=${parsed.code}: ${parsed.msg ?? parsed.message ?? 'unknown'}`,
          body: raw.slice(0, 400),
        },
      };
    }

    const textBlocks = Array.isArray(parsed?.content)
      ? parsed.content.filter((c) => c?.type === 'text' && typeof c.text === 'string')
      : [];
    const text = textBlocks.map((c) => c.text ?? '').join('');

    if (!text.trim()) {
      return {
        failure: {
          reason: `No text content in response (stop_reason=${parsed?.stop_reason ?? 'n/a'})`,
          body: raw.slice(0, 400),
        },
      };
    }

    return { text, upstreamModel: parsed.model, credits: parsed.credits_consumed, body: raw.slice(0, 400) };
  } catch (err) {
    const e = err as Error;
    return { failure: { reason: `${e.name === 'AbortError' ? 'Timed out' : 'Network error'}: ${e.message}` } };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * Calls Claude through kie.ai, trying the configured model alias and then its fallbacks.
 *
 * Transport failures (network/timeout) are retried per model; provider-level failures (bad alias,
 * upstream error) move straight to the next model. If everything fails this THROWS with every
 * attempt recorded — there is deliberately no silent substitution of a different provider or model.
 */
export async function callClaude(opts: CallClaudeOptions): Promise<ClaudeCallResult> {
  const cfg = loadOmnicastConfig();
  const apiKey = await getApiKey('kie.ai');
  if (!apiKey) {
    throw new KieClaudeError(
      '[kieClaude] No kie.ai API key. Add a row to Supabase api_keys (provider "kie.ai") or set KIE_API_KEY.',
      [],
    );
  }

  const primary = opts.model || cfg.brag.model;
  const models = [primary, ...cfg.brag.modelFallbacks.filter((m) => m !== primary)];
  const timeoutMs = opts.timeoutMs ?? cfg.brag.timeoutMs;
  const transportRetries = opts.transportRetries ?? 2;
  const failures: { model: string; reason: string; body?: string }[] = [];

  for (const model of models) {
    for (let attemptNo = 0; attemptNo <= transportRetries; attemptNo++) {
      const t0 = Date.now();
      const result = await attempt(model, { ...opts, maxTokens: opts.maxTokens ?? cfg.brag.maxTokens }, apiKey, timeoutMs);

      if ('text' in result) {
        const latencyMs = Date.now() - t0;
        console.log(
          `[kieClaude] "${model}" ok in ${latencyMs}ms (upstream: ${result.upstreamModel ?? 'unknown'}, ` +
            `${result.credits ?? '?'} credits, ${result.text.length} chars)`,
        );
        return {
          text: result.text,
          requestedModel: model,
          upstreamModel: result.upstreamModel,
          creditsConsumed: result.credits,
          latencyMs,
        };
      }

      failures.push({ model, reason: result.failure.reason, body: result.failure.body });
      const retryable = /Timed out|Network error/.test(result.failure.reason);
      console.warn(
        `[kieClaude] "${model}" attempt ${attemptNo + 1}/${transportRetries + 1} failed: ${result.failure.reason}` +
          (result.failure.body ? ` :: ${result.failure.body.slice(0, 200)}` : ''),
      );
      if (!retryable || attemptNo === transportRetries) break; // move to the next model
      await new Promise((r) => setTimeout(r, 1500 * (attemptNo + 1)));
    }
  }

  throw new KieClaudeError(
    `[kieClaude] All Claude models failed (${models.join(', ')}). ` +
      failures.map((f) => `\n  · ${f.model}: ${f.reason}${f.body ? ` :: ${f.body.slice(0, 160)}` : ''}`).join(''),
    failures,
  );
}

/** Extracts the first balanced JSON object/array from model output, tolerating prose and code fences. */
export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text].filter((s): s is string => !!s);

  for (const candidate of candidates) {
    const start = candidate.search(/[[{]/);
    if (start === -1) continue;
    const open = candidate[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(candidate.slice(start, i + 1)) as T;
          } catch {
            break; // malformed — try the next candidate
          }
        }
      }
    }
  }
  throw new Error(`[kieClaude] No parseable JSON in model output. First 400 chars: ${text.slice(0, 400)}`);
}

/**
 * Call Claude and require JSON back. One repair round is allowed, quoting the exact parse error —
 * beyond that it throws rather than letting a malformed plan reach the renderer.
 */
export async function callClaudeJson<T>(
  opts: CallClaudeOptions & { parse?: (raw: unknown) => T },
): Promise<{ value: T; model: string; raw: string }> {
  const first = await callClaude(opts);

  const tryParse = (text: string): { value: T } | { error: string } => {
    try {
      const json = extractJson(text);
      return { value: opts.parse ? opts.parse(json) : (json as T) };
    } catch (err) {
      return { error: (err as Error).message };
    }
  };

  const firstTry = tryParse(first.text);
  if ('value' in firstTry) return { value: firstTry.value, model: first.requestedModel, raw: first.text };

  console.warn(`[kieClaude] JSON parse failed (${firstTry.error.slice(0, 200)}); issuing one repair round.`);
  const repaired = await callClaude({
    ...opts,
    messages: [
      ...opts.messages,
      { role: 'assistant', content: first.text },
      {
        role: 'user',
        content:
          'That response could not be parsed. Error:\n' +
          firstTry.error.slice(0, 500) +
          '\n\nReply with ONLY the corrected JSON. No prose, no markdown fences, no commentary.',
      },
    ],
  });

  const secondTry = tryParse(repaired.text);
  if ('value' in secondTry) return { value: secondTry.value, model: repaired.requestedModel, raw: repaired.text };

  throw new Error(
    `[kieClaude] Model did not return parseable JSON after a repair round. ${secondTry.error.slice(0, 300)}`,
  );
}
