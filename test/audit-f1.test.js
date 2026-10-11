// Agent-permission regressions from the F1 audit group (AGENT-1 … AGENT-12). No vscode, no providers, no network:
// every file is a disposable fixture in the temp folder.
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync, execFileSync } = require("child_process");
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kural-audit-f1-")));
let failed = 0;
function check(name, fn) { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } }

check("AGENT-1: a pipe named CLAUDE.md doesn't block, and only plain files are read", () => {
  const project = path.join(tmp, "fifo-project");
  fs.mkdirSync(path.join(project, ".claude", "rules"), { recursive: true });
  try { execFileSync("mkfifo", [path.join(project, "CLAUDE.md")]); } catch { console.log("     (no mkfifo here: pipe case skipped)"); }
  fs.writeFileSync(path.join(project, ".claude", "rules", "style.md"), "use tabs");
  const lib = path.join(__dirname, "..", "extension", "lib", "chat", "project");
  const r = spawnSync(process.execPath, ["-e", `process.stdout.write(require(${JSON.stringify(lib)}).projectInstructions(${JSON.stringify(project)}, true).text)`],
    { timeout: 10000, encoding: "utf8" });
  assert.ok(!r.error, "projectInstructions must return (it blocked on the pipe)");
  assert.match(r.stdout, /use tabs/);
});

if (failed) { console.error(`audit-f1: ${failed} FAILED`); process.exitCode = 1; }
else console.log("audit-f1: ALL PASS");
fs.rmSync(tmp, { recursive: true, force: true });
