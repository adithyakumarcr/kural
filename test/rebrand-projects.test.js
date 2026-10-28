// The four build patches for the Projects bar (scripts/rebrand.py): drop_explorer_empty_view, projects_default_view,
// projects_always_shown and add_in_window_card. Same shape as rebrand-toast / rebrand-debug-views / rebrand-plugins-tab.
//
// What was checked where:
//   * On STAND-INS (tiny strings with VS Code's shapes, run everywhere, also in CI): every patch applies without a warning,
//     again changes nothing, warns and changes nothing when its anchor is missing, and the added code behaves: the Explorer's
//     welcome registrations don't happen, the side bar picks the Projects container and it gets order -1000, the Projects
//     container can't be hidden, unpinned, moved or dragged to another place and its view can't be toggled or moved, and the
//     card (_kural.card / _kural.cardClear) is run on a tiny fake DOM with a fake clock.
//   * On a REAL workbench file (an installed or built Kural, or $KURAL_WORKBENCH; skipped without one): the four patches apply
//     in main()'s order with no warning, once, valid JavaScript, and this build's own registerCustomViewContainer and
//     addViews, cut out of the file, behave like the stand-ins' ones.
//   * NOT checked: a real window (the card's look, the activity bar's right-click menu, a real drag, the first start with the
//     Projects bar in front). Those need the app started with the patched file and the Projects bar's package.json entries.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const root = path.join(__dirname, "..");
const py = (code) => spawnSync("python3", ["-c", `import sys\nsys.path.insert(0, ${JSON.stringify(path.join(root, "scripts"))})\nimport rebrand\n${code}`], { encoding: "utf8", maxBuffer: 1 << 26 });
const plain = (o) => JSON.parse(JSON.stringify(o));
const PROJECTS = "workbench.view.extension.kural-projects";

// Runs rebrand.<fn> twice on `text`: → { once, twiceSame, warnings }
function patch(fn, text) {
  const r = py(`
text = ${JSON.stringify(text)}
once = rebrand.${fn}(text)
twice = rebrand.${fn}(once)
print(once)
print("SAME_TWICE" if once == twice else "CHANGED_TWICE")
`);
  assert.strictEqual(r.status, 0, r.stderr);
  const cut = r.stdout.lastIndexOf("SAME_TWICE") > r.stdout.lastIndexOf("CHANGED_TWICE") ? r.stdout.lastIndexOf("SAME_TWICE") : r.stdout.lastIndexOf("CHANGED_TWICE");
  const body = r.stdout.slice(0, cut);
  const warnings = body.split("\n").filter((l) => l.startsWith("::warning::"));
  const once = body.split("\n").filter((l) => !l.startsWith("::warning::")).join("\n").replace(/\n$/, "");
  return { once, twiceSame: r.stdout.includes("SAME_TWICE"), warnings };
}
// A patch on a text that lacks its anchor: a warning, nothing changed.
function misses(fn, text, words) {
  const r = py(`text = ${JSON.stringify(text)}\nprint("UNCHANGED" if rebrand.${fn}(text) == text else "CHANGED")`);
  assert.ok(/::warning::/.test(r.stdout) && words.test(r.stdout) && /UNCHANGED/.test(r.stdout), r.stdout);
}

// ---------- stand-ins ----------
const EMPTY = 'var GP=class extends Base{constructor(e){super(e);this.x=1}static{this.ID="workbench.explorer.emptyView"}static{this.NAME=O(17793,"No Folder Opened")}shouldShowWelcome(){return!0}};' +
  'var XTo={explorer:"workbench.explorer.emptyView",debug:"workbench.debug.welcome",scm:"workbench.scm",testing:"workbench.view.testing"};' +
  'var Dfe=reg;Dfe.registerViewWelcomeContent(GP.ID,{content:d(1,null),group:"2_open"});Dfe.registerViewWelcomeContent(GP.ID,{content:d(2,null)});' +
  'Dfe.registerViewWelcomeContent(OTHER.ID,{content:d(3,null)});Gt(1);export{For as main};\n';

const DEFAULT = 'class Layout{init(){if(this.isVisible("workbench.parts.sidebar")){let a=this.storageService.get(rP.activeViewletSettingsKey,1,this.viewDescriptorService.getDefaultViewContainer(0)?.id);' +
  '!this.environmentService.isBuilt||e.startupKind===3||a!==this.viewDescriptorService.getDefaultViewContainer(0)?.id&&(a=this.viewDescriptorService.getDefaultViewContainer(0)?.id),' +
  'a?this.state.initialization.views.containerToRestore.sideBar=a:this.stateModel.setRuntimeValue(Jo.SIDEBAR_HIDDEN,!0)}}}' +
  'class Ext{registerCustomViewContainer(o,e,t,i,n,r){let a=this.viewContainersRegistry.get(o);return a||(a=this.viewContainersRegistry.registerViewContainer({id:o,title:{value:e,original:e},extensionId:n,order:i,icon:t},r)),a}}';

const ALWAYS = 'class Reg{constructor(){this._views=new Map}addViews(e,t){/*kural-debug-views*/try{}catch{}let i=this._views.get(t);i||(i=[],this._views.set(t,i));for(let n of e)i.push(n)}}' +
  'class Bar{constructor(){this.model={items:[],visibleItems:[],setPinned(e,t){return this.log.push("pin "+e+" "+t),!0},log:[]};this.log=[]}' +
  'unpin(e){this.model.setPinned(e,!1)&&(this.log.push("unpinned "+e),this.resetActiveComposite(e))}resetActiveComposite(){}isPinned(){return!0}' +
  'move(e,t,i){if(i!==void 0){let n=this.model.items.findIndex(a=>a.id===e),r=this.model.items.findIndex(a=>a.id===t);n>=0&&r>=0&&(this.moves.push([e,t]))}}' +
  'getAction(i){return{label:i}}getPinnedCompositeIds(){return[1,2]}' +
  'getContextMenuActions(e){let t=this.model.visibleItems.map(({id:i,name:n,activityAction:r})=>{let a=this.isPinned(i);return{id:i,label:this.getAction(i).label||n||i,checked:a}});return t}}' +
  'class Item{showContextMenu(){let t=[];this.compositeBarActionItem.keybindingId&&t.push("keys"),t.push(this.toggleCompositePinnedAction,this.toggleCompositeBadgeAction);let i=[];return t}}' +
  'class Views{canMoveViews(){return!0}moveViewContainerToLocation(e,t,i,n){this.canMoveViews()&&(this.moved.push(e.id+">"+t))}}';

const CARD = 'var $e=new class{constructor(){this._commands=new Map,this._onDidRegisterCommand=new A}};Gt(izn,[[]],!0));export{For as main};/*! @license */\n//# sourceMappingURL=x.map\n';

// ---------- a tiny DOM and a clock for the card ----------
class El {
  constructor(tag) { this.tag = tag; this.style = { cssText: "" }; this.children = []; this.attrs = {}; this.listeners = {}; this.parent = null; this._text = ""; this.className = ""; }
  get isConnected() { return this.tag === "body" || !!(this.parent && this.parent.isConnected); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
  set innerHTML(v) { throw new Error("innerHTML was used: " + v); }
  append(...c) { for (const x of c) { x.parent = this; this.children.push(x); } }
  appendChild(c) { this.append(c); return c; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  emit(t) { for (const f of this.listeners[t] || []) f({}); }
  all(pred, out = []) { if (pred(this)) out.push(this); for (const c of this.children) c.all(pred, out); return out; }
}
function load(snippet, { noDocument = false } = {}) {
  const commands = {}, body = new El("body"), timers = new Map();
  let now = 0, n = 0;
  const document = { body, createElement: (t) => new El(t) };
  const sandbox = {
    $e: { registerCommand: (id, fn) => { commands[id] = fn; } },
    setTimeout: (fn, ms) => { timers.set(++n, { at: now + ms, fn }); return n; }, clearTimeout: (id) => { timers.delete(id); },
    Date: { now: () => now },
  };
  if (!noDocument) sandbox.document = document;
  vm.runInNewContext(snippet, sandbox);
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); now = due[1].at; due[1].fn();
    }
    now = end;
  };
  const cards = () => body.all((e) => e.attrs.role === "status");
  return { commands, body, advance, cards, run: (id, arg) => commands[id]({ get() { throw new Error("no services needed"); } }, arg) };
}
const settled = async (p) => { let s = false; p.then(() => { s = true; }); for (let i = 0; i < 5; i++) await Promise.resolve(); return s; };
const buttons = (card) => card.all((e) => e.tag === "button");

// The stand-in's behaviour for patch 3, with the patched classes; also this build's (real) pieces through `viewsClass`.
async function behavesAlways(reg, bar, item, views, label) {
  await check(`${label}: the Projects view can't be hidden but can be moved (reordered with the Explorer); others are left as they are`, () => {
    const mine = { id: "kural.projects", canToggleVisibility: true, canMoveView: true }, other = { id: "kural.chat", canToggleVisibility: true, canMoveView: true };
    reg.addViews([mine, other], "c");
    assert.deepStrictEqual([mine.canToggleVisibility, mine.canMoveView, other.canToggleVisibility, other.canMoveView], [false, true, true, true]);
    assert.deepStrictEqual([mine.order, other.order], [-1, undefined], "Projects sorts above the Explorer's views; others keep theirs");
    assert.ok(reg._views.get("c").length === 2 && reg._views.get("c")[0] === mine && reg._views.get("c")[1] === other, "both views are still registered");
  });
  await check(`${label}: a frozen view doesn't stop the views after it`, () => {
    const frozen = Object.freeze({ id: "kural.projects", canMoveView: true }), next = { id: "kural.projects", canMoveView: true };
    reg.addViews([frozen, next], "d");
    assert.strictEqual(next.canToggleVisibility, false); assert.strictEqual(next.canMoveView, true); assert.ok(reg._views.get("d").includes(frozen));
  });
  if (!bar) return;
  await check(`${label}: no Hide for it: not in the checkable list, not in its own menu (the badge entry stays), others unchanged`, () => {
    bar.model.visibleItems = [{ id: "workbench.view.explorer", name: "Explorer" }, { id: PROJECTS, name: "Projects" }, { id: "workbench.view.scm", name: "SCM" }];
    assert.deepStrictEqual(plain(bar.getContextMenuActions({}).map((a) => a.id)), ["workbench.view.explorer", "workbench.view.scm"]);
    item.toggleCompositePinnedAction = "PIN"; item.toggleCompositeBadgeAction = "BADGE";
    item.compositeBarActionItem = { id: PROJECTS, keybindingId: "k" };
    assert.deepStrictEqual(plain(item.showContextMenu()), ["keys", "BADGE"]);
    item.compositeBarActionItem = { id: "workbench.view.explorer" };
    assert.deepStrictEqual(plain(item.showContextMenu()), ["PIN", "BADGE"]);
  });
  await check(`${label}: it can't be unpinned or dragged (also not another one onto it); the others can`, () => {
    bar.unpin(PROJECTS); bar.unpin("workbench.view.scm");
    assert.deepStrictEqual(plain(bar.model.log.filter((l) => l.startsWith("pin"))), ["pin workbench.view.scm false"]);
    bar.model.items = [{ id: PROJECTS }, { id: "a" }, { id: "b" }]; bar.moves = [];
    assert.strictEqual(bar.move(PROJECTS, "b", true), false); assert.strictEqual(bar.move("a", PROJECTS, false), false);
    bar.move("a", "b", true);
    assert.deepStrictEqual(plain(bar.moves), [["a", "b"]]);
  });
  await check(`${label}: it can't be moved to a side bar or panel; other containers can`, () => {
    views.moved = [];
    views.moveViewContainerToLocation({ id: PROJECTS }, 1, undefined, "dnd"); views.moveViewContainerToLocation({ id: "workbench.view.scm" }, 1, undefined, "dnd");
    assert.deepStrictEqual(plain(views.moved), ["workbench.view.scm>1"]);
  });
}

(async () => {
  // ---------- 1. drop_explorer_empty_view ----------
  const e = patch("drop_explorer_empty_view", EMPTY);
  await check("explorer welcome: applies without a warning, and again changes nothing", () => { assert.deepStrictEqual(e.warnings, []); assert.ok(e.twiceSame); assert.ok(e.once.includes("/*kural-explorer-empty*/")); });
  await check("explorer welcome: the Explorer's registrations don't happen, other views' still do, the extension table maps elsewhere", () => {
    const calls = [], sandbox = { reg: { registerViewWelcomeContent: (id, c) => calls.push([id, c.content]) }, Base: class {}, O: () => "", d: (n) => `m${n}`, Gt() {}, OTHER: { ID: "other" }, For: 0 };
    vm.runInNewContext(e.once.replace("export{For as main};", "") + ";this.XTo=XTo;", sandbox);
    assert.deepStrictEqual(calls, [["other", "m3"]]);
    assert.strictEqual(sandbox.XTo.explorer, "kural.explorer.noWelcome");
    assert.strictEqual(sandbox.XTo.debug, "workbench.debug.welcome");
  });
  await check("explorer welcome: a different VSCodium: a warning, nothing changed", () => {
    misses("drop_explorer_empty_view", EMPTY.replace('"workbench.explorer.emptyView",debug', '"workbench.explorer.other",debug'), /Explorer welcome text/);
    misses("drop_explorer_empty_view", "var a=1;", /Explorer welcome text/);
  });

  // ---------- 2. projects_default_view ----------
  const d = patch("projects_default_view", DEFAULT);
  await check("default view: applies without a warning, and again changes nothing", () => { assert.deepStrictEqual(d.warnings, []); assert.ok(d.twiceSame); });
  await check("default view: the side bar restores the Projects bar, wherever it was last; a hidden side bar stays hidden", () => {
    const run = (visible, remembered) => {
      const state = { initialization: { views: { containerToRestore: {} } } }, hidden = [];
      const sandbox = { rP: { activeViewletSettingsKey: "k" }, Jo: { SIDEBAR_HIDDEN: "h" }, e: { startupKind: 1 }, out: null };
      vm.runInNewContext(d.once + ";this.Layout=Layout", sandbox);
      const l = new sandbox.Layout();
      Object.assign(l, { isVisible: () => visible, storageService: { get: () => remembered }, viewDescriptorService: { getDefaultViewContainer: () => ({ id: "workbench.view.explorer" }) },
        environmentService: { isBuilt: true }, state, stateModel: { setRuntimeValue: (k, v) => hidden.push([k, v]) } });
      l.init();
      return { restore: plain(state.initialization.views.containerToRestore), hidden };
    };
    for (const remembered of ["workbench.view.explorer", "workbench.view.scm", PROJECTS, undefined]) assert.deepStrictEqual(run(true, remembered), { restore: { sideBar: PROJECTS }, hidden: [] }, String(remembered));
    assert.deepStrictEqual(run(false, "workbench.view.scm"), { restore: {}, hidden: [] });
  });
  await check("default view: the Projects container is ordered first (-1000); others keep their order", () => {
    const sandbox = { rP: {}, Jo: {}, e: {} };
    vm.runInNewContext(d.once + ";this.Ext=Ext", sandbox);
    const x = new sandbox.Ext(), seen = {};
    x.viewContainersRegistry = { get: () => null, registerViewContainer: (c) => { seen[c.id] = c.order; return c; } };
    x.registerCustomViewContainer(PROJECTS, "Projects", "i", 7, "kural.kural", 0);
    x.registerCustomViewContainer("workbench.view.extension.other", "Other", "i", 8, "x.y", 0);
    assert.deepStrictEqual(seen, { [PROJECTS]: -1000, "workbench.view.extension.other": 8 });
  });
  await check("default view: a different VSCodium: a warning, nothing changed", () => {
    misses("projects_default_view", DEFAULT.replace("containerToRestore.sideBar", "containerToRestore.side"), /side bar start code/);
    misses("projects_default_view", DEFAULT.replace("registerCustomViewContainer", "registerOther"), /side bar start code/);
  });

  // ---------- 3. projects_always_shown ----------
  const a = patch("projects_always_shown", ALWAYS);
  await check("always shown: applies without a warning, and again changes nothing", () => { assert.deepStrictEqual(a.warnings, []); assert.ok(a.twiceSame); });
  await check("always shown: the views code goes after the other patches' code at the start of addViews, before VS Code's own", () => {
    const i = a.once.indexOf("addViews(e,t){");
    assert.ok(/^addViews\(e,t\)\{\/\*kural-debug-views\*\/try\{\}catch\{\}\/\*kural-projects-fixed\*\/try\{[^]*?\}catch\{\}let i=this\._views\.get\(t\);/.test(a.once.slice(i)), a.once.slice(i, i + 400));
    const plainOne = patch("projects_always_shown", ALWAYS.replace("/*kural-debug-views*/try{}catch{}", ""));
    assert.deepStrictEqual(plainOne.warnings, []);
  });
  const run3 = () => { const sandbox = { out: null }; vm.runInNewContext(a.once + ";out={Reg,Bar,Item,Views}", sandbox); const o = sandbox.out; return [new o.Reg(), new o.Bar(), new o.Item(), new o.Views()]; };
  await behavesAlways(...run3(), "the stand-in");
  await check("always shown: a different VSCodium (any one of the six places missing): a warning naming it, nothing changed", () => {
    for (const [from, name] of [["unpin(e){", /unpin missing/], ["move(e,t,i){", /move missing/], ["this.model.visibleItems.map", /container list missing/],
      ["this.toggleCompositePinnedAction,this.toggleCompositeBadgeAction", /container item missing/], ["moveViewContainerToLocation(e", /move to a location missing/], ["let i=this._views.get(t)", /addViews missing/]])
      misses("projects_always_shown", ALWAYS.replace(from, from.replace(/^(.)/, "$1x")), name);
  });

  // ---------- 4. add_in_window_card ----------
  const c = patch("add_in_window_card", CARD);
  await check("card: applies without a warning, again changes nothing, goes right before the file's export with the registry's name", () => {
    assert.deepStrictEqual(c.warnings, []); assert.ok(c.twiceSame);
    const i = c.once.indexOf("/*kural-card*/"), j = c.once.indexOf("export{For as main}");
    assert.ok(i > 0 && j > i && c.once.slice(0, i).endsWith("Gt(izn,[[]],!0));") && /\(\$e\);$/.test(c.once.slice(i, j)), c.once.slice(i, j).slice(-60));
    assert.ok(c.once.slice(i, j).includes('R.registerCommand("_kural.card"') && c.once.slice(i, j).includes('R.registerCommand("_kural.cardClear"'));
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(c.once.slice(i, j)), "the strings are only ever set as text");
  });
  await check("card: a different VSCodium: a warning, nothing changed", () => {
    misses("add_in_window_card", CARD.replace("this._commands=new Map", "this._cmds=new Map"), /command registry/);
  });
  const snippet = c.once.slice(c.once.indexOf("/*kural-card*/"), c.once.indexOf("export{For as main}"));
  await check("card: both commands are registered", () => assert.deepStrictEqual(Object.keys(load(snippet).commands).sort(), ["_kural.card", "_kural.cardClear"]));
  await check("card: draws a square in the colour with the letter, the bold title, a grey line, one button and a close cross; text only", async () => {
    const t = load(snippet);
    const title = "<img src=x onerror=alert(1)>";
    const p = t.run("_kural.card", { id: "p1", title, body: "Waiting <b>for you</b>", button: "Open", color: "#e0752d", letter: "kural", timeout: 5000 });
    const [card] = t.cards();
    assert.ok(card, "a card is in the window");
    const box = card.parent;
    assert.ok(/position:fixed/.test(box.style.cssText) && /right:\d+px/.test(box.style.cssText) && /bottom:3\d+px/.test(box.style.cssText), box.style.cssText);   // above the 22 px status bar
    assert.ok(/--vscode-notifications-background/.test(card.style.cssText) && /--vscode-notifications-foreground/.test(card.style.cssText));
    const [badge, text] = card.children;
    assert.strictEqual(badge.textContent, "K"); assert.strictEqual(badge.style.background, "#e0752d");
    assert.strictEqual(text.children[0].textContent, title); assert.ok(/font-weight:600/.test(text.children[0].style.cssText));
    assert.strictEqual(text.children[1].textContent, "Waiting <b>for you</b>"); assert.ok(/--vscode-descriptionForeground/.test(text.children[1].style.cssText));
    const [open, close] = buttons(card);
    assert.strictEqual(open.textContent, "Open"); assert.ok(/--vscode-button-background/.test(open.style.cssText) && /--vscode-button-foreground/.test(open.style.cssText));
    assert.strictEqual(close.textContent, "×"); assert.strictEqual(close.attrs["aria-label"], "Close");
    assert.strictEqual(buttons(card).length, 2);
    close.emit("click"); await p;
  });
  await check("card: the button resolves {clicked: true, supported: true} and takes the card away", async () => {
    const t = load(snippet);
    const p = t.run("_kural.card", { title: "Done", button: "Open" });
    buttons(t.cards()[0])[0].emit("click");
    assert.deepStrictEqual(plain(await p), { clicked: true, supported: true });
    assert.strictEqual(t.cards().length, 0);
  });
  await check("card: the cross resolves {clicked: false}; no button label, no button (just the cross)", async () => {
    const t = load(snippet);
    const p = t.run("_kural.card", { title: "Info" });
    const bs = buttons(t.cards()[0]);
    assert.strictEqual(bs.length, 1);
    bs[0].emit("click");
    assert.deepStrictEqual(plain(await p), { clicked: false, supported: true });
    assert.strictEqual(t.cards().length, 0);
  });
  await check("card: stays 12 seconds by default, or the timeout; then {clicked: false}", async () => {
    const t = load(snippet);
    const p = t.run("_kural.card", { title: "x" }), q = t.run("_kural.card", { title: "y", timeout: 2000 });
    t.advance(1999); assert.strictEqual(await settled(q), false);
    t.advance(1); assert.deepStrictEqual(plain(await q), { clicked: false, supported: true }); assert.strictEqual(t.cards().length, 1);
    t.advance(9999); assert.strictEqual(await settled(p), false);
    t.advance(1); assert.strictEqual((await p).clicked, false); assert.strictEqual(t.cards().length, 0);
  });
  await check("card: paused while the mouse is over it; after it leaves, what was left (at least 1.5 s)", async () => {
    const t = load(snippet);
    const p = t.run("_kural.card", { title: "x", timeout: 4000 }), card = t.cards()[0];
    t.advance(1000); card.emit("mouseenter");
    t.advance(60000); assert.strictEqual(await settled(p), false); assert.strictEqual(t.cards().length, 1);
    card.emit("mouseleave");   // 3000 ms were left
    t.advance(2999); assert.strictEqual(await settled(p), false);
    t.advance(1); assert.strictEqual((await p).clicked, false);
    const q = t.run("_kural.card", { title: "y", timeout: 4000 }), card2 = t.cards()[0];
    t.advance(3900); card2.emit("mouseenter"); card2.emit("mouseleave");   // 100 ms were left: a short grace instead
    t.advance(1499); assert.strictEqual(await settled(q), false);
    t.advance(1); assert.strictEqual((await q).clicked, false);
  });
  await check("card: the same id replaces the card before it (the old call ends unclicked); other ids stack", async () => {
    const t = load(snippet);
    const first = t.run("_kural.card", { id: "chat-1", title: "first", button: "Open" }), other = t.run("_kural.card", { id: "chat-2", title: "other" });
    const second = t.run("_kural.card", { id: "chat-1", title: "second", button: "Open" });
    assert.strictEqual((await first).clicked, false);
    assert.deepStrictEqual(t.cards().map((c) => c.children[1].children[0].textContent), ["other", "second"]);
    buttons(t.cards()[1])[0].emit("click");
    assert.strictEqual((await second).clicked, true);
    assert.strictEqual(await settled(other), false);
  });
  await check("card: _kural.cardClear removes one by id, or all of them; counts them", async () => {
    const t = load(snippet);
    const a1 = t.run("_kural.card", { id: "a", title: "a" }), b1 = t.run("_kural.card", { id: "b", title: "b" }), c1 = t.run("_kural.card", { title: "c" });
    assert.strictEqual(t.run("_kural.cardClear", { id: "a" }), 1); assert.strictEqual((await a1).clicked, false);
    assert.strictEqual(t.run("_kural.cardClear", { id: "nope" }), 0);
    assert.strictEqual(t.run("_kural.cardClear"), 2);
    assert.deepStrictEqual([(await b1).clicked, (await c1).clicked], [false, false]);
    assert.strictEqual(t.cards().length, 0); assert.strictEqual(t.run("_kural.cardClear"), 0);
  });
  await check("card: a click after the card ended, or its timer after a click, does nothing more", async () => {
    const t = load(snippet);
    const p = t.run("_kural.card", { title: "x", button: "Open", timeout: 100 });
    const [open] = buttons(t.cards()[0]);
    open.emit("click"); open.emit("click"); t.advance(1000);
    assert.deepStrictEqual(plain(await p), { clicked: true, supported: true });
  });
  await check("card: no window to draw in: {clicked: false, supported: false}", async () => {
    const t = load(snippet, { noDocument: true });
    assert.deepStrictEqual(plain(await t.run("_kural.card", { title: "x" })), { clicked: false, supported: false });
  });

  // ---------- 5. a real workbench file ----------
  // (Not an app built from source with these patches: rebrand.py doesn't run them there, and their anchors are gone.)
  const src = require("./workbench").findWorkbench(undefined, { notBuiltIn: ["0200-drop-explorer-empty-view", "0201-projects-default-view", "0202-projects-always-shown", "0203-in-window-card"] });
  if (!src) { console.log("(real workbench file: skipped: no built workbench (set KURAL_WORKBENCH))"); console.log(fail ? `rebrand-projects: ${fail} FAILED` : "rebrand-projects: ALL PASS (stand-ins only)"); process.exit(fail ? 1 : 0); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-rebrand-projects-"));
  const out = path.join(tmp, "patched.js");
  // main()'s order: the views patches first (nothing to do on an installed Kural's file), then the four.
  const real = py(`
text = open(${JSON.stringify(src)}, encoding="utf-8").read()
cur = rebrand.add_plugins_tab(rebrand.hide_debug_views(text))
print("STEPS")
for f in (rebrand.drop_explorer_empty_view, rebrand.projects_default_view, rebrand.projects_always_shown, rebrand.add_in_window_card):
    new = f(cur)
    print(f.__name__, "CHANGED" if new != cur else "SAME", "AGAIN_SAME" if f(new) == new else "AGAIN_CHANGED")
    cur = new
open(${JSON.stringify(out)}, "w", encoding="utf-8", newline="").write(cur)
`);
  await check("the four patches run on a real workbench file, in main()'s order, without warnings; each again changes nothing", () => {
    assert.strictEqual(real.status, 0, real.stderr);
    const after = real.stdout.slice(real.stdout.indexOf("STEPS"));
    assert.ok(!/::warning::/.test(after), after);
    // (An installed Kural built with these patches has them already: then each one finds nothing to do.)
    const already = fs.readFileSync(src, "utf8").includes("/*kural-card*/");
    assert.strictEqual((after.match(already ? / SAME AGAIN_SAME/g : / CHANGED AGAIN_SAME/g) || []).length, 4, after);
  });
  const js = fs.readFileSync(out, "utf8");
  await check("the result is valid JavaScript", () => { const r = spawnSync(process.execPath, ["--check", out]); assert.strictEqual(r.status, 0, String(r.stderr)); });
  await check("each part is there: the Explorer's registrations switched off, the table, the start code, the order, the six places", () => {
    assert.strictEqual(js.split("/*kural-explorer-empty*/").length - 1, 1);
    assert.ok(/0&&[\w$]+\.registerViewWelcomeContent\([\w$]+\.ID,/.test(js) && js.includes('{explorer:"kural.explorer.noWelcome",debug:'));
    assert.strictEqual(js.split("/*kural-projects-default*/").length - 1, 2);
    assert.strictEqual(js.split("/*kural-projects-fixed*/").length - 1, 4);   // (the list and the menu item are changed in place, with no marker)
    assert.strictEqual(js.split("/*kural-card*/").length - 1, 1);
    const i = js.indexOf("/*kural-card*/");
    assert.ok(/^\/\*kural-card\*\/\(R=>\{[\s\S]*\}\)\([\w$]+\);export\{[\w$]+ as main\}/.test(js.slice(i, js.indexOf(" as main}") + 9)));
  });
  await check("this build's registerCustomViewContainer gives the Projects container order -1000", () => {
    const i = js.lastIndexOf("registerCustomViewContainer(", js.indexOf("/*kural-projects-default*/")), j = js.indexOf("deregisterCustomViewContainer(", i);
    assert.ok(i > 0 && j > i && j - i < 1500, `${i} ${j}`);
    const sandbox = { ti: class {}, Pd: class {} };
    vm.runInNewContext(`class X{${js.slice(i, j)}};this.X=X`, sandbox);
    const x = new sandbox.X(), seen = {};
    x.viewContainersRegistry = { get: () => null, registerViewContainer: (c) => { seen[c.id] = c.order; return c; } };
    x.registerCustomViewContainer(PROJECTS, "Projects", "i", 9, "kural.kural", 0);
    x.registerCustomViewContainer("workbench.view.extension.other", "Other", "i", 10, "x.y", 0);
    assert.deepStrictEqual(seen, { [PROJECTS]: -1000, "workbench.view.extension.other": 10 });
  });
  // This build's own addViews (up to removeViews), run with a stand-in condition class like rebrand-debug-views does.
  const m = js.indexOf("/*kural-projects-fixed*/try{for(const _kv of"), i = js.lastIndexOf("addViews(", m), j = js.indexOf("removeViews(", m);
  await check("this build's addViews is followed by removeViews (where the method ends)", () => assert.ok(i > 0 && j > m && j - i < 2500, `${i} ${m} ${j}`));
  const cls = /neverMatch/.test(js) && require("child_process").spawnSync("python3", ["-c", `import sys\nsys.path.insert(0, ${JSON.stringify(path.join(root, "scripts"))})\nimport rebrand\nprint(rebrand.NEVER.search(open(${JSON.stringify(out)}, encoding="utf-8").read()).group(1))`], { encoding: "utf8" }).stdout.trim();
  if (i > 0 && j > m) {
    const sandbox = { out: null };
    vm.runInNewContext(`var ${cls}=class{static has(k){return{has:k}}static or(...a){return{or:a}}static and(...a){return{and:a}}static notEquals(...a){return{ne:a}}};` +
      `var d=()=> "m";class Reg{constructor(){this._views=new Map,this._viewContainers=[]}getView(){return null}${js.slice(i, j)}}out=new Reg()`, sandbox);
    console.log("this build's addViews:");
    await behavesAlways(sandbox.out, null, null, null, "this build");
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `rebrand-projects: ${fail} FAILED` : "rebrand-projects: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
