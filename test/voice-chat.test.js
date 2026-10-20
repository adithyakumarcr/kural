// Voice input, the host side (extension/lib/voice/index.js) with stand-in Assets, Transcriber and cleanup: asking to
// download, progress, recording, chunks in order, transcribing, cleaning, the fallbacks, cancel, one recording at a time,
// the 5-minute cut. And that the chat page, the chat and package.json are wired to it.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { Voice, MAX_SAMPLES } = require("../extension/lib/voice");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const tick = () => new Promise((r) => setImmediate(r));

function make({ ready = true, text = "um so add a a test", cleaned = { text: "So, add a test.", cleaned: true, model: "Haiku" }, failDownload } = {}) {
  const posts = [], got = [];
  let isReady = ready;
  const assets = {
    ready: async () => isReady,
    download: async ({ onProgress, signal }) => {
      onProgress(30, 100); onProgress(100, 100);
      if (failDownload) throw new Error(failDownload);
      if (signal && signal.aborted) throw new Error("stopped");
      isReady = true;
    },
    paths: () => ({}),
  };
  const transcriber = { warmed: 0, warm() { this.warmed++; }, transcribe: async (s) => { got.push(s); return { text, ms: 10 }; }, stop() {} };
  const voice = new Voice({ assets, transcriber, cleanup: async (t) => ({ ...cleaned, raw: t }), post: (m) => posts.push(m) });
  return { voice, posts, got, transcriber, last: () => posts[posts.length - 1] };
}
const phases = (posts) => posts.map((p) => p.phase);

(async () => {
  await check("voiceStart with Whisper missing posts phase \"ask\"; voiceDownload posts downloading with pct, then \"recording\"", async () => {
    const { voice, posts } = make({ ready: false });
    await voice.start("t1");
    assert.deepStrictEqual(posts[0], { type: "voiceState", tabId: "t1", phase: "ask" });
    await voice.download("t1");
    assert.deepStrictEqual(phases(posts), ["ask", "downloading", "downloading", "recording"]);
    assert.deepStrictEqual(posts.filter((p) => p.phase === "downloading").map((p) => p.pct), [30, 100]);
  });

  await check("a failed download posts an error with its reason and doesn't record", async () => {
    const { voice, posts, last } = make({ ready: false, failDownload: "the download stalled" });
    await voice.start("t1"); await voice.download("t1");
    assert.strictEqual(last().phase, "error"); assert.ok(/stalled/.test(last().message));
    assert.ok(!phases(posts).includes("recording"));
  });

  await check("recording warms Whisper; chunks are joined in seq order; voiceStop → transcribing → cleaning → done {raw, text}", async () => {
    const { voice, posts, got, transcriber, last } = make();
    await voice.start("t1");
    assert.strictEqual(transcriber.warmed, 1);
    voice.chunk("t1", 1, [0.3, 0.4]); voice.chunk("t1", 0, [0.1, 0.2]);
    await voice.finish("t1");
    assert.deepStrictEqual(Array.from(got[0]).map((x) => Math.round(x * 10) / 10), [0.1, 0.2, 0.3, 0.4]);
    assert.deepStrictEqual(phases(posts), ["recording", "transcribing", "cleaning", "done"]);
    assert.deepStrictEqual(last(), { type: "voiceState", tabId: "t1", phase: "done", raw: "um so add a a test", text: "So, add a test.", cleaned: true, model: "Haiku" });
  });

  await check("chunks may come as typed arrays or ArrayBuffers too", async () => {
    const { voice, got } = make();
    await voice.start("t1");
    voice.chunk("t1", 0, new Float32Array([0.5])); voice.chunk("t1", 1, new Float32Array([0.25]).buffer);
    await voice.finish("t1");
    assert.deepStrictEqual(Array.from(got[0]), [0.5, 0.25]);
  });

  await check("blank speech → error \"No speech heard\"; nothing inserted", async () => {
    const { voice, last } = make({ text: " [BLANK_AUDIO] " });
    await voice.start("t1"); voice.chunk("t1", 0, [0]); await voice.finish("t1");
    assert.deepStrictEqual([last().phase, last().message], ["error", "No speech heard. Try again a little closer to the microphone."]);
  });

  await check("cleanup fallback → done with text = raw and why", async () => {
    const { voice, last } = make({ cleaned: { text: "um so add a a test", cleaned: false, why: "No AI is set up, so the text isn't cleaned up." } });
    await voice.start("t1"); voice.chunk("t1", 0, [0.1]); await voice.finish("t1");
    assert.deepStrictEqual([last().phase, last().text, last().raw, last().cleaned, last().why], ["done", "um so add a a test", "um so add a a test", false, "No AI is set up, so the text isn't cleaned up."]);
  });

  await check("a transcribing error posts an error, not done", async () => {
    const { voice, transcriber, last } = make();
    transcriber.transcribe = async () => { throw new Error("Whisper stopped (SIGKILL)."); };
    await voice.start("t1"); voice.chunk("t1", 0, [0.1]); await voice.finish("t1");
    assert.strictEqual(last().phase, "error"); assert.ok(/Whisper stopped/.test(last().message));
  });

  await check("voiceCancel and closing the tab drop the chunks; a later voiceStop does nothing", async () => {
    const { voice, posts, got } = make();
    await voice.start("t1"); voice.chunk("t1", 0, [0.1]); voice.cancel("t1");
    const n = posts.length;
    await voice.finish("t1");
    assert.strictEqual(got.length, 0); assert.strictEqual(posts.length, n);
    await voice.start("t2"); voice.chunk("t2", 0, [0.1]); voice.closed("t2"); await voice.finish("t2");
    assert.strictEqual(got.length, 0);
  });

  await check("a second voiceStart for another tab while one records → error \"Already recording in another chat\"", async () => {
    const { voice, last } = make();
    await voice.start("t1");
    await voice.start("t2");
    assert.deepStrictEqual([last().tabId, last().phase, last().message], ["t2", "error", "Already recording in another chat."]);
  });

  await check("more than 5 minutes of samples (4,800,000) are cut to 5 minutes", async () => {
    const { voice, got } = make();
    assert.strictEqual(MAX_SAMPLES, 4800000);
    await voice.start("t1");
    voice.chunk("t1", 0, new Float32Array(4000000)); voice.chunk("t1", 1, new Float32Array(1000000)); voice.chunk("t1", 2, new Float32Array(10));
    await voice.finish("t1");
    assert.strictEqual(got[0].length, 4800000);
  });

  await check("the chat, its page and package.json are wired to it", () => {
    const chat = fs.readFileSync(path.join(__dirname, "../extension/lib/chat/index.js"), "utf8");
    for (const m of ["voiceStart", "voiceDownload", "voiceDownloadStop", "voiceChunk", "voiceStop", "voiceCancel"]) assert.ok(chat.includes(`case "${m}"`), m);
    assert.ok(/registerCommand\("kural\.chat\.voice"/.test(chat));
    assert.ok(/nonce="\$\{nonce\}" src="\$\{uri\("voice\.js"\)\}"/.test(chat), "the page loads voice.js");
    const pkg = require("../extension/package.json");
    assert.ok(pkg.contributes.commands.some((c) => c.command === "kural.chat.voice" && c.title === "Kural: Record a Voice Prompt"));
    const kb = pkg.contributes.keybindings.find((k) => k.command === "kural.chat.voice");
    assert.deepStrictEqual([kb.key, kb.mac, kb.when], ["ctrl+alt+v", "cmd+alt+v", "kural.chatFocused"]);
  });

  await tick();
  console.log(failed ? `voice-chat: ${failed} FAILED` : "voice-chat: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
