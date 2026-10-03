// Chat history across workspaces (extension/lib/chat/archive.js): kept in full, pinned, deleted, shared by windows.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { ChatArchive } = require("../extension/lib/chat/archive");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kural-archive-"));
const wsA = { key: "/home/a/robot", name: "robot", open: "/home/a/robot" };
const wsB = { key: "/home/a/website", name: "website", open: "/home/a/website" };
const chat = (id, n, ws, title = `Chat ${id}`) => ({
  id, title, updatedAt: 1000 + n, workspace: ws,
  messages: Array.from({ length: n }, (_, i) => i % 2 ? { role: "assistant", blocks: [{ k: "text", text: "x".repeat(50000) }] } : { role: "user", segments: [{ t: "text", v: `q${i}` }] }),
});
const card = (t, extra = {}) => ({ title: t.title, when: t.updatedAt, count: t.messages.length / 2, workspace: t.workspace, ...extra });

check("a chat is kept in full (no trimming), with its card", () => {
  const a = new ChatArchive(dir);
  const t = chat("big1", 40, wsA);                       // ~1 MB of answers
  assert.ok(a.save(t, card(t)));
  assert.strictEqual(a.read("big1").messages.length, 40);
  assert.strictEqual(a.list().find((m) => m.id === "big1").workspace.name, "robot");
});

check("an unchanged chat isn't written again", () => {
  const a = new ChatArchive(dir);
  const t = chat("same", 2, wsA);
  assert.ok(a.save(t, card(t)));
  assert.strictEqual(a.save(t, card(t)), false);
});

check("chats from every workspace are listed (another window's too)", () => {
  const winA = new ChatArchive(dir), winB = new ChatArchive(dir);
  const t = chat("fromB", 2, wsB);
  winB.save(t, card(t));
  const names = winA.refresh().map((m) => m.workspace.name);
  assert.ok(names.includes("robot") && names.includes("website"), names.join());
});

check("pinned stays pinned when another window saves the chat again", () => {
  const winA = new ChatArchive(dir), winB = new ChatArchive(dir);
  const t = chat("pinme", 2, wsA);
  winB.save(t, card(t));          // window B knows it unpinned
  winA.refresh(); winA.pin("pinme", true);
  t.updatedAt++; t.messages.push({ role: "user", segments: [] });
  winB.save(t, card(t));          // B saves a newer version
  assert.strictEqual(new ChatArchive(dir).list().find((m) => m.id === "pinme").pinned, true);
});

check("deleted is gone for good, also from a window that still has it open", () => {
  const winA = new ChatArchive(dir), winB = new ChatArchive(dir);
  const t = chat("gone", 2, wsA);
  winB.save(t, card(t));
  winA.refresh(); winA.remove("gone");
  t.updatedAt++;
  assert.strictEqual(winB.save(t, card(t)), false, "window B must not bring it back");
  assert.strictEqual(new ChatArchive(dir).read("gone"), null);
  assert.ok(!fs.existsSync(path.join(dir, "gone.json")));
});

check("two windows deleting at the same time both stick", () => {
  const winA = new ChatArchive(dir), winB = new ChatArchive(dir);
  for (const id of ["d1", "d2"]) { const t = chat(id, 2, wsA); winA.save(t, card(t)); }
  winA.remove("d1"); winB.remove("d2");
  const ids = new ChatArchive(dir).list().map((m) => m.id);
  assert.ok(!ids.includes("d1") && !ids.includes("d2"), ids.join());
});

check("ids can't reach outside the folder", () => {
  const a = new ChatArchive(dir);
  assert.strictEqual(a.save({ id: "../evil", title: "x", messages: [{}] }, {}), false);
  assert.strictEqual(a.read("../../etc/passwd"), null);
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(fail ? `archive: ${fail} FAILED` : "archive: ALL PASS");
process.exit(fail ? 1 : 0);
