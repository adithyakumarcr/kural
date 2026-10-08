// Native policy owns capability checks and model selection. Local AI only labels the task.
//
// How Auto chooses (like Cursor's router): read how much work the request is (simple / standard / complex: lib/router/
// words.js, optionally MiniLM), turn that and your profile into the capability it needs (tier 1 light, 2 balanced,
// 3 most capable), then take the lightest model that has it, preferring the AI with room left in its usage limits and
// the one the conversation is already on. Only Claude, Google Gemini and ChatGPT (Codex) models: models on this
// computer are never picked by Auto (they stay in the menu to pick yourself).
const { excludedModel } = require("../ai/model-policy");
const { classifyWords } = require("./words");
// Cursor's names for the same three trade-offs. Kural's plans are flat-rate, so what "Cost" saves is your usage limits.
const PROFILES = {
  cost: "Lightest model that can do it; the most capable only for complex work. Saves your usage limits.",
  balance: "A model that fits the task: light for quick questions, balanced for normal work, the most capable for complex work.",
  intelligence: "One step more capable than the task needs; quick questions still use a cheaper model.",
};
const ALIASES = { speed: "cost", balanced: "balance", quality: "intelligence" };   // (names before Oct 2026)
const profileOf = (v) => Object.hasOwn(PROFILES, v) ? v : ALIASES[v] || "balance";
const INTENTS = ["search", "explain", "edit", "review", "other"];
const COMPLEXITIES = ["simple", "standard", "complex"];
// The capability (tier) a task needs, per profile. Cost reads and explains with light models, but code changes and
// reviews get a balanced one; complex work always gets the most capable, in every profile.
function needTier(profile, task) {
  const p = profileOf(profile);
  if (task.complexity === "complex") return 3;
  if (task.complexity === "simple") return p === "intelligence" ? 2 : 1;
  if (p === "intelligence") return 3;
  if (p === "cost") return ["edit", "review"].includes(task.intent) ? 2 : 1;
  return 2;
}
// Auto picks from the AIs with accounts (Claude, Gemini, Codex): never a model on this computer, never a Tab-only one.
function eligible(models, request) {
  return models.filter((m) => m.ready && !m.completionOnly && !m.local && !excludedModel(m.id) &&
    (!request.provider || m.providerId === request.provider) &&
    (!request.team || m.team) && (!request.device || m.device) &&
    (!request.images || m.images) && (!request.pdf || m.pdf) &&
    (!request.connectors || m.connectors) &&
    (!(request.mode === "agent" && request.editing) || m.commands));
}
// Error output pasted into the message: a stack trace, "TypeError: …", a panic, a failed exit code.
const TRACE = /traceback \(most recent call last\)|\b\w*(?:error|exception):\s|^\s+at \S+ \(?\S+:\d+:\d+\)?|\bpanic:|segmentation fault|exit (?:code|status) [1-9]/im;
// How much MiniLM's view counts against the word classifier's when both are there (test/router-eval-blend.js).
const HELPER_WEIGHT = 0.5;
const blend = (a, b, w) => Object.fromEntries(Object.keys(a).map((k) => [k, (1 - w) * a[k] + w * ((b && b[k]) || 0)]));
const argmax = (probs) => Object.entries(probs).sort((x, y) => y[1] - x[1])[0][0];
// The size and kind from the words (words.js), blended with a helper's when there is one (MiniLM: { sizeProbs,
// kindProbs }), then what came with them (Cursor's "attached context"): context = { files, chars, errors, elements }
// (files/selections attached, their size, error output, elements picked in the browser).
function classify(prompt, context = {}, helper = null) {
  const raw = String(prompt || ""), w = classifyWords(raw);
  const sizeProbs = helper && helper.sizeProbs ? blend(w.sizeProbs, helper.sizeProbs, HELPER_WEIGHT) : w.sizeProbs;
  const kindProbs = helper && helper.kindProbs ? blend(w.kindProbs, helper.kindProbs, HELPER_WEIGHT) : w.kindProbs;
  let intent = argmax(kindProbs), complexity = argmax(sizeProbs);
  context = context || {};
  const signals = [], errors = !!context.errors || TRACE.test(raw);
  const files = Math.max(0, Number(context.files) || 0), chars = Math.max(0, Number(context.chars) || 0);
  if (errors) { signals.push("error output"); if (intent === "other" || intent === "explain") intent = "review"; }
  if (context.elements) { signals.push("a picked page element"); if (intent === "other") intent = "edit"; }
  // Much attached code is more work than the words say; an error makes a "simple" request at least standard.
  let bump = files >= 8 || chars > 120000 ? 2 : files >= 4 || chars > 40000 ? 1 : 0;
  if (bump) signals.push(files ? `${files} files attached` : "a lot of attached text");
  if (errors && complexity === "simple") bump = Math.max(bump, 1);
  if (raw.length > 1800 && complexity === "simple") bump = Math.max(bump, 1);   // a long message isn't a quick question
  complexity = COMPLEXITIES[Math.min(2, COMPLEXITIES.indexOf(complexity) + bump)];
  return { intent, complexity, sizeProbs, ...(signals.length ? { signals } : {}) };
}
// How capable a model is: tier 1 (light: Haiku, Gemini Flash, GPT "fast and affordable"), 2 (balanced: Sonnet, most
// models), 3 (the most capable: Opus, Gemini Pro, "frontier"/"flagship" models). From the name and the description the
// program gives (Codex: "Fast and affordable model for easier tasks"). Old models ("legacy", "older") lose ties.
const LIGHT = /\b(haiku|mini|nano|flash|lite|lightweight|fastest|fast and (?:affordable|efficient|cheap)|affordable|cheapest|easier tasks|quick tasks)\b/;
const STRONG = /\b(opus|pro|max|ultra|most capable|most intelligent|frontier|flagship|hardest|complex (?:work|tasks|problems)|deepest)\b/;
const LEGACY = /\b(legacy|older|deprecated|previous generation)\b/;
function traits(model, overrides = {}) {
  const name = `${model.id} ${model.label || ""} ${model.description || ""}`.toLowerCase();
  const params = /(?:^|[^\d.])(\d+(?:\.\d+)?)b\b/.exec(name);
  const quality = model.local && params ? Number(params[1]) < 4 ? 1 : Number(params[1]) >= 20 ? 3 : 2
    : STRONG.test(name) ? 3 : LIGHT.test(name) ? 1 : 2;
  const custom = overrides[model.id] || {};
  const band = (v,d) => Number.isInteger(v) && v >= 1 && v <= 3 ? v : d;
  return { quality: band(custom.quality,quality),speed: band(custom.speed,4-quality),tokens: band(custom.tokens,4-quality),legacy: LEGACY.test(name) };
}
// How much of a model's usage limit is used (0–100), from its provider's report in lib/ai/usage.js: the fullest general
// window, plus the model's own weekly window when there is one (Claude's "seven_day_opus" counts only for Opus).
function limitUsed(model, report) {
  if (report && report.blockedUntil > Date.now()) return 100;   // it refused a request: the limit is reached
  if (!report || !Array.isArray(report.windows)) return null;
  const name = String(model.id || "").toLowerCase();
  const counts = (w) => {
    const own = /^seven_day_(\w+)$/.exec(w.id || "");
    if (own) return name.includes(own[1]);
    // Gemini reports weekly limits per model family (including Claude models served by Antigravity).
    const family = /^agy:/.test(name) && /\b(gemini|claude)\b/i.exec(w.label || w.id || "");
    return !family || /:default$/.test(name) || name.includes(family[1].toLowerCase());
  };
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
// Near a limit (Adithya: "if Claude's usage is hitting the limits, the router must prioritize ChatGPT models"): from 80 %
// a push away that grows to 98 % (skipped from there), stronger than staying on the chat's AI is ever worth (at most
// 2.9), in every profile: a long conversation moves too (its record goes along, lib/router/journal.js handoff). Leaving
// an AI that's near its limit, Claude and ChatGPT (Codex) come before Gemini, which can't ask before a command.
const NEAR = 80, FULL = 98;
const nearLimit = (used) => used >= NEAR ? 3 + 6 * (used - NEAR) / (FULL - NEAR) : 0;
const LEAVING_TO = { claude: .4, codex: .4, agy: 0 };
const TIER_NAME = { 1: "light", 2: "balanced", 3: "most capable" };
const pct = (n) => `${Math.round(n)}%`;
// request: prompt, current (model id), profile, historyChars (the conversation so far), learned ({ model id: -2…2 } from
// what you did after similar requests, lib/router/learn.js), checkpoint, and capability needs (see eligible).
// models: each may carry limitUsed (0–100) and observedTaskMs.
function select(models, request, settings, task = classify(request.prompt)) {
  const all = models;
  models = eligible(models,request);
  // avoid: an AI whose limit was just reached (its answer failed on it): any other AI that can do it.
  if (request.avoid) { const others = models.filter((m) => m.providerId !== request.avoid); if (others.length) models = others; }
  if (!models.length) return { error: request.provider ? "No model of the current AI can handle this request."
    : "Auto picks from Claude, Google Gemini and ChatGPT (Codex): set one up in Get started, or pick a model yourself." };
  const profile = profileOf(request.profile || settings.profile), preferences = settings.modelPreferences || {};
  const used = (m) => Number.isFinite(m.limitUsed) ? m.limitUsed : 0;
  const tier = (m) => traits(m,preferences).quality;
  const notes = [];
  // The user's optional threshold also applies when Auto selects a model.
  const guard = settings.usageSwitch;
  if (guard && guard.enabled) {
    const under = models.filter((m) => used(m) < guard.threshold);
    if (under.length && under.length < models.length) {
      models = under;
      notes.push(`kept below your ${guard.threshold}% usage threshold`);
    }
  }
  // Nearly out (98 %+): not chosen while another model can do the task.
  const full = models.filter((m) => used(m) >= 98);
  if (full.length && full.length < models.length) {
    models = models.filter((m) => used(m) < 98);
    notes.push(`skipped ${[...new Set(full.map((m) => m.provider || m.providerId))].join(", ")} (limit nearly reached)`);
  }
  const current = models.find((m) => m.id === request.current);
  const learned = request.learned && typeof request.learned === "object" ? request.learned : {};
  const lean = (m) => Math.max(-2, Math.min(2, Number(learned[m.id]) || 0));
  let need = needTier(profile, task);
  if (request.checkpoint && current) need = Math.max(need, Math.min(3, tier(current) + 1));
  // You chose a stronger model than Auto's for requests like this one: that becomes what's needed.
  const wanted = models.filter((m) => lean(m) >= 1).map(tier);
  if (wanted.length && Math.max(...wanted) > need) { need = Math.max(...wanted); notes.push("you chose a stronger model for similar requests"); }
  const top = Math.max(...models.map(tier));
  if (need > top) notes.push(`no ${TIER_NAME[need]} model set up: the most capable one available`);
  need = Math.min(need, top);
  const candidates = models.filter((m) => tier(m) >= need);
  const observed = candidates.filter((m) => Number.isFinite(m.observedTaskMs) && m.observedTaskMs > 0);
  const maxTime = Math.max(1,...observed.map((m) => m.observedTaskMs));
  // Switching costs more the longer the conversation: another model starts without the prompt cache, another AI needs the
  // whole conversation handed over (a new program, the record sent along). So the current model and AI win close calls,
  // but never against the task's needs or a lighter model that's enough.
  const history = Math.max(0, Number(request.historyChars) || 0);
  const stayModel = .3 + Math.min(.8, history / 60000), stayProvider = .3 + Math.min(1.5, history / 40000);
  // The chat's AI is near its limit (80 %+; or its answer just failed on the limit: avoid): going elsewhere.
  const was = all.find((m) => m.id === request.current) || null;
  const currentProvider = request.avoid || (was && was.providerId) || null;
  const currentUsed = request.avoid ? 100 : was && Number.isFinite(was.limitUsed) ? was.limitUsed : 0;
  const leaving = currentUsed >= NEAR;
  const score = (m, parts = { limits: true, stay: true }) => {
    const t = traits(m,preferences);
    // Timing only breaks ties when every candidate has observations. Different tasks are not comparable benchmarks.
    const speed = observed.length === candidates.length ? 1 - m.observedTaskMs/maxTime : 0;
    return -2.5 * (t.quality - need) - (t.legacy ? .8 : 0) + .3 * speed +
      ((settings.saveTokens || profile === "cost") ? .2 * t.tokens : 0) + 1.2*lean(m) +
      (parts.limits ? -LIMIT_WEIGHT[profile] * Math.max(0, used(m) - 50) / 50 - nearLimit(used(m)) : 0) +
      (parts.limits && leaving && m.providerId !== currentProvider ? LEAVING_TO[m.providerId] || 0 : 0) +
      (parts.stay ? (m.id === request.current ? stayModel : 0) + (current && m.providerId === current.providerId ? stayProvider : 0) : 0);
  };
  const best = (parts) => [...candidates].sort((a,b) => score(b,parts)-score(a,parts) || a.id.localeCompare(b.id))[0];
  const chosen = best();
  // Say why when the limits or the conversation changed the choice.
  const plain = best({ limits: false, stay: true });
  if (plain !== chosen && used(plain) >= 50) notes.push(`${plain.label || plain.id} avoided: ${pct(used(plain))} of its limit used`);
  if (leaving && currentProvider && chosen.providerId !== currentProvider) {
    const name = (was && was.provider) || { claude: "Claude", codex: "ChatGPT (Codex)", agy: "Google Gemini" }[currentProvider] || currentProvider;
    notes.push(request.avoid ? `${name} reached its limit: continued on ${chosen.provider || chosen.providerId}` : `left ${name}: ${pct(currentUsed)} of its limit used`);
  }
  const fresh = best({ limits: true, stay: false });
  if (fresh !== chosen && current && chosen.providerId === current.providerId && history > 20000)
    notes.push(chosen.id === request.current ? "stayed on the current model: switching would lose the conversation's cache"
      : `stayed with ${chosen.provider || chosen.providerId}: handing the conversation to another AI costs more than it gains`);
  const effort = effortFor(task,profile,settings);
  return { model: chosen.id,source: "native",intent: task.intent,complexity: task.complexity,effort,tier: tier(chosen),need,
    reason: [`${profile} profile`, `${task.complexity} ${task.intent} task${task.signals ? ` (${task.signals.join(", ")})` : ""}`,
      `needs a ${TIER_NAME[need]} model`, `${effort} intensity`,
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
module.exports = { needTier,effortFor,limitUsed,ALIASES,PROFILES,INTENTS,COMPLEXITIES,profileOf,eligible,classify,traits,select,contextWithinBudget,lexicalRank };
