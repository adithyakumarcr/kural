// Live check of parallel agents (needs `claude` installed and logged in): a real request split by a real lead, built by
// two real agents at once in git worktrees, merged into a throwaway repository and checked. Haiku leads and builds (cheap).
// Run: node test/split.live.js   (KURAL_LIVE_LEAD=sonnet to lead with another model)
const Module = require("module");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const orig = Module._load;
const vscode = { window: { createOutputChannel: () => ({ appendLine() {} }) }, workspace: { workspaceFolders: [], isTrusted: true, getConfiguration: () => ({ get: (k, d) => d, inspect: () => undefined }), onDidChangeConfiguration: () => ({ dispose() {} }) },
  env: {}, commands: { executeCommand: async () => {} }, Uri: { file: (f) => ({ scheme: "file", fsPath: f }) }, EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
Module._load = function (req, ...a) { return req === "vscode" ? vscode : orig.call(this, req, ...a); };
const ext = path.resolve(__dirname, "../extension");
require(ext + "/lib/ai/claude.js").setSetupGate(() => true);
const brain = require(ext + "/lib/ai");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kural-split-live-"));
const git = (...a) => spawnSync("git", a, { cwd: dir, encoding: "utf8" }).stdout.trim();
git("init", "-q");
fs.writeFileSync(path.join(dir, "math.js"), "function add(a, b) { return a + b; }\nmodule.exports = { add };\n");
fs.writeFileSync(path.join(dir, "text.js"), "function trim(s) { return s.trim(); }\nmodule.exports = { trim };\n");
fs.writeFileSync(path.join(dir, "check.js"), "const m = require('./math'), t = require('./text');\nconsole.log(m.double(21), t.shout('hi'));\n");
git("add", "-A"); spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "start"], { cwd: dir });

const lead = process.env.KURAL_LIVE_LEAD || "haiku", t0 = Date.now();
const log = (s) => console.log(`${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(6)} s  ${s}`);
const cards = new Map();
const agent = brain.makeAgent(lead, {
  name: "live", effort: "low", partial: true, mode: "auto", cwd: dir, persist: false, hostPermissions: true, safeMode: true,
  tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "AskUserQuestion"], allowedTools: [], appendSystemPrompt: "",
  split: { workers: "haiku", models: [{ id: "opus", label: "Opus" }, { id: "sonnet", label: "Sonnet" }, { id: "haiku", label: "Haiku" }],
    history: () => "", dir: path.join(dir, "..", path.basename(dir) + "-work") },
}, null, {
  onMessage: (m) => {
    if (m.type === "assistant") for (const b of m.message.content || []) {
      if (b.type === "tool_use" && b.name === "Task") { cards.set(b.id, b.input.description); log(`agent started: ${b.input.kural_agent.label} · ${b.input.description}`); }
      else if (b.type === "tool_use" && !m.parent_tool_use_id) log(`${b.name} ${b.input.file_path || b.input.command || b.input.detail || ""}`);
    }
    if (m.type === "system" && m.subtype === "task_notification") log(`agent ${m.status}: ${cards.get(m.tool_use_id)}`);
    if (m.type === "result") {
      log(`done (${m.subtype})\n\n${m.result}\n`);
      const out = spawnSync(process.execPath, ["check.js"], { cwd: dir, encoding: "utf8" });
      console.log(`node check.js → ${(out.stdout || out.stderr).trim()}`);
      console.log(`worktrees left: ${git("worktree", "list").split("\n").length - 1}, HEAD commits: ${git("rev-list", "--count", "HEAD")}`);
      console.log(`files: ${git("status", "--porcelain").replace(/\n/g, " ")}`);
      const ok = !m.is_error && /42 HI!/.test(out.stdout || "") && cards.size >= 2;
      console.log(ok ? "LIVE OK" : "LIVE FAILED");
      agent.kill(); process.exit(ok ? 0 : 1);
    }
  },
  onPermission: async (req) => ({ allow: true }),
  onPlan: async () => ({ go: true }),
  onExit: (info) => log(`exit ${info && info.stderr}`),
});
agent.start();
agent.send("Two independent changes, one per file: in math.js add and export double(n) that returns n * 2; in text.js add and export " +
  "shout(s) that returns s.toUpperCase() + '!'. Then `node check.js` must print `42 HI!`.");
