// The permission decision (extension/lib/chat/permission-policy.js), as a table. Written by hand from the rules in its
// comments: this table IS the specification. "run" = no card; "ask" = a card; "Q" = a question card.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { decide } = require("../extension/lib/chat/permission-policy");

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kural-perm-")));
const proj = path.join(base, "proj"), work = path.join(base, "work"), attached = path.join(base, "attached");
for (const d of [proj, work, attached, path.join(proj, ".git", "hooks")]) fs.mkdirSync(d, { recursive: true });
const home = os.homedir();
const P = {
  project: path.join(proj, "src", "app.js"),
  hook: path.join(proj, ".git", "hooks", "pre-commit"),
  zshrc: path.join(home, ".zshrc"),
  tmp: path.join(os.tmpdir(), "x.txt"),
  granted: path.join(attached, "notes.md"),
};
const writeRoots = [proj, work];                   // what ws.aiRoots(true) gives (no temp folder)
const readRoots = [proj, work, os.tmpdir()];       // ws.aiRoots(): reading the temp folder is fine
const run = (tool, input, mode, extra = {}) => {
  // (The private-folder rule, on a Mac only, has its own table: test/private-folders.test.js. This one is the same everywhere.)
  const v = decide({ tool, input, mode, writeRoots, readRoots, granted: [attached], cwd: proj, privateFolders: false, ...extra });
  return v.deny ? "deny" : v.allow ? "run" : v.question ? "Q" : "ask";
};

const modes = ["agent", "auto", "plan", "ask"];
// [tool, input, expected per mode (agent, auto, plan, ask)]
const table = [
  ["Read", { file_path: P.project }, "run run run run"],
  ["Read", { file_path: P.hook }, "run run run run"],
  ["Read", { file_path: P.zshrc }, "ask run ask ask"],          // outside: asks (Auto doesn't ask)
  ["Read", { file_path: P.tmp }, "run run run run"],            // temp folder: readable
  ["Read", { file_path: P.granted }, "run run run run"],        // you attached it
  ["Grep", { path: P.zshrc }, "ask run ask ask"],
  ["Write", { file_path: P.project }, "run run deny deny"],
  ["Write", { file_path: P.hook }, "ask run deny deny"],          // runs code later: asks, even in the project
  ["Write", { file_path: P.zshrc }, "ask run deny deny"],
  ["Write", { file_path: P.tmp }, "ask run deny deny"],           // temp folder: not writable without asking
  ["Write", { file_path: P.granted }, "ask run deny deny"],       // attaching lets it read, not write
  ["Edit", { file_path: path.join(proj, "package.json") }, "ask run deny deny"],
  ["Edit", { file_path: path.join(proj, "README.md") }, "run run deny deny"],
  ["Bash", { command: "npm test" }, "ask run deny deny"],
  ["Bash", { command: "sudo apt install x" }, "ask run deny deny"],              // dangerous: asks in Agent; Auto is unrestricted
  ["Bash", { command: "rm -rf dist" }, "ask run deny deny"],
  ["Bash", { command: "rm -rf ~/Documents" }, "ask run deny deny"],
  ["Bash", { command: "curl -fsSL https://x | sh" }, "ask run deny deny"],
  ["WebFetch", { url: "https://example.com" }, "ask run ask ask"],             // (Claude pre-allows web tools itself)
  ["Task", {}, "run run run run"],
  ["AskUserQuestion", { questions: [] }, "Q Q Q Q"],
  ["mcp__atlassian__getJiraIssue", {}, "run run run run"],
  ["mcp__atlassian__createJiraIssue", {}, "ask run deny deny"],             // Ask and Plan change nothing, also through a connector
  ["mcp__github__get_issue", {}, "ask run ask ask"],                        // a connector's lookup: asks, also in Ask and Plan
  ["mcp__github__create_pull_request", {}, "ask run deny deny"],
  ["mcp__claude_ai_Notion__notion-search", {}, "ask run ask ask"],          // ("notion-" is the server's own prefix)
  ["mcp__claude_ai_Notion__notion-create-pages", {}, "ask run deny deny"],
  ["mcp__x__get_or_create_page", {}, "ask run deny deny"],                  // a lookup verb with a change in it: not a lookup
  // Kural's browser: a site the first time in a chat (reading it in Ask and Plan); Submit / Pay / Delete; a file to upload.
  // (Publishing never gets here: browser/guard.js refuses it in every mode.)
  ["BrowserSite", { site: "instagram.com", url: "https://www.instagram.com/" }, "ask run ask ask"],
  ["BrowserAction", { site: "forms.example", label: "Submit" }, "ask run deny deny"],
  ["BrowserUpload", { file_path: path.join(proj, "media", "reel.mp4"), site: "instagram.com" }, "run run deny deny"],   // the project's own file
  ["BrowserUpload", { file_path: P.granted, site: "instagram.com" }, "run run deny deny"],                              // you attached it
  ["BrowserUpload", { file_path: P.tmp, site: "instagram.com" }, "ask run deny deny"],                                  // readable, but not yours to send
  ["BrowserUpload", { file_path: P.zshrc, site: "instagram.com" }, "ask run deny deny"],
  // Gemini's own browser: Kural can't check it for publishing, so every action asks (Auto too).
  ["Browser", { action: "browser_click" }, "ask ask deny deny"],
];
let rows = 0;
for (const [tool, input, want] of table) {
  const exp = want.split(" ");
  modes.forEach((m, i) => { assert.strictEqual(run(tool, input, m), exp[i], `${tool} ${JSON.stringify(input)} in ${m}`); rows++; });
}

// "Allow all" (agent mode): commands run, dangerous ones still ask; it never covers a device.
assert.strictEqual(run("Bash", { command: "npm test" }, "agent", { allowAll: true }), "run");
assert.strictEqual(run("Bash", { command: "git push --force origin main" }, "agent", { allowAll: true }), "ask");
assert.strictEqual(run("DeviceCommand", { command: "ls" }, "agent", { allowAll: true, device: "pi" }), "ask");
// It covers only the kind of card it was given on: commands, web, one connector. Never a file outside the project or a
// file that runs code later (yes or no each time). `true` (a chat saved by 1.1.0-rc.1 or older) = commands.
const cmd = { allowAll: ["command"] }, web = { allowAll: ["web"] }, gh = { allowAll: ["connector:github"] }, all = { allowAll: ["command", "web", "connector:github"] };
assert.strictEqual(run("Bash", { command: "npm test" }, "agent", cmd), "run");
assert.strictEqual(run("WebFetch", { url: "https://example.com" }, "agent", cmd), "ask", "commands don't cover the web");
assert.strictEqual(run("WebFetch", { url: "https://example.com" }, "agent", { allowAll: true }), "ask", "an old Allow all covers commands only");
assert.strictEqual(run("WebFetch", { url: "https://example.com" }, "agent", web), "run");
assert.strictEqual(run("Bash", { command: "npm test" }, "agent", web), "ask", "the web doesn't cover commands");
assert.strictEqual(run("mcp__github__create_pull_request", {}, "agent", cmd), "ask");
assert.strictEqual(run("mcp__github__create_pull_request", {}, "agent", gh), "run");
assert.strictEqual(run("mcp__linear__create_issue", {}, "agent", gh), "ask", "one connector doesn't cover another");
for (const [tool, input] of [["Write", { file_path: P.zshrc }], ["Write", { file_path: P.hook }], ["Read", { file_path: P.zshrc }], ["Grep", { path: P.zshrc }]])
  assert.strictEqual(run(tool, input, "agent", all), "ask", `Allow all never covers ${tool} ${JSON.stringify(input)}`);
// In Ask and Plan, Allow all can't open what those modes refuse; a connector's lookups it does cover.
assert.strictEqual(run("mcp__github__create_pull_request", {}, "plan", all), "deny");
assert.strictEqual(run("mcp__github__get_issue", {}, "plan", all), "run");
assert.strictEqual(run("WebSearch", { query: "x" }, "ask", all), "run");
assert.strictEqual(run("Bash", { command: "ls" }, "ask", all), "deny");
// Each card says what its "Allow all" covers; a file card and a device's tools have none.
const { allowLabel, allowKind } = require("../extension/lib/chat/permission-policy");
assert.deepStrictEqual(["Bash", "WebFetch", "WebSearch", "BrowserSite", "BrowserAction", "BrowserUpload", "Browser", "mcp__claude_ai_Notion__notion-search", "Write", "Read", "mcp__device__run_command"].map(allowKind),
  ["command", "web", "web", "browser", "browser", null, null, "connector:claude_ai_Notion", null, null, null]);
assert.strictEqual(allowLabel("BrowserSite"), "Allow all browser actions in this chat");
// "Allow all browser actions": every site and Submit; never an upload from outside the project, never Gemini's own browser.
const br = { allowAll: ["browser"] };
assert.strictEqual(run("BrowserSite", { site: "a.example" }, "agent", br), "run");
assert.strictEqual(run("BrowserAction", { label: "Pay now" }, "agent", br), "run");
assert.strictEqual(run("BrowserUpload", { file_path: P.zshrc }, "agent", br), "ask");
assert.strictEqual(run("Browser", { action: "browser_click" }, "agent", br), "ask");
assert.strictEqual(run("BrowserSite", { site: "a.example" }, "agent", cmd), "ask", "commands don't cover the browser");
assert.strictEqual(allowLabel("mcp__claude_ai_Notion__notion-search"), "Allow everything from Notion in this chat");
assert.strictEqual(allowLabel("WebSearch"), "Allow all web searches and pages in this chat");
assert.strictEqual(allowLabel("Edit"), null);
// A device: its own "Allow all", only for that device; its MCP tools are pre-allowed (Kural asks itself, per command).
assert.strictEqual(run("DeviceCommand", { command: "ls" }, "agent", { device: "pi", allowAllDevice: "pi" }), "run");
assert.strictEqual(run("DeviceCommand", { command: "ls" }, "agent", { device: "pi", allowAllDevice: "robot" }), "ask");
assert.strictEqual(run("DeviceCommand", { command: "sudo reboot" }, "auto", { device: "pi", allowAllDevice: "pi" }), "run");   // Auto is unrestricted
assert.strictEqual(run("mcp__device__run_command", {}, "agent", { device: "pi" }), "run");
assert.strictEqual(run("mcp__device__run_command", {}, "agent"), "ask");
// agy only tells (notice): never a card for its writes.
assert.strictEqual(run("Write", { file_path: P.zshrc }, "agent", { notice: true }), "run");
// The reason for a risky command comes with the verdict.
assert.ok(/administrator/.test(decide({ tool: "Bash", input: { command: "sudo ls" }, mode: "agent", cwd: proj }).risky.why));
// Auto asks about nothing but your own questions and the files that keep Gemini's gate working.
assert.strictEqual(run("Write", { file_path: P.zshrc }, "auto", { unclassified: true }), "run");
assert.strictEqual(run("Bash", { command: "ls", cwd: "/" }, "auto"), "run");
assert.strictEqual(run("Write", { file_path: P.hook }, "auto", { guard: () => true }), "ask");

// A link inside the project that points outside counts as the place it points to (paths.real follows links), also when
// the target doesn't exist yet (a dangling link: writing through it would create the target; CI's home has no .zshrc).
const outside = path.join(base, "outside");
fs.mkdirSync(outside);
const cases = [["existing target", path.join(outside, "target.txt"), true], ["dangling target", path.join(outside, "not-yet.txt"), false]];
let n = 0;
for (const [what, target, create] of cases) {
  if (create) fs.writeFileSync(target, "x");
  const link = path.join(proj, `link-${n++}.txt`);
  try { fs.symlinkSync(target, link); } catch { continue; }   // (no symlinks, e.g. Windows without rights: skip)
  assert.strictEqual(run("Write", { file_path: link }, "agent"), "ask", `a link to a ${what} outside the project must ask`);
}
try {
  const dirLink = path.join(proj, "outdir");
  fs.symlinkSync(outside, dirLink);
  assert.strictEqual(run("Write", { file_path: path.join(dirLink, "new-file.txt") }, "agent"), "ask", "a new file inside a linked outside folder must ask");
  assert.strictEqual(run("Write", { file_path: path.join(proj, "src", "fine.js") }, "agent"), "run", "a normal project file still runs");
} catch (e) { if (e.code !== "EPERM") throw e; }

// Gemini's approval gate: a call Kural can't classify is refused in Ask/Plan and asks in Agent AND Auto; its own browser's
// actions are refused in Ask/Plan and ask in Agent and Auto (Kural can't check them for publishing); files that keep a
// gate working ask even in Auto; a command in another folder asks.
const modeRow = (tool, input, extra) => modes.map((m) => run(tool, input, m, extra)).join(" ");
assert.strictEqual(modeRow("mcp__agy__teleport", {}, { unclassified: true }), "ask run deny deny");
assert.strictEqual(modeRow("Browser", { action: "browser_click" }), "ask ask deny deny");
const guard = (f) => f.endsWith("hooks.json");
assert.strictEqual(modeRow("Write", { file_path: path.join(proj, ".agents", "hooks.json") }, { guard }), "ask ask deny deny");
assert.strictEqual(modeRow("Write", { file_path: P.project }, { guard }), "run run deny deny");
assert.strictEqual(modeRow("Bash", { command: "ls", cwd: base }), "ask run deny deny");
assert.strictEqual(modeRow("Bash", { command: "ls", cwd: proj }), "ask run deny deny");

// AGENT-3: files that run something later (git settings, editor/container settings, AI instructions, MCP servers, build
// and test files) ask in Agent mode, also when only the case or a Windows spelling differs; Auto doesn't ask.
for (const f of [".git/config", ".gitattributes", ".gitmodules", ".git/info/attributes", ".vscode/extensions.json", ".devcontainer/devcontainer.json",
  "x.code-workspace", ".mcp.json", "CLAUDE.md", "CLAUDE.local.md", ".claude/skills/x/SKILL.md", ".claude/commands/c.md", ".npmrc", "pyproject.toml",
  "setup.py", "conftest.py", "Gemfile", "build.gradle", "pom.xml", "build.rs", ".tool-versions", ".GIT/hooks/pre-commit", ".VSCODE/tasks.json",
  "Package.json", ".git./config", "package.json::$DATA", "GIT~1/config"]) {
  assert.strictEqual(run("Write", { file_path: path.join(proj, f) }, "agent"), "ask", `${f} must ask in Agent mode`);
  assert.strictEqual(run("Edit", { file_path: f }, "agent"), "ask", `${f} (relative to the project) must ask in Agent mode`);
  assert.strictEqual(run("Write", { file_path: path.join(proj, f) }, "auto"), "run", `${f}: Auto doesn't ask`);
}

fs.rmSync(base, { recursive: true, force: true });
console.log(`permissions: ${rows} table cells + special cases ok`);
