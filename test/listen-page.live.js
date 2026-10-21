// Listen, live, end to end without a person: the page's code (extension/media/listen.js) in headless Chrome with real Web
// Audio, connected to the real host (lib/listen/index.js) → real Haiku for the walkthrough → the real voice helper.
// Checks that the highlight moves through the blocks as the sound plays, Pause holds the sentence, Rewind 5 s goes
// back, and the bar closes at the end. Not part of npm test: needs Chrome, `claude` logged in
// and the downloaded voice (KURAL_LISTEN_DIR). KURAL_EXEC=/usr/share/kural/kural runs the voice in Kural's own program.
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const Module = require("module");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const orig = Module._load;
const vscode = { window: { createOutputChannel: () => ({ appendLine() {} }) }, workspace: { workspaceFolders: [], isTrusted: true, getConfiguration: () => ({ get: (k, d) => d, inspect: () => undefined }), onDidChangeConfiguration: () => ({ dispose() {} }) },
  env: {}, commands: { executeCommand: async () => {} }, Uri: { file: (f) => ({ scheme: "file", fsPath: f }) }, EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
Module._load = function (req, ...a) { return req === "vscode" ? vscode : orig.call(this, req, ...a); };
const ROOT = path.join(__dirname, "..");
require(ROOT + "/extension/lib/ai/claude.js").setSetupGate(() => true);
const brain = require(ROOT + "/extension/lib/ai");
const { Cdp } = require(ROOT + "/extension/lib/browser/cdp");
const { Listen } = require(ROOT + "/extension/lib/listen");
const { Speaker } = require(ROOT + "/extension/lib/listen/speaker");
const { assetsFor } = require(ROOT + "/extension/lib/listen/assets");

const CHROME = [process.env.KURAL_CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome",
  "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.log("skip: no Chrome here (set KURAL_CHROME)"); process.exit(0); }
const DIR = process.env.KURAL_LISTEN_DIR || path.join(os.homedir(), ".config/Kural/User/globalStorage/kural.kural/listen");
const EXEC = process.env.KURAL_EXEC || "/usr/share/kural/kural";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The answer as the chat draws it: a .blk of rendered markdown, with the bar on top and the actions under it.
const PAGE = `<!doctype html><meta charset="utf-8"><body><div class="list"></div><script src="/listen.js"></script><script>
window.posts = [];
const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) { if (v == null || v === false) continue;
    if (k === "class") n.className = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v); }
  for (const k of kids.flat()) if (k != null && k !== false && k !== "") n.append(k); return n; };
const list = document.querySelector(".list"), tab = { id: "t1", listenWhy: "", messages: [{ role: "user" }, { role: "assistant", blocks: [] }] };
function draw(i) {
  const a = el("div", { class: "answer" });
  a.append(el("div", { class: "blk", "data-b": "0" },
    el("p", {}, "The login broke because the access token expired after an hour and nothing refreshed it."),
    el("p", {}, "I changed the client so it keeps the refresh token and asks for a new access token a minute before the old one runs out."),
    el("div", { class: "code" }, el("div", { class: "code-head" }, "ts"), el("pre", {}, "if (token.expiresAt - Date.now() < 60_000) {\\n  token = await auth.refresh(token.refreshToken);\\n}")),
    el("ul", {}, el("li", {}, "src/api/client.ts: the refresh check"), el("li", {}, "src/auth/store.ts: keeps the refresh token")),
    el("p", {}, "Run npm test to check it; both new tests pass here.")));
  a.append(el("div", { class: "answer-actions" }, L.button(tab.messages[i], i)));
  const node = el("div", { class: "msg assistant", "data-i": String(i) }, a), old = list.querySelector('[data-i="' + i + '"]');
  if (old) old.replaceWith(node); else list.append(node);
}
window.L = KURAL_LISTEN({ el, icon: (n) => el("i", { class: "codicon codicon-" + n }), post: (m) => posts.push(m), tab: () => tab, root: () => list,
  rerender: (i) => { draw(i); L.retag(); }, AudioContext, every: (f, ms) => setInterval(f, ms), stopEvery: (id) => clearInterval(id) });
draw(1);
document.body.append(L.dock);
window.deliver = (m) => { if (m.pcm) { const b = atob(m.pcm); const u = new Uint8Array(b.length); for (let k = 0; k < b.length; k++) u[k] = b.charCodeAt(k); m.pcm = new Int16Array(u.buffer); } L.onMessage(m); };
window.peek = () => { const on = list.querySelector(".listen-on"), bar = L.dock.querySelector(".listen-bar"), t = L.dock.querySelector(".listen-line.cur");
  return { lit: on ? on.getAttribute("data-lb") : null, bar: !!bar, text: t ? t.textContent : "", lines: Array.from(L.dock.querySelectorAll(".listen-line"), (n) => n.textContent),
    speed: (L.dock.querySelector(".listen-speed-btn") || {}).textContent || "" }; };
</script>`;

function pipe(child) {
  const out = child.stdio[3], inp = child.stdio[4];
  let buf = "", onMsg = () => {}, onClose = () => {};
  inp.setEncoding("utf8");
  inp.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\0")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); onMsg(m); } });
  inp.on("close", () => onClose());
  return { send: (o) => out.write(JSON.stringify(o) + "\0"), onMessage: (f) => { onMsg = f; }, onClose: (f) => { onClose = f; }, close: () => child.kill() };
}

(async () => {
  const assets = assetsFor(DIR, "supertonic");
  if (!(await assets.ready())) { console.error(`The voice isn't in ${DIR}.`); process.exit(1); }
  const server = http.createServer((req, res) => {
    if (req.url === "/listen.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(fs.readFileSync(path.join(ROOT, "extension/media/listen.js"))); }
    res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kural-chrome-"));
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const cdp = new Cdp(pipe(chrome));
  const speaker = new Speaker({ engine: "supertonic", paths: () => assets.paths(), execPath: EXEC });
  let code = 0;
  try {
    const s = await cdp.attach();
    const js = async (expression) => (await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
    await s.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    await sleep(800);
    const toPage = [];
    let savedSpeed = 1;
    const listen = new Listen({ dir: DIR, engine: "supertonic", assets, speaker, save() {}, speed: () => savedSpeed, setSpeed: (v) => { savedSpeed = v; },
      postTo: (pane, m) => toPage.push(m.pcm ? { ...m, pcm: Buffer.from(m.pcm.buffer, m.pcm.byteOffset, m.pcm.byteLength).toString("base64") } : m),
      pick: () => ({ model: "haiku" }), nameOf: () => "Haiku",
      scriptDeps: { makeAgent: brain.makeAgent, isClaude: () => true, emptyDir: () => os.tmpdir(), cwd: () => process.cwd(), localOpts: () => null, mode: () => "ask" } });
    if (!fs.existsSync(path.join(DIR, "openers", "rate"))) await listen.makeOpeners();
    const tab = { id: "t1", messages: [{ role: "user", segments: [{ t: "text", v: "Why did the login break?" }] }, { role: "assistant", blocks: [] }] };
    // the bridge: the page's posts → the host; the host's messages → the page
    let ended = false;
    const bridge = setInterval(async () => {
      const posts = await js("posts.splice(0)");
      for (const m of posts || []) {
        if (m.type === "listenStart") listen.start("pane", tab, m.index, m.blocks);
        if (m.type === "listenStop") listen.stop(m.tabId, m.index);
        if (m.type === "listenSpeed") listen.setSpeed(m.tabId, m.index, m.speed, m.from);
      }
      while (toPage.length) { const m = toPage.shift(); if (m.type === "listenEnd") ended = true; await js(`deliver(${JSON.stringify(m)})`); }
    }, 40);

    await js(`document.querySelector(".listen-btn").click()`);
    const lits = [];
    const t0 = Date.now();
    let paused = null, rewound = null, sped = null, threeLines = false;
    while (Date.now() - t0 < 180000) {
      await sleep(250);
      const p = await js("peek()");
      if (p.lit !== null && lits[lits.length - 1] !== p.lit) lits.push(p.lit);
      if (p.lines.length === 3 && p.lines.every((l) => l && l !== "Getting ready…")) threeLines = true;
      // Later: 1.5x from the speed menu; the next sentences come at it.
      if (rewound && !sped && lits.length >= 4) {
        await js(`document.querySelector(".listen-speed-btn").click()`);
        await js(`Array.from(document.querySelectorAll(".listen-speed")).find((b) => b.textContent === "1.5x").click()`);
        await sleep(2500);
        sped = { label: (await js("peek()")).speed, saved: savedSpeed };
      }
      // After a few blocks: Pause for a second (the clock must not move), then Rewind 5 s.
      if (!paused && lits.length >= 2) {
        await js(`document.querySelector(".listen-pause").click()`);
        const a = await js("peek()"); await sleep(1000); const b = await js("peek()");
        paused = { same: a.text === b.text };
        await js(`document.querySelector(".listen-pause").click()`);
        await sleep(1500);
        const before = (await js("peek()")).lit;
        await js(`document.querySelector(".listen-rewind").click()`);
        await sleep(300);
        rewound = { before, after: (await js("peek()")).lit };
      }
      if (ended && !p.bar) break;
    }
    clearInterval(bridge);
    const blocks = [...new Set(lits)];
    console.log(`highlighted blocks in order: ${lits.join(" → ")}`);
    console.log(`pause kept the same sentence: ${paused && paused.same}; rewind from block ${rewound && rewound.before} to ${rewound && rewound.after}`);
    console.log(`took ${((Date.now() - t0) / 1000).toFixed(1)} s; walkthrough ${tab.messages[1].listen ? tab.messages[1].listen.pieces.length : 0} pieces`);
    console.log(`three lines shown: ${threeLines}; speed menu → ${sped && sped.label}, kept as the default: ${sped && sped.saved}`);
    assert.ok(ended, "the host finished");
    assert.ok(blocks.length >= 3, "the highlight moved through the answer");
    assert.ok(paused && paused.same, "pause holds the sentence");
    assert.ok(rewound && Number(rewound.after) <= Number(rewound.before), "rewind went back (or stayed in the same block)");
    assert.strictEqual((await js("peek()")).bar, false, "the bar closed at the end");
    assert.ok(threeLines, "three lines at some point");
    assert.ok(sped && sped.label === "1.5x" && sped.saved === 1.5, "the speed changed and was kept");
    console.log("OK");
  } catch (e) { console.error("FAIL", e.stack); code = 1; }
  speaker.stop(); chrome.kill(); server.close();
  process.exit(code);
})();
