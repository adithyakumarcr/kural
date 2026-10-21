// Answering questions in the chat: pick, then Send (docs/superpowers/specs/2026-10-21-calm-chat-design.md). A click picks an
// option (a second click un-picks it; several where the question allows it); your picks stay on the question and nothing
// is sent until you press the chat's Send, which also takes a note from the box. For a question card (AskUserQuestion)
// and for options the AI wrote at the end of its answer (media/markdown.js choicesOf). "Ask about this question" goes back
// to the AI that asked: it answers, then asks again, changed if needed. No outside libraries; the tests load it too.
(function () {
  const REC = /\s*\(recommended\)\s*/i;
  const clean = (s) => String(s == null ? "" : s).replace(REC, " ").trim();

  // d: el, icon, post(msg), tab() → the shown chat, markdown(text, finished) → nodes, onChange() (the picks changed:
  // redraw the line above the box), sendText(text, picks) (a message, the way the chat box sends one).
  function KURAL_CHOICES({ el, icon, post, tab, markdown, onChange, sendText }) {
    const sel = new Map();     // key → the labels picked, in the order picked
    const other = new Map();   // key → what you typed in a card's "Other…"
    const cards = new Map();   // "tab|pid" → { tabId, i, pid, qs }: question cards waiting for you, as drawn
    const texts = new Map();   // key → { tabId, question }: options at the end of the last answer, clickable
    const tid = () => (tab() || {}).id;
    const keyOf = (i, pid, qi) => `${tid()}|${i}|${pid || "text"}|${qi}`;
    const picksOf = (key) => { const o = String(other.get(key) || "").trim(); return [...(sel.get(key) || []), ...(o ? [o] : [])]; };
    const changed = () => { if (onChange) onChange(); };
    function toggle(key, label, multi) {
      const cur = sel.get(key) || [], at = cur.indexOf(label);
      if (multi) sel.set(key, at >= 0 ? cur.filter((x) => x !== label) : [...cur, label]);
      else { sel.set(key, at >= 0 ? [] : [label]); if (at < 0) other.delete(key); }
      changed();
    }

    function row({ label, description, recommended }, { multi, on, enabled }) {
      return el("button", { class: `q-opt${multi ? " multi" : ""}${on ? " on" : ""}${recommended ? " rec" : ""}`, disabled: !enabled },
        el("span", { class: "q-mark" }), el("span", { class: "q-opt-text" }, el("span", { class: "q-label" }, label), description ? el("span", { class: "q-desc" }, description) : null));
    }
    // "Not sure? Ask about this question": once asked, the box locks (the AI's answer brings the question back).
    function askRow(onAsk) {
      const input = el("input", { class: "q-ask-in", placeholder: "Not sure? Ask about this question", spellcheck: "false" });
      const go = () => { const v = String(input.value || "").trim(); if (!v || input.disabled) return; input.disabled = true; btn.disabled = true; onAsk(v); };
      const btn = el("button", { class: "cb", onclick: go }, "Ask");
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); go(); } });
      return el("div", { class: "q-ask" }, icon("question"), input, btn);
    }

    // A question card (AskUserQuestion). prior: { before, answerText } when it's the new version of a card you asked about.
    function card(b, i, prior) {
      const qs = b.questions || [], state = b.state || "pending", pending = state === "pending";
      const ck = `${tid()}|${b.pid}`;
      // (A card that's answered, skipped or asked about, and the old version folded into this one, no longer waits: its
      // picks go, and the line above the box is told.)
      const gone = [!pending ? ck : null, prior && prior.before ? `${tid()}|${prior.before.pid}` : null].filter((k) => k && cards.has(k));
      if (pending) cards.set(ck, { tabId: tid(), i, pid: b.pid, qs });
      for (const k of gone) {
        const c = cards.get(k);
        cards.delete(k);
        c.qs.forEach((q, qi) => { const key = `${c.tabId}|${c.i}|${c.pid}|${qi}`; sel.delete(key); other.delete(key); });
      }
      if (gone.length) changed();
      const title = pending ? (qs.length > 1 ? "A few questions for you" : "A question for you")
        : state === "answered" ? "You answered" : state === "asked" ? `You asked: ${b.ask || ""}` : "Skipped";
      const node = el("div", { class: `question ${state}` });
      node.append(el("div", { class: "q-title" }, b.agent ? el("span", { class: "perm-agent" }, b.agent) : null, title,
        prior ? el("span", { class: "q-upd" }, "Updated after your question") : null));
      if (prior) node.append(el("div", { class: "q-qa" }, el("div", { class: "q-qa-q" }, `You asked: ${(prior.before && prior.before.ask) || ""}`),
        el("div", { class: "q-qa-a" }, markdown(prior.answerText || "", true))));
      qs.forEach((q, qi) => {
        const key = keyOf(i, b.pid, qi), multi = !!q.multiSelect;
        // What you sent ("Cards. Note: keep it simple"): its picks are marked on the options, and it's shown whole.
        const said = state === "answered" && b.answers && b.answers[q.question] != null ? String(b.answers[q.question]) : null;
        const saidParts = said == null ? [] : said.split(/\.\s+Note:/)[0].split(/,\s*/).map((x) => x.trim());
        const box = el("div", { class: "q-block" }, q.header ? el("span", { class: "q-chip" }, q.header) : null, el("div", { class: "q-text" }, q.question),
          multi && pending ? el("div", { class: "q-muted small" }, "Pick one or more") : null);
        const rows = [];
        const paint = () => { const p = picksOf(key); for (const [r, l] of rows) r.classList.toggle("on", p.includes(l)); };
        for (const o of q.options || []) {
          const label = clean(o.label);
          const r = row({ label, description: clean(o.description), recommended: REC.test(o.label || "") || REC.test(o.description || "") },
            { multi, on: pending ? picksOf(key).includes(label) : saidParts.includes(label), enabled: pending });
          if (pending) r.addEventListener("click", () => { toggle(key, label, multi); paint(); });
          rows.push([r, label]);
          box.append(r);
        }
        // (Your own words count as this question's pick; with one choice they replace the option you'd picked.)
        if (pending) {
          const inp = el("input", { class: "q-other", placeholder: "Other…", value: other.get(key) || "" });
          inp.addEventListener("input", () => { other.set(key, inp.value); if (!multi && String(inp.value).trim()) { sel.set(key, []); paint(); } changed(); });
          box.append(inp);
        }
        if (said) box.append(el("div", { class: "q-said" }, said));
        node.append(box);
      });
      if (pending) {
        node.append(askRow((v) => post({ type: "answer", tabId: tid(), pid: b.pid, ask: v })));
        node.append(el("div", { class: "q-foot" }, el("span", { class: "q-hint" }, "Pick, then press Send"), el("span", { class: "spacer" }),
          el("button", { class: "cb", onclick: () => post({ type: "answer", tabId: tid(), pid: b.pid, answers: null }) }, "Skip")));
      }
      if (prior && prior.before) node.append(el("details", { class: "q-before" }, el("summary", {}, "The question before you asked"),
        el("ul", {}, (prior.before.questions || []).map((q) => el("li", {}, `${q.question} ${(q.options || []).map((o) => clean(o.label)).join(" · ")}`)))));
      return node;
    }

    // Options the AI wrote at the end of its answer (ch from choicesOf). answered: your message's picks after it, if any;
    // clickable: the last answer of an idle chat (older answers and other workspaces' chats never are).
    function options(ch, i, { answered, clickable }) {
      const key = keyOf(i, null, 0), multi = !!ch.multi, live = !!clickable && !answered, yesNo = !ch.showQuestion;
      const got = answered ? (((answered.find((a) => a.question === ch.question) || answered[0]) || {}).choices || []) : null;
      if (live) texts.set(key, { tabId: tid(), question: ch.question }); else texts.delete(key);
      const node = el("div", { class: `reply${answered ? " done" : ""}${yesNo ? " yes-no" : ""}` });
      if (ch.showQuestion) node.append(el("div", { class: "reply-q" }, markdown(ch.question, true)));
      if (answered || live) node.append(el("div", { class: "reply-h" }, icon(answered ? "check" : "pass"), answered ? "You answered" : multi ? "Pick one or more, then press Send" : "Pick one, then press Send"));
      const wrap = yesNo ? el("div", { class: "reply-chips" }) : node, rows = [];
      const paint = () => { const p = picksOf(key); for (const [r, l] of rows) r.classList.toggle("on", p.includes(l)); };
      for (const o of ch.options || []) {
        const r = row(o, { multi, on: got ? got.includes(o.label) : live && picksOf(key).includes(o.label), enabled: live });
        if (live) r.addEventListener("click", () => { toggle(key, o.label, multi); paint(); });
        rows.push([r, o.label]);
        wrap.append(r);
      }
      if (yesNo) node.append(wrap);
      if (live) node.append(askRow((v) => sendText(`About your question "${ch.question}": ${v}`)));
      return node;
    }

    const cardPicks = (t, c) => c.qs.map((q, qi) => picksOf(`${t}|${c.i}|${c.pid}|${qi}`));
    // What Send answers now: whole cards (every question picked) and the answer's options with a pick. null: nothing.
    function pending() {
      const t = tid(), outCards = [], outPicks = [];
      for (const c of cards.values()) {
        if (c.tabId !== t || !c.qs.length) continue;
        const p = cardPicks(t, c);
        if (p.every((x) => x.length)) outCards.push({ pid: c.pid, answers: Object.fromEntries(c.qs.map((q, qi) => [q.question, p[qi].join(", ")])) });
      }
      for (const [key, x] of texts) { if (x.tabId !== t) continue; const p = picksOf(key); if (p.length) outPicks.push({ question: x.question, choices: p }); }
      return outCards.length || outPicks.length ? { cards: outCards, picks: outPicks } : null;
    }
    function picked() {
      const t = tid(), parts = [];
      for (const c of cards.values()) if (c.tabId === t) for (const p of cardPicks(t, c)) if (p.length) parts.push(p.join(", "));
      for (const [key, x] of texts) if (x.tabId === t) { const p = picksOf(key); if (p.length) parts.push(p.join(", ")); }
      return parts;
    }
    const anyPicked = () => picked().length > 0;
    // Above the chat box while something is picked: "Your answer  Calm reading, Fold-first  (press Send)".
    function lineNode() {
      const parts = picked();
      return parts.length ? el("div", { class: "answer-line" }, el("span", { class: "h" }, "Your answer"), el("span", { class: "v" }, parts.join("  ·  ")),
        el("span", { class: "m" }, "(press Send)")) : null;
    }
    function clear() {
      const t = `${tid()}|`;
      for (const m of [sel, other]) for (const k of [...m.keys()]) if (k.startsWith(t)) m.delete(k);
      changed();
    }
    return { card, options, pending, anyPicked, lineNode, clear };
  }

  if (typeof window !== "undefined") window.KURAL_CHOICES = KURAL_CHOICES;
  if (typeof module !== "undefined") module.exports = KURAL_CHOICES;
})();
