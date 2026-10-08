// Optional usage protection for every chat, including a model picked by hand. No vscode here.
const DEFAULT_THRESHOLD = 70;

function options(config) {
  const n = config.get("usageSwitch.threshold", DEFAULT_THRESHOLD);
  return { enabled: config.get("usageSwitch.enabled", false) === true,
    threshold: Number.isFinite(n) ? Math.max(1, Math.min(99, Math.round(n))) : DEFAULT_THRESHOLD };
}

function choose(models, request, settings) {
  if (!settings.enabled) return null;
  const { eligible, select } = require("../router/policy");
  const current = models.find((m) => m.id === request.current);
  if (!current || !Number.isFinite(current.limitUsed) || current.limitUsed < settings.threshold) return null;
  const available = eligible(models, request).filter((m) => m.providerId !== current.providerId &&
    (!Number.isFinite(m.limitUsed) || m.limitUsed < settings.threshold));
  if (!available.length) return null;
  const decision = select(available, { ...request, avoid: current.providerId }, { profile: request.profile || "balance" });
  if (!decision.model || decision.error) return null;
  const next = available.find((m) => m.id === decision.model);
  return { ...decision, reason: `${current.provider || current.providerId} used ${Math.round(current.limitUsed)}% ` +
    `(switch at ${settings.threshold}%): continued with ${next.provider || next.providerId}`, usageSwitch: true };
}

module.exports = { DEFAULT_THRESHOLD, options, choose };
