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

check("AGENT-12: only Atlassian's own servers and read tools run without asking", () => {
  const { isAtlassianRead } = require("../extension/lib/chat/atlassian");
  const { decide } = require("../extension/lib/chat/permission-policy");
  for (const t of ["mcp__claude_ai_Atlassian__getJiraIssue", "mcp__claude_ai_Atlassian_Rovo__searchJiraIssuesUsingJql", "mcp__atlassian__getConfluencePage",
    "mcp__jira__lookupJiraAccountId", "mcp__claude_ai_Atlassian__atlassianUserInfo"]) {
    assert.ok(isAtlassianRead(t), t);
    assert.ok(decide({ tool: t, input: {}, mode: "agent" }).allow, t);
  }
  for (const t of ["mcp__evil-jira__fetchAndRun", "mcp__my_jira_proxy__getSecrets", "mcp__notjira__listAll", "mcp__claude_ai_Atlassian__readAnything",
    "mcp__claude_ai_Atlassian__getEverythingAndRun", "mcp__atlassian__createJiraIssue", "mcp__atlassian__editJiraIssue", "mcp__atlassian__transitionJiraIssue",
    "mcp__atlassian__addCommentToJiraIssue", "mcp__atlassian__createConfluencePage", "mcp__atlassian__updateConfluencePage"]) {
    assert.ok(!isAtlassianRead(t), t);
    assert.ok(decide({ tool: t, input: {}, mode: "agent" }).ask, t);
  }
});

if (failed) { console.error(`audit-f1: ${failed} FAILED`); process.exitCode = 1; }
else console.log("audit-f1: ALL PASS");
fs.rmSync(tmp, { recursive: true, force: true });
