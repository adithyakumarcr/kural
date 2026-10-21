// The thinking timeline (media/timeline.js) on a small DOM: its header and tag, thoughts and steps, following the newest
// line until you scroll up (then Latest), folding, and a long raw thought that only changes its own text. Plus the
// backend marking thinking that came raw (lib/chat onClaude).
const assert = require("assert");
const Module = require("module");
const load = Module._load;
const vscode = { workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => ({ get: (k, d) => d }) },
  window: { state: { focused: true } }, env: { appRoot: "/unused" }, commands: { executeCommand: () => {} },
  Uri: { file: (f) => ({ scheme: "file", fsPath: f }) }, EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const { el, text, all } = require("./fake-dom");
const T = require("../extension/media/timeline.js")({ el, icon: (n) => el("i", { class: `codicon codicon-${n}` }) });

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const thought = (t, raw = false, now = false) => ({ kind: "thought", text: t, raw, now });
const live = (items) => T.node({ label: "Working… 3 s", tag: "Claude's summary", live: true, open: true, items, onToggle: () => {} });

check("a live timeline: header, tag, items", () => {
  const n = live([thought("**Finding it**\nLooking."), { kind: "step", node: el("span", {}, "Read a.js"), now: true }]);
  assert.ok(n.classList.contains("thv"));
  assert.ok(n.querySelector(".th-head.live"));
  assert.strictEqual(text(n.querySelector(".lab")), "Working… 3 s");
  assert.strictEqual(text(n.querySelector(".src")), "Claude's summary");
  const lis = n.querySelectorAll("li");
  assert.deepStrictEqual(lis.map((li) => li.classList.contains("th") ? "th" : li.classList.contains("act") ? "act" : "?"), ["th", "act"]);
  assert.strictEqual(text(n.querySelector(".tx b")), "Finding it");
  assert.ok(lis[1].classList.contains("now"));
  // A summary's "**Title**\n\nText": the title, then its text on the next line (no empty line between them).
  assert.strictEqual(text(live([thought("**Comparing**\n\nThe user asks why.")]).querySelector(".tx")), "Comparing\nThe user asks why.");
  // Raw thinking is shown as written: no bold made from its stars.
  const raw = live([thought("**not bold** here", true)]);
  assert.strictEqual(all(raw, "b").length, 0);
  assert.strictEqual(text(raw.querySelector(".tx")), "**not bold** here");
});

check("it follows the newest line until you scroll up", () => {
  const n = live([thought("a")]);
  const box = n.querySelector(".tbox"), latest = n.querySelector(".latest");
  box.scrollHeight = 900; box.clientHeight = 300;
  T.patchThought(n, "a longer thought");
  assert.strictEqual(box.scrollTop, 900);
  assert.ok(latest.classList.contains("hidden"));
  box.scrollTop = 100; box.dispatch("scroll");
  assert.ok(!latest.classList.contains("hidden"), "Latest shows once you scroll up");
  box.scrollHeight = 1200; T.patchThought(n, "a longer thought, still growing");
  assert.strictEqual(box.scrollTop, 100, "it leaves your place alone");
  latest.click();
  assert.strictEqual(box.scrollTop, 1200);
  assert.ok(latest.classList.contains("hidden"));
});

check("folded shows only the header", () => {
  const got = [];
  const n = T.node({ label: "Worked for 9 s · 2 thoughts", tag: null, live: false, open: false, items: [thought("x")], onToggle: (o) => got.push(o) });
  assert.ok(n.classList.contains("folded"));
  assert.strictEqual(n.querySelector(".src"), null, "no tag when there's none");
  n.querySelector(".th-head").click();
  assert.ok(!n.classList.contains("folded"));
  assert.deepStrictEqual(got, [true]);
  const l = live([thought("x")]);
  l.querySelector(".th-head").click();
  assert.ok(!l.classList.contains("folded"), "a live one doesn't fold");
});

check("a long raw thought changes only its own text", () => {
  const n = live([{ kind: "step", node: el("span", {}, "Read a.js"), now: false }, thought("", true, true)]);
  const before = n.querySelectorAll("li"), list = n.querySelector(".tl2");
  let t = "";
  for (let i = 0; i < 50; i++) { t += "word ".repeat(40); T.patchThought(n, t); }
  const after = n.querySelectorAll("li");
  assert.strictEqual(after.length, 2);
  assert.ok(after.every((li, i) => li === before[i]), "the same items");
  assert.strictEqual(text(n.querySelectorAll(".tx")[0]), t);
  assert.strictEqual(n.replaced + list.replaced, 0, "nothing else rebuilt");
});

check("the backend marks raw thinking", () => {
  const { ChatView } = require("../extension/lib/chat");
  const chat = Object.create(ChatView.prototype);
  const posted = [];
  Object.assign(chat, { tabs: [], panes: [], runtime: new Map(), post: (m) => posted.push(m), postTabs: () => {}, save: () => {}, warm: () => {},
    notifier: { show: () => {}, clear: () => {} }, router: null, activity: null, changes: { summary: () => [] }, procKey: () => "k" });
  const tab = { id: "t1", title: "x", model: "codex:gpt-oss", mode: "agent", status: "running", messages: [] };
  const reply = { role: "assistant", blocks: [], running: true, t0: Date.now(), mode: "agent", models: ["codex:gpt-oss"] };
  tab.messages.push({ role: "user", segments: [] }, reply);
  const r = { turn: { reply, snaps: {}, ask: "x", journal: { tools: [] } }, perms: new Map(), agents: new Map(), tasks: new Map(), steers: [] };
  chat.onClaude(tab, r, { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking", kural_raw: true } } });
  chat.onClaude(tab, r, { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Let me think" } } });
  const b = reply.blocks[reply.blocks.length - 1];
  assert.deepStrictEqual([b.k, b.text, b.raw], ["think", "Let me think", true]);
  chat.onClaude(tab, r, { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking" } } });
  chat.onClaude(tab, r, { type: "stream_event", event: { type: "content_block_stop", index: 0 } });
  chat.onClaude(tab, r, { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking" } } });
  chat.onClaude(tab, r, { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Summary" } } });
  const s = reply.blocks[reply.blocks.length - 1];
  assert.strictEqual(s.raw, undefined, "a summary isn't marked");
});

console.log(failed ? `timeline-page: ${failed} FAILED` : "timeline-page: ALL PASS");
process.exit(failed ? 1 : 0);
