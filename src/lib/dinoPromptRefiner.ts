/**
 * DINO Prompt Refiner — LLM-powered keyword + position extraction.
 *
 * The vision LLM (Gemini/GPT-4V) analyzes the image + narration and returns:
 * 1. Ordered list of keywords mentioned in the narration
 * 2. Layout position for each keyword (hpos/vpos)
 * 3. Mention phrases for time-window alignment
 */

import { resolveLlmModel, ResolvedLlmConfig } from "./supabaseClient";
import { fetchWithRetry } from "./ingest";

// ── Types ─────────────────────────────────────────────────

export interface RefinedDinoPrompt {
  /** Display label shown on the highlight box */
  label: string;
  /** Narration phrase where this object is first mentioned (for timing) */
  mentionPhrase: string;
  /** Sequence order (0-based, follows narration flow) */
  order: number;
  /** Horizontal position: "left" | "center" | "right" */
  hpos?: string;
  /** Vertical position: "top" | "middle" | "bottom" */
  vpos?: string;
}

// ── Position → percentage mapping ─────────────────────────

export function positionToBox(hpos?: string, vpos?: string): { x: number; y: number; width: number; height: number } {
  const h = hpos || "center";
  const v = vpos || "middle";

  // Thin text-sized boxes positioned at typical label locations
  const hMap: Record<string, { x: number; w: number }> = {
    left: { x: 4, w: 28 },
    center: { x: 36, w: 28 },
    right: { x: 68, w: 28 },
  };

  // Place at top of each vertical section where titles/labels usually are
  const vMap: Record<string, { y: number; h: number }> = {
    top: { y: 6, h: 3 },
    middle: { y: 36, h: 3 },
    bottom: { y: 66, h: 3 },
  };

  const hb = hMap[h] || hMap.center;
  const vb = vMap[v] || vMap.middle;

  return { x: hb.x, y: vb.y, width: hb.w, height: vb.h };
}

// ── Core Function ─────────────────────────────────────────

export async function refineDinoPrompts(
  narration: string,
  imageUrl: string,
): Promise<RefinedDinoPrompt[] | null> {
  let llmConfig: ResolvedLlmConfig;
  try {
    llmConfig = await resolveLlmModel("vision_analysis");
  } catch {
    console.warn("[DinoRefiner] No vision LLM configured. Using regex fallback.");
    return null;
  }

  if (!llmConfig.apiKey) {
    console.warn("[DinoRefiner] No API key for vision LLM. Using regex fallback.");
    return null;
  }

  const provider = (llmConfig.provider || "openai").toLowerCase();

  const systemPrompt = `You are a visual analysis assistant for an explainer video pipeline.
Look at the diagram/screenshot and the NARRATION SCRIPT. Your job is to find the EXACT
visible text labels in the image that the narrator SPEAKS about. 

CRITICAL: Only include labels where the WORDS appear verbatim in the narration script.
If a label in the image (like "Tool Mastery") is NOT mentioned in the narration, SKIP IT.
Only return labels that the narrator actually says.

Return ONLY a JSON array, no other text:
[
  {
    "label": "Physical Dexterity",
    "mentionPhrase": "First, Physical Dexterity",
    "hpos": "left",
    "vpos": "middle",
    "order": 0
  }
]

Rules:
- "label": Short display label (2-4 words) EXACTLY matching visible text in the image AND spoken in the narration
- "mentionPhrase": EXACT first few words from narration that introduce this object. Copy verbatim.
- "hpos": Horizontal position — "left", "center", or "right"
- "vpos": Vertical position — "top", "middle", or "bottom"
- "order": 0-based sequence number matching narration order
- ONLY include labels the narrator actually says. Skip all others.`;

  const userPrompt = `Narration script:
"""
${narration}
"""

Analyze the image above. List every visual object mentioned in the narration, in order.`;

  try {
    let rawJson = "";

    if (provider === "gemini" || provider === "google") {
      rawJson = await callGeminiVision(llmConfig, imageUrl, systemPrompt, userPrompt);
    } else {
      rawJson = await callOpenAIVision(llmConfig, imageUrl, systemPrompt, userPrompt);
    }

    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) {
      console.warn("[DinoRefiner] LLM returned non-array. Using regex fallback.");
      return null;
    }

    const prompts: RefinedDinoPrompt[] = (parsed as Array<Record<string, unknown>>)
      .filter((p) => typeof p.label === "string")
      .map((p, i) => ({
        label: String(p.label).trim(),
        mentionPhrase: typeof p.mentionPhrase === "string" ? String(p.mentionPhrase).trim() : String(p.label).trim(),
        order: typeof p.order === "number" ? p.order : i,
        hpos: typeof p.hpos === "string" ? String(p.hpos).trim() : undefined,
        vpos: typeof p.vpos === "string" ? String(p.vpos).trim() : undefined,
      }))
      .sort((a, b) => a.order - b.order);

    if (prompts.length === 0) {
      console.warn("[DinoRefiner] No valid prompts in LLM response.");
      return null;
    }

    console.log(
      `[DinoRefiner] LLM produced ${prompts.length} keywords:`,
      prompts.map((p) => `"${p.label}" (${p.hpos || "?"}/${p.vpos || "?"})`).join(", "),
    );

    return prompts;
  } catch (err) {
    console.warn("[DinoRefiner] LLM call failed:", err);
    return null;
  }
}

// ── Provider Implementations ──────────────────────────────

async function callGeminiVision(
  config: ResolvedLlmConfig,
  imageUrl: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  let base64Image = "";
  let mimeType = "image/png";

  try {
    const imgRes = await fetchWithRetry(imageUrl, {}, 2, 500);
    if (imgRes.ok) {
      const contentType = imgRes.headers.get("content-type") || "";
      if (contentType.includes("jpeg") || contentType.includes("jpg")) mimeType = "image/jpeg";
      else if (contentType.includes("webp")) mimeType = "image/webp";
      else if (contentType.includes("gif")) mimeType = "image/gif";

      const arrayBuf = await imgRes.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      base64Image = btoa(binary);
    }
  } catch (err) {
    console.warn("[DinoRefiner] Failed to download image for Gemini:", err);
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${config.modelName}:generateContent?key=${config.apiKey}`;

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
    { text: `${systemPrompt}\n\n${userPrompt}` },
  ];
  if (base64Image) {
    parts.unshift({ inlineData: { mimeType, data: base64Image } });
  }

  const res = await fetchWithRetry(
    endpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
    2,
    1000,
  );

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  return text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
}

async function callOpenAIVision(
  config: ResolvedLlmConfig,
  imageUrl: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const endpoint = `${config.baseUrl || "https://api.openai.com/v1"}/chat/completions`;

  const res = await fetchWithRetry(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelName,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    },
    2,
    1000,
  );

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";

  try {
    const parsed = JSON.parse(text);
    if (parsed.prompts && Array.isArray(parsed.prompts)) {
      return JSON.stringify(parsed.prompts);
    }
  } catch {
    // not JSON-wrapped, just return raw
  }

  return text;
}
