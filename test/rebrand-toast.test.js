// The build patch that gives Kural notifications from the system (scripts/rebrand.py add_os_toast): the command
// `_kural.osToast` shows VS Code's own native toast (an Electron notification from Kural's main process, so it says Kural)
// and `_kural.osToastClear` withdraws it.
//   1. the patch on a tiny stand-in with VS Code's shapes, and the added code run with stand-ins for the command registry
//      and the host service (runs everywhere, also in CI): click, buttons, timeout, same id, clear, attention, unsupported.
//   2. the patch on a real VS Code workbench file when one is around (an installed or built Kural, or $KURAL_WORKBENCH):
//      no warnings, once and only once, valid JavaScript, placed at the top level before the file's export.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const root = path.join(__dirname, "..");
const py = (code) => spawnSync("python3", ["-c", `import sys\nsys.path.insert(0, ${JSON.stringify(path.join(root, "scripts"))})\nimport rebrand\n${code}`], { encoding: "utf8", maxBuffer: 1 << 26 });
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
// (objects made inside the vm have its own prototypes: compare their plain data; undefined values aren't sent either)
const plain = (o) => JSON.parse(JSON.stringify(o));

const STAND_IN = 'var Ie=we("commandService"),$e=new class{constructor(){this._commands=new Map,this._onDidRegisterCommand=new A}};' +
  'var Qi=we("hostService"),as=vg;class S{async showToast(e,t){const s=bt(),n=t.onCancellationRequested(()=>this.nativeHostService.clearToast(s));}}' +
  'Gt(izn,[[]],!0));export{For as main};/*! @license */\n//# sourceMappingURL=x.map\n';

// The added code, run with stand-ins: `$e` the command registry, `Qi` the host service's id.
function load(snippet) {
  const commands = {}, calls = [];
  let focused = true;
  const host = {
    toasts: [],
    focus: async (w, o) => { calls.push(["focus", o.mode]); },
    showToast(opts, token) {
      calls.push(["show", opts]);
      return new Promise((resolve) => {
        const t = { opts, token, resolve };
        host.toasts.push(t);
        token.onCancellationRequested(() => { calls.push(["cleared", opts.title]); resolve({ supported: true, clicked: false }); });
      });
    },
  };
  const sandbox = { setTimeout, clearTimeout, document: { hasFocus: () => focused },
    $e: { registerCommand: (id, fn) => { commands[id] = fn; } }, Qi: "hostService" };
  vm.runInNewContext(snippet, sandbox);
  const run = (id, arg) => commands[id]({ get: (k) => { assert.strictEqual(k, "hostService"); return host; } }, arg);
  return { commands, calls, host, run, setFocused: (f) => { focused = f; } };
}

(async () => {
  // ---------- 1. the stand-in ----------
  const r = py(`
text = ${JSON.stringify(STAND_IN)}
once = rebrand.add_os_toast(text)
twice = rebrand.add_os_toast(once)
print(once)
print("SAME_TWICE" if once == twice else "CHANGED_TWICE")
`);
  await check("the patch applies to VS Code's shapes without warnings, and again changes nothing", () => {
    assert.strictEqual(r.status, 0, r.stderr); assert.ok(!/::warning::/.test(r.stdout), r.stdout); assert.ok(/SAME_TWICE/.test(r.stdout), r.stdout);
  });
  const patched = r.stdout.slice(0, r.stdout.lastIndexOf("SAME_TWICE"));
  const start = patched.indexOf("/*kural-toast*/"), end = patched.indexOf("export{For as main}");
  await check("the code goes at the top level, right before the file's export", () => {
    assert.ok(start > 0 && end > start, patched);
    assert.ok(patched.slice(0, start).endsWith("Gt(izn,[[]],!0));"));
    assert.ok(/\$e\.registerCommand\("_kural\.osToast"/.test(patched) && /a\.get\(Qi\)/.test(patched));
  });
  const snippet = patched.slice(start, end);
  await check("a VSCodium whose code is different: a warning, nothing changed", () => {
    const w = py(`print(rebrand.add_os_toast(${JSON.stringify(STAND_IN.replace('("hostService")', '("otherService")'))}) == ${JSON.stringify(STAND_IN.replace('("hostService")', '("otherService")'))})`);
    assert.ok(/::warning::.*notification/.test(w.stdout) && /True/.test(w.stdout), w.stdout);
  });

  await check("both commands are registered", () => { assert.deepStrictEqual(Object.keys(load(snippet).commands).sort(), ["_kural.osToast", "_kural.osToastClear"]); });
  await check("a click: {clicked: true}, and the window comes to the front", async () => {
    const t = load(snippet);
    const p = t.run("_kural.osToast", { title: "Answer ready", body: "Kural finished in Fix tests" });
    await tick();
    assert.deepStrictEqual(plain(t.host.toasts[0].opts), { title: "Answer ready", body: "Kural finished in Fix tests", silent: false });
    t.host.toasts[0].resolve({ supported: true, clicked: true });
    assert.deepStrictEqual(plain(await p), { clicked: true, supported: true });
    assert.deepStrictEqual(t.calls.filter((c) => c[0] === "focus"), [["focus", 2]]);
  });
  await check("focus: false leaves the window where it is", async () => {
    const t = load(snippet);
    const p = t.run("_kural.osToast", { title: "x", focus: false });
    await tick(); t.host.toasts[0].resolve({ supported: true, clicked: true });
    assert.strictEqual((await p).clicked, true);
    assert.deepStrictEqual(t.calls.filter((c) => c[0] === "focus"), []);
  });
  await check("a button: clicked with its index; the buttons' texts are passed on", async () => {
    const t = load(snippet);
    const p = t.run("_kural.osToast", { title: "Allow?", actions: ["Allow", "Open"] });
    await tick();
    assert.deepStrictEqual(plain(t.host.toasts[0].opts.actions), ["Allow", "Open"]);
    t.host.toasts[0].resolve({ supported: true, clicked: true, actionIndex: 1 });
    assert.deepStrictEqual(plain(await p), { clicked: true, actionIndex: 1, supported: true });
  });
  await check("closed without a click: {clicked: false}, the window isn't touched", async () => {
    const t = load(snippet);
    const p = t.run("_kural.osToast", { title: "x" });
    await tick(); t.host.toasts[0].resolve({ supported: true, clicked: false });
    assert.deepStrictEqual(plain(await p), { clicked: false, supported: true });
    assert.deepStrictEqual(t.calls.filter((c) => c[0] === "focus"), []);
  });
  await check("timeout: the toast is withdrawn and the call ends with {clicked: false}", async () => {
    const t = load(snippet);
    const p = t.run("_kural.osToast", { title: "x", timeout: 30 });
    assert.strictEqual((await p).clicked, false);
    assert.ok(t.calls.some((c) => c[0] === "cleared"));
  });
  await check("the same id replaces the toast before it (the old call ends unclicked)", async () => {
    const t = load(snippet);
    const first = t.run("_kural.osToast", { id: "chat-1", title: "first" });
    await tick();
    const second = t.run("_kural.osToast", { id: "chat-1", title: "second" });
    assert.strictEqual((await first).clicked, false);
    await tick(); t.host.toasts[1].resolve({ supported: true, clicked: true });
    assert.strictEqual((await second).clicked, true);
    assert.deepStrictEqual(t.calls.filter((c) => c[0] === "cleared"), [["cleared", "first"]]);
  });
  await check("_kural.osToastClear withdraws one by id, or all of them; counts them", async () => {
    const t = load(snippet);
    const a = t.run("_kural.osToast", { id: "a", title: "a" }), b = t.run("_kural.osToast", { id: "b", title: "b" }), c = t.run("_kural.osToast", { title: "c" });
    await tick();
    assert.strictEqual(t.run("_kural.osToastClear", { id: "a" }), 1);
    assert.strictEqual((await a).clicked, false);
    assert.strictEqual(t.run("_kural.osToastClear", { id: "nope" }), 0);
    assert.strictEqual(t.run("_kural.osToastClear"), 2);
    assert.deepStrictEqual([(await b).clicked, (await c).clicked], [false, false]);
    assert.strictEqual(t.run("_kural.osToastClear"), 0);
  });
  await check("attention: the Dock icon bounces / the taskbar flashes first, only when the window isn't focused", async () => {
    const t = load(snippet);
    t.setFocused(false);
    const p = t.run("_kural.osToast", { title: "x", attention: true });
    await tick(); t.host.toasts[0].resolve({ supported: true, clicked: false }); await p;
    assert.deepStrictEqual(t.calls.map((c) => c[0] === "show" ? "show" : c.join(" ")), ["focus 1", "show"]);
    const u = load(snippet);
    const q = u.run("_kural.osToast", { title: "x", attention: true });
    await tick(); u.host.toasts[0].resolve({ supported: true, clicked: false }); await q;
    assert.deepStrictEqual(u.calls.map((c) => c[0]), ["show"]);
  });
  await check("no notifications on this system: {supported: false}; no title: \"Kural\"", async () => {
    const t = load(snippet);
    const p = t.run("_kural.osToast", {});
    await tick();
    assert.strictEqual(t.host.toasts[0].opts.title, "Kural");
    t.host.toasts[0].resolve({ supported: false, clicked: false });
    assert.deepStrictEqual(plain(await p), { clicked: false, supported: false });
  });

  // ---------- 2. a real workbench file ----------
  const rel = path.join("Contents", "Resources", "app", "out", "vs", "workbench", "workbench.desktop.main.js");
  const candidates = [process.env.KURAL_WORKBENCH, path.join("/Applications/Kural.app", rel), path.join(root, "kural", "build", "mac", "dmg", "Kural.app", rel),
    path.join(root, "build", "mac", "Kural.app", rel)].filter(Boolean);
  const src = candidates.find((f) => fs.existsSync(f));
  if (!src) { console.log("(real workbench file: skipped, none here)"); process.exit(fail ? 1 : 0); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-rebrand-toast-"));
  const out = path.join(tmp, "patched.js");
  const real = py(`
text = open(${JSON.stringify(src)}, encoding="utf-8").read()
once = rebrand.add_os_toast(text)
twice = rebrand.add_os_toast(once)
open(${JSON.stringify(out)}, "w", encoding="utf-8").write(once)
print("SAME_TWICE" if once == twice else "CHANGED_TWICE")
`);
  await check("the patch runs on a real workbench file without warnings, and again changes nothing", () => {
    assert.strictEqual(real.status, 0, real.stderr); assert.ok(!/::warning::/.test(real.stdout), real.stdout); assert.ok(/SAME_TWICE/.test(real.stdout), real.stdout);
  });
  const js = fs.readFileSync(out, "utf8");
  await check("the result is valid JavaScript", () => { const c = spawnSync(process.execPath, ["--check", out]); assert.strictEqual(c.status, 0, String(c.stderr)); });
  await check("the code is there once, before the export, with this build's registry and host service names", () => {
    assert.strictEqual(js.split("/*kural-toast*/").length - 1, 1);
    const i = js.indexOf("/*kural-toast*/");
    assert.ok(/;$/.test(js.slice(0, i)) && /^\/\*kural-toast\*\/\(\(\)=>\{[\s\S]*\}\)\(\);export\{[\w$]+ as main\}/.test(js.slice(i, js.indexOf(" as main}") + 9)));
    const registry = /([\w$]+)=new class\{constructor\(\)\{this\._commands=new Map,this\._onDidRegisterCommand=/.exec(js)[1];
    const hostId = /(?<![\w$.])([\w$]+)=[\w$]+\("hostService"\)/.exec(js)[1];
    assert.ok(js.includes(`${registry}.registerCommand("_kural.osToast"`) && js.includes(`a.get(${hostId})`));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `rebrand-toast: ${fail} FAILED` : "rebrand-toast: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
