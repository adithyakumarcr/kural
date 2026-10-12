// Settings a project folder must not control (APP-8): automatic update checks and Tab's learning are app-wide
// (scope "application": a workspace's .vscode/settings.json can't set them), and chat mode Auto for new chats only
// counts from your own user settings.
const assert = require("assert");
const Module = require("module");
const load = Module._load;
const pkg = require("../extension/package.json");
let mode = { value: undefined, globalValue: undefined };
const vscode = { workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], onDidChangeConfiguration: () => ({ dispose() {} }),
  getConfiguration: () => ({ get: (k, d) => k === "chat.mode" ? mode.value : d, inspect: (k) => k === "chat.mode" ? { globalValue: mode.globalValue } : undefined }) },
  window: {}, env: { appRoot: "/unused" }, commands: { executeCommand: () => {} }, Uri: { file: (f) => ({ scheme: "file", fsPath: f }), joinPath: () => ({}) },
  ConfigurationTarget: { Global: 1 }, EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const { _test: { settingMode } } = require("../extension/lib/chat");

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
check("updates.autoCheck and learnFromActivity are application-scoped", () => {
  const p = pkg.contributes.configuration.properties;
  assert.strictEqual(p["kural.updates.autoCheck"].scope, "application");
  assert.strictEqual(p["kural.tabCompletion.learnFromActivity"].scope, "application");
});
check("chat mode Auto from a project's settings → Agent; from yours → Auto", () => {
  mode = { value: "auto", globalValue: undefined }; assert.strictEqual(settingMode(), "agent");
  mode = { value: "auto", globalValue: "auto" }; assert.strictEqual(settingMode(), "auto");
  mode = { value: "plan", globalValue: "auto" }; assert.strictEqual(settingMode(), "plan");
  mode = { value: "nonsense", globalValue: undefined }; assert.strictEqual(settingMode(), "agent");
});
console.log(failed ? `app-settings-scope: ${failed} FAILED` : "app-settings-scope: ALL PASS");
process.exit(failed ? 1 : 0);
