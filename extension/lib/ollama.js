// Models on your own computer, through Ollama (ollama.com): for the chat (and its agents), offline.
//
// How the chat uses them: the chat runs Claude Code, and Ollama (0.14 and newer) speaks the same API as
// Claude. So Kural starts Claude Code with ANTHROPIC_BASE_URL pointing at Ollama and the local model's name;
// everything else (editing files, asking before commands, agents) works the same.
//
// Two things a local model needs:
//   - tools: the chat edits files and runs commands through tool calls, so only models with the "tools"
//     capability are offered.
//   - a bigger context: Claude Code's instructions and tools alone are thousands of tokens, more than Ollama's
//     default window. Kural makes a copy of the model's settings with a larger window ("kural-<model>-32k";
//     no extra download or disk space: it shares the model's files) and tells Claude Code that size.
//
// Search: Ollama has no search API, so Kural reads ollama.com's search page (only the model list in it).
// If that page ever changes, a built-in list of good models is shown instead.
//
// No vscode here (tests run without it).

const os = require("os");

const MIN_VERSION = "0.14.0";   // first Ollama with the Claude-compatible API
const VARIANT = /^kural-/;      // our larger-context copies: not shown as separate models

// Shown when ollama.com can't be searched (offline, or its page changed). All can use tools.
const SUGGESTED = [
  { name: "qwen3-coder", description: "Alibaba's coding model, made for agentic coding.", sizes: ["30b"], capabilities: ["tools"] },
  { name: "gpt-oss", description: "OpenAI's open-weight model for reasoning and agentic tasks.", sizes: ["20b", "120b"], capabilities: ["tools", "thinking"] },
  { name: "devstral", description: "Mistral's model for coding agents.", sizes: ["24b"], capabilities: ["tools"] },
  { name: "qwen3", description: "Qwen's general model, from small to large.", sizes: ["4b", "8b", "14b", "30b"], capabilities: ["tools", "thinking"] },
  { name: "llama3.1", description: "Meta's general model.", sizes: ["8b", "70b"], capabilities: ["tools"] },
];

// "30b" -> 30 (billions of parameters); "500m" -> 0.5; "e2b" -> 2. null if it isn't a size.
function params(size) {
  const m = /^e?(\d+(?:\.\d+)?)([bm])$/i.exec(String(size || "").trim());
  return m ? Number(m[1]) / (m[2].toLowerCase() === "m" ? 1000 : 1) : null;
}

// Roughly how much memory a model needs to run (Ollama's usual 4-bit download, plus room for a 32k context).
function memoryGB(size) {
  const p = params(size);
  return p == null ? null : Math.max(1, Math.round(p * 0.62 + 2));
}

const versionAtLeast = (v, min) => {
  const a = String(v || "0").split(/[.-]/).map(Number), b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i]; }
  return true;
};

// ollama.com's search page -> [{ name, description, sizes, capabilities, pulls, updated }]. Each result is a list
// item with a link to /library/<name>; its text holds the description, capability words, sizes ("8b"), pulls
// ("1.2M Pulls") and "Updated …". Read loosely (link + text), so small changes to the page don't break it.
function parseSearch(html) {
  const out = [], seen = new Set();
  const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'");
  const text = (s) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  for (const li of String(html).split(/<li[\s>]/i).slice(1)) {
    const item = li.split(/<\/li>/i)[0];
    const link = /href="\/library\/([A-Za-z0-9._\/-]+)"/.exec(item);
    if (!link || link[1].includes("/") || seen.has(link[1])) continue;
    seen.add(link[1]);
    const name = link[1];
    const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(item);
    const all = text(item);
    const description = p ? text(p[1]) : "";
    const rest = description ? all.replace(description, " ") : all;   // sizes and badges, never the description's words
    const words = rest.split(" ");
    // Sizes are lower case on ollama.com ("8b", "30b", "e2b", "135m"); counts are upper case ("7.8M Pulls",
    // "1.2K Downloads"). So only lower-case words are sizes, and never one right before Pulls/Downloads/Tags.
    const sizes = [...new Set(words.filter((w, i) => /^e?\d+(\.\d+)?[bm]$/.test(w) && !/^(pulls|downloads|tags)$/i.test(words[i + 1] || "")))];
    const capabilities = ["tools", "thinking", "vision", "embedding", "cloud"].filter((c) => new RegExp(`\\b${c}\\b`, "i").test(rest));
    const pulls = (/([\d.]+[KMB]?)\s*(?:Pulls|Downloads)/i.exec(rest) || [])[1] || "";
    const updated = (/Updated\s+(.+?ago)/i.exec(rest) || [])[1] || "";
    out.push({ name, description, sizes, capabilities, pulls, updated });
  }
  return out;
}

class Ollama {
  // baseUrl: () => "http://127.0.0.1:11434"
  constructor(baseUrl, fetchImpl = globalThis.fetch) {
    this.baseUrl = baseUrl;
    this.fetch = fetchImpl;
    this.caps = new Map();   // model -> capabilities (from /api/show)
  }

  url(p) { return String(this.baseUrl() || "http://127.0.0.1:11434").replace(/\/$/, "") + p; }

  async req(p, { body, method, timeoutMs = 5000, signal } = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    if (signal) signal.addEventListener("abort", () => ctl.abort());
    try {
      const res = await this.fetch(this.url(p), { method: method || (body ? "POST" : "GET"), signal: ctl.signal,
        headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) throw new Error(friendly((await res.text().catch(() => "")).replace(/^\{"error":"|"\}$/g, "") || `HTTP ${res.status}`, body && body.model));
      return res;
    } finally { clearTimeout(t); }
  }

  // { running, version, ok (new enough for the chat) }
  async status() {
    try {
      const v = (await (await this.req("/api/version", { timeoutMs: 1500 })).json()).version;
      return { running: true, version: v, ok: versionAtLeast(v, MIN_VERSION) };
    } catch { return { running: false, version: null, ok: false }; }
  }

  // Installed models, with what they can do: [{ name, size (bytes), params ("30.5B"), capabilities, chat }]
  async models() {
    const list = ((await (await this.req("/api/tags", { timeoutMs: 3000 })).json()).models || [])
      .filter((m) => !VARIANT.test(m.name));
    for (const m of list) {
      if (!this.caps.has(m.name)) {
        try { this.caps.set(m.name, (await (await this.req("/api/show", { body: { model: m.name }, timeoutMs: 5000 })).json()).capabilities || []); }
        catch { this.caps.set(m.name, []); }
      }
    }
    return list.map((m) => {
      const capabilities = this.caps.get(m.name) || [];
      return { name: m.name, size: m.size || 0, params: (m.details && m.details.parameter_size) || "", capabilities,
        chat: capabilities.includes("tools") && !capabilities.includes("embedding") };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  // Download a model ("qwen3-coder:30b"). onProgress({ percent, status, completed, total }).
  async pull(name, onProgress = () => {}, signal) {
    const res = await this.req("/api/pull", { body: { model: name, stream: true }, timeoutMs: 6 * 60 * 60 * 1000, signal });
    const reader = res.body.getReader();
    let buf = "", last = { percent: 0, status: "starting" };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += Buffer.from(value).toString("utf8");
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.error) throw new Error(friendly(m.error, name));
        last = { status: m.status || last.status, completed: m.completed, total: m.total,
          percent: m.total ? Math.round(100 * (m.completed || 0) / m.total) : last.percent };
        onProgress(last);
      }
    }
    if (!/success/i.test(last.status)) throw new Error(`download stopped (${last.status})`);
    this.caps.delete(name);
  }

  async remove(name) {
    await this.req("/api/delete", { method: "DELETE", body: { model: name } });
    this.caps.delete(name);
    await this.req("/api/delete", { method: "DELETE", body: { model: variantName(name, 32768) } }).catch(() => {});
  }

  // The model with a context window of `ctx` tokens, as its own name (made once; shares the model's files).
  async withContext(name, ctx) {
    const v = variantName(name, ctx);
    const have = ((await (await this.req("/api/tags", { timeoutMs: 3000 })).json()).models || []).some((m) => m.name === v || m.name === `${v}:latest`);
    if (!have) await this.req("/api/create", { body: { model: v, from: name, parameters: { num_ctx: ctx }, stream: false }, timeoutMs: 120000 });
    return v;
  }

  // Search ollama.com's library for models that can use tools. Falls back to SUGGESTED (filtered by the words).
  async search(q, fetchPage = (u) => this.fetch(u, { headers: { "User-Agent": "Kural" } })) {
    const query = String(q || "").trim();
    try {
      const res = await fetchPage(`https://ollama.com/search?c=tools&q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const found = parseSearch(await res.text());
      if (found.length || query) return { results: found, from: "ollama.com" };
    } catch (e) { /* offline, or the page changed */ }
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return { results: SUGGESTED.filter((m) => words.every((w) => `${m.name} ${m.description}`.toLowerCase().includes(w))), from: "suggested" };
  }
}

// Ollama's "pull model manifest: file does not exist" means: no model (or no such size) by that name.
function friendly(msg, name) {
  return /file does not exist|manifest unknown/i.test(msg) && name ? `Ollama has no model called "${name}" (check the name and size)` : msg;
}

// "qwen3-coder:30b" -> "kural-qwen3-coder-30b-32k"
function variantName(name, ctx) {
  return `kural-${String(name).replace(/:latest$/, "").replace(/[^A-Za-z0-9.]+/g, "-")}-${Math.round(ctx / 1024)}k`;
}

const totalMemoryGB = () => Math.round(os.totalmem() / 1024 ** 3);

module.exports = { Ollama, parseSearch, params, memoryGB, variantName, versionAtLeast, totalMemoryGB, SUGGESTED, MIN_VERSION };
