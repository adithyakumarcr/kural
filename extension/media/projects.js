// The Projects tab's page (lib/projects/index.js): every project with a Kural window, the pinned ones and the recent ones,
// and under an open project each of its chats with what it is doing. It only draws what the host sends ({type: "model"})
// and posts clicks: open, openChat, pin, close, removeRecent, search, fold. The host knows what a click means (the page
// sends keys and ids only). Nothing is built from HTML text: everything is made with el().
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  const setFs = (v) => { if (v) document.documentElement.style.setProperty("--fs", v); };
  setFs(document.documentElement.dataset.fs);
  window.addEventListener("error", (e) => vscode.postMessage({ type: "log", message: `${e.message} (${e.lineno})` }));
  const post = (m) => vscode.postMessage(m);

  const saved = vscode.getState() || {};
  const S = {
    model: null,              // { sections, badge } from the host
    folded: new Set(),        // project keys you folded (the host keeps them)
    q: saved.q || "",
  };

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  }
  // Icons: Codicons (VS Code's icon set, media/codicons). Never emoji.
  const icon = (name, extra) => el("i", { class: `codicon codicon-${name}${extra ? " " + extra : ""}`, "aria-hidden": "true" });

  // ---------- the search box (never redrawn) ----------
  const input = el("input", { class: "q", type: "text", spellcheck: "false", placeholder: "Find a project or chat", "aria-label": "Find a project or chat" });
  input.value = S.q;
  const list = el("div", { class: "plist", role: "tree", "aria-label": "Projects" });
  app.append(el("div", { class: "find" }, el("div", { class: "box" }, icon("search"), input)), list);

  let typing = null;
  const search = () => { S.q = input.value; vscode.setState({ q: S.q }); post({ type: "search", q: S.q }); };
  input.addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(search, 120); });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape" && input.value) { input.value = ""; clearTimeout(typing); search(); } });

  // ---------- pieces ----------
  // A readable letter on any square color (the pastel colors of light themes too).
  function textOn(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "#fff";
    const n = parseInt(m[1], 16), ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2] > 0.4 ? "#1e1e1e" : "#fff";
  }
  function swatch(p) {
    const s = el("span", { class: "sw" }, p.letter || (p.name || "?").charAt(0).toUpperCase());
    if (p.color) { s.style.background = p.color; s.style.color = textOn(p.color); }
    return s;
  }
  // working: spinner; waiting for you: orange dot; finished, not seen: purple dot; else a speech bubble
  function stateIcon(state) {
    if (state === "run") return icon("loading", "spin");
    if (state === "ask") return el("span", { class: "needs", title: "Waiting for you" });
    if (state === "done") return el("span", { class: "dot-done", title: "Finished" });
    return icon("comment-discussion");
  }
  // A button on a row: it never opens the row.
  function rowButton(cls, title, name, fn) {
    return el("button", { class: `tbtn ${cls}`, type: "button", title, "aria-label": title,
      onclick: (e) => { e.stopPropagation(); fn(); } }, icon(name));
  }

  function projectRow(p) {
    const folded = S.folded.has(p.key), chats = p.chats || [];
    const row = el("div", { class: `row${p.here ? " cur" : ""}${p.open ? "" : " recent"}`, role: "treeitem", tabindex: "0", title: p.path || "",
      "data-key": p.key, "aria-expanded": chats.length ? String(!folded) : null,
      onclick: () => post({ type: "open", key: p.key }),
      onkeydown: (e) => { if (e.key === "Enter") post({ type: "open", key: p.key }); } });
    const chev = el("button", { class: `chev${chats.length ? "" : " none"}`, type: "button", tabindex: "-1", "aria-label": folded ? "Unfold" : "Fold",
      onclick: (e) => { e.stopPropagation(); fold(p.key, !folded); } }, icon(folded ? "chevron-right" : "chevron-down"));
    const where = [p.open ? p.branch : "", p.shortPath || ""].filter(Boolean).join(" · ");
    const nm = el("div", { class: "nm" }, el("span", { class: "nmt" }, p.name));
    if (p.here) nm.append(el("span", { class: "here" }, "this window"));
    const end = el("div", { class: "end" });
    // (A folded project carries what its chats would show.)
    if (folded) {
      if (chats.some((c) => c.state === "run")) end.append(icon("loading", "spin"));
      if (chats.some((c) => c.state === "ask")) end.append(el("span", { class: "needs", title: "A chat is waiting for you" }));
    }
    if (p.unseen > 0 && !p.here) end.append(el("span", { class: "badge", title: `${p.unseen} finished and not seen yet` }, String(p.unseen)));
    end.append(rowButton(`pin${p.pinned ? " on" : ""}`, p.pinned ? "Unpin" : "Pin", p.pinned ? "pinned" : "pin", () => post({ type: "pin", key: p.key })));
    // (Open: the red cross; Recent and not pinned: the red bin.)
    if (p.open) end.append(rowButton("red close-p", p.here ? "Close this project (and this window)" : "Close project", "close", () => post({ type: "close", key: p.key })));
    else if (!p.pinned) end.append(rowButton("red bin-p", "Remove from Recent", "trash", () => post({ type: "removeRecent", key: p.key })));
    row.append(chev, swatch(p), el("div", { class: "txt" }, nm, el("div", { class: "sub" }, where)), end);
    return row;
  }

  function chatRow(p, c) {
    const state = c.state || "idle";
    return el("div", { class: `chat-row ${state}${c.onScreen ? " cur-chat" : ""}`, role: "treeitem", tabindex: "0", title: c.title,
      "data-chat": c.id, onclick: () => post({ type: "openChat", key: p.key, chatId: c.id }),
      onkeydown: (e) => { if (e.key === "Enter") post({ type: "openChat", key: p.key, chatId: c.id }); } },
    el("span", { class: "st" }, stateIcon(state)), el("span", { class: "ct" }, c.title), el("span", { class: "cs", title: c.label || "" }, c.label || ""));
  }

  function fold(key, on) {
    if (on) S.folded.add(key); else S.folded.delete(key);
    post({ type: "fold", key, folded: on });
    draw();
  }

  // ---------- the list ----------
  function draw() {
    const sections = ((S.model && S.model.sections) || []).filter((s) => s.projects && s.projects.length);
    const rows = [];
    for (const s of sections) {
      rows.push(el("div", { class: "sec", role: "presentation" }, s.title, " ", el("span", { class: "n" }, String(s.projects.length))));
      for (const p of s.projects) {
        rows.push(projectRow(p));
        if (!S.folded.has(p.key)) for (const c of p.chats || []) rows.push(chatRow(p, c));
      }
    }
    if (!rows.length && S.model) {
      rows.push(el("div", { class: "empty" }, S.q ? `Nothing matches "${S.q}".` : "No projects yet. Use + above to open a folder, clone a repository or start a new project."));
    }
    list.replaceChildren(...rows);
  }

  window.addEventListener("message", (e) => {
    const m = e.data || {};
    if (m.type === "fontScale") setFs(m.value);
    else if (m.type === "model") {
      S.model = m;
      S.folded = new Set(m.folded || []);
      // (What the host searched for; the box is left alone while you type.)
      if (typeof m.query === "string" && m.query !== input.value && document.activeElement !== input) { input.value = m.query; S.q = m.query; }
      draw();
    }
  });
  post({ type: "ready", q: S.q });
})();
