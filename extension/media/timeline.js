// The thinking timeline (docs/superpowers/specs/2026-10-21-calm-chat-design.md): what the AI thought, between the steps
// it took (read, searched, edited, ran…), exactly as it sends it: Claude's and ChatGPT's own summaries, or raw from
// models on this computer. Kural adds nothing to it and asks no AI about it. While it runs it grows as tall as the chat
// (chat.css --tl-max), then scrolls inside, following the newest line; scroll up and it stays where you are until Latest.
// When that part of the answer is done the chat draws it folded (issue #104: the answer comes up under its header).
// No outside libraries; the tests load it too (module.exports).
(function () {
  function KURAL_TIMELINE({ el, icon }) {
    // A summary's lines in **…** are its titles (bold); everything else is plain text. Raw thinking: as written.
    function setThought(tx, t, raw) {
      // Trailing blank lines showed as a tall gap under the thought (pre-wrap).
      const s = String(t == null ? "" : t).replace(/\n\s*$/, "");
      if (raw || !s.includes("**")) { tx.textContent = s; return; }
      const out = [];
      let title = false;
      for (const line of s.split("\n")) {
        if (title && !line.trim()) continue;   // ("**Title**\n\nText": the text right under its title)
        const b = /^\s*\*\*([^*]+)\*\*\s*$/.exec(line);
        title = !!b;
        out.push(b ? el("b", {}, b[1]) : line, "\n");
      }
      out.pop();
      tx.replaceChildren(...out);
    }
    function item(it) {
      const key = it.key != null ? { "data-b": String(it.key) } : {};
      if (it.kind === "thought") {
        const tx = el("div", { class: `tx${it.raw ? " raw" : ""}` });
        setThought(tx, it.text, it.raw);
        return el("li", { class: `th${it.now ? " now" : ""}`, ...key }, el("span", { class: "dot" }), tx);
      }
      // A step: one line; a click shows it whole.
      const li = el("li", { class: `act${it.now ? " now" : ""}`, ...key }, el("span", { class: "dot" }));
      li.append(el("div", { class: "row", onclick: () => li.classList.toggle("open") }, it.node));
      return li;
    }
    // opts: { label, tag, live, open, items, onToggle(open), state? }. `state` ({ follow }) is kept by the chat per answer
    // part, so a redraw (each new step redraws the answer) keeps your place: following, or where you scrolled to.
    function node({ label, tag, live, open, items, onToggle, state }) {
      const st = state || { follow: true };
      const box = el("div", { class: "tbox" }), list = el("ol", { class: "tl2" });
      box.append(list);
      for (const it of items || []) list.append(item(it));
      const latest = el("button", { class: `latest${!live || st.follow ? " hidden" : ""}`, title: "Back to the newest line" }, icon("arrow-down"), " Latest");
      const head = el("div", { class: `th-head${live ? " live" : ""}`, title: live ? "" : "Show or hide what it thought and did" },
        el("span", { class: "pulse" }), icon("chevron-right"), el("span", { class: "lab" }, label), tag ? el("span", { class: "src" }, tag) : null);
      const root = el("div", { class: `thv${open ? "" : " folded"}${live ? " live" : ""}` }, head, el("div", { class: "tbox-wrap" }, box, latest));
      root._tl = { st, box, latest, live: !!live };
      head.addEventListener("click", () => {
        if (live) return;
        const nowOpen = root.classList.contains("folded");
        root.classList.toggle("folded", !nowOpen);
        if (onToggle) onToggle(nowOpen);
      });
      box.addEventListener("scroll", () => {
        const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
        st.follow = atEnd;
        if (!atEnd) st.top = box.scrollTop;
        latest.classList.toggle("hidden", atEnd || !live);
      });
      latest.addEventListener("click", () => { st.follow = true; box.scrollTop = box.scrollHeight; latest.classList.add("hidden"); });
      return root;
    }
    // After the timeline is on the page, and after it grew: to its end when following, else back to where you were.
    function follow(root) {
      const t = root && root._tl;
      if (!t) return;
      if (t.st.follow) t.box.scrollTop = t.box.scrollHeight;
      else if (t.st.top != null && t.box.scrollTop !== t.st.top) t.box.scrollTop = t.st.top;
    }
    // A thought that grew while it streams: only its own text changes (the last thought), then it follows.
    function patchThought(root, text) {
      const all = root.querySelectorAll("li.th .tx"), tx = all[all.length - 1];
      if (!tx) return;
      setThought(tx, text, tx.classList.contains("raw"));
      follow(root);
    }
    return { node, patchThought, follow };
  }

  if (typeof window !== "undefined") window.KURAL_TIMELINE = KURAL_TIMELINE;
  if (typeof module !== "undefined") module.exports = KURAL_TIMELINE;
})();
