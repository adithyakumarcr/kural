// Kural Browser page: an address bar, back/forward/reload, "Select element", and the page in a frame. Talks to
// lib/browser/index.js; the page itself talks to us through the picker the proxy adds to it (media/browser-picker.js).
(function () {
  const vscode = acquireVsCodeApi();
  document.documentElement.style.setProperty("--fs", document.documentElement.dataset.fs || 1);
  const post = (m) => vscode.postMessage(m);
  const app = document.getElementById("app");
  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") n.className = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  }
  const icon = (name) => el("i", { class: `codicon codicon-${name}`, "aria-hidden": "true" });
  const btn = (name, title, f) => el("button", { class: "ib", title, onclick: f }, icon(name));

  const frame = el("iframe", { class: "page", title: "Page" });
  const address = el("input", { class: "addr", spellcheck: "false", placeholder: "localhost:3000", "aria-label": "Address" });
  const pick = el("button", { class: "pick", title: "Select an element on the page to add it to the chat (Esc stops)", onclick: () => setPicking(!picking) }, icon("inspect"), el("span", {}, "Select element"));
  const note = el("div", { class: "note hidden" });
  const toFrame = (m) => frame.contentWindow && frame.contentWindow.postMessage(m, "*");
  app.append(
    el("div", { class: "bar" },
      btn("arrow-left", "Back", () => toFrame({ kuralNav: "back" })),
      btn("arrow-right", "Forward", () => toFrame({ kuralNav: "forward" })),
      btn("refresh", "Reload", () => toFrame({ kuralNav: "reload" })),
      address, pick,
      btn("link-external", "Open in your browser", () => post({ type: "external", url: frame.src }))),
    note, frame);

  let picking = false;
  function setPicking(v) {
    picking = v;
    pick.classList.toggle("on", v);
    toFrame({ kuralPick: v });
    flash(v ? "Click an element on the page. Esc stops." : "");
  }
  let noteTimer = null;
  function flash(text, ms = 0) {
    clearTimeout(noteTimer);
    note.textContent = text; note.classList.toggle("hidden", !text);
    if (text && ms) noteTimer = setTimeout(() => note.classList.add("hidden"), ms);
  }

  address.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); post({ type: "go", url: address.value }); } });

  window.addEventListener("message", (e) => {
    const d = e.data || {};
    // From the page (through the picker): only from our own frame.
    if (d.kural && e.source === frame.contentWindow) {
      if (d.type === "page") post({ type: "page", url: d.url, title: d.title });
      if (d.type === "picked") { picking = false; pick.classList.remove("on"); post({ type: "picked", info: d.info }); flash(`Added ${d.info.short} to the chat.`, 2500); }
      if (d.type === "pickStopped") { picking = false; pick.classList.remove("on"); flash(""); }
      return;
    }
    // From Kural.
    if (d.type === "load") { frame.src = d.src; address.value = d.url; flash(""); }
    if (d.type === "address") { if (document.activeElement !== address) address.value = d.url; }
    if (d.type === "error") flash(d.message, 4000);
  });
  frame.addEventListener("load", () => { if (picking) toFrame({ kuralPick: true }); });
  post({ type: "ready" });
})();
