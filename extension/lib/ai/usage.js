// How much of each AI plan you've used: Claude's 5-hour and weekly limits, Codex's and Gemini's (agy) limits. No vscode
// here: the providers report into it (Claude Code sends `rate_limit_event` with every answer; Codex's app server sends
// `account/rateLimits/updated`; agy's /usage and token counts). lib/account.js shows it in the status bar and
// lib/usage-panel.js in the AI Usage panel at the bottom.
//
// A report: { provider: "claude" | "codex" | "agy", windows: [{ id, label, usedPercent, resetsAt (ms), period? }],
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

// Tokens are counted per day (agy reports what each answer used).
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

// ---------- in words ----------
// "5-hour limit", "Weekly limit", "Weekly limit (Opus)", "Gemini: weekly limit".
function limitName(w) {
  const l = String(w.label || w.id || "Limit");
  if (w.period === "week") return `${l}: weekly limit`;
  if (/^week\b/i.test(l)) return `Weekly limit${l.slice(4)}`;
  if (/^\d+-(hour|day|minute)$/.test(l)) return `${l} limit`;
  return /limit/i.test(l) ? l : `${l} limit`;
}
// How long until `t` (ms): "42 min", "2 h 10 min", "3 days 4 h". short: "42m", "2h 10m", "3d 4h".
function until(t, now = Date.now(), short = false) {
  if (!t) return "";
  const m = Math.max(0, Math.round((t - now) / 60000));
  const [mi, h, d] = short ? ["m", "h", "d"] : [" min", " h", null];
  if (m < 60) return `${m}${mi}`;
  if (m < 24 * 60) { const hh = Math.floor(m / 60), mm = m % 60; return `${hh}${h}${mm ? ` ${mm}${mi}` : ""}`; }
  const dd = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60);
  return short ? `${dd}d${hh ? ` ${hh}h` : ""}` : `${dd} day${dd > 1 ? "s" : ""}${hh ? ` ${hh} h` : ""}`;
}
// One window in words: "5-hour limit 50% used, resets in 42 min".
function inWords(w, now = Date.now()) {
  const pct = `${Math.round(w.usedPercent)}%`;
  const reset = w.resetsAt ? (w.resetsAt <= now ? ", resets now" : `, resets in ${until(w.resetsAt, now)}`) : "";
  return `${limitName(w)} ${pct} used${reset}`;
}

const onChange = (f) => { listeners.add(f); return { dispose: () => listeners.delete(f) }; };
const providers = () => [...state.keys()];
// Saved between starts (the status bar shows the last numbers right away).
const snapshot = () => Object.fromEntries(state);
function restore(saved) { for (const [k, v] of Object.entries(saved || {})) if (!state.has(k) && v) state.set(k, v); }

module.exports = { report, fromClaude, current, limitName, until, inWords, onChange, providers, snapshot, restore, _reset: () => state.clear() };
