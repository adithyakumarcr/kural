// The Plugins tab's page (extension/media/plugins.js) on a small fake DOM, no browser: the host's messages in, what it
// draws and what it sends back out. Sections per AI (Claude, Codex, Gemini), search with the best match first, the row
// buttons (Install, Turn Off / On, Remove; busy words instead), the messages for not set up / a model on this computer /
// Claude without your setup, and that only the rows on screen are drawn (3,500 plugins).
const assert = require("assert");
const fs = require("fs"), path = require("path"), vm = require("vm");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.stack); } };

class El {
  constructor(tag) { Object.assign(this, { tag, nodeType: tag === "#text" ? 3 : 1, kids: [], attrs: {}, on: {}, style: {}, value: "", placeholder: "", disabled: false, scrollTop: 0, clientHeight: 600, text: undefined }); this._cls = new Set(); }
  get className() { return [...this._cls].join(" "); } set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() { const c = this._cls; return { add: (x) => c.add(x), remove: (x) => c.delete(x), contains: (x) => c.has(x), toggle: (x, on) => { if (on === undefined ? !c.has(x) : on) c.add(x); else c.delete(x); } }; }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }
  fire(t, ev = {}) { for (const f of this.on[t] || []) f({ preventDefault() {}, stopPropagation() {}, ...ev }); }
  append(...ks) { for (const k of ks) this.kids.push(k); }
  replaceChildren(...ks) { this.kids = []; this.append(...ks); }
  focus() {}
  get textContent() { return this.text !== undefined ? this.text : this.kids.map((k) => k.textContent).join(""); }
}
const all = (n, pred, out = []) => { for (const k of n.kids || []) { if (k instanceof El) { if (pred(k)) out.push(k); all(k, pred, out); } } return out; };
const byClass = (n, c) => all(n, (k) => k._cls.has(c));

function load() {
  const posted = [], state = { v: null }, app = new El("div"), listeners = {};
  const timers = [];
  const document = {
    getElementById: () => app, createElement: (t) => new El(t), createTextNode: (s) => { const t = new El("#text"); t.text = String(s); return t; },
    documentElement: { dataset: { fs: "1" }, style: { setProperty() {} } },
  };
  const ctx = {
    document, console,
    window: { addEventListener: (t, f) => { listeners[t] = f; } },
    // (Copied out as plain data: objects made inside the sandbox aren't deepStrictEqual to the test's.)
    acquireVsCodeApi: () => ({ postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))), getState: () => state.v, setState: (v) => { state.v = JSON.parse(JSON.stringify(v)); } }),
    getComputedStyle: () => ({ getPropertyValue: () => "1" }),
    ResizeObserver: class { observe() {} },
    requestAnimationFrame: (f) => f(),
    setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension/media/plugins.js"), "utf8"), ctx);
  const send = (m) => listeners.message({ data: m });
  const runTimers = () => { while (timers.length) timers.shift()(); };
  const [top, find, msg, list] = app.kids;
  return { app, posted, state, send, runTimers, top, input: all(find, (k) => k.tag === "input")[0], msg, rows: list.kids[0].kids[0], list };
}

const CAN = { claude: { available: true, toggle: true, update: true, marketplaces: true }, codex: { available: true, toggle: false, marketplaces: true }, agy: { toggle: true, folder: true, git: true } };
const P = (name, o = {}) => ({ id: `${name}@anthropic-plugin-directory`, name, marketplace: "anthropic-plugin-directory", version: "1.0.0", description: `About ${name}`, author: "", installed: false, enabled: false, readOnly: false, installable: true, ...o });
const base = (o = {}) => ({ type: "state", ai: "claude", chatAI: "claude", names: { claude: "Claude", codex: "ChatGPT (Codex)", agy: "Google Gemini" },
  ais: [{ id: "claude", name: "Claude" }, { id: "codex", name: "ChatGPT (Codex)" }, { id: "agy", name: "Google Gemini" }], loading: false, error: "", notSetUp: false, can: CAN.claude,
  fullSetupOff: false, installed: [], marketplaces: [{ name: "anthropic-plugin-directory", label: "Anthropic's plugin directory", source: "built in", removable: false }],
  availableCount: 0, version: 1, busy: {}, ...o });
const kinds = (rows) => rows.kids.map((r) => r._cls.has("head") ? `head:${byClass(r, "htitle")[0].textContent}` : r._cls.has("plugin") ? `plugin:${byClass(r, "pname")[0].textContent}` : r._cls.has("market") ? "market" : r._cls.has("action") ? "action" : "hint");

(async () => {
  await check("it asks for its state when it opens", () => { const p = load(); assert.deepStrictEqual(p.posted, [{ type: "ready" }]); });

  await check("Claude: Installed, Available (once its list arrives), Marketplaces with Add; the picker says whose chat it is", () => {
    const p = load();
    p.send(base({ installed: [P("superpowers", { installed: true, enabled: true })] }));
    assert.deepStrictEqual(kinds(p.rows), ["head:Installed", "plugin:superpowers", "head:Available", "hint", "head:Marketplaces", "market", "action"]);
    p.send({ type: "available", ai: "claude", version: 1, items: [P("code-review"), P("elements-of-style")] });
    assert.deepStrictEqual(kinds(p.rows), ["head:Installed", "plugin:superpowers", "head:Available", "plugin:code-review", "plugin:elements-of-style", "head:Marketplaces", "market", "action"]);
    const opts = all(p.top, (k) => k.tag === "option").map((o) => o.textContent);
    assert.deepStrictEqual(opts, ["Claude (this chat)", "ChatGPT (Codex)", "Google Gemini"]);
    assert.strictEqual(p.input.placeholder, "Search Claude plugins");
  });

  await check("a list from an older version isn't shown with the new state (it waits for the new one)", () => {
    const p = load();
    p.send({ type: "available", ai: "claude", version: 1, items: [P("old")] });
    p.send(base({ version: 2 }));
    assert.ok(!kinds(p.rows).includes("plugin:old"));
  });

  await check("search: every word must match; the name itself first, then names starting with it, then the rest", () => {
    const p = load();
    p.send(base());
    p.send({ type: "available", ai: "claude", version: 1, items: [P("writing-style-guide"), P("style"), P("other", { description: "Has style in it" }), P("styleguide")] });
    p.input.value = "style"; p.input.fire("input"); p.runTimers();
    assert.deepStrictEqual(kinds(p.rows).filter((k) => k.startsWith("plugin")), ["plugin:style", "plugin:styleguide", "plugin:writing-style-guide", "plugin:other"]);
    p.input.value = "style guide"; p.input.fire("input"); p.runTimers();
    assert.deepStrictEqual(kinds(p.rows).filter((k) => k.startsWith("plugin")), ["plugin:styleguide", "plugin:writing-style-guide"]);
    assert.strictEqual(p.state.v.q, "style guide");
  });

  await check("the row's buttons: Install (it asks the host, which asks you); installed: Turn Off and Remove; busy: what it's doing", () => {
    const p = load();
    p.send(base({ installed: [P("superpowers", { installed: true, enabled: true }), P("off-one", { installed: true, enabled: false })], busy: { "code-review@anthropic-plugin-directory": "Installing…" } }));
    p.send({ type: "available", ai: "claude", version: 1, items: [P("code-review"), P("elements-of-style")] });
    const rowOf = (name) => p.rows.kids.find((r) => r._cls.has("plugin") && byClass(r, "pname")[0].textContent === name);
    const buttons = (name) => all(rowOf(name), (k) => k.tag === "button");
    assert.deepStrictEqual(buttons("superpowers").map((b) => b.textContent || b.attrs.title), ["Turn Off", "Remove superpowers"]);
    assert.deepStrictEqual(buttons("off-one").map((b) => b.textContent || b.attrs.title), ["Turn On", "Remove off-one"]);
    assert.ok(rowOf("off-one")._cls.has("off") && byClass(rowOf("off-one"), "tag")[0].textContent === "Off");
    assert.strictEqual(byClass(rowOf("code-review"), "busy")[0].textContent, "Installing…");
    buttons("elements-of-style")[0].fire("click");
    buttons("superpowers")[0].fire("click");
    buttons("superpowers")[1].fire("click");
    assert.deepStrictEqual(p.posted.slice(1), [{ type: "install", id: "elements-of-style@anthropic-plugin-directory" }, { type: "disable", id: "superpowers@anthropic-plugin-directory" }, { type: "uninstall", id: "superpowers@anthropic-plugin-directory" }]);
  });

  await check("a click on the row opens its page; one a project set up has no buttons", () => {
    const p = load();
    p.send(base({ installed: [P("team-tool", { installed: true, enabled: true, readOnly: true })] }));
    const row = p.rows.kids.find((r) => r._cls.has("plugin"));
    assert.deepStrictEqual(all(row, (k) => k.tag === "button"), []);
    assert.strictEqual(byClass(row, "tag")[0].textContent, "This project");
    row.fire("click");
    assert.deepStrictEqual(p.posted.slice(-1)[0], { type: "details", id: "team-tool@anthropic-plugin-directory" });
  });

  await check("a section folds, and stays folded (kept in the page's state)", () => {
    const p = load();
    p.send(base({ installed: [P("a", { installed: true, enabled: true })] }));
    p.rows.kids[0].fire("click");
    assert.deepStrictEqual(kinds(p.rows).slice(0, 2), ["head:Installed", "head:Available"]);
    assert.deepStrictEqual(p.state.v.closed, ["installed"]);
  });

  await check("where a plugin comes from: only your own marketplaces are named on its row", () => {
    const p = load();
    p.send(base({ marketplaces: [...base().marketplaces, { name: "superpowers-marketplace", label: "superpowers-marketplace", source: "obra/superpowers-marketplace", removable: true }] }));
    p.send({ type: "available", ai: "claude", version: 1, items: [P("a"), P("b", { id: "b@superpowers-marketplace", marketplace: "superpowers-marketplace" })] });
    const from = p.rows.kids.filter((r) => r._cls.has("plugin")).map((r) => (byClass(r, "pfrom")[0] || { textContent: "" }).textContent);
    assert.deepStrictEqual(from, ["", "superpowers-marketplace"]);
  });

  await check("Codex: no marketplace yet says how to find plugins", () => {
    const p = load();
    p.send(base({ ai: "codex", chatAI: "codex", can: CAN.codex, marketplaces: [] }));
    p.send({ type: "available", ai: "codex", version: 1, items: [] });
    const hints = p.rows.kids.filter((r) => kinds({ kids: [r] })[0] === "hint").map((r) => r.textContent);
    assert.ok(hints.some((h) => /Add a marketplace below to find plugins, for example obra\/superpowers-marketplace/.test(h)), hints.join(" | "));
    assert.strictEqual(p.input.placeholder, "Search ChatGPT plugins");
  });

  await check("Gemini: Installed and Add a plugin (from a folder, from a Git address), no catalog", () => {
    const p = load();
    p.send(base({ ai: "agy", chatAI: "claude", can: CAN.agy, marketplaces: [] }));
    assert.deepStrictEqual(kinds(p.rows), ["head:Installed", "hint", "head:Add a plugin", "action", "hint"]);
    const [folder, git] = all(p.rows.kids[3], (k) => k.tag === "button");
    folder.fire("click"); git.fire("click");
    assert.deepStrictEqual(p.posted.slice(-2), [{ type: "addFolder" }, { type: "addGit" }]);
    assert.strictEqual(p.input.placeholder, "Search Gemini's plugins");
  });

  await check("not set up, a model on this computer, Claude without your setup: said above the list", () => {
    const p = load();
    p.send(base({ notSetUp: true, ai: "codex", can: CAN.codex }));
    assert.match(p.msg.textContent, /ChatGPT \(Codex\) isn't set up in Kural yet\. Set it up/);
    assert.deepStrictEqual(kinds(p.rows), []);
    all(p.msg, (k) => k.tag === "a")[0].fire("click");
    assert.deepStrictEqual(p.posted.slice(-1)[0], { type: "setUp" });
    p.send(base({ ai: null, chatAI: "local", can: null }));
    assert.match(p.msg.textContent, /Models on this computer don't use plugins/);
    assert.strictEqual(all(p.top, (k) => k.tag === "option")[0].textContent, "Choose an AI");
    p.send(base({ fullSetupOff: true }));
    assert.match(p.msg.textContent, /without your Claude Code setup/);
    all(p.msg, (k) => k.tag === "a")[0].fire("click");
    assert.deepStrictEqual(p.posted.slice(-1)[0], { type: "fullSetup" });
  });

  await check("3,500 plugins: only the rows on screen are drawn, and scrolling draws the next ones", () => {
    const p = load();
    p.send(base());
    const many = Array.from({ length: 3500 }, (_, i) => P(`plugin-${String(i).padStart(4, "0")}`));
    p.send({ type: "available", ai: "claude", version: 1, items: many });
    assert.ok(p.rows.kids.length < 40, `${p.rows.kids.length} rows drawn`);
    p.list.scrollTop = 44 * 2000; p.list.fire("scroll");
    const names = kinds(p.rows).filter((k) => k.startsWith("plugin"));
    assert.ok(names.includes("plugin:plugin-1999") || names.includes("plugin:plugin-2000"), names.slice(0, 3).join(","));
  });

  await check("the AI picker asks the host for that AI's plugins", () => {
    const p = load();
    p.send(base());
    const sel = all(p.top, (k) => k.tag === "select")[0];
    sel.value = "agy"; sel.fire("change");
    assert.deepStrictEqual(p.posted.slice(-1)[0], { type: "pick", ai: "agy" });
  });

  console.log(fail ? `plugins-page: ${fail} FAILED` : "plugins-page: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
