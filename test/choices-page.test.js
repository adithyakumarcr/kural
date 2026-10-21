// Answering questions in the chat (media/choices.js) on a small DOM: pick, then Send (several where allowed), your picks
// kept on the question, the line above the chat box, Ask about this question (on a card, and on options the AI wrote in
// its answer), only the last answer of an idle chat clickable, and a card you asked about folding into its new version.
const assert = require("assert");
const { el, text, all } = require("./fake-dom");

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

function page() {
  const posted = [], sent = [];
  let changes = 0;
  const T = { id: "t1", status: "idle", messages: [] };
  const C = require("../extension/media/choices.js")({ el, icon: (n) => el("i", { class: `codicon codicon-${n}` }), post: (m) => posted.push(m), tab: () => T,
    markdown: (s) => [el("p", {}, s)], onChange: () => { changes++; }, sendText: (t, picks) => sent.push({ t, picks }) });
  return { C, T, posted, sent, changes: () => changes };
}
const card = (state = "pending", extra = {}) => ({ k: "question", pid: "p1", state, questions: [
  { question: "Which one?", options: [{ label: "Calm reading (Recommended)", description: "Real headings" }, { label: "Cards" }] },
  { question: "Which parts?", multiSelect: true, options: [{ label: "Tables" }, { label: "Callouts" }, { label: "Steps" }] }], ...extra });
const textChoice = (multi = true) => ({ start: 0, end: 2, question: "Which ones?", showQuestion: true, multi,
  options: [{ label: "A", description: "first", recommended: false }, { label: "B", description: "", recommended: true }] });
const rows = (n) => n.querySelectorAll(".q-opt");
const on = (n) => rows(n).filter((r) => r.classList.contains("on")).map((r) => text(r.querySelector(".q-label")));

check("pick, un-pick, several where allowed", () => {
  const p = page(), c = p.C.card(card(), 1);
  const r = rows(c);
  assert.strictEqual(r.length, 5);
  assert.ok(r[0].classList.contains("rec"), "the recommended one is marked");
  assert.strictEqual(text(r[0].querySelector(".q-label")), "Calm reading", "(Recommended) comes off the label");
  r[2].click(); r[3].click();
  assert.deepStrictEqual(on(p.C.card(card(), 1)), ["Tables", "Callouts"]);
  assert.strictEqual(p.C.pending(), null, "a card counts once every question has a pick");
  r[0].click(); r[0].click();
  assert.deepStrictEqual(on(p.C.card(card(), 1)), ["Tables", "Callouts"], "a second click un-picks");
  r[1].click();
  assert.deepStrictEqual(p.C.pending().cards, [{ pid: "p1", answers: { "Which one?": "Cards", "Which parts?": "Tables, Callouts" } }]);
  assert.ok(p.changes() > 0);
  assert.strictEqual(all(c, "button").some((b) => /submit/i.test(text(b))), false, "no Submit: the chat's Send answers");
});

check("Other… on a card counts as that question's pick", () => {
  const p = page(), c = p.C.card(card(), 1);
  const other = c.querySelectorAll(".q-other")[0];
  other.value = "Something calmer"; other.dispatch("input");
  rows(c)[2].click();
  assert.deepStrictEqual(p.C.pending().cards[0].answers, { "Which one?": "Something calmer", "Which parts?": "Tables" });
});

check("the line above the box", () => {
  const p = page();
  p.C.options(textChoice(), 3, { answered: null, clickable: true });
  assert.strictEqual(p.C.lineNode(), null);
  const n = p.C.options(textChoice(), 3, { answered: null, clickable: true });
  rows(n)[0].click(); rows(n)[1].click();
  const line = p.C.lineNode();
  assert.ok(line.classList.contains("answer-line"));
  assert.deepStrictEqual(line.children.map(text), ["Your answer", "A, B", "(press Send)"]);
  assert.deepStrictEqual(p.C.pending().picks, [{ question: "Which ones?", choices: ["A", "B"] }]);
  p.C.clear();
  assert.strictEqual(p.C.pending(), null);
  assert.strictEqual(p.C.lineNode(), null);
});

check("picks survive a redraw", () => {
  const p = page();
  rows(p.C.options(textChoice(), 3, { answered: null, clickable: true }))[1].click();
  assert.deepStrictEqual(on(p.C.options(textChoice(), 3, { answered: null, clickable: true })), ["B"]);
});

check("answered: your picks stay, the rest fades", () => {
  const p = page();
  const n = p.C.options(textChoice(), 3, { answered: [{ question: "Which ones?", choices: ["B"] }], clickable: false });
  assert.ok(n.classList.contains("done"));
  assert.deepStrictEqual(on(n), ["B"]);
  const c = p.C.card(card("answered", { answers: { "Which one?": "Cards. Note: keep it simple", "Which parts?": "Tables, Steps" } }), 1);
  assert.deepStrictEqual(on(c), ["Cards", "Tables", "Steps"]);
  assert.ok(text(c).includes("Cards. Note: keep it simple"), "what was sent, note included");
  assert.ok(rows(c).every((r) => r.disabled));
});

check("only the last idle answer is clickable", () => {
  const p = page();
  const n = p.C.options(textChoice(), 3, { answered: null, clickable: false });
  rows(n)[0].click();
  assert.deepStrictEqual(on(p.C.options(textChoice(), 3, { answered: null, clickable: false })), []);
  assert.strictEqual(n.querySelector(".q-ask"), null);
  assert.strictEqual(p.C.pending(), null);
});

check("asking about a card", () => {
  const p = page(), c = p.C.card(card(), 1);
  const ask = c.querySelector(".q-ask");
  const input = ask.querySelector("input");
  assert.strictEqual(input.getAttribute("placeholder"), "Not sure? Ask about this question");
  input.value = "Which one matters most?";
  ask.querySelector("button").click();
  assert.deepStrictEqual(p.posted, [{ type: "answer", tabId: "t1", pid: "p1", ask: "Which one matters most?" }]);
});

check("asking about options in an answer", () => {
  const p = page(), n = p.C.options(textChoice(), 3, { answered: null, clickable: true });
  const input = n.querySelector(".q-ask input");
  input.value = "Which one matters most?";
  input.dispatch("keydown", { key: "Enter" });
  assert.deepStrictEqual(p.sent.map((s) => s.t), ['About your question "Which ones?": Which one matters most?']);
});

check("a waiting card with nothing picked isn't an answer", () => {
  const p = page();
  p.C.card(card(), 1);
  assert.strictEqual(p.C.pending(), null);
  assert.strictEqual(p.C.anyPicked(), false);
});

check("Skip on a card", () => {
  const p = page(), c = p.C.card(card(), 1);
  all(c, "button").find((b) => text(b) === "Skip").click();
  assert.deepStrictEqual(p.posted, [{ type: "answer", tabId: "t1", pid: "p1", answers: null }]);
});

check("yes/no options are two buttons", () => {
  const p = page();
  const n = p.C.options({ start: 1, end: 1, question: "Want me to open them?", showQuestion: false, multi: false,
    options: [{ label: "Yes", description: "", recommended: false }, { label: "No", description: "", recommended: false }] }, 3, { answered: null, clickable: true });
  assert.strictEqual(n.querySelector(".reply-q"), null, "the question is in the answer's own text");
  assert.deepStrictEqual(rows(n).map((r) => text(r.querySelector(".q-label"))), ["Yes", "No"]);
  rows(n)[0].click(); rows(n)[1].click();
  assert.deepStrictEqual(p.C.pending().picks, [{ question: "Want me to open them?", choices: ["No"] }], "one choice");
});

check("the asked card folds into the new one", () => {
  const p = page();
  const asked = card("asked", { pid: "p0", ask: "Which one?" });
  const c = p.C.card(card("pending", { pid: "p2" }), 5, { before: asked, answerText: "Timeline is easiest" });
  const t = text(c);
  assert.ok(t.includes("Updated after your question"));
  assert.ok(t.includes("You asked: Which one?"));
  assert.ok(t.includes("Timeline is easiest"));
  const d = c.querySelector("details");
  assert.strictEqual(text(d.querySelector("summary")), "The question before you asked");
  assert.ok(text(d).includes("Calm reading · Cards"));
  // Alone (no newer card yet): "You asked: …", nothing to pick.
  const alone = p.C.card(asked, 5);
  assert.ok(text(alone).includes("You asked: Which one?"));
  assert.ok(rows(alone).every((r) => r.disabled));
});

check("a card you asked about stops counting: its picks reach neither Send nor the line", () => {
  const p = page(), c = p.C.card(card(), 5);
  rows(c)[1].click(); rows(c)[2].click();
  assert.ok(p.C.pending(), "picked");
  const before = p.changes();
  p.C.card(card("pending", { pid: "p2" }), 5, { before: card("asked", { ask: "Which one?" }), answerText: "Timeline" });
  assert.strictEqual(p.C.pending(), null);
  assert.strictEqual(p.C.anyPicked(), false);
  assert.strictEqual(p.C.lineNode(), null);
  assert.ok(p.changes() > before, "the line above the box is told");
  // An answered card stops counting too, and says so.
  const q = page(), d = q.C.card(card(), 5);
  rows(d)[1].click(); rows(d)[2].click();
  const n = q.changes();
  q.C.card(card("answered", { answers: { "Which one?": "Cards", "Which parts?": "Tables" } }), 5);
  assert.strictEqual(q.C.anyPicked(), false);
  assert.ok(q.changes() > n);
});

console.log(failed ? `choices-page: ${failed} FAILED` : "choices-page: ALL PASS");
process.exit(failed ? 1 : 0);
