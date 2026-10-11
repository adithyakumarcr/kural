// Usage thresholds with real routing/handoff methods, without any account requests.
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");
const values = {}, updates = [], config = { get: (k, d) => Object.hasOwn(values, k) ? values[k] : d,
  update: async (key, value, target) => { updates.push({ key, value, target }); values[key] = value; } };
const load = Module._load;
const vscode = { workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => config },
  ConfigurationTarget: { Global: 1 }, env: { appRoot: "/unused" }, commands: { executeCommand: () => {} }, Uri: { file: (fsPath) => ({ scheme: "file", fsPath }) } };
const proxy = new Proxy(vscode, { get: (o, k) => o[k] || new Proxy(function () {}, { get: () => () => {} }) });
Module._load = function (r, ...args) { return r === "vscode" ? proxy : load.call(this, r, ...args); };
const guard = require("../extension/lib/ai/usage-switch"), usage = require("../extension/lib/ai/usage");
const { select, limitUsed } = require("../extension/lib/router/policy");
const { ChatView } = require("../extension/lib/chat"), { Attachments } = require("../extension/lib/chat/attachments");
const brain = require("../extension/lib/ai");
const { SettingsPage } = require("../extension/lib/settings-page");
brain.providerOf = (m) => ({ ready: () => true, label: m, id: brain.engineOf(m) });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kural-usage-switch-"));
const opts = { enabled: true, threshold: 70 };
const models = [
  { id: "sonnet", providerId: "claude", provider: "Claude", ready: true, team: true, images: true, pdf: true, device: true, connectors: true, commands: true },
  { id: "codex:gpt-test", providerId: "codex", provider: "ChatGPT (Codex)", ready: true, team: true, images: true, pdf: true, device: true, commands: true },
  { id: "agy:gemini-pro", providerId: "agy", provider: "Google Gemini", ready: true, team: true, images: true, commands: false },
];
const rated = () => models.map((m) => ({ ...m, limitUsed: limitUsed(m, usage.current(m.providerId)) }));
const report = (id, used, reset = Date.now() + 3600000) => usage.report(id, { windows: [{ id: "five_hour", label: "Session", usedPercent: used, resetsAt: reset }] });
const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = async (name, fn) => {
  usage._reset(); for (const k of Object.keys(values)) delete values[k];
  try { await fn(); passed++; console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); }
};
function fixture() {
  const tab = { id: "chat", title: "Example", status: "idle", model: "sonnet", mode: "ask", effort: "medium", autoRoute: false,
    routingProfile: "balance", team: 0, messages: [], engine: "claude", started: true };
  const chat = Object.create(ChatView.prototype), sent = [], posted = []; let killed = 0, interrupted = 0;
  Object.assign(chat, { tabs: [tab], panes: [], routingJobs: new Map(), runtime: new Map(), localReady: new Map(), attachments: new Attachments(),
    post: (m) => posted.push(m), postTabs: () => {}, save: () => {}, remember: () => {}, isReady: () => true,
    teamSize: () => 0, teamLabel: () => null, endDevice: () => {}, finishTurn: () => {}, notify: () => {},
    buildPrompt: async (text) => "PROJECT INSTRUCTIONS\n" + text, prepareLocal: async () => ({ ok: true }), procKey: (t) => t.model,
    router: { options: () => ({ context: false, checkpoints: true, handoffChars: 120000 }), availableModels: async () => rated(),
      taskDone: () => {}, route: async () => assert.fail("Manual models must not use Auto routing") },
    startProc: (t) => {
      const r = { proc: { send: (s) => sent.push(s), kill: () => killed++, interrupt: () => interrupted++, opts: {} },
        procKey: t.model, agents: new Map(), perms: new Map(), tasks: new Map() };
      chat.runtime.set(t.id, r); return r;
    } });
  return { chat, tab, sent, posted, killed: () => killed, interrupted: () => interrupted };
}

(async () => {
  await check("switching is opt-in; the percentage is numeric and bounded", () => {
    const same = (n) => ({ claude: { session: n, weekly: n }, codex: { session: n, weekly: n }, agy: { session: n, weekly: n } });
    assert.deepStrictEqual(guard.options(config), { enabled: false, threshold: 70, limits: same(70) });
    values["usageSwitch.enabled"] = true;
    for (const [n, expected] of [[75, 75], [72.8, 73], [0, 1], [200, 99], [NaN, 70], ["80", 70]]) {
      values["usageSwitch.threshold"] = n;
      assert.deepStrictEqual(guard.options(config), { enabled: true, threshold: expected, limits: same(expected) });
    }
    // Each AI's own points; a missing or bad one is the old single number.
    values["usageSwitch.threshold"] = 70;
    values["usageSwitch.limits"] = { claude: { session: 85, weekly: 60.4 }, codex: { session: "x" }, agy: null };
    assert.deepStrictEqual(guard.options(config).limits, { claude: { session: 85, weekly: 60 }, codex: { session: 70, weekly: 70 }, agy: { session: 70, weekly: 70 } });
  });
  await check("at the threshold, pick a ready cloud service below it; disabled, unknown and full cases stay put", () => {
    const req = { current: "sonnet", prompt: "Explain the code", profile: "balance", mode: "ask" };
    report("claude", 69.9); assert.strictEqual(guard.choose(rated(), req, opts), null);
    report("claude", 70); report("codex", 15); report("agy", 20);
    assert.strictEqual(guard.choose(rated(), req, opts).model, "codex:gpt-test");
    assert.match(guard.choose(rated(), req, opts).reason, /switch at 70%/);
    assert.strictEqual(guard.choose(rated(), req, { ...opts, enabled: false }), null);
    report("codex", 70); report("agy", 90); assert.strictEqual(guard.choose(rated(), req, opts), null);
    usage._reset(); assert.strictEqual(guard.choose(rated(), req, opts), null);
    report("claude", 100); assert.ok(guard.choose(rated(), req, opts));
    const unavailable = rated().map((m) => ({ ...m, ready: m.providerId === "claude" }));
    assert.strictEqual(guard.choose(unavailable, req, opts), null);
  });
  await check("settings persist user-level values and reject invalid percentages", async () => {
    const page = new SettingsPage({}, {}, {}); page.push = () => {};
    updates.length = 0;
    await page.onMessage({ type: "usageSwitch", enabled: true, threshold: 83 });
    assert.deepStrictEqual(updates, [{ key: "usageSwitch.enabled", value: true, target: 1 }, { key: "usageSwitch.threshold", value: 83, target: 1 }]);
    for (const threshold of [0, 100, 42.5, "90", null, NaN]) await page.onMessage({ type: "usageSwitch", threshold });
    assert.strictEqual(updates.length, 2);
    await page.onMessage({ type: "usageSwitch", enabled: false }); assert.strictEqual(values["usageSwitch.enabled"], false);
  });
  await check("handoffs retain team, device, attachment and connector capability requirements", () => {
    report("claude", 71);
    const req = { current: "sonnet", prompt: "explain", mode: "ask", team: true, device: true, images: true, pdf: true };
    assert.strictEqual(guard.choose(rated(), req, opts).model, "codex:gpt-test");
    assert.strictEqual(guard.choose(rated(), { ...req, connectors: true }, opts), null);
    assert.strictEqual(guard.choose([...rated().slice(0, 1), { ...rated()[1], local: true }], req, opts), null);
  });
  await check("general and model-family limits count; expired windows stop applying", () => {
    const w = (id, usedPercent, label = id) => ({ id, usedPercent, label });
    const claude = { windows: [w("five_hour", 20), w("seven_day", 35), w("seven_day_opus", 85)] };
    assert.strictEqual(limitUsed({ id: "sonnet" }, claude), 35);
    assert.strictEqual(limitUsed({ id: "opus" }, claude), 85);
    const agy = { windows: [w("gemini", 30, "Gemini"), w("claude", 90, "Claude")] };
    assert.strictEqual(limitUsed({ id: "agy:gemini-pro" }, agy), 30);
    assert.strictEqual(limitUsed({ id: "agy:claude-sonnet" }, agy), 90);
    assert.strictEqual(limitUsed({ id: "agy:default" }, agy), 90);
    report("claude", 90, Date.now() - 1); assert.strictEqual(limitUsed(models[0], usage.current("claude")), 0);
    report("claude", 50); usage.markLimited("claude"); assert.strictEqual(limitUsed(models[0], usage.current("claude")), 100);
  });
  await check("Auto also observes the optional threshold", () => {
    report("claude", 75); report("codex", 20);
    const choice = select(rated(), { current: "sonnet", prompt: "Review the code", historyChars: 1000000 }, { profile: "balance", usageSwitch: opts });
    assert.strictEqual(choice.model, "codex:gpt-test"); assert.match(choice.reason, /below your usage switch points/);
  });
  await check("Session and Weekly have their own switch points, per AI", () => {
    const settings = { enabled: true, threshold: 70, limits: { claude: { session: 90, weekly: 50 }, codex: { session: 70, weekly: 70 }, agy: { session: 70, weekly: 70 } } };
    const req = { current: "sonnet", prompt: "Explain the code", profile: "balance", mode: "ask" };
    const parts = (session, weekly) => models.map((m) => ({ ...m, limitParts: m.providerId === "claude" ? { session, weekly } : { session: 5, weekly: 5 } }));
    assert.strictEqual(guard.choose(parts(85, 40), req, settings), null);                      // under both
    assert.match(guard.choose(parts(91, 40), req, settings).reason, /Session limit is 91% used \(you switch at 90%\)/);
    assert.match(guard.choose(parts(10, 55), req, settings).reason, /Weekly limit is 55% used \(you switch at 50%\)/);
    // The policy splits a report into the two.
    usage.report("claude", { windows: [{ id: "five_hour", label: "Session", usedPercent: 30 }, { id: "seven_day", label: "Week", usedPercent: 64 },
      { id: "seven_day_opus", label: "Week (Opus)", usedPercent: 99 }] });
    assert.deepStrictEqual(require("../extension/lib/router/policy").limitParts(models[0], usage.current("claude")), { session: 30, weekly: 64 });
    usage.report("agy", { windows: [{ id: "gemini", label: "Gemini", usedPercent: 12, period: "week" }] });
    assert.deepStrictEqual(require("../extension/lib/router/policy").limitParts(models[2], usage.current("agy")), { session: null, weekly: 12 });
  });
  await check("a manually chosen model transfers the same chat and complete visible task to the next service", async () => {
    values["usageSwitch.enabled"] = true; report("claude", 70); report("codex", 10);
    const f = fixture(); f.tab.messages = [
      { role: "user", segments: [{ t: "text", v: "Keep the API. Never deploy." }], sentText: "Keep the API. Never deploy. ORIGINAL SOURCE" },
      { role: "assistant", model: "sonnet", blocks: [{ k: "text", text: "The approved plan." }],
        journal: { tools: [{ id: "one", name: "Edit", status: "complete", result: "Edited login.js" }] } },
    ];
    f.chat.startProc(f.tab);
    await f.chat.send(f.tab, [{ t: "text", v: "Continue the plan" }], []);
    assert.strictEqual(f.tab.id, "chat"); assert.strictEqual(f.tab.model, "codex:gpt-test"); assert.strictEqual(f.killed(), 1);
    const text = typeof f.sent[0] === "string" ? f.sent[0] : f.sent[0][0].text;
    for (const s of ["Never deploy", "ORIGINAL SOURCE", "approved plan", "Edited login.js", "Continue the plan"]) assert.ok(text.includes(s), s);
  });
  await check("running commands, agents, approvals, queued messages and background work defer a transfer", async () => {
    values["usageSwitch.enabled"] = true; const f = fixture();
    await f.chat.send(f.tab, [{ t: "text", v: "Continue" }], []);
    report("claude", 70); const r = f.chat.runtime.get("chat");
    for (const [block, clear] of [
      [() => r.perms.set("p", () => {}), () => r.perms.clear()],
      [() => r.agents.set("a", { state: "running" }), () => r.agents.clear()],
      [() => r.turn.journal.tools.push({ id: "tool", status: "running" }), () => r.turn.journal.tools.pop()],
      [() => r.steers = [{}], () => r.steers = []],
    ]) { block(); await f.chat.usageCheckpoint(f.tab, r); assert.strictEqual(f.interrupted(), 0); clear(); }
    f.tab.status = "idle"; r.bg = new Set(["server"]); await f.chat.switchUsage(f.tab); assert.strictEqual(f.tab.model, "sonnet");
    f.tab.status = "running"; r.bg.clear(); await f.chat.usageCheckpoint(f.tab, r);
    assert.strictEqual(f.interrupted(), 1); assert.strictEqual(r.usageHandoff.model, "codex:gpt-test");
  });
  await check("sending while a usage check is pending waits for the chosen service", async () => {
    values["usageSwitch.enabled"] = true; report("claude", 70); const f = fixture(); let release;
    f.chat.router.availableModels = () => new Promise((resolve) => release = resolve);
    const move = f.chat.switchUsage(f.tab), send = f.chat.send(f.tab, [{ t: "text", v: "Continue" }], []);
    assert.strictEqual(f.sent.length, 0); release(rated()); await Promise.all([move, send]);
    assert.strictEqual(f.tab.model, "codex:gpt-test"); assert.strictEqual(f.sent.length, 1);
  });
  await check("Auto defers leaving a service with a live background command", async () => {
    values["usageSwitch.enabled"] = true; report("claude", 75); const f = fixture(); f.tab.autoRoute = true;
    const r = f.chat.startProc(f.tab); r.bg = new Set(["server"]);
    f.chat.router.route = async (req) => { assert.strictEqual(req.provider, "claude"); return { model: "sonnet", reason: "Background work still running" }; };
    await f.chat.send(f.tab, [{ t: "text", v: "Check the page" }], []);
    assert.strictEqual(f.tab.model, "sonnet"); assert.strictEqual(f.killed(), 0);
    f.tab.status = "idle"; r.bg.clear(); await f.chat.switchUsage(f.tab); assert.strictEqual(f.tab.model, "codex:gpt-test");
  });
  await check("completed agents' visible work and board reports survive a provider handoff", () => {
    const journal = require("../extension/lib/router/journal");
    const record = journal.handoff([{ role: "assistant", model: "sonnet", blocks: [
      { k: "agent", name: "Monica", role: "Developer", state: "done", steps: [{ k: "say", text: "Keep the API" }, { k: "tool", name: "Read", detail: "login.js" }] },
      { k: "tool", name: "mcp__team__post", agent: "Monica", detail: "Monica → everyone: Finished the login change" },
    ] }]);
    for (const s of ["Monica", "Keep the API", "login.js", "Finished the login change"]) assert.ok(record.includes(s), s);
  });
  await check("managed teams expose Finish now and finish without Claude's lead-restart delay", async () => {
    const f = fixture(); await f.chat.send(f.tab, [{ t: "text", v: "Discuss" }], []);
    const r = f.chat.runtime.get("chat"); let finishes = 0; r.proc.finishTeam = () => finishes++;
    const card = { id: "member", name: "Monica", state: "running", steps: [], n: 1 }; r.agents.set(card.id, card); r.turn.reply.blocks.push(card);
    f.chat.onClaude(f.tab, r, { type: "system", subtype: "task_started", tool_use_id: card.id, task_id: "task" });
    assert.deepStrictEqual(r.turn.reply.waitingFor, ["Monica"]);
    f.chat.finishTeam(f.tab); assert.strictEqual(finishes, 1);
    f.chat.onClaude(f.tab, r, { type: "system", subtype: "task_notification", tool_use_id: card.id, task_id: "task", status: "completed" });
    assert.deepStrictEqual(r.turn.reply.waitingFor, []);
    f.chat.onClaude(f.tab, r, { type: "result", kural_team_complete: true, is_error: false, subtype: "success", result: "The team's result." });
    assert.strictEqual(f.tab.status, "idle"); assert.strictEqual(r.turn.reply.running, false);
  });
  await check("Auto cannot return a long chat to the service that reached the user's threshold", async () => {
    values["usageSwitch.enabled"] = true; report("claude", 70); const f = fixture(); f.tab.autoRoute = true;
    f.tab.messages = [{ role: "user", segments: [{ t: "text", v: "Never deploy. " + "source ".repeat(30000) }] },
      { role: "assistant", blocks: [{ k: "text", text: "Approved plan. " + "detail ".repeat(20000) }] }];
    f.chat.router.route = async (req) => { assert.ok(!req.provider, "must not reroute within the old service"); return { model: "codex:gpt-test", reason: "Continued with ChatGPT" }; };
    await f.chat.send(f.tab, [{ t: "text", v: "Continue" }], []);
    assert.strictEqual(f.tab.model, "codex:gpt-test"); assert.strictEqual(f.tab.engine, "codex");
    const text = typeof f.sent[0] === "string" ? f.sent[0] : f.sent[0][0].text;
    assert.match(text, /compacted/); assert.match(text, /Never deploy/);
  });
  await check("a threshold pause continues the latest request and completed work, without a second user message", async () => {
    values["usageSwitch.enabled"] = true; const f = fixture();
    await f.chat.send(f.tab, [{ t: "text", v: "Refactor login, never deploy" }], []);
    const r = f.chat.runtime.get("chat"), reply = r.turn.reply;
    reply.blocks.push({ k: "text", text: "First change completed." });
    reply.journal.tools.push({ id: "edit", name: "Edit", status: "complete", result: "Edited login.js" });
    report("claude", 70); await f.chat.usageCheckpoint(f.tab, r);
    f.chat.finishReply(f.tab, r, { subtype: "error_during_execution", is_error: true }); await pause();
    assert.strictEqual(f.tab.model, "codex:gpt-test"); assert.strictEqual(f.tab.messages.filter((m) => m.role === "user").length, 1);
    assert.match(reply.note, /switch at 70%/); assert.strictEqual(reply.error, undefined);
    const text = typeof f.sent.at(-1) === "string" ? f.sent.at(-1) : f.sent.at(-1)[0].text;
    for (const s of ["never deploy", "First change completed", "Edited login.js", "paused at the user's usage threshold"]) assert.ok(text.includes(s), s);
  });
  await check("Stop and disabling switching prevent an automatic continuation; the next turn can switch again", async () => {
    values["usageSwitch.enabled"] = true; const f = fixture();
    await f.chat.send(f.tab, [{ t: "text", v: "Continue" }], []);
    report("claude", 75); const r = f.chat.runtime.get("chat"); await f.chat.usageCheckpoint(f.tab, r);
    const choice = r.usageHandoff;
    r.userStopped = true; f.tab.status = "idle";
    assert.strictEqual(await f.chat.retryElsewhere(f.tab, r.turn.reply, choice), false);
    r.userStopped = false; values["usageSwitch.enabled"] = false;
    assert.strictEqual(await f.chat.retryElsewhere(f.tab, r.turn.reply, choice), false);
    r.userStopped = true; f.chat.beginTurn(f.tab, r, f.chat.newReply(f.tab), "Again", []);
    assert.strictEqual(r.userStopped, false); assert.strictEqual(r.usageHandoff, undefined);
  });
  await pause(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(`usage-switch: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
