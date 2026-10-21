// Live check of Listen (needs `claude` logged in and the downloaded voice): a real Kural answer → the real walkthrough
// (lib/listen/script.js → brain.makeAgent → a real `claude` with Haiku, no tools) → the real voice helper, through the
// host (lib/listen/index.js), as the chat runs it. Prints when the opener, the first sentence and the end came, and the
// walkthrough's length. Run:
//   KURAL_LISTEN_DIR=<the voice's folder> KURAL_EXEC=/usr/share/kural/kural node test/listen.live.js
// KURAL_LISTEN_WAV=<file.wav> also saves what was said (opener, then the sentences back to back), to listen to.
const Module = require("module");
const os = require("os");
const path = require("path");
const orig = Module._load;
const vscode = { window: { createOutputChannel: () => ({ appendLine() {} }) }, workspace: { workspaceFolders: [], isTrusted: true, getConfiguration: () => ({ get: (k, d) => d, inspect: () => undefined }), onDidChangeConfiguration: () => ({ dispose() {} }) },
  env: {}, commands: { executeCommand: async () => {} }, Uri: { file: (f) => ({ scheme: "file", fsPath: f }) }, EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
Module._load = function (req, ...a) { return req === "vscode" ? vscode : orig.call(this, req, ...a); };
const ext = path.resolve(__dirname, "../extension");
require(ext + "/lib/ai/claude.js").setSetupGate(() => true);
const brain = require(ext + "/lib/ai");
const { Listen } = require(ext + "/lib/listen");
const { Speaker } = require(ext + "/lib/listen/speaker");
const { assetsFor } = require(ext + "/lib/listen/assets");

const DIR = process.env.KURAL_LISTEN_DIR || path.join(os.homedir(), ".config/Kural/User/globalStorage/kural.kural/listen");
const EXEC = process.env.KURAL_EXEC || "/usr/share/kural/kural";
const BLOCKS = [
  { n: 0, kind: "p", text: "The login broke because the access token expired after an hour and nothing refreshed it." },
  { n: 1, kind: "p", text: "I changed the client so it keeps the refresh token and asks for a new access token a minute before the old one runs out." },
  { n: 2, kind: "code", text: "if (token.expiresAt - Date.now() < 60_000) {\n  token = await auth.refresh(token.refreshToken);\n}" },
  { n: 3, kind: "list", text: "- src/api/client.ts: the refresh check before each request\n- src/auth/store.ts: keeps the refresh token\n- test/client.test.ts: two new tests" },
  { n: 4, kind: "p", text: "Run npm test to check it; both new tests pass here." },
];

(async () => {
  const assets = assetsFor(DIR, "supertonic");
  if (!(await assets.ready())) { console.error(`The voice isn't in ${DIR}.`); process.exit(1); }
  const speaker = new Speaker({ engine: "supertonic", paths: () => assets.paths(), execPath: EXEC });
  const t0 = Date.now(), seen = [];
  let done;
  const finished = new Promise((r) => { done = r; });
  const listen = new Listen({ dir: DIR, engine: "supertonic", assets, speaker, save() {},
    postTo: (pane, m) => { seen.push({ at: Date.now() - t0, m }); if (m.type === "listenEnd" || (m.type === "listenState" && m.phase === "error")) done(); },
    pick: () => ({ model: "haiku" }), nameOf: () => "Haiku",
    scriptDeps: { makeAgent: brain.makeAgent, isClaude: () => true, emptyDir: () => os.tmpdir(), cwd: () => process.cwd(), localOpts: () => null, mode: () => "ask" } });
  await listen.makeOpeners();
  const t1 = Date.now();
  const tab = { id: "live", messages: [{ role: "user", segments: [{ t: "text", v: "Why did the login break?" }] }, { role: "assistant", blocks: [] }] };
  seen.length = 0;
  const start = Date.now();
  listen.start("pane", tab, 1, BLOCKS);
  await finished;
  const audio = seen.filter((s) => s.m.type === "listenAudio");
  const at = (s) => s ? `${s.at - (start - t0)} ms` : "never";
  const words = (tab.messages[1].listen ? tab.messages[1].listen.pieces : []).map((p) => p.text).join(" ").split(/\s+/).filter(Boolean);
  const secs = audio.reduce((n, s) => n + s.m.pcm.length / s.m.rate, 0);
  console.log(`openers made in ${t1 - t0} ms`);
  console.log(`opener audio:   ${at(audio.find((s) => s.m.opener))}`);
  console.log(`first sentence: ${at(audio.find((s) => !s.m.opener))}`);
  console.log(`end:            ${at(seen.find((s) => s.m.type === "listenEnd"))}  (${secs.toFixed(1)} s of audio, ${audio.length - 1} sentences)`);
  console.log(`walkthrough:    ${words.length} words`);
  for (const p of (tab.messages[1].listen || { pieces: [] }).pieces) console.log(`  [${p.block}] ${p.text}`);
  if (process.env.KURAL_LISTEN_WAV && audio.length) {
    const rate = audio[0].m.rate, n = audio.reduce((k, s) => k + s.m.pcm.length, 0), b = Buffer.alloc(44 + n * 2);
    b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
    b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
    let at = 44;
    for (const s of audio) { Buffer.from(s.m.pcm.buffer, s.m.pcm.byteOffset, s.m.pcm.byteLength).copy(b, at); at += s.m.pcm.byteLength; }
    require("fs").writeFileSync(process.env.KURAL_LISTEN_WAV, b);
    console.log(`saved ${process.env.KURAL_LISTEN_WAV}`);
  }
  const err = seen.find((s) => s.m.phase === "error");
  if (err) console.log(`ERROR ${err.m.message}`);
  speaker.stop();
  const first = tab.messages[1].listen && tab.messages[1].listen.pieces[0].text.split(/(?<=[.!?])\s+/)[0];
  const ok = !err && words.length >= 120 && words.length <= 280 && first && first.split(/\s+/).length < 14;
  console.log(ok ? "OK" : "NOT OK");
  process.exit(ok ? 0 : 1);
})();
