// Listen in the chat: the chat host and its page are wired to it (Listen's messages go only to the pane that asked; it
// stops when the chat closes, a pane goes or Edit cuts the answer; saved chats are cleaned), Fork keeps a walkthrough, and
// the conversation's handoff doesn't carry it (it isn't part of the conversation).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { forkConversation } = require("../extension/lib/chat/fork");
const journal = require("../extension/lib/router/journal");

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const read = (p) => fs.readFileSync(path.join(__dirname, "../extension", p), "utf8");
const chat = read("lib/chat/index.js"), page = read("media/chat.js");

check("the chat makes a Listen whose messages go to one pane, never to all", () => {
  assert.ok(/new Listen\(\{[\s\S]{0,400}postTo: \(pane, msg\) => this\.postTo\(pane, msg\)/.test(chat));
  assert.ok(!/new Listen\(\{[^}]*post: \(msg\) => this\.post\(/.test(chat));
});
check("the page's Listen messages reach it with the pane they came from", () => {
  for (const m of ["listenStart", "listenWarm", "listenStop", "listenDownload", "listenDownloadStop"]) assert.ok(chat.includes(`case "${m}"`), m);
  assert.ok(/case "listenStart":[^\n]*this\.listen\.start\(pane, tab/.test(chat));
  assert.ok(/case "listenDownload":[^\n]*this\.listen\.download\(pane, tab/.test(chat));
});
check("it stops when the chat closes, a pane goes, or Edit cuts the answer; saved chats are cleaned; it's disposed", () => {
  assert.ok(/this\.voice\.closed\(id\);\s*this\.listen\.tabClosed\(id\);/.test(chat));
  assert.strictEqual((chat.match(/this\.listen\.paneGone\(/g) || []).length >= 3, true, "every place a pane leaves");
  assert.ok(/tab\.messages = tab\.messages\.slice\(0, index\);\s*this\.listen\.cut\(tab\);/.test(chat));
  assert.ok(/SideChats\.clean\(t\.messages\);\s*Listen\.clean\(t\.messages\);/.test(chat));
  assert.ok(/this\.voice\.dispose\(\); this\.listen\.dispose\(\);/.test(chat));
});
check("the page gets why Listen can't run in this chat", () => assert.ok(/viewTab\(t\) \{[^\n]*listenWhy: this\.listen\.why\(t\)/.test(chat)));
check("the page loads listen.js before chat.js", () => {
  const a = chat.indexOf('uri("listen.js")'), b = chat.indexOf('uri("chat.js")');
  assert.ok(a > 0 && a < b);
});
check("the chat page draws the button and the bar and passes Listen its messages", () => {
  assert.ok(page.includes("window.KURAL_LISTEN("));
  assert.ok(/el\("div", \{ class: "answer-actions" \}, listen\.button\(m, i\), forkButton\(i\)\)/.test(page));
  assert.ok(page.includes("listen.bar(m, i)"));
  assert.ok(/case "listenState": case "listenAudio": case "listenEnd": listen\.onMessage\(m\); break;/.test(page));
  assert.ok(/case "full": [^\n]*listen\.onFull\(/.test(page));
  assert.ok(/function rerender\(i\) \{[\s\S]{0,400}listen\.retag\(\);/.test(page));
});
check("Fork keeps the walkthrough on the answer", () => {
  const source = { id: "a", status: "idle", messages: [{ role: "user", segments: [{ t: "text", v: "Why?" }] },
    { role: "assistant", blocks: [{ k: "text", text: "Because." }], listen: { pieces: [{ block: 0, text: "So, here's why." }], model: "Haiku", engine: "supertonic", at: 1 } }] };
  const tab = forkConversation(source, 1, { id: "b", sessionId: "s" });
  assert.deepStrictEqual(tab.messages[1].listen.pieces, [{ block: 0, text: "So, here's why." }]);
});
check("the handoff to another AI doesn't carry the walkthrough", () => {
  const messages = [{ role: "user", segments: [{ t: "text", v: "Why?" }] },
    { role: "assistant", blocks: [{ k: "text", text: "Because." }], listen: { pieces: [{ block: 0, text: "WALKTHROUGH-ONLY" }] } }];
  assert.ok(!journal.handoff(messages).includes("WALKTHROUGH-ONLY"));
});

process.exit(failed ? 1 : 0);
