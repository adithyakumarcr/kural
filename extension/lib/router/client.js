// Local assistance only: no hosted decision endpoint, credentials, Python service or new runtime dependency.
const { INTENTS,COMPLEXITIES } = require("./policy");
const abortError = () => Object.assign(new Error("Cancelled"),{ name: "AbortError" });
const MODEL = "all-minilm:22m";
// Example requests per label (written for this, not taken from the benchmark corpus). A request gets the label whose
// examples it's closest to (the mean of its two closest). One example per label made MiniLM unsure about most requests
// (21 of 24 fell back to Native in the 6 Oct benchmark); several per label cover more ways of saying the same thing.
const EXAMPLES = {
  search: ["Where is the code that handles user login?", "Which file defines the database connection settings?",
    "Show me where this config value gets read", "Locate the place that sends the welcome email",
    "In which module is the payments API route declared?", "Find all callers of the save function"],
  explain: ["Explain what this function does", "How does this caching code work?", "What is this regular expression matching?",
    "Why does this loop start at index one?", "Describe what happens when this button is clicked", "What does this error message mean?"],
  edit: ["Add a dark mode toggle to the settings page", "Implement pagination for the products list",
    "Create a new endpoint that returns the user's orders", "Change the button color to blue",
    "Refactor this class to use async and await", "Write unit tests for the cart totals"],
  review: ["Debug why the app crashes when I upload a file", "Find the bug that makes the totals wrong",
    "Review my pull request for mistakes", "This test fails now and then, figure out why",
    "Check this code for security problems", "The page is blank after login, track down the cause"],
  other: ["Suggest a good name for this library", "Should we use Postgres or MongoDB here?", "Compare two approaches to state management",
    "Hello, what can you help me with?", "Give me ideas for new features", "Summarize our conversation so far"],
  simple: ["Rename this variable", "Fix the spelling in this string", "Add a comment above this function",
    "Change the port number to 8080", "What does this line do?", "Where is the main function?"],
  standard: ["Add input validation to this form and test it", "Fix the off-by-one error in this module",
    "Implement a function that parses dates, with tests", "Write an endpoint for updating a user profile",
    "Investigate why this request times out", "Split this file into smaller functions"],
  complex: ["Design the architecture for a real-time chat service", "Migrate the whole project from JavaScript to TypeScript",
    "Find and fix race conditions between these worker threads", "Add authentication across the frontend, backend and database",
    "Plan a zero-downtime database schema migration", "Audit the entire codebase for security vulnerabilities"],
};
const LABELS = Object.keys(EXAMPLES);
const SEEDS = LABELS.flatMap((label) => EXAMPLES[label].map((text) => [label, text]));
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
  // "missing" (Ollama is running, the model isn't there), "ready", or "offline" (Ollama isn't running).
  async state(settings) {
    try {
      const res = await this.fetch(loopback(settings.url)+"/api/tags",{ signal: AbortSignal.timeout(2000),redirect: "error" });
      if (!res.ok) return "offline";
      return ((await res.json()).models || []).some((m) => m.name === MODEL || m.name === `${MODEL}:latest`) ? "ready" : "missing";
    } catch { return "offline"; }
  }
  // Download the model; onProgress(percent).
  async download(settings,onProgress = () => {},signal) {
    const res = await this.fetch(loopback(settings.url)+"/api/pull",{ method: "POST",headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL,stream: true }),signal,redirect: "error" });
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
  async classify(prompt,settings,signal) {
    return this.run(settings,signal,async (req,base) => {
      const model = MODEL;
      await this.verify(req,base,model);
      const key = `${base}/${model}`,cached = this.seeds.get(key);
      const out = await this.embed(req,model,cached ? [prompt] : [prompt,...SEEDS.map((s) => s[1])]);
      const seeds = cached || out.vectors.slice(1);if (!cached) this.seeds.set(key,seeds);
      const near = SEEDS.map((s,i) => ({ label: s[0],score: cosine(out.vectors[0],seeds[i]) }));
      // Each label: the mean of its two closest examples (one lucky match counts less).
      const scored = LABELS.map((label) => {
        const top = near.filter((n) => n.label === label).map((n) => n.score).sort((a,b) => b-a).slice(0,2);
        return { label,score: top.reduce((a,b) => a+b,0)/top.length };
      });
      // A label only when it's clearly ahead. Each half stands alone: sure of the kind of task but not its size, the
      // size comes from Native (the router merges), instead of throwing both away.
      const best = (labels) => {
        const values = scored.filter((s) => labels.includes(s.label)).sort((a,b) => b.score-a.score);
        return values[0].score >= settings.minSimilarity && values[0].score-values[1].score >= settings.minMargin ? values[0].label : null;
      };
      const intent = best(INTENTS),complexity = best(COMPLEXITIES);
      if (!intent && !complexity) throw new Error("Ambiguous semantic match; native routing used");
      return { task: { ...(intent ? { intent } : {}),...(complexity ? { complexity } : {}) },tokens: out.tokens,source: "minilm" };
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
module.exports = { LocalRouterClient,loopback,cosine,SEEDS,LABELS,EXAMPLES,MODEL,abortError };
