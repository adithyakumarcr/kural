// APP-10: Kural's records are private (folders 0700, files 0600, also ones an older version made 0644).
// APP-13: the SSH connection-reuse folder in the shared /tmp is used only if it's a real folder, ours, private.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { writePrivate, appendPrivate } = require("../extension/lib/private-file");
const { ChatArchive } = require("../extension/lib/chat/archive");
const { privateDir } = require("../extension/lib/devices/ssh");

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const mode = (f) => fs.statSync(f).mode & 0o777;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-files-"));

if (process.platform === "win32") { console.log("SKIP POSIX modes"); process.exit(0); }
check("writePrivate / appendPrivate: 0700 folder, 0600 file, an old 0644 file too", () => {
  const f = path.join(tmp, "a", "b.json");
  writePrivate(f, "{}"); assert.strictEqual(mode(f), 0o600); assert.strictEqual(mode(path.dirname(f)), 0o700);
  fs.chmodSync(f, 0o644); fs.chmodSync(path.dirname(f), 0o755);
  writePrivate(f, "{}"); assert.strictEqual(mode(f), 0o600); assert.strictEqual(mode(path.dirname(f)), 0o700);
  const l = path.join(tmp, "c", "errors.log"); appendPrivate(l, "x\n"); appendPrivate(l, "y\n");
  assert.strictEqual(fs.readFileSync(l, "utf8"), "x\ny\n"); assert.strictEqual(mode(l), 0o600);
});
check("chat archive: folder 0700, every chat file 0600", () => {
  const dir = path.join(tmp, "chats");
  const a = new ChatArchive(dir);
  const t = { id: "t1", title: "x", updatedAt: Date.now(), messages: [{ role: "user", text: "secret plan" }], workspace: { key: "k", name: "n" } };
  a.save(t, { title: t.title, when: t.updatedAt, count: 1, workspace: t.workspace });
  assert.strictEqual(mode(dir), 0o700);
  const files = fs.readdirSync(dir);
  assert.ok(files.length, "something was saved");
  for (const f of files) assert.strictEqual(mode(path.join(dir, f)), 0o600, f);
});
check("ssh reuse folder: made private; a link, someone else's or an open folder → not used", () => {
  const d = path.join(tmp, "ssh-ok"); assert.strictEqual(privateDir(d), true); assert.strictEqual(mode(d), 0o700);
  const target = path.join(tmp, "elsewhere"); fs.mkdirSync(target, { mode: 0o700 });
  const link = path.join(tmp, "ssh-link"); fs.symlinkSync(target, link);
  assert.strictEqual(privateDir(link), false);
  const file = path.join(tmp, "ssh-file"); fs.writeFileSync(file, "");
  assert.strictEqual(privateDir(file), false);
  const open = path.join(tmp, "ssh-open"); fs.mkdirSync(open, { mode: 0o777 }); fs.chmodSync(open, 0o777);
  assert.strictEqual(privateDir(open), true); assert.strictEqual(mode(open), 0o700);   // ours: tightened
  if (process.getuid && process.getuid() === 0) {
    const theirs = path.join(tmp, "ssh-theirs"); fs.mkdirSync(theirs, { mode: 0o700 }); fs.chownSync(theirs, 12345, 12345);
    assert.strictEqual(privateDir(theirs), false);
  }
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `app-files: ${failed} FAILED` : "app-files: ALL PASS");
process.exit(failed ? 1 : 0);
