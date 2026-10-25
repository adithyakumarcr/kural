// Ctrl+K's question box is a comment thread, and VS Code gives every comment input at least 5 lines (90 px): Adithya,
// "why such a huge block, keep it small". scripts/rebrand.py small_edit_box makes Kural's box ("kural-edit") start at 2
// lines and grow as you type; every other comment box keeps VS Code's 5.
//   1. on a stand-in with the shape of VS Code 1.140's comment code (runs everywhere),
//   2. on a real workbench file when one is around.
const assert = require("assert");
const fs = require("fs"), path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const root = path.join(__dirname, "..");
const patch = (text) => spawnSync("python3", ["-c", `import sys\nsys.path.insert(0, ${JSON.stringify(path.join(root, "scripts"))})\nimport rebrand\n` +
  "sys.stdout.write(rebrand.small_edit_box(sys.stdin.read()))"], { input: text, encoding: "utf8", maxBuffer: 1 << 28 });

// As minified in 1.140: the size rule (MZt), the two constants before the comment editor class, the reply area's
// constructor (its first height). Pr = clamp. 18 px lines.
const STAND_IN = 'function Pr(a,b,c){return Math.min(Math.max(a,b),c)}' +
  'function MZt(s,o,e){let t=o.getLayoutInfo(),i=o.getOption(75),n=o._getViewModel()?.getLineCount()*i;if(n>t.height||n<t.height&&e>cxe){let r=Math.ceil((n-t.height)/i),a=t.height+i*r;return Pr(a,cxe,Pr(s.getLayoutInfo().height-90,cxe,Vlr))}return e}' +
  'var Ulr=0,cxe=90,Vlr=450,UA=class extends Object{constructor(o,e,t,i){super();this._parentThread=i}};' +
  'var Cze=class extends Object{constructor(e,t,i,n){super();this.owner=e;this._commentThread=n;this._commentThreadDisposables=[];this._editorHeight=cxe;this._container=t}};';

function run(code) {
  const ctx = {};
  vm.runInNewContext(code + ";this.MZt=MZt;this.Cze=Cze;", ctx);
  return ctx;
}
// The input as MZt sees it: `lines` typed, laid out `height` px tall, in a thread with this contextValue.
const input = (lines, height, contextValue) => ({ getLayoutInfo: () => ({ height }), getOption: () => 18,
  _getViewModel: () => ({ getLineCount: () => lines }), _parentThread: { commentThread: { contextValue } } });
const parent = { getLayoutInfo: () => ({ height: 1000 }) };

const out = patch(STAND_IN);
check("the stand-in is patched without warnings", () => {
  assert.strictEqual(out.status, 0, out.stderr);
  assert.ok(!/::warning::/.test(out.stdout + out.stderr), out.stderr);
  assert.ok(out.stdout.includes("/*kural-small-box*/"));
});
const after = run(out.stdout);
check("Kural's box starts at 2 lines; another comment box at VS Code's 5", () => {
  assert.strictEqual(new after.Cze(0, null, 0, { contextValue: "kural-edit" })._editorHeight, 36);
  assert.strictEqual(new after.Cze(0, null, 0, { contextValue: "pr-review" })._editorHeight, 90);
  assert.strictEqual(new after.Cze(0, null, 0, undefined)._editorHeight, 90);
});
check("one typed line: Kural's box shrinks to 2 lines, others stay at 5", () => {
  assert.strictEqual(after.MZt(parent, input(1, 90, "kural-edit"), 90), 36);
  assert.strictEqual(after.MZt(parent, input(1, 90, "other"), 90), 90);
});
check("more lines: Kural's box grows with them (up to VS Code's maximum)", () => {
  assert.strictEqual(after.MZt(parent, input(4, 36, "kural-edit"), 36), 72);
  assert.strictEqual(after.MZt(parent, input(60, 72, "kural-edit"), 72), 450);
});
check("applying it twice changes nothing", () => {
  assert.strictEqual(patch(out.stdout).stdout, out.stdout);
});
check("a VS Code without that shape: a warning, the file unchanged", () => {
  const r = patch("var x=1;");   // (rebrand.py prints its warnings on stdout, before the file)
  const stdout = r.stdout.replace(/\r\n/g, "\n");   // (Python's print writes \r\n on Windows)
  assert.ok(/^::warning::.*Ctrl\+K's box stays 5 lines tall\n/.test(stdout), stdout);
  assert.strictEqual(stdout.replace(/^::warning::.*\n/gm, ""), "var x=1;");
});

const src = require("./workbench").findWorkbench();
if (!src) console.log("(real workbench file: skipped: no built workbench (set KURAL_WORKBENCH))");
else {
  const text = fs.readFileSync(src, "utf8");
  check("the patch matches the real workbench file once and stays valid JavaScript", () => {
    const r = patch(text);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!/::warning::/.test(r.stdout.slice(0, 300)), r.stdout.slice(0, 300));
    assert.ok(r.stdout.includes("/*kural-small-box*/"));
    assert.strictEqual((r.stdout.match(/kural-small-box/g) || []).length, 1);
    assert.ok(/this\._editorHeight=this\._commentThread\?\.contextValue==="kural-edit"\?36:/.test(r.stdout));
    // (An ES module: checked by node itself, without running it.)
    const tmp = path.join(require("os").tmpdir(), `kural-small-box-${process.pid}.mjs`);
    fs.writeFileSync(tmp, r.stdout);
    try { const c = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" }); assert.strictEqual(c.status, 0, c.stderr); }
    finally { fs.rmSync(tmp, { force: true }); }
  });
}

console.log(fail ? `rebrand-small-edit-box: ${fail} FAILED` : "rebrand-small-edit-box: ALL PASS");
process.exit(fail ? 1 : 0);
