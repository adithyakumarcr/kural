// Terminal Tab's git context (lib/tab/terminal.js gitContext) runs git in the terminal's folder on its own, while you
// type. A repository's .git/config can name programs git runs (fsmonitor, diff.external, clean filters, gpg for
// log.showSignature…), so (APP-1): only inside a trusted workspace folder, and never those programs.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const Module = require("module");
const load = Module._load;
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kural-tgit-")));
const project = path.join(tmp, "project"), outside = path.join(tmp, "downloads");
const vscode = { workspace: { isTrusted: true, workspaceFolders: [{ name: "project", uri: { scheme: "file", fsPath: project } }], getConfiguration: () => ({ get: (_, d) => d }) } };
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const { _test: { gitContext } } = require("../extension/lib/tab/terminal");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const hasGit = spawnSync("git", ["--version"]).status === 0;

// A repository whose config runs a marker-writing program from every place git would.
function crafted(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const git = (...a) => { const r = spawnSync("git", a, { cwd: dir, encoding: "utf8" }); assert.strictEqual(r.status, 0, r.stderr); };
  const marks = path.join(dir, "..", `marks-${path.basename(dir)}`); fs.mkdirSync(marks, { recursive: true });
  const hook = (name) => { const f = path.join(marks, `${name}.sh`); fs.writeFileSync(f, `#!/bin/sh\ntouch '${path.join(marks, name)}'\ncat\n`, { mode: 0o700 }); return f; };
  git("init", "-q");
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n"); fs.writeFileSync(path.join(dir, ".gitattributes"), "*.txt filter=evil diff=evil\n");
  git("add", "."); git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  git("config", "core.fsmonitor", hook("fsmonitor")); git("config", "diff.external", hook("external"));
  git("config", "filter.evil.clean", hook("clean")); git("config", "filter.evil.process", hook("process"));
  git("config", "diff.evil.textconv", hook("textconv")); git("config", "diff.evil.command", hook("command"));
  git("config", "log.showSignature", "true"); git("config", "gpg.program", hook("gpg"));
  fs.writeFileSync(path.join(dir, "a.txt"), "two\n");
  const t = new Date(Date.now() + 5000); fs.utimesSync(path.join(dir, "a.txt"), t, t);
  return () => fs.readdirSync(marks).filter((f) => !f.endsWith(".sh"));
}

(async () => {
  if (!hasGit || process.platform === "win32") { console.log("SKIP no git / shell hooks on Windows"); return; }
  await check("a repository outside the workspace folders: git isn't run at all", async () => {
    const fired = crafted(outside);
    const r = await gitContext(outside, true);
    assert.strictEqual(r.text, ""); assert.deepStrictEqual(fired(), []);
  });
  await check("inside a trusted workspace folder: status/diff/log work, no repository program runs", async () => {
    const fired = crafted(project);
    const r = await gitContext(project, true);
    assert.match(r.text, /git status:/); assert.match(r.text, /a\.txt/); assert.match(r.text, /recent commit messages/);
    assert.deepStrictEqual(fired(), []);
  });
  await check("an untrusted window: nothing", async () => {
    vscode.workspace.isTrusted = false;
    const r = await gitContext(path.join(project), false);
    assert.strictEqual(r.text, ""); vscode.workspace.isTrusted = true;
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `terminal-git: ${failed} FAILED` : "terminal-git: ALL PASS"); process.exitCode = failed ? 1 : 0;
})();
