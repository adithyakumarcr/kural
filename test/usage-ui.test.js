// Execute the usage/settings page scripts on a small DOM; no editor or browser starts.
const assert = require("assert"), fs = require("fs"), path = require("path"), Module = require("module");
const load = Module._load;
Module._load = function (r, ...args) { return r === "vscode" ? { workspace: { getConfiguration: () => ({ get: (k, d) => d }) } } : load.call(this, r, ...args); };
const { _page } = require("../extension/lib/usage-panel");
let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
function dom() {
  const nodes = [], listeners = {}, sent = [], document = { activeElement: null };
  function node(tag, text = "") {
    const classes = new Set(), attrs = {}, events = {};
    const n = { tag, nodeType: tag === "#text" ? 3 : 1, children: [], attrs, events, value: "", checked: false,
      style: { setProperty() {} }, dataset: {}, open: false,
      get className() { return [...classes].join(" "); }, set className(s) { classes.clear(); String(s).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: (c, v) => v ? classes.add(c) : classes.delete(c) },
      get textContent() { return text + this.children.map((c) => c.textContent).join(""); }, set textContent(s) { text = String(s); this.children = []; },
      append(...kids) { this.children.push(...kids.map((k) => typeof k === "object" ? k : node("#text", String(k)))); },
      replaceChildren(...kids) { this.children = []; text = ""; this.append(...kids); },
      setAttribute(k, v) { attrs[k] = String(v); if (["id", "type", "min", "max", "step"].includes(k)) this[k] = String(v); },
      getAttribute(k) { return attrs[k]; }, addEventListener(t, f) { (events[t] || (events[t] = [])).push(f); },
      focus() { document.activeElement = this; }, scrollIntoView() { this.scrolled = true; },
      reportValidity() { return this.value !== "" && Number.isInteger(Number(this.value)) && Number(this.value) >= Number(this.min) && Number(this.value) <= Number(this.max); },
      trigger(t) { if (typeof this["on" + t] === "function") this["on" + t]({ target: this }); for (const f of events[t] || []) f({ target: this }); },
    }; nodes.push(n); return n;
  }
  document.documentElement = node("html"); document.createElement = (tag) => node(tag); document.createTextNode = (s) => node("#text", s);
  document.getElementById = (id) => nodes.find((n) => n.id === id);
  const window = { addEventListener: (type, f) => (listeners[type] || (listeners[type] = [])).push(f) };
  const run = (js) => new Function("acquireVsCodeApi", "document", "window", "setInterval", js)(() => ({ postMessage: (m) => sent.push(m) }), document, window, () => 0);
  return { node, nodes, document, sent, run, message: (data) => { for (const f of listeners.message || []) f({ data }); } };
}
check("AI Usage stays compact, expands details, remembers the expansion and links to settings", () => {
  const d = dom(); for (const id of ["sum", "list", "refresh", "rico", "acc"]) d.node("div").id = id;
  const html = _page("test", "csp", "codicons.css");
  d.run(html.split('<script nonce="test">')[1].split("</script>")[0]);
  const state = { type: "state", refreshing: false, list: [{ id: "claude", name: "Claude", plan: "Pro", at: Date.now(), page: "https://claude.ai/settings/usage",
    windows: [{ name: "Session", used: 50 }, { name: "Weekly", used: 70 }],
    usage: [1, 7, 30].map(() => ({ read: 200, cacheRead: 100, written: 20 })) }] };
  d.message(state);
  const provider = d.document.getElementById("list").children[0], details = provider.children.find((n) => n.tag === "details");
  // Session and Weekly are always visible; only the tokens are collapsed (summary "Tokens").
  assert.strictEqual(details.open, false); assert.strictEqual(details.children[0].textContent, "Tokens");
  const visible = provider.children.filter((n) => n.tag !== "details").map((n) => n.textContent).join(" | ");
  assert.match(visible, /Session.*50%/); assert.match(visible, /Weekly.*70%/); assert.match(visible, /Pro/);
  assert.match(details.textContent, /Today.*7 days.*30 days/); assert.doesNotMatch(details.textContent, /Session|Weekly/);
  details.open = true; details.trigger("toggle"); d.message(state);
  assert.strictEqual(d.document.getElementById("list").children[0].children.find((n) => n.tag === "details").open, true);
  d.document.getElementById("acc").trigger("click"); assert.strictEqual(d.sent.at(-1).type, "accounts");
});
check("settings: a switch for the whole thing, Session and Weekly points on each AI's card; a refresh keeps a value being edited", () => {
  const d = dom(); d.node("div").id = "app";
  d.run(fs.readFileSync(path.join(__dirname, "../extension/media/settings.js"), "utf8"));
  const card = (id, name) => ({ id, name, state: "on", who: "me", windows: [], tokens: null });
  const state = { type: "state", cards: [card("claude", "Claude"), card("agy", "Google Gemini")], moods: { mine: [], builtIn: [], examples: [], limits: {} }, version: "test",
    usageSwitch: { enabled: false, threshold: 70, limits: { claude: { session: 80, weekly: 90 }, codex: { session: 70, weekly: 70 }, agy: { session: 70, weekly: 60 } } },
    connectors: { claude: { supported: true, servers: [{ name: "github", target: "npx gh", status: "Connected", ok: true }] }, agy: { supported: false } }, fullSetup: true };
  d.message(state);
  const section = d.document.getElementById("usage"); assert.match(section.textContent, /AI Usage.*Switch AI near a limit/);
  const numbers = d.nodes.filter((n) => n.tag === "input" && n.type === "number");
  const [cs, cw, gs, gw] = numbers;   // Claude's session, weekly; Gemini's (its session isn't shown)
  assert.deepStrictEqual([cs.value, cw.value, gw.value].map(Number), [80, 90, 60]);
  const gem = d.document.getElementById("ai-agy").textContent;
  assert.doesNotMatch(gem, /Session limit is/); assert.match(gem, /a Weekly limit is/); assert.match(gem, /can't add connectors to Google Gemini/);
  assert.match(d.document.getElementById("ai-claude").textContent, /Session limit is.*Weekly limit is.*Connectors.*github/);
  cw.value = "85"; cw.trigger("change"); assert.deepStrictEqual(d.sent.at(-1), { type: "usageSwitch", ai: "claude", which: "weekly", value: 85 });
  const count = d.sent.length; cs.value = "101"; cs.trigger("change"); assert.strictEqual(d.sent.length, count);
  cs.value = "81"; cs.focus(); d.message(state); assert.strictEqual(cs.value, "81");
  d.message({ ...state, section: "claude" }); assert.ok(d.document.getElementById("ai-claude").scrolled); assert.deepStrictEqual(d.sent.find((m) => m.type === "connectors"), { type: "connectors", id: "claude" });
  void gs;
});
check("the context meter shows consumed and in-context tokens, and recommended files are absent", () => {
  const source = fs.readFileSync(path.join(__dirname, "../extension/media/chat.js"), "utf8");
  assert.ok(!/includeActive|activeFile|chip ghost/.test(source));
  const d = dom(), ctxEl = d.node("button");
  const body = source.slice(source.indexOf("  function renderContext(t)"), source.indexOf("  function renderFoot()"));
  const el = (tag, props, label) => { const n = d.node(tag); if (label) n.append(label); return n; };
  new Function("ctxEl", "el", "tok", body + "\nrenderContext({context:{used:1200,window:200000},tokens:{input:500,cacheRead:100,cacheWrite:20,output:80}});")(ctxEl, el, String);
  assert.match(ctxEl.title, /In context: 1,200 \/ 200,000 tokens/); assert.match(ctxEl.title, /Tokens consumed: 700 \(620 read, 80 written\)/);
  assert.match(ctxEl.title, /Click to open AI Usage/);
  assert.match(source, /ctxEl = el\("button",[\s\S]*?post\(\{ type: "showUsage" \}\)/);
});
console.log(failed ? `usage-ui: ${failed} FAILED` : "usage-ui: ALL PASS"); process.exitCode = failed ? 1 : 0;
