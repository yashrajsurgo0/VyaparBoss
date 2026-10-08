// Minimal Google Gemini API client (generateContent REST endpoint, Node's built-in fetch).
// Same interface as anthropic.js: { complete(prompt), json(prompt), model, provider }.
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function createGemini({ apiKey, model }) {
  if (!apiKey) return null;
  async function call(prompt, { maxTokens = 800, system, json } = {}) {
    const res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
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
    if (!res.ok) throw new Error(`Gemini API ${res.status}: ${body?.error?.message || "request failed"}`);
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
