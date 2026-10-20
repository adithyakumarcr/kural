// Voice input: the helper process that runs Whisper (extension/lib/voice/transcriber.js), with a stand-in worker
// (test/fake-whisper-worker.js): the samples go in, the text comes back; one process is reused, stops when idle, and a
// crash fails one call only. Also isBlank (what Whisper says for silence).
const assert = require("assert");
const path = require("path");
const { Transcriber, isBlank } = require("../extension/lib/voice/transcriber");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const FAKE = path.join(__dirname, "fake-whisper-worker.js");
const make = (over = {}) => new Transcriber({ paths: () => ({ loader: "/x/kural-whisper.js", model: "/x/model.bin" }),
  execPath: process.execPath, worker: FAKE, idleMs: 60000, ...over });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await check("transcribe sends the samples and resolves with the worker's text and ms", async () => {
    const t = make(), pcm = new Float32Array(48000); pcm[0] = 0.5;
    const r = await t.transcribe(pcm);
    assert.strictEqual(r.text, "samples:48000:0.5");
    assert.strictEqual(typeof r.ms, "number");
    t.stop();
  });

  await check("two calls in a row reuse one process", async () => {
    const t = make();
    await t.transcribe(new Float32Array(10));
    const pid = t.proc.pid;
    await t.transcribe(new Float32Array(20));
    assert.strictEqual(t.proc.pid, pid);
    t.stop();
  });

  await check("the process stops after idleMs and a later call starts it again", async () => {
    const t = make({ idleMs: 100 });
    await t.transcribe(new Float32Array(10));
    const first = t.proc;
    await sleep(400);
    assert.strictEqual(t.proc, null, "stopped");
    assert.ok(first.killed || first.exitCode !== null || first.signalCode !== null);
    assert.strictEqual((await t.transcribe(new Float32Array(3))).text, "samples:3:0");
    t.stop();
  });

  await check("a worker crash rejects that call only; the next call works", async () => {
    process.env.FAKE_WHISPER = "crash";
    const t = make();
    await assert.rejects(t.transcribe(new Float32Array(10)), /stopped|crash|exited/i);
    delete process.env.FAKE_WHISPER;
    assert.strictEqual((await t.transcribe(new Float32Array(4))).text, "samples:4:0");
    t.stop();
  });

  await check("an error from the worker rejects with its message", async () => {
    process.env.FAKE_WHISPER = "error";
    const t = make();
    await assert.rejects(t.transcribe(new Float32Array(10)), /it broke/);
    delete process.env.FAKE_WHISPER;
    t.stop();
  });

  await check("isBlank: \"\", \"[BLANK_AUDIO]\", \" (music) \", \"[ Silence ]\" are blank; \"Hello.\" isn't", () => {
    for (const s of ["", "  ", "[BLANK_AUDIO]", " (music) ", "[ Silence ]", "[BLANK_AUDIO] (wind blowing)"]) assert.ok(isBlank(s), s);
    for (const s of ["Hello.", "(laughs) okay so add a test"]) assert.ok(!isBlank(s), s);
  });

  console.log(failed ? `voice-transcriber: ${failed} FAILED` : "voice-transcriber: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
