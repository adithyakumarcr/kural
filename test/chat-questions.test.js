// Questions in the chat (lib/chat askUser): an answer with a note from the chat box, asking about a question before you
// answer (the AI answers and asks again), Skip; your picks kept on your message (cleanPicks); and the formatting rules
// every AI gets (lib/chat/prompts.js FORMAT), so Kural can draw the point first, callouts and options.
const assert = require("assert");
const Module = require("module");
const load = Module._load;
const vscode = { workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => ({ get: (k, d) => d }) },
  window: { state: { focused: true } }, env: { appRoot: "/unused" }, commands: { executeCommand: () => {} },
  Uri: { file: (f) => ({ scheme: "file", fsPath: f }) }, EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const { ChatView } = require("../extension/lib/chat");
const { PROMPTS } = require("../extension/lib/chat/prompts");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const tick = () => new Promise((r) => setTimeout(r, 10));

const posted = [];
const chat = Object.create(ChatView.prototype);
Object.assign(chat, { tabs: [], panes: [], runtime: new Map(), post: (m) => posted.push(m), postTabs: () => {}, save: () => {}, warm: () => {},
  notifier: { show: () => {}, clear: () => {} }, router: null, activity: null, changes: { summary: () => [] }, procKey: () => "k" });
const tab = { id: "t1", title: "Plan it", model: "sonnet", mode: "agent", status: "running", messages: [] };
const turn = () => { const reply = { role: "assistant", blocks: [], running: true, t0: Date.now(), mode: "agent", models: ["sonnet"] };
  tab.messages.push({ role: "user", segments: [] }, reply); return { turn: { reply, snaps: {}, ask: "x", journal: { tools: [] } }, perms: new Map(), agents: new Map(), tasks: new Map(), steers: [] }; };
const Q2 = { questions: [{ question: "Q1", options: [{ label: "A" }] }, { question: "Q2", options: [{ label: "B" }] }] };
// Ask a question, wait for the card, answer it the way the page's "answer" message does.
async function asked(input, reply) {
  const r = turn();
  const p = chat.askUser(tab, r, { input });
  await tick();
  const [resolve] = [...r.perms.values()];
  resolve(reply);
  return { result: await p, block: r.turn.reply.blocks.find((b) => b.k === "question") };
}

(async () => {
  await check("an answer with a note: the note goes with the last answer", async () => {
    const { result, block } = await asked(Q2, { answers: { Q1: "A", Q2: "B." }, note: " keep it simple " });
    assert.strictEqual(result.allow, true);
    assert.deepStrictEqual(result.updatedInput.answers, { Q1: "A", Q2: "B. Note: keep it simple" });
    assert.strictEqual(block.state, "answered");
  });

  await check("an answer without a note, and the old plain shape, stay as they were", async () => {
    assert.deepStrictEqual((await asked(Q2, { answers: { Q1: "A", Q2: "B" } })).result.updatedInput.answers, { Q1: "A", Q2: "B" });
    assert.deepStrictEqual((await asked(Q2, { Q1: "A", Q2: "B" })).result.updatedInput.answers, { Q1: "A", Q2: "B" });
  });

  await check("asking about a question: the AI answers and asks again", async () => {
    posted.length = 0;
    const { result, block } = await asked(Q2, { ask: "Which one matters most?" });
    assert.strictEqual(result.allow, true);
    assert.ok(result.updatedInput.answers.Q1.includes('The user hasn\'t chosen yet and asks: "Which one matters most?"'), result.updatedInput.answers.Q1);
    assert.ok(/ask your question again with AskUserQuestion/.test(result.updatedInput.answers.Q1));
    assert.deepStrictEqual([block.state, block.ask], ["asked", "Which one matters most?"]);
    const st = posted.find((m) => m.type === "questionState");
    assert.deepStrictEqual([st.state, st.ask], ["asked", "Which one matters most?"]);
  });

  await check("Skip stays a skip", async () => {
    const { result, block } = await asked(Q2, false);
    assert.strictEqual(result.allow, false);
    assert.strictEqual(block.state, "skipped");
  });

  await check("picks are cleaned", async () => {
    assert.deepStrictEqual(ChatView.cleanPicks([{ question: "Which ones?", choices: ["A", "B"] }, { question: 5, choices: ["x"] }, { question: "q", choices: [] }]),
      [{ question: "Which ones?", choices: ["A", "B"] }]);
    const many = Array.from({ length: 7 }, (_, i) => ({ question: `q${i}`, choices: ["a"] }));
    assert.strictEqual(ChatView.cleanPicks(many).length, 6);
    assert.deepStrictEqual(ChatView.cleanPicks("nope"), []);
    const long = ChatView.cleanPicks([{ question: "x".repeat(400), choices: ["y".repeat(200), 3] }])[0];
    assert.deepStrictEqual([long.question.length, long.choices.length, long.choices[0].length], [300, 1, 120]);
  });

  await check("every mode gets the formatting rules", async () => {
    for (const mode of ["ask", "plan", "agent", "auto"]) {
      for (const s of ["> [!WARNING]", "(Recommended)", "**Goal:**", "- [ ]"]) assert.ok(PROMPTS[mode].includes(s), `${mode}: ${s}`);
    }
    assert.ok(PROMPTS.plan.includes("start with **Goal:** and one sentence"));
  });

  console.log(failed ? `chat-questions: ${failed} FAILED` : "chat-questions: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
