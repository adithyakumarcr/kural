// Side chat, the host half (extension/lib/chat/side.js): the prompt, the saved thread, follow-ups, stop, errors, and that
// the main conversation never sees any of it (handoff, fork).
const assert = require("assert");
const { SideChats, buildPrompt, around, answerText, SYSTEM } = require("../extension/lib/chat/side");
const journal = require("../extension/lib/router/journal");
const { forkConversation } = require("../extension/lib/chat/fork");
const { handoffSave } = { handoffSave: require("../extension/lib/chat/handoff-store").save };

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

// A stand-in AI program: remembers what it was sent and answers when told to.
function harness(over = {}) {
  const posts = [], agents = [];
  let saved = 0;
  const d = {
    makeAgent: (model, opts, local, handlers) => {
      const a = { model, opts, handlers, sent: [], killed: false, started: true,
        start() { return this.started; }, send(p) { this.sent.push(p); }, kill() { this.killed = true; },
        say(text) { handlers.onMessage({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } }); },
        finish(result, is_error = false) { handlers.onMessage({ type: "result", is_error, result }); } };
      agents.push(a); return a;
    },
    model: () => "haiku", check: () => ({ ok: true }), isClaude: (m) => m === "haiku", nameOf: (m) => m[0].toUpperCase() + m.slice(1),
    localOpts: () => null, textOf: (segs) => segs.map((s) => s.v).join(""), cwd: () => "/work", post: (m) => posts.push(m), save: () => { saved++; },
    ...over };
  return { side: new SideChats(d), posts, agents, saved: () => saved };
}
const tab = () => ({ id: "t1", status: "idle", messages: [
  { role: "user", segments: [{ t: "text", v: "How does the router choose?" }] },
  { role: "assistant", blocks: [{ k: "text", text: "It classifies the request, then picks the lightest model with the needed tier." }], running: false, journal: { tools: [] } },
] });
const ask = (h, t, p = {}) => h.side.ask(t, { index: 1, thread: "a1", quote: "the lightest model", question: "Why the lightest?", ...p });

(async () => {
  await check("the prompt: your request, the answer, the selection, then the question; no tools, short system text", () => {
    const p = buildPrompt({ request: "How?", answer: "An answer.", quote: "answer", items: [], question: "Why?" });
    assert.match(p, /<request>[^]*How\?[^]*<\/request>/);
    assert.match(p, /<answer>[^]*An answer\.[^]*<\/answer>/);
    assert.match(p, /<selection>[^]*answer[^]*<\/selection>/);
    assert.ok(p.trim().endsWith("Side question about the selection:\nWhy?"));
    assert.doesNotMatch(p, /side_conversation/);
    assert.match(SYSTEM, /Be brief/); assert.match(SYSTEM, /Don't repeat the quoted text/);
  });
  await check("a long answer is cut to about 6,000 characters around the selection, and says so", () => {
    const text = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(" ");   // ~14,000 characters
    const w = around(text, "word1500 word1501 word1502");
    assert.ok(w.includes("word1500 word1501"), "the selection is inside");
    assert.ok(w.length < 6100 && w.length > 5900, `${w.length}`);
    assert.match(w, /earlier part left out/); assert.match(w, /later part left out/);
    assert.ok(!w.includes("word5 "), "far from the selection: left out");
    // a selection that isn't found (formatting differs): the beginning
    assert.ok(around(text, "not in the text at all").startsWith("word0 word1"));
    assert.strictEqual(around("short", "x"), "short");
  });
  await check("a long request and long earlier answers are trimmed; only the last six questions go along", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ q: `q${i}`, a: "x".repeat(4000) }));
    const p = buildPrompt({ request: "r".repeat(5000), answer: "a", quote: "a", items, question: "next" });
    assert.ok(p.length < 15000, `${p.length}`);
    assert.ok(!p.includes("Question: q2\n") && p.includes("Question: q3\n") && p.includes("Question: q8\n"));
    assert.ok(!p.includes("r".repeat(1600)));
  });
  await check("a failed earlier question isn't sent as context", () => {
    const p = buildPrompt({ request: "", answer: "a", quote: "a", items: [{ q: "bad", a: "", error: "x" }, { q: "good", a: "yes" }], question: "n" });
    assert.ok(!p.includes("bad") && p.includes("Question: good\nAnswer: yes"));
  });

  await check("asking: the question is saved with the answer, streams, ends with the full answer; the model's name is kept", async () => {
    const h = harness(), t = tab();
    assert.strictEqual(ask(h, t), true);
    const msg = t.messages[1], th = msg.side[0], item = th.items[0];
    assert.deepStrictEqual([th.id, th.quote, item.q, item.model, item.running], ["a1", "the lightest model", "Why the lightest?", "Haiku", true]);
    const a = h.agents[0];
    assert.strictEqual(a.model, "haiku");
    assert.deepStrictEqual([a.opts.tools, a.opts.effort, a.opts.safeMode, a.opts.systemPrompt], [[], "low", true, SYSTEM], "no tools, quick, Claude's own prompt replaced");
    assert.match(a.sent[0], /How does the router choose\?/);
    assert.match(a.sent[0], /It classifies the request/);
    assert.match(a.sent[0], /Why the lightest\?$/);
    a.say("Because "); a.say("it is quick.");
    assert.deepStrictEqual(h.posts.filter((p) => p.type === "sideDelta").map((p) => p.text), ["Because ", "it is quick."]);
    assert.strictEqual(item.a, "Because it is quick.");
    a.finish("Because it is quick.");
    assert.strictEqual(item.running, undefined);
    assert.strictEqual(item.a, "Because it is quick.");
    assert.ok(a.killed, "its program stops: one process per question");
    const last = h.posts.filter((p) => p.type === "sideState").pop();
    assert.deepStrictEqual([last.index, last.thread, last.n, last.item.a, last.item.running], [1, "a1", 0, "Because it is quick.", undefined]);
    assert.ok(h.saved() >= 1, "saved with the chat");
  });
  await check("it never touches the chat: status stays, no turn, no blocks added, the program of the chat isn't involved", () => {
    const h = harness(), t = tab(), before = JSON.stringify(t.messages[1].blocks);
    t.status = "running";   // asking while the main answer is still running
    ask(h, t);
    h.agents[0].say("x"); h.agents[0].finish("x");
    assert.strictEqual(t.status, "running"); assert.strictEqual(JSON.stringify(t.messages[1].blocks), before);
    assert.strictEqual(t.messages.length, 2);
    assert.ok(h.posts.every((p) => /^side/.test(p.type)), "only side messages were posted: no status, no notification");
  });
  await check("a follow-up in the same thread carries the earlier questions and answers", () => {
    const h = harness(), t = tab();
    ask(h, t); h.agents[0].say("It is quick."); h.agents[0].finish("It is quick.");
    ask(h, t, { question: "And the best one?" });
    assert.strictEqual(t.messages[1].side.length, 1); assert.strictEqual(t.messages[1].side[0].items.length, 2);
    assert.match(h.agents[1].sent[0], /<side_conversation>\nQuestion: Why the lightest\?\nAnswer: It is quick\.\n<\/side_conversation>/);
    assert.match(h.agents[1].sent[0], /And the best one\?$/);
  });
  await check("a second thread on the same answer starts without the first one's questions", () => {
    const h = harness(), t = tab();
    ask(h, t); h.agents[0].say("A."); h.agents[0].finish("A.");
    ask(h, t, { thread: "b2", quote: "tier", question: "What tier?" });
    assert.strictEqual(t.messages[1].side.length, 2);
    assert.doesNotMatch(h.agents[1].sent[0], /side_conversation/);
  });
  await check("one question at a time per thread; another thread can run alongside", () => {
    const h = harness(), t = tab();
    assert.strictEqual(ask(h, t), true);
    assert.strictEqual(ask(h, t, { question: "again" }), false);
    assert.strictEqual(ask(h, t, { thread: "b2" }), true);
    assert.strictEqual(t.messages[1].side[0].items.length, 1);
  });
  await check("stop: the program is stopped, what came so far stays, marked stopped; closing the chat stops all", () => {
    const h = harness(), t = tab();
    ask(h, t); h.agents[0].say("Half an ans");
    assert.strictEqual(h.side.stop("t1", "a1"), true);
    const item = t.messages[1].side[0].items[0];
    assert.deepStrictEqual([item.a, item.stopped, item.running, item.error], ["Half an ans", true, undefined, undefined]);
    assert.ok(h.agents[0].killed);
    assert.strictEqual(h.side.stop("t1", "a1"), false, "nothing left to stop");
    ask(h, t, { question: "second" }); ask(h, t, { thread: "b2", question: "third" });
    h.side.stopAll("t1");
    assert.ok(h.agents[1].killed && h.agents[2].killed && h.side.runs.size === 0);
  });
  await check("errors: a model that says it failed, one that exits, one that can't start, one that isn't set up", () => {
    let h = harness(), t = tab();
    ask(h, t); h.agents[0].finish("Claude isn't logged in", true);
    assert.strictEqual(t.messages[1].side[0].items[0].error, "Claude isn't logged in");
    h = harness(); t = tab(); ask(h, t); h.agents[0].handlers.onExit({ stderr: "" });
    assert.match(t.messages[1].side[0].items[0].error, /stopped before it answered/);
    h = harness(); t = tab(); ask(h, t); h.agents[0].handlers.onExit({ login: true });
    assert.match(t.messages[1].side[0].items[0].error, /Not logged in/);
    h = harness({ makeAgent: () => ({ start: () => false, kill() {}, send() {} }) }); t = tab(); ask(h, t);
    assert.match(t.messages[1].side[0].items[0].error, /Couldn't start/);
    h = harness({ check: () => ({ why: "Codex isn't set up." }) }); t = tab(); ask(h, t);
    assert.strictEqual(t.messages[1].side[0].items[0].error, "Codex isn't set up.");
    assert.strictEqual(h.agents.length, 0, "nothing was started");
    h = harness(); t = tab(); ask(h, t); h.agents[0].finish("");
    assert.match(t.messages[1].side[0].items[0].error, /no answer/);
  });
  await check("a slow model is stopped after the time limit", async () => {
    const h = harness({ timeoutMs: 30 }), t = tab();
    ask(h, t);
    await new Promise((r) => setTimeout(r, 80));
    assert.match(t.messages[1].side[0].items[0].error, /too long/); assert.ok(h.agents[0].killed);
  });
  await check("it refuses what isn't an answer to ask about, empty questions and odd ids", () => {
    const h = harness(), t = tab();
    assert.strictEqual(ask(h, t, { index: 0 }), false, "your own message");
    assert.strictEqual(ask(h, t, { index: 9 }), false);
    assert.strictEqual(ask(h, t, { question: "   " }), false);
    assert.strictEqual(ask(h, t, { thread: "../x" }), false);
    t.visiting = { name: "x" }; assert.strictEqual(ask(h, t), false, "a chat from another workspace is read only");
    assert.strictEqual(h.agents.length, 0);
  });
  await check("a model other than Claude gets the instructions as its appended prompt and runs where the chat does", () => {
    const h = harness({ model: () => "codex:mini", isClaude: () => false }), t = tab();
    ask(h, t);
    assert.deepStrictEqual([h.agents[0].opts.appendSystemPrompt, h.agents[0].opts.cwd, h.agents[0].opts.mode, h.agents[0].opts.systemPrompt], [SYSTEM, "/work", "ask", undefined]);
  });

  await check("the main conversation never sees side threads: handoff, fork and the handoff archive", () => {
    const h = harness(), t = tab();
    ask(h, t, { quote: "SECRETQUOTE", question: "SECRETQUESTION" }); h.agents[0].say("SECRETANSWER"); h.agents[0].finish("SECRETANSWER");
    assert.ok(JSON.stringify(t.messages).includes("SECRETANSWER"), "(it is saved on the message)");
    const hand = journal.handoff(t.messages);
    assert.ok(!/SECRET/.test(hand), "handoff");
    assert.ok(!/SECRET/.test(journal.handoff(t.messages, 300)), "compacted handoff");
    assert.ok(!/SECRET/.test(JSON.stringify(journal.entries(t.messages))), "journal entries");
    const fork = forkConversation({ ...t, id: "t1", title: "x", model: "sonnet" }, 1, { id: "f1", sessionId: "s" });
    assert.ok(!/SECRET/.test(fork.carryOver.text), "a fork's handoff");
    assert.strictEqual(fork.messages[1].side[0].items[0].a, "SECRETANSWER", "(the fork keeps them with the answer, as a copy)");
    fork.messages[1].side[0].items[0].a = "changed";
    assert.strictEqual(t.messages[1].side[0].items[0].a, "SECRETANSWER", "(a real copy)");
    const os = require("os"), fs = require("fs"), path = require("path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "side-"));
    const rec = handoffSave(t.messages, dir);
    assert.ok(!/SECRET/.test(fs.readFileSync(rec.path, "utf8")), "the complete-history file for another AI");
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await check("a saved chat: a question that was running comes back stopped; broken threads are dropped", () => {
    const msgs = [{ role: "assistant", blocks: [], side: [{ id: "a1", quote: "q", items: [{ q: "x", a: "part", running: true }] }, { id: "bad id!", items: [] }, null] },
      { role: "assistant", blocks: [], side: "nonsense" }, { role: "user", segments: [] }];
    SideChats.clean(msgs);
    assert.deepStrictEqual(msgs[0].side, [{ id: "a1", quote: "q", items: [{ q: "x", a: "part", stopped: true }] }]);
    assert.strictEqual(msgs[1].side, undefined);
  });
  await check("answerText joins the text blocks only", () => {
    assert.strictEqual(answerText({ blocks: [{ k: "text", text: "a" }, { k: "tool", name: "Read" }, { k: "text", text: "b" }] }), "ab");
  });

  console.log(failed ? `side-chat: ${failed} FAILED` : "side-chat: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
