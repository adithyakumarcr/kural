// Extensions | Plugins | Connectors (scripts/rebrand.py add_plugins_tab): VS Code's Extensions side bar gets two more
// tabs, Kural's Plugins view (extension/lib/plugins) and Connectors view (extension/lib/connectors).
//   1. the patch on a tiny stand-in with VS Code's shapes, run with a small fake DOM: the switch above the search box,
//      VS Code's own views hidden on Plugins (and Kural's view given the side bar's title), the heights layout() leaves,
//      Refresh, the command _kural.extensionsTabs (also before the side bar exists), the choice kept, nothing twice.
//   2. a VSCodium whose code is different: a warning, nothing changed.
//   3. the whole patch_workbench on a stand-in app folder (after hide_debug_views, which shares addViews), and
//      rebrand_messages naming the side bar "Extensions & Plugins".
//   4. the patch on a real VS Code workbench file when one is around: no warnings, once, valid JavaScript.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.stack); } };
const root = path.join(__dirname, "..");
const py = (code) => spawnSync("python3", ["-c", `import sys\nsys.path.insert(0, ${JSON.stringify(path.join(root, "scripts"))})\nimport rebrand\n${code}`], { encoding: "utf8", maxBuffer: 1 << 26 });

// VS Code's shapes (1.140's minified build: ";" between statements, "let").
const STAND_IN = 'var T=class{static has(k){return{has:k}}static notEquals(k,v){return{notEquals:[k,v]}}static and(...a){return{and:a}}static or(...a){return{or:a}}static regex(){return{}}};' +
  'var kb={when:T.regex("neverMatch",/doesNotMatch/)};' +
  'var CR=new class{constructor(){this._commands=new Map;this._onDidRegisterCommand=null}registerCommand(id,f){this._commands.set(id,f)}};' +
  'class EP{constructor(){this.viewContainersRegistry={get:(id)=>({id})}}getViewContainer(o){switch(o){case"explorer":return this.viewContainersRegistry.get("workbench.view.explorer");' +
  'case"debug":return this.viewContainersRegistry.get("workbench.view.debug");default:return this.viewContainersRegistry.get(`workbench.view.extension.${o}`)}}}' +
  'class Reg{constructor(){this._views=new Map,this._viewContainers=[]}getView(){return null}addViews(i,e){let t=this._views.get(e);t||(t=[],this._views.set(e,t),this._viewContainers.push(e));for(const s of i)t.push(s)}}' +
  'var R=(n,s)=>s,D="workbench.view.debug",P="workbench.panel.repl",Q="~remote.forwardedPortsContainer",reg={registerViewContainer(c){return c}};' +
  'var pse=reg.registerViewContainer({id:D,title:R(14567,"Run and Debug"),openCommandActionDescriptor:{id:D},order:3},0);' +
  'var uf="workbench.view.extensions",HIi=reg.registerViewContainer({id:uf,title:R(3,"Extensions"),openCommandActionDescriptor:{id:uf},order:4},0);' +
  'class Ai{constructor(w,h){this.width=w;this.height=h}}class Pd{layout(d){this.laidOut=d}}' +
  'class JYe extends Pd{constructor(m){super();this.searchViewletState=m||{};this.refreshed=0;' +
  'this.contextKeyService={keys:{},createKey(k,v){const s=this.keys;s[k]=v;return{set:(x)=>{s[k]=x}}}};this.commandService={ran:[],executeCommand(id){this.ran.push(id)}}}' +
  'create(e){e.classList.add("extensions-viewlet");this.root=e;this.header=e.ownerDocument.createElement("div");this.header.className="header";e.append(this.header)}' +
  'layout(e){this._dimension=e;let t=41,i=t;this.header.style.height=`${i}px`,super.layout(new Ai(e.width,e.height-i))}' +
  'async refresh(){await this.updateInstalledExtensionsContexts(),this.refreshed++}async updateInstalledExtensionsContexts(){}}' +
  ';export{JYe as main}';

// A small DOM: what the patch's code uses (createElement, classList, attributes, listeners, a <style> in <head>).
function makeDocument() {
  class El {
    constructor(tag, doc) { Object.assign(this, { tagName: tag, ownerDocument: doc, children: [], attrs: {}, dataset: {}, style: {}, listeners: {}, textContent: "", id: "" }); this._cls = new Set(); }
    get className() { return [...this._cls].join(" "); }
    set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get classList() { const c = this._cls; return { add: (...x) => x.forEach((y) => c.add(y)), remove: (...x) => x.forEach((y) => c.delete(y)), contains: (x) => c.has(x), toggle: (x, on) => { if (on === undefined ? !c.has(x) : on) c.add(x); else c.delete(x); } }; }
    append(...kids) { for (const k of kids) { this.children.push(k); if (k && typeof k === "object") k.parentNode = this; } }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k]; }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    dispatch(t, ev = {}) { for (const f of this.listeners[t] || []) f({ preventDefault() {}, ...ev }); }
    click() { this.dispatch("click"); }
    focus() { this.ownerDocument.activeElement = this; }
    get offsetHeight() { return this._cls.has("kural-ext-tabs") ? 34 : 0; }
  }
  const doc = { createElement: (t) => new El(t, doc), createTextNode: (s) => ({ text: s }), activeElement: null,
    defaultView: { getComputedStyle: () => ({ paddingLeft: "8px", paddingRight: "8px" }) } };
  doc.head = new El("head", doc);
  doc.getElementById = (id) => doc.head.children.find((c) => c.id === id) || null;
  return doc;
}

// The patched stand-in, run: its classes, the command registry and the fake document.
function load(text) {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(text.replace(/;?export\{[\w$]+ as main\}/, ";") + ";this.T=T;this.CR=CR;this.EP=EP;this.Reg=Reg;this.JYe=JYe;this.Ai=Ai;this.HIi=HIi;", ctx);
  return ctx;
}
const plain = (o) => JSON.parse(JSON.stringify(o));
const HIDE = { and: [{ notEquals: ["kural.extensionsTab", "plugins"] }, { notEquals: ["kural.extensionsTab", "connectors"] }] };
const TABS = ["extensions", "plugins", "connectors"];

(async () => {
  // ---------- 1. the stand-in ----------
  const r = py(`
text = ${JSON.stringify(STAND_IN)}
once = rebrand.add_plugins_tab(text)
twice = rebrand.add_plugins_tab(once)
print(once)
print("SAME_TWICE" if once == twice else "CHANGED_TWICE")
`);
  await check("the patch applies to VS Code's shapes without warnings, and again changes nothing", () => {
    assert.strictEqual(r.status, 0, r.stderr); assert.ok(!/::warning::/.test(r.stdout), r.stdout); assert.ok(/SAME_TWICE/.test(r.stdout), r.stdout.slice(-300));
  });
  const patched = r.stdout.slice(0, r.stdout.lastIndexOf("SAME_TWICE"));
  const ctx = load(patched), doc = makeDocument();

  await check("an extension may add views to the Extensions side bar (and the others work as before)", () => {
    const ep = new ctx.EP();
    assert.deepStrictEqual(plain(ep.getViewContainer("extensions")), { id: "workbench.view.extensions" });
    assert.deepStrictEqual(plain(ep.getViewContainer("explorer")), { id: "workbench.view.explorer" });
    assert.deepStrictEqual(plain(ep.getViewContainer("mine")), { id: "workbench.view.extension.mine" });
  });
  await check("VS Code's views there hide on Plugins; Kural's view gets the side bar's title; elsewhere nothing changes; never twice", () => {
    const reg = new ctx.Reg(), ext = { id: "workbench.view.extensions", title: { value: "Extensions & Plugins", original: "Extensions" } };
    const installed = { id: "workbench.views.extensions.installed", when: { k: 1 } }, popular = { id: "workbench.views.extensions.popular" };
    const kural = { id: "kural.plugins", when: { mine: 1 } }, files = { id: "files", when: { k: 2 } }, conn = { id: "kural.connectors", when: { c: 1 } };
    reg.addViews([installed, popular, kural, conn], ext);
    assert.deepStrictEqual(conn.when, { c: 1 }); assert.strictEqual(conn.singleViewPaneContainerTitle, "Extensions & Plugins"); reg.addViews([files], { id: "workbench.view.explorer" });
    assert.deepStrictEqual(plain(installed.when), { and: [{ k: 1 }, HIDE] });
    assert.deepStrictEqual(plain(popular.when), HIDE);
    assert.deepStrictEqual(kural.when, { mine: 1 }); assert.strictEqual(kural.singleViewPaneContainerTitle, "Extensions & Plugins");
    assert.deepStrictEqual(files.when, { k: 2 });
    reg.addViews([installed], ext);
    assert.deepStrictEqual(plain(installed.when), { and: [{ k: 1 }, HIDE] });
  });

  await check("the command switches a side bar that doesn't exist yet: it opens on Plugins", () => {
    const res = ctx.CR._commands.get("_kural.extensionsTabs")(null, "plugins");
    assert.deepStrictEqual(plain(res), { tab: "plugins", tabs: TABS });
    const v = new ctx.JYe(), el = doc.createElement("div");
    v.create(el);
    assert.strictEqual(v.contextKeyService.keys["kural.extensionsTab"], "plugins");
    assert.ok(el.classList.contains("kural-plugins-on"));
    v.__kuralSet("extensions", false);
  });

  const view = new ctx.JYe(), el = doc.createElement("div");
  view.create(el);
  const bar = el.children[0], seg = bar.children[0], [be, bp, bc] = seg.children;
  await check("the switch comes first, above the search box: Extensions | Plugins | Connectors, Extensions chosen", () => {
    assert.strictEqual(bar.className, "kural-ext-tabs"); assert.strictEqual(seg.attrs.role, "tablist");
    assert.deepStrictEqual([be.dataset.tab, bp.dataset.tab, bc.dataset.tab], TABS);
    assert.deepStrictEqual([be.children[1].textContent, bp.children[1].textContent, bc.children[1].textContent], ["Extensions", "Plugins", "Connectors"]);
    assert.strictEqual(el.children[1].className, "header");
    assert.ok(be.classList.contains("on") && !bp.classList.contains("on"));
    assert.strictEqual(view.contextKeyService.keys["kural.extensionsTab"], "extensions");
    assert.ok(el.classList.contains("kural-tabs") && el.classList.contains("extensions-viewlet"));
  });
  await check("its style is added once, however many side bars there are (each window, each reload)", () => {
    assert.strictEqual(doc.head.children.filter((c) => c.id === "kural-ext-tabs-css").length, 1);
    assert.match(doc.head.children[0].textContent, /\.extensions-viewlet\.kural-plugins-on>\.header\{display:none\}/);
  });
  await check("layout: the views get the height minus the search box (41) and the switch (34); the switch lines up with the search box", () => {
    view.layout(new ctx.Ai(300, 800));
    assert.strictEqual(view.laidOut.height, 800 - 41 - 34);
    assert.deepStrictEqual([bar.style.paddingLeft, bar.style.paddingRight], ["8px", "8px"]);
  });
  await check("Plugins: VS Code's views hide (context key), the search box with them (no height), Kural's view gets the focus; kept", () => {
    bp.click();
    assert.strictEqual(view.contextKeyService.keys["kural.extensionsTab"], "plugins");
    assert.ok(el.classList.contains("kural-plugins-on") && bp.classList.contains("on") && !be.classList.contains("on"));
    assert.strictEqual(bp.attrs["aria-selected"], "true");
    assert.strictEqual(view.laidOut.height, 800 - 34);
    assert.deepStrictEqual(plain(view.commandService.ran), ["kural.plugins.focus"]);
    assert.strictEqual(view.searchViewletState["kural.tab"], "plugins");
  });
  await check("the title bar's Refresh refreshes the plugins on Plugins, the extensions on Extensions", async () => {
    await view.refresh();
    assert.strictEqual(view.refreshed, 0); assert.strictEqual(view.commandService.ran.slice(-1)[0], "kural.plugins.refresh");
    be.click(); await view.refresh();
    assert.strictEqual(view.refreshed, 1); assert.strictEqual(view.laidOut.height, 800 - 41 - 34);
  });
  await check("Connectors: like Plugins (VS Code's views and the search box hide, its view gets the focus, Refresh is its own)", async () => {
    bc.click();
    assert.strictEqual(view.contextKeyService.keys["kural.extensionsTab"], "connectors");
    assert.ok(el.classList.contains("kural-plugins-on") && bc.classList.contains("on") && !bp.classList.contains("on"));
    assert.strictEqual(view.laidOut.height, 800 - 34);
    assert.strictEqual(view.commandService.ran.slice(-1)[0], "kural.connectors.focus");
    await view.refresh();
    assert.strictEqual(view.commandService.ran.slice(-1)[0], "kural.connectors.refresh"); assert.strictEqual(view.refreshed, 1);
    be.click();
  });
  await check("the arrow keys switch too (round the three)", () => {
    seg.dispatch("keydown", { key: "ArrowRight" });
    assert.strictEqual(view.contextKeyService.keys["kural.extensionsTab"], "plugins"); assert.strictEqual(doc.activeElement, bp);
    seg.dispatch("keydown", { key: "ArrowRight" });
    assert.strictEqual(view.contextKeyService.keys["kural.extensionsTab"], "connectors"); assert.strictEqual(doc.activeElement, bc);
    seg.dispatch("keydown", { key: "ArrowRight" });
    assert.strictEqual(view.contextKeyService.keys["kural.extensionsTab"], "extensions");
    seg.dispatch("keydown", { key: "ArrowLeft" });
    assert.strictEqual(view.contextKeyService.keys["kural.extensionsTab"], "connectors");
    seg.dispatch("keydown", { key: "ArrowRight" });
    assert.strictEqual(view.contextKeyService.keys["kural.extensionsTab"], "extensions");
  });
  await check("the command: switches the open side bar and says which tab shows", () => {
    const cmd = ctx.CR._commands.get("_kural.extensionsTabs");
    assert.deepStrictEqual(plain(cmd(null, "plugins")), { tab: "plugins", tabs: TABS });
    assert.ok(el.classList.contains("kural-plugins-on"));
    assert.deepStrictEqual(plain(cmd(null)), { tab: "plugins", tabs: TABS });
    assert.deepStrictEqual(plain(cmd(null, "connectors")), { tab: "connectors", tabs: TABS });
    cmd(null, "extensions");
    assert.strictEqual(view.contextKeyService.keys["kural.extensionsTab"], "extensions");
  });
  await check("the choice is kept: a side bar made again (another start) opens where you left it", () => {
    const again = new ctx.JYe({ "kural.tab": "plugins" }), el2 = doc.createElement("div");
    again.create(el2);
    assert.strictEqual(again.contextKeyService.keys["kural.extensionsTab"], "plugins");
    assert.strictEqual(doc.head.children.filter((c) => c.id === "kural-ext-tabs-css").length, 1);
  });

  // ---------- 2. another VSCodium ----------
  await check("a VSCodium whose code is different: a warning naming what's missing, nothing changed", () => {
    const other = STAND_IN.replace("async refresh(){await this.updateInstalledExtensionsContexts()", "async refresh(){await this.reload()");
    const w = py(`print(rebrand.add_plugins_tab(${JSON.stringify(other)}) == ${JSON.stringify(other)})`);
    assert.ok(/::warning::.*no Plugins tab there.*side bar refresh missing/.test(w.stdout) && /True/.test(w.stdout), w.stdout);
  });

  // ---------- 3. patch_workbench and the title ----------
  const app = fs.mkdtempSync(path.join(os.tmpdir(), "kural-plugins-tab-"));
  const rel = path.join("out", "vs", "workbench", "workbench.desktop.main.js");
  fs.mkdirSync(path.dirname(path.join(app, rel)), { recursive: true });
  fs.writeFileSync(path.join(app, rel), STAND_IN);
  const sum = crypto.createHash("sha256").update(STAND_IN).digest("base64").replace(/=+$/, "");
  fs.writeFileSync(path.join(app, "product.json"), JSON.stringify({ checksums: { "vs/workbench/workbench.desktop.main.js": sum } }));
  fs.writeFileSync(path.join(app, "out", "nls.messages.json"), JSON.stringify(["a", "b", "c", "Extensions", "e"]));
  const all = py(`rebrand.patch_workbench(${JSON.stringify(app)}); rebrand.rebrand_messages(${JSON.stringify(app)})`);
  const js = fs.readFileSync(path.join(app, rel), "utf8");
  await check("patch_workbench: Run and Debug's rule and the Plugins rule both in addViews (debug's first), the fingerprint updated", () => {
    assert.strictEqual(all.status, 0, all.stderr);
    assert.ok(/addViews\(i,e\)\{\/\*kural-debug-views\*\/.*\/\*kural-plugins-tab\*\/try\{const _kx.*let t=this\._views\.get\(e\);/.test(js), js.slice(js.indexOf("addViews"), js.indexOf("addViews") + 200));
    const sums = JSON.parse(fs.readFileSync(path.join(app, "product.json"), "utf8")).checksums;
    assert.strictEqual(sums["vs/workbench/workbench.desktop.main.js"], crypto.createHash("sha256").update(js).digest("base64").replace(/=+$/, ""));
  });
  await check("the side bar is called Extensions & Plugins (its own message only)", () => {
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(app, "out", "nls.messages.json"), "utf8")), ["a", "b", "c", "Extensions & Plugins", "e"]);
  });
  await check("without the Plugins tab, the title stays Extensions", () => {
    fs.writeFileSync(path.join(app, rel), STAND_IN);
    fs.writeFileSync(path.join(app, "out", "nls.messages.json"), JSON.stringify(["a", "b", "c", "Extensions", "e"]));
    py(`rebrand.rebrand_messages(${JSON.stringify(app)})`);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(app, "out", "nls.messages.json"), "utf8"))[3], "Extensions");
  });
  fs.rmSync(app, { recursive: true, force: true });

  // ---------- 4. a real workbench file ----------
  const src = require("./workbench").findWorkbench();
  if (!src) { console.log("(real workbench file: skipped: no built workbench (set KURAL_WORKBENCH))"); process.exit(fail ? 1 : 0); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-plugins-tab-real-"));
  const out = path.join(tmp, "patched.js");
  const real = py(`
text = open(${JSON.stringify(src)}, encoding="utf-8").read()
once = rebrand.add_plugins_tab(text)
twice = rebrand.add_plugins_tab(once)
open(${JSON.stringify(out)}, "w", encoding="utf-8", newline="").write(once)
print("SAME_TWICE" if once == twice else "CHANGED_TWICE")
print("TITLE=" + str(len(rebrand.EXT_TITLE.findall(once))))
`);
  await check("the patch runs on a real workbench file without warnings, and again changes nothing", () => {
    assert.strictEqual(real.status, 0, real.stderr); assert.ok(!/::warning::/.test(real.stdout), real.stdout); assert.ok(/SAME_TWICE/.test(real.stdout), real.stdout);
  });
  const text = fs.readFileSync(out, "utf8");
  await check("the result is valid JavaScript", () => { const c = spawnSync(process.execPath, ["--check", out]); assert.strictEqual(c.status, 0, String(c.stderr)); });
  await check("each part once: the views (2: VS Code's views, create), the command; the container case; layout and Refresh", () => {
    assert.strictEqual(text.split("/*kural-plugins-tab*/").length - 1, 3);
    assert.strictEqual(text.split('case"extensions":return this.viewContainersRegistry.get("workbench.view.extensions")').length - 1, 1);
    assert.strictEqual(text.split("this.__kuralLayout?this.__kuralLayout(").length - 1, 1);
    assert.strictEqual(text.split('if(this.__kuralTab==="plugins"||this.__kuralTab==="connectors")return void await this.commandService.executeCommand("kural."+this.__kuralTab+".refresh")').length - 1, 1);
  });
  await check("this build's side bar title can be found (for Extensions & Plugins)", () => assert.ok(/TITLE=1/.test(real.stdout), real.stdout));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `rebrand-plugins-tab: ${fail} FAILED` : "rebrand-plugins-tab: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
