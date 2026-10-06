// Qwen 0.5B is no longer offered or used by Kural. Existing Tab settings use the recommended model.
const DEFAULT_COMPLETION_MODEL = "qwen2.5-coder:1.5b-base";
const excludedModel = (name) => /^(?:ollama:)?qwen[^:]*:0\.5b(?:-|:|$)/i.test(String(name || ""));
const completionModel = (name) => !name || excludedModel(name) ? DEFAULT_COMPLETION_MODEL : name;
module.exports = { excludedModel, completionModel, DEFAULT_COMPLETION_MODEL };
