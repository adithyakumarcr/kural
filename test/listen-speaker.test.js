// Listen: the voice helper's host side (extension/lib/listen/speaker.js) with a stand-in worker (test/fake-tts-worker.js):
// text in, Int16 audio out; one process reused, one request at a time, idle stop, a crash fails one call only, cancel.
const assert = require("assert");
const path = require("path");
const { Speaker, threadCount } = require("../extension/lib/listen/speaker");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const FAKE = path.join(__dirname, "fake-tts-worker.js");
const make = (over = {}) => new Speaker({ engine: "supertonic", paths: () => ({ dp: "/x/dp.onnx" }), execPath: process.execPath, worker: FAKE, idleMs: 60000, ...over });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withEnv = async (k, v, fn) => { const old = process.env[k]; process.env[k] = v; try { return await fn(); } finally { if (old === undefined) delete process.env[k]; else process.env[k] = old; } };

(async () => {
  await check("speak sends the text and resolves with Int16 samples and their rate", async () => {
    const s = make();
    const r = await s.speak("hello");
    assert.ok(r.pcm instanceof Int16Array);
    assert.strictEqual(r.pcm.length, 50);
    assert.strictEqual(r.pcm[0], 5);
    assert.strictEqual(r.rate, 24000);
    assert.strictEqual(typeof r.ms, "number");
    s.stop();
  });
  await check("calls in a row reuse one process and come back in order", async () => {
    const s = make();
    const [a, b, c] = await Promise.all([s.speak("a"), s.speak("bb"), s.speak("ccc")]);
    assert.deepStrictEqual([a.pcm[0], b.pcm[0], c.pcm[0]], [1, 2, 3]);
    const pid = s.proc.pid;
    await s.speak("dddd");
    assert.strictEqual(s.proc.pid, pid);
    s.stop();
  });
  await check("the worker is started as Kural's program with --no-liftoff, the engine, the paths and the threads", async () => {
    const s = make();
    await s.speak("x");
    const args = s.proc.spawnargs;
    assert.strictEqual(args[1], "--no-liftoff");
    assert.strictEqual(args[2], FAKE);
    assert.strictEqual(args[3], "supertonic");
    assert.deepStrictEqual(JSON.parse(args[4]), { dp: "/x/dp.onnx" });
    assert.strictEqual(args[5], String(threadCount()));
    s.stop();
  });
  await check("threads: at most 4, at least 1", () => { assert.ok(threadCount() >= 1 && threadCount() <= 4); });
  await check("it stops after idleMs and a later call starts it again", async () => {
    const s = make({ idleMs: 100 });
    await s.speak("x");
    await sleep(400);
    assert.strictEqual(s.proc, null);
    assert.strictEqual((await s.speak("abc")).pcm[0], 3);
    s.stop();
  });
  await check("warm starts the process without a request", async () => {
    const s = make();
    s.warm();
    assert.ok(s.proc && s.proc.pid);
    s.stop();
  });
  await check("a crash fails that call; the next call works", async () => {
    const s = make();
    await withEnv("FAKE_TTS", "crash", () => assert.rejects(s.speak("boom"), /voice stopped/i));
    assert.strictEqual((await s.speak("ok")).pcm[0], 2);
    s.stop();
  });
  await check("an error answer rejects with its message", async () => {
    const s = make();
    await withEnv("FAKE_TTS", "error", () => assert.rejects(s.speak("x"), /it broke/));
    s.stop();
  });
  await check("cancel rejects what's waiting as cancelled; a later call still works", async () => {
    const s = make();
    await withEnv("FAKE_TTS", "slow", async () => {
      const a = s.speak("one"), b = s.speak("two");
      await sleep(50);
      s.cancel();
      await assert.rejects(a, (e) => e.cancelled === true);
      await assert.rejects(b, (e) => e.cancelled === true);
      assert.strictEqual((await s.speak("three")).pcm[0], 5);
    });
    s.stop();
  });
  process.exit(failed ? 1 : 0);
})();
