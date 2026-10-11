// Optional usage protection for every chat, including a model picked by hand: when an AI's limit reaches the point you
// set, the chat carries on with another AI (same conversation). Each AI has two switch points, one for its Session
// limit (a few hours) and one for its Weekly limits (Kural Settings, on the AI's card). No vscode here.
const DEFAULT_THRESHOLD = 70;
const AIS = ["claude", "codex", "agy"];
const clamp = (n, d) => Number.isFinite(n) ? Math.max(1, Math.min(99, Math.round(n))) : d;

// settings: { enabled, threshold (the old single number: what an AI without its own points uses),
//             limits: { claude: { session, weekly }, codex: {…}, agy: {…} } }
function options(config) {
  const threshold = clamp(config.get("usageSwitch.threshold", DEFAULT_THRESHOLD), DEFAULT_THRESHOLD);
  const raw = config.get("usageSwitch.limits", {});
  const limits = {};
  for (const id of AIS) {
    const r = raw && typeof raw === "object" && raw[id] && typeof raw[id] === "object" ? raw[id] : {};
    limits[id] = { session: clamp(r.session, threshold), weekly: clamp(r.weekly, threshold) };
  }
  return { enabled: config.get("usageSwitch.enabled", false) === true, threshold, limits };
}

// Has this model's AI reached a switch point? { name: "Session" | "Weekly" | "", used, at } or null.
// model.limitParts ({ session, weekly }, lib/router/policy.js limitParts) when known, else model.limitUsed against the
// single threshold.
function over(model, settings) {
  const lim = settings.limits && settings.limits[model.providerId], p = model.limitParts;
  if (lim && p) {
    if (Number.isFinite(p.session) && p.session >= lim.session) return { name: "Session", used: p.session, at: lim.session };
    if (Number.isFinite(p.weekly) && p.weekly >= lim.weekly) return { name: "Weekly", used: p.weekly, at: lim.weekly };
    return null;
  }
  return Number.isFinite(model.limitUsed) && model.limitUsed >= settings.threshold ? { name: "", used: model.limitUsed, at: settings.threshold } : null;
}

function choose(models, request, settings) {
  if (!settings.enabled) return null;
  const { eligible, select } = require("../router/policy");
  const current = models.find((m) => m.id === request.current);
  const hit = current && over(current, settings);
  if (!hit) return null;
  const available = eligible(models, request).filter((m) => m.providerId !== current.providerId && !over(m, settings));
  if (!available.length) return null;
  const decision = select(available, { ...request, avoid: current.providerId }, { profile: request.profile || "balance" });
  if (!decision.model || decision.error) return null;
  const next = available.find((m) => m.id === decision.model);
  return { ...decision, reason: `${current.provider || current.providerId}'s ${hit.name ? hit.name + " limit" : "usage"} is ${Math.round(hit.used)}% used ` +
    `(you switch at ${hit.at}%): continued with ${next.provider || next.providerId}`, usageSwitch: true };
}

module.exports = { DEFAULT_THRESHOLD, AIS, options, over, choose };
