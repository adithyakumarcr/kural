// Side chat in the chat page (the host half is lib/chat/side.js): a small box under an answer for a quick question about
// a part of it. Select text in an answer → Ask → the box opens with the quote and an input; Enter asks; Esc or × closes it
// (with questions in it, it folds into one row "Side chat · 2 questions"). The data lives on the message:
// msg.side = [{ id, quote, items: [{ q, a, model, at, running?, error?, stopped? }] }].
// Loaded by chat.js as a plain script (window.KURAL_SIDE = make) and by the test with require().
(function () {
  function make(d) {
    // d: el, icon, markdown(text, finished) → nodes, post(msg), tab() → the shown chat, rerender(i), addToChat({text, label}), root() → the list element
    const ui = new Map();   // "<tab>:<message>:<thread>" → { open, draft }
    const keyOf = (i, th) => `${d.tab().id}:${i}:${th.id}`;
    const state = (i, th) => { const k = keyOf(i, th); if (!ui.has(k)) ui.set(k, { open: false, draft: "" }); return ui.get(k); };
    const plural = (n) => `${n} question${n === 1 ? "" : "s"}`;
    const busy = (th) => th.items.some((x) => x.running);
    const find = (i, id) => { const m = d.tab().messages[i]; const th = m && (m.side || []).find((t) => t.id === id); return th ? { m, th } : null; };
    const where = (i, id) => d.root().querySelector(`[data-i="${i}"] [data-th="${id}"]`);

    function answerNode(item, k) {
      const box = d.el("div", { class: "side-a md", "data-k": k });
      fill(box, item);
      return box;
    }
    function fill(box, item) {
      if (item.running && !item.a) box.replaceChildren(d.el("span", { class: "dots" }, d.el("span"), d.el("span"), d.el("span")), " ", d.el("span", { class: "muted" }, "Thinking…"));
      else box.replaceChildren(...d.markdown(item.a || "", !item.running));
    }

    function threadNode(i, th) {
      const st = state(i, th);
      if (!st.open) {
        return d.el("button", { class: "side-row", "data-th": th.id, title: th.quote, onclick: () => { st.open = true; redraw(i, th.id, true); } },
          d.icon("comment-discussion"), ` Side chat · ${plural(th.items.length)}`);
      }
      const items = th.items.map((item, k) => d.el("div", { class: "side-item" },
        d.el("div", { class: "side-q" }, item.q),
        answerNode(item, k),
        item.error ? d.el("div", { class: "side-err" }, `Couldn't answer: ${item.error}`) : null,
        item.stopped ? d.el("div", { class: "side-note" }, "Stopped.") : null,
        item.running
          ? d.el("div", { class: "side-foot" }, d.el("button", { class: "side-btn", title: "Stop this answer", onclick: () => d.post({ type: "sideStop", tabId: d.tab().id, thread: th.id }) }, d.icon("debug-stop"), " Stop"))
          : item.a && !item.error
            ? d.el("div", { class: "side-foot" }, item.model ? d.el("span", { class: "side-model" }, item.model) : null,
              d.el("button", { class: "side-btn", title: "Put this question and answer in your message", onclick: () => d.addToChat({ text: `Side question: ${item.q}\n\nAnswer: ${item.a}`, label: item.q }) },
                d.icon("quote"), " Add to chat"))
            : null));
      const input = d.el("input", { class: "side-in", type: "text", placeholder: "Ask about this…", value: st.draft, "data-i": i, "data-th": th.id, "aria-label": "Ask about the selected text",
        oninput: (e) => { st.draft = e.target.value; },
        onkeydown: (e) => {
          if (e.isComposing) return;
          if (e.key === "Escape") { e.preventDefault && e.preventDefault(); e.stopPropagation && e.stopPropagation(); close(i, th); }
          else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault && e.preventDefault();
            const text = String(e.target.value || "").trim();
            if (text && !busy(th)) ask(i, th, text);
          }
        } });
      input.value = st.draft;
      return d.el("div", { class: "side", "data-th": th.id },
        d.el("div", { class: "side-head" }, d.el("span", { class: "side-quote", title: th.quote }, th.quote),
          d.el("button", { class: "side-x", title: "Close (Esc)", "aria-label": "Close the side chat", onclick: () => close(i, th) }, d.icon("close"))),
        items, input);
    }

    // The threads of a message, for messageNode.
    function nodes(m, i) { return (m.side || []).map((th) => threadNode(i, th)); }

    // Draw one thread again in place (the rest of the page doesn't move); focus: put the cursor in its input.
    function redraw(i, id, focus) {
      const f = find(i, id), old = where(i, id);
      if (!f || !old) return;
      const had = focus || (typeof document !== "undefined" && document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("side-in") && old.contains(document.activeElement));
      const node = threadNode(i, f.th);
      old.replaceWith(node);
      const inp = node.querySelector && node.querySelector(".side-in");
      if (had && inp) { inp.focus(); if (node.scrollIntoView) node.scrollIntoView({ block: "nearest" }); }
    }

    function start(i, quote) {
      const m = d.tab().messages[i];
      if (!m || m.role !== "assistant") return;
      const th = { id: Math.random().toString(36).slice(2, 10), quote: String(quote).trim().slice(0, 2000), items: [] };
      (m.side = m.side || []).push(th);
      state(i, th).open = true;
      d.rerender(i);
      const inp = where(i, th.id) && where(i, th.id).querySelector(".side-in");
      if (inp) { inp.focus(); inp.scrollIntoView && inp.scrollIntoView({ block: "nearest" }); }
    }

    function ask(i, th, text) {
      const st = state(i, th);
      th.items.push({ q: text, a: "", model: "", at: Date.now(), running: true });
      st.draft = "";
      redraw(i, th.id, true);
      d.post({ type: "sideAsk", tabId: d.tab().id, index: i, thread: th.id, quote: th.quote, question: text });
    }

    function close(i, th) {
      if (busy(th)) d.post({ type: "sideStop", tabId: d.tab().id, thread: th.id });
      if (!th.items.length) {   // nothing asked: the box disappears
        const m = d.tab().messages[i];
        m.side = (m.side || []).filter((t) => t !== th);
        if (!m.side.length) delete m.side;
        ui.delete(keyOf(i, th));
        d.rerender(i);
        return;
      }
      state(i, th).open = false;
      redraw(i, th.id, false);
    }

    // From the host: pieces of the answer as they come, and the question's state (start, end, error).
    const dirty = new Set();
    let timer = null;
    function delta(m) {
      const f = find(m.index, m.thread);
      if (!f) return;
      const item = f.th.items[f.th.items.length - 1];
      if (!item) return;
      item.a += m.text;
      dirty.add(`${m.index}:${m.thread}`);
      if (!timer) timer = setTimeout(flush, 66);
    }
    function flush() {
      timer = null;
      for (const key of [...dirty]) {
        const [i, id] = key.split(":"), f = find(Number(i), id);
        const box = f && where(Number(i), id) && where(Number(i), id).querySelectorAll(".side-a");
        if (box && box.length) { const item = f.th.items[box.length - 1]; if (item) fill(box[box.length - 1], item); }
      }
      dirty.clear();
    }
    function set(m) {
      const msg = d.tab().messages[m.index];
      if (!msg) return;
      let th = (msg.side || []).find((t) => t.id === m.thread);
      if (!th) { th = { id: m.thread, quote: m.quote || "", items: [] }; (msg.side = msg.side || []).push(th); }
      th.items[m.n] = m.item;
      dirty.delete(`${m.index}:${m.thread}`);
      if (where(m.index, m.thread)) redraw(m.index, m.thread, false); else d.rerender(m.index);
    }

    // Keep the cursor of a side input through a redraw of its message.
    function focused() {
      const a = typeof document !== "undefined" ? document.activeElement : null;
      return a && a.classList && a.classList.contains("side-in") ? { i: Number(a.getAttribute("data-i")), th: a.getAttribute("data-th"), s: a.selectionStart, e: a.selectionEnd } : null;
    }
    function refocus(f) {
      if (!f) return;
      const n = where(f.i, f.th), inp = n && n.querySelector(".side-in");
      if (inp) { inp.focus(); try { inp.setSelectionRange(f.s, f.e); } catch { /* (no selection in this input) */ } }
    }

    return { nodes, start, delta, set, close, ask, focused, refocus, state };
  }
  if (typeof module !== "undefined" && module.exports) module.exports = make; else window.KURAL_SIDE = make;
})();
