// Native policy owns capability checks and model selection. Local AI only labels the task.
const { excludedModel } = require("../ai/model-policy");
const PROFILES = {
  balanced: "Meet the task's quality needs, then prefer speed.",
  speed: "Prefer speed among models suitable for this task.",
  quality: "Prefer capability even when it takes longer.",
};
const profileOf = (v) => Object.hasOwn(PROFILES, v) ? v : "balanced";
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
function classify(prompt) {
  const p = String(prompt || "").toLowerCase();
  const intent = /\b(debug|review|crash|race condition|vulnerability|bug)\b/.test(p) ? "review" :
    /\b(implement|build|create|change|edit|fix|refactor|add|remove|rename)\b/.test(p) ? "edit" :
    /\b(find|where|locate|search)\b/.test(p) ? "search" : /\b(explain|what|how|why)\b/.test(p) ? "explain" : "other";
  const complex = /\b(architect\w*|distributed|concurren\w*|security|migration|across (the |multiple )?(project|files|modules)|race condition|deadlock|end.to.end|multi.file)\b/.test(p) || p.length > 1800;
  const simple = /\b(rename|typo|format|comment|one.line|single.line|find|where|locate|explain)\b/.test(p) && p.length < 500;
  return { intent,complexity: complex ? "complex" : simple ? "simple" : "standard" };
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
function select(models, request, settings, task = classify(request.prompt)) {
  models = eligible(models,request,settings);
  if (!models.length) return { error: "No allowed model can handle this request. Turn on more models in Model Router." };
  const profile = profileOf(request.profile || settings.profile), preferences = settings.modelPreferences || {};
  const current = models.find((m) => m.id === request.current);
  let floor = profile === "quality" ? 3 : task.complexity === "simple" ? 1 : task.complexity === "complex" && profile === "balanced" ? 3 : 2;
  if (request.checkpoint && current) floor = Math.max(floor,Math.min(3,traits(current,preferences).quality+1));
  const top = Math.max(...models.map((m) => traits(m,preferences).quality));
  floor = Math.min(floor,top);
  const candidates = models.filter((m) => traits(m,preferences).quality >= floor);
  const observed = candidates.filter((m) => Number.isFinite(m.observedTaskMs) && m.observedTaskMs > 0);
  const maxTime = Math.max(1,...observed.map((m) => m.observedTaskMs));
  const score = (m) => {
    const t = traits(m,preferences);
    // Timing only breaks ties when every candidate has observations. Different tasks are not comparable benchmarks.
    const speed = observed.length === candidates.length ? 3*(1-m.observedTaskMs/maxTime) : t.speed;
    return (profile === "quality" ? 3*t.quality + speed*.3 : 2*speed + t.quality*.3) +
      (settings.saveTokens ? t.tokens*1.2 : 0) + (current && m.providerId === current.providerId ? .2 : 0) + (m.id === request.current ? .15 : 0);
  };
  const chosen = [...candidates].sort((a,b) => score(b)-score(a) || a.id.localeCompare(b.id))[0];
  return { model: chosen.id,source: "native",intent: task.intent,complexity: task.complexity,
    reason: `${profileOf(profile)} profile · ${task.complexity} ${task.intent} task${request.checkpoint ? " · reassessed after tool failure" : ""}${settings.saveTokens ? " · token efficiency preferred" : ""}` };
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
module.exports = { PROFILES,INTENTS,COMPLEXITIES,profileOf,eligible,classify,traits,select,contextWithinBudget,lexicalRank };
