// Listen, live: the real voice helper (extension/lib/listen/tts-worker.js + engines/supertonic.js) run by Kural's own
// program, through the real Speaker. Needs the downloaded voice (not part of npm test):
//   KURAL_LISTEN_DIR=<folder with the files of extension/lib/listen/assets.js>  (default: Kural's globalStorage/listen)
//   KURAL_EXEC=<Kural's program>  (default /usr/share/kural/kural)
const assert = require("assert");
const os = require("os");
const path = require("path");
const { Speaker } = require("../extension/lib/listen/speaker");
const { assetsFor, ENGINES } = require("../extension/lib/listen/assets");

const DIR = process.env.KURAL_LISTEN_DIR || path.join(os.homedir(), ".config/Kural/User/globalStorage/kural.kural/listen");
const EXEC = process.env.KURAL_EXEC || "/usr/share/kural/kural";
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const rms = (pcm) => { let s = 0; for (const v of pcm) s += (v / 32768) ** 2; return Math.sqrt(s / Math.max(1, pcm.length)); };

(async () => {
  const assets = assetsFor(DIR, "supertonic");
  if (!(await assets.ready())) { console.error(`The voice isn't in ${DIR} (or doesn't match the pins).`); process.exit(1); }
  const s = new Speaker({ engine: "supertonic", paths: () => assets.paths(), execPath: EXEC, log: (l) => console.log(l) });
  await check("the opener line is real sound at 44.1 kHz, 1 to 6 seconds long", async () => {
    const t = Date.now();
    const r = await s.speak("Alright, let me walk you through this.");
    console.log(`     cold (load + speak): ${Date.now() - t} ms, ${(r.pcm.length / r.rate).toFixed(2)} s of audio`);
    assert.strictEqual(r.rate, ENGINES.supertonic.rate);
    assert.ok(rms(r.pcm) > 0.01, `rms ${rms(r.pcm)}`);
    const secs = r.pcm.length / r.rate;
    assert.ok(secs > 1 && secs < 6, `${secs} s`);
  });
  await check("a warm 10-word sentence within the spike's bar (1.5 s)", async () => {
    const t = Date.now();
    await s.speak("Okay, so the login broke because the token expired.");
    const ms = Date.now() - t;
    console.log(`     warm 10 words: ${ms} ms`);
    assert.ok(ms < 1500, `${ms} ms`);
  });
  await check("a sentence with an expression tag works", async () => {
    const r = await s.speak("That's pretty cool. <laugh> Anyway, next part.");
    assert.ok(rms(r.pcm) > 0.01);
  });
  await check("speed: 2x is about half as long as 1x, 0.5x about twice", async () => {
    const t = "Here's the clever part: it keeps the token for an hour.";
    const len = async (speed) => (await s.speak(t, { speed })).pcm.length;
    const one = await len(1), two = await len(2), half = await len(0.5);
    console.log(`     1x ${(one / 44100).toFixed(2)} s, 2x ${(two / 44100).toFixed(2)} s, 0.5x ${(half / 44100).toFixed(2)} s`);
    assert.ok(two < one * 0.65 && half > one * 1.6, `${one} ${two} ${half}`);
  });
  await check("empty text gives no audio, not an error", async () => {
    const r = await s.speak("   ");
    assert.strictEqual(r.pcm.length, 0);
  });
  s.stop();
  process.exit(failed ? 1 : 0);
})();
