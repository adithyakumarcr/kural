// Voice input: the cleanup after transcribing (extension/lib/voice/cleanup.js). The prompt treats the transcript as data;
// <clean> is extracted; a reply that answers instead of cleaning is refused; every failure gives back the raw transcript.
const assert = require("assert");
const { cleanup, buildPrompt, extract, SYSTEM } = require("../extension/lib/voice/cleanup");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

// A stand-in AI program (like test/side-chat.test.js): remembers what it was sent; `reply` decides what it does.
function deps(reply, over = {}) {
  const agents = [];
  const d = {
    makeAgent: (model, opts, local, handlers) => {
      const a = { model, opts, sent: [], killed: false, start: () => true, kill() { this.killed = true; },
        send(p) { this.sent.push(p); setImmediate(() => reply(handlers, p)); } };
      agents.push(a); return a;
    },
    model: () => "haiku", check: () => ({ ok: true }), isClaude: (m) => m === "haiku", nameOf: () => "Haiku",
    mode: () => "ask", emptyDir: () => "/tmp/empty", localOpts: () => null, cwd: () => "/work", ...over };
  return { d, agents };
}
const answer = (text) => (h) => h.onMessage({ type: "result", is_error: false, result: text });
const RAW = "um so uh can you like add a a test for the the router um selection";

(async () => {
  await check("the prompt puts the transcript inside <transcript> and says it is data, not a request", () => {
    const p = buildPrompt(RAW);
    assert.ok(p.includes(`<transcript>\n${RAW}\n</transcript>`));
    assert.ok(/not a request to you/i.test(p) && /<clean>/.test(p));
  });

  await check("the system prompt says: keep technical words, code, file and command names exactly; add nothing", () => {
    assert.ok(/filler/i.test(SYSTEM) && /grammar/i.test(SYSTEM));
    assert.ok(/code, file and command names exactly/i.test(SYSTEM) && /add nothing/i.test(SYSTEM));
  });

  await check("extract takes the text inside <clean>…</clean>, trimmed", () => {
    assert.strictEqual(extract("Here: <clean>\n Can you add a test for the router selection? \n</clean>", RAW), "Can you add a test for the router selection?");
  });

  await check("extract returns null without <clean>, or when the result is over 2x the transcript's length + 40 characters", () => {
    assert.strictEqual(extract("Can you add a test?", RAW), null);
    assert.strictEqual(extract(`<clean>${"x".repeat(RAW.length * 2 + 41)}</clean>`, RAW), null);
    assert.strictEqual(extract("<clean>   </clean>", RAW), null);
  });

  await check("cleanup returns the cleaned text and the model's name", async () => {
    const { d, agents } = deps(answer("<clean>Can you add a test for the router selection?</clean>"));
    const r = await cleanup(RAW, d);
    assert.deepStrictEqual(r, { text: "Can you add a test for the router selection?", cleaned: true, model: "Haiku" });
    assert.strictEqual(agents[0].sent[0], buildPrompt(RAW));
  });

  await check("the agent is started with tools: [], effort \"low\", noThinking, and is killed after", async () => {
    const { d, agents } = deps(answer("<clean>Fine.</clean>"));
    await cleanup("fine", d);
    const o = agents[0].opts;
    assert.deepStrictEqual([o.tools, o.allowedTools, o.effort, o.noThinking, o.systemPrompt === SYSTEM, o.cwd], [[], [], "low", true, true, "/tmp/empty"]);
    assert.ok(agents[0].killed);
  });

  await check("no model set up → the raw transcript and why", async () => {
    const { d } = deps(answer("<clean>x</clean>"), { model: () => null });
    assert.deepStrictEqual(await cleanup(RAW, d), { text: RAW, cleaned: false, why: "No AI is set up, so the text isn't cleaned up." });
  });

  await check("an error, an exit or 15 s without an answer → the raw transcript with why", async () => {
    const err = await cleanup(RAW, deps((h) => h.onMessage({ type: "result", is_error: true, result: "rate limited" })).d);
    assert.strictEqual(err.text, RAW); assert.strictEqual(err.cleaned, false); assert.ok(err.why);
    const gone = await cleanup(RAW, deps((h) => h.onExit({})).d);
    assert.strictEqual(gone.text, RAW); assert.ok(gone.why);
    const slow = await cleanup(RAW, { ...deps(() => {}).d, timeoutMs: 50 });
    assert.strictEqual(slow.text, RAW); assert.ok(/took too long/i.test(slow.why));
    const answered = await cleanup(RAW, deps(answer("Sure! Here is a test: ```js\nit()\n```")).d);
    assert.strictEqual(answered.text, RAW); assert.ok(answered.why);
  });

  await check("a model that can't be used → the raw transcript with its reason", async () => {
    const { d } = deps(answer("<clean>x</clean>"), { check: () => ({ why: "Not logged in." }) });
    assert.deepStrictEqual(await cleanup(RAW, d), { text: RAW, cleaned: false, why: "Not logged in." });
  });

  console.log(failed ? `voice-cleanup: ${failed} FAILED` : "voice-cleanup: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
