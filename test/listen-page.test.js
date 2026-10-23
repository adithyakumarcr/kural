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
const PAUSE = 0.09, PAUSE_PART = 0.24;   // (media/listen.js: between sentences of one part, and when the part changes)

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
    a.append(el("div", { class: "answer-actions" }, L.button(m, i)));
    const node = el("div", { class: "msg assistant", "data-i": String(i) }, a);
    if (old) old.replaceWith(node); else root.append(node);
  };
  L = make({ el, icon, post: (m) => sent.push(m), tab: () => tab, root: () => root, rerender: (i) => { draw(i); L.retag(); },
    AudioContext: Ctx, every: (fn) => { ticks.push(fn); return ticks.length; }, stopEvery: () => {} });
  draw(1);
  const tick = () => ticks.forEach((f) => f());
  const btn = () => root.querySelector('[data-i="1"] .listen-btn');
  const bar = () => L.dock.querySelector(".listen-bar");   // (the player above the chat box)
  // (Voiced from end to end: a clip's silent edges are trimmed, media/listen.js voiced.)
  const audio = (seq, block, secs, text = `sentence ${seq}`, n = seq, gen = 0) => L.onMessage({ type: "listenAudio", tabId: "t1", index: 1, seq, n, gen, block, text, pcm: new Int16Array(Math.round(secs * 100)).fill(3000), rate: 100 });
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
  await check("the new blocks are numbered: the point first, callouts, quotes, nested lists once", () => {
    const a = el("div", { class: "answer" }, el("div", { class: "blk", "data-b": "0" },
      el("div", { class: "sum" }, el("div", { class: "sum-label" }, "Done"), el("p", {}, "Each chat reopens.")),
      el("div", { class: "callout c-warning" }, el("div", { class: "callout-head" }, el("i"), el("span", {}, "Watch out")), el("p", {}, "Two windows.")),
      el("div", { class: "md-quote" }, el("p", {}, "Quoted.")),
      el("ul", {}, el("li", {}, "a", el("ul", {}, el("li", {}, "b"))), el("li", {}, "c"))));
    const blocks = page().L.numberBlocks(a);
    assert.deepStrictEqual(blocks.map((b) => [b.kind, b.text]), [["p", "Done: Each chat reopens."], ["p", "Watch out: Two windows."], ["p", "Quoted."], ["list", "- ab\n- c"]]);
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
  await check("click: listenStart with the blocks; the bar shows; the sounds are scheduled one after the other, a short pause between", () => {
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
    for (let k = 1; k < s.length; k++) assert.ok(Math.abs(s[k].when - (s[k - 1].when + s[k - 1].dur + PAUSE_PART)) < 1e-9, `${k}`);   // (each in another part)
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
    assert.ok(Math.abs(s[1].when - (s[0].when + 2 + PAUSE_PART)) < 1e-9);
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
    msg(0, new Int16Array(200).fill(900).buffer);
    msg(1, Array.from({ length: 300 }, () => 900));
    const obj = {}; for (let k = 0; k < 100; k++) obj[k] = 900;
    msg(2, obj);
    assert.deepStrictEqual(live(ctx).map((x) => x.dur), [2, 3, 1]);
  });
  await check("the player sits above the chat box, not in the answer", () => {
    const p = page(); p.btn().on.click(); p.audio(0, 0, 2);
    assert.ok(p.bar(), "in the dock");
    assert.strictEqual(p.root.querySelector(".listen-bar"), null, "not in the answer");
    assert.ok(!p.L.dock.classList.contains("hidden"));
    p.bar().querySelector(".listen-close").on.click();
    assert.ok(p.L.dock.classList.contains("hidden"));
  });
  await check("three lines: the sentence before, the one being spoken, the next", () => {
    const p = page(); p.btn().on.click(); const ctx = Ctx.last;
    p.audio(0, 0, 2, "First one."); p.audio(1, 1, 2, "Second one."); p.audio(2, 2, 2, "Third one.");
    ctx.currentTime = live(ctx)[0].when + 2.5; p.tick();
    const lines = p.L.dock.querySelectorAll(".listen-line").map((n) => [n.textContent, n.classList.contains("cur")]);
    assert.deepStrictEqual(lines, [["First one.", false], ["Second one.", true], ["Third one.", false]]);
  });
  await check("the speed menu: 0.5x to 2x; the one in use shown; preparing tells the default", () => {
    const p = page(); p.btn().on.click();
    p.L.onMessage({ type: "listenState", tabId: "t1", index: 1, phase: "preparing", speed: 1.25 });
    const btn = p.bar().querySelector(".listen-speed-btn");
    assert.strictEqual(btn.textContent, "1.25x");
    btn.on.click();
    const opts = p.bar().querySelectorAll(".listen-speed");
    assert.deepStrictEqual(opts.map((o) => o.textContent), ["0.5x", "0.75x", "1x", "1.25x", "1.5x", "2x"]);
    assert.ok(opts[3].classList.contains("on"));
  });
  await check("a new speed: the host is told from which sentence; what's queued from there is dropped; older audio ignored", () => {
    const p = page(); p.btn().on.click(); const ctx = Ctx.last;
    p.audio(0, 0, 2, "First.", 0); p.audio(1, 1, 2, "Second.", 1); p.audio(2, 2, 2, "Third.", 2);
    ctx.currentTime = live(ctx)[0].when + 2.5; p.tick();   // (in "Second.")
    p.bar().querySelector(".listen-speed-btn").on.click();
    p.bar().querySelectorAll(".listen-speed").find((o) => o.textContent === "1.5x").on.click();
    assert.deepStrictEqual(p.sent.filter((m) => m.type === "listenSpeed"), [{ type: "listenSpeed", tabId: "t1", index: 1, speed: 1.5, from: 1 }]);
    assert.strictEqual(live(ctx).length, 0, "sentence 1 on stopped, waiting for the new ones");
    p.audio(3, 2, 2, "Third.", 2, 0);   // (old speed, still on its way)
    assert.strictEqual(live(ctx).length, 0);
    p.audio(4, 1, 1, "Second.", 1, 1);
    const s = live(ctx);
    assert.strictEqual(s.length, 1); assert.strictEqual(s[0].dur, 1);
    assert.strictEqual(p.bar().querySelector(".listen-speed-btn").textContent, "1.5x");
  });
  await check("a new speed after the host's end: the player waits for the new sentences instead of closing", () => {
    const p = page(); p.btn().on.click(); const ctx = Ctx.last;
    p.audio(0, 0, 2, "First.", 0); p.audio(1, 1, 2, "Second.", 1);
    p.L.onMessage({ type: "listenEnd", tabId: "t1", index: 1 });
    ctx.currentTime = live(ctx)[0].when + 0.5; p.tick();
    p.bar().querySelector(".listen-speed-btn").on.click();
    p.bar().querySelectorAll(".listen-speed").find((o) => o.textContent === "2x").on.click();
    ctx.currentTime += 5; p.tick();
    assert.ok(p.bar(), "still open");
    p.audio(2, 0, 1, "First.", 0, 1); p.L.onMessage({ type: "listenEnd", tabId: "t1", index: 1 });
    ctx.currentTime += 3; p.tick();
    assert.strictEqual(p.bar(), null, "closes after the new end");
  });
  await check("one flow: a clip's silent edges are trimmed (a little kept, faded), sentences of one part get a short pause", () => {
    const p = page(); p.btn().on.click(); const ctx = Ctx.last;
    const clip = (silentBefore, voiced, silentAfter) => { const a = new Int16Array(silentBefore + voiced + silentAfter); a.fill(3000, silentBefore, silentBefore + voiced); return a; };
    p.L.onMessage({ type: "listenAudio", tabId: "t1", index: 1, seq: 0, n: 0, block: 0, text: "One.", pcm: clip(30, 100, 40), rate: 100 });
    p.L.onMessage({ type: "listenAudio", tabId: "t1", index: 1, seq: 1, n: 1, block: 0, text: "Two.", pcm: clip(25, 200, 50), rate: 100 });
    const s = live(ctx);
    // 100 voiced samples + 3 before (0.03 s) + 8 after (0.08 s), at 100 a second. (The real voice left 0.35-0.5 s before
    // and 0.4-0.65 s after each sentence: measured 22 Oct 2026.)
    assert.ok(Math.abs(s[0].dur - 1.11) < 1e-9, String(s[0].dur)); assert.ok(Math.abs(s[1].dur - 2.11) < 1e-9, String(s[1].dur));
    assert.ok(Math.abs(s[1].when - (s[0].when + s[0].dur + PAUSE)) < 1e-9);
    // A clip of silence only is left out.
    p.L.onMessage({ type: "listenAudio", tabId: "t1", index: 1, seq: 2, n: 2, block: 0, text: "…", pcm: new Int16Array(50), rate: 100 });
    assert.strictEqual(live(ctx).length, 2);
  });
  await check("several sentences in one sound: each its share (by length) for the lines, played as one", () => {
    const p = page(); p.btn().on.click(); const ctx = Ctx.last;
    p.L.onMessage({ type: "listenAudio", tabId: "t1", index: 1, seq: 0, n: 3, block: 1, text: "Short. A longer one.", rate: 100, pcm: new Int16Array(300).fill(3000),
      group: [{ n: 3, text: "Short.", w: 1 }, { n: 4, text: "A longer one.", w: 2 }] });
    const s = live(ctx);
    assert.strictEqual(s.length, 2);
    assert.ok(Math.abs(s[1].when - (s[0].when + 1)) < 1e-9, "no pause inside one sound");
    assert.ok(Math.abs(s[1].offset - 1) < 1e-9, "the second part starts a third of the way in");
    ctx.currentTime = s[0].when + 1.5; p.tick();
    assert.match(p.bar().textContent, /A longer one\./);
    const lines = p.L.dock.querySelectorAll(".listen-line").map((n) => n.textContent);
    assert.deepStrictEqual(lines, ["Short.", "A longer one.", ""]);
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
