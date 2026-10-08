// System notifications (lib/chat/notify.js and the chat): when they go out, what they say, how they're shown (Kural's
// _kural.osToast, else the OS's own way, else inside the window), and the chat's moments: done, needs your OK, a
// question, an error; not after Stop; cleared when you answer.
const assert = require("assert");
const Module = require("module");
const load = Module._load;
const conf = { notifications: undefined };
const vscode = { workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => ({ get: (k, d) => conf[k] === undefined ? d : conf[k] }) },
  window: { state: { focused: false } }, env: { appRoot: "/unused" }, commands: { executeCommand: () => {} },
  Uri: { file: (f) => ({ scheme: "file", fsPath: f }) }, EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const { shouldNotify, plainLine, message, fallbackCommand, Notifier } = require("../extension/lib/chat/notify");
const { ChatView } = require("../extension/lib/chat");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const tick = () => new Promise((r) => setTimeout(r, 10));

(async () => {
  await check("when: by default only while you're not looking (window in the back, or the chat not on screen)", () => {
    for (const s of [undefined, "whenAway", "nonsense"]) {
      assert.strictEqual(shouldNotify(s, { focused: true, onScreen: true }), false);
      assert.strictEqual(shouldNotify(s, { focused: false, onScreen: true }), true);
      assert.strictEqual(shouldNotify(s, { focused: true, onScreen: false }), true);
    }
    assert.strictEqual(shouldNotify("always", { focused: true, onScreen: true }), true);
    assert.strictEqual(shouldNotify("off", { focused: false, onScreen: false }), false);
  });
  await check("what it says: short, naming the chat; the answer's first sentence, without Markdown", () => {
    assert.deepStrictEqual(message("done", { chat: "Fix the login", text: "**Fixed it.** The `token` check in [auth.js](src/auth.js) was wrong.\n\n```js\ncode\n```" }),
      { title: "Fix the login is done", body: "Fixed it. The token check in auth.js was wrong." });
    assert.deepStrictEqual(message("done", { chat: "Fix the login", text: "" }), { title: "Fix the login is done", body: "The answer is ready." });
    assert.deepStrictEqual(message("permission", { chat: "Deploy", tool: "Bash", detail: "npm run deploy" }), { title: "Deploy needs your OK", body: "Run this command? npm run deploy" });
    assert.strictEqual(message("permission", { chat: "Pi", tool: "DeviceCommand", detail: "sudo reboot", where: "rpi-lab" }).body, "Run this on rpi-lab? sudo reboot");
    assert.strictEqual(message("permission", { chat: "x", tool: "Write", detail: "/Users/me/.zshrc\n(outside this project)" }).body, "Change this file? /Users/me/.zshrc");
    assert.deepStrictEqual(message("question", { chat: "Plan it", question: "Which database?" }), { title: "Plan it has a question", body: "Which database?" });
    assert.strictEqual(message("plan", { chat: "New page" }).title, "New page: the plan is ready");
    assert.strictEqual(message("error", { chat: "x", error: "Credit balance is too low" }).body, "Credit balance is too low");
    assert.strictEqual(message("login", { chat: "x", who: "Claude" }).title, "x: Claude isn't logged in");
    assert.ok(plainLine("a ".repeat(200)).length <= 140);
  });
  await check("the OS's own way: text passed as arguments or variables, never into a script", () => {
    const [mac, macArgs] = fallbackCommand("darwin", 'Kural: "Fix" is done', 'say "hi" \\ bye');
    assert.strictEqual(mac, "/usr/bin/osascript");
    assert.strictEqual(macArgs[1], 'display notification "say \\"hi\\" \\\\ bye" with title "Kural: \\"Fix\\" is done"');
    const [win, winArgs, env] = fallbackCommand("win32", "Kural: T", "B'; Remove-Item x");
    assert.strictEqual(win, "powershell.exe"); assert.ok(!winArgs.join(" ").includes("Remove-Item")); assert.deepStrictEqual(env, { KURAL_TOAST_TITLE: "Kural: T", KURAL_TOAST_BODY: "B'; Remove-Item x" });
    assert.deepStrictEqual(fallbackCommand("linux", "T", "-B"), ["notify-send", ["-a", "Kural", "--", "T", "-B"], {}]);
    assert.strictEqual(fallbackCommand("aix", "T", "B"), null);
  });
  await check("how: Kural's own system notification when the build has it; a click runs onClick; cleared on request", async () => {
    const calls = [];
    const n = new Notifier({ hasToast: async () => true, toast: async (o) => { calls.push(["toast", o]); return { clicked: true, supported: true }; },
      clearToast: async (id) => calls.push(["clear", id]), run: async () => assert.fail("no fallback"), inApp: async () => assert.fail("no fallback"), log: () => {}, platform: "darwin" });
    let clicked = 0;
    await n.show({ id: "kural-chat-a", title: "A is done", body: "Fixed.", attention: false }, () => clicked++);
    await tick();
    assert.deepStrictEqual(calls[0], ["toast", { id: "kural-chat-a", title: "A is done", body: "Fixed.", attention: false }]);
    assert.strictEqual(clicked, 1);
    n.clear("kural-chat-a"); await tick();
    assert.deepStrictEqual(calls[1], ["clear", "kural-chat-a"]);
  });
  await check("no system notifications here (supported: false) or the command failed: the OS's own way", async () => {
    for (const toast of [async () => ({ clicked: false, supported: false }), async () => { throw new Error("boom"); }]) {
      const ran = [];
      const n = new Notifier({ hasToast: async () => true, toast, clearToast: async () => {}, run: async (c, a) => { ran.push(c); return true; }, inApp: async () => assert.fail("no in-app"), log: () => {}, platform: "linux" });
      await n.show({ id: "x", title: "T", body: "B" }); await tick();
      assert.deepStrictEqual(ran, ["notify-send"]);
    }
  });
  await check("an older build (no _kural.osToast): the OS's own way; that failing too: inside the window, Show = onClick", async () => {
    const inApp = [];
    const n = new Notifier({ hasToast: async () => false, toast: async () => assert.fail("not there"), clearToast: async () => assert.fail("not there"),
      run: async () => false, inApp: async (t, b) => { inApp.push([t, b]); return true; }, log: () => {}, platform: "linux" });
    let clicked = 0;
    await n.show({ id: "x", title: "T is done", body: "B" }, () => clicked++); await tick();
    assert.deepStrictEqual(inApp, [["Kural: T is done", "B"]]); assert.strictEqual(clicked, 1);
    n.clear("x");   // (nothing to clear: no assert.fail)
  });

  // The chat: which moments notify.
  const shown = [], cleared = [];
  const chat = Object.create(ChatView.prototype);
  Object.assign(chat, { tabs: [], panes: [], runtime: new Map(), post: () => {}, postTabs: () => {}, save: () => {}, warm: () => {},
    notifier: { show: (o) => shown.push(o), clear: (id) => cleared.push(id) }, router: null, activity: null, changes: { summary: () => [] }, procKey: () => "k" });
  const tab = { id: "t1", title: "Fix the login", model: "sonnet", mode: "agent", status: "running", messages: [] };
  const turn = (extra = {}) => { const reply = { role: "assistant", blocks: [{ k: "text", text: "Fixed it. Details follow." }], running: true, t0: Date.now(), mode: "agent", models: ["sonnet"], ...extra };
    tab.messages.push({ role: "user", segments: [] }, reply); return { turn: { reply, snaps: {}, ask: "fix", journal: { tools: [] } }, perms: new Map(), agents: new Map(), tasks: new Map(), steers: [] }; };
  await check("an answer done while you're away: one notification; after Stop: none; while you look (whenAway): none", () => {
    vscode.window.state.focused = false;
    let r = turn(); chat.finishReply(tab, r, { type: "result", subtype: "success", is_error: false });
    assert.strictEqual(shown.length, 1); assert.deepStrictEqual([shown[0].id, shown[0].title, shown[0].body, shown[0].attention], ["kural-chat-t1", "Fix the login is done", "Fixed it. Details follow.", false]);
    chat.finishReply(tab, r, { type: "result", subtype: "success" });   // (the same answer closing again: no second one)
    assert.strictEqual(shown.length, 1);
    r = turn(); chat.finishReply(tab, r, { type: "result", subtype: "error_during_execution", is_error: true });   // Stop
    assert.strictEqual(shown.length, 1);
    vscode.window.state.focused = true; chat.panes = [{ activeId: "t1", view: { visible: true } }];
    r = turn(); chat.finishReply(tab, r, { type: "result", subtype: "success" });
    assert.strictEqual(shown.length, 1);
    conf.notifications = "always";
    r = turn(); chat.finishReply(tab, r, { type: "result", subtype: "success" });
    assert.strictEqual(shown.length, 2);
    conf.notifications = "off"; vscode.window.state.focused = false;
    r = turn(); chat.finishReply(tab, r, { type: "result", subtype: "success" });
    assert.strictEqual(shown.length, 2);
    conf.notifications = undefined; chat.panes = [];
  });
  await check("a plan ready, an error, a login: each says so (and asks for attention when it needs you)", () => {
    shown.length = 0;
    let r = turn({ mode: "plan" }); chat.finishReply(tab, r, { type: "result", subtype: "success" });
    r = turn(); chat.finishReply(tab, r, { type: "result", subtype: "success", is_error: true, result: "Credit balance is too low" });
    r = turn(); chat.finishReply(tab, r, { type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" });
    assert.deepStrictEqual(shown.map((s) => s.title), ["Fix the login: the plan is ready", "Fix the login stopped with an error", "Fix the login: Claude isn't logged in"]);
    assert.deepStrictEqual(shown.map((s) => s.attention), [false, false, true]);
  });
  await check("a command waiting for your OK: a notification, taken away once you answer", async () => {
    shown.length = 0; cleared.length = 0;
    const r = turn(); tab.status = "running";
    const asked = chat.onPermission(tab, r, { tool_name: "Bash", input: { command: "npm test" } });
    await tick();
    assert.deepStrictEqual([shown.length, shown[0].title, shown[0].body, shown[0].attention], [1, "Fix the login needs your OK", "Run this command? npm test", true]);
    const [resolve] = [...r.perms.values()]; resolve(true);
    assert.deepStrictEqual(await asked, { allow: true });
    assert.deepStrictEqual(cleared, ["kural-chat-t1"]);
  });
  await check("a question for you: a notification with the question", async () => {
    shown.length = 0;
    const r = turn();
    const asked = chat.askUser(tab, r, { input: { questions: [{ question: "Which database?", options: [{ label: "Postgres" }] }] } });
    await tick();
    assert.deepStrictEqual([shown[0].title, shown[0].body], ["Fix the login has a question", "Which database?"]);
    [...r.perms.values()][0]({ "Which database?": "Postgres" });
    await asked;
  });

  console.log(failed ? `notify: ${failed} FAILED` : "notify: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
