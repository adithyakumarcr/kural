// Live test of tab completion quality and speed (needs `claude` installed and logged in).
// Run: node test/completion.live.js
const Module = require("module");
const path = require("path");
const orig = Module._load;
Module._load = function (req, ...a) {
  if (req === "vscode") return { window: { createOutputChannel: () => ({ appendLine() {} }) } };
  return orig.call(this, req, ...a);
};
const ext = path.resolve(__dirname, "../extension");
const { initLog, ClaudeSession } = require(ext + "/lib/claude.js");
const { COMPLETION_SYSTEM_PROMPT, completionPrompt, extractInsert, trimOverlap } = require(ext + "/lib/completion.js");
initLog();

const FILE = `"""Simple helpers for welding parameters."""


def wire_feed_to_current(wire_feed_m_min: float) -> float:
    """Rough current (A) for a given wire feed speed (m/min)."""
    return 30.0 + 25.0 * wire_feed_m_min


def heat_input(voltage: float, current: float, travel_speed_mm_s: float) -> float:
    """Heat input in kJ/mm."""
    return `;
const FILE2 = `def travel_speed_for_heat_input(voltage: float, current: float, heat_kj_mm: float) -> float:
    """Travel speed (mm/s) that gives the wanted heat input (kJ/mm)."""
    <C>
`;
const FILE3 = `def total_weld_time(seams):
    total = 0.0
    for seam in seams:
        <C>
    return total
`;
const FILE4 = `def report(current: float) -> None:
    print(<C>)
`;
const FILE5 = `from weld_params import heat_input

voltage = 24.0
current = 180.0
travel_speed_mm_s = 6.0
q = heat_input(<C>)
`;
const FILE6 = `def arc_power(voltage: float, <C>)
    """Arc power in W."""
    return voltage * current
`;
const FILE7 = `def total_length_mm(seams: list[dict]) -> float:
    # add up seam["length_mm"] for every seam and return the total
<C>
`;
const FILE8 = `import json


def load_job(path: str) -> dict:
    with open(path) as f:
<C>
`;
const at = (needle, extra = 0) => FILE.indexOf(needle) + needle.length + extra;
const cases = [
  { name: "finish 'return ' in heat_input", offset: FILE.length, ok: (s) => /voltage/.test(s) && /current/.test(s) },
  { name: "end of finished line 6 (no gluing)", offset: at("25.0 * wire_feed_m_min"), ok: (s) => !s.trim() || /^\r?\n/.test(s) },
  { name: "empty line between functions", offset: at("wire_feed_m_min\n"), ok: (s) => !/voltage \* current/.test(s) },
  { name: "middle of a signature (rest already there)", offset: at("def heat_input(voltage: float, "), ok: (s) => !s.trim() },
  { name: "cursor in an empty function body", file: FILE2, offset: FILE2.indexOf("<C>"), ok: (s) => /return/.test(s) && /heat_kj_mm/.test(s) },
  { name: "cursor on empty line inside a loop", file: FILE3, offset: FILE3.indexOf("<C>"), ok: (s) => s.trim().length > 0 && !/```/.test(s) },
  // Same line, before a ")" the editor added automatically:
  { name: "mid-line: inside print()", file: FILE4, offset: FILE4.indexOf("<C>"), ok: (s) => s.trim().length > 0 && !s.includes("\n") && !/\)\s*$/.test(s.replace(/\([^()]*\)/g, "")) },
  { name: "mid-line: call arguments", file: FILE5, offset: FILE5.indexOf("<C>"), ok: (s) => /voltage|current|\d/.test(s) && !s.includes("\n") },
  { name: "mid-line: rest of a signature", file: FILE6, offset: FILE6.indexOf("<C>"), ok: (s) => /:\s*float/.test(s) && !s.includes("\n") },
  // Write the code a comment describes:
  { name: "comment → implementation", file: FILE7, offset: FILE7.indexOf("<C>"), ok: (s) => /\bfor\b|\bsum\(|\+=/.test(s) && /return|total/.test(s) },
  // Empty line where the next step is obvious:
  { name: "empty line: obvious next step", file: FILE8, offset: FILE8.indexOf("<C>"), ok: (s) => s.trim().length > 0 },
];

const session = new ClaudeSession({ name: "tab", model: () => "haiku", effort: "low", noThinking: true,
  systemPrompt: COMPLETION_SYSTEM_PROMPT, restartAfter: 40, timeoutMs: 15000, clearEach: true,
  pool: 2, earlyStop: "</insert>" });   // same as the editor
const tok = { isCancellationRequested: false, onCancellationRequested() {} };
(async () => {
  session.start();
  await new Promise((r) => setTimeout(r, 2500)); // like the editor: already warm when you type
  let pass = 0; const times = [];
  for (const c of cases) {
    const t = Date.now();
    const f = (c.file || FILE).replace("<C>", "");
    const raw = (await session.ask(completionPrompt(f, c.offset, "python", "weld_params.py"), tok)) || "";
    const s = trimOverlap(extractInsert(raw), f.slice(c.offset, c.offset + 200));
    times.push(Date.now() - t);
    const good = c.ok(s);
    pass += good;
    console.log(`${good ? "PASS" : "FAIL"} ${c.name}  (${Date.now() - t} ms)  → ${JSON.stringify(s)}`);
  }
  console.log(`${pass}/${cases.length} passed; median ${times.sort((a, b) => a - b)[Math.floor(times.length / 2)]} ms`);

  // Typing fast: each key cancels the previous question. The last one should still come quickly.
  const burst = [];
  for (let k = 0; k < 3; k++) {
    let cancelLast = null;
    const t = Date.now();
    let last;
    for (let i = 0; i < 4; i++) {
      if (cancelLast) cancelLast();
      const listeners = [];
      const tk = { isCancellationRequested: false, onCancellationRequested(f) { listeners.push(f); } };
      cancelLast = () => { tk.isCancellationRequested = true; listeners.forEach((f) => f()); };
      const c = cases[(i + k) % cases.length], f = (c.file || FILE).replace("<C>", "");
      last = session.ask(completionPrompt(f, c.offset, "python", "weld_params.py"), tk);
      await new Promise((r) => setTimeout(r, 120));   // next key
    }
    await last;
    burst.push(Date.now() - t - 3 * 120);
    await new Promise((r) => setTimeout(r, 800));
  }
  console.log(`typing burst: last suggestion ${burst.join(" / ")} ms after the last key`);
  session.stop();
  process.exit(pass === cases.length ? 0 : 1);
})();
