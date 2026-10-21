// Listen: the walkthrough's script (extension/lib/listen/script.js): the numbered blocks sent to the model (cut to the
// limits), the prompt, which model writes it, the <piece for="n"> parser, and a run with a stand-in agent.
const assert = require("assert");
const { LIMITS, blocksText, buildPrompt, PieceParser, pickModel, writeScript } = require("../extension/lib/listen/script");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

// A stand-in for brain.makeAgent: replays `script` (text chunks, then a result) when the prompt is sent.
function fakeDeps(script, over = {}) {
  const seen = { opts: null, prompt: null, killed: false, forgot: false };
  const deps = {
    makeAgent: (model, opts, local, h) => {
      seen.opts = opts; seen.model = model;
      return {
        start: () => true,
        send: (prompt) => { seen.prompt = prompt; (async () => {
          for (const step of script) {
            await new Promise((r) => setTimeout(r, 2));
            if (step.wait) { await new Promise((r) => setTimeout(r, step.wait)); continue; }
            if (step.text) h.onMessage({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: step.text } } });
            if (step.result !== undefined) h.onMessage({ type: "result", result: step.result, is_error: !!step.error });
            if (step.exit) h.onExit({});
          }
        })(); },
        kill: () => { seen.killed = true; },
        forget: () => { seen.forgot = true; },
      };
    },
    isClaude: (m) => m === "haiku", emptyDir: () => "/tmp/empty", cwd: () => "/proj", localOpts: () => ({}), mode: () => "ask",
    ...over,
  };
  return { deps, seen };
}
const BLOCKS = [{ n: 0, kind: "p", text: "The login broke." }, { n: 1, kind: "code", text: "token.refresh()" }];

(async () => {
  await check("the parser yields pieces as they close, across chunks; a wrong block goes to the nearest", () => {
    const p = new PieceParser(4);
    assert.deepStrictEqual(p.push('<piece for="1">Hi th'), []);
    assert.deepStrictEqual(p.push('ere.</piece>junk<piece for="9">Last.</piece>'), [{ block: 1, text: "Hi there." }, { block: 3, text: "Last." }]);
    assert.deepStrictEqual(p.end(), []);
  });
  await check("a reply with no pieces at all is one piece for block 0", () => {
    const q = new PieceParser(2); q.push("No tags at all."); assert.deepStrictEqual(q.end(), [{ block: 0, text: "No tags at all." }]);
  });
  await check("a piece cut off at the end still counts", () => {
    const q = new PieceParser(3); q.push('<piece for="2">Cut off here'); assert.deepStrictEqual(q.end(), [{ block: 2, text: "Cut off here" }]);
  });
  await check("a huge answer is cut to the input limit", () => {
    const big = blocksText([{ n: 0, kind: "p", text: "x".repeat(30000) }, { n: 1, kind: "code", text: Array(300).fill("line").join("\n") }]);
    assert.ok(big.length <= LIMITS.input, `${big.length}`);
    assert.strictEqual(LIMITS.input, 12000);
  });
  await check("a code block is cut to its first 40 lines, a table to 20 rows", () => {
    assert.ok(blocksText([{ n: 0, kind: "code", text: Array(300).fill("l").join("\n") }]).split("\n").length <= 42);
    assert.ok(blocksText([{ n: 0, kind: "table", text: Array(100).fill("a | b").join("\n") }]).split("\n").length <= 22);
  });
  await check("each block is numbered with its kind", () => assert.ok(/\[1\] \(code\)\ntoken\.refresh\(\)/.test(blocksText(BLOCKS))));
  await check("a chat on a local model writes it with that model", () => {
    assert.deepStrictEqual(pickModel("ollama:qwen3", { isLocal: () => true, fastest: () => "haiku" }), { model: "ollama:qwen3" });
  });
  await check("otherwise the fastest model of the chat's AI, never Codex", () => {
    assert.deepStrictEqual(pickModel("opus", { isLocal: () => false, fastest: (m, skip) => (assert.deepStrictEqual(skip, ["codex"]), "haiku") }), { model: "haiku" });
    assert.deepStrictEqual(pickModel("codex:gpt", { isLocal: () => false, fastest: () => null }),
      { why: "Listen needs Claude, Gemini or a model on this computer to write the walkthrough." });
  });
  await check("the prompt names the expression tags only when the voice has them", () => {
    assert.ok(!/laugh/.test(buildPrompt({ blocks: [], request: "", tags: [] }).system));
    assert.ok(/<laugh>/.test(buildPrompt({ blocks: [], request: "", tags: ["laugh"] }).system));
    assert.ok(!/\{\{TAGS\}\}/.test(buildPrompt({ blocks: [], request: "", tags: [] }).system));
  });
  await check("the prompt carries the request and the numbered blocks", () => {
    const p = buildPrompt({ blocks: BLOCKS, request: "Why did login break?", tags: [] }).prompt;
    assert.ok(p.includes("Why did login break?") && p.includes("[0] (p)\nThe login broke."));
  });
  await check("writeScript streams pieces in order and resolves with all of them", async () => {
    const { deps, seen } = fakeDeps([{ text: '<piece for="0">So, the login ' }, { text: 'broke.</piece><piece for="1">This bit refreshes it.</piece>' }, { result: "" }]);
    const got = [];
    const r = await writeScript({ model: "haiku", blocks: BLOCKS, request: "", tags: [], deps, onPiece: (p) => got.push(p) });
    assert.deepStrictEqual(got, [{ block: 0, text: "So, the login broke." }, { block: 1, text: "This bit refreshes it." }]);
    assert.deepStrictEqual(r.pieces, got);
    assert.strictEqual(r.model, "haiku");
    assert.ok(seen.opts.systemPrompt && seen.opts.cwd === "/tmp/empty" && seen.opts.tools.length === 0 && seen.opts.noThinking);
    assert.ok(seen.killed, "the agent is stopped after");
  });
  await check("a model that answers only in its result still gives pieces", async () => {
    const { deps } = fakeDeps([{ result: '<piece for="0">Short one.</piece>' }]);
    const r = await writeScript({ model: "agy:flash", blocks: BLOCKS, request: "", tags: [], deps, onPiece: () => {} });
    assert.deepStrictEqual(r.pieces, [{ block: 0, text: "Short one." }]);
  });
  await check("no piece within the limit: the walkthrough fails with the spec's words", async () => {
    const { deps, seen } = fakeDeps([{ wait: 300 }], { firstPieceMs: 50 });
    await assert.rejects(writeScript({ model: "haiku", blocks: BLOCKS, request: "", tags: [], deps, onPiece: () => {} }),
      /Couldn't write the walkthrough\. Try again\./);
    assert.ok(seen.killed);
  });
  await check("an error result rejects", async () => {
    const { deps } = fakeDeps([{ result: "Not logged in", error: true }]);
    await assert.rejects(writeScript({ model: "haiku", blocks: BLOCKS, request: "", tags: [], deps, onPiece: () => {} }), /Not logged in/);
  });
  await check("stopping it kills the agent and rejects as cancelled", async () => {
    const { deps, seen } = fakeDeps([{ text: '<piece for="0">One.</piece>' }, { wait: 500 }, { result: "" }]);
    const ctl = new AbortController();
    const run = writeScript({ model: "haiku", blocks: BLOCKS, request: "", tags: [], deps, onPiece: () => ctl.abort(), signal: ctl.signal });
    await assert.rejects(run, (e) => e.cancelled === true);
    assert.ok(seen.killed);
  });
  process.exit(failed ? 1 : 0);
})();
