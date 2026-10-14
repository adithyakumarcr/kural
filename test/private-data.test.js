// Kural's storage written by an older version with looser modes is made private once per version
// (extension/lib/private-data.js): folders 0700, files lose group/other access, links aren't followed.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { tighten, tightenOnce } = require("../extension/lib/private-data");

if (process.platform === "win32") { console.log("private-data: skipped on Windows (no modes)"); process.exit(0); }

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kural-private-")));
const store = path.join(tmp, "kural.kural"), outside = path.join(tmp, "outside");
const mode = (p) => fs.statSync(p).mode & 0o777;
for (const d of [store, path.join(store, "checkpoints"), path.join(store, "ssh"), outside]) { fs.mkdirSync(d, { recursive: true }); fs.chmodSync(d, 0o775); }
const old = path.join(store, "checkpoints", "1-a.json"), helper = path.join(store, "ssh", "askpass.sh"), mine = path.join(outside, "notes.txt");
fs.writeFileSync(old, "{}"); fs.chmodSync(old, 0o664);
fs.writeFileSync(helper, "#!/bin/sh\n"); fs.chmodSync(helper, 0o755);
fs.writeFileSync(mine, "x"); fs.chmodSync(mine, 0o644);
fs.symlinkSync(outside, path.join(store, "link-to-outside"));        // a link inside: never followed
fs.symlinkSync(mine, path.join(store, "link-to-file"));

const r = tighten(store);
assert.strictEqual(mode(store), 0o700);
assert.strictEqual(mode(path.join(store, "checkpoints")), 0o700);
assert.strictEqual(mode(old), 0o600, "an old checkpoint is private now");
assert.strictEqual(mode(helper), 0o700, "a helper keeps its owner's run bit");
assert.strictEqual(mode(outside), 0o775, "a folder reached through a link is left alone");
assert.strictEqual(mode(mine), 0o644, "a file reached through a link is left alone");
assert.deepStrictEqual(r, { dirs: 3, files: 2 });
assert.deepStrictEqual(tighten(store), { dirs: 0, files: 0 }, "nothing left to change");

// Once per version.
let saved = null;
const hooks = { done: () => saved, mark: (v) => { saved = v; } };
fs.chmodSync(old, 0o664);
assert.ok(tightenOnce(store, "1.1.0-rc.2", hooks));
assert.strictEqual(mode(old), 0o600);
fs.chmodSync(old, 0o664);
assert.strictEqual(tightenOnce(store, "1.1.0-rc.2", hooks), null, "the same version doesn't walk again");
assert.strictEqual(mode(old), 0o664);
assert.ok(tightenOnce(store, "1.1.0", hooks), "a new version walks again");
assert.strictEqual(mode(old), 0o600);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("private-data: ALL PASS");
