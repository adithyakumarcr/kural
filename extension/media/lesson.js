// Kural's lesson pages (Learn mood): the slide runtime added to every lesson (lib/learn/server.js). Slides are
// <section class="slide"> (no slides: the whole page is one). Arrows, Space, Page Up/Down, the dots and the buttons move;
// a slide's .reveal items appear one per "next" first. Select text, or click a visual marked data-concept, and
// "Add to chat" puts it into the chat's message box (POST ./add). The page reloads itself when the AI changes the file,
// staying on its slide (#3).
(() => {
  const base = location.pathname.replace(/[^/]*$/, "");   // /<token>/<chat>/
  const file = decodeURIComponent(location.pathname.slice(base.length));
  const svg = (d) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };

  let slides = [...document.querySelectorAll("section.slide, .slide")].filter((s, i, all) => !all.some((o) => o !== s && o.contains(s)));
  if (!slides.length) {
    const one = el("section", "slide");
    while (document.body.firstChild) one.appendChild(document.body.firstChild);
    document.body.appendChild(one);
    slides = [one];
  }
  document.body.classList.add("kl-deck");
  if (!document.title) { const h = document.querySelector("h1, h2"); if (h) document.title = h.textContent.trim(); }

  const progress = el("div", "kl-progress");
  const bar = el("nav", "kl-bar");
  const prev = el("button", "", svg("M15 18l-6-6 6-6")); prev.title = "Back (Left arrow)"; prev.setAttribute("aria-label", "Back");
  const next = el("button", "", svg("M9 18l6-6-6-6")); next.title = "Next (Right arrow)"; next.setAttribute("aria-label", "Next");
  const dots = el("div", "kl-dots");
  const count = el("span", "kl-count");
  slides.forEach((s, i) => { const d = el("span", "kl-dot"); d.title = titleOf(s) || `Slide ${i + 1}`; d.onclick = () => go(i); dots.appendChild(d); });
  bar.append(prev, dots, next, count);
  document.body.append(progress, bar);

  function titleOf(s) { const h = s.querySelector("h1, h2, h3"); return h ? h.textContent.trim().slice(0, 100) : ""; }
  let at = Math.min(slides.length - 1, Math.max(0, (parseInt(location.hash.slice(1), 10) || 1) - 1));
  function go(i, back = false) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((s, k) => { s.classList.toggle("kl-on", k === i); s.classList.toggle("kl-back", k < i); s.classList.remove("kl-enter"); s.setAttribute("aria-hidden", k === i ? "false" : "true"); });
    if (i !== at) { void slides[i].offsetWidth; slides[i].classList.add("kl-enter"); }   // (its parts come in one after another)
    // Coming back shows the slide whole; going forward starts its reveal steps again.
    slides[i].querySelectorAll(".reveal").forEach((r) => r.classList.toggle("kl-shown", back));
    [...dots.children].forEach((d, k) => d.classList.toggle("kl-on", k === i));
    count.textContent = `${i + 1} / ${slides.length}`;
    prev.disabled = i === 0; next.disabled = i === slides.length - 1 && !slides[i].querySelector(".reveal:not(.kl-shown)");
    progress.style.width = `${((i + 1) / slides.length) * 100}%`;
    at = i;
    history.replaceState(null, "", `#${i + 1}`);
    hideAdd();
  }
  function forward() {
    const r = slides[at].querySelector(".reveal:not(.kl-shown)");
    if (r) { r.classList.add("kl-shown"); next.disabled = at === slides.length - 1 && !slides[at].querySelector(".reveal:not(.kl-shown)"); return; }
    if (at < slides.length - 1) go(at + 1);
  }
  prev.onclick = () => go(at - 1, true);
  next.onclick = forward;
  addEventListener("keydown", (e) => {
    if (e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
    if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); forward(); }
    else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); go(at - 1, true); }
    else if (e.key === "Home") go(0); else if (e.key === "End") go(slides.length - 1, true);
    else if (e.key === "Escape") hideAdd();
  });

  // ---------- Add to chat ----------
  const add = el("button", "kl-add", `${svg("M12 5v14M5 12h14")}<span>Add to chat</span>`);
  const toast = el("div", "kl-toast");
  document.body.append(add, toast);
  let pending = null;
  function hideAdd() { add.classList.remove("kl-show"); pending = null; }
  function showAdd(x, y, item) {
    pending = item;
    add.classList.add("kl-show");
    const w = add.offsetWidth, h = add.offsetHeight;
    add.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, x - w / 2))}px`;
    add.style.top = `${y - h - 10 < 8 ? y + 14 : y - h - 10}px`;
  }
  function slideOf(node) { const s = slides.findIndex((x) => x.contains(node)); return s < 0 ? at : s; }
  function say(text) { toast.textContent = text; toast.classList.add("kl-show"); clearTimeout(say.t); say.t = setTimeout(() => toast.classList.remove("kl-show"), 1800); }

  add.addEventListener("mousedown", (e) => e.preventDefault());   // (keep the selection)
  add.onclick = async () => {
    if (!pending) return;
    const item = pending; hideAdd();
    try {
      const r = await fetch(`${base}add`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
      say(r.ok ? "Added to the chat. Ask your question there." : "Couldn't add it: is the chat still open?");
      if (r.ok) { const s = getSelection(); if (s) s.removeAllRanges(); }
    } catch { say("Couldn't reach Kural."); }
  };
  document.addEventListener("mouseup", (e) => {
    if (add.contains(e.target) || bar.contains(e.target)) return;
    setTimeout(() => {
      const s = getSelection(), text = s ? s.toString().trim() : "";
      if (text) {
        const r = s.getRangeAt(0).getBoundingClientRect(), i = slideOf(s.anchorNode);
        showAdd(r.left + r.width / 2, r.top, { text, slide: i + 1, title: titleOf(slides[i]) });
        return;
      }
      const c = e.target.closest && e.target.closest("[data-concept]");
      if (c) {
        const r = c.getBoundingClientRect(), i = slideOf(c);
        const said = (c.getAttribute("aria-label") || c.getAttribute("alt") || c.textContent || "").replace(/\s+/g, " ").trim().slice(0, 600);
        showAdd(r.left + r.width / 2, r.top, { concept: c.getAttribute("data-concept"), text: said, slide: i + 1, title: titleOf(slides[i]) });
        return;
      }
      hideAdd();
    }, 0);
  });

  go(at, true);
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("kl-live")));

  // ---------- reload when the AI changes the lesson ----------
  let seen = null;
  setInterval(async () => {
    if (document.hidden) return;
    try {
      const r = await fetch(`${base}__v?f=${encodeURIComponent(file)}`, { cache: "no-store" });
      const { t } = await r.json();
      if (seen === null) seen = t; else if (t && t !== seen) location.reload();
    } catch { /* Kural closed: stay as it is */ }
  }, 1000);
})();
