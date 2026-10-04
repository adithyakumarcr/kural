// How much of each AI plan you've used: Claude's 5-hour and weekly limits, Codex's limits, Gemini's tokens. No vscode
// here: the providers report into it (Claude Code sends `rate_limit_event` with every answer; Codex's app server sends
// `account/rateLimits/updated`; Gemini sends token counts), and lib/usage-bar.js shows it in the status bar.
//
// A report: { provider: "claude" | "codex" | "gemini", windows: [{ id, label, usedPercent, resetsAt (ms) }],
//             tokens?: { input, output }, plan?: "Pro" }
// Nothing here ever reads a login or a key: only what the providers' own programs report.

const state = new Map();       // provider -> { windows, tokens, plan, at }
const listeners = new Set();

function report(provider, info) {
  if (!provider || !info) return;
  const old = state.get(provider) || {};
  const next = { ...old, at: Date.now() };
  if (Array.isArray(info.windows) && info.windows.length) next.windows = info.windows.filter((w) => w && Number.isFinite(w.usedPercent));
  if (info.tokens) next.tokens = addTokens(old.tokens, info.tokens);
  if (info.plan) next.plan = info.plan;
  state.set(provider, next);
  for (const f of listeners) { try { f(provider, next); } catch { /* a listener's own problem */ } }
}

// Tokens are counted per day (Gemini reports what each answer used).
function addTokens(old, t) {
  const day = new Date().toDateString();
  const base = old && old.day === day ? old : { day, input: 0, output: 0 };
  return { day, input: base.input + (t.input || 0), output: base.output + (t.output || 0) };
}

// Claude Code's rate_limit_event → a report. { rate_limit_info: { unifiedWindows: { five_hour: { utilization 0–1,
// resetsAt (s) }, seven_day: {…} }, status, rateLimitType, resetsAt } }
const CLAUDE_WINDOWS = { five_hour: "5-hour", seven_day: "Week", seven_day_opus: "Week (Opus)", seven_day_sonnet: "Week (Sonnet)" };
function fromClaude(msg) {
  const info = msg && msg.rate_limit_info;
  if (!info) return null;
  const windows = [];
  for (const [id, w] of Object.entries(info.unifiedWindows || {})) {
    if (!w || typeof w.utilization !== "number") continue;
    windows.push({ id, label: CLAUDE_WINDOWS[id] || id.replace(/_/g, " "), usedPercent: Math.round(w.utilization * 1000) / 10, resetsAt: w.resetsAt ? w.resetsAt * 1000 : null });
  }
  // Older Claude Code: only the window that's closest to its limit.
  if (!windows.length && typeof info.utilization === "number") {
    const id = info.rateLimitType || "five_hour";
    windows.push({ id, label: CLAUDE_WINDOWS[id] || id, usedPercent: Math.round(info.utilization * 1000) / 10, resetsAt: info.resetsAt ? info.resetsAt * 1000 : null });
  }
  return windows.length ? { windows } : null;
}

// A window whose reset time has passed starts again at 0.
function current(provider) {
  const s = state.get(provider);
  if (!s) return null;
  const now = Date.now();
  const windows = (s.windows || []).map((w) => w.resetsAt && w.resetsAt <= now ? { ...w, usedPercent: 0, resetsAt: null, reset: true } : w);
  const tokens = s.tokens && s.tokens.day === new Date().toDateString() ? s.tokens : null;
  return { ...s, windows, tokens };
}

const onChange = (f) => { listeners.add(f); return { dispose: () => listeners.delete(f) }; };
const providers = () => [...state.keys()];
// Saved between starts (the status bar shows the last numbers right away).
const snapshot = () => Object.fromEntries(state);
function restore(saved) { for (const [k, v] of Object.entries(saved || {})) if (!state.has(k) && v) state.set(k, v); }

module.exports = { report, fromClaude, current, onChange, providers, snapshot, restore, _reset: () => state.clear() };
