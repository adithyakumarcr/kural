// The chat's side of Kural's browser (lib/chat/index.js approveBrowser, browserOn, and the cards): once per site in a
// chat (Agent; reading in Ask and Plan), Submit and the like each time, uploads from outside the project each time, Auto
// asks nothing, and a refusal shows. The real chat code with a stand-in vscode (like test/audit-f1.test.js).
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const Module = require("module");
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kural-browser-chat-")));
const project = path.join(tmp, "project"); fs.mkdirSync(project);
let aiControl = undefined;
const vs = { workspace: { isTrusted: true, workspaceFolders: [{ name: "p", uri: { scheme: "file", fsPath: project } }], textDocuments: [],
  getConfiguration: () => ({ get: (k, d) => k === "browser.aiControl" ? aiControl : d, inspect: () => undefined }) }, window: { showWarningMessage: () => {} },
  env: { appRoot: "/unused" }, Uri: { file: (f) => ({ fsPath: f }) }, EventEmitter: class {} };
const load = Module._load; Module._load = function (n, ...a) { return n === "vscode" ? vs : load.call(this, n, ...a); };
const { ChatView } = require("../extension/lib/chat");
const { grantKey } = require("../extension/lib/chat/permission-policy");
const { message } = require("../extension/lib/chat/notify");

const posted = [];
const chat = Object.create(ChatView.prototype);
Object.assign(chat, { runtime: new Map(), root: () => project, projectRoots: () => [project], changes: { snapshot: () => {} }, postTabs: () => {},
  post: (m) => posted.push(m), save: () => {}, notify: () => {}, clearNotice: () => {}, handoffDir: () => path.join(tmp, "handoffs-none"), handoffBudget: () => 100000 });
const runtime = () => ({ turn: { snaps: {}, reply: { blocks: [], running: true } }, perms: new Map(), agents: new Map(), tasks: new Map() });

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
// One request: → { verdict: "allow" | "deny" | "card", card, message }. A card is answered with `answer` (default: no).
async function ask(tab, req, answer = false, always = false) {
  const r = runtime();
  chat.tabs = [tab]; chat.runtime.set(tab.id, r);
  const p = chat.approveBrowser(tab, r, req);
  const first = await Promise.race([p, new Promise((ok) => setTimeout(() => ok("card"), 40))]);
  if (first !== "card") return { verdict: first.allow ? "allow" : "deny", message: first.message };
  const card = r.turn.reply.blocks.find((b) => b.k === "perm" && b.state === "pending");
  await chat.handle({ type: "permission", tabId: tab.id, pid: card.pid, allow: answer, always });
  const res = await p;
  return { verdict: "card", card, allowed: !!res.allow, message: res.message };
}
const site = (s, readOnly = false) => ({ kind: "site", site: s, url: `https://${s}/`, tool: readOnly ? "snapshot" : "click", readOnly });

(async () => {
  await check("Agent: a site asks once in a chat, then it's known; another site asks again", async () => {
    const tab = { id: "a", model: "sonnet", mode: "agent", sessionId: "s1" };
    const r = await ask(tab, site("instagram.com"), true);
    assert.strictEqual(r.verdict, "card");
    assert.ok(r.allowed);
    assert.strictEqual(r.card.tool, "BrowserSite");
    assert.strictEqual(r.card.site, "instagram.com");
    assert.strictEqual(r.card.allowLabel, "Allow all browser actions in this chat");
    assert.ok(/Kural never lets it publish, post, share or send anything/.test(r.card.detail), r.card.detail);
    assert.strictEqual((await ask(tab, site("instagram.com"))).verdict, "allow");
    assert.strictEqual((await ask(tab, site("instagram.com", true))).verdict, "allow");
    assert.strictEqual((await ask(tab, site("bank.example"))).verdict, "card");
    // (A no is remembered as nothing: it asks again next time.)
    assert.strictEqual((await ask(tab, site("bank.example"))).verdict, "card");
  });
  await check("a mode or model change (or a new conversation) asks about the site again", async () => {
    const tab = { id: "b", model: "sonnet", mode: "agent", sessionId: "s1" };
    await ask(tab, site("instagram.com"), true);
    assert.strictEqual((await ask({ ...tab, model: "opus" }, site("instagram.com"))).verdict, "card");
    assert.strictEqual((await ask({ ...tab, sessionId: "s2" }, site("instagram.com"))).verdict, "card");
  });
  await check("Ask and Plan only read: actions refused, reading asks (the card says reading)", async () => {
    for (const mode of ["ask", "plan"]) {
      const tab = { id: `c-${mode}`, model: "sonnet", mode, sessionId: "s1" };
      const no = await ask(tab, site("instagram.com"));
      assert.strictEqual(no.verdict, "deny");
      assert.ok(/only reads pages/.test(no.message), no.message);
      const read = await ask(tab, site("instagram.com", true), true);
      assert.strictEqual(read.verdict, "card");
      assert.strictEqual(read.card.reads, true);
      for (const req of [{ kind: "commit", site: "x.example", label: "Submit" }, { kind: "upload", site: "x.example", files: [path.join(project, "a.mp4")] }])
        assert.strictEqual((await ask(tab, req)).verdict, "deny", `${mode}: ${req.kind}`);
    }
  });
  await check("Auto: no cards (but publishing still never happens: that isn't asked)", async () => {
    const tab = { id: "d", model: "codex:default", mode: "auto", sessionId: "s1" };
    assert.strictEqual((await ask(tab, site("instagram.com"))).verdict, "allow");
    assert.strictEqual((await ask(tab, { kind: "commit", site: "shop.example", label: "Place order" })).verdict, "allow");
    assert.strictEqual((await ask(tab, { kind: "upload", site: "instagram.com", files: ["/etc/hosts"] })).verdict, "allow");
  });
  await check("Submit and the like: a card each time, until Allow all browser actions", async () => {
    const tab = { id: "e", model: "sonnet", mode: "agent", sessionId: "s1" };
    const c = await ask(tab, { kind: "commit", site: "forms.example", label: "Submit" }, true);
    assert.strictEqual(c.card.tool, "BrowserAction");
    assert.strictEqual(c.card.label, "Submit");
    assert.strictEqual((await ask(tab, { kind: "commit", site: "forms.example", label: "Submit" })).verdict, "card");
    await ask(tab, { kind: "commit", site: "forms.example", label: "Submit" }, true, true);   // ("Allow all browser actions in this chat")
    assert.deepStrictEqual(tab.allowAll, ["browser"]);
    assert.strictEqual(tab.allowAllFor, grantKey(tab));
    assert.strictEqual((await ask(tab, { kind: "commit", site: "forms.example", label: "Pay now" })).verdict, "allow");
    assert.strictEqual((await ask(tab, site("another.example"))).verdict, "allow");
    // …never an upload from outside the project.
    assert.strictEqual((await ask(tab, { kind: "upload", site: "instagram.com", files: ["/etc/hosts"] })).verdict, "card");
  });
  await check("uploads: the project's files go, others ask (with no Allow all)", async () => {
    const tab = { id: "f", model: "sonnet", mode: "agent", sessionId: "s1" };
    const mine = path.join(project, "videos", "run.mp4");
    assert.strictEqual((await ask(tab, { kind: "upload", site: "instagram.com", files: [mine] })).verdict, "allow");
    const other = await ask(tab, { kind: "upload", site: "instagram.com", files: [mine, path.join(os.homedir(), "Movies", "x.mp4")] });
    assert.strictEqual(other.verdict, "card");
    assert.strictEqual(other.card.tool, "BrowserUpload");
    assert.strictEqual(other.card.allowLabel, undefined);
    assert.ok(/x\.mp4\n\(from outside this project\) → instagram\.com/.test(other.card.detail), other.card.detail);
  });
  await check("a refusal shows in the chat; a stopped answer gets nothing", async () => {
    const tab = { id: "g", model: "sonnet", mode: "auto", sessionId: "s1" };
    posted.length = 0;
    assert.strictEqual((await ask(tab, { kind: "refused", site: "instagram.com", label: "Share" })).verdict, "deny");
    assert.ok(posted.some((m) => m.type === "flash" && /stopped the AI before "Share" on instagram\.com/.test(m.text)), JSON.stringify(posted));
    const r = runtime(); r.turn.reply.running = false;
    const v = await chat.approveBrowser(tab, r, site("instagram.com"));
    assert.ok(!v.allow && /stopped/.test(v.message));
  });
  await check("who gets the browser: Claude and Codex, with the setting on and the API there", async () => {
    assert.strictEqual(chat.browserOn({ model: "sonnet" }), false, "no browser API here");
    chat.browserAi = { available: () => true };
    assert.strictEqual(chat.browserOn({ model: "sonnet" }), true);
    assert.strictEqual(chat.browserOn({ model: "codex:default" }), true);
    assert.strictEqual(chat.browserOn({ model: "agy:gemini-3.8-flash" }), false);
    assert.strictEqual(chat.browserOn({ model: "ollama:qwen3:8b" }), false);
    aiControl = false;
    assert.strictEqual(chat.browserOn({ model: "sonnet" }), false, "kural.browser.aiControl off");
    aiControl = undefined;
    chat.browserAi = { available: () => false };
    assert.strictEqual(chat.browserOn({ model: "sonnet" }), false);
    delete chat.browserAi;
  });
  await check("the steps and the notification say it in words", async () => {
    const { _test } = require("../extension/lib/chat");
    assert.strictEqual(_test.toolDetail("mcp__kural_browser__click", { element: "the Next button", ref: "e5" }), "the Next button");
    assert.strictEqual(_test.toolDetail("mcp__kural_browser__type", { ref: "e7", text: "Morning run" }), "\"Morning run\" in e7");
    assert.strictEqual(_test.toolDetail("mcp__kural_browser__upload", { files: ["/a/b/run.mp4"] }), "run.mp4");
    assert.strictEqual(_test.toolDetail("mcp__kural_browser__navigate", { back: true }), "back");
    assert.deepStrictEqual(message("permission", { chat: "Reel", tool: "BrowserSite", site: "instagram.com" }), { title: "Reel needs your OK", body: "Let the AI use instagram.com in Kural's browser?" });
    assert.strictEqual(message("permission", { chat: "Quiz", tool: "BrowserAction", site: "forms.example", label: "Submit" }).body, "Click \"Submit\" on forms.example?");
    assert.ok(/^Upload this file to instagram\.com\? /.test(message("permission", { chat: "x", tool: "BrowserUpload", site: "instagram.com", detail: "/x.mp4" }).body));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed} failed` : "\nAll passed.");
  process.exit(failed ? 1 : 0);
})();
