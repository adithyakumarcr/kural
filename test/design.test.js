// Design Mode (lib/browser/design-page.js in the page, design.js for Kural, chat.addDesignNotes): what the chat's AI gets
// from a note, the framework probe, and then the real thing in headless Chrome (skips without Chrome, KURAL_CHROME): a page
// with a strict Content Security Policy, a stand-in React component, a link and click counters; Design Mode put in by the
// real DesignSession over CDP and used with real mouse and keyboard events: hover, click + type + Return (sent, with the
// component and a picture), Shift+click, an area, Option/Alt+click (chat box), double-click text editing, Batch, Esc out,
// the AI using the tab (busy), a reload (it comes back), off (it's gone).
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const Module = require("module");
const { spawn } = require("child_process");

const load = Module._load;
const vscode = {
  workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => ({ get: (k, d) => d, inspect: () => undefined }),
    onDidChangeConfiguration: () => ({ dispose() {} }) },
  window: { setStatusBarMessage: () => {}, showInformationMessage: () => {}, createStatusBarItem: () => ({ show() {}, hide() {} }) },
  commands: { executeCommand: async () => {}, registerCommand: () => ({ dispose() {} }) },
  env: { appRoot: "/unused" }, Uri: { file: (f) => ({ scheme: "file", fsPath: f }), parse: (s) => ({ scheme: "file", fsPath: s }), joinPath: () => ({}) },
  ConfigurationTarget: { Global: 1 }, StatusBarAlignment: { Left: 1 }, EventEmitter: class { constructor() { this.event = () => {}; } fire() {} },
};
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const { ChatView } = require("../extension/lib/chat");
const { DesignSession, unionRect, PROBE } = require("../extension/lib/browser/design");
const { Cdp } = require("../extension/lib/browser/cdp");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = [process.env.KURAL_CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome",
  "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && fs.existsSync(p));

(async () => {
  // ---------- without a browser ----------
  await check("unionRect: the box around rectangles plus a margin, inside the window; none → null", () => {
    assert.deepStrictEqual(unionRect([{ x: 10, y: 20, w: 30, h: 10 }, { x: 50, y: 5, w: 10, h: 10 }], 800, 600), { x: 2, y: 0, w: 66, h: 38 });
    assert.deepStrictEqual(unionRect([{ x: 790, y: 590, w: 40, h: 40 }], 800, 600), { x: 782, y: 582, w: 18, h: 18 });
    assert.strictEqual(unionRect([null, { x: 0, y: 0, w: 0, h: 5 }], 800, 600), null);
  });
  const probe = new Function(`return (${PROBE})`)();
  await check("the probe reads a React component (name, the ones around it, file and line), Vue 3, Vue 2 and Svelte; plain HTML: null", () => {
    function CalcButton() {} function App() {}
    const react = { "__reactFiber$x1": { type: "button", return: { type: CalcButton, _debugSource: { fileName: "src/CalcButton.tsx", lineNumber: 12 }, return: { type: "div", return: { type: App } } } } };
    assert.deepStrictEqual(probe.call(react), { framework: "React", name: "CalcButton", stack: ["CalcButton", "App"], file: "src/CalcButton.tsx", line: 12 });
    const vue3 = { parentElement: null, __vueParentComponent: { type: { __name: "Stat", __file: "/app/src/components/Stat.vue" }, parent: { type: { name: "Dashboard" } } } };
    assert.deepStrictEqual(probe.call({ parentElement: vue3 }), { framework: "Vue", name: "Stat", stack: ["Stat", "Dashboard"], file: "/app/src/components/Stat.vue", line: null });
    const vue2 = { __vue__: { $options: { name: "Card", __file: "src/Card.vue" }, $parent: { $options: { _componentTag: "Page" } } } };
    assert.deepStrictEqual(probe.call(vue2), { framework: "Vue", name: "Card", stack: ["Card", "Page"], file: "src/Card.vue", line: null });
    const svelte = { parentElement: { __svelte_meta: { loc: { file: "src/lib/Hero.svelte", line: 4 } } } };
    assert.deepStrictEqual(probe.call(svelte), { framework: "Svelte", name: "Hero", stack: ["Hero"], file: "src/lib/Hero.svelte", line: 5 });
    assert.strictEqual(probe.call({ parentElement: null }), null);
    assert.strictEqual(probe.call({ get __reactFiber$evil() { throw new Error("no"); }, parentElement: null }), null, "a page that throws: no component");
  });

  // The chat's half: pills + words + the picture; sent at once, or into the box.
  const posted = [], sent = [], pane = { id: "p" };
  const chat = Object.create(ChatView.prototype);
  let added = 0;
  Object.assign(chat, { reveal: async () => {}, cur: () => pane, postTo: (p, m) => posted.push(m), active: () => ({ id: "t1" }),
    attachments: { addData: (name, data) => ({ id: `a${++added}`, name, data }) }, send: async (...a) => { sent.push(a); } });
  const el = { tag: "button", short: "button#calc.btn", elId: "calc", classes: ["btn", "primary"], attrs: 'type="submit"', selector: "#calc", text: "Calculate",
    size: [90, 34], pos: [43, 344], styles: { color: "rgb(255, 255, 255)" }, html: '<button id="calc">Calculate</button>', rect: { x: 1, y: 2, w: 3, h: 4 },
    component: { framework: "React", name: "CalcButton", stack: ["CalcButton", "App"], file: "src/CalcButton.tsx", line: 12 } };
  const note = { text: "Make it bigger", elements: [el], area: null, css: [{ prop: "font-size", from: "13px", to: "16px" }], textEdits: [], markup: 0,
    picture: { data: "iVBOR", mime: "image/png" }, url: "http://localhost:5173/", title: "Weld Sim" };
  await check("send: one message with a pill per element, the words and CSS changes, and the picture attached", async () => {
    sent.length = 0;
    await chat.addDesignNotes([note], { send: true });
    assert.strictEqual(sent.length, 1);
    const [tab, segments, contexts, attachIds] = sent[0];
    assert.strictEqual(tab.id, "t1");
    assert.deepStrictEqual(segments.map((s) => s.t), ["pill", "text", "text"]);
    assert.strictEqual(segments[0].ctx.label, "<button#calc.btn>");
    assert.ok(/Make it bigger/.test(segments[2].v) && /font-size: 13px → 16px/.test(segments[2].v));
    assert.strictEqual(contexts.length, 1); assert.strictEqual(contexts[0].element.design, true);
    assert.deepStrictEqual(attachIds, ["a1"]);
  });
  await check("what the AI reads about the element: tag with id, classes and attributes, selector, size and place, the component, text, styles", async () => {
    const prompt = await chat.buildPrompt("Make it bigger", [{ kind: "element", path: note.url, label: "<button>", element: { ...el, url: note.url, title: note.title, design: true } }]);
    for (const want of ['<button id="calc" class="btn primary" type="submit">', "- selector: #calc", "- size: 90x34 px, at (43, 344) on the page",
      "React component: CalcButton (src/CalcButton.tsx:12), inside: App", '- text: "Calculate"', "color: rgb(255, 255, 255)", "From Kural's Design Mode"]) assert.ok(prompt.includes(want), want);
  });
  await check("an area note: its own pill, described as an area with the picture; two areas are both kept", async () => {
    sent.length = 0;
    await chat.addDesignNotes([{ ...note, elements: [], css: [], area: { x: 10, y: 20, w: 300, h: 120 } }, { ...note, elements: [], css: [], area: { x: 40, y: 220, w: 100, h: 80 } }], { send: true });
    const contexts = sent[0][2];
    assert.deepStrictEqual(contexts.map((c) => c.label), ["<area 300×120>", "<area 100×80>"]);
    const prompt = await chat.buildPrompt("x", contexts);
    assert.ok(prompt.includes("300x120 px at (10, 20)") && prompt.includes("100x80 px at (40, 220)"), prompt);
  });
  await check("into the chat box (Cmd+L, Option+click, Dictate): the picture as an attachment, the pill with the words after it; nothing sent", async () => {
    sent.length = 0; posted.length = 0;
    await chat.addDesignNotes([note], { send: false });
    assert.strictEqual(sent.length, 0);
    assert.deepStrictEqual(posted.map((m) => m.type), ["attached", "insertPill"]);
    assert.ok(posted[1].text.includes("Make it bigger"));
  });

  // ---------- the real thing, in headless Chrome ----------
  if (!CHROME) { console.log("skip: no Chrome here (set KURAL_CHROME) for Design Mode in a real page"); return finish(); }
  const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Weld Sim</title><link rel="stylesheet" href="/app.css"></head>
<body><nav><a id="away" href="/elsewhere">Elsewhere</a></nav><h1 id="title">Arc length calculator</h1>
<main><button id="calc" class="btn primary">Calculate</button><div class="stats"><div class="stat" id="s1">65.97 mm</div><div class="stat" id="s2">71 mm</div></div></main>
<script src="/app.js"></script></body></html>`;
  const CSS = "body{font:16px sans-serif;margin:0;padding:20px} .btn{padding:8px 16px} .stats{display:flex;gap:20px;margin-top:40px} .stat{width:120px;height:80px;border:1px solid #ccc}";
  // The page's own script: counts clicks that reach it, and makes the button look like a React component's.
  const APP = `window.clicks = 0; document.addEventListener("click", () => window.clicks++);
function CalcButton() {} function App() {}
document.getElementById("calc")["__reactFiber$t1"] = { type: "button", return: { type: CalcButton, _debugSource: { fileName: "src/CalcButton.tsx", lineNumber: 12 }, return: { type: App } } };`;
  const server = http.createServer((req, res) => {
    // (A strict policy: no inline styles or scripts. Design Mode must still draw and work.)
    res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'");
    if (req.url === "/app.css") { res.setHeader("Content-Type", "text/css"); return res.end(CSS); }
    if (req.url === "/app.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(APP); }
    res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(req.url === "/elsewhere" ? "<p>elsewhere</p>" : PAGE);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kural-chrome-"));
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--window-size=1000,700", "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const cdp = new Cdp(pipe(chrome));
  try {
    const s = await cdp.attach();
    await s.send("Page.enable");
    const main = async (expression) => (await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
    await s.send("Page.navigate", { url });
    for (let i = 0; i < 50 && !(await main("document.readyState === 'complete' && typeof window.clicks === 'number'")); i++) await sleep(100);
    const notes = [], exits = [], batches = [];
    const ds = new DesignSession(s, { onNotes: async (n, how) => { notes.push({ n, how }); }, onExit: () => exits.push(1), onBatch: (on) => batches.push(on) });
    await ds.start({ batch: false });
    const state = () => ds.call("state");
    const center = async (sel) => main(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const mouse = (type, p, o = {}) => s.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: o.button || "left", buttons: o.buttons ?? (type === "mousePressed" ? 1 : 0), clickCount: o.clickCount || 1, modifiers: o.modifiers || 0 });
    const click = async (p, modifiers = 0, clickCount = 1) => { await mouse("mouseMoved", p, { button: "none", modifiers }); await mouse("mousePressed", p, { modifiers, clickCount }); await mouse("mouseReleased", p, { modifiers, clickCount }); await sleep(80); };
    const key = async (k, code, keyCode, modifiers = 0) => { await s.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code, windowsVirtualKeyCode: keyCode, modifiers }); await s.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: keyCode, modifiers }); await sleep(60); };
    const enter = () => s.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" }).then(() => s.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 })).then(() => sleep(80));
    const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return false; };
    const ALT = 1, SHIFT = 8;

    await check("on: drawn in a closed shadow root under a strict CSP; the page can't see Kural's function", async () => {
      assert.strictEqual(await main("!!document.querySelector('kural-design')"), true);
      assert.strictEqual(await main("document.querySelector('kural-design').shadowRoot"), null, "closed");
      assert.strictEqual(await main("typeof window.__kuralDesignSend + typeof window.__kuralDesign"), "undefinedundefined");
      assert.strictEqual((await state()).on, true);
    });
    await check("pointing outlines the element; Arrow Up goes to its parent, Arrow Down back in", async () => {
      await mouse("mouseMoved", await center("#calc"), { button: "none" }); await sleep(80);
      assert.strictEqual((await state()).hover, "button#calc.btn.primary");
      await key("ArrowUp", "ArrowUp", 38); assert.strictEqual((await state()).hover, "main");
      await key("ArrowDown", "ArrowDown", 40); assert.strictEqual((await state()).hover, "button#calc.btn.primary");
    });
    await check("a click opens a note (the page's own click handlers don't see it); typing + Return sends it with the component and a picture", async () => {
      await click(await center("#calc"));
      assert.deepStrictEqual([(await state()).noteOpen, (await state()).sel], [true, 1]);
      assert.strictEqual(await main("window.clicks"), 0);
      await s.send("Input.insertText", { text: "Make it bigger" });
      await enter();
      assert.ok(await until(() => notes.length === 1), "a note arrived");
      const { n, how } = notes[0];
      assert.deepStrictEqual(how, { send: true, dictate: false });
      assert.strictEqual(n.length, 1); const x = n[0];
      assert.strictEqual(x.text, "Make it bigger");
      assert.strictEqual(x.elements[0].tag, "button"); assert.strictEqual(x.elements[0].elId, "calc");
      assert.strictEqual(x.elements[0].selector, "#calc");
      assert.deepStrictEqual(x.elements[0].component, { framework: "React", name: "CalcButton", stack: ["CalcButton", "App"], file: "src/CalcButton.tsx", line: 12 });
      assert.ok(x.picture && x.picture.mime === "image/png" && Buffer.from(x.picture.data, "base64").subarray(1, 4).toString() === "PNG", "a PNG picture");
      assert.strictEqual(x.url, url); assert.strictEqual(x.title, "Weld Sim");
      assert.ok(await until(async () => !(await state()).noteOpen), "the note closed");
    });
    await check("Shift+click puts more elements in one note; an empty Return says what's missing", async () => {
      notes.length = 0;
      await click(await center("#s1")); await click(await center("#s2"), SHIFT);
      assert.strictEqual((await state()).sel, 2);
      await enter();
      assert.ok(/Say what to change/.test((await state()).status) || (await state()).noteOpen, "not sent without words");
      assert.strictEqual(notes.length, 0);
      await s.send("Input.insertText", { text: "Same height" }); await enter();
      assert.ok(await until(() => notes.length === 1));
      assert.deepStrictEqual(notes[0].n[0].elements.map((e) => e.elId), ["s1", "s2"]);
    });
    await check("a drag boxes in an area: a note with the area and its picture", async () => {
      notes.length = 0;
      await mouse("mouseMoved", { x: 300, y: 120 }, { button: "none" }); await mouse("mousePressed", { x: 300, y: 120 });
      for (const p of [{ x: 360, y: 160 }, { x: 460, y: 220 }]) await mouse("mouseMoved", p, { buttons: 1 });
      await mouse("mouseReleased", { x: 460, y: 220 }); await sleep(80);
      assert.strictEqual((await state()).area, true);
      await s.send("Input.insertText", { text: "Too crowded" }); await enter();
      assert.ok(await until(() => notes.length === 1));
      const a = notes[0].n[0].area; assert.ok(a && Math.round(a.w) === 160 && Math.round(a.h) === 100, JSON.stringify(a));
      assert.ok(notes[0].n[0].picture, "with a picture");
    });
    await check("Option/Alt+click: straight to the chat box (not sent)", async () => {
      notes.length = 0;
      await click(await center("#title"), ALT);
      assert.ok(await until(() => notes.length === 1));
      assert.deepStrictEqual(notes[0].how, { send: false, dictate: false });
      assert.strictEqual(notes[0].n[0].elements[0].elId, "title");
    });
    await check("double-click text edits it in place; Return keeps it, and Send sends the text edit (old → new)", async () => {
      notes.length = 0;
      const p = await center("#title");
      await click(p); await click(p, 0, 2);
      await mouse("mousePressed", p, { clickCount: 2 }); await mouse("mouseReleased", p, { clickCount: 2 }); await sleep(100);
      assert.strictEqual((await state()).editing, true);
      await s.send("Input.insertText", { text: "Seam calculator" }); await enter();
      assert.deepStrictEqual([(await state()).editing, (await state()).textEdits], [false, 1]);
      assert.strictEqual(await main("document.getElementById('title').textContent"), "Seam calculator");
      await ds.call("sendText");
      assert.ok(await until(() => notes.length === 1));
      assert.deepStrictEqual(notes[0].n[0].textEdits, [{ element: "h1#title", from: "Arc length calculator", to: "Seam calculator" }]);
    });
    await check("Batch: Return saves notes as pins; Send (n) sends them together and ends Design Mode", async () => {
      notes.length = 0; exits.length = 0;
      await ds.setBatch(true);
      for (const [sel, words] of [["#s1", "Taller"], ["#calc", "Orange"]]) { await click(await center(sel)); await s.send("Input.insertText", { text: words }); await enter(); await until(async () => !(await state()).noteOpen); }
      assert.strictEqual(notes.length, 0, "nothing sent yet");
      assert.strictEqual((await state()).pending, 2);
      await ds.call("sendAll");
      assert.ok(await until(() => notes.length === 1));
      assert.deepStrictEqual(notes[0].n.map((x) => x.text), ["Taller", "Orange"]);
      assert.strictEqual(exits.length, 1);
      await ds.setBatch(false);
    });
    await check("Esc backs out a step at a time (note, selection), then asks to turn Design Mode off", async () => {
      exits.length = 0;
      await click(await center("#calc"));
      await s.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await s.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(60);
      assert.deepStrictEqual([(await state()).noteOpen, (await state()).sel], [false, 1]);
      await key("Escape", "Escape", 27); assert.strictEqual((await state()).sel, 0);
      await key("Escape", "Escape", 27); assert.strictEqual(exits.length, 1);
    });
    await check("links and buttons don't act while it's on, and clicks in Design Mode's own note don't reach the page's handlers", async () => {
    await main("window.clicks = 0");
    await click(await center("#away"));
    assert.strictEqual(await main("location.pathname"), "/");
    assert.strictEqual((await state()).noteOpen, true);
    // (the note sits under the link; a click on it is Design Mode's own)
    const a = await center("#away");
    await click({ x: a.x + 20, y: a.y + 60 });
    assert.strictEqual(await main("window.clicks"), 0, "the page heard nothing");
    await key("Escape", "Escape", 27); await key("Escape", "Escape", 27);
    assert.deepStrictEqual([(await state()).noteOpen, (await state()).sel], [false, 0]);
  });
  await check("while the chat's AI uses the tab (busy) its clicks reach the page; after, Design Mode takes them again", async () => {
    await ds.setBusy(true);
    await click(await center("#calc"));
    assert.strictEqual(await main("window.clicks"), 1, "the page got that click");
    await ds.setBusy(false);
    await click(await center("#calc"));
    assert.strictEqual(await main("window.clicks"), 1, "blocked again");
    assert.strictEqual((await state()).sel, 1, "Design Mode took it");
    await key("Escape", "Escape", 27); await key("Escape", "Escape", 27);
  });
  await check("a reload: Design Mode comes back by itself, and notes still work", async () => {
      notes.length = 0;
      await s.send("Page.reload");
      assert.ok(await until(async () => (await main("!!document.querySelector('kural-design') && typeof window.clicks === 'number'")), 6000), "back after the reload");
      await click(await center("#calc")); await s.send("Input.insertText", { text: "After reload" }); await enter();
      assert.ok(await until(() => notes.length === 1), "a note after the reload");
    });
    await check("off: the layer and its crosshair are gone, the page works as before, and a reload stays plain", async () => {
      await ds.stop();
      assert.strictEqual(await main("!!document.querySelector('kural-design')"), false);
      assert.strictEqual(await main("document.adoptedStyleSheets.length"), 0);
      await main("window.clicks = 0");
      await click(await center("#calc"));
      assert.strictEqual(await main("window.clicks"), 1);
      await s.send("Page.reload"); await sleep(600);
      assert.strictEqual(await main("!!document.querySelector('kural-design')"), false);
    });
  } finally {
    cdp.close(); chrome.kill(); server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold it */ }
  }
  finish();
})();

function pipe(child) {
  const out = child.stdio[3], inp = child.stdio[4];
  let buf = "", onMsg = () => {}, onClose = () => {};
  inp.setEncoding("utf8");
  inp.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\0")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); onMsg(m); } });
  inp.on("close", () => onClose());
  return { send: (o) => out.write(JSON.stringify(o) + "\0"), onMessage: (f) => { onMsg = f; }, onClose: (f) => { onClose = f; }, close: () => child.kill() };
}
function finish() { console.log(failed ? `design: ${failed} FAILED` : "design: ALL PASS"); process.exit(failed ? 1 : 0); }
