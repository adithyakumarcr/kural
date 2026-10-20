// Voice input, live, end to end without a person: the chat page's recording code (extension/media/voice.js) in headless
// Chrome, whose fake microphone plays the JFK recording; MediaRecorder → decoding → 16 kHz chunks exactly as in Kural;
// then those samples through the real Whisper helper (lib/voice/transcriber.js). Not part of npm test: needs Chrome
// (KURAL_CHROME or the usual places), the Whisper build (scripts/whisper-wasm/build.sh) and the model in dist/.
// KURAL_EXEC=/usr/share/kural/kural runs the helper in Kural's own program.
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { Cdp } = require("../extension/lib/browser/cdp");
const { Transcriber } = require("../extension/lib/voice/transcriber");

const ROOT = path.join(__dirname, "..");
const CHROME = [process.env.KURAL_CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome",
  "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.log("skip: no Chrome here (set KURAL_CHROME)"); process.exit(0); }
const DIR = process.env.KURAL_WHISPER_DIR || path.join(ROOT, "dist", "whisper-wasm");
const MODEL = process.env.KURAL_WHISPER_MODEL || path.join(ROOT, "dist", "ggml-base.en-q5_1.bin");
const WANT = "not what your country can do for you";
const words = (s) => s.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><meta charset="utf-8"><body><script src="/voice.js"></script><script>
window.posts = [];
const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) { if (v == null || v === false) continue;
    if (k === "class") n.className = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); }
  for (const k of kids.flat()) if (k != null && k !== false && k !== "") n.append(k); return n; };
window.v = KURAL_VOICE({ el, icon: (n) => el("i", { class: "codicon codicon-" + n }), post: (m) => posts.push(m), tab: () => ({ id: "t1" }),
  insertText: (t) => document.createTextNode(t), now: () => Date.now(), every: (f, ms) => setInterval(f, ms), stopEvery: (id) => clearInterval(id),
  isMac: false, media: { getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c), MediaRecorder, AudioContext, OfflineAudioContext } });
document.body.append(v.button, v.bar);
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
  const server = http.createServer((req, res) => {
    if (req.url === "/voice.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(fs.readFileSync(path.join(ROOT, "extension", "media", "voice.js"))); }
    res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kural-chrome-"));
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${path.join(__dirname, "fixtures", "voice", "jfk.wav")}`,
    "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const cdp = new Cdp(pipe(chrome));
  let code = 0;
  try {
    const s = await cdp.attach();
    const js = async (expression) => (await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
    await s.send("Page.enable");
    await s.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let i = 0; i < 50 && !(await js("!!window.v")); i++) await sleep(100);
    await js(`v.toggle(); v.onState({ tabId: "t1", phase: "recording" }); true`);
    await sleep(12000);   // (the recording is 11 s)
    const bar = await js("v.bar.textContent");
    console.log(`while recording the bar says: ${bar}`);
    assert.ok(/Listening… 0:1[12]/.test(bar), bar);
    await js("v.toggle(); true");
    for (let i = 0; i < 100 && !(await js(`posts.some((p) => p.type === "voiceStop")`)); i++) await sleep(100);
    const types = await js("posts.map((p) => p.type).join(' ')");
    console.log(`posted: ${types.replace(/(voiceChunk ?)+/, (m) => `voiceChunk ×${m.trim().split(" ").length} `)}`);
    const sizes = JSON.parse(await js(`JSON.stringify(posts.filter((p) => p.type === "voiceChunk").map((p) => p.samples.length))`));
    assert.ok(sizes.length >= 11 && sizes.slice(0, -1).every((n) => n === 16000), `chunks of 1 s: ${sizes}`);
    const samples = Float32Array.from(JSON.parse(await js(`JSON.stringify(posts.filter((p) => p.type === "voiceChunk").flatMap((p) => p.samples))`)));
    console.log(`${(samples.length / 16000).toFixed(1)} s of 16 kHz audio from the page`);
    const tr = new Transcriber({ paths: () => ({ loader: path.join(DIR, "kural-whisper.js"), model: MODEL }), execPath: process.env.KURAL_EXEC || process.execPath });
    const t = Date.now();
    const r = await tr.transcribe(samples);
    tr.stop();
    console.log(`Whisper (${Date.now() - t} ms): ${r.text}`);
    assert.ok(words(r.text).includes(WANT), r.text);
    console.log("voice-record.live: ALL PASS");
  } catch (e) { code = 1; console.error("FAIL", e.stack || e); }
  finally { cdp.close(); chrome.kill(); server.close(); process.exit(code); }
})();
