// Parallel agents in the chat (lib/chat/index.js's half, and the page's media/split.js on a tiny DOM): the model menu's
// choices, which answers split, the plan card and its answers, and the hand-over between parallel and ordinary answers.
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");
const config = { get: (k, d) => d, inspect: () => ({}), update: async () => {} };
const load = Module._load;
const vscode = { workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => config },
  ConfigurationTarget: { Global: 1 }, env: { appRoot: "/unused" }, commands: { executeCommand: () => {} }, Uri: { file: (fsPath) => ({ scheme: "file", fsPath }) } };
const proxy = new Proxy(vscode, { get: (o, k) => o[k] || new Proxy(function () {}, { get: () => () => {} }) });
Module._load = function (r, ...args) { return r === "vscode" ? proxy : load.call(this, r, ...args); };
const { ChatView } = require("../extension/lib/chat"), { Attachments } = require("../extension/lib/chat/attachments");
const brain = require("../extension/lib/ai");
const makeSplit = require("../extension/media/split.js");
brain.providerOf = (m) => ({ ready: () => true, label: m, id: brain.engineOf(m) });
brain.fastestModel = (prefer) => (brain.engineOf(prefer) === "claude" ? "haiku" : `${brain.engineOf(prefer)}:mini`);
brain.cli.codex.models = [{ id: "big", label: "GPT Big" }, { id: "mini", label: "GPT Mini" }];

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-split-chat-"));

function fixture(extra = {}) {
  const tab = { id: "chat", title: "Example", status: "idle", model: "opus", mode: "agent", effort: "medium", autoRoute: false, routingProfile: "balance",
    messages: [], engine: "claude", started: true, sessionId: "s1", mood: "default", split: true, workers: {}, ...extra };
  const chat = Object.create(ChatView.prototype), sent = [], posted = [];
  Object.assign(chat, { tabs: [tab], panes: [], routingJobs: new Map(), runtime: new Map(), localReady: new Map(), attachments: new Attachments(),
    post: (m) => posted.push(m), postTabs: () => {}, save: () => {}, remember: () => {}, isReady: () => true, warm: () => {}, notify: () => {},
    clearNotice: () => {}, endDevice: () => {}, finishTurn: () => {}, buildPrompt: async (text) => text, prepareLocal: async () => ({ ok: true }),
    procKey: (t) => `${t.model}|${t.mode}|${chat.splitOn(t)}`, handoffDir: () => path.join(tmp, "handoff"), handoffBudget: () => 120000, context: { globalState: { get: () => ({}), update: async () => {} } },
    router: { options: () => ({ context: false, checkpoints: true, handoffChars: 120000 }), taskDone: () => {} },
    usageOptions: () => ({ enabled: false }), pane: null,
    startProc: (t) => {
      const r = { proc: { send: (s) => sent.push(s), kill: () => {}, interrupt: () => {}, opts: {} }, procKey: chat.procKey(t), agents: new Map(), perms: new Map(), tasks: new Map(), steers: [], expect: [] };
      chat.runtime.set(t.id, r); return r;
    } });
  return { chat, tab, sent, posted };
}

(async () => {
  await check("which answers split: on, in Agent or Auto, with a cloud AI", () => {
    const { chat, tab } = fixture();
    assert.strictEqual(chat.splitOn(tab), true);
    assert.strictEqual(chat.splitOn({ ...tab, mode: "auto" }), true);
    assert.strictEqual(chat.splitOn({ ...tab, mode: "plan" }), false);
    assert.strictEqual(chat.splitOn({ ...tab, mode: "ask" }), false);
    assert.strictEqual(chat.splitOn({ ...tab, split: false }), false);
    assert.strictEqual(chat.splitOn({ ...tab, model: "ollama:qwen3" }), false);
  });

  await check("the agents' model: yours for the chat's AI (kept per AI), else that AI's lightest", async () => {
    const { chat, tab } = fixture();
    assert.deepStrictEqual(chat.workerModels(tab).map((m) => m.id), ["opus", "sonnet", "haiku"]);
    assert.strictEqual(chat.workersFor(tab), "haiku");
    await chat.handle({ type: "setWorkers", tabId: tab.id, model: "sonnet" });
    assert.strictEqual(chat.workersFor(tab), "sonnet");
    await chat.handle({ type: "setWorkers", tabId: tab.id, model: "codex:mini" });   // (not this AI's: ignored)
    assert.deepStrictEqual(tab.workers, { claude: "sonnet" });
    tab.model = "codex:big";
    assert.deepStrictEqual(chat.workerModels(tab).map((m) => m.id), ["codex:big", "codex:mini"]);
    assert.strictEqual(chat.workersFor(tab), "codex:mini");
    await chat.handle({ type: "setWorkers", tabId: tab.id, model: "codex:big" });
    assert.deepStrictEqual(tab.workers, { claude: "sonnet", codex: "codex:big" });
    await chat.handle({ type: "setSplit", tabId: tab.id, on: false });
    assert.strictEqual(tab.split, false);
    // (Old chats: the agent team's fields go; a worker entry of another AI goes.)
    const old = chat.fix({ ...tab, team: 3, roles: ["tester"], teamStyle: "split", workers: { claude: "codex:big", codex: "codex:mini" } });
    assert.ok(!("team" in old) && !("roles" in old) && !("teamStyle" in old));
    assert.deepStrictEqual(old.workers, { codex: "codex:mini" });
  });

  await check("the plan card: Go ahead with your models (an unknown one becomes the default), a change, or Stop", async () => {
    const { chat, tab, posted } = fixture();
    const r = chat.startProc(tab); r.turn = { reply: { blocks: [], running: true } };
    const plan = { summary: "Two parts", models: chat.workerModels(tab), tasks: [{ title: "A", files: ["a.js"], model: "haiku" }, { title: "B", files: [], model: "haiku" }] };
    const answer = async (msg) => {
      const p = chat.askPlan(tab, r, plan);
      const card = posted.filter((m) => m.type === "block").pop().block;
      assert.strictEqual(card.k, "split"); assert.strictEqual(tab.status, "waiting");
      await chat.handle({ type: "splitAnswer", tabId: tab.id, pid: card.pid, ...msg });
      return { out: await p, card };
    };
    const go = await answer({ go: true, models: ["sonnet", "gpt-9"] });
    assert.deepStrictEqual(go.out, { go: true, models: ["sonnet", "haiku"] });
    assert.strictEqual(go.card.state, "approved"); assert.deepStrictEqual(go.card.tasks.map((t) => t.model), ["sonnet", "haiku"]);
    assert.strictEqual(tab.status, "running");
    const change = await answer({ change: "  one agent for the docs  " });
    assert.deepStrictEqual(change.out, { change: "one agent for the docs" }); assert.strictEqual(change.card.state, "changed");
    assert.deepStrictEqual((await answer({ go: false })).out, { stop: true });
    // Stop while it waits: the card ends as stopped.
    const p = chat.askPlan(tab, r, plan);
    for (const res of r.perms.values()) res(false);
    assert.deepStrictEqual(await p, { stop: true });
  });

  await check("parallel answers get the conversation from the chat; the next ordinary answer starts a session that's handed it", async () => {
    const { chat, tab, sent } = fixture({ messages: [{ role: "user", segments: [{ t: "text", v: "Earlier request" }] }, { role: "assistant", blocks: [{ k: "text", text: "Earlier answer" }] }] });
    await chat.send(tab, [{ t: "text", v: "Build both parts" }], []);
    assert.strictEqual(tab.splitTurns, true);
    assert.doesNotMatch(String(sent[0]), /earlier_conversation/);   // (splitHistory gives it: not twice)
    // The history a parallel answer's lead gets: everything before the newest message.
    assert.match(chat.splitHistory(tab), /Earlier request/); assert.doesNotMatch(chat.splitHistory(tab), /Build both parts/);
    const r = chat.runtime.get(tab.id); chat.finishReply(tab, r, { type: "result", result: "done" });
    tab.status = "idle"; tab.split = false;
    const before = tab.sessionId;
    await chat.send(tab, [{ t: "text", v: "Now a small fix" }], []);
    assert.notStrictEqual(tab.sessionId, before);
    assert.ok(!tab.splitTurns);
    assert.match(String(sent[1]), /earlier_conversation[\s\S]*Build both parts/);
  });

  // ---------- the page: media/split.js on a tiny DOM ----------
  class N {
    constructor(tag) { this.tag = tag; this.kids = []; this.cls = new Set(); this.on = {}; this.attrs = {}; this.value = ""; }
    get children() { return this.kids.filter((k) => k instanceof N); }
    get classList() { return { toggle: (c, on) => (on ? this.cls.add(c) : this.cls.delete(c)), contains: (c) => this.cls.has(c) }; }
    addEventListener(t, f) { this.on[t] = f; }
    append(...ks) { for (const k of ks) if (k !== null && k !== undefined) this.kids.push(k); }
    get text() { return this.kids.map((k) => k instanceof N ? k.text : String(k)).join(""); }
    find(f) { for (const k of this.children) { if (f(k)) return k; const x = k.find(f); if (x) return x; } return null; }
  }
  const el = (tag, props = {}, ...kids) => {
    const n = new N(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "class") n.cls = new Set(String(v).split(/\s+/).filter(Boolean));
      else if (k.startsWith("on")) n.on[k.slice(2)] = v; else n.attrs[k] = v;
    }
    n.append(...kids.flat());
    return n;
  };
  const page = (tab) => {
    const posted = [];
    const ui = makeSplit({ el, icon: (name) => el("i", { class: `codicon-${name}` }), post: (m) => posted.push(m), tab: () => tab,
      markdown: (t) => [t], claudeModels: () => [{ id: "opus", label: "Opus" }, { id: "sonnet", label: "Sonnet" }, { id: "haiku", label: "Haiku" }],
      clis: () => [{ id: "codex", models: [1, 2, 3, 4, 5].map((i) => ({ id: `m${i}`, label: `M${i}` })) }] });
    return { ui, posted };
  };
  const button = (node, label) => node.find((k) => k.tag === "button" && k.text === label);

  await check("the model menu: Split big tasks on and off; the agents' model, from the chat's AI; none for a model on this computer", () => {
    const tab = { id: "t", model: "opus", mode: "agent", split: true, workers: "haiku" };
    const { ui, posted } = page(tab);
    const items = ui.menuItems(tab).filter(Boolean);
    assert.match(items[1].text, /Split big tasks/);
    items[1].on.click(); assert.deepStrictEqual(posted.pop(), { type: "setSplit", tabId: "t", on: false });
    const seg = items[2].find((k) => k.cls.has("split-seg"));
    assert.deepStrictEqual(seg.children.map((b) => [b.text, b.cls.has("on")]), [["Opus", false], ["Sonnet", false], ["Haiku", true]]);
    seg.children[1].on.click(); assert.deepStrictEqual(posted.pop(), { type: "setWorkers", tabId: "t", model: "sonnet" });
    assert.ok(seg.children[1].cls.has("on") && !seg.children[2].cls.has("on"));
    // (More than four models: a list.)
    const codex = { ...tab, model: "codex:m1", workers: "codex:m3" };
    assert.strictEqual(page(codex).ui.menuItems(codex).filter(Boolean)[2].find((k) => k.tag === "select").value, "codex:m3");
    assert.deepStrictEqual(page(tab).ui.menuItems({ ...tab, model: "ollama:qwen3" }), []);
    assert.strictEqual(ui.menuItems({ ...tab, split: false }).filter(Boolean).length, 2);   // (off: no model row)
  });

  await check("the plan card: a row per agent with its files and model; Go ahead sends the models picked; Stop; a change", () => {
    const tab = { id: "t", model: "opus" };
    const { ui, posted } = page(tab);
    const block = { k: "split", pid: "p1", state: "pending", summary: "Split by module", models: [{ id: "opus", label: "Opus" }, { id: "haiku", label: "Haiku" }],
      tasks: [{ title: "API", files: ["src/api.js"], model: "haiku" }, { title: "Docs", files: [], model: "haiku" }] };
    const card = ui.card(block);
    assert.match(card.text, /Split the work between 2 agents\?/); assert.match(card.text, /src\/api\.js/);
    const rows = card.children.filter((k) => k.cls.has("split-row"));
    rows[0].find((k) => k.cls.has("split-seg")).children[0].on.click();   // agent 1 → Opus
    button(card, "Go ahead").on.click();
    assert.deepStrictEqual(posted.pop(), { type: "splitAnswer", tabId: "t", pid: "p1", go: true, models: ["opus", "haiku"] });
    // (Drawn again while it waits: your picks stay.)
    assert.ok(ui.card(block).children.filter((k) => k.cls.has("split-row"))[0].find((k) => k.cls.has("split-seg")).children[0].cls.has("on"));
    button(card, "Stop").on.click(); assert.deepStrictEqual(posted.pop(), { type: "splitAnswer", tabId: "t", pid: "p1", go: false });
    const input = card.find((k) => k.tag === "input");
    input.value = "keep docs with the API"; input.on.keydown({ key: "Enter", preventDefault() {}, stopPropagation() {} });
    assert.deepStrictEqual(posted.pop(), { type: "splitAnswer", tabId: "t", pid: "p1", change: "keep docs with the API" });
    const done = ui.card({ ...block, state: "approved", tasks: [{ ...block.tasks[0], model: "opus" }, block.tasks[1]] });
    assert.match(done.text, /2 agents at work/); assert.ok(!button(done, "Go ahead")); assert.match(done.text, /Opus[\s\S]*Haiku/);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `split-chat: ${failed} FAILED` : "split-chat: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
