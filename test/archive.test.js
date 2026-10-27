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

check("BUG-14: a save that fails leaves no .tmp file behind", () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "kural-archive-tmp-"));
  const a = new ChatArchive(d2);
  fs.mkdirSync(path.join(d2, "abc.json"));                 // the rename target can't be replaced (like a locked file on Windows)
  const t = chat("abc", 2, wsA);
  assert.strictEqual(a.save(t, card(t)), false);
  assert.deepStrictEqual(fs.readdirSync(d2).filter((n) => n.endsWith(".tmp")), []);
  fs.rmSync(d2, { recursive: true, force: true });
});

check("BUG-14: old .tmp files of a killed window are swept when the archive opens; fresh ones (another window writing) stay", () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "kural-archive-sweep-"));
  const stale = path.join(d2, "x.json.4242.tmp"), fresh = path.join(d2, "y.json.4243.tmp"), other = path.join(d2, "notes.tmp");
  for (const f of [stale, fresh, other]) fs.writeFileSync(f, "{");
  const old = new Date(Date.now() - 2 * 3600000);
  fs.utimesSync(stale, old, old); fs.utimesSync(other, old, old);
  new ChatArchive(d2);
  assert.ok(!fs.existsSync(stale), "stale temp file removed");
  assert.ok(fs.existsSync(fresh), "a recent one may be in use by another window");
  assert.ok(fs.existsSync(other), "only <name>.<pid>.tmp files are ours");
  fs.rmSync(d2, { recursive: true, force: true });
});

// ---- History going missing (root causes found 27 Oct 2026) ----
const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), "kural-archive-h-"));

check("HIST-1: a chat whose card is unreadable (empty/truncated after a crash) is still listed: the card is rebuilt from the chat", () => {
  const d = fresh(), a = new ChatArchive(d);
  const t = chat("cardbad", 4, wsA, "Kept title");
  a.save(t, card(t));
  fs.writeFileSync(path.join(d, "cardbad.meta.json"), "");           // zero bytes: what a crash leaves without fsync
  const listed = new ChatArchive(d).list().find((m) => m.id === "cardbad");
  assert.ok(listed, "the chat vanished from History");
  assert.strictEqual(listed.title, "Kept title");
  assert.strictEqual(listed.workspace.name, "robot");
  assert.ok(fs.readdirSync(d).some((n) => n.startsWith("cardbad.meta.json.") && n.endsWith(".corrupt")), "the bad card is kept as .corrupt, not deleted");
  fs.rmSync(d, { recursive: true, force: true });
});

check("HIST-1b: a chat with no card at all (only <id>.json) is listed", () => {
  const d = fresh(), a = new ChatArchive(d);
  const t = chat("nocard", 2, wsB);
  a.save(t, card(t));
  fs.unlinkSync(path.join(d, "nocard.meta.json"));
  assert.ok(new ChatArchive(d).list().some((m) => m.id === "nocard"));
  fs.rmSync(d, { recursive: true, force: true });
});

check("HIST-2: a changed chat is saved even when its JSON has the same length and the same updatedAt", () => {
  const d = fresh(), a = new ChatArchive(d);
  const t = { id: "samelen", title: "T", updatedAt: 5, workspace: wsA, messages: [{ role: "user", segments: [{ t: "text", v: "aaaa" }] }] };
  assert.ok(a.save(t, card(t)));
  t.messages[0].segments[0].v = "bbbb";
  assert.ok(a.save(t, card(t)), "the edit was skipped as unchanged");
  assert.strictEqual(new ChatArchive(d).read("samelen").messages[0].segments[0].v, "bbbb");
  fs.rmSync(d, { recursive: true, force: true });
});

check("HIST-3: a deleted chat stays deleted when deleted.json is overwritten, truncated or capped (another window, an old version)", () => {
  const d = fresh(), a = new ChatArchive(d);
  const t = chat("tomb", 2, wsA);
  a.save(t, card(t)); a.remove("tomb");
  fs.writeFileSync(path.join(d, "deleted.json"), "[]");              // a lost update
  const b = new ChatArchive(d);
  assert.strictEqual(b.save(t, card(t)), false, "a window that still has it open brought it back");
  fs.writeFileSync(path.join(d, "deleted.json"), "[");               // truncated
  assert.strictEqual(new ChatArchive(d).save(t, card(t)), false);
  fs.rmSync(d, { recursive: true, force: true });
});

check("HIST-4: an unreadable deleted.json is kept (quarantined), never silently replaced", () => {
  const d = fresh();
  fs.writeFileSync(path.join(d, "deleted.json"), '["a1","a2"');
  const a = new ChatArchive(d);
  const t = chat("other", 2, wsA);
  a.save(t, card(t)); a.remove("other");
  assert.ok(fs.readdirSync(d).some((n) => /^deleted\.json\..*\.corrupt$/.test(n)), "the damaged list was overwritten");
  fs.rmSync(d, { recursive: true, force: true });
});

check("HIST-5: a chat file that can't be parsed is kept as .corrupt (not lost to the next save) and reads as missing", () => {
  const d = fresh(), a = new ChatArchive(d);
  const t = chat("badbody", 4, wsA);
  a.save(t, card(t));
  fs.writeFileSync(path.join(d, "badbody.json"), '{"id":"badbody","messages":[{"role":"us');   // cut off
  assert.strictEqual(a.read("badbody"), null);
  assert.ok(fs.readdirSync(d).some((n) => n.startsWith("badbody.json.") && n.endsWith(".corrupt")), "the damaged chat must be kept for recovery");
  fs.rmSync(d, { recursive: true, force: true });
});

check("HIST-6: writes are flushed to disk before the rename (no empty file after a power cut)", () => {
  const d = fresh(), a = new ChatArchive(d);
  const calls = [], fsync = fs.fsyncSync;
  fs.fsyncSync = (...x) => { calls.push("fsync"); return fsync(...x); };
  try { const t = chat("flush", 2, wsA); a.save(t, card(t)); } finally { fs.fsyncSync = fsync; }
  assert.ok(calls.length >= 2, "expected an fsync for the chat and its card");
  fs.rmSync(d, { recursive: true, force: true });
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(fail ? `archive: ${fail} FAILED` : "archive: ALL PASS");
process.exit(fail ? 1 : 0);
