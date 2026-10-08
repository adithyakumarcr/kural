// The usage meter in words (lib/ai/usage.js; the status bar's short names in lib/account.js; the AI Usage panel's page).
const assert = require("assert");
const Module = require("module");
const load = Module._load;
Module._load = function (req, ...a) {
  if (req === "vscode") return { window: {}, workspace: { getConfiguration: () => ({ get: () => undefined }) }, ThemeColor: class {}, MarkdownString: class {} };
  return load.call(this, req, ...a);
};
const usage = require("../extension/lib/ai/usage");
const { _test: { shortName } } = require("../extension/lib/account");
const { _page } = require("../extension/lib/usage-panel");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const now = Date.UTC(2026, 9, 4, 12, 0);
const min = 60000;

check("Claude's limits in words: the 5-hour limit is the Session, then Weekly, with when they reset", () => {
  usage._reset();
  const r = usage.fromClaude({ rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: (now + 42 * min) / 1000 }, seven_day: { utilization: 0.25, resetsAt: (now + (3 * 1440 + 4 * 60) * min) / 1000 } } } });
  const [five, week] = r.windows;
  assert.strictEqual(usage.inWords(five, now), "Session 50% used, resets in 42 min");
  assert.strictEqual(usage.inWords(week, now), "Weekly 25% used, resets in 3 days 4 h");
  assert.strictEqual(shortName(five), "Session");
  assert.strictEqual(shortName(week), "Weekly");
  assert.ok(usage.isSession(five) && !usage.isSession(week) && usage.isWeekly(week) && !usage.isWeekly(five));
});
check("time until a reset, long and short", () => {
  assert.strictEqual(usage.until(now + 5 * min, now), "5 min");
  assert.strictEqual(usage.until(now + 130 * min, now), "2 h 10 min");
  assert.strictEqual(usage.until(now + 120 * min, now), "2 h");
  assert.strictEqual(usage.until(now + 1441 * min, now), "1 day");
  assert.strictEqual(usage.until(now + 130 * min, now, true), "2h 10m");
  assert.strictEqual(usage.until(now + (2 * 1440 + 60) * min, now, true), "2d 1h");
  assert.strictEqual(usage.until(now - min, now), "0 min");
});
check("other names: Codex's windows, Gemini's weekly limits, Opus's own week, numbers saved before the rename", () => {
  assert.strictEqual(usage.limitName({ label: "Week (Opus)" }), "Weekly (Opus)");
  assert.strictEqual(usage.limitName({ id: "primary", label: "Session" }), "Session");          // Codex's 5 hours
  assert.strictEqual(usage.limitName({ id: "five_hour", label: "5-hour" }), "Session");        // saved by an older Kural
  assert.strictEqual(usage.limitName({ id: "primary", label: "5-hour" }), "Session");
  assert.strictEqual(usage.limitName({ label: "3-day" }), "3-day");
  assert.strictEqual(usage.limitName({ label: "Gemini", period: "week" }), "Weekly (Gemini)");
  assert.strictEqual(shortName({ label: "Gemini", period: "week" }), "Weekly (Gemini)");
  assert.ok(usage.isWeekly({ label: "Gemini", period: "week" }) && !usage.isSession({ label: "Gemini", period: "week" }));
  assert.strictEqual(usage.inWords({ label: "Week", usedPercent: 12.4, resetsAt: null }, now), "Weekly 12% used");
});
check("the AI Usage page: its rules allow no outside scripts or styles", () => {
  const html = _page("abc", "vscode-resource:", "codicons.css");
  assert.ok(/default-src 'none'/.test(html) && /script-src 'nonce-abc'/.test(html) && /font-src vscode-resource:/.test(html));
  assert.ok(!/innerHTML/.test(html));   // (everything is built from text nodes)
});

check("tokens: Claude's result (all its models), per day, totals for today / 7 / 30 days", () => {
  usage._reset();
  const result = { usage: { input_tokens: 10, output_tokens: 5 }, modelUsage: {
    "claude-opus-4": { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 9000, cacheCreationInputTokens: 400, contextWindow: 200000 },
    "claude-haiku-4": { inputTokens: 20, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } };
  assert.deepStrictEqual(usage.fromResult(result), { input: 120, output: 60, cacheRead: 9000, cacheWrite: 400 });
  assert.deepStrictEqual(usage.fromResult({ usage: { input_tokens: 3, output_tokens: 4, cache_read_input_tokens: 5 } }), { input: 3, output: 4, cacheRead: 5, cacheWrite: 0 });
  assert.strictEqual(usage.fromResult({}), null);
  const day = 86400000, t0 = new Date(2026, 9, 7, 12).getTime();
  usage.addTokens("claude", { input: 120, output: 60, cacheRead: 9000, cacheWrite: 400 }, t0);
  usage.addTokens("claude", { input: 10, output: 1 }, t0 - 3 * day);
  usage.addTokens("claude", { input: 1000, output: 100 }, t0 - 20 * day);
  usage.addTokens("claude", { input: 0, output: 0 }, t0);   // nothing: ignored
  const today = usage.tokenTotals("claude", 1, t0), week = usage.tokenTotals("claude", 7, t0), month = usage.tokenTotals("claude", 30, t0);
  assert.deepStrictEqual([today.read, today.written, today.cacheRead], [9520, 60, 9000]);
  assert.deepStrictEqual([week.read, week.written], [9530, 61]);
  assert.deepStrictEqual([month.read, month.written], [10530, 161]);
  for (let i = 0; i < 50; i++) usage.addTokens("codex", { input: 1 }, t0 - i * day);   // only the last 35 days are kept
  assert.strictEqual(Object.keys(usage.current("codex").days).length, 35);
  assert.deepStrictEqual([usage.tokenWords(812), usage.tokenWords(45200), usage.tokenWords(1234567), usage.tokenWords(25e6)], ["812", "45k", "1.2M", "25M"]);
  // Saved with the rest (status bar and panel show the last numbers at startup).
  const saved = JSON.parse(JSON.stringify(usage.snapshot())); usage._reset(); usage.restore(saved);
  assert.strictEqual(usage.tokenTotals("claude", 30, t0).written, 161);
});

console.log(fail ? `usage: ${fail} FAILED` : "usage: ALL PASS");
process.exit(fail ? 1 : 0);
