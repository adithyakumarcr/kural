// Voice input on the chat page (extension/media/voice.js) with a fake microphone, MediaRecorder and audio decoding: the ask
// bar, the download, recording (timer, chunks of 1 s, stop at 5:00), Esc, inserting at the cursor, Undo, errors, and
// that a tab switch cancels a recording. No browser starts.
const assert = require("assert");
const make = require("../extension/media/voice.js");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const tick = () => new Promise((r) => setImmediate(r));

// ---- a tiny DOM ----
class Node {
  constructor(tag, attrs = {}, kids = []) { this.tag = tag; this.attrs = { ...attrs }; this.kids = []; this.cls = new Set(String(attrs.class || "").split(/\s+/).filter(Boolean)); this.append(...kids); this.disabled = false; }
  append(...ks) { for (const k of ks) if (k !== false && k != null && k !== "") this.kids.push(typeof k === "object" ? k : new Node("#text", { text: String(k) })); }
  replaceChildren(...ks) { this.kids = []; this.append(...ks); }
  get classList() { return { add: (c) => this.cls.add(c), remove: (c) => this.cls.delete(c), contains: (c) => this.cls.has(c), toggle: (c, on) => { if (on === undefined ? !this.cls.has(c) : on) this.cls.add(c); else this.cls.delete(c); } }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  get textContent() { return this.tag === "#text" ? this.attrs.text : this.kids.map((k) => k.textContent).join(""); }
  set textContent(t) { this.kids = [new Node("#text", { text: t })]; }
  find(fn) { if (fn(this)) return this; for (const k of this.kids) { const f = k.find && k.find(fn); if (f) return f; } return null; }
  button(label) { return this.find((n) => n.tag === "button" && n.textContent === label); }
  click() { this.attrs.onclick(); }
  get style() { return this._style || (this._style = {}); }
}
const el = (tag, attrs = {}, ...kids) => new Node(tag, attrs, kids.flat());
const icon = (name) => el("i", { class: `codicon codicon-${name}` });

// ---- fake media ----
function fakeMedia({ deny, seconds = 2.5 } = {}) {
  const m = { tracksStopped: 0, recorders: [] };
  m.getUserMedia = async () => { if (deny) { const e = new Error("Permission denied"); e.name = deny; throw e; } return { getTracks: () => [{ stop: () => m.tracksStopped++ }] }; };
  m.MediaRecorder = class { constructor() { this.state = "inactive"; m.recorders.push(this); } start() { this.state = "recording"; }
    stop() { this.state = "inactive"; setImmediate(() => { this.ondataavailable && this.ondataavailable({ data: { size: 10, arrayBuffer: async () => new ArrayBuffer(8) } }); this.onstop && this.onstop(); }); } };
  m.AudioContext = class { createMediaStreamSource() { return { connect() {} }; } createAnalyser() { return { fftSize: 512, getByteTimeDomainData(a) { a.fill(160); } }; }
    decodeAudioData() { return Promise.resolve({ duration: seconds }); } close() { return Promise.resolve(); } };
  m.OfflineAudioContext = class { constructor(ch, len, rate) { this.len = len; this.rate = rate; m.offline = this; this.destination = {}; }
    createBufferSource() { return { connect() {}, start() {} }; }
    startRendering() { const d = new Float32Array(this.len); d[0] = 0.25; return Promise.resolve({ getChannelData: () => d }); } };
  return m;
}

function setup(over = {}) {
  const posts = [], inserted = [];
  let tab = { id: "t1", visiting: false }, clock = 0;
  const media = over.media || fakeMedia(over);
  const v = make({ el, icon, post: (m) => posts.push(m), tab: () => tab, media, now: () => clock,
    insertText: (text) => { const n = { data: text, isConnected: true }; inserted.push(n); return n; },
    every: (fn) => { v.__tick = fn; return 1; }, stopEvery: () => {}, isMac: over.isMac || false });
  return { v, posts, inserted, media, setTab: (t) => { tab = t; }, advance: (ms) => { clock += ms; v.__tick && v.__tick(); }, bar: () => v.bar };
}
const types = (posts) => posts.map((p) => p.type);

(async () => {
  await check("click with phase ask shows the exact ask text and Download / Not now", async () => {
    const { v, posts, bar } = setup();
    v.button.click();
    assert.deepStrictEqual(posts[0], { type: "voiceStart", tabId: "t1" });
    v.onState({ type: "voiceState", tabId: "t1", phase: "ask" });
    assert.ok(bar().textContent.includes("Voice input needs Whisper, a speech model that runs on this computer (about 60 MB, once). Nothing you say leaves it."));
    assert.ok(bar().button("Download") && bar().button("Not now"));
    bar().button("Not now").click();
    assert.ok(bar().cls.has("hidden"));
  });

  await check("Download posts voiceDownload; progress shows \"Downloading Whisper… 42 %\" and Stop", async () => {
    const { v, posts, bar } = setup();
    v.button.click(); v.onState({ tabId: "t1", phase: "ask" });
    bar().button("Download").click();
    assert.deepStrictEqual(posts[posts.length - 1], { type: "voiceDownload", tabId: "t1" });
    v.onState({ tabId: "t1", phase: "downloading", pct: 42 });
    assert.ok(bar().textContent.includes("Downloading Whisper… 42 %"));
    bar().button("Stop").click();
    assert.deepStrictEqual(posts[posts.length - 1], { type: "voiceDownloadStop" });
  });

  await check("recording shows a timer and level; a second click stops and posts the chunks of 16000 samples then voiceStop", async () => {
    const { v, posts, bar, advance, media } = setup({ seconds: 2.5 });
    v.button.click(); v.onState({ tabId: "t1", phase: "recording" }); await tick();
    assert.ok(v.button.cls.has("recording"));
    advance(65000);
    assert.ok(bar().textContent.includes("1:05"), bar().textContent);
    v.button.click(); await tick(); await tick(); await tick();
    const chunks = posts.filter((p) => p.type === "voiceChunk");
    assert.deepStrictEqual(chunks.map((c) => [c.seq, c.samples.length]), [[0, 16000], [1, 16000], [2, 8000]]);
    assert.strictEqual(chunks[0].samples[0], 0.25);
    assert.deepStrictEqual(posts[posts.length - 1], { type: "voiceStop", tabId: "t1" });
    assert.strictEqual(media.offline.rate, 16000);
    assert.strictEqual(media.tracksStopped, 1, "the microphone is released");
  });

  await check("Esc while recording posts voiceCancel and inserts nothing", async () => {
    const { v, posts, inserted, media } = setup();
    v.button.click(); v.onState({ tabId: "t1", phase: "recording" }); await tick();
    assert.strictEqual(v.escape(), true);
    await tick(); await tick();
    assert.deepStrictEqual(posts[posts.length - 1], { type: "voiceCancel", tabId: "t1" });
    assert.ok(!types(posts).includes("voiceChunk") && !inserted.length);
    assert.strictEqual(media.tracksStopped, 1);
    assert.strictEqual(v.escape(), false, "nothing left to cancel");
  });

  await check("done inserts the text at the cursor and shows \"From your voice · Undo\"", async () => {
    const { v, inserted, bar } = setup();
    v.onState({ tabId: "t1", phase: "done", raw: "um add a a test", text: "Add a test.", cleaned: true, model: "Haiku" });
    assert.strictEqual(inserted[0].data, "Add a test.");
    assert.ok(bar().textContent.includes("From your voice") && bar().button("Undo"));
  });

  await check("Undo replaces the cleaned text with the raw transcript", async () => {
    const { v, inserted, bar } = setup();
    v.onState({ tabId: "t1", phase: "done", raw: "um add a a test", text: "Add a test.", cleaned: true });
    bar().button("Undo").click();
    assert.strictEqual(inserted[0].data, "um add a a test");
    assert.ok(bar().cls.has("hidden"));
  });

  await check("not cleaned up: the raw text goes in and the bar says why", async () => {
    const { v, inserted, bar } = setup();
    v.onState({ tabId: "t1", phase: "done", raw: "add a test", text: "add a test", cleaned: false, why: "No AI is set up, so the text isn't cleaned up." });
    assert.strictEqual(inserted[0].data, "add a test");
    assert.ok(bar().textContent.includes("No AI is set up") && !bar().button("Undo"));
  });

  await check("permission refused shows the Mac hint \"Allow Kural in System Settings > Privacy & Security > Microphone\"", async () => {
    const { v, posts, bar } = setup({ deny: "NotAllowedError", isMac: true });
    v.button.click(); v.onState({ tabId: "t1", phase: "recording" }); await tick(); await tick();
    assert.ok(bar().textContent.includes("Allow Kural in System Settings > Privacy & Security > Microphone"), bar().textContent);
    assert.deepStrictEqual(posts[posts.length - 1], { type: "voiceCancel", tabId: "t1" });
    const other = setup({ deny: "NotFoundError" });
    other.v.button.click(); other.v.onState({ tabId: "t1", phase: "recording" }); await tick(); await tick();
    assert.ok(other.bar().textContent.includes("No microphone found"));
  });

  await check("the button is disabled while transcribing and cleaning, hidden in a visiting chat", async () => {
    const { v, posts, setTab, bar } = setup();
    v.onState({ tabId: "t1", phase: "transcribing" });
    assert.ok(v.button.disabled && bar().textContent.includes("Transcribing…"));
    v.onState({ tabId: "t1", phase: "cleaning" });
    assert.ok(v.button.disabled && bar().textContent.includes("Cleaning up…"));
    const n = posts.length; v.button.attrs.onclick(); assert.strictEqual(posts.length, n, "a click does nothing");
    setTab({ id: "t2", visiting: true }); v.render();
    assert.ok(v.button.cls.has("hidden"));
  });

  await check("at 5:00 it stops by itself", async () => {
    const { v, posts, advance } = setup({ seconds: 300 });
    v.button.click(); v.onState({ tabId: "t1", phase: "recording" }); await tick();
    advance(300000); await tick(); await tick(); await tick();
    assert.deepStrictEqual(posts[posts.length - 1], { type: "voiceStop", tabId: "t1" });
  });

  await check("switching tabs while recording cancels it", async () => {
    const { v, posts, setTab } = setup();
    v.button.click(); v.onState({ tabId: "t1", phase: "recording" }); await tick();
    setTab({ id: "t2" }); v.tabChanged(); await tick();
    assert.deepStrictEqual(posts[posts.length - 1], { type: "voiceCancel", tabId: "t1" });
  });

  await check("states for another tab are ignored", async () => {
    const { v, inserted } = setup();
    v.onState({ tabId: "t9", phase: "done", raw: "x", text: "x", cleaned: true });
    assert.strictEqual(inserted.length, 0);
  });

  console.log(failed ? `voice-page: ${failed} FAILED` : "voice-page: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
