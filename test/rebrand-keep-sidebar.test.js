// Maximizing the chat keeps the primary side bar (Projects, the Explorer). scripts/rebrand.py keep_sidebar_when_maximized.
//   1. on a stand-in with the shape of VS Code 1.140's setAuxiliaryBarMaximized (runs everywhere),
//   2. on a real workbench file when one is around.
const assert = require("assert");
const fs = require("fs"), path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");
const { findWorkbench } = require("./workbench");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const root = path.join(__dirname, "..");
const patch = (text) => spawnSync("python3", ["-c", `import sys\nsys.path.insert(0, ${JSON.stringify(path.join(root, "scripts"))})\nimport rebrand\n` +
  "sys.stdout.write(rebrand.keep_sidebar_when_maximized(sys.stdin.read()))"], { input: text, encoding: "utf8", maxBuffer: 1 << 28 });

// VS Code 1.140's layout, minified (only what maximizing touches).
const STAND_IN = 'var L=class{constructor(){this.v={"workbench.parts.sidebar":!0,"workbench.parts.editor":!0,"workbench.parts.panel":!0,"workbench.parts.auxiliarybar":!0};this.max=!1;this.calls=[]}' +
  'isVisible(p){return this.v[p]}isAuxiliaryBarMaximized(){return this.max}setSideBarHidden(h){this.calls.push("side:"+h);this.v["workbench.parts.sidebar"]=!h}' +
  'setPanelHidden(h){this.calls.push("panel:"+h);this.v["workbench.parts.panel"]=!h}setEditorHidden(h){this.calls.push("editor:"+h);this.v["workbench.parts.editor"]=!h}setAuxiliaryBarHidden(h){}' +
  'setAuxiliaryBarMaximized(e){if(this.inMaximizedAuxiliaryBarTransition||e===this.isAuxiliaryBarMaximized())return!1;if(e){let t={sideBarVisible:this.isVisible("workbench.parts.sidebar"),editorVisible:this.isVisible("workbench.parts.editor"),panelVisible:this.isVisible("workbench.parts.panel"),auxiliaryBarVisible:this.isVisible("workbench.parts.auxiliarybar")};this.max=!0;this.inMaximizedAuxiliaryBarTransition=!0;try{t.auxiliaryBarVisible||this.setAuxiliaryBarHidden(!1);t.sideBarVisible&&this.setSideBarHidden(!0),t.panelVisible&&this.setPanelHidden(!0),t.editorVisible&&this.setEditorHidden(!0),this.last=t}finally{this.inMaximizedAuxiliaryBarTransition=!1}}' +
  'else{let t=this.last;this.max=!1;this.setEditorHidden(!t?.editorVisible),this.setPanelHidden(!t?.panelVisible),this.setSideBarHidden(!t?.sideBarVisible)}return!0}};';

const run = (code) => { const s = {}; vm.runInNewContext(`${code};X=new L();X.setAuxiliaryBarMaximized(!0);A=X.calls.slice();V=X.v["workbench.parts.sidebar"];X.setAuxiliaryBarMaximized(!1);B=X.calls.slice(A.length);W=X.v["workbench.parts.sidebar"]`, s); return s; };

const r = patch(STAND_IN);
check("the patch applies once, with no warning", () => {
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!/::warning::/.test(r.stdout));
  assert.ok(r.stdout.includes("/*kural-keep-sidebar*/"));
});
check("before: maximizing hid the side bar (the bug)", () => {
  const s = run(STAND_IN);
  assert.deepStrictEqual(Array.from(s.A), ["side:true", "panel:true", "editor:true"]);
  assert.strictEqual(s.V, false);
});
check("after: maximizing keeps the side bar, still hides the editor and panel; un-maximizing brings them back", () => {
  const s = run(r.stdout);
  assert.deepStrictEqual(Array.from(s.A), ["panel:true", "editor:true"]);
  assert.strictEqual(s.V, true);
  assert.deepStrictEqual(Array.from(s.B), ["editor:false", "panel:false", "side:false"]);
  assert.strictEqual(s.W, true);
});
check("applying it again changes nothing", () => assert.strictEqual(patch(r.stdout).stdout, r.stdout));
check("no match: a warning, and the text unchanged", () => {
  const p = patch("var nothing=1;");
  assert.strictEqual(p.stdout.replace(/::warning::[^\n]*\n/, ""), "var nothing=1;");
  assert.match(p.stdout, /::warning::the secondary side bar's maximize/);
});

const real = findWorkbench();
if (real) {
  check("the real workbench: found exactly once, still valid JavaScript", () => {
    const text = fs.readFileSync(real, "utf8");
    const out = text.includes("/*kural-keep-sidebar*/") ? text : patch(text).stdout;
    assert.ok(!/::warning::/.test(out.slice(0, 2000)));
    assert.strictEqual((out.match(/\/\*kural-keep-sidebar\*\//g) || []).length, 1);
    const at = out.indexOf("/*kural-keep-sidebar*/");
    assert.ok(!/sideBarVisible&&this\.setSideBarHidden\(!0\)/.test(out.slice(at - 900, at + 200)));
  });
} else console.log("skip  no built workbench here");

if (fail) { console.log(`rebrand-keep-sidebar: ${fail} FAILED`); process.exit(1); }
console.log("rebrand-keep-sidebar: ALL PASS");
