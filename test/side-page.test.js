// Side chat in the chat page (extension/media/side.js) on a tiny DOM: a thread's box, folding, streaming, Esc, errors,
// "Add to chat"; and that the chat page and host are wired to it. No browser starts.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const make = require("../extension/media/side.js");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

// ---- a small DOM: elements with classes, attributes, children, replaceWith and descendant selectors ----
let focusedEl = null;
class Node {
  constructor(tag, text) { this.tag = tag; this.text = text; this.attrs = {}; this.kids = []; this.parent = null; this.cls = new Set(); this.on = {}; this.value = ""; }
  get classList() { return { add: (c) => this.cls.add(c), contains: (c) => this.cls.has(c), remove: (c) => this.cls.delete(c) }; }
  set className(s) { this.cls = new Set(String(s).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, f) { this.on[t] = f; }
  append(...ks) { for (const k of ks) { const n = typeof k === "object" ? k : new Node("#text", String(k)); n.parent = this; this.kids.push(n); } }
  replaceChildren(...ks) { this.kids = []; this.append(...ks); }
  replaceWith(n) { const i = this.parent.kids.indexOf(this); n.parent = this.parent; this.parent.kids[i] = n; }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  get textContent() { return this.text !== undefined ? this.text : this.kids.map((k) => k.textContent).join(""); }
  focus() { focusedEl = this; }
  scrollIntoView() {}
  get activeElement() { return focusedEl; }
  matches(compound) {
    return compound.split(/(?=[.[])/).every((p) => p.startsWith(".") ? this.cls.has(p.slice(1)) : (m => this.attrs[m[1]] === m[2])(/^\[([\w-]+)="(.*)"\]$/.exec(p)));
  }
  all(sel) {
    const parts = sel.trim().split(/\s+/), out = [];
    const walk = (n, chain) => {
      for (const k of n.kids) {
        if (k.tag === "#text") continue;
        let at = chain; if (at < parts.length && k.matches(parts[at])) at++;
        if (at === parts.length) out.push(k); else walk(k, at);
        if (at === parts.length) walk(k, chain);   // (matches inside a match)
      }
    };
    walk(this, 0); return out;
  }
  querySelector(sel) { return this.all(sel)[0] || null; }
  querySelectorAll(sel) { return this.all(sel); }
}
const el = (tag, props = {}, ...kids) => {
  const n = new Node(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v; else if (k.startsWith("on")) n.on[k.slice(2)] = v; else if (k === "value") n.value = v; else n.setAttribute(k, v);
  }
  n.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return n;
};
global.document = { get activeElement() { return focusedEl; } };
const icon = (name) => el("i", { class: `codicon codicon-${name}` });
const markdown = (text) => [el("p", {}, text)];

function page() {
  const sent = [], rendered = [];
  const tab = { id: "t1", messages: [{ role: "user", segments: [] }, { role: "assistant", blocks: [{ k: "text", text: "An answer." }] }] };
  const root = el("div", { class: "list" });
  let side;
  const draw = (i) => {   // the chat page's own redraw of message i
    const old = root.querySelector(`[data-i="${i}"]`);
    const node = el("div", { class: "msg assistant", "data-i": i }, el("div", { class: "answer" }, ...side.nodes(tab.messages[i], i)));
    if (old) old.replaceWith(node); else root.append(node);
    rendered.push(i);
  };
  const added = [];
  side = make({ el, icon, markdown, post: (m) => sent.push(m), tab: () => tab, rerender: draw, root: () => root, addToChat: (x) => added.push(x) });
  draw(1);
  return { tab, root, side, sent, rendered, added, draw, th: () => tab.messages[1].side && tab.messages[1].side[0] };
}
const key = (n, k, extra = {}) => n.on.keydown({ key: k, target: n, preventDefault() {}, stopPropagation() {}, ...extra });
const type = (n, text) => { n.value = text; n.on.input({ target: n }); };

(async () => {
  await check("start: a box with the quote and a focused one-line input appears under the answer; nothing is sent yet", () => {
    const p = page();
    p.side.start(1, "  the lightest model  ");
    const box = p.root.querySelector(".side");
    assert.ok(box, "the box");
    assert.strictEqual(box.querySelector(".side-quote").textContent, "the lightest model");
    const input = box.querySelector(".side-in");
    assert.strictEqual(input.getAttribute("placeholder"), "Ask about this…");
    assert.strictEqual(focusedEl, input, "focused");
    assert.deepStrictEqual(p.sent, []);
    assert.ok(p.root.querySelector('[data-i="1"] .side'), "inside the answer's message");
  });
  await check("Enter asks: the question shows at once with Thinking…, the host gets it with the quote, the input empties", () => {
    const p = page(); p.side.start(1, "tier");
    const input = p.root.querySelector(".side-in");
    type(input, "What is a tier?"); key(input, "Enter");
    assert.deepStrictEqual(p.sent, [{ type: "sideAsk", tabId: "t1", index: 1, thread: p.th().id, quote: "tier", question: "What is a tier?" }]);
    const box = p.root.querySelector(".side");
    assert.strictEqual(box.querySelector(".side-q").textContent, "What is a tier?");
    assert.match(box.querySelector(".side-a").textContent, /Thinking…/);
    assert.ok(box.querySelector(".side-foot .side-btn"), "a stop control");
    assert.strictEqual(box.querySelector(".side-in").value, "");
    // Enter while it runs asks nothing more
    const again = box.querySelector(".side-in"); type(again, "second"); key(again, "Enter");
    assert.strictEqual(p.sent.length, 1);
  });
  await check("an empty question isn't sent; Shift+Enter and IME composing don't send", () => {
    const p = page(); p.side.start(1, "x");
    const input = p.root.querySelector(".side-in");
    type(input, "   "); key(input, "Enter");
    type(input, "real"); key(input, "Enter", { shiftKey: true }); key(input, "Enter", { isComposing: true });
    assert.strictEqual(p.sent.length, 0);
  });
  await check("the answer streams into the box in pieces and ends as given, with the model's name and Add to chat", async () => {
    const p = page(); p.side.start(1, "tier");
    type(p.root.querySelector(".side-in"), "What?"); key(p.root.querySelector(".side-in"), "Enter");
    const id = p.th().id;
    p.side.set({ index: 1, thread: id, quote: "tier", n: 0, item: { q: "What?", a: "", model: "Haiku", at: 1, running: true } });
    p.side.delta({ index: 1, thread: id, text: "A tier " }); p.side.delta({ index: 1, thread: id, text: "is a level." });
    await new Promise((r) => setTimeout(r, 120));
    assert.strictEqual(p.root.querySelector(".side-a").textContent, "A tier is a level.");
    assert.ok(!/Thinking/.test(p.root.querySelector(".side-a").textContent));
    p.side.set({ index: 1, thread: id, quote: "tier", n: 0, item: { q: "What?", a: "A tier is a level.", model: "Haiku", at: 1 } });
    const foot = p.root.querySelector(".side-foot");
    assert.strictEqual(foot.querySelector(".side-model").textContent, "Haiku");
    foot.querySelector(".side-btn").on.click();
    assert.deepStrictEqual(p.added, [{ text: "Side question: What?\n\nAnswer: A tier is a level.", label: "What?" }]);
  });
  await check("a follow-up goes in the same box and thread", () => {
    const p = page(); p.side.start(1, "tier");
    const id = () => p.th().id;
    type(p.root.querySelector(".side-in"), "one"); key(p.root.querySelector(".side-in"), "Enter");
    p.side.set({ index: 1, thread: id(), quote: "tier", n: 0, item: { q: "one", a: "A.", model: "Haiku", at: 1 } });
    type(p.root.querySelector(".side-in"), "two"); key(p.root.querySelector(".side-in"), "Enter");
    assert.deepStrictEqual(p.sent.map((m) => [m.thread, m.question]), [[id(), "one"], [id(), "two"]]);
    assert.strictEqual(p.root.querySelectorAll(".side-q").length, 2);
    assert.strictEqual(p.tab.messages[1].side.length, 1);
  });
  await check("an error shows as one line: Couldn't answer: <reason>; no Add to chat for it", () => {
    const p = page(); p.side.start(1, "tier");
    type(p.root.querySelector(".side-in"), "q"); key(p.root.querySelector(".side-in"), "Enter");
    p.side.set({ index: 1, thread: p.th().id, quote: "tier", n: 0, item: { q: "q", a: "", model: "Haiku", at: 1, error: "Not logged in." } });
    assert.strictEqual(p.root.querySelector(".side-err").textContent, "Couldn't answer: Not logged in.");
    assert.strictEqual(p.root.querySelector(".side-foot"), null);
  });
  await check("Esc or × on a box with no questions removes it; with questions it folds into one row that opens again", () => {
    let p = page(); p.side.start(1, "tier");
    key(p.root.querySelector(".side-in"), "Escape");
    assert.strictEqual(p.root.querySelector(".side"), null); assert.strictEqual(p.tab.messages[1].side, undefined);
    assert.deepStrictEqual(p.sent, [], "nothing to tell the host");

    p = page(); p.side.start(1, "tier");
    type(p.root.querySelector(".side-in"), "q"); key(p.root.querySelector(".side-in"), "Enter");
    p.side.set({ index: 1, thread: p.th().id, quote: "tier", n: 0, item: { q: "q", a: "A.", model: "Haiku", at: 1 } });
    p.root.querySelector(".side-x").on.click();
    assert.strictEqual(p.root.querySelector(".side"), null);
    const row = p.root.querySelector(".side-row");
    assert.strictEqual(row.textContent.trim(), "Side chat · 1 question");
    row.on.click();
    assert.ok(p.root.querySelector(".side"), "open again");
    assert.strictEqual(p.root.querySelector(".side-a").textContent, "A.");
    // a second question makes it plural
    type(p.root.querySelector(".side-in"), "q2"); key(p.root.querySelector(".side-in"), "Enter");
    p.root.querySelector(".side-x").on.click();
    assert.strictEqual(p.root.querySelector(".side-row").textContent.trim(), "Side chat · 2 questions");
  });
  await check("closing the box while it answers stops the answer", () => {
    const p = page(); p.side.start(1, "tier");
    type(p.root.querySelector(".side-in"), "q"); key(p.root.querySelector(".side-in"), "Enter");
    p.root.querySelector(".side-x").on.click();
    assert.deepStrictEqual(p.sent.at(-1), { type: "sideStop", tabId: "t1", thread: p.th().id });
    p.side.start(1, "other"); p.sent.length = 0;
    const stop = p.root.querySelectorAll(".side-foot .side-btn");   // (the first thread is folded: it has no open box)
    assert.strictEqual(stop.length, 0);
  });
  await check("the Stop button asks the host to stop", () => {
    const p = page(); p.side.start(1, "tier");
    type(p.root.querySelector(".side-in"), "q"); key(p.root.querySelector(".side-in"), "Enter");
    p.root.querySelector(".side-foot .side-btn").on.click();
    assert.deepStrictEqual(p.sent.at(-1), { type: "sideStop", tabId: "t1", thread: p.th().id });
    p.side.set({ index: 1, thread: p.th().id, quote: "tier", n: 0, item: { q: "q", a: "Part", model: "Haiku", at: 1, stopped: true } });
    assert.strictEqual(p.root.querySelector(".side-note").textContent, "Stopped.");
  });
  await check("a message drawn again (the main answer is still streaming) keeps the box, its question being typed and the cursor", () => {
    const p = page(); p.side.start(1, "tier");
    const input = p.root.querySelector(".side-in");
    type(input, "half a quest");
    const f = p.side.focused();
    p.draw(1); p.side.refocus(f);
    const again = p.root.querySelector(".side-in");
    assert.notStrictEqual(again, input);
    assert.strictEqual(again.value, "half a quest");
    assert.strictEqual(focusedEl, again);
  });
  await check("saved threads come back folded (only the row), threads on other answers stay apart", () => {
    const p = page();
    p.tab.messages[1].side = [{ id: "a1", quote: "q", items: [{ q: "x", a: "y", model: "Haiku", at: 1 }] }, { id: "b2", quote: "r", items: [{ q: "x", a: "y", model: "Haiku", at: 1 }, { q: "z", a: "w", model: "Haiku", at: 2 }] }];
    p.draw(1);
    assert.deepStrictEqual(p.root.querySelectorAll(".side-row").map((n) => n.textContent.trim()), ["Side chat · 1 question", "Side chat · 2 questions"]);
    assert.strictEqual(p.root.querySelector(".side"), null);
  });

  // ---- the page and the host are wired to it ----
  const media = path.join(__dirname, "..", "extension", "media"), lib = path.join(__dirname, "..", "extension", "lib", "chat");
  const chatJs = fs.readFileSync(path.join(media, "chat.js"), "utf8"), css = fs.readFileSync(path.join(media, "chat.css"), "utf8"), host = fs.readFileSync(path.join(lib, "index.js"), "utf8");
  await check("the page: Ask beside Add to chat, only for text in an answer (not your message, not inside a side chat); side.js loads before chat.js", () => {
    assert.match(chatJs, /icon\("comment-discussion"\), " Ask"/);
    assert.match(chatJs, /node\.closest\("\.side"\) \|\| !node\.closest\("\.answer"\)/);
    assert.match(chatJs, /case "sideDelta"/); assert.match(chatJs, /case "sideState"/);
    assert.match(chatJs, /side\.nodes\(m, i\)/);
    assert.ok(host.indexOf('uri("side.js")') > 0 && host.indexOf('uri("side.js")') < host.indexOf('uri("chat.js")'));
    assert.match(css, /^\.side \{[^}]*border-left: 2px solid var\(--accent\)/m);
  });
  await check("the offer card: two rows, the countdown at the left and both buttons together at the right", () => {
    assert.match(chatJs, /class: "offer-top"/); assert.match(chatJs, /class: "offer-bottom"/); assert.match(chatJs, /class: "offer-btns"/);
    assert.match(css, /^\.offer \{[^}]*flex-direction: column/m);
    assert.match(css, /^\.offer-btns \{[^}]*margin-left: auto/m);
  });

  // The host's message switch hands sideAsk / sideStop to the side chats and doesn't touch the chat's own state.
  const load = Module._load;
  const vscode = { workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => ({ get: (k, d) => d, inspect: () => undefined }), onDidChangeConfiguration: () => ({ dispose() {} }) },
    window: {}, env: { appRoot: "/unused" }, commands: { executeCommand: async () => {} }, Uri: { file: (f) => ({ scheme: "file", fsPath: f }), joinPath: () => ({}) }, ConfigurationTarget: { Global: 1 },
    EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
  Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
  const { ChatView } = require("../extension/lib/chat");
  await check("the chat's message switch: sideAsk and sideStop go to the side chats; status and messages stay as they are", async () => {
    const calls = [], t = { id: "t1", status: "running", messages: [{ role: "user" }, { role: "assistant", blocks: [] }] };
    const chat = Object.create(ChatView.prototype);
    Object.assign(chat, { tab: (id) => (id === "t1" ? t : null), active: () => t, sideChats: { ask: (tab, m) => calls.push(["ask", tab.id, m.index, m.thread]), stop: (id, th) => calls.push(["stop", id, th]) } });
    await chat.handle({ type: "sideAsk", tabId: "t1", index: 1, thread: "a1", quote: "q", question: "x" }, null);
    await chat.handle({ type: "sideAsk", tabId: "t1", index: "1; drop", thread: "a1", question: "x" }, null);
    await chat.handle({ type: "sideStop", tabId: "t1", thread: "a1" }, null);
    assert.deepStrictEqual(calls, [["ask", "t1", 1, "a1"], ["stop", "t1", "a1"]]);
    assert.strictEqual(t.status, "running");
  });
  Module._load = load;

  console.log(failed ? `side-page: ${failed} FAILED` : "side-page: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
