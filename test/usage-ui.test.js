// Execute the usage/settings page scripts on a small DOM; no editor or browser starts.
const assert = require("assert"), fs = require("fs"), path = require("path"), Module = require("module");
const load = Module._load;
Module._load = function (r, ...args) { return r === "vscode" ? { workspace: { getConfiguration: () => ({ get: (k, d) => d }) } } : load.call(this, r, ...args); };
const { _page } = require("../extension/lib/usage-panel");
let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
function dom() {
  const nodes = [], listeners = {}, sent = [], timers = [], document = { activeElement: null };
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
  const run = (js) => new Function("acquireVsCodeApi", "document", "window", "setInterval", "setTimeout", "clearTimeout", js)(() => ({ postMessage: (m) => sent.push(m) }), document, window, () => 0,
    (f) => { timers.push(f); return timers.length; }, (id) => { timers[id - 1] = null; });
  return { node, nodes, document, sent, run, timers, message: (data) => { for (const f of listeners.message || []) f({ data }); } };
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
check("settings: a short overview; each AI's own page has its connectors and switch points; a refresh keeps a value being edited", () => {
  const d = dom(); d.node("div").id = "app";
  d.run(fs.readFileSync(path.join(__dirname, "../extension/media/settings.js"), "utf8"));
  const card = (id, name) => ({ id, name, state: "on", who: "me", windows: [], tokens: null });
  const state = { type: "state", cards: [card("claude", "Claude"), card("agy", "Google Gemini")], moods: { mine: [], builtIn: [], examples: [], limits: {} }, version: "test",
    usageSwitch: { enabled: false, threshold: 70, limits: { claude: { session: 80, weekly: 90 }, codex: { session: 70, weekly: 70 }, agy: { session: 70, weekly: 60 } } },
    learn: { tab: { on: false, has: true }, router: { on: true, has: false } },
    connectors: { claude: { supported: true, servers: [{ name: "github", target: "npx gh", status: "Connected", ok: true }, { name: "notion", target: "https://x", status: "Needs authentication", ok: false, needsAuth: true }] }, agy: { supported: false } }, fullSetup: true };
  d.message(state);
  // The overview: no switch points, no connectors, no AI Usage section; a Settings button per AI; what Kural learns.
  const main = d.document.getElementById("app").textContent;
  assert.doesNotMatch(main, /Switch to another AI|Connectors|Switch AI near a limit|Weekly limit is/);
  assert.match(main, /Settings.*Settings/); assert.match(main, /What Kural learns.*Tab Completion learns from your work.*Auto learns which models you prefer/);
  const click = (label, within) => { const b = d.nodes.find((n) => n.tag === "button" && n.textContent.trim() === label && (!within || within())); assert.ok(b, "button " + label); b.trigger("click"); return b; };
  d.nodes.filter((n) => n.tag === "button" && n.textContent.trim() === "Settings")[1].trigger("click");   // Gemini's
  let page = d.document.getElementById("app").textContent;
  assert.match(page, /Kural Settings.*Google Gemini/); assert.match(page, /can't add connectors to Google Gemini/);
  assert.match(page, /Switch to another AI near a limit/); assert.doesNotMatch(page, /Session limit is/); assert.match(page, /Weekly limit is/);
  click("Kural Settings");
  d.nodes.filter((n) => n.tag === "button" && n.textContent.trim() === "Settings")[0].trigger("click");   // Claude's
  assert.deepStrictEqual(d.sent.at(-1), { type: "connectors", id: "claude" });
  page = d.document.getElementById("app").textContent;
  assert.match(page, /Connectors.*Add connector.*github.*Connected.*notion.*Needs sign-in.*Sign in/); assert.match(page, /Switch to another AI near a limit.*Session limit is.*Weekly limit is/);
  assert.doesNotMatch(page, /`/);   // (the old help text showed literal backticks)
  const numbers = d.nodes.filter((n) => n.tag === "input" && n.type === "number" && n.getAttribute("aria-label") !== "Context length in tokens");
  const [, , cs, cw] = numbers.length > 3 ? numbers.slice(-2).length ? [0, 0, ...numbers.slice(-2)] : numbers : numbers;
  assert.deepStrictEqual([cs.value, cw.value].map(Number), [80, 90]);
  cw.value = "85"; cw.trigger("change"); assert.deepStrictEqual(d.sent.at(-1), { type: "usageSwitch", ai: "claude", which: "weekly", value: 85 });
  const count = d.sent.length; cs.value = "101"; cs.trigger("change"); assert.strictEqual(d.sent.length, count);
  cs.value = "81"; cs.focus(); d.message(state); assert.strictEqual(cs.value, "81");   // a refresh while you type leaves the field alone
  // Remove asks on the row first; Sign in asks the host for a terminal and shows the hint for Claude.
  d.document.activeElement = null;
  click("Sign in"); assert.deepStrictEqual(d.sent.at(-1), { type: "signIn", id: "claude", name: "notion" });
  assert.match(d.document.getElementById("app").textContent, /Type \/mcp, pick notion, then Authenticate/);
  const trash = d.nodes.filter((n) => n.getAttribute && n.getAttribute("aria-label") === "Remove github").pop(); trash.trigger("click");
  click("Remove?"); assert.strictEqual(d.sent.at(-1).type, "removeConnector"); assert.strictEqual(d.sent.at(-1).name, "github");
  // The chat's gear: straight to the AI's page.
  d.message({ ...state, section: "agy" }); assert.match(d.document.getElementById("app").textContent, /Google Gemini.*can't add connectors/);
  d.message({ ...state, section: "usage" }); assert.ok(d.document.getElementById("switch").scrolled);
});
check("settings: the catalog (popular, search as you type, inputs in place) and what Kural learns", () => {
  const d = dom(); d.node("div").id = "app";
  d.run(fs.readFileSync(path.join(__dirname, "../extension/media/settings.js"), "utf8"));
  const live = () => { const out = []; const walk = (n) => { out.push(n); n.children.forEach(walk); }; walk(d.document.getElementById("app")); return out; };   // (what is on the page now)
  const flush = () => d.timers.splice(0).forEach((f) => f && f());   // (the search waits 300 ms after the last key)
  const card = (id, name) => ({ id, name, state: "on", who: "me", windows: [], tokens: null });
  const state = { type: "state", cards: [card("claude", "Claude")], moods: { mine: [], builtIn: [], examples: [], limits: {} }, version: "test", usageSwitch: { enabled: true, threshold: 70, limits: {} },
    learn: { tab: { on: false, has: true }, router: { on: true, has: false } }, connectors: { claude: { supported: true, servers: [{ name: "context7", target: "https://mcp.context7.com/mcp (HTTP)", status: "Connected", ok: true }] } } };
  d.message(state);
  const btnNamed = (label) => live().find((n) => n.tag === "button" && n.textContent.trim() === label);
  // What Kural learns: toggles post; delete asks inline first and never goes through a pop-up.
  const toggles = live().filter((n) => n.tag === "input" && n.type === "checkbox");
  const tabToggle = toggles[toggles.length - 2];   // (the two learn toggles are the last ones on the page)
  tabToggle.checked = true; tabToggle.trigger("change"); assert.deepStrictEqual(d.sent.at(-1), { type: "learn", which: "tab", on: true });
  const del = live().filter((n) => n.tag === "button" && n.textContent.trim() === "Delete what it learned");
  assert.strictEqual(del.length, 2);
  del[0].trigger("click"); btnNamed("Delete?").trigger("click"); assert.deepStrictEqual(d.sent.at(-1), { type: "forget", which: "tab" });
  // Catalog.
  btnNamed("Settings").trigger("click"); btnNamed("Add connector").trigger("click");
  assert.deepStrictEqual(d.sent.at(-1), { type: "catalogSearch", id: "claude", query: "", reqId: d.sent.at(-1).reqId });
  const items = [{ id: "notion", name: "Notion", description: "Pages", kind: "remote", url: "https://mcp.notion.com/mcp", signIn: true },
    { id: "context7", name: "Context7", description: "Docs", kind: "remote", url: "https://mcp.context7.com/mcp" },
    { id: "github", name: "GitHub", description: "Repos", kind: "remote", url: "https://x/", inputs: [{ key: "token", label: "GitHub token", secret: true, header: "Authorization", link: { label: "Get a token", url: "https://github.com/settings/tokens" } }] },
    { id: "atl", name: "Atlassian", description: "Jira", kind: "remote", url: "https://a/sse", unsupported: "Not for this AI." }];
  d.message({ type: "catalogResults", id: "claude", reqId: d.sent.at(-1).reqId, items, note: "" });
  let text = d.document.getElementById("app").textContent;
  assert.match(text, /Popular.*Notion.*Context7.*Added.*GitHub.*Atlassian.*Not for this AI/); assert.match(text, /Add one by hand/);
  // Typing searches after a pause, not on every key.
  const search = live().find((n) => n.tag === "input" && n.getAttribute("aria-label") === "Search connectors");
  const before = d.sent.filter((m) => m.type === "catalogSearch").length;
  search.value = "no"; search.trigger("input"); search.value = "not"; search.trigger("input");
  assert.strictEqual(d.sent.filter((m) => m.type === "catalogSearch").length, before); flush();
  assert.strictEqual(d.sent.filter((m) => m.type === "catalogSearch").length, before + 1); assert.strictEqual(d.sent.at(-1).query, "not");
  d.message({ type: "catalogResults", id: "claude", reqId: d.sent.at(-1).reqId, items: items.slice(0, 1), note: "Couldn't reach the connector directory." });
  text = d.document.getElementById("app").textContent; assert.match(text, /Results.*Notion/); assert.match(text, /Couldn't reach the connector directory/);
  // A connector with no inputs adds at once; one with inputs opens its fields in the row first.
  btnNamed("Add").trigger("click"); assert.deepStrictEqual(d.sent.at(-1), { type: "addCatalog", id: "claude", item: "notion", values: {}, reqId: d.sent.at(-1).reqId });
  d.message({ type: "catalogDone", id: "claude", item: "notion", error: "boom" }); assert.match(d.document.getElementById("app").textContent, /boom/);
  d.message({ type: "catalogResults", id: "claude", reqId: (search.value = "", search.trigger("input"), flush(), d.sent.at(-1).reqId), items, note: "" });
  // A connector that needs a token: Add opens its field in the row (password, with a link), a second Add sends it.
  const addIn = (name) => live().find((n) => /^cat-row/.test(n.className) && n.textContent.startsWith(name)).children[0].children[1];
  addIn("GitHub").trigger("click");
  const field = live().find((n) => n.tag === "input" && n.getAttribute("aria-label") === "GitHub token");
  assert.strictEqual(field.getAttribute("type"), "password"); assert.match(d.document.getElementById("app").textContent, /Get a token/);
  const lastAdd = () => live().filter((n) => n.tag === "button" && n.textContent.trim() === "Add").pop();
  const n0 = d.sent.length; lastAdd().trigger("click");
  assert.strictEqual(d.sent.length, n0); assert.match(d.document.getElementById("app").textContent, /Fill in GitHub token/);   // empty: refused on the row
  field.value = "ghp_x"; lastAdd().trigger("click");
  assert.deepStrictEqual(d.sent.at(-1), { type: "addCatalog", id: "claude", item: "github", values: { token: "ghp_x" }, reqId: d.sent.at(-1).reqId });
  // Done → back on the AI's page with the note.
  d.message({ type: "catalogDone", id: "claude", item: "notion", error: "", name: "notion" });
  text = d.document.getElementById("app").textContent; assert.match(text, /Added Notion\. Sign in to finish/); assert.match(text, /Connectors/);
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
