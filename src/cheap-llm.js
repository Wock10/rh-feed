/**
 * Tiny cheap-model client. Off unless a key is set.
 * Default: OpenRouter gemini flash lite. Override with VAPORWARE_MODEL / VAPORWARE_API_BASE.
 */
const DEFAULT_MODEL = process.env.VAPORWARE_MODEL || "google/gemini-2.0-flash-lite";
const MAX_OUT = 80;
const MAX_PER_HOUR = 4;

export class CheapLlm {
  constructor(env = process.env) {
    this.key =
      env.VAPORWARE_API_KEY ||
      env.OPENROUTER_API_KEY ||
      env.GEMINI_API_KEY ||
      "";
    this.base = env.VAPORWARE_API_BASE || "https://openrouter.ai/api/v1";
    this.model = DEFAULT_MODEL;
    this.auto = env.VAPORWARE_AUTO === "1";
    this.calls = [];
  }

  get enabled() {
    return Boolean(this.key);
  }

  remaining() {
    const cutoff = Date.now() - 60 * 60 * 1000;
    this.calls = this.calls.filter((t) => t > cutoff);
    return Math.max(0, MAX_PER_HOUR - this.calls.length);
  }

  async complete(prompt) {
    if (!this.enabled) {
      throw new Error("No cheap-model key. Set VAPORWARE_API_KEY or OPENROUTER_API_KEY.");
    }
    if (this.remaining() <= 0) {
      throw new Error(`Hourly cap hit (${MAX_PER_HOUR}). Copy the pack instead.`);
    }
    this.calls.push(Date.now());
    const res = await fetch(`${this.base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.key}`,
        "content-type": "application/json",
        "http-referer": "https://github.com/Wock10/rh-feed",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: MAX_OUT,
        messages: [{ role: "user", content: prompt.slice(0, 3500) }],
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`LLM ${res.status}: ${text.slice(0, 200)}`);
    const data = JSON.parse(text);
    const content = data?.choices?.[0]?.message?.content ?? "";
    return parseVerdict(content);
  }
}

export function parseVerdict(raw) {
  const text = String(raw ?? "");
  const verdict =
    text.match(/verdict:\s*(real|thin|vapor)/i)?.[1]?.toLowerCase() || "thin";
  const confidence = Number(text.match(/confidence:\s*(\d+)/i)?.[1] ?? 50);
  const why = text.match(/why:\s*(.+)/i)?.[1]?.trim().slice(0, 180) || text.slice(0, 180);
  const red = text.match(/red_flags:\s*(.+)/i)?.[1]?.trim() || "";
  return {
    verdict,
    confidence: Number.isFinite(confidence) ? confidence : 50,
    why,
    redFlags: red
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8),
    raw: text.slice(0, 400),
    at: Date.now(),
  };
}
