// Recovering omitted constraints is part of a handoff, including with a model too small for the original transcript.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-handoff-store-"));
const load = Module._load;
Module._load = function (r, ...args) {
  return r === "vscode" ? { workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_, d) => d }) }, env: { appRoot: "/unused" } } : load.call(this, r, ...args);
};
const journal = require("../extension/lib/router/journal");
const store = require("../extension/lib/chat/handoff-store");
const { ChatView } = require("../extension/lib/chat");
const { Tools } = require("../extension/lib/ai/tools");
let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const messages = [
  { role: "user", segments: [{ t: "text", v: "x".repeat(9000) + "MIDDLE-CONSTRAINT keep the legacy API" + "x".repeat(9000) }],
    sentText: "original context\n" + "source\n".repeat(8000) },
  { role: "assistant", mode: "plan", model: "sonnet", blocks: [
    { k: "text", text: "first\n".repeat(5000) + "MIDDLE-DECISION use the shared cache" + "last\n".repeat(5000) },
    { k: "steer", segments: [{ t: "text", v: "also use this image" }], attachments: [{ name: "screen.png", kind: "image", path: path.join(tmp, "screen.png") }] },
    { k: "question", questions: [{ question: "Deploy now?" }], answers: { "Deploy now?": "No, keep the changes local" }, state: "answered" }
  ], journal: { tools: [{ name: "Read", input: { file_path: "config.js" }, status: "complete", result: "\u0001".repeat(6000) + "TOOL-MIDDLE exact config" }] },
    changes: [{ rel: "config.js", added: 2, removed: 1, state: "kept" }] },
  { role: "user", segments: [{ t: "text", v: "continue with tests" }] }
];
const chat = Object.create(ChatView.prototype);
Object.assign(chat, { context: { globalStorageUri: { fsPath: tmp } }, handoffBudget: () => 4096 });
const tab = { id: "chat", model: "ollama:small" };

try {
  check("omitted constraints and decisions remain exactly recoverable in a readable private record", () => {
    const prompt = chat.handoffRecord(tab, messages);
    assert.ok(prompt.includes(tab.handoffFile));
    assert.ok(!prompt.includes("MIDDLE-CONSTRAINT"), "exercise a detail actually omitted from the inline overview");
    const data = fs.readFileSync(tab.handoffFile, "utf8");
    const recovered = JSON.parse(data, (_, v) => v && !Array.isArray(v) && Array.isArray(v.kural_text_chunks) ? v.kural_text_chunks.join("") : v);
    assert.deepStrictEqual(recovered.messages, JSON.parse(JSON.stringify(journal.entries(messages))));
    const lines = data.split("\n");
    assert.ok(lines.every((l) => l.length < 2000), "Read must not clip a line and hide the omitted detail again");
    const tools = new Tools(tmp);
    for (const marker of ["MIDDLE-CONSTRAINT", "MIDDLE-DECISION", "TOOL-MIDDLE", "No, keep the changes local", "screen.png"]) {
      const at = lines.findIndex((l) => l.includes(marker));
      assert.ok(at >= 0, marker);
      assert.ok(tools.read({ file_path: tab.handoffFile, offset: at + 1, limit: 1 }).includes(marker));
    }
    if (process.platform !== "win32") {
      assert.strictEqual(fs.statSync(tab.handoffFile).mode & 0o777, 0o600);
      assert.strictEqual(fs.statSync(path.dirname(tab.handoffFile)).mode & 0o777, 0o700);
    }
  });
  check("the last-resort compacted record is valid JSON and retains the full-history reference", () => {
    const archive = { path: tab.handoffFile, format: "kural-visible-history-v1" };
    for (const last of [messages.at(-1), { role: "user", segments: [{ t: "text", v: "\u0001".repeat(5000) }] }]) {
      const text = journal.handoff([...messages.slice(0, -1), last], 512, archive);
      const record = /<kural_handoff>\n([\s\S]*?)\n<\/kural_handoff>/.exec(text)[1];
      assert.doesNotThrow(() => JSON.parse(record));
      assert.ok(record.length <= 512);
      assert.ok(text.includes(tab.handoffFile));
    }
  });
  check("each chat keeps one current record, without exposing another chat or accumulating copies", () => {
    const dir = path.dirname(tab.handoffFile);
    chat.handoffRecord(tab, messages.slice(-1));
    assert.deepStrictEqual(fs.readdirSync(dir), ["history.json"]);
    assert.strictEqual(JSON.parse(fs.readFileSync(tab.handoffFile, "utf8")).messages.length, 1);
    const hostile = store.directory(path.join(tmp, "handoffs"), "../../other-chat");
    assert.strictEqual(path.dirname(hostile), path.join(tmp, "handoffs"));
    assert.notStrictEqual(hostile, dir);
  });
  check("a failed save cannot quietly produce a handoff whose omitted history is unavailable", () => {
    const blocked = path.join(tmp, "blocked"); fs.writeFileSync(blocked, "not a directory");
    assert.throws(() => store.save(messages, path.join(blocked, "handoffs")), /ENOTDIR|EEXIST/);
  });
  check("deleting the chat deletes its preserved history too", () => {
    Object.assign(chat, { tab: () => null, archive: { remove: () => {} }, postHistory: () => {} });
    chat.deleteChat(tab.id);
    assert.ok(!fs.existsSync(tab.handoffFile));
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(failed ? `handoff-store: ${failed} FAILED` : "handoff-store: ALL PASS");
process.exitCode = failed ? 1 : 0;
