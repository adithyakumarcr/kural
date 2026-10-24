// patches/kural/0100-one-frame-windows.patch: the first fork patch (one frame for all project windows), and 0101-git-open-after-clone.patch
// (the built-in git extension's Open), made against the pristine VS Code source that VSCodium 1.140.06880 builds from (vscode.lock).
// What is checked:
//   * always: each file is a well-formed unified diff (`git apply --numstat` reads every hunk and its line counts), touches only
//     files under src/vs/ (0101: extensions/git/src/), and carries the pieces the extension and the build rely on (the setting's
//     name, the workbench command `_kural.oneFrame`, dialogs of a hidden window, the clone's Open); package.json has the setting
//     `kural.window.oneFrame` (boolean, default true, application);
//   * with KURAL_VSCODE_SRC pointing at a PRISTINE checkout of that commit: `git apply --check` says it applies as it is;
//   * without it: that last check is skipped, with a note. (A checkout that already has the patch fails it, on purpose.)
// Not checked here: that the patched TypeScript compiles (done by hand with `tsc -p src/tsconfig.json --noEmit` in a
// checkout with `npm ci --ignore-scripts` and Electron's electron.d.ts; 24 Oct 2026) or what the windows do (needs the built app).
const assert = require("assert");
const fs = require("fs"), path = require("path");
const { spawnSync } = require("child_process");

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.message); } };
const root = path.join(__dirname, "..");
const dir = path.join(root, "patches", "kural");
const git = (args, o = {}) => spawnSync("git", args, { encoding: "utf8", ...o });
const haveGit = git(["--version"]).status === 0;

// Where each patch may change files: 0100 = VS Code's own code, 0101 = the built-in git extension.
const ROOTS = { "0100": ["src/vs/"], "0101": ["extensions/git/src/"] };
const rootsOf = (f) => ROOTS[f.slice(0, 4)] || ["src/vs/"];

const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^01\d\d-.+\.patch$/.test(f)).sort() : [];

check("the one-frame patches are there (0100-0199)", () => {
  assert.ok(files.includes("0100-one-frame-windows.patch"), `patches/kural has: ${files.join(", ") || "nothing"}`);
  assert.ok(files.includes("0101-git-open-after-clone.patch"), `patches/kural has: ${files.join(", ") || "nothing"}`);
});

for (const f of files) {
  const file = path.join(dir, f);
  const text = fs.readFileSync(file, "utf8");

  check(`${f}: only files under ${rootsOf(f).join(", ")}, every file a normal diff`, () => {
    const names = [...text.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)];
    assert.ok(names.length > 0, "no 'diff --git' header");
    for (const [, a, b] of names) {
      assert.strictEqual(a, b, `renamed: ${a} -> ${b}`);
      assert.ok(rootsOf(f).some((r) => a.startsWith(r)) && !a.includes(".."), `touches ${a}`);
    }
    assert.strictEqual((text.match(/^--- a\//gm) || []).length, names.length, "each file has a ---");
    assert.strictEqual((text.match(/^\+\+\+ b\//gm) || []).length, names.length, "each file has a +++");
    assert.ok(!/^(new|deleted) file mode|^rename |^GIT binary patch/m.test(text), "the patch only changes existing text files");
    assert.ok(text.endsWith("\n"), "ends with a newline");
    assert.ok(!text.includes("\r"), "no carriage returns");
  });

  check(`${f}: git reads every hunk (counts match)`, () => {
    if (!haveGit) { console.log("skip   (no git)"); return; }
    const r = git(["apply", "--numstat", file]);
    assert.strictEqual(r.status, 0, r.stderr);
    const rows = r.stdout.trim().split("\n").map((l) => l.split("\t"));
    assert.ok(rows.length > 0 && rows.every(([add, del, name]) => /^\d+$/.test(add) && /^\d+$/.test(del) && rootsOf(f).some((r) => name.startsWith(r))), r.stdout);
  });
}

check("0100: windows share a frame by the setting kural.window.oneFrame, and the workbench answers _kural.oneFrame", () => {
  const text = fs.readFileSync(path.join(dir, "0100-one-frame-windows.patch"), "utf8");
  assert.match(text, /kural\.window\.oneFrame/);
  assert.match(text, /registerCommand\('_kural\.oneFrame'/);
  assert.match(text, /\+\s+enabled: .*!== false/, "on unless the setting is false");
  for (const piece of ["windowsMainService.ts", "windowImpl.ts", "app.ts", "menubar.ts", "desktop.contribution.ts"]) assert.ok(text.includes(piece), `${piece} is touched`);
});

// The patch text of each hunk's added lines only (the part of the file a check should look at)
const added = (text, file) => {
  const part = text.split(/^diff --git /m).find((p) => p.startsWith(`a/${file} `));
  assert.ok(part, `${file} is not in the patch`);
  return part.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");
};

check("0100: a dialog for a hidden window brings the window into the frame first (message box, save and open dialog)", () => {
  const text = fs.readFileSync(path.join(dir, "0100-one-frame-windows.patch"), "utf8");
  const host = added(text, "src/vs/platform/native/electron-main/nativeHostMainService.ts");
  assert.match(host, /isHiddenInFrame/, "asks whether the window is hidden");
  assert.match(host, /await Promise\.race\(\[this\.windowsMainService\.showInFrame\(codeWindow\), timeout\(\d+\)\]\)/, "shows it (awaited), and never waits for ever");
  assert.strictEqual((host.match(/await this\.showInFrameForDialog\(window\);/g) || []).length, 3, "message box, save dialog and open dialog each show the window first");
  const win = added(text, "src/vs/platform/windows/electron-main/windowImpl.ts");
  assert.strictEqual((win.match(/await this\.showInFrameForDialog\(\);/g) || []).length, 2, "the window's own crash and not-responding dialogs");
});

check("0101: the git extension's Open after a clone (and after git init) opens a new window when windows share a frame", () => {
  const text = fs.readFileSync(path.join(dir, "0101-git-open-after-clone.patch"), "utf8");
  assert.match(added(text, "extensions/git/src/util.ts"), /executeCommand<[^>]*>\('_kural\.oneFrame'\)[\s\S]*catch[\s\S]*return false/, "asks the workbench, and is false when the command is missing");
  assert.match(added(text, "extensions/git/src/cloneManager.ts"), /await isOneFrame\(\) \? \{ forceNewWindow: true \} : \{ forceReuseWindow: true \}/, "clone: new window, else the old option");
  assert.match(added(text, "extensions/git/src/commands.ts"), /await isOneFrame\(\) \? \{ forceNewWindow: true \} : undefined/, "init: new window, else the old call");
  assert.ok(!/^-.*forceNewWindow/m.test(text), "the 'Open in New Window' choices stay as they are");
});

check("extension/package.json: kural.window.oneFrame is a boolean, on by default, application scope", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "extension", "package.json"), "utf8"));
  const p = pkg.contributes.configuration.properties["kural.window.oneFrame"];
  assert.ok(p, "the setting is missing");
  assert.strictEqual(p.type, "boolean");
  assert.strictEqual(p.default, true);
  assert.strictEqual(p.scope, "application");
  assert.match(p.markdownDescription || p.description, /source/i, "says it needs Kural built from source");
});

const src = process.env.KURAL_VSCODE_SRC;
if (!src) console.log("skip   git apply --check (set KURAL_VSCODE_SRC to a pristine checkout of the VS Code commit in vscode.lock)");
else if (!haveGit) console.log("skip   git apply --check (no git)");
else {
  for (const f of files) check(`${f}: applies to the pristine checkout (git apply --check in ${src})`, () => {
    assert.ok(fs.existsSync(path.join(src, "src", "vs")), `${src} has no src/vs`);
    const r = git(["apply", "--check", path.join(dir, f)], { cwd: src });
    assert.strictEqual(r.status, 0, `${r.stderr}\n(is the checkout pristine, at the commit in vscode.lock?)`);
  });
}

console.log(failed ? `\n${failed} failed` : "\nall ok");
process.exit(failed ? 1 : 0);
