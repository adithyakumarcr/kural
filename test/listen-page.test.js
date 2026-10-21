// Listen on the chat page (extension/media/listen.js) on a small DOM with a stand-in AudioContext: numbering the answer's
// rendered blocks, the button, the bar and its pop-up, sounds scheduled back to back, Pause, Rewind 5 s, the highlight
// and when it scrolls, redraws, and stopping when the pane shows another chat.
const assert = require("assert");
const make = require("../extension/media/listen.js");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

// ---- a small DOM: tags, classes, attributes, children, textContent, closest and simple descendant selectors ----
class Node {
  constructor(tag, text) { this.tagName = String(tag).toUpperCase(); this.text = text; this.attrs = {}; this.kids = []; this.parent = null; this.cls = new Set(); this.on = {}; this.scrolled = 0; }
  get children() { return this.kids.filter((k) => k.tagName !== "#TEXT"); }
  get classList() { return { add: (c) => this.cls.add(c), remove: (c) => this.cls.delete(c), contains: (c) => this.cls.has(c), toggle: (c, on) => (on ? this.cls.add(c) : this.cls.delete(c)) }; }
  set className(s) { this.cls = new Set(String(s).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { this.on[t] = f; }
  append(...ks) { for (const k of ks.flat(Infinity)) { if (k == null || k === false) continue; const n = typeof k === "object" ? k : new Node("#text", String(k)); n.parent = this; this.kids.push(n); } }
  replaceChildren(...ks) { this.kids = []; this.append(...ks); }
  replaceWith(n) { const i = this.parent.kids.indexOf(this); n.parent = this.parent; this.parent.kids[i] = n; }
  remove() { if (this.parent) this.parent.kids.splice(this.parent.kids.indexOf(this), 1); this.parent = null; }
  get textContent() { return this.text !== undefined ? this.text : this.kids.map((k) => k.textContent).join(""); }
  set textContent(v) { this.kids = []; this.append(String(v)); }
  scrollIntoView() { this.scrolled++; }
  matches(compound) {
    const m = /^([a-z0-9]*)((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)$/i.exec(compound);
    if (!m) throw new Error(`selector ${compound}`);
    if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
    for (const c of (m[2].match(/\.[\w-]+/g) || [])) if (!this.cls.has(c.slice(1))) return false;
    for (const a of (m[3].match(/\[[\w-]+(?:="[^"]*")?\]/g) || [])) { const [, k, v] = /\[([\w-]+)(?:="([^"]*)")?\]/.exec(a); if (v === undefined ? !(k in this.attrs) : this.attrs[k] !== v) return false; }
    return true;
  }
  closest(sel) { for (let n = this; n; n = n.parent) if (n.tagName !== "#TEXT" && n.matches(sel)) return n; return null; }
  querySelectorAll(sel) {
    const parts = sel.trim().split(/\s+/), out = [];
    const walk = (n) => { for (const k of n.children) { let ok = k.matches(parts[parts.length - 1]); for (let i = parts.length - 2, a = k.parent; ok && i >= 0; i--) { while (a && a !== this && !a.matches(parts[i])) a = a.parent; if (!a || a === this) ok = false; else a = a.parent; } if (ok) out.push(k); walk(k); } };
    walk(this); return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
const el = (tag, props = {}, ...kids) => {
  const n = new Node(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v; else if (k.startsWith("on")) n.on[k.slice(2)] = v; else n.setAttribute(k, v === true ? "" : v);
  }
  n.append(...kids);
  return n;
};
const icon = (name) => el("i", { class: `codicon codicon-${name}` });

// ---- a stand-in AudioContext: buffers, sources that record start(when, offset), a clock the test moves ----
class Ctx {
  constructor() { this.currentTime = 0; this.state = "running"; this.started = []; this.destination = {}; Ctx.last = this; }
  createBuffer(ch, length, rate) { const data = new Float32Array(length); return { length, sampleRate: rate, duration: length / rate, getChannelData: () => data }; }
  createBufferSource() { const ctx = this; const s = { buffer: null, stopped: false, connect() {}, start(when, offset = 0) { ctx.started.push({ s, when, offset, dur: s.buffer.duration }); }, stop() { s.stopped = true; } }; return s; }
  resume() { this.state = "running"; this.resumed = (this.resumed || 0) + 1; return Promise.resolve(); }
  suspend() { this.state = "suspended"; this.suspended = (this.suspended || 0) + 1; return Promise.resolve(); }
}
const live = (ctx) => ctx.started.filter((x) => !x.s.stopped);

function page({ visiting = false, why = "" } = {}) {
  const sent = [], ticks = [];
  const tab = { id: "t1", visiting, listenWhy: why, messages: [{ role: "user" }, { role: "assistant", blocks: [] }] };
  const root = el("div", { class: "list" });
  let L;
  const answer = () => el("div", { class: "answer" },
    el("div", { class: "steps" }, el("div", { class: "blk interim", "data-b": "0" }, el("p", {}, "thinking text"))),
    el("div", { class: "blk", "data-b": "1" },
      el("p", {}, "The login broke."), el("ul", {}, el("li", {}, "one"), el("li", {}, "two")),
      el("div", { class: "code" }, el("div", { class: "code-head" }, el("button", {}, "Copy")), el("pre", {}, "token.refresh()")),
      el("div", { class: "table-wrap" }, el("table", {}, el("tr", {}, el("th", {}, "a"), el("th", {}, "b")), el("tr", {}, el("td", {}, "1"), el("td", {}, "2")))),
      el("h3", {}, "Next"), el("hr")));
  const draw = (i) => {
    const old = root.querySelector(`[data-i="${i}"]`);
    const m = tab.messages[i];
    const a = answer();
    const bar = L.bar(m, i); if (bar) a.kids.unshift(bar), bar.parent = a;
    a.append(el("div", { class: "answer-actions" }, L.button(m, i)));
    const node = el("div", { class: "msg assistant", "data-i": String(i) }, a);
    if (old) old.replaceWith(node); else root.append(node);
  };
  L = make({ el, icon, post: (m) => sent.push(m), tab: () => tab, root: () => root, rerender: (i) => { draw(i); L.retag(); },
    AudioContext: Ctx, every: (fn) => { ticks.push(fn); return ticks.length; }, stopEvery: () => {} });
  draw(1);
  const tick = () => ticks.forEach((f) => f());
  const btn = () => root.querySelector('[data-i="1"] .listen-btn');
  const bar = () => root.querySelector('[data-i="1"] .listen-bar');
  const audio = (seq, block, secs, text = `sentence ${seq}`) => L.onMessage({ type: "listenAudio", tabId: "t1", index: 1, seq, block, text, pcm: new Int16Array(Math.round(secs * 100)), rate: 100 });
  return { L, tab, root, sent, tick, btn, bar, audio, draw };
}

(async () => {
  await check("numberBlocks: the answer's paragraphs, lists, code, tables and headings outside the steps, tagged", () => {
    const p = page();
    const blocks = p.L.numberBlocks(p.root.querySelector('[data-i="1"] .answer'));
    assert.deepStrictEqual(blocks.map((b) => [b.n, b.kind]), [[0, "p"], [1, "list"], [2, "code"], [3, "table"], [4, "heading"]]);
    assert.strictEqual(blocks[2].text, "token.refresh()");
    assert.ok(/a \| b/.test(blocks[3].text) && /1 \| 2/.test(blocks[3].text));
    assert.strictEqual(p.root.querySelectorAll("[data-lb]").length, 5);
    assert.strictEqual(p.root.querySelector(".steps p").getAttribute("data-lb"), null);
  });
  await check("the button: shown on a finished answer, not while it runs or in a read-only chat; disabled with the reason", () => {
    const p = page();
    assert.ok(p.btn() && p.btn().getAttribute("aria-label") === "Listen");
    assert.strictEqual(p.L.button({ role: "assistant", running: true }, 1), null);
    assert.strictEqual(page({ visiting: true }).btn(), null);
    const q = page({ why: "Listen needs Claude, Gemini or a model on this computer to write the walkthrough." });
    assert.ok(q.btn().getAttribute("disabled") !== null && /needs Claude/.test(q.btn().getAttribute("title")));
  });
  await check("pointing at it warms the voice", () => {
    const p = page(); p.btn().on.pointerenter(); assert.deepStrictEqual(p.sent, [{ type: "listenWarm", tabId: "t1" }]);
  });
  await check("an answer with nothing to explain says so and asks nothing", () => {
    const p = page();
    p.root.querySelector('[data-i="1"] .blk[data-b="1"]').replaceChildren();
    p.btn().on.click();
    assert.deepStrictEqual(p.sent, []);
    assert.match(p.bar().textContent, /Nothing to explain in this answer\./);
  });
  await check("click: listenStart with the blocks; the bar shows; the sounds are scheduled back to back", () => {
    const p = page();
    p.btn().on.click();
    const start = p.sent.find((m) => m.type === "listenStart");
    assert.strictEqual(start.tabId, "t1"); assert.strictEqual(start.index, 1); assert.strictEqual(start.blocks.length, 5);
    assert.ok(p.bar(), "the bar");
    const ctx = Ctx.last;
    p.L.onMessage({ type: "listenState", tabId: "t1", index: 1, phase: "playing" });
    p.audio(0, null, 1); p.audio(1, 0, 2); p.audio(2, 2, 3);
    const s = live(ctx);
    assert.strictEqual(s.length, 3);
    for (let k = 1; k < s.length; k++) assert.ok(Math.abs(s[k].when - (s[k - 1].when + s[k - 1].dur)) < 1e-9, `${k}`);
    assert.ok(s.every((x) => x.offset === 0));
  });
  await check("the bar shows the sentence being spoken and its block is highlighted and scrolled to", () => {
    const p = page(); p.btn().on.click(); const ctx = Ctx.last;
    p.audio(0, 0, 2, "First one."); p.audio(1, 2, 2, "Second one.");
    ctx.currentTime = live(ctx)[0].when + 2.5; p.tick();
    assert.match(p.bar().textContent, /Second one\./);
    const on = p.root.querySelectorAll(".listen-on");
    assert.strictEqual(on.length, 1); assert.strictEqual(on[0].getAttribute("data-lb"), "2");
    assert.ok(on[0].scrolled > 0);
  });
  await check("Pause suspends the sound, Play resumes it", () => {
    const p = page(); p.btn().on.click(); const ctx = Ctx.last; p.audio(0, 0, 2);
    p.bar().querySelector(".listen-pause").on.click(); assert.strictEqual(ctx.suspended, 1);
    p.bar().querySelector(".listen-pause").on.click(); assert.ok(ctx.resumed >= 1 && ctx.state === "running");
  });
  await check("Rewind 5 s goes back across sentences: at 7 s into two 4-second ones, the first from 2 s; at 3 s, from 0", () => {
    const p = page(); p.btn().on.click(); const ctx = Ctx.last;
    p.audio(0, 0, 4); p.audio(1, 1, 4);
    const t0 = live(ctx)[0].when;
    ctx.currentTime = t0 + 7; p.bar().querySelector(".listen-rewind").on.click();
    let s = live(ctx);
    assert.strictEqual(s.length, 2);
    assert.ok(Math.abs(s[0].offset - 2) < 1e-9 && s[1].offset === 0);
    assert.ok(Math.abs(s[1].when - (s[0].when + 2)) < 1e-9);
    ctx.currentTime = s[0].when + 1; p.bar().querySelector(".listen-rewind").on.click();
    s = live(ctx);
    assert.strictEqual(s[0].offset, 0);
  });
  await check("after you scroll the chat it stops scrolling for you, until Play or Rewind", () => {
    const p = page(); p.btn().on.click(); const ctx = Ctx.last;
    p.audio(0, 0, 2); p.audio(1, 1, 2);
    p.root.on.wheel();
    ctx.currentTime = live(ctx)[0].when + 2.5; p.tick();
    const on = p.root.querySelector(".listen-on");
    assert.strictEqual(on.getAttribute("data-lb"), "1");
    assert.strictEqual(on.scrolled, 0);
    p.bar().querySelector(".listen-rewind").on.click(); p.tick();
    assert.ok(p.root.querySelector(".listen-on").scrolled > 0);
  });
  await check("a redraw of the answer keeps the highlight on the new element", () => {
    const p = page(); p.btn().on.click(); const ctx = Ctx.last;
    p.audio(0, 3, 2); ctx.currentTime = live(ctx)[0].when + 0.5; p.tick();
    p.draw(1); p.L.retag();
    const on = p.root.querySelectorAll(".listen-on");
    assert.strictEqual(on.length, 1); assert.strictEqual(on[0].getAttribute("data-lb"), "3");
  });
  await check("the pane showing another chat stops it and tells the host", () => {
    const p = page(); p.btn().on.click(); const ctx = Ctx.last; p.audio(0, 0, 2);
    p.L.onFull("t2");
    assert.ok(p.sent.some((m) => m.type === "listenStop" && m.tabId === "t1" && m.index === 1));
    assert.strictEqual(live(ctx).length, 0);
  });
  await check("the host saying stopped closes the bar and silences it", () => {
    const p = page(); p.btn().on.click(); const ctx = Ctx.last; p.audio(0, 0, 2);
    assert.strictEqual(p.L.onMessage({ type: "listenState", tabId: "t1", index: 1, phase: "stopped" }), true);
    assert.strictEqual(p.bar(), null); assert.strictEqual(live(ctx).length, 0);
  });
  await check("the button while playing stops (a toggle)", () => {
    const p = page(); p.btn().on.click(); p.audio(0, 0, 2);
    p.btn().on.click();
    assert.ok(p.sent.some((m) => m.type === "listenStop"));
    assert.strictEqual(p.bar(), null);
  });
  await check("ask: the exact pop-up text with Download and Cancel; Download asks the host", () => {
    const p = page(); p.btn().on.click();
    p.L.onMessage({ type: "listenState", tabId: "t1", index: 1, phase: "ask", size: 430e6, model: "Haiku 4.5" });
    assert.match(p.bar().textContent, /Listen needs a voice: about 430 MB, downloaded once\. The voice is made on this computer; the walkthrough's words are written by Haiku 4\.5 from this answer\./);
    p.bar().querySelector(".listen-download").on.click();
    assert.ok(p.sent.some((m) => m.type === "listenDownload" && m.tabId === "t1"));
    p.L.onMessage({ type: "listenState", tabId: "t1", index: 1, phase: "downloading", pct: 42 });
    assert.match(p.bar().textContent, /42%/);
  });
  await check("an error shows its message; ✕ closes it", () => {
    const p = page(); p.btn().on.click();
    p.L.onMessage({ type: "listenState", tabId: "t1", index: 1, phase: "error", message: "The voice stopped. Try again." });
    assert.match(p.bar().textContent, /The voice stopped\. Try again\./);
    p.bar().querySelector(".listen-close").on.click();
    assert.strictEqual(p.bar(), null);
  });
  await check("the end: once the last sound has played, the bar closes and the highlight goes", () => {
    const p = page(); p.btn().on.click(); const ctx = Ctx.last;
    p.audio(0, 0, 1); p.L.onMessage({ type: "listenEnd", tabId: "t1", index: 1 });
    ctx.currentTime = live(ctx)[0].when + 1.5; p.tick();
    assert.strictEqual(p.bar(), null);
    assert.strictEqual(p.root.querySelectorAll(".listen-on").length, 0);
  });
  await check("audio that arrives as an ArrayBuffer, a plain array or a numbered object still plays, at its length", () => {
    const p = page(); p.btn().on.click(); const ctx = Ctx.last;
    const msg = (seq, pcm) => p.L.onMessage({ type: "listenAudio", tabId: "t1", index: 1, seq, block: 0, text: "x", pcm, rate: 100 });
    msg(0, new Int16Array(200).buffer);
    msg(1, Array.from({ length: 300 }, () => 5));
    const obj = {}; for (let k = 0; k < 100; k++) obj[k] = 7;
    msg(2, obj);
    assert.deepStrictEqual(live(ctx).map((x) => x.dur), [2, 3, 1]);
  });
  await check("messages about another chat or answer aren't Listen's business here", () => {
    const p = page();
    assert.strictEqual(p.L.onMessage({ type: "full" }), false);
    p.btn().on.click();
    assert.strictEqual(p.L.onMessage({ type: "listenAudio", tabId: "t9", index: 1, seq: 0, block: 0, text: "x", pcm: new Int16Array(10), rate: 100 }), true);
    assert.strictEqual(live(Ctx.last).length, 0);
  });
  process.exit(failed ? 1 : 0);
})();
