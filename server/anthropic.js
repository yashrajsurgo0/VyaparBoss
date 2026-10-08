// Minimal Anthropic Messages API client (no SDK needed; uses Node's built-in fetch).
const API = "https://api.anthropic.com/v1/messages";

function createClaude({ apiKey, model }) {
  if (!apiKey) return null;
  async function complete(prompt, { maxTokens = 600, system } = {}) {
    const res = await fetch(API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${body?.error?.message || "request failed"}`);
    return (body.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
  }
  async function json(prompt) {
    const text = await complete(prompt, { system: "Reply with a single JSON value only. No prose, no code fences." });
    const start = text.search(/[\[{]/), end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    if (start === -1 || end < start) throw new Error("Model reply had no JSON");
    return JSON.parse(text.slice(start, end + 1));
  }
  return { provider: "Claude", complete, json, model };
}

module.exports = { createClaude };
