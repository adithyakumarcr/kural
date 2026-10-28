// The build from VS Code's source (scripts/vscode/, vscode.lock, patches/kural/). No network: fetch.sh only runs with --dry-run.
//   1. vscode.lock: its keys, a 40-character commit, and the same VSCodium version as codium.lock and the build scripts.
//   2. fetch.sh --dry-run: the steps in order, Kural's patches before VSCodium's, nothing created (also in a copy with two patches).
//   3. build-mac.sh, make-deb.sh and build-win.sh without KURAL_SOURCE still download VSCodium; install.sh has --source (Mac and
//      Ubuntu); the workflow is by hand only, with a Mac, an Ubuntu and a Windows job.
//   4. Windows: build-win.sh runs fetch.sh with KURAL_OS=windows and build.sh win32-x64 only under KURAL_SOURCE (and only on
//      Windows), fetch.sh checks out with LF line ends and long paths, build.sh refuses a cross build and knows the Windows
//      Node zip, the workflow has the windows job. (Nothing here runs a Windows build: that needs a Windows computer.)
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

const lock = Object.fromEntries(read("vscode.lock").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => [l.split("=")[0], l.split("=").slice(1).join("=")]));

check("vscode.lock: keys, a 40-character commit, a comment line first", () => {
  assert(read("vscode.lock").startsWith("#"), "first line is a comment saying how to update");
  assert.deepStrictEqual(Object.keys(lock).sort(), ["vscode_commit", "vscode_version", "vscodium_tag"]);
  assert(/^[0-9a-f]{40}$/.test(lock.vscode_commit), `vscode_commit: ${lock.vscode_commit}`);
  assert(/^\d+\.\d+\.\d+$/.test(lock.vscode_version), `vscode_version: ${lock.vscode_version}`);
});

check("vscode.lock: the VSCodium tag is the one in codium.lock and the build scripts", () => {
  assert.strictEqual(read("codium.lock").match(/^# VSCodium (\d+(?:\.\d+)+)/)[1], lock.vscodium_tag);
  for (const f of ["build-mac.sh", "make-deb.sh", "build-win.sh"]) assert(read(f).includes(`CODIUM_VER="\${CODIUM_VER:-${lock.vscodium_tag}}"`), f);
  // VSCodium's tag is the VS Code version followed by a build counter (1.140.0 + 6880).
  assert(lock.vscodium_tag.startsWith(lock.vscode_version), `${lock.vscodium_tag} vs ${lock.vscode_version}`);
});

const bash = process.platform !== "win32";
const run = (cwd, ...args) => spawnSync("bash", [path.join(cwd, "scripts/vscode/fetch.sh"), ...args], { cwd, encoding: "utf8", env: { ...process.env, PATH: process.env.PATH } });
const order = (out, ...needles) => {
  let at = -1;
  for (const n of needles) { const i = out.indexOf(n, at + 1); assert(i > at, `"${n}" should come after the one before it in:\n${out}`); at = i; }
};

if (!bash) console.log("skip fetch.sh --dry-run (no bash)");
else {
  check("fetch.sh --dry-run: the steps in order, nothing touched", () => {
    const before = fs.existsSync(path.join(root, "build/vscode-src/.kural-source-stamp")) ? fs.statSync(path.join(root, "build/vscode-src/.kural-source-stamp")).mtimeMs : null;
    const r = run(root, "--dry-run");
    assert.strictEqual(r.status, 0, r.stderr);
    order(r.stdout, "1. VS Code", lock.vscode_commit, "2. VSCodium", lock.vscodium_tag, "3. Kural's patches", "4. VSCodium's changes", "5. product.json kuralSource", "6. stamp", "nothing was changed");
    const after = fs.existsSync(path.join(root, "build/vscode-src/.kural-source-stamp")) ? fs.statSync(path.join(root, "build/vscode-src/.kural-source-stamp")).mtimeMs : null;
    assert.strictEqual(after, before, "the stamp was touched");
  });

  check("fetch.sh --dry-run: Kural's patches come before VSCodium's, in name order; creates nothing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-vscode-source-"));
    try {
      fs.mkdirSync(path.join(tmp, "scripts/vscode"), { recursive: true });
      fs.mkdirSync(path.join(tmp, "patches/kural"), { recursive: true });
      for (const f of ["fetch.sh", "lock.sh"]) fs.copyFileSync(path.join(root, "scripts/vscode", f), path.join(tmp, "scripts/vscode", f));
      fs.copyFileSync(path.join(root, "vscode.lock"), path.join(tmp, "vscode.lock"));
      // written in the wrong order on purpose; a README beside them is not a patch
      for (const n of ["0201-b-projects", "0101-a-one-frame", "0100-first"]) fs.writeFileSync(path.join(tmp, "patches/kural", `${n}.patch`), "");
      fs.writeFileSync(path.join(tmp, "patches/kural/README.md"), "not a patch");
      // a VSCodium checkout from an earlier run: its patches are listed too
      fs.mkdirSync(path.join(tmp, "build/vscodium-src/patches"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "build/vscodium-src/patches/00-brand.patch"), "");
      const files = () => spawnSync("find", [tmp, "-type", "f"], { encoding: "utf8" }).stdout.split("\n").sort().join("\n");
      const before = files();
      const r = run(tmp, "--dry-run");
      assert.strictEqual(r.status, 0, r.stderr);
      order(r.stdout, "kural patch: 0100-first", "kural patch: 0101-a-one-frame", "kural patch: 0201-b-projects", "4. VSCodium's changes", "vscodium patch: 00-brand", "5. product.json");
      assert(!r.stdout.includes("README"), "README is not a patch");
      assert(r.stdout.includes("3. Kural's patches (3)"), r.stdout);
      assert.strictEqual(files(), before, "a dry run changed files");
      assert(!fs.existsSync(path.join(tmp, "build/vscode-src")), "a dry run made the source folder");
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  check("fetch.sh: an unknown option and a bad commit are refused", () => {
    assert.notStrictEqual(run(root, "--nope").status, 0);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-vscode-source-"));
    try {
      fs.mkdirSync(path.join(tmp, "scripts/vscode"), { recursive: true });
      for (const f of ["fetch.sh", "lock.sh"]) fs.copyFileSync(path.join(root, "scripts/vscode", f), path.join(tmp, "scripts/vscode", f));
      fs.writeFileSync(path.join(tmp, "vscode.lock"), "# x\nvscode_version=1.0.0\nvscode_commit=abc\nvscodium_tag=1.0.00000\n");
      const r = run(tmp, "--dry-run");
      assert.notStrictEqual(r.status, 0);
      assert(/40-character/.test(r.stderr), r.stderr);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
}

check("build-mac.sh: without KURAL_SOURCE it downloads and checks VSCodium as before", () => {
  const s = read("build-mac.sh");
  const gate = s.indexOf('"${KURAL_SOURCE:-0}" = 1');
  const els = s.indexOf("\nelse\n", gate);
  const dl = s.indexOf("releases/download/$CODIUM_VER/VSCodium-darwin-arm64-$CODIUM_VER.zip");
  assert(gate > 0 && els > gate && dl > els, "the download is in the else branch of the KURAL_SOURCE test");
  assert(s.indexOf("check-codium.sh", els) > els && s.indexOf("unzip -q", els) > els, "the checksum and unzip too");
  assert(s.indexOf("scripts/vscode/fetch.sh") > gate && s.indexOf("scripts/vscode/fetch.sh") < els, "the source build is the KURAL_SOURCE branch");
  // everything after the app is there stays the same for both ways
  const after = s.indexOf("\nfi\n", els);
  for (const l of ["electron_runtime.py", "scripts/rebrand.py"]) assert(s.indexOf(l) > after, l);
  assert(s.lastIndexOf("codesign") > after, "signing");
});

check("install.sh builds VS Code from source by default (--quick: VSCodium's download); the workflow is by hand and pins its actions", () => {
  // (Adithya, 27 Oct 2026: one window for all projects on every system. That is patch 0100, only in the source build: the
  // Mac app built from VSCodium's download opened a window per project while the Linux test build, from source, didn't.)
  const sh = read("install.sh");
  assert(/--source\) SOURCE=1 ;;/.test(sh) && /--quick\) SOURCE=0 ;;/.test(sh), "--source and --quick");
  assert(/SOURCE=default/.test(sh) && /if \[ "\$SOURCE" = default \]; then\n  SOURCE=1\n/.test(sh), "the default is the source build");
  assert(/"\$\(uname -s\)" = Linux \] && \[ "\$\(uname -m\)" != x86_64 \]; then\n    SOURCE=0/.test(sh), "except Linux that isn't x64 (make-deb.sh's source build is x64 only)");
  assert(/export KURAL_SOURCE="\$SOURCE"/.test(sh), "exported for build-mac.sh / make-deb.sh, also as 0 over one in the environment");
  const w = read(".github/workflows/build-from-source.yml");
  assert(/^on:\n  workflow_dispatch:/m.test(w) && !/^\s+(push|pull_request|schedule):/m.test(w), "workflow_dispatch only");
  assert(/runs-on: macos-latest/.test(w) && /scripts\/vscode\/fetch\.sh/.test(w) && /scripts\/vscode\/build\.sh/.test(w) && /KURAL_SOURCE=1 \.\/build-mac\.sh/.test(w));
  const uses = w.split("\n").filter((l) => /uses:/.test(l));
  assert(uses.length >= 3 && uses.every((l) => /@[0-9a-f]{40}\s+#/.test(l)), "each action pinned to a commit");
});

check("make-deb.sh: without KURAL_SOURCE it downloads and checks VSCodium as before; with it the source build is packaged", () => {
  const s = read("make-deb.sh");
  const gate = s.indexOf('"${KURAL_SOURCE:-0}" = 1');
  const els = s.indexOf("\nelse\n", gate);
  const fi = s.indexOf("\nfi\n", els);
  assert(gate > 0 && els > gate && fi > els, "a KURAL_SOURCE test with an else branch");
  const dl = s.indexOf("releases/download/$CODIUM_VER/codium_${CODIUM_VER}_amd64.deb");
  assert(dl > els && dl < fi, "the download is in the else branch");
  assert(s.indexOf("check-codium.sh", els) > els && s.indexOf("dpkg-deb -f codium.deb Depends", els) > els, "the checksum and the dependencies of the download too");
  const fetch = s.indexOf("scripts/vscode/fetch.sh"), build = s.indexOf("scripts/vscode/build.sh --download-node linux-x64");
  assert(fetch > gate && fetch < build && build < els, "the source build is the KURAL_SOURCE branch: fetch, then build.sh linux-x64");
  assert(s.includes("build/vscode-out/linux-x64"), "it packages build.sh's output folder");
  assert(s.includes("dep-lists.ts"), "the dependencies come from VS Code's own list");
  // everything after the app folder is there stays the same for both ways
  for (const l of ["electron_runtime.py", "scripts/rebrand.py", "dpkg-deb --root-owner-group"]) assert(s.indexOf(l) > fi, l);
  assert(s.includes('"$R/usr/share/codium"') && s.indexOf('mv "$R/usr/share/codium"') > fi, "the app folder is renamed after both ways");
});

check("install.sh --source works on Ubuntu too, and says so elsewhere", () => {
  const s = read("install.sh");
  const lin = s.indexOf("\nlinux() {"), mac = s.indexOf("\nmac() {"), dispatch = s.indexOf('case "$(uname -s)"');
  assert(lin > 0 && mac > 0 && dispatch > lin, "mac(), linux() and the system test");
  const linux = s.slice(lin, dispatch);
  assert(linux.includes('"${KURAL_SOURCE:-0}" = 1') && linux.includes("libkrb5-dev") && linux.includes("build-essential"), "linux() installs VS Code's build tools for --source");
  assert(linux.indexOf("./make-deb.sh") > linux.indexOf("KURAL_SOURCE"), "then the usual make-deb.sh (it reads KURAL_SOURCE, exported by --source)");
  assert(/VS Code itself is built from\n#\s+its source with Kural's patches/.test(s) && /--quick    use VSCodium's download/.test(s) && !/--source   Mac: /.test(s), "the help says what the default and --quick are");
  assert(/die "this script is for a Mac or Ubuntu \(also with --source\)/.test(s), "a clear message on other systems");
});

check("the workflow has an Ubuntu job beside the Mac one: source build, .deb, install, start", () => {
  const w = read(".github/workflows/build-from-source.yml");
  const jobs = w.slice(w.indexOf("\njobs:"));
  const at = jobs.indexOf("\n  linux:");
  assert(at > 0 && jobs.indexOf("\n  macos:") > 0, "a linux and a macos job");
  const next = jobs.indexOf("\n  windows:", at);
  const linux = jobs.slice(at, next > 0 ? next : undefined);   // (up to the Windows job, which comes after it)
  assert(/runs-on: ubuntu-\d+\.\d+/.test(linux), "an Ubuntu runner");
  for (const l of ["libx11-dev", "libxkbfile-dev", "libsecret-1-dev", "libkrb5-dev", "build-essential", "scripts/vscode/fetch.sh", "scripts/vscode/build.sh --download-node linux-x64", "KURAL_SOURCE=1 ./make-deb.sh", "apt-get install -y ./dist/kural_*_amd64.deb", "Xvfb", "kuralSource", '"ready":'])
    assert(linux.includes(l), l);
  const step = (t) => linux.indexOf(t);
  assert(step("scripts/vscode/fetch.sh") < step("scripts/vscode/build.sh") && step("scripts/vscode/build.sh") < step("KURAL_SOURCE=1 ./make-deb.sh") && step("KURAL_SOURCE=1 ./make-deb.sh") < step("apt-get install -y ./dist"), "steps in order");
  assert(/^permissions:\n  contents: read/m.test(w) && !/contents: write/.test(w), "read-only");
  const uses = linux.split("\n").filter((l) => /uses:/.test(l));
  assert(uses.length >= 2 && uses.every((l) => /@[0-9a-f]{40}\s+#/.test(l)), "each action in the linux job pinned to a commit");
  // the same pins as build.yml's Ubuntu jobs
  const ci = read(".github/workflows/build.yml");
  for (const l of uses) assert(ci.includes(l.trim().replace(/^- /, "")), `${l.trim()} is the version build.yml uses`);
});

check("the scripts have valid bash syntax; build.sh doesn't need shasum on Linux", () => {
  if (!bash) return;
  for (const f of ["make-deb.sh", "install.sh", "build-mac.sh", "build-win.sh", "scripts/vscode/build.sh", "scripts/vscode/fetch.sh"]) {
    const r = spawnSync("bash", ["-n", path.join(root, f)], { encoding: "utf8" });
    assert.strictEqual(r.status, 0, `${f}: ${r.stderr}`);
  }
  const b = read("scripts/vscode/build.sh");
  assert(b.includes("sha256sum"), "sha256sum is tried first");
  assert(b.includes("linux-x64"), "linux-x64 output is checked");
});

if (bash) check("fetch.sh --dry-run with KURAL_OS=linux names VSCodium's linux patch folder", () => {
  const r = spawnSync("bash", [path.join(root, "scripts/vscode/fetch.sh"), "--dry-run"], { cwd: root, encoding: "utf8", env: { ...process.env, KURAL_OS: "linux" } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert(r.stdout.includes("(linux)") && r.stdout.includes("patches/linux/*.patch"), r.stdout);
});

check("build.sh: platforms, the Node check and the gulp tasks", () => {
  const s = read("scripts/vscode/build.sh");
  for (const p of ["darwin-arm64", "linux-x64", "win32-x64"]) assert(s.includes(p), p);
  assert(s.includes(".nvmrc") && s.includes('"vscode-$PLATFORM-min-packing"') && s.includes("vscode-min-prepack"));
  assert(s.includes("build/vscode-out"), "output folder");
});

// ---- Windows (built under Git Bash on a Windows computer; here only read, and refused where it can't run)

check("build-win.sh: without KURAL_SOURCE it downloads and checks VSCodium as before; with it, fetch.sh (windows) then build.sh win32-x64", () => {
  const s = read("build-win.sh");
  const gate = s.indexOf('"${KURAL_SOURCE:-0}" = 1');
  const els = s.indexOf("\nelse\n", gate);
  const fi = s.indexOf("\nfi\n", els);
  assert(gate > 0 && els > gate && fi > els, "a KURAL_SOURCE test with an else branch");
  const dl = s.indexOf("releases/download/$CODIUM_VER/VSCodium-win32-x64-$CODIUM_VER.zip");
  assert(dl > els && dl < fi, "the download is in the else branch");
  assert(s.indexOf("scripts/check-codium.sh", els) > els && s.indexOf('rm -rf "$WORK" && mkdir -p "$APP"', els) > els && s.indexOf('unzip -q "$SRC" -d "$APP"', els) > els && s.indexOf('unzip -q "$SRC" -d "$APP"') < fi, "the checksum and unzip of the download too, in that order");
  assert(!s.slice(0, els).includes("check-codium.sh") && !s.slice(0, els).includes("unzip -q"), "nothing of the download before the else");
  const fetch = s.indexOf("KURAL_OS=windows ./scripts/vscode/fetch.sh"), build = s.indexOf("./scripts/vscode/build.sh --download-node win32-x64");
  assert(fetch > gate && fetch < build && build < els, "the source build is the KURAL_SOURCE branch: fetch (KURAL_OS=windows), then build.sh win32-x64");
  assert(s.indexOf("scripts/vscode/fetch.sh", els) < 0 && s.indexOf("scripts/vscode/build.sh", els) < 0, "fetch.sh and build.sh are not used outside it");
  assert(s.includes("build/vscode-out/win32-x64") && s.indexOf("build/vscode-out/win32-x64") < els, "it takes build.sh's output folder as the app folder");
  // everything after the app folder is there stays the same for both ways
  for (const l of ["electron_runtime.py", "scripts/rebrand.py", "scripts/sbom.py", "scripts/win-exe.js", "scripts/sign-win.sh", "installer/kural.nsi"]) assert(s.indexOf(l) > fi, l);
  assert(s.indexOf("makensis", fi) > fi && s.indexOf("zip -qr", fi) > fi, "the installer and the zip");
  assert(/WINDOWS_HOST" = 1 \]\s*\|\|[^\n]*Windows/.test(s.slice(gate, build)), "refuses a source build on another system before fetching");
});

if (bash) check("build-win.sh: KURAL_SOURCE=1 is refused off Windows, before anything is made", () => {
  if (process.platform === "win32") return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-win-source-"));
  try {
    fs.mkdirSync(path.join(tmp, "extension"));
    fs.copyFileSync(path.join(root, "build-win.sh"), path.join(tmp, "build-win.sh"));
    fs.copyFileSync(path.join(root, "extension/package.json"), path.join(tmp, "extension/package.json"));
    const r = spawnSync("bash", [path.join(tmp, "build-win.sh")], { cwd: tmp, encoding: "utf8", env: { ...process.env, KURAL_SOURCE: "1" } });
    assert.notStrictEqual(r.status, 0);
    assert(/runs on Windows, in Git Bash/.test(r.stderr), r.stderr);
    assert(!fs.existsSync(path.join(tmp, "build")), "it started building");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

if (bash) check("build.sh win32-x64: refused off Windows with a clear message; unknown platforms still refused", () => {
  if (process.platform === "win32") return;
  const r = spawnSync("bash", [path.join(root, "scripts/vscode/build.sh"), "win32-x64"], { cwd: root, encoding: "utf8" });
  assert.notStrictEqual(r.status, 0);
  assert(/win32-x64 can only be built on Windows/.test(r.stderr) && /Git Bash/.test(r.stderr), r.stderr);
  assert.notStrictEqual(spawnSync("bash", [path.join(root, "scripts/vscode/build.sh"), "win32-arm64"], { cwd: root, encoding: "utf8" }).status, 0);
});

check("build.sh: Windows gets nodejs.org's zip (read with Python, Git Bash has no unzip), node.exe, npm.cmd and the Windows steps", () => {
  const s = read("scripts/vscode/build.sh");
  assert(s.includes("win32-x64) NODE_PLAT=win-x64"), "Node's name for it");
  assert(s.includes('file="node-v$NEED-$NODE_PLAT.zip"') && s.includes("zipfile.ZipFile"), "the zip, checked against SHASUMS256.txt like the tarballs");
  assert(s.indexOf('got="$(hash < "$tmp/$file")"') > 0 && s.indexOf('got="$(hash < "$tmp/$file")"') < s.indexOf("zipfile.ZipFile"), "checked before it is opened");
  assert(s.includes("node.exe") && s.includes("npm.cmd"), "node.exe and npm.cmd");
  assert(s.includes("python3 -c '' >/dev/null 2>&1 || python3() { python"), "python for python3");
  assert(/if \[ "\$PLATFORM" != win32-x64 \]; then[^\n]*\n\s*rm -f \.build\/extensions\/ms-vscode\.js-debug\/src\/win32-app-container-tokens/.test(s), "the Windows file is kept on Windows");
  assert(s.includes("rg.exe") && s.includes("--path-separator /"), "the telemetry sweep finds ripgrep's .exe");
  assert(s.includes("POLICY=win32") && s.includes("npm_config_arch=x64"), "the policy files and npm's arch");
  assert(s.includes("$BUILT/VSCodium.exe"), "the output is checked");
  // Mac and Linux are as they were
  assert(s.includes('tar -xzf "$tmp/$file" -C "$LOCAL_NODE" --strip-components=1') && s.includes('NODE_DIR="$LOCAL_NODE/bin"'), "tarballs and bin/");
  assert(s.includes('CXX=clang++ npm ci'), "the Mac's compiler");
});

check("fetch.sh: LF line ends and long paths in both checkouts (Git Bash on Windows), CRLF patches refused, Windows paths compared", () => {
  const s = read("scripts/vscode/fetch.sh");
  for (const l of ['config core.autocrlf false', 'config core.eol lf', 'config core.longpaths true']) assert(s.includes(`git -C "$DEST" ${l}`), l);
  assert(s.indexOf('config core.autocrlf false') < s.indexOf("checkout -q --force FETCH_HEAD"), "set before the checkout, not after");
  assert(/clone -q --depth 1 --branch "\$TAG" https:\/\/github\.com\/VSCodium\/vscodium/.test(s) && /-c core\.autocrlf=false -c core\.eol=lf -c core\.longpaths=true/.test(s), "VSCodium's checkout too");
  assert(s.includes("has CRLF line ends"), "a patch with CRLF is refused with a reason");
  assert(s.includes("cygpath -u"), "git's C:/x and Git Bash's /c/x are the same folder");
  assert(s.includes("python3 -c '' >/dev/null 2>&1 || python3() { python"), "python for python3");
});

if (bash) check("fetch.sh --dry-run with KURAL_OS=windows names VSCodium's windows patch folder and runs on any system", () => {
  const r = spawnSync("bash", [path.join(root, "scripts/vscode/fetch.sh"), "--dry-run"], { cwd: root, encoding: "utf8", env: { ...process.env, KURAL_OS: "windows" } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert(r.stdout.includes("(windows)") && r.stdout.includes("patches/windows/*.patch"), r.stdout);
});

check("the workflow has a Windows job after the Ubuntu one: Git LF, Python, Node at .nvmrc, fetch, build, build-win.sh, start, artifact", () => {
  const w = read(".github/workflows/build-from-source.yml");
  assert(/^name: Build from source \(Mac, Ubuntu and Windows\)/m.test(w) && !/Windows still uses the download/.test(w), "title and comment name all three");
  const jobs = w.slice(w.indexOf("\njobs:"));
  const at = jobs.indexOf("\n  windows:");
  assert(at > jobs.indexOf("\n  linux:") && at > jobs.indexOf("\n  macos:"), "the windows job comes after the others");
  const win = jobs.slice(at);
  assert(/runs-on: windows-2022/.test(win) && /defaults:\n\s+run:\n\s+shell: bash/.test(win), "windows-2022, bash by default");
  const step = (t) => { const i = win.indexOf(t); assert(i > 0, t); return i; };
  assert(step("core.autocrlf false") < step("actions/checkout@"), "Git keeps LF before the checkout");
  for (const l of ["actions/setup-python@", "KURAL_OS=windows scripts/vscode/fetch.sh", "node-version-file: build/vscode-src/.nvmrc", "scripts/vscode/build.sh --download-node win32-x64", "KURAL_SOURCE=1 ./build-win.sh", "kuralSource", "setup.exe", "windows-x64.zip", "makensis", "pillow", "kural.cmd", '"ready":', "kuralRuntime", "actions/upload-artifact@"]) step(l);
  assert(step("actions/setup-python@") < step("scripts/vscode/fetch.sh") && step("scripts/vscode/fetch.sh") < step("actions/setup-node@") && step("actions/setup-node@") < step("scripts/vscode/build.sh") && step("scripts/vscode/build.sh") < step("KURAL_SOURCE=1 ./build-win.sh") && step("KURAL_SOURCE=1 ./build-win.sh") < step("Install silently") && step("Install silently") < step("actions/upload-artifact@"), "steps in order (Node after the fetch: .nvmrc comes from the source)");
  assert(/^permissions:\n  contents: read/m.test(w) && !/contents: write/.test(w), "read-only");
  assert(!/KURAL_SIGN_|secrets\./.test(win), "no signing secrets");
  const all = [".github/workflows/build.yml", ".github/workflows/build-from-source.yml"].map(read).join("\n");
  const uses = win.split("\n").filter((l) => /uses:/.test(l));
  assert(uses.length >= 4 && uses.every((l) => /@[0-9a-f]{40}\s+#/.test(l)), "each action pinned to a commit");
  for (const l of uses) assert(all.includes(l.trim().replace(/^- /, "")), `${l.trim()} is a version the other jobs use too`);
});

process.exit(fail ? 1 : 0);
