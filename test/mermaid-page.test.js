// Mermaid diagrams in the chat (media/mermaid-view.js): the page's code in headless Chrome under the chat page's own CSP
// (read from lib/chat/index.js), with the Mermaid Kural ships. A diagram must become a picture that loads (HTML labels
// such as <br/> made invalid XML: the picture didn't show), nothing from the diagram may stay a link or script, and text
// that isn't a diagram gives Mermaid's reason. Skips without Chrome (KURAL_CHROME).
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { Cdp } = require("../extension/lib/browser/cdp");

const ROOT = path.join(__dirname, "..");
const MEDIA = path.join(ROOT, "extension", "media");
const CHROME = [process.env.KURAL_CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome",
  "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && fs.existsSync(p));

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.message); } };

// Without Chrome: what can be checked from the files.
const chatHost = fs.readFileSync(path.join(ROOT, "extension", "lib", "chat", "index.js"), "utf8");
const chatPage = fs.readFileSync(path.join(MEDIA, "chat.js"), "utf8");
const ready = (async () => {
  await check("the chat page loads mermaid-view.js before chat.js and says where Mermaid is", () => {
    const order = [...chatHost.matchAll(/src="\$\{uri\("([\w.-]+\.js)"\)\}"/g)].map((m) => m[1]);
    assert.ok(order.indexOf("mermaid-view.js") >= 0 && order.indexOf("mermaid-view.js") < order.indexOf("chat.js"), order.join(", "));
    assert.ok(/data-mermaid="\$\{uri\("mermaid\/mermaid\.min\.js"\)\}"/.test(chatHost), "data-mermaid");
    assert.ok(fs.existsSync(path.join(MEDIA, "mermaid", "mermaid.min.js")) && fs.existsSync(path.join(MEDIA, "mermaid", "LICENSE")), "Mermaid and its licence");
  });
  await check("a complete ```mermaid block becomes a diagram card; a streaming one stays code", () => {
    assert.ok(/if \(\/\^mermaid\$\/i\.test\(lang\) && done && window\.KURAL_MERMAID\) return mermaidCard\(/.test(chatPage));
  });
  await check("the full-size tab takes an SVG picture but no other data: address", () => {
    const re = new RegExp(/const diagram = (\/.*?\/)\.test/.exec(chatHost)[1].slice(1, -1));
    assert.ok(re.test("data:image/svg+xml;charset=utf-8,%3Csvg"));
    for (const bad of ["data:text/html,<script>", "data:image/svg", "javascript:alert(1)"]) assert.ok(!re.test(bad), bad);
  });
})();

function pipe(child) {
  const out = child.stdio[3], inp = child.stdio[4];
  let buf = "", onMsg = () => {}, onClose = () => {};
  inp.setEncoding("utf8");
  inp.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\0")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); onMsg(m); } });
  inp.on("close", () => onClose());
  return { send: (o) => out.write(JSON.stringify(o) + "\0"), onMessage: (f) => { onMsg = f; }, onClose: (f) => { onClose = f; }, close: () => child.kill() };
}

(async () => {
  await ready;
  if (!CHROME) { console.log("skip: no Chrome here (set KURAL_CHROME) for the drawing checks"); return finish(); }
  const nonce = "kuralTestNonce1";
  const server = http.createServer((req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const files = { "/mermaid-view.js": "mermaid-view.js", "/mermaid.min.js": "mermaid/mermaid.min.js", "/chat.css": "chat.css" };
    if (files[req.url]) {
      res.setHeader("Content-Type", req.url.endsWith(".css") ? "text/css" : "text/javascript");
      return res.end(fs.readFileSync(path.join(MEDIA, files[req.url])));
    }
    // The chat page's CSP as lib/chat/index.js writes it, with this server as the webview's source.
    const csp = /content="(default-src 'none'; style-src \$\{webview\.cspSource\};[^"]*)"/.exec(chatHost)[1]
      .replace(/\$\{webview\.cspSource\}/g, origin).replace(/\$\{nonce\}/g, nonce);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html><html data-mermaid="/mermaid.min.js"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}"><link rel="stylesheet" href="/chat.css"></head>
<body class="vscode-dark"><script nonce="${nonce}" src="/mermaid-view.js"></script></body></html>`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kural-chrome-"));
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "--no-first-run",
    "--no-default-browser-check", "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const cdp = new Cdp(pipe(chrome));
  try {
    const s = await cdp.attach();
    const js = async (expression) => (await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
    await s.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let i = 0; i < 50 && !(await js("!!window.KURAL_MERMAID")); i++) await new Promise((r) => setTimeout(r, 100));
    // Draw, then load the picture the way the card does: { ok, w, h, natural, src } or { error }.
    const draw = (code) => js(`KURAL_MERMAID.draw(${JSON.stringify(code)}).then((r) => r.error ? r : new Promise((ok) => {
      const img = new Image(); img.onload = () => ok({ ok: true, w: r.w, h: r.h, natural: img.naturalWidth, src: decodeURIComponent(r.src) });
      img.onerror = () => ok({ ok: false, src: r.src.slice(0, 200) }); img.src = r.src; }))`);

    await check("a flowchart with <br/> labels becomes a picture that loads, sized from the diagram", async () => {
      const r = await draw('flowchart TD\n  A[install.sh] --> B[install.py main]\n  B --> C["prepare.run<br/>verifyInstaller"]\n  C -->|ok| D{"neura?"}');
      assert.ok(r.ok, JSON.stringify(r).slice(0, 300));
      assert.ok(r.w > 50 && r.h > 100 && r.natural === r.w, `${r.w}x${r.h}, natural ${r.natural}`);
      assert.ok(r.src.startsWith("data:image/svg+xml") && /verifyInstaller/.test(r.src), "the label is in it");
    });
    await check("sequence, class, state, pie and ER diagrams draw too", async () => {
      for (const code of ["sequenceDiagram\n  U->>K: Send\n  K-->>U: Answer", "classDiagram\n  Animal <|-- Dog", "stateDiagram-v2\n  [*] --> Idle",
        'pie title Pets\n  "Dogs" : 3\n  "Cats" : 1', "erDiagram\n  USER ||--o{ CHAT : has"]) {
        const r = await draw(code);
        assert.ok(r.ok, `${code.split("\n")[0]}: ${JSON.stringify(r).slice(0, 200)}`);
      }
    });
    await check("links and scripts written in the diagram don't survive", async () => {
      const r = await draw('flowchart LR\n  A["<script>alert(1)</script>x"] --> B\n  click A "javascript:alert(1)"\n  click B "https://example.com"');
      assert.ok(r.ok, JSON.stringify(r).slice(0, 200));
      { const m = r.src.match(/.{80}(javascript:|<script|example\.com).{80}/gi); assert.ok(!m, JSON.stringify(m)); }
    });
    await check("text that isn't a diagram gives Mermaid's reason, and leaves nothing on the page", async () => {
      const r = await draw("this is not a diagram");
      assert.ok(r.error && /diagram/i.test(r.error), JSON.stringify(r));
      assert.strictEqual(await js("document.querySelectorAll('.mm-measure, [id^=kural-mm], [id^=dkural-mm]').length"), 0);
    });
    await check("the same diagram again comes from what was drawn (no second render)", async () => {
      const code = "flowchart LR\n  X --> Y";
      const t0 = await js(`(async () => { await KURAL_MERMAID.draw(${JSON.stringify(code)}); const t = performance.now(); await KURAL_MERMAID.draw(${JSON.stringify(code)}); return performance.now() - t; })()`);
      assert.ok(t0 < 20, `${t0} ms`);
    });
  } finally {
    chrome.kill();
    server.close();
    // (Chrome still writes its profile while it quits.)
    await new Promise((r) => chrome.once("exit", r).once("error", r));
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch {}
  }
  finish();
})().catch((e) => { console.error(e); process.exit(1); });

function finish() {
  console.log(failed ? `mermaid-page: ${failed} FAILED` : "mermaid-page: ALL PASS");
  process.exit(failed ? 1 : 0);
}
