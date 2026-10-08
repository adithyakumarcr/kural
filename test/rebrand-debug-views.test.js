// VS Code's Run and Debug side bar, Debug Console and Ports panels are hidden unless the setting kural.showDebugViews is on
// (scripts/rebrand.py hide_debug_views): every view registered in those containers gets "and the setting is on" (the debug
// ones: "or you're debugging") added to its condition, and Run and Debug hides when it has nothing to show.
//   1. the patch on a tiny stand-in with VS Code's shapes, its addViews run with a stand-in condition class (runs everywhere).
//   2. the patch on a real VS Code workbench file when one is around (an installed or built Kural, or $KURAL_WORKBENCH):
//      no warnings, once and only once, valid JavaScript, and this build's addViews behaves the same.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const root = path.join(__dirname, "..");
const py = (code) => spawnSync("python3", ["-c", `import sys\nsys.path.insert(0, ${JSON.stringify(path.join(root, "scripts"))})\nimport rebrand\n${code}`], { encoding: "utf8", maxBuffer: 1 << 26 });
const plain = (o) => JSON.parse(JSON.stringify(o));

const STAND_IN = 'var y=class{static has(k){return{has:k}}static or(...a){return{or:a}}static and(...a){return{and:a}}static regex(){return{}}};' +
  'var kb={when:y.regex("neverMatch",/doesNotMatch/)};var D="workbench.view.debug",P="workbench.panel.repl",T="~remote.forwardedPortsContainer";' +
  'class Reg{constructor(){this._views=new Map,this._viewContainers=[]}getView(){return null}addViews(i,e){let t=this._views.get(e);t||(t=[],this._views.set(e,t),this._viewContainers.push(e));for(const s of i)t.push(s)}}' +
  'function R(n,s){return s}var reg={registerViewContainer(c){return c}};' +
  'var pse=reg.registerViewContainer({id:D,title:R(14567,"Run and Debug"),openCommandActionDescriptor:{id:D},order:3},0);';

const SHOW = { has: "config.kural.showDebugViews" }, DEBUGGING = { or: [SHOW, { has: "inDebugMode" }] };

// Runs a patched addViews (the method's text) with the stand-in condition class `cls`.
function registry(method, cls) {
  const sandbox = { result: null };
  vm.runInNewContext(`var ${cls}=class{static has(k){return{has:k}}static or(...a){return{or:a}}static and(...a){return{and:a}}};` +
    `class Reg{constructor(){this._views=new Map,this._viewContainers=[]}getView(){return null}${method}}result=new Reg();`, sandbox);
  return sandbox.result;
}

async function behaves(reg) {
  const debug = { id: "workbench.view.debug" }, repl = { id: "workbench.panel.repl" }, ports = { id: "~remote.forwardedPortsContainer" }, other = { id: "workbench.view.explorer" };
  const variables = { id: "variables", when: { isEqualTo: "default" } }, consoleView = { id: "repl" }, portsView = { id: "ports" }, files = { id: "files", when: { k: 1 } };
  reg.addViews([variables], debug); reg.addViews([consoleView], repl); reg.addViews([portsView], ports); reg.addViews([files], other);
  await check("  a debug view: its own condition, and (the setting or debugging)", () => assert.deepStrictEqual(plain(variables.when), { and: [{ isEqualTo: "default" }, DEBUGGING] }));
  await check("  the Debug Console: the setting or debugging", () => assert.deepStrictEqual(plain(consoleView.when), DEBUGGING));
  await check("  Ports: only the setting", () => assert.deepStrictEqual(plain(portsView.when), SHOW));
  await check("  views elsewhere are left alone", () => assert.deepStrictEqual(files.when, { k: 1 }));
  await check("  a view moved back into Run and Debug isn't wrapped twice", () => {
    reg.addViews([variables], debug);
    assert.deepStrictEqual(plain(variables.when), { and: [{ isEqualTo: "default" }, DEBUGGING] });
  });
  await check("  a frozen view still registers (just unchanged), and the views after it are still changed", () => {
    const frozen = Object.freeze({ id: "frozen", when: { k: 2 } }), next = { id: "next" };
    reg.addViews([frozen, next], debug);
    assert.ok(reg._views.get(debug).includes(frozen)); assert.deepStrictEqual(frozen.when, { k: 2 });
    assert.deepStrictEqual(plain(next.when), DEBUGGING);
  });
}

(async () => {
  // ---------- 1. the stand-in ----------
  const r = py(`
text = ${JSON.stringify(STAND_IN)}
once = rebrand.hide_debug_views(text)
twice = rebrand.hide_debug_views(once)
print(once)
print("SAME_TWICE" if once == twice else "CHANGED_TWICE")
`);
  await check("the patch applies to VS Code's shapes without warnings, and again changes nothing", () => {
    assert.strictEqual(r.status, 0, r.stderr); assert.ok(!/::warning::/.test(r.stdout), r.stdout); assert.ok(/SAME_TWICE/.test(r.stdout), r.stdout);
  });
  const patched = r.stdout.slice(0, r.stdout.lastIndexOf("SAME_TWICE"));
  await check("Run and Debug hides when it has nothing to show (hideIfEmpty)", () => {
    const sandbox = {}; vm.runInNewContext(patched + "this.pse=pse;", sandbox);
    assert.strictEqual(sandbox.pse.hideIfEmpty, true);
  });
  await check("a VSCodium whose code is different: a warning, nothing changed", () => {
    const other = STAND_IN.replace('"Run and Debug"', '"Run"');
    const w = py(`print(rebrand.hide_debug_views(${JSON.stringify(other)}) == ${JSON.stringify(other)})`);
    assert.ok(/::warning::.*Run and Debug, Debug Console and Ports stay/.test(w.stdout) && /True/.test(w.stdout), w.stdout);
  });
  console.log("the stand-in's addViews:");
  const standIn = patched.slice(patched.indexOf("addViews("), patched.indexOf("}}", patched.indexOf("for(const s of i)t.push(s)")) + 1);
  await behaves(registry(standIn, "y"));

  // ---------- 2. a real workbench file ----------
  const rel = path.join("Contents", "Resources", "app", "out", "vs", "workbench", "workbench.desktop.main.js");
  const candidates = [process.env.KURAL_WORKBENCH, path.join("/Applications/Kural.app", rel), path.join(root, "kural", "build", "mac", "dmg", "Kural.app", rel),
    path.join(root, "build", "mac", "Kural.app", rel)].filter(Boolean);
  const src = candidates.find((f) => fs.existsSync(f));
  if (!src) { console.log("(real workbench file: skipped, none here)"); process.exit(fail ? 1 : 0); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-rebrand-debug-"));
  const out = path.join(tmp, "patched.js");
  const real = py(`
text = open(${JSON.stringify(src)}, encoding="utf-8").read()
once = rebrand.hide_debug_views(text)
twice = rebrand.hide_debug_views(once)
open(${JSON.stringify(out)}, "w", encoding="utf-8").write(once)
m = rebrand.NEVER.search(once)
print("CLASS=" + m.group(1))
print("SAME_TWICE" if once == twice else "CHANGED_TWICE")
`);
  await check("the patch runs on a real workbench file without warnings, and again changes nothing", () => {
    assert.strictEqual(real.status, 0, real.stderr); assert.ok(!/::warning::/.test(real.stdout), real.stdout); assert.ok(/SAME_TWICE/.test(real.stdout), real.stdout);
  });
  const js = fs.readFileSync(out, "utf8");
  await check("the result is valid JavaScript", () => { const c = spawnSync(process.execPath, ["--check", out]); assert.strictEqual(c.status, 0, String(c.stderr)); });
  await check("each part is there once: the views' conditions, Run and Debug's hideIfEmpty", () => {
    assert.strictEqual(js.split("/*kural-debug-views*/").length - 1, 1);
    assert.ok(/registerViewContainer\(\{hideIfEmpty:!0,id:[\w$]+,title:[\w$]+\(\d+,"Run and Debug"\)/.test(js));
    assert.strictEqual(js.split('"Run and Debug"),openCommandActionDescriptor').length - 1, 1);
  });
  // This build's own addViews, up to the next method (removeViews), run with a stand-in condition class.
  const i = js.indexOf("addViews(", js.indexOf("/*kural-debug-views*/") - 40), j = js.indexOf("removeViews(", i);
  await check("this build's addViews is followed by removeViews (where the method ends)", () => assert.ok(i > 0 && j > i && j - i < 2000, `${i} ${j}`));
  console.log("this build's addViews:");
  await behaves(registry(js.slice(i, j), /CLASS=(\S+)/.exec(real.stdout)[1]));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `rebrand-debug-views: ${fail} FAILED` : "rebrand-debug-views: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
