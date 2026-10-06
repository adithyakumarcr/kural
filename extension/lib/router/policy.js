// Native policy owns capability checks and model selection. Local AI only labels the task.
const { excludedModel } = require("../ai/model-policy");
// Cursor's names for the same three trade-offs. Kural's plans are flat-rate, so what "Cost" saves is your usage limits.
const PROFILES = {
  cost: "Save your usage limits: the lightest model that can do the task, on the AI with the most room left.",
  balance: "Meet the task's quality needs, then prefer speed; steer away from an AI close to its limit.",
  intelligence: "Prefer the most capable model, even when it's slower or uses more of your limits.",
};
const ALIASES = { speed: "cost", balanced: "balance", quality: "intelligence" };   // (names before Oct 2026)
const profileOf = (v) => Object.hasOwn(PROFILES, v) ? v : ALIASES[v] || "balance";
const INTENTS = ["search", "explain", "edit", "review", "other"];
const COMPLEXITIES = ["simple", "standard", "complex"];
function eligible(models, request, settings) {
  const allowed = settings.allowedModels;
  return models.filter((m) => m.ready && !m.completionOnly && !excludedModel(m.id) && (!Array.isArray(allowed) || allowed.includes(m.id)) &&
    (!request.provider || m.providerId === request.provider) &&
    (settings.allowCloud !== false || m.local) &&
    (!request.team || m.team) && (!request.device || m.device) &&
    (!request.images || m.images) && (!request.pdf || m.pdf) &&
    (!request.connectors || m.connectors) &&
    (!(request.mode === "agent" && request.editing) || m.commands));
}
// Error output pasted into the message: a stack trace, "TypeError: …", a panic, a failed exit code.
const TRACE = /traceback \(most recent call last\)|\b\w*(?:error|exception):\s|^\s+at \S+ \(?\S+:\d+:\d+\)?|\bpanic:|segmentation fault|exit (?:code|status) [1-9]/im;
// The words, plus what came with them (Cursor's "attached context"): context = { files, chars, errors, elements }
// (files/selections attached, their size, error output, elements picked in the browser).
function classify(prompt, context = {}) {
  // (File names don't describe the task: "rename architecture.md" isn't architecture work.)
  const raw = String(prompt || ""), p = raw.toLowerCase().replace(/[\w./-]*\w\.(?:[a-z][a-z0-9]{0,4})\b/g, " file ");
  let intent = /\b(debug|review|crash|race condition|vulnerability|bug)\b/.test(p) ? "review" :
    /\b(implement|build|create|change|edit|fix|refactor|add|remove|rename|update|write|delete|move|replace|improve|convert)\b/.test(p) ? "edit" :
    /\b(find|where|locate|search)\b/.test(p) ? "search" : /\b(explain|what|what'?s|how|why)\b/.test(p) ? "explain" : "other";
  const complex = /\b(architect\w*|distributed|concurren\w*|security|migration|across (the |multiple )?(project|files|modules)|race condition|deadlock|end.to.end|multi.file)\b/.test(p) || p.length > 1800;
  // A very short message without an action word ("whats 2+2", "hi") is a small question, not normal-sized work.
  const tiny = p.trim().length < 40 && !["edit", "review"].includes(intent);
  const simple = (tiny || /\b(rename|typo|format|comment|one.line|single.line|find|where|locate|explain)\b/.test(p)) && p.length < 500;
  let complexity = complex ? "complex" : simple ? "simple" : "standard";
  // Which labels came from an explicit word ("fix", "rename", "architecture") and which are guesses ("other" when
  // nothing matched, "explain" from just "what/how/why", "standard" by default). A helper may replace only guesses:
  // in the 6 Oct benchmark the explicit words were right each time the two disagreed, MiniLM was right on the guesses.
  const sure = { intent: !["other", "explain"].includes(intent) || /\bexplain\b/.test(p), complexity: complex || simple };
  const signals = [], errors = !!context.errors || TRACE.test(raw);
  const files = Math.max(0, Number(context.files) || 0), chars = Math.max(0, Number(context.chars) || 0);
  if (errors) { signals.push("error output"); if (intent === "other" || intent === "explain") intent = "review"; }
  if (context.elements) { signals.push("a picked page element"); if (intent === "other") intent = "edit"; }
  // Much attached code is more work than the words say; an error makes a "simple" request at least standard.
  let bump = files >= 8 || chars > 120000 ? 2 : files >= 4 || chars > 40000 ? 1 : 0;
  if (bump) signals.push(files ? `${files} files attached` : "a lot of attached text");
  if (errors && complexity === "simple") bump = Math.max(bump, 1);
  complexity = COMPLEXITIES[Math.min(2, COMPLEXITIES.indexOf(complexity) + bump)];
  return { intent, complexity, sure, ...(signals.length ? { signals } : {}) };
}
function traits(model, overrides = {}) {
  const name = `${model.id} ${model.label || ""} ${model.description || ""}`.toLowerCase();
  const params = /(?:^|[^\d.])(\d+(?:\.\d+)?)b\b/.exec(name);
  const quality = /\b(opus|pro|max|most capable)\b/.test(name) ? 3 : /\b(haiku|mini|flash|fastest)\b/.test(name) ? 1 :
    model.local && params ? Number(params[1]) < 4 ? 1 : Number(params[1]) >= 20 ? 3 : 2 : 2;
  const custom = overrides[model.id] || {};
  const band = (v,d) => Number.isInteger(v) && v >= 1 && v <= 3 ? v : d;
  return { quality: band(custom.quality,quality),speed: band(custom.speed,4-quality),tokens: band(custom.tokens,4-quality) };
}
// How much of a model's usage limit is used (0–100), from its provider's report in lib/ai/usage.js: the fullest general
// window, plus the model's own weekly window when there is one (Claude's "seven_day_opus" counts only for Opus).
function limitUsed(model, report) {
  if (!report || !Array.isArray(report.windows)) return null;
  const name = String(model.id || "").toLowerCase();
  const counts = (w) => { const own = /^seven_day_(\w+)$/.exec(w.id || ""); return !own || name.includes(own[1]); };
  const used = report.windows.filter(counts).map((w) => w.usedPercent).filter(Number.isFinite);
  return used.length ? Math.max(...used) : null;
}
// Intensity (thinking effort) for the task: complexity sets it, the profile moves it one step. Max only for hard work
// under Intelligence. A model without intensity levels simply ignores it.
const EFFORT_LEVELS = ["low", "medium", "high", "max"];
function effortFor(task, profile, settings = {}) {
  const p = profileOf(profile), base = { simple: 0, standard: 1, complex: 2 }[task.complexity] ?? 1;
  const step = p === "cost" ? -1 : p === "intelligence" ? 1 : 0;
  return EFFORT_LEVELS[Math.max(0, Math.min(3, base + step - (settings.saveTokens && base > 0 ? 1 : 0)))];
}
const LIMIT_WEIGHT = { cost: 3, balance: 1.5, intelligence: .6 };
const pct = (n) => `${Math.round(n)}%`;
// request: prompt, current (model id), profile, historyChars (the conversation so far), learned ({ model id: -2…2 } from
// what you did after similar requests, lib/router/learn.js), checkpoint, and capability needs (see eligible).
// models: each may carry limitUsed (0–100) and observedTaskMs.
function select(models, request, settings, task = classify(request.prompt)) {
  models = eligible(models,request,settings);
  if (!models.length) return { error: "No allowed model can handle this request. Turn on more models in Model Router." };
  const profile = profileOf(request.profile || settings.profile), preferences = settings.modelPreferences || {};
  const used = (m) => Number.isFinite(m.limitUsed) ? m.limitUsed : 0;
  const notes = [];
  // Nearly out (98 %+): not chosen while another model can do the task.
  const full = models.filter((m) => used(m) >= 98);
  if (full.length && full.length < models.length) {
    models = models.filter((m) => used(m) < 98);
    notes.push(`skipped ${[...new Set(full.map((m) => m.provider || m.providerId))].join(", ")} (limit nearly reached)`);
  }
  const current = models.find((m) => m.id === request.current);
  const learned = request.learned && typeof request.learned === "object" ? request.learned : {};
  const lean = (m) => Math.max(-2, Math.min(2, Number(learned[m.id]) || 0));
  let floor = profile === "intelligence" ? 3 : task.complexity === "simple" ? 1 : task.complexity === "complex" && profile === "balance" ? 3 : 2;
  if (request.checkpoint && current) floor = Math.max(floor,Math.min(3,traits(current,preferences).quality+1));
  // You chose a stronger model than Auto's for requests like this one: that becomes the floor.
  const wanted = models.filter((m) => lean(m) >= 1).map((m) => traits(m,preferences).quality);
  if (wanted.length && Math.max(...wanted) > floor) { floor = Math.max(...wanted); notes.push("you chose a stronger model for similar requests"); }
  const top = Math.max(...models.map((m) => traits(m,preferences).quality));
  floor = Math.min(floor,top);
  const candidates = models.filter((m) => traits(m,preferences).quality >= floor);
  const observed = candidates.filter((m) => Number.isFinite(m.observedTaskMs) && m.observedTaskMs > 0);
  const maxTime = Math.max(1,...observed.map((m) => m.observedTaskMs));
  // Switching costs more the longer the conversation: another model starts without the prompt cache, another AI needs the
  // whole conversation handed over. So the current model wins unless the task clearly suits another better.
  const history = Math.max(0, Number(request.historyChars) || 0);
  const stayModel = .15 + Math.min(2, history / 25000), stayProvider = .2 + Math.min(1, history / 50000);
  const score = (m, parts = { limits: true, stay: true }) => {
    const t = traits(m,preferences);
    // Timing only breaks ties when every candidate has observations. Different tasks are not comparable benchmarks.
    const speed = observed.length === candidates.length ? 3*(1-m.observedTaskMs/maxTime) : t.speed;
    return (profile === "intelligence" ? 3*t.quality + speed*.3 : 2*speed + t.quality*.3) +
      (settings.saveTokens || profile === "cost" ? t.tokens*1.2 : 0) + 1.2*lean(m) +
      (parts.limits ? -LIMIT_WEIGHT[profile] * Math.max(0, used(m) - 50) / 50 : 0) +
      (parts.stay ? (m.id === request.current ? stayModel : 0) + (current && m.providerId === current.providerId ? stayProvider : 0) : 0);
  };
  const best = (parts) => [...candidates].sort((a,b) => score(b,parts)-score(a,parts) || a.id.localeCompare(b.id))[0];
  const chosen = best();
  // Say why when the limits or the conversation changed the choice.
  const plain = best({ limits: false, stay: true });
  if (plain !== chosen && used(plain) >= 50) notes.push(`${plain.label || plain.id} avoided: ${pct(used(plain))} of its limit used`);
  const fresh = best({ limits: true, stay: false });
  if (fresh !== chosen && chosen.id === request.current && history > 20000) notes.push("stayed on the current model: switching would lose the conversation's cache");
  const effort = effortFor(task,profile,settings);
  return { model: chosen.id,source: "native",intent: task.intent,complexity: task.complexity,effort,
    reason: [`${profile} profile`, `${task.complexity} ${task.intent} task${task.signals ? ` (${task.signals.join(", ")})` : ""}`, `${effort} intensity`,
      ...(request.checkpoint ? ["reassessed after tool failure"] : []), ...notes, ...(settings.saveTokens ? ["token efficiency preferred"] : [])].join(" · ") };
}
function contextWithinBudget(candidates, maxChars, limit = 5) {
  const selected = []; let used = 0;
  for (const c of candidates) {
    const cost = String(c.excerpt || "").length + String(c.file || "").length + 100;
    if (selected.length >= limit) break;
    if (used + cost > maxChars) continue;
    selected.push(c); used += cost;
  }
  return selected;
}
const words = (s) => [...new Set(String(s).replace(/([a-z])([A-Z])/g,"$1 $2").toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) || [])];
function lexicalRank(query, candidates) {
  const terms = words(query).filter((w) => !["the","this","that","where","what","how","find","explain","code","file","files","does","for","and"].includes(w));
  return candidates.map((c) => {
    const text = `${c.file} ${c.excerpt || c.text || ""}`.toLowerCase();
    const hits = terms.filter((w) => text.includes(w)).length;
    return { ...c,relevance: terms.length ? hits/terms.length : 0 };
  }).sort((a,b) => b.relevance-a.relevance);
}
module.exports = { effortFor,limitUsed,ALIASES,PROFILES,INTENTS,COMPLEXITIES,profileOf,eligible,classify,traits,select,contextWithinBudget,lexicalRank };
