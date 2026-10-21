// Listen, the host (extension/lib/listen/index.js) with stand-ins for the voice, the download and the model: the opener
// first, then sentences in order; only to the pane that started it; one at a time; a toggle; saved walkthroughs replay
// without a model; asking to download; failures; stopping when the pane, the chat or the answer goes.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Listen, OPENERS } = require("../extension/lib/listen/index");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "kural-listen-host-"));

function setup(over = {}) {
  const sent = [], spoken = [];
  const state = { ready: over.ready !== false, saves: 0, cancels: 0, writes: 0 };
  const speaker = {
    speak: async (text) => {
      spoken.push(text);
      if (over.speakFails && spoken.length >= over.speakFails) throw new Error("The voice stopped (exited with 3).");
      await sleep(over.speakMs || 1);
      return { pcm: new Int16Array(Math.max(1, text.length)), rate: 24000, ms: 1 };
    },
    cancel: () => { state.cancels++; }, warm: () => { state.warmed = true; }, stop: () => {},
  };
  const assets = {
    ready: async () => state.ready,
    download: over.download || (async ({ onProgress }) => { onProgress(50, 100); onProgress(100, 100); state.ready = true; }),
    paths: () => ({}),
  };
  const write = over.write || (async ({ onPiece, signal }) => {
    state.writes++;
    const pieces = over.pieces || [{ block: 0, text: "So, the login broke. Here's why." }, { block: 2, text: "This part refreshes the token." }];
    for (const p of pieces) { await sleep(2); if (signal && signal.aborted) { const e = new Error("Stopped."); e.cancelled = true; throw e; } onPiece(p); }
    if (over.writeFails) throw new Error("Couldn't write the walkthrough. Try again.");
    return { pieces, model: "haiku" };
  });
  const listen = new Listen({ dir: over.dir || tmp(), engine: "supertonic", postTo: (pane, msg) => sent.push({ pane, msg }),
    save: () => { state.saves++; }, pick: over.pick || (() => ({ model: "haiku" })), nameOf: () => "Haiku 4.5", scriptDeps: {},
    speaker, assets, write, platform: over.platform });
  const tab = { id: "t1", messages: [{ role: "user", segments: [{ t: "text", v: "Why?" }] }, { role: "assistant", blocks: [] }, { role: "user" }, { role: "assistant", blocks: [] }] };
  return { listen, sent, spoken, state, tab };
}
const BLOCKS = [{ n: 0, kind: "p", text: "a" }, { n: 1, kind: "p", text: "b" }, { n: 2, kind: "code", text: "c" }];
const types = (sent) => sent.map((s) => s.msg.type === "listenState" ? `state:${s.msg.phase}` : s.msg.type);
const until = async (fn, ms = 2000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error("timed out"); await sleep(5); } };

(async () => {
  await check("first time: the opener, then each sentence in order with its block, then the end; saved", async () => {
    const { listen, sent, tab, state } = setup();
    await listen.makeOpeners();
    sent.length = 0;
    await listen.start("A", tab, 1, BLOCKS);
    await until(() => sent.some((s) => s.msg.type === "listenEnd"));
    const audio = sent.filter((s) => s.msg.type === "listenAudio").map((s) => s.msg);
    assert.strictEqual(audio[0].opener, true);
    assert.deepStrictEqual(audio.slice(1).map((a) => [a.block, a.text]),
      [[0, "So, the login broke."], [0, "Here's why."], [2, "This part refreshes the token."]]);
    assert.deepStrictEqual(audio.map((a) => a.seq), audio.map((_, i) => i));
    assert.ok(audio.every((a) => a.tabId === "t1" && a.index === 1 && a.pcm instanceof Int16Array && a.rate === 24000));
    assert.ok(types(sent).indexOf("state:preparing") < types(sent).indexOf("listenAudio"));
    assert.deepStrictEqual(tab.messages[1].listen.pieces, [{ block: 0, text: "So, the login broke. Here's why." }, { block: 2, text: "This part refreshes the token." }]);
    assert.strictEqual(tab.messages[1].listen.engine, "supertonic");
    assert.strictEqual(tab.messages[1].listen.model, "Haiku 4.5");
    assert.ok(state.saves >= 1);
  });
  await check("every message went to the pane that started it", async () => {
    const { listen, sent, tab } = setup();
    await listen.start("A", tab, 1, BLOCKS);
    await until(() => sent.some((s) => s.msg.type === "listenEnd"));
    assert.ok(sent.length > 3 && sent.every((s) => s.pane === "A"));
  });
  await check("replay of a saved walkthrough: no opener, no model", async () => {
    const { listen, sent, tab, state } = setup();
    await listen.makeOpeners();
    tab.messages[1].listen = { pieces: [{ block: 1, text: "Saved one." }], model: "Haiku 4.5", engine: "supertonic", at: 1 };
    sent.length = 0;
    await listen.start("A", tab, 1, BLOCKS);
    await until(() => sent.some((s) => s.msg.type === "listenEnd"));
    assert.strictEqual(state.writes, 0);
    const audio = sent.filter((s) => s.msg.type === "listenAudio").map((s) => s.msg);
    assert.deepStrictEqual(audio.map((a) => [a.block, a.text, !!a.opener]), [[1, "Saved one.", false]]);
  });
  await check("Listen on another answer stops the first (its pane is told) and plays the second", async () => {
    const { listen, sent, tab } = setup({ speakMs: 30 });
    await listen.start("A", tab, 1, BLOCKS);
    await sleep(20);
    await listen.start("B", tab, 3, BLOCKS);
    await until(() => sent.some((s) => s.msg.type === "listenEnd"));
    assert.ok(sent.some((s) => s.pane === "A" && s.msg.type === "listenState" && s.msg.phase === "stopped" && s.msg.index === 1));
    assert.ok(sent.some((s) => s.pane === "B" && s.msg.type === "listenEnd" && s.msg.index === 3));
    assert.ok(!sent.some((s) => s.pane === "A" && s.msg.type === "listenEnd"));
  });
  await check("Listen again on the answer that is playing stops it, and starts nothing", async () => {
    const { listen, sent, tab, state } = setup({ speakMs: 30 });
    await listen.start("A", tab, 1, BLOCKS);
    await sleep(15);
    await listen.start("A", tab, 1, BLOCKS);
    await sleep(150);
    assert.strictEqual(listen.job, null);
    assert.ok(sent.some((s) => s.msg.type === "listenState" && s.msg.phase === "stopped"));
    assert.ok(!sent.some((s) => s.msg.type === "listenEnd"));
    assert.strictEqual(state.writes, 1);
    assert.ok(state.cancels >= 1);
    assert.strictEqual(tab.messages[1].listen, undefined, "nothing half-made is saved");
  });
  await check("the voice not there: ask with its size and the model's name; after the download, openers are made and it starts", async () => {
    const dir = tmp();
    const { listen, sent, spoken, tab } = setup({ ready: false, dir });
    await listen.start("A", tab, 1, BLOCKS);
    const ask = sent.find((s) => s.msg.type === "listenState" && s.msg.phase === "ask");
    assert.ok(ask && ask.msg.size > 400e6 && ask.msg.model === "Haiku 4.5", JSON.stringify(ask && ask.msg));
    await listen.download("A", tab);
    assert.ok(sent.some((s) => s.msg.type === "listenState" && s.msg.phase === "downloading" && s.msg.pct === 50));
    for (const line of OPENERS) assert.ok(spoken.includes(line), line);
    assert.ok(fs.existsSync(path.join(dir, "openers", "0.pcm")));
    await until(() => sent.some((s) => s.msg.type === "listenEnd"));
  });
  await check("the voice missing on a later start asks again", async () => {
    const { listen, sent, tab, state } = setup();
    state.ready = false;
    await listen.start("A", tab, 1, BLOCKS);
    assert.ok(sent.some((s) => s.msg.type === "listenState" && s.msg.phase === "ask"));
    assert.strictEqual(state.writes, 0);
  });
  await check("a failed download says why; the next start asks again", async () => {
    const { listen, sent, tab } = setup({ ready: false, download: async () => { throw new Error("The voice's download didn't match what Kural expects, so it was deleted. Try again later."); } });
    await listen.start("A", tab, 1, BLOCKS);
    await listen.download("A", tab);
    assert.ok(sent.some((s) => s.msg.phase === "error" && /didn't match/.test(s.msg.message)));
    sent.length = 0;
    await listen.start("A", tab, 1, BLOCKS);
    assert.ok(sent.some((s) => s.msg.phase === "ask"));
  });
  await check("the model fails partway: what's made plays, then the closing line; partial; nothing saved", async () => {
    const { listen, sent, spoken, tab } = setup({ writeFails: true, pieces: [{ block: 0, text: "First bit." }] });
    await listen.start("A", tab, 1, BLOCKS);
    await until(() => sent.some((s) => s.msg.type === "listenEnd"));
    assert.ok(spoken.includes("First bit.") && spoken[spoken.length - 1] === "That's all I could put together.");
    assert.strictEqual(sent.find((s) => s.msg.type === "listenEnd").msg.partial, true);
    assert.strictEqual(tab.messages[1].listen, undefined);
  });
  await check("the voice crashes: an error with the spec's words; nothing saved; the next start works", async () => {
    const { listen, sent, tab } = setup({ speakFails: 1 });
    await listen.start("A", tab, 1, BLOCKS);
    await until(() => sent.some((s) => s.msg.phase === "error"));
    assert.strictEqual(sent.find((s) => s.msg.phase === "error").msg.message, "The voice stopped. Try again.");
    assert.strictEqual(tab.messages[1].listen, undefined);
    assert.strictEqual(listen.job, null);
  });
  await check("the pane going, the chat closing, or Edit removing the answer stops it", async () => {
    for (const how of ["pane", "tab", "cut"]) {
      const { listen, sent, tab, state } = setup({ speakMs: 30 });
      await listen.start("A", tab, 1, BLOCKS);
      await sleep(10);
      if (how === "pane") listen.paneGone("A");
      if (how === "tab") listen.tabClosed("t1");
      if (how === "cut") { tab.messages.length = 1; listen.cut(tab); }
      await sleep(120);
      assert.strictEqual(listen.job, null, how);
      assert.ok(state.cancels >= 1, how);
      assert.ok(!sent.some((s) => s.msg.type === "listenEnd"), how);
      assert.strictEqual((tab.messages[1] || {}).listen, undefined, how);
    }
  });
  await check("a read-only chat, a running answer or a user message: nothing starts", async () => {
    const { listen, sent, tab } = setup();
    tab.visiting = true;
    await listen.start("A", tab, 1, BLOCKS);
    delete tab.visiting; tab.messages[1].running = true;
    await listen.start("A", tab, 1, BLOCKS);
    delete tab.messages[1].running;
    await listen.start("A", tab, 0, BLOCKS);
    assert.strictEqual(sent.length, 0);
  });
  await check("no model to write it: why() says so, and start shows it", async () => {
    const why = "Listen needs Claude, Gemini or a model on this computer to write the walkthrough.";
    const { listen, sent, tab } = setup({ pick: () => ({ why }) });
    assert.strictEqual(listen.why(tab), why);
    await listen.start("A", tab, 1, BLOCKS);
    assert.ok(sent.some((s) => s.msg.phase === "error" && s.msg.message === why));
  });
  await check("a computer Kural has no voice for: why() says so", () => {
    const { listen, tab } = setup({ platform: ["linux", "arm64"] });
    assert.strictEqual(listen.why(tab), "Listen's voice isn't available for this computer yet.");
  });
  await check("clean drops walkthroughs that aren't the right shape", () => {
    const msgs = [{ listen: { pieces: [{ block: 0, text: "ok" }], model: "m", engine: "supertonic", at: 1 } }, { listen: { pieces: "x" } },
      { listen: { pieces: [{ block: "0", text: 3 }] } }, {}];
    Listen.clean(msgs);
    assert.ok(msgs[0].listen && !("listen" in msgs[1]) && !("listen" in msgs[2]) && !("listen" in msgs[3]));
  });
  process.exit(failed ? 1 : 0);
})();
