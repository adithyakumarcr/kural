// Build supply chain and the Windows installer's folder checks (SUP-1, SUP-2, REL-4).
// SUP-1: resedit (used by build-win.sh in the job that can hold the signing certificate) is an exact devDependency
//        with lockfile checksums, installed with `npm ci --ignore-scripts`.
// SUP-2: install.sh's Pillow comes from a hash-pinned requirements file, wheels only.
// REL-4: installer/kural.nsi deletes its folder (RMDir /r) only after KuralDirCheck; compiled with makensis when present.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let fail = 0;
const check = (name, fn) => { try { const r = fn(); console.log(r === "skip" ? "skip" : "ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };

check("SUP-1: resedit is an exact devDependency, locked with sha512 integrity (and its dependency too)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(!pkg.dependencies, "no runtime npm dependencies");
  assert.match(pkg.devDependencies.resedit, /^\d+\.\d+\.\d+$/, "exact version");
  const lock = JSON.parse(read("package-lock.json"));
  const names = Object.keys(lock.packages).filter((k) => k);
  assert.ok(names.includes("node_modules/resedit"));
  assert.strictEqual(lock.packages["node_modules/resedit"].version, pkg.devDependencies.resedit);
  for (const k of names) {
    assert.match(lock.packages[k].integrity || "", /^sha512-/, `${k} has an integrity`);
    assert.match(lock.packages[k].resolved || "", /^https:\/\/registry\.npmjs\.org\//, `${k} from the npm registry`);
  }
});
check("SUP-1: build-win.sh installs from the lockfile without scripts (no unpinned npm install)", () => {
  const sh = read("build-win.sh");
  assert.ok(!/npm (i|install)\b/.test(sh), "no npm install");
  assert.match(sh, /^npm ci --ignore-scripts\b/m);
  assert.ok(!/scripts\/node_modules/.test(sh), "the old never-true guard is gone");
});
check("SUP-2: install.sh's Pillow is hash-pinned, wheels only", () => {
  const sh = read("install.sh");
  assert.ok(!/pip install[^\n]*\bpillow\b(?!-)/i.test(sh.replace(/requirements-icons/g, "")), "no bare 'pip install pillow'");
  assert.match(sh, /pip install -q --require-hashes --only-binary=:all: -r scripts\/requirements-icons\.txt/);
  const req = read("scripts/requirements-icons.txt").replace(/\\\n/g, " ");
  const lines = req.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  assert.ok(lines.length >= 1);
  for (const l of lines) {
    assert.match(l, /^pillow==\d+\.\d+\.\d+ ; python_version /, l);
    assert.match(l, /--hash=sha256:[0-9a-f]{64}/, l);
  }
});
check("REL-4: every RMDir /r in the installer comes after the folder check", () => {
  const nsi = read("installer/kural.nsi").split("\n").filter((l) => !/^\s*;/.test(l)).join("\n");   // (not comments)
  const sections = nsi.split(/\n(?=Section |Function )/);
  let seen = 0;
  for (const s of sections) {
    const i = s.indexOf("RMDir /r");
    if (i < 0) continue;
    seen++;
    const before = s.slice(0, i);
    assert.match(before, /Call (un\.)?KuralDirCheck[\s\S]*\$\{If\} \$DirWhy (==|!=) ""/, s.split("\n")[0]);
  }
  assert.strictEqual(seen, 2, "the install and the uninstall");
  assert.match(nsi, /StrCpy \$0 "\$INSTDIR" "" -6\s+\$\{If\} \$0 != "\\Kural"/, "named Kural");
  for (const v of ["$PROFILE", "$DESKTOP", "$DOCUMENTS", "$WINDIR"]) assert.ok(nsi.includes(`"$INSTDIR" == "${v}"`), v);
  assert.match(nsi, /MUI_PAGE_CUSTOMFUNCTION_LEAVE DirLeave/);
});
check("REL-4: the installer compiles (makensis)", () => {
  if (spawnSync("makensis", ["-VERSION"]).status !== 0) return "skip";
  const t = fs.mkdtempSync(path.join(os.tmpdir(), "kural-nsis-"));
  try {
    fs.mkdirSync(path.join(t, "src"));
    fs.writeFileSync(path.join(t, "src", "Kural.exe"), "stand-in");
    // A 1x1 32-bit icon (ICO header + directory entry + BITMAPINFOHEADER + pixel + mask).
    const bmp = Buffer.alloc(40 + 4 + 4);
    bmp.writeUInt32LE(40, 0); bmp.writeInt32LE(1, 4); bmp.writeInt32LE(2, 8); bmp.writeUInt16LE(1, 12); bmp.writeUInt16LE(32, 14);
    const head = Buffer.alloc(6 + 16);
    head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
    head[6] = 1; head[7] = 1; head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12); head.writeUInt32LE(bmp.length, 14); head.writeUInt32LE(22, 18);
    fs.writeFileSync(path.join(t, "icon.ico"), Buffer.concat([head, bmp]));
    const r = spawnSync("makensis", ["-V2", "-DVERSION=9.9.9", `-DSRC=${path.join(t, "src")}`, `-DICON=${path.join(t, "icon.ico")}`,
      `-DOUT=${path.join(t, "Kural-check.exe")}`, path.join(root, "installer", "kural.nsi")], { encoding: "utf8" });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.statSync(path.join(t, "Kural-check.exe")).size > 10000);
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
});

console.log(fail ? `audit-supply: ${fail} FAILED` : "audit-supply: ALL PASS");
process.exit(fail ? 1 : 0);
