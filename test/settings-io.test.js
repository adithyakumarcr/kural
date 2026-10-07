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
