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

check("Claude's limits in words: 5-hour and weekly, with when they reset", () => {
  usage._reset();
  const r = usage.fromClaude({ rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: (now + 42 * min) / 1000 }, seven_day: { utilization: 0.25, resetsAt: (now + (3 * 1440 + 4 * 60) * min) / 1000 } } } });
  const [five, week] = r.windows;
  assert.strictEqual(usage.inWords(five, now), "5-hour limit 50% used, resets in 42 min");
  assert.strictEqual(usage.inWords(week, now), "Weekly limit 25% used, resets in 3 days 4 h");
  assert.strictEqual(shortName(five), "5h");
  assert.strictEqual(shortName(week), "Weekly");
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
check("other names: Codex's windows, Gemini's weekly limits, Opus's own week", () => {
  assert.strictEqual(usage.limitName({ label: "Week (Opus)" }), "Weekly limit (Opus)");
  assert.strictEqual(usage.limitName({ label: "5-hour" }), "5-hour limit");
  assert.strictEqual(usage.limitName({ label: "Gemini", period: "week" }), "Gemini: weekly limit");
  assert.strictEqual(shortName({ label: "Gemini", period: "week" }), "Gemini weekly");
  assert.strictEqual(usage.inWords({ label: "Week", usedPercent: 12.4, resetsAt: null }, now), "Weekly limit 12% used");
});
check("the AI Usage page: its rules allow no outside scripts or styles", () => {
  const html = _page("abc", "vscode-resource:", "codicons.css");
  assert.ok(/default-src 'none'/.test(html) && /script-src 'nonce-abc'/.test(html) && /font-src vscode-resource:/.test(html));
  assert.ok(!/innerHTML/.test(html));   // (everything is built from text nodes)
});

console.log(fail ? `usage: ${fail} FAILED` : "usage: ALL PASS");
process.exit(fail ? 1 : 0);
