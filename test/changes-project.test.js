// "Files changed" lists only the project's files (Adithya: a note Claude wrote in /tmp showed next to the repo's files).
// lib/chat/changes.js inProject, and the chat: no checkpoint for a file outside the project, and older chats' entries
// for such files are left out when they're opened again.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-changes-test-"));
const proj = path.join(tmp, "proj"), other = path.join(tmp, "elsewhere");
fs.mkdirSync(path.join(proj, "src"), { recursive: true }); fs.mkdirSync(other);
fs.writeFileSync(path.join(proj, "src", "app.js"), "one\n");
const originalLoad = Module._load;
const vscode = { workspace: { isTrusted: true, workspaceFolders: [{ name: "proj", uri: { scheme: "file", fsPath: proj } }], textDocuments: [],
  getConfiguration: () => ({ get: (_, d) => d }) },
  env: { appRoot: "/unused" }, commands: { executeCommand: () => {} }, Uri: { file: (f) => ({ scheme: "file", fsPath: f }) },
  EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
Module._load = function (name, ...args) { return name === "vscode" ? vscode : originalLoad.call(this, name, ...args); };
const { inProject, ChangeTracker } = require("../extension/lib/chat/changes");
const { ChatView } = require("../extension/lib/chat");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const home = os.homedir();

(async () => {
  await check("inProject: the project's files count; temp files, Claude Code's own files and other folders don't", () => {
    assert.ok(inProject(path.join(proj, "src", "app.js"), [proj]));
    assert.ok(inProject(path.join(proj, "new-file.md"), [proj]));                          // (a new file too)
    assert.ok(!inProject(path.join(other, "x.js"), [proj]));
    assert.ok(!inProject(path.join(os.tmpdir(), "kural-pr-fix-welcome.md"), [proj]));
    if (process.platform !== "win32") assert.ok(!inProject("/tmp/kural-pr-fix-welcome-vscodium-leftovers.md", [proj]));
    assert.ok(!inProject(path.join(home, ".claude", "plans", "plan.md"), [proj]));
    assert.ok(!inProject("src/app.js", [proj]));                                            // (only absolute paths)
    assert.ok(!inProject(null, [proj]) && !inProject(path.join(proj, "a"), []));
  });
  await check("a project in the temp folder still counts; your home folder as the project doesn't take in ~/.claude", () => {
    // (proj itself is inside the temp folder here.)
    assert.ok(inProject(path.join(proj, "src", "app.js"), [proj]));
    assert.ok(!inProject(path.join(tmp, "next-to-the-project.md"), [proj]));
    assert.ok(inProject(path.join(home, "work", "app.py"), [home]));
    assert.ok(!inProject(path.join(home, ".claude", "projects", "x", "memory", "notes.md"), [home]));
  });

  // The chat itself: a stand-in ChatView (no panel, no programs).
  const chat = Object.create(ChatView.prototype);
  Object.assign(chat, { changes: new ChangeTracker(null), here: { key: proj, name: "proj", open: proj }, post: () => {}, postTabs: () => {}, save: () => {},
    shown: () => true, devices: null, context: { globalState: { get: () => ({}) } } });
  const tab = { id: "t", title: "Work", model: "sonnet", mode: "agent", messages: [], status: "running", workspace: { key: proj, name: "proj", open: proj } };
  await check("an edit in the project gets a checkpoint; one in /tmp or ~/.claude doesn't (and isn't listed)", async () => {
    const turn = { snaps: {}, reply: { blocks: [], running: true, mode: "agent" } }, r = { turn, perms: new Map(), agents: new Map(), tasks: new Map() };
    const note = path.join(os.tmpdir(), `kural-note-${process.pid}.md`), plan = path.join(home, ".claude", "plans", "kural-test-plan.md");
    for (const file of [path.join(proj, "src", "app.js"), note, plan]) {
      const res = await chat.onPermission(tab, r, { tool_name: "Write", input: { file_path: file, content: "x" }, notice: true });
      assert.deepStrictEqual(res, { allow: true });
    }
    assert.deepStrictEqual(Object.keys(turn.snaps), [path.join(proj, "src", "app.js")]);
    fs.writeFileSync(path.join(proj, "src", "app.js"), "one\ntwo\n");
    chat.finishTurn(tab, r);
    assert.deepStrictEqual(turn.reply.changes.map((c) => c.rel), [path.join(proj, "src", "app.js")].map((f) => require("../extension/lib/workspace").label(f)));
  });
  await check("a relative path from the AI is the project's file", async () => {
    const turn = { snaps: {}, reply: { blocks: [], running: true } }, r = { turn, perms: new Map(), agents: new Map(), tasks: new Map() };
    await chat.onPermission(tab, r, { tool_name: "Edit", input: { file_path: "src/app.js" }, notice: true });
    assert.deepStrictEqual(Object.keys(turn.snaps), [path.join(proj, "src", "app.js")]);
  });
  await check("an older chat's entries for files outside the project are left out when it's opened", () => {
    const old = { id: "old", title: "Old", model: "sonnet", mode: "agent", status: "idle", workspace: { key: proj, name: "proj", open: proj }, messages: [
      { role: "user", segments: [{ t: "text", v: "fix it" }] },
      { role: "assistant", blocks: [], changes: [
        { id: "a", file: path.join(proj, "src", "app.js"), rel: "src/app.js", state: "pending" },
        { id: "b", file: "/tmp/kural-pr-notes.md", rel: "/tmp/kural-pr-notes.md", state: "pending" },
        { id: "c", file: path.join(home, ".claude", "plans", "p.md"), rel: "p.md", state: "kept" }] },
      { role: "user", segments: [{ t: "text", v: "and a note" }] },
      { role: "assistant", blocks: [], changes: [{ id: "d", file: path.join(os.tmpdir(), "only-temp.md"), rel: "only-temp.md", state: "pending" }] }] };
    chat.clean(old);
    assert.deepStrictEqual(old.messages[1].changes.map((c) => c.id), ["a"]);
    assert.strictEqual(old.messages[3].changes, undefined);
    assert.deepStrictEqual(chat.laterChanges(old, 0).map((f) => f.rel), ["src/app.js"]);
  });
  await check("a chat from another workspace keeps its own project's files", () => {
    const away = path.join(tmp, "away-project");
    const old = { id: "away", title: "Away", model: "sonnet", mode: "agent", status: "idle", workspace: { key: away, name: "away", open: away }, messages: [
      { role: "user", segments: [{ t: "text", v: "x" }] },
      { role: "assistant", blocks: [], changes: [{ id: "e", file: path.join(away, "main.py"), rel: "main.py", state: "pending" }] }] };
    chat.clean(old);
    assert.deepStrictEqual(old.messages[1].changes.map((c) => c.id), ["e"]);
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `changes-project: ${failed} FAILED` : "changes-project: ALL PASS");
  process.exitCode = failed ? 1 : 0;
})();
