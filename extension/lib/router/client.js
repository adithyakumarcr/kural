// Local assistance only: no hosted decision endpoint, credentials, Python service or new runtime dependency.
const { INTENTS,COMPLEXITIES } = require("./policy");
const abortError = () => Object.assign(new Error("Cancelled"),{ name: "AbortError" });
const MODEL = "all-minilm:22m";
const SEEDS = [
  ["search","Find where settings are stored and locate the function definition"],
  ["explain","Explain what this existing code does and why it works"],
  ["edit","Implement a feature, change code, create a function and add tests"],
  ["review","Debug a crash, review a patch and investigate a bug"],
  ["other","Discuss ideas and answer a general question"],
  ["simple","Rename a variable, fix a typo, add a comment or explain one line"],
  ["standard","Implement a function and its tests, fix a bug in a module"],
  ["complex","Design an architecture, fix concurrency across multiple modules, migrate a distributed system"],
];
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
  constructor(fetchImpl = globalThis.fetch) { this.fetch = fetchImpl;this.verified = new Map();this.seeds = new Map(); }
  async run(settings, signal, fn) {
    if (signal && signal.aborted) throw abortError();
    if (settings.assistant !== "minilm") throw new Error("MiniLM is the only local router helper");
    const base = loopback(settings.url),ctl = new AbortController();let timer,abort;
    const interrupted = new Promise((_,reject) => {
      const fail = (message) => { ctl.abort();reject(Object.assign(new Error(message),{ name: "AbortError" })); };
      timer = setTimeout(() => fail("Local router deadline exceeded"),settings.timeoutMs);
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
    if (!installed) throw new Error("Router model isn't installed; run: ollama pull all-minilm:22m");
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
  async classify(prompt,settings,signal) {
    return this.run(settings,signal,async (req,base) => {
      const model = MODEL;
      await this.verify(req,base,model);
      const key = `${base}/${model}`,cached = this.seeds.get(key);
      const out = await this.embed(req,model,cached ? [prompt] : [prompt,...SEEDS.map((s) => s[1])]);
      const seeds = cached || out.vectors.slice(1);if (!cached) this.seeds.set(key,seeds);
      const scored = SEEDS.map((s,i) => ({ label: s[0],score: cosine(out.vectors[0],seeds[i]) }));
      const best = (labels) => {
        const values = scored.filter((s) => labels.includes(s.label)).sort((a,b) => b.score-a.score);
        if (values[0].score < settings.minSimilarity || values[0].score-values[1].score < settings.minMargin) throw new Error("Ambiguous semantic match; native routing used");
        return values[0].label;
      };
      return { task: { intent: best(INTENTS),complexity: best(COMPLEXITIES) },tokens: out.tokens,source: "minilm" };
    });
  }
  async rank(query,candidates,settings,signal) {
    return this.run(settings,signal,async (req,base) => {
      await this.verify(req,base,MODEL);
      const out = await this.embed(req,MODEL,[query,...candidates.map((c) => `${c.file}\n${c.excerpt || c.text || ""}`)]);
      return { candidates: candidates.map((c,i) => ({ ...c,similarity: cosine(out.vectors[0],out.vectors[i+1]) })),tokens: out.tokens };
    });
  }
}
module.exports = { LocalRouterClient,loopback,cosine,SEEDS,MODEL,abortError };
