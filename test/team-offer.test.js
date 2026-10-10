// Auto mode, a big task: Kural offers more agents above the box; no answer within the wait = one agent
// (lib/chat/index.js offerTeam). The wait is shortened for the test.
process.env.KURAL_TEAM_OFFER_SECONDS = "0.2";
const assert = require("assert"), Module = require("module");
const load = Module._load;
const vscode = { workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => ({ get: (k, d) => d }) },
  ConfigurationTarget: { Global: 1 }, env: { appRoot: "/unused" }, commands: { executeCommand: () => {} }, Uri: { file: (fsPath) => ({ scheme: "file", fsPath }) } };
const proxy = new Proxy(vscode, { get: (o, k) => o[k] || new Proxy(function () {}, { get: () => () => {} }) });
Module._load = function (r, ...args) { return r === "vscode" ? proxy : load.call(this, r, ...args); };
const { ChatView } = require("../extension/lib/chat");
const brain = require("../extension/lib/ai");
brain.providerOf = () => ({ ready: () => true });
const BIG = "Build a full user authentication system with login, signup, password reset, email verification, and an admin dashboard, plus tests";
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
function chat(tab) {
  const c = Object.create(ChatView.prototype), posted = [];
  Object.assign(c, { tabs: [tab], routingJobs: new Map(), teamOffers: new Map(), post: (m) => posted.push(m), postTabs: () => {},
    remember: () => {}, save: () => {}, warm: () => {} });
  return { c, posted };
}
const tabOf = (o = {}) => ({ id: "t", mode: "auto", team: 0, model: "sonnet", status: "idle", messages: [], ...o });

(async () => {
  await check("not offered: another mode, a small task, a question, a team already, your own model", async () => {
    for (const [tab, text] of [[tabOf({ mode: "agent" }), BIG], [tabOf(), "fix the typo in the readme"], [tabOf({ team: 3 }), BIG],
      [tabOf({ model: "ollama:qwen3" }), BIG], [tabOf({ noTeamOffer: true }), BIG]]) {
      const { c, posted } = chat(tab);
      assert.strictEqual(await c.offerTeam(tab, text), null); assert.strictEqual(posted.length, 0);
    }
  });
  await check("no answer: one agent, and the chat is idle again to send", async () => {
    const tab = tabOf(), { c, posted } = chat(tab);
    const t0 = Date.now();
    assert.strictEqual(await c.offerTeam(tab, BIG), "one");
    assert.ok(Date.now() - t0 >= 180);
    assert.deepStrictEqual(posted.map((m) => m.type), ["teamOffer", "teamOfferDone"]);
    assert.strictEqual(posted[0].agents, 3);
    assert.strictEqual(tab.team, 0); assert.strictEqual(tab.status, "idle"); assert.strictEqual(tab.noTeamOffer, undefined);
  });
  await check("yes: the team turns on; \"One agent\": not offered again in this chat", async () => {
    let tab = tabOf(), { c, posted } = chat(tab);
    let p = c.offerTeam(tab, BIG); await new Promise((r) => setTimeout(r, 20));
    c.tab = (id) => c.tabs.find((x) => x.id === id);
    await c.handle({ type: "teamOfferAnswer", tabId: "t", id: posted[0].id, use: true }, null);   // (what the page sends)
    assert.strictEqual(await p, "team"); assert.strictEqual(tab.team, 3);
    ({ c, posted } = chat(tab = tabOf()));
    p = c.offerTeam(tab, BIG); await new Promise((r) => setTimeout(r, 20));
    c.teamOffers.get(posted[0].id)("one");
    assert.strictEqual(await p, "one"); assert.strictEqual(tab.noTeamOffer, true);
  });
  await check("Stop while it waits: nothing is sent", async () => {
    const tab = tabOf(), { c } = chat(tab);
    const p = c.offerTeam(tab, BIG); await new Promise((r) => setTimeout(r, 20));
    c.routingJobs.get("t").abort();
    assert.strictEqual(await p, "stopped");
  });
  console.log(failed ? `team-offer: ${failed} FAILED` : "team-offer: ALL PASS");
  process.exitCode = failed ? 1 : 0;
})();
