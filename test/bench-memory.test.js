// scripts/bench-memory.js: which group each process of a running Kural belongs to (command lines as `ps` shows them
// on a Mac), the Claude Code processes named by the system prompt they were started with, and a real run (read-only:
// it only looks at the processes) that finishes and gives JSON.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const { groupOf, claudeRole, isMain } = require("../scripts/bench-memory");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const APP = "/Applications/Kural.app/Contents";
const H = (kind) => `${APP}/Frameworks/Kural Helper${kind}.app/Contents/MacOS/Kural Helper${kind}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-bench-"));
const prompt = (name, text) => { const f = path.join(tmp, name); fs.writeFileSync(f, text); return f; };
const claude = (rest) => `/Users/me/.local/bin/claude -p --input-format stream-json --output-format stream-json --verbose ${rest}`;
const procs = [
  { pid: 1, ppid: 0, cmd: `${APP}/MacOS/Kural` },
  { pid: 2, ppid: 1, cmd: `${H(" (Renderer)")} --type=renderer --user-data-dir=/x` },
  { pid: 3, ppid: 1, cmd: `${H("")} --type=gpu-process --user-data-dir=/x` },
  { pid: 4, ppid: 1, cmd: `${H("")} --type=utility --utility-sub-type=network.mojom.NetworkService --lang=en` },
  { pid: 5, ppid: 1, cmd: `${H(" (Plugin)")} --type=utility --utility-sub-type=node.mojom.NodeService --lang=en` },
  { pid: 6, ppid: 1, cmd: `${H("")} --type=utility --utility-sub-type=node.mojom.NodeService --lang=en` },
  { pid: 7, ppid: 6, cmd: "/bin/zsh -il" },
  { pid: 8, ppid: 7, cmd: "npm run dev" },
  { pid: 9, ppid: 5, cmd: `${H(" (Plugin)")} --max-old-space-size=3072 ${APP}/Resources/app/extensions/node_modules/typescript/lib/tsserver.js --serverMode partialSemantic` },
  { pid: 10, ppid: 5, cmd: claude(`--model haiku --effort low --safe-mode --system-prompt-file ${prompt("p1.md", "You are the autocomplete engine of a code editor.\nYou get a file")}`) },
  { pid: 11, ppid: 5, cmd: claude(`--model haiku --safe-mode --permission-prompt-tool stdio --append-system-prompt-file ${prompt("p2.md", "You locate code for the user inside the Kural editor.")}`) },
  { pid: 12, ppid: 5, cmd: claude(`--model sonnet --include-partial-messages --thinking-display summarized --replay-user-messages --append-system-prompt-file ${prompt("p3.md", "You are working in the Kural editor...")}`) },
  { pid: 13, ppid: 12, cmd: `${H(" (Plugin)")} ${APP}/Resources/app/extensions/kural/lib/chat/team-mcp.js` },
  { pid: 14, ppid: 5, cmd: claude(`--model haiku --system-prompt-file ${prompt("p4.md", "You are the autocomplete of a terminal. You get")}`) },
  { pid: 15, ppid: 5, cmd: "/opt/homebrew/bin/codex app-server" },
  { pid: 16, ppid: 5, cmd: "/usr/bin/git status --porcelain" },
];
const byPid = new Map(procs.map((p) => [p.pid, p]));
const g = (pid) => groupOf(byPid.get(pid), byPid);

check("Kural's own parts: main, renderers, GPU, network, extension host, shared process", () => {
  assert.ok(isMain(byPid.get(1)) && !isMain(byPid.get(2)));
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6].map(g), ["Electron main", "renderers (window, webviews)", "GPU", "network service",
    "extension host", "shared process, terminal host, file watcher"]);
});
check("terminals (the shell and what runs in it), language servers, git started by an extension", () => {
  assert.deepStrictEqual([7, 8, 9, 16].map(g), ["terminals (shells, what runs in them)", "terminals (shells, what runs in them)",
    "language servers", "extension host's other children (git, ripgrep...)"]);
});
check("each Claude Code process by what it's for (its system prompt), and what Claude Code started", () => {
  assert.deepStrictEqual([10, 11, 12, 13, 14].map(g), ["Claude: Tab Completion (editor)", "Claude: Search & Ask", "Claude: chats",
    "started by Claude Code (MCP servers, commands)", "Claude: terminal Tab, commit lines"]);
  assert.strictEqual(claudeRole(claude("--model haiku --system-prompt-file /gone/p9.md")), "Claude: other helpers");
});
check("Codex", () => assert.strictEqual(g(15), "Codex (ChatGPT)"));
check("a real run finishes and gives JSON (it only looks at the processes)", () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "scripts", "bench-memory.js"), "--json", "--interval", "1", "--no-ollama", "--app", "no-such-kural-here"], { encoding: "utf8", timeout: 60000 });
  assert.strictEqual(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepStrictEqual(j.kurals, []); assert.ok(j.totalMemory > 0 && j.interval === 1);
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `bench-memory: ${fail} FAILED` : "bench-memory: ALL PASS");
process.exit(fail ? 1 : 0);
