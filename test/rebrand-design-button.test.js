// Design Mode's button in the browser bar (scripts/rebrand.py add_design_mode_button): one menu item before the inspect
// button's, with Kural's command, the pencil and the kural.designMode toggle; on a stand-in with VS Code 1.140's shape and on a
// real workbench file when one is around (the unpatched source build's first: build/vscode-out).
const assert = require("assert");
const fs = require("fs"), path = require("path"), os = require("os");
const { spawnSync } = require("child_process");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const root = path.join(__dirname, "..");
const patch = (text) => spawnSync("python3", ["-c", `import sys\nsys.path.insert(0, ${JSON.stringify(path.join(root, "scripts"))})\nimport rebrand\n` +
  "sys.stdout.write(rebrand.add_design_mode_button(sys.stdin.read()))"], { input: text, encoding: "utf8", maxBuffer: 1 << 28 });

// As minified in 1.140: the last action's precondition (ContextKeyExpr T), then the split button's statement.
const STAND_IN = 'var items=[];var xe={appendMenuItem:(m,i)=>items.push([m,i])};var N={BrowserActionsToolbar:"bar",BrowserChatActionsMenu:"chat"};' +
  'var L={inspect:"i",edit:"e"};var T={and:(...a)=>({and:a}),equals:(k,v)=>({k,v})};var J={enabled:"on"};function O(n,s){return s}' +
  'var o=1;var cond={when:T.and(J.enabled,o)};' +
  'xe.appendMenuItem(N.BrowserActionsToolbar,{submenu:N.BrowserChatActionsMenu,title:O(8718,"Add to Chat"),icon:L.inspect,group:"3_tools",order:1,when:J.enabled,isSplitButton:{togglePrimaryAction:!0,primaryActionIds:[]}});';

check("the stand-in: Design Mode's item goes in first, beside the inspect button, pressed with kural.designMode", () => {
  const r = patch(STAND_IN);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!/::warning::/.test(r.stdout), r.stdout.slice(0, 300));
  const items = new Function(`${r.stdout}; return items;`)();
  assert.strictEqual(items.length, 2);
  assert.deepStrictEqual(items[0], ["bar", { command: { id: "kural.browser.designMode", title: "Design Mode", icon: "e", toggled: { k: "kural.designMode", v: true } }, group: "3_tools", order: 0 }]);
  assert.strictEqual(items[1][1].submenu, "chat", "the inspect button stays");
  assert.strictEqual(patch(r.stdout).stdout, r.stdout, "applying it twice changes nothing");
});
check("a VS Code without that shape: a warning, the file unchanged", () => {
  const r = patch("var x=1;");
  const out = r.stdout.replace(/\r\n/g, "\n");
  assert.ok(/^::warning::.*no Design Mode button/m.test(out), out);
  assert.strictEqual(out.replace(/^::warning::.*\n/gm, ""), "var x=1;");
});

const unpatched = ["darwin-arm64/VSCodium.app/Contents/Resources/app", "linux-x64", "win32-x64"]
  .map((d) => path.join(root, "build", "vscode-out", d, "out", "vs", "workbench", "workbench.desktop.main.js")).find((f) => fs.existsSync(f));
const src = process.env.KURAL_WORKBENCH ? require("./workbench").findWorkbench() : unpatched || require("./workbench").findWorkbench();
const text = src && fs.readFileSync(src, "utf8");
if (!src) console.log("(real workbench file: skipped: no built workbench (set KURAL_WORKBENCH))");
else if (text.includes("/*kural-design-button*/")) {
  check("the real workbench file has the button once", () => assert.strictEqual((text.match(/kural-design-button/g) || []).length, 1));
} else {
  check("the real workbench file: matched once, the right names, still valid JavaScript", () => {
    const r = patch(text);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!/::warning::/.test(r.stdout.slice(0, 300)), r.stdout.slice(0, 300));
    assert.ok(/\/\*kural-design-button\*\/([\w$]+)\.appendMenuItem\(([\w$]+)\.BrowserActionsToolbar,\{command:\{id:"kural\.browser\.designMode",title:"Design Mode",icon:([\w$]+)\.edit,toggled:[\w$]+\.equals\("kural\.designMode",!0\)\},group:"3_tools",order:0\}\);\1\.appendMenuItem\(\2\.BrowserActionsToolbar,\{submenu:\2\.BrowserChatActionsMenu,title:[\w$]+\(\d+,"Add to Chat"\),icon:\3\.inspect/.test(r.stdout));
    const tmp = path.join(os.tmpdir(), `kural-design-button-${process.pid}.mjs`);
    fs.writeFileSync(tmp, r.stdout);
    try { const c = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" }); assert.strictEqual(c.status, 0, c.stderr); }
    finally { fs.rmSync(tmp, { force: true }); }
  });
}

console.log(fail ? `rebrand-design-button: ${fail} FAILED` : "rebrand-design-button: ALL PASS");
process.exit(fail ? 1 : 0);
