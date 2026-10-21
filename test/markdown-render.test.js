// Chat answers drawn by media/markdown.js (Calm reading): blocks from Markdown, then the page from those blocks, on a
// small DOM. Quotes, GitHub's alerts as callouts, the point-first box, nested lists and checkboxes, half-written syntax
// while an answer streams, and nothing the AI writes turning into HTML.
const assert = require("assert");
const { el, text, all } = require("./fake-dom");

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

const opened = [];
const M = require("../extension/media/markdown.js")({
  el,
  inline: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"),
  codeCard: (info, code) => el("div", { class: "code" }, code),
  icon: (n) => el("i", { class: n }),
  onFile: (p) => opened.push(p),
});
const draw = (src, opts = {}) => { const root = el("div"); root.append(...M.markdown(src, opts.finished !== false, !!opts.lead)); return root; };

check("same blocks as before: headings, paragraphs, lists, a rule, code, tables", () => {
  const b = M.parse("# A\ntext\n\n- x\n- y\n\n---\n```js\nq\n```", { finished: true });
  assert.deepStrictEqual(b.map((x) => x.t), ["h", "p", "list", "hr", "code"]);
  assert.strictEqual(b[0].level, 1);
  assert.strictEqual(b[4].closed, true);
  const t = M.parse("| a | b || --- | --- || 1 | 2 |", { finished: true });
  assert.strictEqual(t.length, 1);
  assert.strictEqual(t[0].t, "table");
  assert.deepStrictEqual(t[0].head, ["a", "b"]);
  assert.deepStrictEqual(t[0].rows, [["1", "2"]]);
  // Drawn as before: # is h3 (the chat's headings start lower), the table in its wrapper.
  const root = draw("# A\n\n| a | b |\n|---|---|\n| 1 | 2 |");
  assert.ok(root.querySelector("h3"));
  assert.ok(root.querySelector(".table-wrap table"));
});

check("quotes and callouts, labels and titles", () => {
  const w = M.parse("> [!WARNING]\n> Two windows", { finished: true });
  assert.deepStrictEqual([w.length, w[0].t, w[0].kind, w[0].title], [1, "callout", "warning", null]);
  assert.deepStrictEqual(w[0].blocks.map((x) => [x.t, x.text]), [["p", "Two windows"]]);
  const t = M.parse("> [!tip] Faster way\n> use X", { finished: true })[0];
  assert.deepStrictEqual([t.t, t.kind, t.title], ["callout", "tip", "Faster way"]);
  assert.strictEqual(M.parse("> plain", { finished: true })[0].t, "quote");
  const nope = M.parse("> [!NOPE]\n> x", { finished: true })[0];
  assert.strictEqual(nope.t, "quote");
  assert.strictEqual(nope.blocks[0].text, "[!NOPE] x");
  const head = (src) => text(draw(src).querySelector(".callout-head"));
  assert.strictEqual(head("> [!WARNING]\n> a"), "Watch out");
  assert.strictEqual(head("> [!CAUTION]\n> a"), "Risk");
  assert.strictEqual(head("> [!NOTE]\n> a"), "Note");
  assert.strictEqual(head("> [!TIP]\n> a"), "Tip");
  assert.strictEqual(head("> [!IMPORTANT]\n> a"), "Important");
  assert.strictEqual(head("> [!tip] Faster way\n> a"), "Faster way");
  assert.ok(draw("> [!WARNING]\n> a").querySelector(".callout.c-warning"));
  assert.ok(draw("> plain").querySelector(".md-quote"));
});

check("the point first, only on the lead block", () => {
  assert.deepStrictEqual(M.parse("**Done:** Each chat reopens.\n\nMore", { finished: true, lead: true })[0],
    { t: "summary", label: "Done", text: "Each chat reopens." });
  assert.strictEqual(M.parse("**Done:** Each chat reopens.\n\nMore", { finished: true, lead: false })[0].t, "p");
  assert.strictEqual(M.parse("**A very long label here:** x", { finished: true, lead: true })[0].t, "p");
  assert.strictEqual(text(draw("**Done:** Each chat reopens.", { lead: true }).querySelector(".sum .sum-label")), "Done");
});

check("nested lists and checkboxes", () => {
  const b = M.parse("- a\n  - b\n- [ ] c\n- [x] d", { finished: true });
  assert.strictEqual(b.length, 1);
  assert.strictEqual(b[0].t, "list");
  assert.strictEqual(b[0].items[0].children[0].t, "list");
  // (b is inside a: three items at the top.)
  assert.strictEqual(b[0].items.length, 3);
  assert.deepStrictEqual([b[0].items[1].task, b[0].items[2].task], ["open", "done"]);
  const root = draw("- a\n  - b\n- [ ] c\n- [x] d");
  const boxes = root.querySelectorAll(".task-box");
  assert.strictEqual(boxes.length, 2);
  assert.deepStrictEqual(boxes.map((x) => x.classList.contains("done")), [false, true]);
});

check("half-written syntax while it streams", () => {
  for (const s of ["> [!WARN", "| a | b", "- [ ", "```js\nx"]) {
    const b = M.parse(s, { finished: false });
    assert.ok(Array.isArray(b), s);
    assert.ok(Array.isArray(M.render(b, { finished: false })), s);
  }
  assert.strictEqual(M.parse("> [!WARN", { finished: false })[0].t, "quote");
  const code = M.parse("```js\nx", { finished: false })[0];
  assert.deepStrictEqual([code.t, code.closed], ["code", false]);
});

check("nothing the AI writes becomes HTML", () => {
  for (const s of ["<img src=x onerror=y>", "> [!NOTE]\n> <b>x</b>", "**Done:** <img src=x>"]) {
    const root = draw(s, { lead: true });
    assert.strictEqual(all(root, "img").length, 0, s);
    assert.strictEqual(all(root, "b").length, 0, s);
  }
});

check("number columns line up on the right", () => {
  const src = "| Test | Time |\n|---|---|\n| a | 0.4 s |\n| b | 1,968 |";
  assert.deepStrictEqual(M.parse(src, { finished: true })[0].num, [false, true]);
  const tds = draw(src).querySelectorAll("td");
  assert.deepStrictEqual(tds.map((td) => td.classList.contains("num")), [false, true, false, true]);
  assert.ok(draw(src).querySelectorAll("th")[1].classList.contains("num"));
  const left = draw("| Test | Time |\n|---|:---|\n| a | 0.4 s |");
  assert.deepStrictEqual(left.querySelectorAll("td").map((td) => td.classList.contains("num")), [false, false]);
});

check("status words get an icon and a color", () => {
  const root = draw("| r |\n|---|\n| passed |\n| Failed |\n| No |\n| Yes |\n| no idea |");
  const tds = root.querySelectorAll("td");
  const kind = (td) => { const s = td.querySelector(".st"); return s ? ["good", "bad", "neutral"].find((k) => s.classList.contains(k)) : "plain"; };
  assert.deepStrictEqual(tds.map(kind), ["good", "bad", "neutral", "good", "plain"]);
  assert.strictEqual(text(tds[1]), "Failed");
  assert.ok(tds[0].querySelector(".st i"), "an icon");
});

check("steps show their files as chips", () => {
  opened.length = 0;
  const a = draw("1. `media/chat.js`: save the place");
  const chip = a.querySelector('.file-chip[data-path="media/chat.js"]');
  assert.ok(chip);
  assert.strictEqual(text(a.querySelector("li")).replace(text(chip), "").trim(), "save the place");
  chip.click();
  assert.deepStrictEqual(opened, ["media/chat.js"]);
  const b = draw("1. **lib/chat/index.js** — keep it");
  assert.ok(b.querySelector('.file-chip[data-path="lib/chat/index.js"]'));
  assert.strictEqual(text(b.querySelector("li")).replace("lib/chat/index.js", "").trim(), "keep it");
  assert.strictEqual(draw("1. Just words").querySelector(".file-chip"), null);
  assert.strictEqual(draw("- `media/chat.js`: not a step").querySelector(".file-chip"), null, "only numbered steps");
});

const opts = (src) => M.choicesOf(M.parse(src, { finished: true }));
check("options after a question", () => {
  const a = opts("Which ones?\n\n- [ ] A — first\n- [ ] B (Recommended)");
  assert.deepStrictEqual([a.start, a.end, a.multi, a.showQuestion, a.question], [0, 2, true, true, "Which ones?"]);
  assert.deepStrictEqual(a.options, [{ label: "A", description: "first", recommended: false }, { label: "B", description: "", recommended: true }]);
  const b = opts("Pick one?\n\n1. **Yes**: go\n2. **No**: stop");
  assert.strictEqual(b.multi, false);
  assert.deepStrictEqual(b.options.map((o) => [o.label, o.description]), [["Yes", "go"], ["No", "stop"]]);
  assert.ok(opts("Which one first? Pick any:\n\n1. a\n2. b"));
  const c = opts("Intro.\n\nWhich one?\n\n1. a\n2. b");
  assert.deepStrictEqual([c.start, c.end], [1, 3]);
});

check("no options without a real question", () => {
  assert.strictEqual(opts("Why does it fail? Because X. Steps:\n\n1. a\n2. b"), null);
  assert.strictEqual(opts("Next steps:\n\n1. a\n2. b"), null);
  assert.strictEqual(opts(`Which one?\n\n${[1, 2, 3, 4, 5, 6, 7].map((n) => `${n}. x${n}`).join("\n")}`), null);
  assert.strictEqual(opts(`Which one?\n\n1. a\n2. ${"b".repeat(121)}`), null);
  assert.strictEqual(opts("Which one?\n\n1. only one"), null);
  assert.strictEqual(opts("Which one?\n\n1. a\n  - nested\n2. b"), null);
});

check("a yes/no question at the end", () => {
  const y = opts("The mockups are ready. Want me to open them?");
  assert.deepStrictEqual([y.start, y.end, y.showQuestion, y.question, y.multi], [1, 1, false, "Want me to open them?", false]);
  assert.deepStrictEqual(y.options.map((o) => o.label), ["Yes", "No"]);
  assert.strictEqual(opts("Is it ready?"), null);
});

console.log(failed ? `markdown-render: ${failed} FAILED` : "markdown-render: ALL PASS");
process.exit(failed ? 1 : 0);
