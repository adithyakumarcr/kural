// How much of each AI plan you've used: Claude's session (5-hour) and weekly limits, Codex's and Gemini's (agy) limits. No vscode
// here: the providers report into it (Claude Code sends `rate_limit_event` with every answer; Codex's app server sends
// `account/rateLimits/updated`; agy's /usage and token counts). lib/account.js shows it in the status bar and
// lib/usage-panel.js in the AI Usage panel at the bottom.
//
// A report: { provider: "claude" | "codex" | "agy", windows: [{ id, label, usedPercent, resetsAt (ms), period? }],
//             tokens?: { input, output }, plan?: "Pro" }
// Tokens: addTokens(provider, { input, output, cacheRead, cacheWrite }) after every answer (every program, every Kural
// feature: chat, Tab Completion, Ctrl+K…), counted per day for the AI Usage panel ("1.2M read · 45k written").
// Nothing here ever reads a login or a key: only what the providers' own programs report.

const state = new Map();       // provider -> { windows, tokens, plan, at }
const listeners = new Set();

function report(provider, info) {
  if (!provider || !info) return;
  const old = state.get(provider) || {};
  const next = { ...old, at: Date.now() };
  if (Array.isArray(info.windows) && info.windows.length) next.windows = info.windows.filter((w) => w && Number.isFinite(w.usedPercent));
  // The program said a limit is reached (it refused a request): until when. Allowed again: no longer.
  if (info.blockedUntil) next.blockedUntil = info.blockedUntil;
  else if (info.allowed) delete next.blockedUntil;
  if (info.tokens) next.tokens = addTokensToday(old.tokens, info.tokens);
  if (info.plan) next.plan = info.plan;
  state.set(provider, next);
  for (const f of listeners) { try { f(provider, next); } catch { /* a listener's own problem */ } }
}

// Tokens are counted per day (agy reports what each answer used).
function addTokensToday(old, t) {
  const day = new Date().toDateString();
  const base = old && old.day === day ? old : { day, input: 0, output: 0 };
  return { day, input: base.input + (t.input || 0), output: base.output + (t.output || 0) };
}

// ---------- tokens per day ----------
const KEEP_DAYS = 35;
const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const FIELDS = ["input", "output", "cacheRead", "cacheWrite"];
const n = (x) => Math.max(0, Math.round(Number(x) || 0));
// { input (fresh), output, cacheRead, cacheWrite } from a Claude-style usage ({ input_tokens, output_tokens,
// cache_read_input_tokens, cache_creation_input_tokens }); null when there's nothing.
function fromUsage(u) {
  if (!u || typeof u !== "object") return null;
  const t = { input: n(u.input_tokens), output: n(u.output_tokens), cacheRead: n(u.cache_read_input_tokens), cacheWrite: n(u.cache_creation_input_tokens) };
  return FIELDS.some((f) => t[f]) ? t : null;
}
// Claude Code's result: modelUsage covers every model the answer used (agents too); usage only the main one.
function fromResult(m) {
  if (m && m.modelUsage && typeof m.modelUsage === "object" && Object.keys(m.modelUsage).length) {
    const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const u of Object.values(m.modelUsage)) {
      t.input += n(u.inputTokens); t.output += n(u.outputTokens); t.cacheRead += n(u.cacheReadInputTokens); t.cacheWrite += n(u.cacheCreationInputTokens);
    }
    if (FIELDS.some((f) => t[f])) return t;
  }
  return fromUsage(m && m.usage);
}
function addTokens(provider, t, now = Date.now()) {
  if (!provider || !t || !FIELDS.some((f) => n(t[f]))) return;
  const old = state.get(provider) || {};
  const days = { ...(old.days || {}) }, key = dayKey(now), d = { ...(days[key] || {}) };
  for (const f of FIELDS) d[f] = n(d[f]) + n(t[f]);
  days[key] = d;
  const keep = Object.keys(days).sort().slice(-KEEP_DAYS);
  const next = { ...old, days: Object.fromEntries(keep.map((k) => [k, days[k]])), at: old.at || now };
  state.set(provider, next);
  for (const f of listeners) { try { f(provider, next); } catch { /* a listener's own problem */ } }
}
// Totals over the last `days` days (1 = today): { input, output, cacheRead, cacheWrite, read (all input), written }.
function tokenTotals(provider, days = 1, now = Date.now()) {
  const s = state.get(provider), out = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const from = dayKey(now - (days - 1) * 86400000);
  for (const [k, d] of Object.entries((s && s.days) || {})) if (k >= from) for (const f of FIELDS) out[f] += n(d[f]);
  return { ...out, read: out.input + out.cacheRead + out.cacheWrite, written: out.output };
}
// "1.2M", "45k", "812".
function tokenWords(x) {
  const v = n(x);
  if (v >= 1e9) return `${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
  return String(v);
}

// Claude Code's rate_limit_event → a report. { rate_limit_info: { unifiedWindows: { five_hour: { utilization 0–1,
// resetsAt (s) }, seven_day: {…} }, status, rateLimitType, resetsAt } }
const CLAUDE_WINDOWS = { five_hour: "Session", seven_day: "Week", seven_day_opus: "Week (Opus)", seven_day_sonnet: "Week (Sonnet)" };
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
  // "rejected": a limit is reached right now (until it resets; Auto avoids Claude meanwhile: lib/router/policy.js).
  const rejected = info.status === "rejected";
  const reset = info.resetsAt ? info.resetsAt * 1000 : Math.max(0, ...windows.filter((w) => w.usedPercent >= 100).map((w) => w.resetsAt || 0));
  const out = { ...(windows.length ? { windows } : {}), ...(rejected ? { blockedUntil: reset > Date.now() ? reset : Date.now() + 30 * 60000 } : info.status === "allowed" ? { allowed: true } : {}) };
  return Object.keys(out).length ? out : null;
}

// An answer failed because this AI's limit is reached (its error said so): Auto avoids it until `until` (else 30 min).
function markLimited(provider, until) {
  report(provider, { blockedUntil: until && until > Date.now() ? until : Date.now() + 30 * 60000 });
}

// A window whose reset time has passed starts again at 0.
function current(provider) {
  const s = state.get(provider);
  if (!s) return null;
  const now = Date.now();
  const windows = (s.windows || []).map((w) => w.resetsAt && w.resetsAt <= now ? { ...w, usedPercent: 0, resetsAt: null, reset: true } : w);
  const tokens = s.tokens && s.tokens.day === new Date().toDateString() ? s.tokens : null;
  const out = { ...s, windows, tokens };
  if (!(out.blockedUntil > now)) delete out.blockedUntil;
  return out;
}

// ---------- in words ----------
// The short limit, a few hours long (Claude's and Codex's 5 hours), is the "Session" in everything Kural shows (Adithya);
// the long one is "Weekly". (Saved numbers from before were labelled "5-hour": still a session.)
const isSession = (w) => !!w && w.period !== "week" && (w.id === "five_hour" || /^session$/i.test(String(w.label || "")) || /^\d+-(hour|minute)$/.test(String(w.label || "")));
const isWeekly = (w) => !!w && !isSession(w) && (w.period === "week" || /^week/i.test(String(w.label || "")) || /^seven_day/.test(String(w.id || "")));
// "Session", "Weekly", "Weekly (Opus)", "Weekly (Gemini)" (Gemini's limits are per model family, each weekly), "3-day".
function limitName(w) {
  const l = String(w.label || w.id || "Limit");
  if (isSession(w)) return "Session";
  if (w.period === "week") return `Weekly (${l})`;
  if (/^week\b/i.test(l)) return `Weekly${l.slice(4)}`;
  return l;
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
// One window in words: "Session 50% used, resets in 42 min".
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

module.exports = { report, fromClaude, markLimited, current, limitName, isSession, isWeekly, until, inWords, onChange, providers, snapshot, restore,
  addTokens, tokenTotals, fromUsage, fromResult, tokenWords, dayKey, _reset: () => state.clear() };
