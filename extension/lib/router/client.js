// Local assistance only: no hosted decision endpoint, credentials, Python service or new runtime dependency.
//
// A helper model reads how much work a request is by comparing it with the labelled requests in examples.json: each
// size's (and kind's) examples are averaged into one point (a centroid), and the request gets probabilities from how close
// it is to each. Those are blended with the word classifier's in policy.js. The centroids are computed once per model
// (one batch of embeddings, about a second) and saved, so routing itself is one embedding: 7-45 ms (test/router-eval.js).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { INTENTS,COMPLEXITIES } = require("./policy");
const EXAMPLES = require("./examples.json").examples;
const abortError = () => Object.assign(new Error("Cancelled"),{ name: "AbortError" });
// The helpers Model Router offers (Ollama models; all Apache-2.0). Measured on examples.json with 10-fold cross-validation
// on an Apple M5 (docs/wiki/Model-Router.md): share of request sizes read right, and time per request.
const HELPERS = {
  granite: { model: "granite-embedding:30m", label: "Granite", size: "63 MB", note: "84 % of sizes right, 10 ms" },
  qwen3: { model: "qwen3-embedding:0.6b", label: "Qwen3 Embedding", size: "640 MB", note: "90 % of sizes right, 45 ms" },
  minilm: { model: "all-minilm:22m", label: "MiniLM", size: "46 MB", note: "79 % of sizes right, 7 ms" },
};
const MODEL = HELPERS.minilm.model;   // (the first helper Kural offered; still accepted)
const helperOf = (assistant) => HELPERS[assistant] || null;
// Models that expect a task prefix (their model cards).
const PREFIX = { "nomic-embed-text": "classification: ", "embeddinggemma": "task: classification | query: ",
  "qwen3-embedding:0.6b": "Instruct: Classify how much work this request to a coding assistant needs\nQuery: " };
const TEMPERATURE = 0.01;   // how sharply closeness turns into probability (chosen by test/router-eval-blend.js)
const norm = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n); };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
// { label: average direction of its examples }; examples: [{ vec (normalised), size, kind }].
function centroids(examples, field, labels) {
  const out = {};
  for (const l of labels) {
    const vs = examples.filter((e) => e[field] === l).map((e) => e.vec);
    if (vs.length) out[l] = norm(vs[0].map((_, d) => vs.reduce((s, v) => s + v[d], 0)));
  }
  return out;
}
function probsFrom(vec, cents, temperature = TEMPERATURE) {
  const labels = Object.keys(cents), z = labels.map((l) => dot(cents[l], vec) / temperature), m = Math.max(...z);
  const e = z.map((x) => Math.exp(x - m)), sum = e.reduce((a, x) => a + x, 0);
  return Object.fromEntries(labels.map((l, i) => [l, e[i] / sum]));
}
const centroidProbs = (vec, examples, field, labels, temperature) => probsFrom(vec, centroids(examples, field, labels), temperature);
const EXAMPLES_HASH = crypto.createHash("sha256").update(JSON.stringify(EXAMPLES)).digest("hex").slice(0, 16);
function loopback(base) {
  const u = new URL(base || "http://127.0.0.1:11434");
  if (!["http:","https:"].includes(u.protocol) || !(u.hostname === "localhost" || u.hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(u.hostname)) ||
    u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) throw new Error("Router assistance requires Ollama on this computer");
  return u.origin;
}
function cosine(a,b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length || a.some((x) => !Number.isFinite(x)) || b.some((x) => !Number.isFinite(x))) throw new Error("Invalid embeddings");
  let dot=0,na=0,nb=0;
  for (let i=0;i<a.length;i++) { dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i]; }
  if (!na || !nb) throw new Error("Empty embedding");
  return Math.max(-1,Math.min(1,dot/Math.sqrt(na*nb)));
}
class LocalRouterClient {
  // cacheDir: where the centroids are saved (Kural's globalStorage), so they're computed once per model.
  constructor(fetchImpl = globalThis.fetch, cacheDir = null) {
    this.fetch = fetchImpl;this.cacheDir = cacheDir;this.verified = new Map();this.seeds = new Map();this.preparing = new Map();
  }
  async run(settings, signal, fn, timeoutMs = settings.timeoutMs) {
    if (signal && signal.aborted) throw abortError();
    if (!helperOf(settings.assistant)) throw new Error("Not a local router helper");
    const base = loopback(settings.url),ctl = new AbortController();let timer,abort;
    const interrupted = new Promise((_,reject) => {
      const fail = (message) => { ctl.abort();reject(Object.assign(new Error(message),{ name: "AbortError" })); };
      timer = setTimeout(() => fail("Local router deadline exceeded"),timeoutMs);
      abort = () => fail("Cancelled");if (signal) signal.addEventListener("abort",abort,{ once: true });
    });
    const req = async (p,body) => {
      if (ctl.signal.aborted) throw abortError();
      const response = await this.fetch(base+p,{ method: body ? "POST" : "GET",headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,signal: ctl.signal,redirect: "error" });
      if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
      return response.json();
    };
    try { return await Promise.race([interrupted,fn(req,base)]); }
    finally { clearTimeout(timer);if (signal) signal.removeEventListener("abort",abort); }
  }
  async verify(req,base,model) {
    if (!model || typeof model !== "string" || model.length > 200 || /cloud/i.test(model)) throw new Error("Choose an installed local model");
    const key = `${base}/${model}`;
    const cached = this.verified.get(key);
    if (cached && Date.now()-cached.at < 60000) return cached.capabilities;
    const tags = await req("/api/tags");
    const installed = (tags.models || []).find((m) => m.name === model || m.name === `${model}:latest`);
    if (!installed) throw new Error(`Router model isn't installed; download it in Model Router (ollama pull ${model})`);
    if (installed.remote_host || installed.remote_model) throw new Error("Cloud models cannot assist the local router");
    const info = await req("/api/show",{ model });
    if (info.remote_host || info.remote_model || (info.capabilities || []).includes("cloud")) throw new Error("Cloud models cannot assist the local router");
    const capabilities = Array.isArray(info.capabilities) ? info.capabilities : [];
    this.verified.set(key,{ at: Date.now(),capabilities });if (this.verified.size > 32) this.verified.delete(this.verified.keys().next().value);
    return capabilities;
  }
  async embed(req,model,texts) {
    const out = await req("/api/embed",{ model,input: texts.map((s) => String(s).slice(0,1600)),truncate: true,keep_alive: "5m" });
    if (!Array.isArray(out.embeddings) || out.embeddings.length !== texts.length) throw new Error("Invalid embedding count");
    for (const v of out.embeddings) cosine(v,out.embeddings[0]);
    return { vectors: out.embeddings,tokens: Math.max(0,Number(out.prompt_eval_count)||0) };
  }
  // "missing" (Ollama is running, the model isn't there), "ready", or "offline" (Ollama isn't running).
  async state(settings) {
    try {
      const res = await this.fetch(loopback(settings.url)+"/api/tags",{ signal: AbortSignal.timeout(2000),redirect: "error" });
      if (!res.ok) return "offline";
      const model = (helperOf(settings.assistant) || HELPERS.minilm).model;
      return ((await res.json()).models || []).some((m) => m.name === model || m.name === `${model}:latest`) ? "ready" : "missing";
    } catch { return "offline"; }
  }
  // Download the model; onProgress(percent).
  async download(settings,onProgress = () => {},signal) {
    const res = await this.fetch(loopback(settings.url)+"/api/pull",{ method: "POST",headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: (helperOf(settings.assistant) || HELPERS.minilm).model,stream: true }),signal,redirect: "error" });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const reader = res.body.getReader();let buf = "",status = "";
    for (;;) {
      const { done,value } = await reader.read();if (done) break;
      buf += Buffer.from(value).toString("utf8");let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0,i).trim();buf = buf.slice(i+1);if (!line) continue;
        let m;try { m = JSON.parse(line); } catch { continue; }
        if (m.error) throw new Error(String(m.error));
        status = m.status || status;if (m.total) onProgress(Math.round(100*(m.completed || 0)/m.total));
      }
    }
    if (!/success/i.test(status)) throw new Error(`download stopped (${status || "no answer"})`);
    this.verified.clear();
  }
  // The centroids of examples.json for this helper: from memory, the saved file, or computed now (one batch of embeddings,
  // about a second: done by prepare(), outside a routing request's deadline).
  cacheFile(model) { return this.cacheDir ? path.join(this.cacheDir, `router-${model.replace(/[^\w.-]+/g, "_")}.json`) : null; }
  loaded(base, model) {
    const key = `${base}/${model}`;
    if (this.seeds.has(key)) return this.seeds.get(key);
    try {
      const saved = JSON.parse(fs.readFileSync(this.cacheFile(model), "utf8"));
      if (saved.model === model && saved.examples === EXAMPLES_HASH && saved.size && saved.kind) { this.seeds.set(key, saved); return saved; }
    } catch { /* not computed yet */ }
    return null;
  }
  // Computes and saves the centroids if they aren't there yet. One at a time per model; safe to call often.
  prepare(settings) {
    const helper = helperOf(settings.assistant);
    if (!helper) return Promise.resolve(false);
    const base = loopback(settings.url), key = `${base}/${helper.model}`;
    if (this.loaded(base, helper.model)) return Promise.resolve(true);
    if (this.preparing.has(key)) return this.preparing.get(key);
    const job = this.run(settings, null, async (req) => {
      await this.verify(req, base, helper.model);
      const pre = PREFIX[helper.model] || "", vecs = [];
      for (let i = 0; i < EXAMPLES.length; i += 64) vecs.push(...(await this.embed(req, helper.model, EXAMPLES.slice(i, i + 64).map((e) => pre + e[0]))).vectors.map(norm));
      const ex = EXAMPLES.map((e, i) => ({ vec: vecs[i], size: e[1], kind: e[2] }));
      const r = (v) => v.map((x) => Math.round(x * 1e6) / 1e6);
      const round = (c) => Object.fromEntries(Object.entries(c).map(([l, v]) => [l, r(v)]));
      const out = { model: helper.model, examples: EXAMPLES_HASH, size: round(centroids(ex, "size", COMPLEXITIES)), kind: round(centroids(ex, "kind", INTENTS)) };
      this.seeds.set(key, out);
      const file = this.cacheFile(helper.model);
      if (file) { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(out)); } catch { /* memory only */ } }
      return true;
    }, Math.max(settings.timeoutMs || 0, 60000)).finally(() => this.preparing.delete(key));
    this.preparing.set(key, job);
    return job;
  }
  async classify(prompt,settings,signal) {
    const helper = helperOf(settings.assistant);
    if (!helper) throw new Error("Not a local router helper");
    const base = loopback(settings.url);
    if (!this.loaded(base, helper.model)) {
      // Not ready yet: get ready in the background and let Native decide this one (no cooldown for that).
      this.prepare(settings).catch(() => {});
      throw new Error(`${helper.label} is getting ready (first use); native routing used`);
    }
    return this.run(settings,signal,async (req,base) => {
      await this.verify(req,base,helper.model);
      const cents = this.loaded(base, helper.model);
      const out = await this.embed(req,helper.model,[(PREFIX[helper.model] || "") + prompt]);
      const vec = norm(out.vectors[0]);
      return { task: { sizeProbs: probsFrom(vec, cents.size), kindProbs: probsFrom(vec, cents.kind) },tokens: out.tokens,source: settings.assistant };
    });
  }
  async rank(query,candidates,settings,signal) {
    const helper = helperOf(settings.assistant);
    return this.run(settings,signal,async (req,base) => {
      await this.verify(req,base,helper.model);
      const out = await this.embed(req,helper.model,[query,...candidates.map((c) => `${c.file}\n${c.excerpt || c.text || ""}`)]);
      return { candidates: candidates.map((c,i) => ({ ...c,similarity: cosine(out.vectors[0],out.vectors[i+1]) })),tokens: out.tokens };
    });
  }
}
module.exports = { LocalRouterClient,loopback,cosine,HELPERS,helperOf,PREFIX,centroids,probsFrom,centroidProbs,EXAMPLES_HASH,MODEL,abortError };
