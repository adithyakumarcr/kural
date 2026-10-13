// New profile with a too-old Claude Code (lib/profiles/index.js offerClaudeUpdate): one click updates it and making the
// profile goes on; a failed update offers the terminal. vscode is a stand-in that records the messages and clicks.
const assert = require("assert");
const Module = require("module");

const shown = [];
let answers = [];   // the buttons "clicked", in order (undefined = closed)
const vscode = {
  window: {
    createStatusBarItem: () => ({ show() {}, dispose() {} }),
    showWarningMessage: async (msg, o, ...b) => { shown.push({ kind: "warning", msg, detail: o && o.detail, buttons: b }); return answers.shift(); },
    showErrorMessage: async (msg, o, ...b) => { shown.push({ kind: "error", msg, detail: o && o.detail, buttons: b }); return answers.shift(); },
    showQuickPick: async () => { shown.push({ kind: "pick" }); return undefined; },
    withProgress: async (_o, fn) => fn(),
    setStatusBarMessage: () => {},
  },
  workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_, d) => d }) },
  env: { appRoot: "/unused" },
  StatusBarAlignment: { Right: 2 }, ProgressLocation: { Notification: 15 }, QuickPickItemKind: { Separator: -1 },
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => {} },
};
const load = Module._load;
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const { Profiles } = require("../extension/lib/profiles/index.js");

let fail = 0;
const check = async (name, fn) => { try { shown.length = 0; await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const store = { active: () => ({ id: "default", name: "Personal", kind: "personal" }), data: () => ({ active: "default", list: [] }), checkName: () => null };
const make = (hooks) => new Profiles({ subscriptions: [], globalState: { get() {}, update: async () => {} } }, store, hooks);

(async () => {
  await check("Update Claude Code: updated, then the profile questions start", async () => {
    let version = "2.1.289", updates = 0, terminal = 0;
    const p = make({ claudeVersion: async () => version, updateClaude: async () => { updates++; version = "2.1.300"; return { ok: true, output: "Successfully updated" }; },
      updateClaudeInTerminal: () => terminal++ });
    answers = ["Update Claude Code"];
    await p.create();
    assert.strictEqual(updates, 1);
    assert.strictEqual(terminal, 0);
    assert.deepStrictEqual(shown[0].buttons, ["Update Claude Code"]);
    assert.match(shown[0].detail, /2\.1\.289/);
    assert.strictEqual(shown[1].kind, "pick", "the first New profile question comes next");
  });
  await check("closing the offer: nothing updated, no profile", async () => {
    let updates = 0;
    const p = make({ claudeVersion: async () => "2.1.289", updateClaude: async () => { updates++; return { ok: true }; } });
    answers = [undefined];
    await p.create();
    assert.strictEqual(updates, 0);
    assert.strictEqual(shown.length, 1);
  });
  await check("still old after the update (Homebrew, npm…): says why, offers the terminal", async () => {
    let terminal = 0;
    const p = make({ claudeVersion: async () => "2.1.289", updateClaude: async () => ({ error: "Claude is managed by Homebrew" }), updateClaudeInTerminal: () => terminal++ });
    answers = ["Update Claude Code", "Update in a Terminal"];
    await p.create();
    assert.strictEqual(shown[1].kind, "error");
    assert.match(shown[1].detail, /managed by Homebrew/);
    assert.strictEqual(terminal, 1);
    assert.ok(!shown.some((s) => s.kind === "pick"), "no profile questions");
  });
  await check("new enough already: no offer", async () => {
    const p = make({ claudeVersion: async () => "2.1.300" });
    await p.create();
    assert.strictEqual(shown[0].kind, "pick");
  });
  if (fail) { console.log(`${fail} failed`); process.exit(1); }
})();
