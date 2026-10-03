// Live check (needs `claude` logged in): does Tab get more relevant when it knows what you've been doing?
// Same request with and without the activity note, real Haiku, Kural's real prompt code.
//   node test/personal.live.js
const Module = require("module");
const load = Module._load;
Module._load = function (req, ...a) { return req === "vscode" ? {} : load.call(this, req, ...a); };
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const { TERMINAL_SYSTEM_PROMPT, tidy, _test: { gitContext, claudePrompt } } = require("../extension/lib/tab/terminal");
const { COMPLETION_SYSTEM_PROMPT, completionPrompt, extractInsert } = require("../extension/lib/tab/completion");
const { Activity } = require("../extension/lib/tab/activity");

const ask = (system, prompt) => {
  const r = spawnSync("claude", ["-p", "--model", "haiku", "--system-prompt", system, "--tools", ""], { input: prompt, encoding: "utf8", timeout: 90000 });
  return r.stdout || "";
};

(async () => {
  // A small project with a history of commit messages in one style.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kural-personal-"));
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  const file = path.join(dir, "weld_params.py");
  fs.writeFileSync(file, "def travel_time(length_mm: float, speed_mm_s: float) -> float:\n    return length_mm / speed_mm_s\n");
  git("add", "."); git("commit", "-qm", "params: add travel_time");
  fs.appendFileSync(file, "\n\ndef heat_input(volts: float, amps: float, speed_mm_s: float) -> float:\n    return volts * amps / speed_mm_s\n");
  git("commit", "-qam", "params: add heat_input (kJ/mm)");
  // What the chat changed for you (the diff alone doesn't say why).
  fs.writeFileSync(file, fs.readFileSync(file, "utf8")
    .replace("    return length_mm / speed_mm_s", "    if speed_mm_s <= 0:\n        raise ValueError(\"speed must be > 0\")\n    return length_mm / speed_mm_s")
    .replace("    return volts * amps / speed_mm_s", "    if speed_mm_s <= 0:\n        raise ValueError(\"speed must be > 0\")\n    return volts * amps / speed_mm_s"));
  git("add", ".");

  let now = Date.now();
  const act = new Activity(null, () => true, () => now);
  act.addWork("chat", "The robot controller crashed when an operator typed 0 for the weld speed on the HMI. Make the params code reject zero and negative speeds.", ["weld_params.py"]);

  const typed = 'git commit -m "';
  const g = await gitContext(dir, true);
  const base = { shell: "bash", cwd: dir, history: "$ git add .", git: g.text, typed };
  const note = act.terminalNote(typed, { since: g.since, files: g.files });
  console.log("== Commit message (diff only, the old way):");
  console.log("  ", tidy(ask(TERMINAL_SYSTEM_PROMPT, claudePrompt({ ...base, git: g.text.split("\n\nTheir recent commit messages")[0] })), typed));
  console.log("== Commit message (+ your commit style + what you asked the chat):");
  console.log("  ", tidy(ask(TERMINAL_SYSTEM_PROMPT, claudePrompt({ ...base, note })), typed));

  // Editor Tab: you just added validation in one file; now you start the same kind of function in another.
  act.edited("weld_params.py", "python", 6, "def heat_input(volts: float, amps: float, speed_mm_s: float) -> float:\n    if speed_mm_s <= 0:\n        raise ValueError(\"speed must be > 0\")\n    return volts * amps / speed_mm_s");
  act.tabAccepted("units.py", "python", "def mm_s_to_m_min(", "speed_mm_s: float) -> float:");
  const text = "def wire_feed_m_min(wire_mm_s: float) -> float:\n    \n";
  const offset = text.indexOf("    \n") + 4;
  const p = (n) => completionPrompt(text, offset, "python", "wire.py", n);
  console.log("== Tab in wire.py, empty function body (old way):");
  console.log(extractInsert(ask(COMPLETION_SYSTEM_PROMPT, p(""))).replace(/^/gm, "   "));
  console.log("== Tab in wire.py (+ your recent work):");
  console.log(extractInsert(ask(COMPLETION_SYSTEM_PROMPT, p(act.tabNote("wire.py", "python")))).replace(/^/gm, "   "));
  fs.rmSync(dir, { recursive: true, force: true });
})();
