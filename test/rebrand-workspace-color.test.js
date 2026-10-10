// The build patch that adds "Workspace Color..." to the activity bar's right-click menu (scripts/rebrand.py
// add_workspace_color_item). VS Code builds that menu by hand in getActivityBarContextMenuActions(), so the item is pushed
// onto its list just before the final `return s.push(...)`.
//   1. the patch on a stand-in with that function's shape: item added once, return value kept, again changes nothing,
//      and a warning (nothing changed) when the shape differs.
//   2. the patch on a real workbench file when one is around ($KURAL_WORKBENCH, an installed or built app): no warnings,
//      valid JavaScript, the item inside the function, this build's command service name.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const root = path.join(__dirname, "..");
const py = (code) => spawnSync("python3", ["-c", `import sys\nsys.path.insert(0, ${JSON.stringify(path.join(root, "scripts"))})\nimport rebrand\n${code}`], { encoding: "utf8", maxBuffer: 1 << 26 });

const STAND_IN = 'var Ie=we("commandService");class gOe{getActivityBarContextMenuActions(){const e=this.menuService.getMenuActions(T.ActivityBarPositionMenu,this.contextKeyService,{}),' +
  't=Hm(e).secondary,s=[new Rl("workbench.action.activityBar.position",d(5938,null),t)];if(1){s.push(1)}' +
  'return s.push(Ht({id:oD.ID,label:oD.getLabel(this.layoutService),run:()=>this.instantiationService.invokeFunction(o=>new oD().run(o))})),' +
  'this.part==="workbench.parts.sidebar"&&s.push(Ht({id:S4.ID})),s}};export{x as main};\n';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-rebrand-wsc-"));
const outFile = path.join(tmp, "out.txt");
const run = (text) => py(`
text = ${JSON.stringify(text)}
once = rebrand.add_workspace_color_item(text)
twice = rebrand.add_workspace_color_item(once)
open(${JSON.stringify(outFile)}, "w", encoding="utf-8").write(once)
print("SAME_TWICE" if once == twice else "CHANGED_TWICE")
`);
const out = () => fs.readFileSync(outFile, "utf8");

const r = run(STAND_IN);
check("the patch applies to the stand-in without warnings, and again changes nothing", () => {
  assert.strictEqual(r.status, 0, r.stderr); assert.ok(!/::warning::/.test(r.stdout), r.stdout); assert.ok(/SAME_TWICE/.test(r.stdout), r.stdout);
});
check("the item runs kural.workspaceColor through the command service, and the return value is kept", () => {
  const js = out();
  assert.strictEqual(js.split("/*kural-workspace-color*/").length - 1, 1);
  assert.ok(js.includes('return /*kural-workspace-color*/s.push(Ht({id:"kural.workspaceColor",label:"Workspace Color..."'), js);
  assert.ok(js.includes('kx.get(Ie).executeCommand("kural.workspaceColor")'));
  assert.ok(js.endsWith('this.part==="workbench.parts.sidebar"&&s.push(Ht({id:S4.ID})),s}};export{x as main};\n'));
});
check("another shape: a warning and the text is unchanged", () => {
  const other = STAND_IN.replace("getActivityBarContextMenuActions", "somethingElse");
  const w = run(other);
  assert.ok(/::warning::Activity bar context menu code not found/.test(w.stdout), w.stdout);
  assert.strictEqual(out(), other);
  const noService = run(STAND_IN.replace('Ie=we("commandService")', "Ie=1"));
  assert.ok(/::warning::/.test(noService.stdout), noService.stdout);
});

const rel = path.join("Contents", "Resources", "app", "out", "vs", "workbench", "workbench.desktop.main.js");
const candidates = [process.env.KURAL_WORKBENCH, path.join("/Applications/Kural.app", rel), path.join(root, "build", "mac", "Kural.app", rel)].filter(Boolean);
const src = candidates.find((f) => fs.existsSync(f));
if (!src) { console.log("(real workbench file: skipped, none here)"); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(fail ? 1 : 0); }
const patched = path.join(tmp, "patched.mjs");
const real = py(`
text = open(${JSON.stringify(src)}, encoding="utf-8").read()
once = rebrand.add_workspace_color_item(text)
twice = rebrand.add_workspace_color_item(once)
open(${JSON.stringify(patched)}, "w", encoding="utf-8").write(once)
print("SAME_TWICE" if once == twice else "CHANGED_TWICE")
`);
check("the patch runs on a real workbench file without warnings, and again changes nothing", () => {
  assert.strictEqual(real.status, 0, real.stderr); assert.ok(!/::warning::/.test(real.stdout), real.stdout); assert.ok(/SAME_TWICE/.test(real.stdout), real.stdout);
});
const js = fs.readFileSync(patched, "utf8");
check("the result is valid JavaScript", () => { const c = spawnSync(process.execPath, ["--check", patched]); assert.strictEqual(c.status, 0, String(c.stderr)); });
check("the item is there once, inside the activity bar menu function, with this build's command service", () => {
  assert.strictEqual(js.split("/*kural-workspace-color*/").length - 1, 1);
  const i = js.indexOf("/*kural-workspace-color*/"), f = js.lastIndexOf("getActivityBarContextMenuActions(){", i);
  assert.ok(f > 0 && i - f < 2500, "inside the function");
  const service = /(?<![\w$.])([\w$]+)=[\w$]+\("commandService"\)/.exec(js)[1];
  assert.ok(js.slice(i, i + 400).includes(`kx.get(${service}).executeCommand("kural.workspaceColor")`));
});
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
