// Listen on the chat page (the host half is lib/listen): the speaker button on a finished answer. Click it and Kural
// talks you through the answer: a short spoken walkthrough in a voice made on this computer, while the part being
// explained is highlighted. The page numbers the answer's rendered blocks (paragraphs, lists, code, tables, headings
// outside the steps), tags them data-lb, and sends them with the click; the host answers with audio, one sentence at a
// time or a few together, which Web Audio plays back to back (no <audio> element), the silence at each clip's edges trimmed
// so it flows like one voice. The player sits just above the chat box (it stays on screen while you scroll): Pause/Play,
// Rewind 5 s, the speed (0.5x–2x; your choice becomes the default), ✕, and three lines: the sentence before, the one being
// spoken, the next. No slider.
// Loaded by chat.js as a plain script (window.KURAL_LISTEN = make) and by the test with require().
(function () {
  const LEAD = 0.05;   // seconds between scheduling and the first sound (a sound scheduled in the past is cut)
  // A clip's edges: below QUIET (of 32768) is silence; LEAD_IN / TAIL seconds of it are kept around the voice, FADE seconds
  // fade in and out (no click where it was cut). PAUSE: between sentences of one part; PAUSE_PART: when the part changes.
  const QUIET = 400, LEAD_IN = 0.03, TAIL = 0.08, FADE = 0.006, PAUSE = 0.09, PAUSE_PART = 0.24;
  const NOTHING = "Nothing to explain in this answer.";
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const ask = (size, model) => `Listen needs a voice: about ${Math.round((size || 0) / 1e6)} MB, downloaded once. The voice is made on this computer; the walkthrough's words are written by ${model || "your AI"} from this answer.`;

  function make(d) {
    // d: el, icon, post(msg), tab() → the shown chat, root() → the list element, rerender(i) (redraws message i, then retag()),
    //   AudioContext, every(fn, ms) → id, stopEvery(id)
    let ctx = null, P = null, follow = true, refollow = false, lit = null, hooked = null, ticker = null, speed = 1, menu = false;
    const dock = d.el("div", { class: "listen-dock hidden" });   // (the chat puts it above the box)
    // P: the answer being listened to here: { tabId, index, phase, message?, size?, model?, pct?, items: [{buffer, block,
    //   text, n, start, dur}], end, from, startedAt, srcs, paused, ended, partial, scheduled, gen }

    function kindOf(n) {
      const t = n.tagName;
      if (t === "P") return "p";
      // Calm reading's boxes (media/markdown.js): the point first, callouts and quotes read like paragraphs.
      if (n.classList.contains("sum") || n.classList.contains("callout") || n.classList.contains("md-quote")) return "p";
      if (t === "UL" || t === "OL") return "list";
      if (/^H[1-6]$/.test(t)) return "heading";
      if (n.classList.contains("code")) return "code";
      if (n.classList.contains("table-wrap")) return "table";
      return null;
    }
    function textOf(n, kind) {
      if (kind === "code") { const pre = n.querySelector("pre"); return (pre || n).textContent; }
      if (kind === "table") return Array.from(n.querySelectorAll("tr"), cells).join("\n");
      // (Only the list's own items: a nested item's text is already in its parent's.)
      if (kind === "list") { const li = Array.from(n.children).filter((x) => x.tagName === "LI"); return (li.length ? li.map((x) => `- ${x.textContent.trim()}`).join("\n") : n.textContent); }
      // "Done: Each chat reopens.", "Watch out: Two windows." (the box's label, then what it says)
      const head = n.querySelector(".sum-label") || n.querySelector(".callout-head");
      if (head) return `${head.textContent.trim()}: ${Array.from(n.children).filter((c) => c !== head).map((c) => c.textContent.trim()).join(" ")}`;
      return n.textContent;
    }
    const cells = (r) => Array.from(r.children, (c) => c.textContent.trim()).join(" | ");

    // The answer's blocks the walkthrough can point at, numbered in order; each gets data-lb (the highlight finds it by that).
    function numberBlocks(answer) {
      const out = [];
      if (!answer) return out;
      for (const old of answer.querySelectorAll("[data-lb]")) old.removeAttribute("data-lb");
      for (const blk of answer.querySelectorAll(".blk")) {
        if (blk.classList.contains("interim") || blk.closest(".steps") || blk.closest(".thv")) continue;   // (not what it did: the timeline)
        for (const n of blk.children) {
          const kind = kindOf(n);
          if (!kind) continue;
          const text = String(textOf(n, kind) || "").trim();
          if (!text) continue;
          n.setAttribute("data-lb", String(out.length));
          out.push({ n: out.length, kind, text });
        }
      }
      return out;
    }

    const answerEl = (i) => d.root().querySelector(`[data-i="${i}"] .answer`);
    const mine = (i) => P && P.tabId === (d.tab() || {}).id && P.index === i;
    const redraw = () => renderDock();

    // ---------- sound ----------
    function position() {
      if (!P || !P.scheduled) return 0;
      return Math.min(P.end, P.from + Math.max(0, ctx.currentTime - P.startedAt));
    }
    function stopSources() { if (P) { for (const s of P.srcs) try { s.stop(); } catch { /* not started */ } P.srcs = []; } }
    // (Several sentences can share one buffer, each its own part of it: it.off, it.dur.)
    function play(it, when, offset) {
      const s = ctx.createBufferSource();
      s.buffer = it.buffer; s.connect(ctx.destination); s.start(when, (it.off || 0) + offset, Math.max(0.001, it.dur - offset));
      P.srcs.push(s);
    }
    // Everything from timeline position `pos`, starting now.
    function schedule(pos) {
      stopSources();
      P.scheduled = true; P.from = pos; P.startedAt = ctx.currentTime + LEAD;
      for (const it of P.items) {
        if (it.start + it.dur <= pos + 1e-9) continue;
        const off = Math.max(0, pos - it.start);
        play(it, P.startedAt + (it.start + off - pos), off);
      }
    }
    // The samples as they arrive: an Int16Array (VS Code passes typed arrays through), or an ArrayBuffer, a plain array, or
    // a typed array that became a numbered object on the way ({"0": …, "1": …}): never silence because of the form.
    function samples(x) {
      if (x instanceof Int16Array) return x;
      if (x instanceof ArrayBuffer) return new Int16Array(x.slice(0, x.byteLength - (x.byteLength % 2)));
      if (ArrayBuffer.isView(x)) return Int16Array.from(x);
      if (Array.isArray(x)) return Int16Array.from(x);
      if (x && typeof x === "object") { const n = Object.keys(x).length, out = new Int16Array(n); for (let k = 0; k < n; k++) out[k] = x[k] | 0; return out; }
      return new Int16Array(0);
    }
    function enqueue(a) {
      if (a.gen != null && a.gen < P.gen) return;   // (made at the old speed)
      const pcm = samples(a.pcm);
      if (!pcm.length || !a.rate) return;
      // The voice leaves silence at both ends of what it makes; played back to back that was a stop after every sentence.
      // Trimmed, with one short pause of Kural's own: a breath between sentences, a little longer when the part changes.
      const [from, to] = voiced(pcm, a.rate);
      if (to <= from) return;
      const buffer = ctx.createBuffer(1, to - from, a.rate), data = buffer.getChannelData(0);
      const fade = Math.min(Math.round(a.rate * FADE), (to - from) >> 2);
      for (let k = 0; k < to - from; k++) data[k] = (pcm[from + k] / 32768) * Math.min(1, (k + 1) / (fade || 1), (to - from - k) / (fade || 1));
      const block = a.block == null ? null : a.block, last = P.items[P.items.length - 1];
      const gap = !last ? 0 : last.block === block ? PAUSE : PAUSE_PART;
      let start = P.end + gap;
      // Several sentences made together (they flow better): each gets its share of the sound, by the length of its words.
      const parts = Array.isArray(a.group) && a.group.length > 1 ? a.group : [{ n: a.n, text: a.text, w: 1 }];
      const weight = parts.reduce((t, x) => t + (Number(x.w) > 0 ? Number(x.w) : 1), 0);
      let off = 0;
      const added = parts.map((x, k) => {
        const dur = k === parts.length - 1 ? buffer.duration - off : buffer.duration * ((Number(x.w) > 0 ? Number(x.w) : 1) / weight);
        const it = { buffer, off, block, text: x.text || "", n: Number.isInteger(x.n) ? x.n : null, start, dur };
        off += dur; start += dur;
        return it;
      });
      P.items.push(...added); P.end = start;
      if (!P.scheduled) return schedule(added[0].start);
      const when = P.startedAt + (added[0].start - P.from);
      if (when < ctx.currentTime) schedule(added[0].start);   // (it ran dry waiting for this one: go on from here, now)
      else for (const it of added) play(it, P.startedAt + (it.start - P.from), 0);
    }
    // Where the voice is in a clip: from just before the first sound to just after the last one ([from, to) in samples).
    function voiced(pcm, rate) {
      const loud = (k) => Math.abs(pcm[k]) > QUIET;
      let a = 0, b = pcm.length;
      while (a < b && !loud(a)) a++;
      while (b > a && !loud(b - 1)) b--;
      if (b <= a) return [0, 0];
      return [Math.max(0, a - Math.round(rate * LEAD_IN)), Math.min(pcm.length, b + Math.round(rate * TAIL))];
    }
    function current() {
      const pos = position();
      let cur = null;
      for (const it of P.items) if (it.start <= pos + 1e-9) cur = it;
      return cur;
    }

    // ---------- the highlight ----------
    function light(block, scroll) {
      const root = d.root();
      for (const n of root.querySelectorAll(".listen-on")) n.classList.remove("listen-on");
      lit = block;
      if (block == null || !P) return;
      const n = root.querySelector(`[data-i="${P.index}"] [data-lb="${block}"]`);
      if (!n) return;
      n.classList.add("listen-on");
      if (scroll && follow && n.scrollIntoView) n.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    function tick() {
      if (!P || !P.scheduled) return;
      const cur = current();
      if (P.ended && position() >= P.end - 1e-3) return stop(false);
      if (!cur) return;
      showLines(cur);
      if (cur.block !== lit || refollow) { light(cur.block, true); refollow = false; }
    }
    const userScroll = () => { follow = false; };
    function hookScroll() {
      const root = d.root();
      if (root === hooked) return;
      hooked = root;
      root.addEventListener("wheel", userScroll, { passive: true });
      root.addEventListener("touchmove", userScroll, { passive: true });
    }

    // The three lines: before, now, next (by the sentences already made; the next may not be made yet).
    function linesFor(cur) {
      const said = P.items.filter((it) => it.text);
      const k = cur ? said.indexOf(cur) : -1;
      return [k > 0 ? said[k - 1].text : "", cur && cur.text ? cur.text : "Getting ready…", k >= 0 && k + 1 < said.length ? said[k + 1].text : ""];
    }
    function showLines(cur) {
      const nodes = dock.querySelectorAll(".listen-line");
      if (nodes.length !== 3) return;
      linesFor(cur).forEach((t, k) => { if (nodes[k].textContent !== t) nodes[k].textContent = t; });
    }

    // ---------- speed ----------
    // The voice makes the sentences again at the new speed from the one being spoken (the host is told which); what was
    // queued from there is dropped, and audio still on its way at the old speed is ignored (P.gen).
    function speedTo(v) {
      speed = v; menu = false;
      if (!P) return renderDock();
      const cur = P.scheduled ? current() : null;
      const said = P.items.filter((it) => it.n != null);
      const from = cur && cur.n != null ? cur.n : said.length ? said[0].n : 0;
      d.post({ type: "listenSpeed", tabId: P.tabId, index: P.index, speed: v, from });
      P.gen = (P.gen || 0) + 1;
      const keep = P.items.filter((it) => it.n == null || it.n < from);
      P.ended = false;   // (the host ends again once it has made them at the new speed)
      if (keep.length !== P.items.length && P.scheduled) {
        const pos = position();
        P.items = keep;
        P.end = keep.reduce((e, it) => Math.max(e, it.start + it.dur), 0);
        schedule(Math.min(pos, P.end));
      }
      renderDock();
    }

    // ---------- start / stop ----------
    function stop(tell) {
      if (!P) return;
      const was = P;
      stopSources();
      if (tell) d.post({ type: "listenStop", tabId: was.tabId, index: was.index });
      if (ticker != null) { d.stopEvery(ticker); ticker = null; }
      P = null; menu = false;
      light(null);
      renderDock();
      d.rerender(was.index);
    }

    function click(i) {
      const t = d.tab();
      if (!t) return;
      if (mine(i)) return stop(true);   // (the button is a toggle)
      if (P) stop(false);   // (the host stops the other one itself)
      hookScroll();
      const blocks = numberBlocks(answerEl(i));
      P = { tabId: t.id, index: i, phase: blocks.length ? "preparing" : "nothing", items: [], end: 0, from: 0, startedAt: 0, srcs: [], paused: false, ended: false, scheduled: false, gen: 0 };
      if (!blocks.length) { renderDock(); return d.rerender(i); }
      ctx = ctx || new d.AudioContext();
      if (ctx.state === "suspended") ctx.resume();   // (inside the click: the browser lets sound start)
      follow = true; lit = null;
      if (ticker == null) ticker = d.every(tick, 100);
      d.post({ type: "listenStart", tabId: t.id, index: i, blocks });
      renderDock();
      d.rerender(i);
    }

    function pause() {
      if (!P || !ctx) return;
      P.paused = !P.paused;
      if (P.paused) ctx.suspend(); else { ctx.resume(); follow = true; refollow = true; }
      redraw();
    }
    function rewind() {
      if (!P || !P.scheduled) return;
      schedule(Math.max(0, position() - 5));
      follow = true; refollow = true;
      if (P.paused) { P.paused = false; ctx.resume(); redraw(); }
    }

    // ---------- what the chat draws ----------
    function button(m, i) {
      const t = d.tab();
      if (!m || m.role !== "assistant" || m.running || !t || t.visiting) return null;
      const why = t.listenWhy || "", on = mine(i);
      return d.el("button", { class: `msg-act listen-btn${on ? " on" : ""}`, "aria-label": on ? "Stop listening" : "Listen",
        title: why || (on ? "Stop listening" : "Listen\nKural talks you through this answer, in a voice made on this computer. The part it explains is highlighted."),
        disabled: why ? true : null, onclick: () => click(i), onpointerenter: () => d.post({ type: "listenWarm", tabId: t.id }) },
      d.icon(on ? "debug-stop" : "unmute"));
    }

    // The player above the chat box, for the answer being listened to in the chat on screen.
    function renderDock() {
      const show = P && P.tabId === (d.tab() || {}).id;
      dock.classList.toggle("hidden", !show);
      if (!show) return dock.replaceChildren();
      const close = (label = "Close", onclick = () => stop(true)) => d.el("button", { class: "cb x listen-close", title: label, "aria-label": label, onclick }, d.icon("close"));
      const row = (cls, ...kids) => d.el("div", { class: `listen-bar ${cls}`, role: "status", "aria-live": "polite" }, ...kids);
      if (P.phase === "nothing" || P.phase === "error") return dock.replaceChildren(row("err", d.icon("warning"), d.el("span", { class: "listen-text" }, P.phase === "nothing" ? NOTHING : P.message || "Something went wrong."), close()));
      if (P.phase === "ask") {
        return dock.replaceChildren(row("ask", d.icon("unmute"), d.el("span", { class: "listen-text wrap" }, ask(P.size, P.model)),
          d.el("button", { class: "cb primary listen-download", onclick: () => { P.phase = "downloading"; P.pct = 0; d.post({ type: "listenDownload", tabId: P.tabId }); redraw(); } }, "Download"),
          d.el("button", { class: "cb listen-close", onclick: () => stop(true) }, "Cancel")));
      }
      if (P.phase === "downloading") {
        return dock.replaceChildren(row("", d.icon("cloud-download"), d.el("span", { class: "listen-text" }, `Downloading the voice… ${P.pct || 0}%`),
          close("Stop the download", () => { d.post({ type: "listenDownloadStop" }); stop(true); })));
      }
      const label = (v) => `${v}x`;
      const lines = linesFor(P.scheduled ? current() : null);
      dock.replaceChildren(row("player",
        d.el("div", { class: "listen-controls" },
          d.el("button", { class: "cb x listen-pause", title: P.paused ? "Play" : "Pause", "aria-label": P.paused ? "Play" : "Pause", onclick: pause }, d.icon(P.paused ? "play" : "debug-pause")),
          d.el("button", { class: "cb x listen-rewind", title: "Back 5 seconds", "aria-label": "Back 5 seconds", onclick: rewind }, d.icon("history"), d.el("span", { class: "listen-5" }, "5")),
          d.el("button", { class: `cb x listen-speed-btn${menu ? " on" : ""}`, title: "Speed", "aria-label": `Speed ${label(speed)}`, "aria-expanded": menu ? "true" : "false",
            onclick: () => { menu = !menu; renderDock(); } }, label(speed))),
        d.el("div", { class: "listen-lines" },
          d.el("div", { class: "listen-line prev" }, lines[0]), d.el("div", { class: "listen-line cur" }, lines[1]), d.el("div", { class: "listen-line next" }, lines[2])),
        close(),
        menu ? d.el("div", { class: "listen-speeds", role: "menu" }, SPEEDS.map((v) => d.el("button", { class: `cb listen-speed${v === speed ? " on" : ""}`, role: "menuitemradio",
          "aria-checked": v === speed ? "true" : "false", onclick: () => speedTo(v) }, label(v)))) : null));
    }

    // After the chat redraws: the blocks are new elements; tag them again and keep the highlight.
    function retag() {
      if (!P || P.tabId !== (d.tab() || {}).id) return;
      numberBlocks(answerEl(P.index));
      if (lit != null) light(lit, false);
    }

    function onMessage(msg) {
      if (!msg || !/^listen(State|Audio|End)$/.test(msg.type)) return false;
      if (!P || msg.tabId !== P.tabId || (msg.index !== P.index && msg.index !== -1)) return true;
      if (msg.type === "listenAudio") {
        if (ctx) enqueue(msg);
        if (P.phase !== "playing") { P.phase = "playing"; redraw(); }
        return true;
      }
      if (msg.type === "listenEnd") { P.ended = true; P.partial = !!msg.partial; if (!P.items.length) stop(false); return true; }
      switch (msg.phase) {
        case "stopped": stop(false); return true;
        case "ask": Object.assign(P, { phase: "ask", size: msg.size, model: msg.model }); break;
        case "downloading": Object.assign(P, { phase: "downloading", pct: msg.pct }); break;
        case "preparing": if (P.phase !== "playing") P.phase = "preparing"; if (SPEEDS.includes(msg.speed)) speed = msg.speed; break;
        case "playing": P.phase = "playing"; break;
        case "error": stopSources(); Object.assign(P, { phase: "error", message: msg.message }); break;
        default: return true;
      }
      redraw();
      return true;
    }

    // The pane now shows another chat: this one stops.
    function onFull(tabId) { if (P && P.tabId !== tabId) stop(true); }

    return { button, dock, numberBlocks, retag, onMessage, onFull };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = make; else window.KURAL_LISTEN = make;
})();
