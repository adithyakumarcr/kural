// What Auto learns from what you do after its answers, per workspace (the way Tab Completion learns): you pick another
// model right after an Auto answer (the one you picked suits requests like it better), you undo every change of an Auto
// answer (that model didn't manage it), or you carry on with your next message (it was fine). Later, similar requests
// lean the same way: advise() → request.learned for lib/router/policy.js `select`. Similar = sharing enough words; it's
// a hint, not a rule (capability checks and the profile still decide). No vscode here; the chat saves it in
// workspaceState. "Kural: Forget What Model Router Learned" clears it.
const MAX = 300, MONTH = 30 * 86400000;
const STOP = new Set(["the","this","that","and","for","with","from","into","what","where","when","how","why","can","you",
  "please","make","does","are","was","have","has","not","but","just","all","any","then","than","there","here","its","our",
  "your","about","some","like","want","need","would","could","should","also","will","them","they","these","those"]);
const words = (s) => [...new Set(String(s || "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
  .match(/[\p{L}\p{N}_]{3,}/gu) || [])].filter((w) => !STOP.has(w)).slice(0, 40);
const similarity = (a, b) => {
  if (!a.length || !b.length) return 0;
  const B = new Set(b); let both = 0;
  for (const w of a) if (B.has(w)) both++;
  return both / (a.length + b.length - both);
};
const KINDS = new Set(["good", "bad", "better"]);
const valid = (e) => e && KINDS.has(e.kind) && Array.isArray(e.w) && typeof e.model === "string" && Number.isFinite(e.at) &&
  (e.kind !== "better" || typeof e.better === "string");

class RouterMemory {
  // enabled(): false = learning is off (setting kural.modelRouter.learn): record() learns nothing and advise() gives no hint.
  constructor(load = () => [], save = () => {}, enabled = () => true) {
    this.save = save;
    this.enabled = enabled;
    let saved = []; try { saved = load() || []; } catch { /* a broken save starts empty */ }
    this.items = (Array.isArray(saved) ? saved : []).filter(valid).slice(-MAX);
  }
  // kind "good" | "bad" | "better" (then `better` is the model you picked instead).
  record(kind, { prompt, model, better }, now = Date.now()) {
    const w = words(prompt);
    if (!this.enabled() || !KINDS.has(kind) || !model || w.length < 2 || (kind === "better" && (!better || better === model))) return false;
    const key = w.join(" ");
    // A later verdict on the same answer replaces the earlier one (carried on, then undid it: bad).
    this.items = this.items.filter((e) => !(e.model === model && e.w.join(" ") === key));
    this.items.push({ kind, w, model, ...(kind === "better" ? { better } : {}), at: now });
    this.items = this.items.slice(-MAX);
    try { this.save(this.items); } catch { /* best effort */ }
    return true;
  }
  // { lean: { model id: number }, matches } — positive: prefer it, negative: avoid it. Recent and closer requests count more.
  advise(prompt, now = Date.now()) {
    const w = words(prompt), lean = {};
    let matches = 0;
    if (w.length < 2 || !this.enabled()) return { lean, matches };
    const add = (id, n) => { lean[id] = (lean[id] || 0) + n; };
    for (const e of this.items) {
      const sim = similarity(w, e.w);
      if (sim < .3) continue;
      const weight = sim * Math.pow(.5, Math.max(0, now - e.at) / MONTH);
      matches++;
      if (e.kind === "good") add(e.model, .5 * weight);
      else { add(e.model, -weight); if (e.kind === "better") add(e.better, 1.5 * weight); }
    }
    return { lean, matches };
  }
  forget() { this.items = []; try { this.save(this.items); } catch { /* best effort */ } }
}

module.exports = { RouterMemory, words, similarity };
