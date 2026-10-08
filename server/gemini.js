// Minimal Google Gemini API client (generateContent REST endpoint, Node's built-in fetch).
// Same interface as anthropic.js: { complete(prompt), json(prompt), model, provider }.
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function createGemini({ apiKey, model, fallbackModel, retryDelayMs = 800 }) {
  if (!apiKey) return null;
  // Google returns 503 "high demand" at busy times: retry once, then try the fallback model.
  async function call(prompt, opts = {}) {
    const models = [model, model, fallbackModel].filter(Boolean);
    let lastErr;
    for (let i = 0; i < models.length; i++) {
      try { return await callModel(models[i], prompt, opts); }
      catch (e) {
        lastErr = e;
        if (!RETRYABLE.has(e.status)) throw e;
        if (i < models.length - 1) await sleep(retryDelayMs * (i + 1));
      }
    }
    throw lastErr;
  }
  async function callModel(modelId, prompt, { maxTokens = 800, system, json } = {}) {
    const res = await fetch(`${BASE}/${encodeURIComponent(modelId)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2, ...(json ? { responseMimeType: "application/json" } : {}) },
      }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(`Gemini API ${res.status} (${modelId}): ${body?.error?.message || "request failed"}`), { status: res.status });
    const cand = body.candidates?.[0];
    const text = (cand?.content?.parts || []).filter(p => typeof p.text === "string" && !p.thought).map(p => p.text).join("").trim();
    if (!text) throw new Error(`Gemini returned no text (${cand?.finishReason || body.promptFeedback?.blockReason || "unknown reason"})`);
    return text;
  }
  return {
    provider: "Gemini",
    model,
    complete: (prompt, opts = {}) => call(prompt, opts),
    async json(prompt) {
      const text = await call(prompt, { json: true, system: "Reply with a single JSON value only. No prose, no code fences." });
      const start = text.search(/[\[{]/), end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
      if (start === -1 || end < start) throw new Error("Model reply had no JSON");
      return JSON.parse(text.slice(start, end + 1));
    },
  };
}

module.exports = { createGemini };
