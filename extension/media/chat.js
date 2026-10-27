// The Kural chat panel UI. A small web page inside the editor that talks to
// lib/chat.js through postMessage. No outside libraries, so it works offline.
// One chat, drawn into `app` (a column of the page: media/chat-columns.js shows one or more side by side). `port` is
// its line to lib/chat: post (a message from this column), active (it has the keyboard), the tab drag, split.
window.KURAL_CHAT = function (app, port) {
  // Listeners on the whole page end with the column (`on`); the column's own elements go with it.
  const off = new AbortController(), on = { signal: off.signal };

  const S = {
    tabs: [], activeId: null, tab: null,
    models: [], efforts: [], modes: [], version: "",
    attachments: [], setups: {},
    shortcuts: [],   // your shortcuts [{ name, text }] (Kural Settings → Shortcuts; lib/chat/shortcuts.js)
    slash: {},    // tab id -> { items: [{ name, description, hint, aliases, builtin }], why? }: the "/" list (lib/chat/slash.js)
    files: [], popup: null, menu: null,
    history: [], showHistory: false, historyQuery: "", historyScope: "all", hereName: "", confirmDelete: null, renaming: null,
  };

  // ---------- helpers ----------
  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") n.className = v;
      // (Through the style object: the page's rules (CSP) block a style="…" attribute, so a bar's width set that way was
      // ignored and every bar showed full.)
      else if (k === "style") n.style.cssText = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  }
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const base = (p) => (p || "").split("/").pop();
  const dir = (p) => { const i = (p || "").lastIndexOf("/"); return i > 0 ? p.slice(0, i) : ""; };
  const post = (m) => port.post(m);
  // "Sonnet", or for a model on this computer (Ollama) "qwen3-coder:30b · local".
  // "opus" → "Opus"; "ollama:qwen3:8b" → "qwen3:8b · local"; "codex:gpt-6.1-sol" → its name in Codex's list.
  const modelLabel = (id) => {
    if (/^ollama:/.test(id || "")) return `${id.slice(7)} · local`;
    const c = /^([a-z]+):(.*)$/.exec(id || "");
    if (c && !(S.clis || []).some((x) => x.id === c[1])) return id;
    if (c) {
      const cli = (S.clis || []).find((x) => x.id === c[1]) || { short: c[1], models: [] };
      const m = cli.models.find((x) => x.id === c[2]);
      return c[2] === "default" ? `${cli.short} (default)` : m ? m.label : c[2];
    }
    return (S.models.find((m) => m.id === id) || { label: id || "?" }).label;
  };
  const gb = (bytes) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
  const moodLabel = (id) => (S.moods.find((m) => m.id === id) || { label: "" }).label;
  const effortLabel = (id) => (S.efforts.find((e) => e.id === id) || { label: "Medium" }).label;
  const modeLabel = (id) => (S.modes.find((m) => m.id === id) || { label: "Agent" }).label;
  const pillLabel = (c) => c.kind === "shortcut" ? `/${c.name}` : c.kind === "selection" ? `${base(c.path)} (L${c.startLine}-${c.endLine})` : c.kind === "element" || c.kind === "quote" ? c.label : base(c.path);
  // Show ⌘ instead of Ctrl on a Mac.
  const MAC = /Mac/i.test(navigator.platform || navigator.userAgent);
  // "Ctrl+" is ⌘ on a Mac; "Control+" means the Control key everywhere (⌃ on a Mac).
  const keys = (k) => MAC ? k.replace(/Control\+/g, "⌃").replace(/Ctrl\+/g, "⌘").replace(/Alt\+/g, "⌥") : k.replace(/Control\+/g, "Ctrl+");

  // Icons: Codicons (VS Code's own icon set, media/codicons), so Kural looks like the editor around it. Never emoji.
  const ICON_ALIAS = { clock: "history", plus: "add" };
  // Text from elsewhere (model descriptions from ollama.com…) without emoji: Kural shows icons from one set only.
  const noEmoji = (s) => String(s || "").replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu, "").replace(/\s{2,}/g, " ").trim();
  // "Back" at the top left of a page that covers the chat (History, Models on this computer): a real button, easy to see.
  const backBtn = (onclick, title = "Back to the chat") => el("button", { class: "back-btn", title, onclick: () => onclick() }, icon("arrow-left"), " Back");
  const icon = (name, cls = "") => el("i", { class: `codicon codicon-${ICON_ALIAS[name] || name}${cls ? ` ${cls}` : ""}`, "aria-hidden": "true" });

  function ago(t) {
    const s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return "just now";
    const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24); if (d < 7) return `${d} d ago`;
    return new Date(t).toLocaleDateString();
  }

  // ---------- tiny markdown (with tables) ----------
  // A picture's address for this page: a file (absolute, or relative to the project) becomes the editor's own
  // address for it; data:image/… stays; a web address returns null (shown as "Load image", see inline()).
  function fileSrc(p) {
    p = String(p || "").trim();
    if (/^data:image\/[a-z+.-]+;base64,/i.test(p)) return p;
    if (/^[a-z][a-z0-9+.-]*:/i.test(p) && !/^[A-Za-z]:[\\/]/.test(p) && !/^file:/i.test(p)) return null;   // http(s) and other schemes
    const F = S.pics || {};   // { base, root } (from the extension: filesFor)
    let abs = p.replace(/^file:\/\//i, "").replace(/\\/g, "/");
    if (/^~\//.test(abs) && F.home) abs = String(F.home).replace(/\\/g, "/").replace(/\/$/, "") + abs.slice(1);
    if (!/^\//.test(abs) && !/^[A-Za-z]:\//.test(abs)) abs = `${String(F.root || "").replace(/\\/g, "/").replace(/\/$/, "")}/${abs.replace(/^\.\//, "")}`;
    if (/^[A-Za-z]:\//.test(abs)) abs = `/${abs[0].toLowerCase()}:${abs.slice(2)}`;   // C:/x → /c:/x (Windows)
    return F.base ? F.base + abs.split("/").map((x, i) => i === 0 ? x : encodeURIComponent(x)).join("/") : null;
  }
  const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
  // ![alt](src) → the picture. A web picture waits for a click: loading it would tell that website you read this (a
  // model can be tricked into writing a picture link that carries your data away).
  function imageHtml(alt, src) {
    const raw = src.replace(/&amp;/g, "&");
    const local = fileSrc(raw);
    if (local) return `<img class="md-img" src="${esc(local)}" data-path="${esc(raw)}" alt="${alt}" title="${alt ? `${alt} · ` : ""}Click to open it full size">`;
    if (/^https?:\/\//i.test(raw)) {
      let host = ""; try { host = new URL(raw).host; } catch { /* not a URL */ }
      return `<span class="img-remote" data-url="${esc(raw)}" data-alt="${alt}" title="${esc(raw)}">Load image${host ? ` from ${esc(host)}` : ""}</span>`;
    }
    return `<span class="img-missing">${alt || "image"}</span>`;
  }

  // A link to a file the model wrote, [install.sh](install.sh) or [app.js:12](src/app.js#L12): opens the file (at the
  // line). (Before, only web links were clickable and these showed as plain text.)
  function fileLink(text, url) {
    let p = url.replace(/&amp;/g, "&").replace(/^file:\/\//i, "");
    try { p = decodeURIComponent(p); } catch { /* keep it as written */ }
    if (/^[a-z][a-z0-9+.-]*:/i.test(p) && !/^[A-Za-z]:[\\/]/.test(p)) return `<span class="link">${text}</span>`;   // mailto: etc.
    let line = "", end = "";
    const h = /#L(\d+)(?:-L?(\d+))?$/.exec(p) || /:(\d+)(?:-(\d+))?(?::\d+)?$/.exec(p);
    if (h) { line = h[1]; end = h[2] || ""; p = p.slice(0, h.index); }
    if (!p) return `<span class="link">${text}</span>`;
    return `<a class="link file" data-path="${esc(p)}" data-line="${line}" data-end="${end}" title="Open ${esc(p)}${line ? `:${line}` : ""}">${text}</a>`;
  }

  // Each piece of HTML made here (code, picture, link) is put aside as a placeholder (\0N\0) at once, so the later rules
  // only see text, never the HTML (they used to rewrite a picture's alt="…" and break out of the attribute). Code first:
  // nothing inside `code` is markdown. A placeholder can't be inside an attribute (alt and addresses exclude \0).
  function inline(s) {
    const keep = [], put = (html) => `\u0000${keep.push(html) - 1}\u0000`;
    const emph = (x) => x.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>").replace(/~~([^~]+)~~/g, "<del>$1</del>");
    const t = esc(String(s).replace(/\u0000/g, ""))
      .replace(/`([^`]+)`/g, (_, c) => {
        const m = c.match(/^([\w./-]+\.[A-Za-z0-9]+)(?::(\d+)(?:-(\d+))?)?$/);
        return put(m ? `<code class="ref" data-path="${m[1]}" data-line="${m[2] || ""}">${c}</code>` : `<code>${c}</code>`);
      })
      .replace(/!\[([^\]\u0000]*)\]\(([^)\s\u0000]+)(?:\s+&quot;[^)\u0000]*&quot;)?\)/g, (_, alt, src) => put(imageHtml(alt, src)))
      .replace(/\[([^\]]+)\]\(([^)\s\u0000]+)\)/g, (_, text, url) => put(/^https?:\/\//.test(url)
        ? `<a class="link" data-url="${url}" title="${url}">${emph(text)}</a>` : fileLink(emph(text), url)))
      // A bare web address: clickable too (code, links and pictures are placeholders by now).
      .replace(/(^|[\s(>*])(https?:\/\/[^\s<"\u0000]+[^\s<".,:;!?)\]'*\u0000])/g, (_, pre, u) => pre + put(`<a class="link" data-url="${u}">${u}</a>`))
      .replace(/(^|[\s(>*])(www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<"\u0000]*[^\s<".,:;!?)\]'*\u0000])?)/gi, (_, pre, u) => pre + put(`<a class="link" data-url="https://${u}">${u}</a>`));
    let out = emph(t);
    for (let i = 0; i < 4 && out.includes("\u0000"); i++) out = out.replace(/\u0000(\d+)\u0000/g, (_, n) => keep[n] || "");
    return out;
  }

  // Answers are drawn by media/markdown.js (Calm reading): blocks from the Markdown, then the page from them with el(),
  // text through inline() above. A file chip in a numbered step opens the file.
  const md = window.KURAL_MARKDOWN({ el, inline, codeCard, icon, onFile: (p) => post({ type: "openFile", path: p }) });
  // How it worked (thoughts between its steps): media/timeline.js.
  const timeline = window.KURAL_TIMELINE({ el, icon });
  // Questions: pick, then Send; Ask about this question (media/choices.js).
  const choices = window.KURAL_CHOICES({ el, icon, post, tab: () => S.tab, markdown: (t, f) => md.markdown(t, f), onChange: () => renderPending(),
    sendText: (t, picks) => sendText(t, picks) });
  // Parallel agents: the model menu's section and the plan card (media/split.js).
  const split = window.KURAL_SPLIT({ el, icon, post, tab: () => S.tab, markdown: (t, f) => md.markdown(t, f), claudeModels: () => S.models, clis: () => S.clis });

  // ---------- code colors ----------
  // A small, any-language highlighter for code in answers: comments, strings, numbers, keywords, function names, types,
  // in VS Code's Dark+ / Light+ colors (chat.css .tk-*). It makes text nodes and spans only (never HTML from the answer).
  const KW_DECL = new Set(("const let var function func fn def class struct enum interface type public private protected static " +
    "async new extends implements package namespace module void int float double char bool boolean string long short unsigned " +
    "signed byte auto final abstract readonly declare lambda local mut pub impl trait use crate typeof instanceof delete sizeof " +
    "val object override virtual extern volatile register inline constexpr template typename defer go chan map select " +
    "export echo set unset alias source").split(" "));
  const KW_CTRL = new Set(("if else elif for while do switch case default break continue return throw throws try catch finally " +
    "except raise with as from import yield await goto match when then fi esac done unless until loop pass in of and or not is " +
    "foreach elseif endif require include").split(" "));
  const KW_LANG = new Set("true false null None True False undefined nil this self super NaN Infinity".split(" "));
  const HASH_LANGS = /^(py|python|sh|bash|zsh|shell|console|ruby|rb|yaml|yml|toml|r|perl|pl|makefile|make|dockerfile|conf|ini|cmake|nim|elixir|ex|powershell|ps1|coffee|graphql|gql|tf|hcl)$/i;
  const DASH_LANGS = /^(sql|lua|haskell|hs|elm|ada)$/i;
  const MARKUP_LANGS = /^(html|xml|svg|vue|svelte|jsx|tsx)$/i;
  const SHELL_LANGS = /^(sh|bash|zsh|shell|console|terminal|shellsession|shell-session)$/i;
  // The assistant often leaves the language off ("code"): such a block is a terminal command when every line starts like one.
  const COMMANDS = /^(\$ )?(git|npm|npx|pnpm|yarn|node|python3?|pip3?|brew|cd|ls|cat|echo|export|mkdir|rm|mv|cp|touch|chmod|sudo|curl|wget|docker|kubectl|make|cargo|go|java|mvn|gradle|gh|ssh|scp|tar|unzip|grep|rg|sed|awk|find|open|code|source|\.\/|bash|sh|zsh|apt|apt-get|pkexec|kill|pkill|tccutil|dpkg|xcode-select|swift|ruby|gem|bundle|dotnet|npm run)(\s|$)/;
  function isShellBlock(lang, code, file) {
    if (file) return false;
    if (lang) return SHELL_LANGS.test(lang);
    const lines = code.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    if (!lines.length) return false;
    let more = false;   // the line before ended in "\" or an operator: this one continues it
    for (const l of lines) {
      if (!more && !COMMANDS.test(l)) return false;
      more = /(\\|&&|\|\||\|)$/.test(l);
    }
    return true;
  }
  const PLAIN_LANGS = /^(text|txt|plain|plaintext|output|log|diff|patch)$/i;
  // (# starts a comment only at the start of a word: "https://x.com/#a" isn't one. A ' with no closing ' on its line
  // isn't a string: Rust's 'a, "can't" in a sentence.)
  const R_SLASH = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/.source, R_HASH = /(?<!\S)#[^\n]*/.source, R_DASH = /--[^\n]*/.source,
    R_HTMLC = /<!--[\s\S]*?(?:-->|$)/.source;
  const R_STR = /"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|`(?:\\.|[^`\\])*`?/.source;
  const R_SQ = /(?<!\w)(?:[fFrRbBuU]{1,2}(?='))?'(?:\\.|[^'\\\n])*'/.source, R_SQ_RUST = /'(?:\\.|[^'\\\n])'/.source;
  const R_NUM = /\b0[xX][\da-fA-F_]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b/.source;
  const R_TAG = /<\/?[A-Za-z][\w:-]*/.source, R_WORD = /([A-Za-z_$][\w$]*)(\s*\()?/.source;
  function highlight(code, lang) {
    lang = String(lang || "");
    if (code.length > 60000 || PLAIN_LANGS.test(lang)) return [code];
    // No language given: # starts a comment when the code looks like a script (no // in it).
    const hash = HASH_LANGS.test(lang) || (!lang && /^\s*#(?!include|define|!)/m.test(code) && !/\/\//.test(code));
    const markup = MARKUP_LANGS.test(lang);
    const comment = [hash ? null : R_SLASH, hash ? R_HASH : null, DASH_LANGS.test(lang) ? R_DASH : null, markup ? R_HTMLC : null].filter(Boolean).join("|");
    // (Rust: 'a is a lifetime, so a ' string is one character: 'x', '\n'.)
    const str = `${R_STR}|${/^(rust|rs)$/i.test(lang) ? R_SQ_RUST : R_SQ}`;
    const re = new RegExp(`(${comment})|(${str})|(${R_NUM})|(${markup ? R_TAG : "(?!)"})|${R_WORD}`, "g");
    const out = [];
    let last = 0, m;
    const add = (cls, t) => out.push(el("span", { class: cls }, t));
    while ((m = re.exec(code))) {
      if (!m[0]) { re.lastIndex++; continue; }
      if (m.index > last) out.push(code.slice(last, m.index));
      const t = m[5] || m[0];
      if (m[1]) add("tk-c", t);
      else if (m[2]) add("tk-s", t);
      else if (m[3]) add("tk-n", t);
      else if (m[4]) add("tk-tag", t);
      else if (KW_LANG.has(t)) add("tk-l", t);
      else if (KW_CTRL.has(t)) add("tk-x", t);
      else if (KW_DECL.has(t)) add("tk-k", t);
      else if (m[6]) add("tk-f", t);
      else if (/^[A-Z][a-z]\w*$/.test(t) && !SHELL_LANGS.test(lang)) add("tk-t", t);
      else out.push(t);
      if (m[6]) out.push(m[6]);   // (the "(" after a function name)
      last = re.lastIndex;
    }
    if (last < code.length) out.push(code.slice(last));
    return out;
  }

  function codeCard(info, code, done) {
    const lang = (info.split(/\s+/)[0] || "").replace(/^path=.*/, "");
    const pm = info.match(/path=(\S+)/), file = pm ? pm[1] : null;
    const btn = (label, title, onclick, cls) => el("button", { class: `cb ${cls || ""}`, title, onclick, disabled: !done }, label);
    // (A diagram is drawn once its block is complete; while it streams in it's code like any other.)
    if (/^mermaid$/i.test(lang) && done && window.KURAL_MERMAID) return mermaidCard(code, btn);
    const shell = isShellBlock(lang, code, file);
    return el("div", { class: "code" },
      el("div", { class: "code-head" },
        file ? el("span", { class: "code-file", title: "Open file", onclick: () => post({ type: "openFile", path: file }) }, file)
          : el("span", { class: "code-lang" }, lang || "code"),
        el("span", { class: "spacer" }),
        btn("Copy", "Copy to clipboard", () => post({ type: "copy", code })),
        // A terminal command goes to the terminal (typed, not run); Apply makes no sense for it.
        shell
          ? btn("Terminal", "Paste into the terminal (you press Enter to run it)", () => post({ type: "terminal", code: code.replace(/^\$ /gm, "") }), "primary")
          : [btn("Insert", "Insert at the cursor", () => post({ type: "insert", code })),
            btn("Apply", file ? `Apply to ${file} and review` : "Apply to the open file and review", () => post({ type: "apply", code, path: file }), "primary")]),
      el("pre", {}, el("code", {}, highlight(code, lang))));
  }

  // A ```mermaid block: the diagram (a picture: media/mermaid-view.js), Code shows the text instead. A diagram Mermaid
  // can't draw shows its code and why. Click the picture: full size in a tab.
  function mermaidCard(code, btn) {
    const view = el("div", { class: "mm-view" }, el("span", { class: "mm-note" }, "Drawing the diagram…"));
    const card = el("div", { class: "code mermaid" });
    const toggle = btn("Code", "Show the diagram's Mermaid code", () => {
      const showCode = card.classList.toggle("show-code");
      toggle.textContent = showCode ? "Diagram" : "Code";
      toggle.title = showCode ? "Show the diagram" : "Show the diagram's Mermaid code";
    });
    card.append(
      el("div", { class: "code-head" }, el("span", { class: "code-lang" }, "mermaid"), el("span", { class: "spacer" }),
        btn("Copy", "Copy the Mermaid code", () => post({ type: "copy", code })), toggle),
      view,
      el("pre", { class: "mm-code" }, el("code", {}, code)));
    window.KURAL_MERMAID.draw(code).then((r) => {
      if (r.error) {
        card.classList.add("show-code", "mm-failed");
        view.replaceChildren(el("span", { class: "mm-note mm-err" }, `Couldn't draw this diagram: ${r.error}`));
        toggle.remove();
        return;
      }
      view.replaceChildren(el("img", { class: "mm-img", src: r.src, width: r.w, height: r.h, alt: "Diagram",
        title: "Click to open it full size", onclick: () => post({ type: "openImage", url: r.src }) }));
    });
    return card;
  }

  // ---------- layout ----------
  const tabsEl = el("div", { class: "tabs" });
  const historyBtn = el("button", { class: "icon-btn", title: "All chats (history)", onclick: () => toggleHistory() }, icon("clock"));
  // "+" and the clock stay put; only the tabs scroll (mouse wheel scrolls them sideways).
  const newTabBtn = el("button", { class: "tab-new", title: keys("New chat (Ctrl+Alt+N)"), onclick: () => { S.focusNext = true; closeHistory(); post({ type: "newTab" }); } }, icon("plus"));
  // Split: a new chat beside this one, in this panel when it's wide enough (maximized), else beside the code.
  const NO_ROOM = "No room for another chat side by side: close one (its ×), or drag a tab out of this panel";
  const splitBtn = el("button", { class: "icon-btn", "aria-label": "Split",
    onmouseenter: () => { splitBtn.title = port.canSplit() ? "Split: a new chat beside this one (or drag a tab to a side of the chat)" : port.full() ? NO_ROOM : "Open a new chat beside the code (or drag a tab out of this panel)"; },
    onclick: () => { closeHistory(); if (!port.split()) flash(NO_ROOM, 2600); } }, icon("split-horizontal"));
  // Kural Settings and "…" live here too (they were in the panel's title bar, with a second "+": Adithya, one place).
  const settingsBtn = el("button", { class: "icon-btn", title: "Kural Settings", onclick: () => { closeHistory(); post({ type: "panelCommand", what: "settings" }); } }, icon("settings-gear"));
  const moreBtn = el("button", { class: "icon-btn", title: "More", onclick: (e) => openMenu("more", e.currentTarget) }, icon("ellipsis"));
  const tabBar = el("div", { class: "tabbar" }, tabsEl, newTabBtn, splitBtn, historyBtn, settingsBtn, moreBtn);
  tabsEl.addEventListener("wheel", (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { tabsEl.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  // A chat in a column of its own (split): its title instead of the tab bar. Drag the title to move it; × puts it back
  // among the tabs.
  const colHead = el("div", { class: "col-head hidden", draggable: "true",
    ondragstart: (e) => S.tab ? port.dragStart(e, { id: S.tab.id, title: S.tab.title }) : e.preventDefault(), ondragend: (e) => port.dragEnd(e) });
  const listEl = el("div", { class: "list" });
  // Follow new text only while you're at the bottom. Scrolled up to read? It stays put, and "Jump to latest" appears.
  let stick = true;
  const jumpBtn = el("button", { class: "jump hidden", title: "Jump to the latest", onclick: () => { stick = true; toBottom(); } }, icon("arrow-down"), " Latest");
  const atBottom = () => listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 24;
  const toBottom = () => { listEl.scrollTop = listEl.scrollHeight; jumpBtn.classList.add("hidden"); };
  const follow = () => { if (stick) toBottom(); else jumpBtn.classList.remove("hidden"); };
  listEl.addEventListener("scroll", () => { stick = atBottom(); if (stick) jumpBtn.classList.add("hidden"); });
  // How tall a running timeline may grow: the chat's visible height, less room for the message above it and the answer's
  // first lines (chat.css .thv.live .tbox). Per column: stacked columns are shorter.
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => {
    if (listEl.clientHeight) listEl.style.setProperty("--tl-max", `${Math.max(300, listEl.clientHeight - 140)}px`);
  }).observe(listEl);
  const historyEl = el("div", { class: "history hidden" });
  const localEl = el("div", { class: "history local hidden" });   // "Local models": search, download, use
  const chipsEl = el("div", { class: "chips" });
  const input = el("div", { class: "input", contenteditable: "plaintext-only", role: "textbox", "aria-multiline": "true", "data-placeholder": "" });
  const popupEl = el("div", { class: "popup hidden" });
  const menuEl = el("div", { class: "menu hidden" });
  const modeBtn = el("button", { class: "pick mode-pick", title: "Mode", onclick: (e) => openMenu("mode", e.currentTarget) });
  const modelBtn = el("button", { class: "pick", title: "Model, intensity and parallel agents", onclick: (e) => openMenu("model", e.currentTarget) });
  const sendBtn = el("button", { class: "send", onclick: () => sendOrStop() });
  // While an answer runs and you've typed something: send it to the queue (the button beside it is Stop).
  const queueBtn = el("button", { class: "send queue-send hidden", title: "Send (Enter): Kural adds it to the answer at its next step, or answers it next",
    onclick: () => sendMessage() }, icon("arrow-up"));
  // Messages you sent while it answered that it hasn't taken in yet.
  const queueEl = el("div", { class: "queue hidden" });
  // How full this chat's context window is (a ring + "38k"), and on hover this chat's tokens (read, from cache, written).
  const ctxEl = el("button", { class: "ctx-meter hidden", "aria-label": "Open AI Usage", onclick: () => post({ type: "showUsage" }) });
  const attachBtn = el("button", { class: "attach", title: "Add files, pick an element from your app in a browser, link a Jira ticket or a device (SSH). You can also paste a screenshot.", onclick: () => openMenu("add", attachBtn) }, icon("plus"));
  const editBar = el("div", { class: "edit-bar hidden" });   // "Editing an earlier message …" (startEdit)
  // Enhance prompt (lib/enhance): what it's doing while it looks through the project, then Undo; or what went wrong.
  const enhanceBar = el("div", { class: "enh-bar hidden", role: "status", "aria-live": "polite" });
  const enhanceBtn = el("button", { class: "enhance-btn", "aria-label": "Enhance prompt",
    title: "Enhance prompt\nA quicker model (Claude Sonnet, or ChatGPT's or Gemini's equivalent) looks through this project, read only, and rewrites what you typed into a clearer prompt with pointers to the right files. You check it, then send.",
    onclick: () => startEnhance() }, icon("wand"));
  // Voice input (media/voice.js + lib/voice): the mic beside the wand. What you said goes in at the cursor.
  const voice = window.KURAL_VOICE({ el, icon, post, tab: () => S.tab, insertText: insertVoiceText, now: () => Date.now(),
    every: (fn, ms) => setInterval(fn, ms), stopEvery: (id) => clearInterval(id), isMac: /Mac/i.test(navigator.platform || navigator.userAgent),
    media: { getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c), MediaRecorder: window.MediaRecorder,
      AudioContext: window.AudioContext, OfflineAudioContext: window.OfflineAudioContext } });
  const pendingEl = el("div", { class: "answer-slot" });   // "Your answer: … (press Send)" while something is picked (renderPending)
  const composer = el("div", { class: "composer" }, popupEl, queueEl, editBar, enhanceBar, voice.bar, pendingEl, chipsEl, input,
    el("div", { class: "foot" }, attachBtn, modeBtn, modelBtn, el("span", { class: "spacer" }), ctxEl,
      voice.button, enhanceBtn, queueBtn, sendBtn));   // (type @ to mention a project file; + attaches anything)
  // A chat from another workspace: read it here; to go on, open its folder or continue it here.
  const visitBar = el("div", { class: "visit hidden" });
  const body = el("div", { class: "body" }, listEl, historyEl, localEl, jumpBtn);
  app.replaceChildren(tabBar, colHead, body, visitBar, composer, menuEl);

  // ---------- tabs ----------
  const lastClick = { id: null, at: 0 };
  function renderTabs() {
    tabsEl.replaceChildren(
      ...S.tabs.map((t) => {
        if (S.renaming === t.id) {
          const box = el("input", { class: "tab-rename", value: t.title, maxlength: "60",
            onkeydown: (e) => {
              if (e.key === "Enter") { e.preventDefault(); finishRename(t.id, box.value); }
              if (e.key === "Escape") { e.preventDefault(); S.renaming = null; renderTabs(); input.focus(); }
            },
            onblur: () => finishRename(t.id, box.value) });
          setTimeout(() => { box.focus(); box.select(); }, 0);
          return el("div", { class: "tab active renaming" }, box);
        }
        return el("div", {
          class: `tab ${t.id === S.activeId ? "active" : ""} ${t.status} ${t.unread ? "unread" : ""}`,
          title: `${t.title}\n${modelLabel(t.model)} · ${effortLabel(t.effort)} · ${modeLabel(t.mode)}${t.splitOn ? " · parallel agents" : ""}\nDouble-click to rename`,
          // Two clicks on the same tab within 450 ms = rename. (Detected by hand: switching tabs
          // redraws the tab strip, so the browser's own double-click event never arrives.)
          onclick: () => {
            const now = Date.now(), again = lastClick.id === t.id && now - lastClick.at < 450;
            lastClick.id = t.id; lastClick.at = now;
            if (again) { S.renaming = t.id; renderTabs(); return; }
            closeHistory();
            if (t.id !== S.activeId) { S.focusNext = true; post({ type: "switchTab", id: t.id }); }
          },
          onauxclick: (e) => { if (e.button === 1) post({ type: "closeTab", id: t.id }); },
          // Drag a tab to a side of the chat (split), or out of the panel: it opens beside the code (media/chat-columns.js).
          draggable: "true",
          ondragstart: (e) => port.dragStart(e, { id: t.id, title: t.title }),
          ondragend: (e) => port.dragEnd(e),
        },
        el("span", { class: "dot" }),
        el("span", { class: "tab-title" }, t.title),
        el("button", { class: "tab-x", title: "Close (stays in history)", onclick: (e) => { e.stopPropagation(); post({ type: "closeTab", id: t.id }); } }, icon("close")));
      }));
    const a = tabsEl.querySelector(".tab.active");
    if (a) a.scrollIntoView({ block: "nearest", inline: "nearest" });
    const t = S.tabs.find((x) => x.id === S.activeId);
    if (t) colHead.replaceChildren(el("span", { class: `col-dot ${t.status} ${t.unread ? "unread" : ""}` }), el("span", { class: "col-title", title: `${t.title}\nDrag to move it: to a side, onto another chat, or out of this panel` }, t.title),
      el("button", { class: "icon-btn col-x", title: "Close this split (the chat goes back to the tabs)", onclick: () => post({ type: "closeColumn" }) }, icon("close")));
  }
  function finishRename(id, value) {
    if (S.renaming !== id) return;
    S.renaming = null;
    if (value && value.trim()) post({ type: "renameTab", id, title: value });
    renderTabs();
  }

  // ---------- history (clock) ----------
  function toggleHistory() { S.showHistory ? closeHistory() : openHistory(); }
  function openHistory() { if (S.showLocal) closeLocal(); S.showHistory = true; post({ type: "history" }); renderHistory(); historyBtn.classList.add("on"); }
  function closeHistory() { S.confirmDelete = null; S.showHistory = false; historyEl.classList.add("hidden"); listEl.classList.remove("hidden"); historyBtn.classList.remove("on"); }

  // All chats from every workspace. Pinned ones first; then newest first.
  function renderHistory() {
    if (!S.showHistory) return;
    listEl.classList.add("hidden");
    historyEl.classList.remove("hidden");
    const q = S.historyQuery.toLowerCase();
    const items = S.history.filter((h) => (S.historyScope === "all" || h.here) && (!q || `${h.title} ${h.preview} ${h.ws}`.toLowerCase().includes(q)));
    const search = el("input", { class: "h-search", placeholder: "Search chats…", value: S.historyQuery,
      oninput: (e) => { S.historyQuery = e.target.value; const pos = e.target.selectionStart; renderHistory(); const s = historyEl.querySelector(".h-search"); s.focus(); s.setSelectionRange(pos, pos); },
      onkeydown: (e) => { if (e.key === "Escape") closeHistory(); } });
    const scope = el("div", { class: "seg h-scope" }, ...[["all", "All workspaces"], ["here", "This workspace"]].map(([v, label]) =>
      el("button", { class: S.historyScope === v ? "on" : "", onclick: () => { S.historyScope = v; renderHistory(); } }, label)));
    const pinned = items.filter((h) => h.pinned), rest = items.filter((h) => !h.pinned);
    const group = (label, list) => list.length ? [el("div", { class: "h-group" }, label), ...list.map(historyItem)] : [];
    historyEl.replaceChildren(
      el("div", { class: "h-head" }, backBtn(closeHistory), el("span", { class: "h-title" }, "All chats"), el("span", { class: "h-count" }, S.history.length ? String(S.history.length) : "")),
      search, scope,
      items.length ? el("div", { class: "h-list" }, ...group("Pinned", pinned), ...group(pinned.length ? "Chats" : "", rest))
        : el("div", { class: "h-empty" }, S.history.length ? "No chats match." : "Your chats show up here, from every workspace."));
  }

  function historyItem(h) {
    const confirming = S.confirmDelete === h.id;
    return el("div", { class: `h-item ${h.open ? "open" : ""} ${h.pinned ? "pinned" : ""}`, onclick: () => { closeHistory(); S.focusNext = true; post({ type: "reopen", id: h.id }); } },
      el("div", { class: "h-row" },
        el("span", { class: "h-name" }, h.title),
        el("span", { class: "spacer" }),
        el("button", { class: `icon-btn small h-pin ${h.pinned ? "on" : ""}`, title: h.pinned ? "Unpin" : "Pin to the top",
          onclick: (e) => { e.stopPropagation(); post({ type: "pin", id: h.id, value: !h.pinned }); } }, icon("pin")),
        confirming
          ? el("button", { class: "cb danger", title: "Delete this chat for good", onclick: (e) => { e.stopPropagation(); S.confirmDelete = null; post({ type: "forget", id: h.id }); } }, "Delete?")
          : el("button", { class: "icon-btn small", title: "Delete", onclick: (e) => { e.stopPropagation(); S.confirmDelete = h.id; renderHistory(); } }, icon("trash"))),
      el("div", { class: "h-meta" }, ...(h.open ? [el("span", { class: "h-badge" }, "open"), " "] : []),
        ...(h.here ? [] : [el("span", { class: "h-ws", title: "From another workspace" }, h.ws), " · "]),
        `${ago(h.when)} · ${modelLabel(h.model)} · ${h.count} message${h.count === 1 ? "" : "s"}`),
      h.preview && h.preview !== h.title ? el("div", { class: "h-preview" }, h.preview) : null);
  }

  // ---------- messages ----------

  function renderAll() {
    listEl.replaceChildren();
    const t = S.tab;
    if (S.notReady && (!t || !t.messages.length)) {
      // Not set up yet: Claude Code missing or not logged in. Say so, instead of errors later.
      listEl.append(el("div", { class: "empty" },
        el("div", { class: "logo" }, "{K}"),
        el("div", { class: "brand setup-title" }, "Set up Kural first"),
        el("div", { class: "setup-text" }, "Pick where Kural's AI comes from: Claude, Google Gemini, ChatGPT (Codex), or your own model on this computer. Kural checks that it works."),
        el("button", { class: "cb big solid", onclick: () => post({ type: "getStarted" }) }, "Get started")));
    } else if (!t || !t.messages.length) {
      // Home: the name, what it is, one line, three hints. The rest is in the menus.
      const hint = (k, text) => el("span", { class: "hint" }, el("kbd", {}, keys(k)), text);
      listEl.append(el("div", { class: "empty" },
        el("div", { class: "logo" }, "{K}"),
        el("div", { class: "brand" }, "Kural"),
        el("div", { class: "brand-sub" }, "AI-powered code editor"),
        el("div", { class: "tagline" }, "A weapon, a voice for your ideas."),
        el("div", { class: "hints" }, hint("@", "mention a file"), hint("/", "shortcuts, skills"), hint("+", "attach"), hint("Ctrl+K", "edit in place")),
        S.version ? el("div", { class: "version" }, S.version) : null));
    } else {
      t.messages.forEach((m, i) => listEl.append(messageNode(m, i)));
    }
    stick = true; toBottom();
    renderFoot();
    listen.retag();
  }

  function rerender(i) {
    const old = listEl.querySelector(`[data-i="${i}"]`);
    const typing = side.focused();   // (a question being typed in a side chat keeps its cursor)
    const node = messageNode(S.tab.messages[i], i);
    if (old) old.replaceWith(node); else listEl.append(node);
    side.refocus(typing);
    listen.retag();
    // (A timeline drawn again keeps its place: its end while it followed, else where you had scrolled.)
    for (const t of node.querySelectorAll(".thv")) timeline.follow(t);
    follow();
  }

  // While an answer streams in, only the part that grew is redrawn (a text block, or the thinking box's text), not the
  // whole message: the rest of the page doesn't move, and the thinking box keeps its scroll position.
  function patchBlock(i, k) {
    const msg = S.tab.messages[i], b = msg && msg.blocks[k];
    const wrap = listEl.querySelector(`[data-i="${i}"] [data-b="${k}"]`);
    if (!b || !wrap) return rerender(i);
    if (b.k === "text") wrap.replaceChildren(...md.markdown(b.text, !msg.running, k === leadOf(msg)));
    else if (b.k === "think") {
      // (Only this thought's text; the timeline follows its newest line unless you scrolled up in it.)
      const root = wrap.closest(".thv");
      if (!root) return rerender(i);
      timeline.patchThought(root, b.text);
    } else return rerender(i);
    follow();
  }

  // Pills in sent messages open the file when clicked; pills you're still typing don't. A quote (text you selected in
  // the chat) opens nothing: pointing at it shows what it says.
  function pillNode(ctx, openable = true) {
    if (ctx.kind === "shortcut") {   // your shortcut: pointing at it shows the text it stands for
      const now = S.shortcuts.find((x) => x.name === ctx.name);
      return el("span", { class: "pill shortcut", contenteditable: "false", "data-ctx": JSON.stringify(ctx), title: String((now || ctx).text || "").slice(0, 600) },
        el("span", { class: "pill-icon" }, icon("zap")), el("span", { class: "pill-text" }, pillLabel(ctx)));
    }
    const quote = ctx.kind === "quote";
    return el("span", { class: `pill ${ctx.kind}`, contenteditable: "false", "data-ctx": JSON.stringify(ctx),
      title: quote ? String(ctx.text || "").slice(0, 600) : ctx.kind === "element" ? `${ctx.label} on ${ctx.path}${ctx.element && ctx.element.text ? `\n"${ctx.element.text.slice(0, 80)}"` : ""}` : openable ? `Open ${ctx.path}` : ctx.path,
      onclick: !openable || quote ? null : ctx.kind === "element" ? () => post({ type: "browser", url: ctx.path }) : () => post({ type: "openFile", path: ctx.path, line: ctx.startLine, endLine: ctx.endLine }) },
      ctx.kind === "element" || quote ? el("span", { class: "pill-icon" }, icon(ctx.source === "lesson" ? "mortar-board" : quote ? "quote" : "inspect")) : el("span", { class: "pill-icon" }, ctx.kind === "selection" ? "{ }" : "@"),
      quote ? el("span", { class: "pill-text" }, pillLabel(ctx)) : pillLabel(ctx));
  }

  // Each block in its own wrapper (display: contents), so a streamed delta redraws just that block (patchBlock), and a
  // new block is added without redrawing the others (appendBlock).
  // A text block: Calm reading (media/markdown.js). The answer's last text, once it's finished, may end with options
  // the AI wrote after a question: those become buttons (media/choices.js), clickable on the last answer of an idle chat.
  function textNodes(m, b, k, inSteps) {
    const lead = !inSteps && k === leadOf(m);
    if (inSteps || m.running || k !== lastTextOf(m) || m.role !== "assistant") return md.markdown(b.text, !m.running, lead);
    const blocks = md.parse(b.text, { finished: true, lead }), ch = md.choicesOf(blocks);
    if (!ch) return md.render(blocks, { finished: true });
    const i = S.tab.messages.indexOf(m), next = S.tab.messages[i + 1];
    const clickable = i === lastAssistant() && S.tab.status === "idle" && !S.tab.visiting;
    return [...md.render(blocks.slice(0, ch.start), { finished: true }), choices.options(ch, i, { answered: (next && next.picks) || null, clickable }),
      ...md.render(blocks.slice(ch.end), { finished: true })];
  }
  function blockNode(m, b, k, inSteps = false) {
    const w = el("div", { class: `blk${inSteps && b.k === "text" ? " interim" : ""}`, "data-b": k });
    if (b.k === "text") w.append(...textNodes(m, b, k, inSteps));
    else if (b.k === "tool") w.append(toolNode(b));
    else if (b.k === "perm") w.append(permNode(b));
    else if (b.k === "agent") w.append(agentNode(b));
    else if (b.k === "question") w.append(inSteps && doneQuestion(b) ? answeredNode(b) : choices.card(b, S.tab.messages.indexOf(m), b._prior));
    else if (b.k === "split") w.append(split.card(b));
    else if (b.k === "think") w.append(el("div", { class: "think-plain" }, b.text));   // (thoughts are drawn in the timeline)
    else if (b.k === "image") w.append(imageNode(b));
    else if (b.k === "steer") w.append(steerNode(b));
    return w;
  }

  // A message you sent while it was answering, which it took into this answer (Enter doesn't stop an answer: it queues).
  function steerNode(b) {
    return el("div", { class: "steer" },
      el("div", { class: "steer-label" }, icon("comment-discussion"), " You added this while it worked"),
      el("div", { class: "bubble" }, (b.segments || []).map((s) => s.t === "text" ? s.v : pillNode(s.ctx)), attachmentsRow(b.attachments)));
  }
  // Attached files under a message: pictures shown (click: full size), the rest as chips (click: open).
  function attachmentsRow(list) {
    return (list || []).length ? el("div", { class: "att-row" }, list.map((a) =>
      a.kind === "image" && fileSrc(a.path)
        ? el("img", { class: "att-photo", src: fileSrc(a.path), alt: a.name, title: `Open ${a.name}`, onclick: () => post({ type: "openImage", path: a.original || a.path }) })
        : el("span", { class: "chip att sent", title: `Open ${a.path}`, onclick: () => post({ type: "openFile", path: a.path }) },
          kindIcon(a.kind), el("span", { class: "att-name" }, a.name)))) : null;
  }
  // A new block at the end of an answer that's on screen: added after the last block; the rest stays as it is.
  function appendBlock(i) {
    const msg = S.tab.messages[i], k = msg.blocks.length - 1;
    const out = listEl.querySelector(`[data-i="${i}"] .answer`);
    const prev = out && (k === 0 ? null : out.querySelector(`[data-b="${k - 1}"]`));
    // (A permission or question card also changes the line under the answer ("Waiting for your OK above"): redraw.)
    if (pending === i) return;   // a redraw of this answer is coming anyway
    // (An answer with steps is laid out again: a new step pulls the text before it into the dropdown.)
    if (!out || (k > 0 && !prev) || pending !== null || ["perm", "question", "split", "steer"].includes(msg.blocks[k].k) ||
      parts(msg).some((p) => p.group.length)) return rerender(i);
    // A previous live thinking box is finished once something comes after it.
    if (prev && msg.blocks[k - 1].k === "think") prev.replaceWith(blockNode(msg, msg.blocks[k - 1], k - 1));
    const node = blockNode(msg, msg.blocks[k], k);
    // (The first block goes after the line on top: which model answers.)
    const after = k === 0 ? (out.querySelector(".model-attribution") || null) : out.querySelector(`[data-b="${k - 1}"]`);
    if (after) after.after(node); else out.prepend(node);
    follow();
  }

  // Files the answers after message i changed that aren't undone (what "Restore code" would put back).
  function laterFiles(i) {
    const files = new Set();
    for (const m of S.tab.messages.slice(i + 1)) if (m.role === "assistant" && !m.inherited) for (const c of m.changes || []) if (c.state !== "undone") files.add(c.rel);
    return files.size;
  }
  // Editing an earlier message: its text (and @ mentions) go into the input box, with a bar saying what sending does.
  const flash = (text, ms = 1600) => { const f = app.querySelector(".flash") || app.appendChild(el("div", { class: "flash" }));
    f.textContent = text; f.classList.add("on"); clearTimeout(S.flashTimer); S.flashTimer = setTimeout(() => f.classList.remove("on"), ms); };
  const busyNote = () => flash("Wait for the answer to finish (or stop it) first");
  function startEdit(i) {
    if (S.tab.status !== "idle") return busyNote();
    const m = S.tab.messages[i];
    S.editing = { tabId: S.tab.id, index: i, attachments: (m.attachments || []).length };
    input.replaceChildren(...(m.segments || []).map((x) => x.t === "text" ? document.createTextNode(x.v) : pillNode(x.ctx, false)));
    renderEditBar(); renderAll();
    input.focus();
    const r = document.createRange(); r.selectNodeContents(input); r.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }
  function cancelEdit() { if (!S.editing) return; S.editing = null; input.replaceChildren(); renderEditBar(); renderAll(); }

  // --- Enhance prompt ---
  // S.enh: { tabId, id, state: running | done | error, status, before (the box as it was), key (what was sent), label, … }.
  // The box is locked while it works; the result replaces your text (the @ mentions stay, after it); Undo puts back what
  // you had. Nothing is sent: you check it and press Send.
  function startEnhance() {
    const t = S.tab;
    if (!t || t.visiting) return;
    if (S.enh && S.enh.state === "running") return;
    const segments = readInput();
    if (!segments.some((x) => x.t === "text" && x.v.trim())) { flash("Write your request first, then enhance it", 2200); input.focus(); return; }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    S.enh = { tabId: t.id, id, state: "running", status: "Starting…", before: [...input.childNodes].map((n) => n.cloneNode(true)), key: JSON.stringify(segments), t0: Date.now() };
    input.setAttribute("contenteditable", "false"); input.classList.add("enh-locked");
    closePopup();
    post({ type: "enhance", tabId: t.id, requestId: id, segments });
    renderEnhance();
  }
  // The text from your voice into the box at the cursor (at the end when the cursor isn't in the box), with a space before
  // it when needed. Returns its text node, so Undo can put back exactly what Whisper heard.
  function insertVoiceText(text) {
    const sel = window.getSelection();
    let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!range || !input.contains(range.startContainer)) { range = document.createRange(); range.selectNodeContents(input); range.collapse(false); }
    range.deleteContents();
    const before = (() => { const r = range.cloneRange(); r.setStart(input, 0); return r.toString(); })();
    const node = document.createTextNode((before && !/\s$/.test(before) ? " " : "") + text);
    range.insertNode(node);
    range.setStartAfter(node); range.collapse(true);
    sel.removeAllRanges(); sel.addRange(range);
    input.focus(); requestAnimationFrame(caretIntoView); renderQueueBtn();
    return node;
  }
  function stopEnhance() { if (S.enh && S.enh.state === "running") post({ type: "enhanceStop", tabId: S.enh.tabId }); }
  function unlockInput() { input.setAttribute("contenteditable", "plaintext-only"); input.classList.remove("enh-locked"); }
  // The improved prompt into the box: your @ mentions (pills) stay, after it.
  function putPrompt(text) {
    const pills = [...input.querySelectorAll(".pill")].map((n) => n.cloneNode(true));
    input.replaceChildren(document.createTextNode(text), ...(pills.length ? [document.createTextNode("\n"), ...pills.flatMap((p) => [p, document.createTextNode(" ")])] : []));
    input.focus();
    const r = document.createRange(); r.selectNodeContents(input); r.collapse(true);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    input.scrollTop = 0;
    renderQueueBtn();
  }
  function undoEnhance() {
    if (!S.enh || !S.enh.before) return;
    input.replaceChildren(...S.enh.before.map((n) => n.cloneNode(true)));
    S.enh = null; renderEnhance(); input.focus(); renderQueueBtn();
  }
  // Per tab: S.enh is the shown tab's, the others' wait in S.enhBy (tabId -> E). A result for a tab that isn't on screen is kept
  // there and put in the box when you go back to it (the box is shared by the tabs, so it never goes into another chat's).
  function enhanceTab(newId) {
    if (!S.enhBy) S.enhBy = new Map();
    if (S.enh && S.enh.tabId !== newId) { S.enhBy.set(S.enh.tabId, S.enh); S.enh = null; }
    if (!S.enh && S.enhBy.has(newId)) { S.enh = S.enhBy.get(newId); S.enhBy.delete(newId); }
    const E = S.enh;
    if (E && E.state === "running") { input.setAttribute("contenteditable", "false"); input.classList.add("enh-locked"); return; }
    unlockInput();
    if (E && E.state === "done" && E.pending != null) { const text = E.pending; E.pending = null; putPrompt(text); }
  }
  function onEnhanceState(m) {
    const here = S.enh && m.id === S.enh.id;
    const E = here ? S.enh : (S.enhBy && S.enhBy.get(m.tabId));
    if (!E || m.id !== E.id || E.state !== "running") return;
    if (m.state === "running") { E.status = m.status || E.status; if (here) renderEnhance(); return; }
    if (m.state === "done") {
      Object.assign(E, { state: "done", label: m.label, calls: m.calls, ms: m.ms, dropped: (m.dropped || []).length, flagged: (m.flagged || []).length, prompt: m.prompt });
      if (here) { unlockInput(); putPrompt(m.prompt); } else E.pending = m.prompt;
    } else { Object.assign(E, { state: "error", kind: m.kind, message: m.message || "It didn't work.", label: m.label }); if (here) unlockInput(); }
    if (here) renderEnhance();
  }
  function renderEnhance() {
    const E = S.enh;
    enhanceBtn.classList.toggle("busy", !!(E && E.state === "running"));
    enhanceBtn.classList.toggle("hidden", !!(S.tab && S.tab.visiting));
    enhanceBar.classList.toggle("hidden", !E);
    enhanceBar.classList.toggle("err", !!(E && E.state === "error"));
    if (!E) { enhanceBar.replaceChildren(); return; }
    const secs = (ms) => `${Math.max(1, Math.round(ms / 1000))} s`;
    if (E.state === "running") {
      enhanceBar.replaceChildren(el("i", { class: "codicon codicon-loading codicon-modifier-spin", "aria-hidden": "true" }),
        el("span", { class: "enh-text", title: E.status }, E.status), el("button", { class: "cb", onclick: () => stopEnhance() }, "Stop"));
    } else if (E.state === "done") {
      const what = `Rewritten by ${E.label || "the enhancer"} (${E.calls} look${E.calls === 1 ? "" : "s"}, ${secs(E.ms)})` +
        (E.dropped ? ` · ${E.dropped} unverified pointer${E.dropped === 1 ? "" : "s"} removed` : "") +
        (E.flagged ? ` · ${E.flagged} file${E.flagged === 1 ? "" : "s"} with suspicious instructions marked` : "") + " · check it, then send";
      enhanceBar.replaceChildren(icon("wand"), el("span", { class: "enh-text", title: what }, what),
        el("button", { class: "cb", title: "Put back what you had typed", onclick: () => undoEnhance() }, "Undo"),
        el("button", { class: "cb x", "aria-label": "Close", title: "Keep it and close this note", onclick: () => { S.enh = null; renderEnhance(); } }, icon("close")));
    } else {
      enhanceBar.replaceChildren(icon("warning"), el("span", { class: "enh-text", title: E.message }, E.message),
        E.kind !== "empty" && E.kind !== "unavailable" && E.kind !== "stopped" && el("button", { class: "cb", onclick: () => { S.enh = null; startEnhance(); } }, "Try again"),
        el("button", { class: "cb x", "aria-label": "Close", onclick: () => { S.enh = null; renderEnhance(); } }, icon("close")));
    }
  }
  function renderEditBar() {
    const on = S.editing && S.tab && S.editing.tabId === S.tab.id;
    editBar.classList.toggle("hidden", !on);
    if (on) editBar.replaceChildren(icon("edit"), el("span", { class: "edit-text" }, "Editing an earlier message: sending replaces it and everything after it." +
      (S.editing.attachments ? " Add its attachments again with +." : "")), el("button", { class: "cb", onclick: () => cancelEdit() }, "Cancel"));
  }

  function forkButton(i) {
    return el("button", { class: "msg-act", "aria-label": "Fork from here",
      title: "Fork from here\nStart a new chat with the conversation through this message. This chat stays as it is. If later answers changed files, Kural asks whether the code goes back too.",
      onclick: () => S.tab.status !== "idle" ? busyNote() : post({ type: "fork", tabId: S.tab.id, index: i }) }, icon("git-branch"));
  }

  // A question card you asked about (state "asked") and the AI's text after it go into the next card of the same answer
  // (its new version): b._prior = { before, answerText }. Returns the block indexes drawn there instead.
  function askedInto(m) {
    const folded = new Set(), bs = m.blocks || [];
    bs.forEach((b, k) => {
      if (b.k !== "question" || b.state !== "asked") return;
      const next = bs.findIndex((x, j) => j > k && x.k === "question");
      if (next < 0) return;
      const between = [];
      for (let j = k + 1; j < next; j++) if (bs[j].k === "text") { between.push(bs[j].text); folded.add(j); }
      bs[next]._prior = { before: b, answerText: between.join("\n\n") };
      folded.add(k);
    });
    return folded;
  }

  // What you answered by picking: chips per question (the question above them when there were several), then the note.
  function picksBubble(m) {
    const text = (m.segments || []).filter((x) => x.t === "text").map((x) => x.v).join("");
    const said = m.picks.map((x) => `${x.question} ${x.choices.join(", ")}`).join("\n");
    const note = text.startsWith(said) ? text.slice(said.length).trim() : "";
    return [...m.picks.flatMap((x) => [m.picks.length > 1 ? el("div", { class: "pick-q" }, x.question) : null,
      el("div", { class: "picked" }, x.choices.map((c) => el("span", { class: "pk" }, icon("check"), c)))]), note ? el("div", { class: "pick-note" }, note) : null];
  }

  function messageNode(m, i) {
    if (m.role === "user") {
      // Hover: Edit (what you send replaces this message and everything after it) and Restore code (the files the AI
      // changed after this message go back; the conversation stays).
      const later = laterFiles(i);
      const actions = !S.tab.visiting ? el("div", { class: "msg-actions" },
        el("button", { class: "msg-act", title: "Edit this message: what you send replaces it and everything after it", onclick: () => startEdit(i) }, icon("edit")),
        later ? el("button", { class: "msg-act", title: `Restore the code to before this message (${later} file${later === 1 ? "" : "s"} the AI changed after it)`,
          onclick: () => S.tab.status !== "idle" ? busyNote() : post({ type: "restore", tabId: S.tab.id, index: i }) }, icon("discard")) : null,
        forkButton(i)) : null;
      return el("div", { class: `msg user${S.editing && S.editing.tabId === S.tab.id && S.editing.index === i ? " editing" : ""}`, "data-i": i }, actions,
        (m.contexts || []).length || (m.mode && m.mode !== "agent") ? el("div", { class: "ctx-line" },
          m.mode && m.mode !== "agent" ? el("span", { class: `mode-tag ${m.mode}` }, modeLabel(m.mode)) : null,
          (m.contexts || []).map((c) => el("span", { class: "ctx" }, icon("file"), " ", c.name || base(c.path)))) : null,
        el("div", { class: "bubble" }, m.picks && m.picks.length ? picksBubble(m) : (m.segments || []).map((s) => s.t === "text" ? s.v : pillNode(s.ctx)),
          // Pictures you mentioned with @: shown, like attached ones.
          ((pics) => pics.length ? el("div", { class: "att-row" }, pics.map((c) => el("img", { class: "att-photo", src: fileSrc(c.path), alt: base(c.path),
            title: `Open ${base(c.path)} full size`, onclick: () => post({ type: "openImage", path: c.path }) }))) : null)(
            (m.segments || []).filter((s) => s.t !== "text" && s.ctx && s.ctx.kind !== "selection" && IMG_RE.test(s.ctx.path || "") && fileSrc(s.ctx.path)).map((s) => s.ctx)),
          attachmentsRow(m.attachments)));
    }
    const out = el("div", { class: "answer" });
    const last = i === S.tab.messages.length - 1;
    // Hover: why Auto chose it (profile, task, intensity, limits, staying on the model, what it learned).
    if (m.models && m.models.length) out.append(el("div", { class: "model-attribution", ...(m.routing && m.routing.reason ? { title: m.routing.reason } : {}) },m.models.map(modelLabel).join(" → ") +
      (m.routing ? ` · ${m.routing.source || "native"} · ${Number(m.routing.ms).toFixed(1)} ms routing` : "")));
    const P = parts(m), folded = askedInto(m);
    P.forEach((p, n) => {
      if (p.group.length) out.append(stepsNode(m, p.group, n, n === P.length - 1));
      p.outside.forEach((k) => { if (!folded.has(k)) out.append(blockNode(m, m.blocks[k], k)); });
      if (p.steer !== null) out.append(blockNode(m, m.blocks[p.steer], p.steer));   // what you added while it worked
    });
    const waiting = (m.blocks || []).some((b) => (b.k === "perm" || b.k === "question" || b.k === "split") && b.state === "pending");
    const asking = (m.blocks || []).some((b) => (b.k === "question" || b.k === "split") && b.state === "pending");
    if (m.running && waiting) out.append(el("div", { class: "working" }, el("span", { class: "wait-dot" }), asking ? "Waiting for your answer above" : "Waiting for your OK above"));
    else if (m.running && (m.waitingFor || []).length) out.append(el("div", { class: "working" }, el("span", { class: "dots" }, el("span"), el("span"), el("span")),
      el("span", {}, `Waiting for ${listNames(m.waitingFor)} to finish; then Kural merges their work`),
      // Agents that take too long: stop them; the finished ones' work is merged and checked.
      el("button", { class: "cb", title: "Stop the agents still working; the finished ones' work is merged and checked", onclick: () => post({ type: "finishAgents", tabId: S.tab.id }) }, "Finish now")));
    // (While a timeline is live, its header says it works: no second "Thinking…" line under the answer.)
    else if (m.running && !layout(m).group.length) out.append(el("div", { class: "working" }, el("span", { class: "dots" }, el("span"), el("span"), el("span")),
      el("span", { class: "elapsed", "data-t0": m.t0 }, workingText(m.t0))));
    if (m.note) out.append(el("div", { class: "note" }, m.note));
    if (m.error === "stopped") out.append(el("div", { class: "note" }, "Stopped."));
    else if (m.error === "login") out.append(el("div", { class: "note warn" }, `${m.errorWho || "Claude"} isn't logged in. `, el("button", { class: "cb primary", onclick: () => post({ type: "login", tabId: S.tab.id }) }, "Log in")));
    else if (m.error === "missing") out.append(el("div", { class: "note warn" }, "Claude isn't set up yet. Open Kural: Get Started, or pick a model on your computer."));
    else if (m.error) out.append(el("div", { class: "note warn" }, m.error, " ", el("button", { class: "cb", onclick: () => post({ type: "showLog" }) }, "Open log")));
    if (m.planReady) out.append(el("div", { class: "plan-bar" },
      m.planBuilt ? el("span", { class: "row-state" }, icon("check"), " Building it") : [
        el("span", { class: "plan-q" }, "Happy with this plan?"),
        el("span", { class: "spacer" }),
        el("button", { class: "cb", title: "Save this plan as a Markdown file in the project", onclick: () => post({ type: "savePlan", tabId: S.tab.id, msgIndex: i }) }, icon("save"), " Save plan"),
        el("button", { class: "cb primary solid big", disabled: S.tab.status !== "idle", onclick: () => post({ type: "buildPlan", tabId: S.tab.id, msgIndex: i }) }, "Build it")]));
    if (m.changes && m.changes.length) out.append(changesNode(m, i));
    side.nodes(m, i).forEach((n) => out.append(n));   // side chats: quick questions about parts of this answer
    if (!m.running && m.ms && last) out.append(el("div", { class: "meta" }, `${(m.ms / 1000).toFixed(1)} s`));
    if (!m.running && !S.tab.visiting) out.append(el("div", { class: "answer-actions" }, listen.button(m, i), forkButton(i)));
    return el("div", { class: "msg assistant", "data-i": i }, out);
  }

  const listNames = (n) => n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}` : n[0];
  function workingText(t0) {
    const s = Math.round((Date.now() - (t0 || Date.now())) / 1000);
    return s < 2 ? "Thinking…" : `Thinking… ${s}s`;
  }
  setInterval(() => {
    for (const e of listEl.querySelectorAll(".elapsed")) e.textContent = workingText(+e.dataset.t0);
    for (const e of listEl.querySelectorAll(".tl-elapsed")) e.textContent = workingLabel(e.dataset.t0, e.dataset.kinds);
  }, 1000);

  // ONE dropdown per answer for how it worked: thoughts, tool steps (reads, searches, commands, edits…), permission cards
  // you've answered, and the short notes the model writes between them, so the chat shows the answer, not a stack of
  // "Thought for…" boxes and commands (Adithya). What stays outside: the text after the last step (the answer), anything
  // waiting for you (a permission or a question), agents' cards and pictures.
  // A message you added while it worked ("steer") splits the answer in parts, each with its own dropdown: what it did
  // after reading your message shows after it, not above it.
  // (A question card you answered or skipped is a step too, one line: it stayed a full card under the timeline, with every
  // option, while the AI went on thinking above it. One you asked about folds into its next card: askedInto.)
  const doneQuestion = (b) => b.k === "question" && (b.state === "answered" || b.state === "skipped");
  const isStep = (b) => b.k === "think" || b.k === "tool" || (b.k === "perm" && b.state !== "pending") || doneQuestion(b);
  function layoutOf(m, ks) {
    let last = -1;
    ks.forEach((k) => { if (isStep(m.blocks[k])) last = k; });
    const group = [], outside = [];
    ks.forEach((k) => { const b = m.blocks[k]; if (last >= 0 && k <= last && (isStep(b) || b.k === "text")) group.push(k); else outside.push(k); });
    return { group, outside };
  }
  function parts(m) {
    const out = [];
    let cur = [];
    (m.blocks || []).forEach((b, k) => { if (b.k === "steer") { out.push({ ...layoutOf(m, cur), steer: k }); cur = []; } else cur.push(k); });
    out.push({ ...layoutOf(m, cur), steer: null });
    return out;
  }
  // The part still being written (the last): its dropdown is the live one.
  function layout(m) { const p = parts(m); return p[p.length - 1]; }
  // The answer's first text after all its steps: where "**Done:** …" becomes the point-first box (-1: none yet).
  function leadOf(m) { const p = layout(m), k = p.outside.find((x) => m.blocks[x].k === "text"); return k === undefined ? -1 : k; }
  // ...and its last text, where options at the end of the answer can be (-1: none).
  function lastTextOf(m) { const ks = layout(m).outside.filter((x) => m.blocks[x].k === "text"); return ks.length ? ks[ks.length - 1] : -1; }
  const STEP_KIND = { Bash: "command", run_command: "command", Read: "read", Grep: "search", Glob: "search", read_file: "read", list_dir: "search",
    Edit: "edit", Write: "edit", NotebookEdit: "edit", write_file: "edit", WebSearch: "web search", WebFetch: "web page" };
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : w.endsWith("search") ? "es" : "s"}`;
  // " · 3 thoughts, 2 reads, 1 command"
  function stepsKinds(m, ks) {
    const count = {};
    for (const k of ks) {
      const b = m.blocks[k];
      const kind = b.k === "think" ? "thought" : b.k === "tool" ? STEP_KIND[(b.name || "").replace(/^mcp__device__/, "")] || (browserVerb(b.name) ? "browser step" : "step") : null;
      if (kind) count[kind] = (count[kind] || 0) + 1;
    }
    const order = ["thought", "read", "search", "edit", "command", "web search", "web page", "browser step", "step"];
    const kinds = order.filter((k) => count[k]).map((k) => plural(count[k], k));
    return kinds.length ? ` · ${kinds.join(", ")}` : "";
  }
  function stepsLabel(m, ks, live = true) {
    const secs = m.ms && live ? Math.max(1, Math.round(m.ms / 1000)) : 0;   // (the time: the whole answer's, on its last part)
    return `${m.running && live ? "Working…" : secs ? `Worked for ${secs} s` : "Worked"}${stepsKinds(m, ks)}`;
  }
  const workingLabel = (t0, kinds = "") => `Working… ${Math.max(0, Math.round((Date.now() - (+t0 || Date.now())) / 1000))} s${kinds}`;
  // What the thinking is (the timeline's tag): Claude and ChatGPT send their own summaries; models on this computer, and
  // open models through Codex, their raw thinking. Kural shows it as it comes and summarizes nothing itself.
  function thinkingTag(m) {
    const thinks = (m.blocks || []).filter((b) => b.k === "think");
    if (!thinks.length) return null;
    const model = (m.models || [])[(m.models || []).length - 1] || (S.tab && S.tab.model) || "";
    if (thinks.some((b) => b.raw) || /^ollama:/.test(model)) return "raw";
    if (/^codex:/.test(model)) return "ChatGPT's summary";
    if (/^agy:/.test(model)) return null;
    return "Claude's summary";
  }
  // n: which part of the answer (see parts); live: the last part (its timeline shows what it's doing now). Open while it
  // works (as tall as the chat: --tl-max); once that part is done it folds to its header, so the answer comes up
  // (Adithya, issue #104). Your own click (open or fold) stays.
  function stepsNode(m, ks, n = 0, live = true) {
    const running = m.running && live;
    const open = m._stepsOpen && n in m._stepsOpen ? m._stepsOpen[n] : running;
    const state = ((m._tl = m._tl || {})[n] = m._tl[n] || { follow: true });
    const last = ks[ks.length - 1];
    const items = ks.map((k) => {
      const b = m.blocks[k], now = running && k === last;
      return b.k === "think" ? { kind: "thought", text: b.text, raw: !!b.raw, now, key: k } : { kind: "step", node: blockNode(m, b, k, true), now };
    });
    const kinds = stepsKinds(m, ks);
    const node = timeline.node({ label: running ? workingLabel(m.t0, kinds) : stepsLabel(m, ks, live), tag: thinkingTag(m), live: running, open, items, state,
      onToggle: (o) => { m._stepsOpen = { ...(m._stepsOpen || {}), [n]: o }; } });
    if (running) { const lab = node.querySelector(".lab"); lab.classList.add("tl-elapsed"); lab.dataset.t0 = String(m.t0 || Date.now()); lab.dataset.kinds = kinds; }
    return node;
  }

  const TOOL_VERB = { Read: "Read", Grep: "Searched", Glob: "Listed", Edit: "Edited", Write: "Wrote", NotebookEdit: "Edited", Bash: "Command", WebSearch: "Searched web", WebFetch: "Web page",
    ToolSearch: "Loaded tools", Kural: "Kural" };
  // A linked device's tools.
  const DEVICE_VERB = { run_command: "Device command", read_file: "Read on device", write_file: "Wrote on device", list_dir: "Listed on device" };
  const deviceVerb = (name) => { const m = /^mcp__device__(run_command|read_file|write_file|list_dir)$/.exec(name || ""); return m ? DEVICE_VERB[m[1]] : null; };
  // Kural's browser (its details: browserDetail in lib/chat/index.js).
  const BROWSER_VERB = { tabs: "Browser tabs", open: "Opened", navigate: "Went to", snapshot: "Read the page", click: "Clicked", type: "Typed", press: "Pressed",
    select: "Chose", upload: "Uploaded", drag: "Dragged", scroll: "Scrolled", screenshot: "Took a picture of the page", wait: "Waited", dialog: "Answered the page" };
  const browserVerb = (name) => { const m = /^mcp__kural_browser__(\w+)$/.exec(name || ""); return m ? BROWSER_VERB[m[1]] || null : null; };
  // "mcp__claude_ai_Notion__notion-search" -> "Notion · notion-search"
  function prettyTool(name) {
    const m = /^mcp__(.+?)__(.+)$/.exec(name || "");
    return m ? `${m[1].replace(/^claude[._ ]ai[_ ]/i, "").replace(/_/g, " ")} · ${m[2]}` : name;
  }
  function toolNode(b) {
    const file = ["Read", "Edit", "Write", "NotebookEdit"].includes(b.name) ? b.detail.split("  (")[0] : null;
    const pic = file && b.name === "Read" && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file) ? fileSrc(file) : null;
    return el("div", { class: `tool ${b.name}` },
      el("span", { class: "tool-name" }, TOOL_VERB[b.name] || deviceVerb(b.name) || browserVerb(b.name) || prettyTool(b.name)), " ",
      file ? el("span", { class: "tool-file", onclick: () => post({ type: "openFile", path: file }) }, b.detail)
        : b.name === "Bash" || /run_command$/.test(b.name) ? el("code", {}, b.detail) : el("span", {}, b.detail),
      pic ? el("img", { class: "md-img tool-img", src: pic, alt: base(file), title: "Click to open it full size", onclick: () => post({ type: "openImage", path: file }) }) : null);
  }

  // A question card you answered (or skipped), as a step in the timeline: "You answered · Which database? Postgres".
  function answeredNode(b) {
    if (choices.forget) choices.forget(b.pid);   // (no longer waiting for picks)
    const said = b.state === "answered" ? (b.questions || []).map((q) => {
      const a = b.answers && b.answers[q.question];
      return a == null || a === "" ? null : `${q.question} ${a}`;
    }).filter(Boolean).join(" · ") : "";
    return el("div", { class: "tool question-step" },
      el("span", { class: "tool-name" }, b.state === "answered" ? "You answered" : "Skipped the question"), " ",
      el("span", {}, said || ((b.questions || [])[0] || {}).question || ""));
  }

  // A picture the model made (saved by Kural as a file): shown in the answer; click opens it.
  function imageNode(b) {
    const src = fileSrc(b.path);
    return src ? el("img", { class: "md-img gen-img", src, alt: b.alt || "picture", title: "Click to open it full size", onclick: () => post({ type: "openImage", path: b.path }) })
      : el("span", { class: "img-missing" }, icon("file-media"), " ", b.path);
  }

  function agentNode(b) {
    const label = { running: "working", done: "done", failed: "failed", stopped: "stopped" }[b.state] || b.state;
    return el("div", { class: `agent ${b.state}`, "data-agent": b.id },
      el("div", { class: "agent-head" },
        el("span", { class: "agent-n" }, b.name || `Agent ${b.n}`),
        b.role ? el("span", { class: "agent-role" }, b.role) : null,
        el("span", { class: "agent-title" }, b.title),
        el("span", { class: "spacer" }),
        b.state === "running" && b.activity ? el("span", { class: "agent-activity", title: b.activity }, b.activity) : null,
        b.state !== "running" && b.why ? el("span", { class: "agent-activity", title: b.why }, b.why) : null,
        b.state === "running" ? el("span", { class: "dots small" }, el("span"), el("span"), el("span")) : null,
        el("span", { class: "agent-state" }, label)),
      b.steps.length ? el("div", { class: "agent-steps" }, ...agentSteps(b)) : null);
  }
  // What the agent wrote (always), and its last 5 other steps: thinking and tools.
  function agentSteps(b) {
    const keep = (s) => s.k === "say";
    const recent = new Set(b.steps.filter((s) => !keep(s)).slice(-5));
    const shown = b.steps.filter((s) => keep(s) || recent.has(s));
    const hidden = b.steps.length - shown.length;
    return [hidden ? el("div", { class: "tool more" }, `+${hidden} earlier steps`) : null, ...shown.map((s) =>
      s.k === "say" ? clampNode("agent-say", s.text) :
      s.k === "think" ? clampNode("agent-think", s.text) : toolNode(s))];
  }
  // Long text shows a few lines; click to see all of it.
  function clampNode(cls, text) {
    const node = el("div", { class: `${cls} clamp`, title: "Click to show all" }, text);
    node.onclick = () => node.classList.toggle("clamp");
    return node;
  }

  function permNode(b) {
    const what = b.tool === "Bash" ? "Run this command?" : b.tool === "WebFetch" ? "Open this web page?"
      : b.tool === "DeviceCommand" ? `Run this on ${b.where || "the device"}?` : b.tool === "DeviceWrite" ? `Write this file on ${b.where || "the device"}?`
      : b.tool === "BrowserSite" ? `Let the AI ${b.reads ? "read" : "use"} ${b.site || "this site"} in Kural's browser?`
      : b.tool === "BrowserAction" ? `Click "${b.label || ""}" on ${b.site || "the page"}?`
      : b.tool === "BrowserUpload" ? `Upload this file to ${b.site || "the page"}?`
      : b.tool === "Browser" ? "Let Gemini use its own browser?"
      : b.tool === "Write" || b.tool === "Edit" || b.tool === "NotebookEdit" ? "Change this file?"
      : b.tool === "Read" ? "Read this file?" : b.tool === "Grep" || b.tool === "Glob" ? "Look through this folder?" : `Use ${prettyTool(b.tool)}?`;
    const card = el("div", { class: `perm ${b.state}` }, el("div", { class: "perm-q" }, b.agent ? el("span", { class: "perm-agent" }, typeof b.agent === "number" ? `Agent ${b.agent}` : b.agent) : null, what), el("pre", {}, b.detail));
    if (b.state === "pending") {
      // A file outside the project (read or change), or a tool Kural can't classify: yes or no for this one. Otherwise
      // "Allow all" covers this card's kind only (commands, web, one connector, a device): Kural gives its words.
      const label = b.where ? `Allow everything on ${b.where} in this chat` : b.allowLabel;
      const always = label ? el("input", { type: "checkbox", id: `al-${b.pid}` }) : null;
      const runs = b.tool === "Bash" || b.tool === "DeviceCommand";
      card.append(el("div", { class: "perm-row" },
        el("button", { class: "cb primary solid", onclick: () => post({ type: "permission", pid: b.pid, allow: true, always: !!(always && always.checked) }) }, runs ? "Run" : "Allow"),
        el("button", { class: "cb", onclick: () => post({ type: "permission", pid: b.pid, allow: false }) }, "Skip"),
        always ? el("label", { class: "always", for: `al-${b.pid}` }, always, ` ${label}`) : null));
    } else card.append(el("div", { class: "perm-state" }, b.state === "allowed" ? [icon("check"), " Allowed"] : [icon("close"), " Skipped"]));
    return card;
  }

  function changesNode(m, i) {
    const pending = m.inherited ? 0 : m.changes.filter((c) => c.state === "pending").length;
    const act = (action, id) => post({ type: "change", msgIndex: i, id, action });
    return el("div", { class: "card" },
      el("div", { class: "card-head" }, `${m.changes.length} file${m.changes.length === 1 ? "" : "s"} changed`),
      m.changes.map((c) => el("div", { class: `row ${c.state}` },
        el("span", { class: "row-file", title: c.rel, onclick: () => act("review", c.id) }, base(c.rel), el("span", { class: "row-dir" }, dir(c.rel))),
        el("span", { class: "add" }, `+${c.added}`), el("span", { class: "del" }, `−${c.removed}`),
        m.inherited ? el("span", { class: "row-state" }, "From original chat") : c.state === "pending" ? el("span", { class: "row-btns" },
          el("button", { class: "cb", onclick: () => act("review", c.id) }, "Review"),
          el("button", { class: "cb", onclick: () => act("undo", c.id) }, "Undo"),
          el("button", { class: "cb primary", onclick: () => act("keep", c.id) }, "Keep"))
          : el("span", { class: "row-state" }, c.state === "kept" ? [icon("check"), " Kept"] : [icon("discard"), " Undone"]))),
      pending > 1 ? el("div", { class: "card-foot" },
        el("button", { class: "cb", onclick: () => act("undo", "*") }, "Undo all"),
        el("button", { class: "cb primary", onclick: () => act("keep", "*") }, "Keep all")) : null);
  }

  // ---------- composer ----------
  function renderChips() {
    chipsEl.replaceChildren();
    const dv = S.tab && S.tab.device;
    if (dv) chipsEl.append(el("span", { class: "chip ticket", title: `${dv.user}@${dv.host}\nLinked to this chat: the model can run commands and change files on it (asking you first in Agent mode).\nClick to open a terminal on it.`,
      onclick: () => post({ type: "deviceTerminal", id: dv.id }) },
      icon("remote"), " ", el("b", {}, dv.name), el("span", { class: "chip-dim ticket-chip-sum" }, ` · ${dv.user}@${dv.host}`),
      el("button", { class: "chip-x", title: "Unlink this device", onclick: (e) => { e.stopPropagation(); post({ type: "linkDevice", tabId: S.tab.id, id: null }); } }, icon("close"))));
    const tk = S.tab && S.tab.ticket;
    if (tk) chipsEl.append(el("span", { class: "chip ticket", title: `${tk.key}: ${tk.summary}${tk.status ? ` (${tk.status})` : ""}\nLinked to this chat: the model knows about it in every message.${tk.url ? "\nClick to open it in Jira." : ""}`,
      onclick: () => tk.url && post({ type: "openUrl", url: tk.url }) },
      icon("issues"), " ", el("b", {}, tk.key), el("span", { class: "chip-dim ticket-chip-sum" }, ` · ${tk.summary}`),
      el("button", { class: "chip-x", title: "Unlink this ticket", onclick: (e) => { e.stopPropagation(); post({ type: "linkTicket", tabId: S.tab.id, ticket: null }); } }, icon("close"))));
    for (const a of S.attachments) chipsEl.append(attachChip(a, () => { S.attachments = S.attachments.filter((x) => x.id !== a.id); renderChips(); }));
    renderQueueBtn();
  }
  const KIND_ICON = { image: "file-media", pdf: "file-pdf", text: "file-text", folder: "folder", file: "file" };
  const kindIcon = (kind) => el("span", { class: "att-icon" }, icon(KIND_ICON[kind] || "file"));
  function attachChip(a, remove) {
    return el("span", { class: `chip att ${a.kind}`, title: a.path || a.name },
      a.thumb ? el("img", { class: "att-thumb", src: a.thumb, alt: "" }) : kindIcon(a.kind),
      el("span", { class: "att-name" }, a.name),
      remove ? el("button", { class: "chip-x", title: "Remove", onclick: remove }, icon("close")) : null);
  }

  const tok = (x) => { const v = Math.max(0, Math.round(Number(x) || 0)); return v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k` : String(v); };
  function renderContext(t) {
    const c = t.context, k = t.tokens;
    if (!c && !k) { ctxEl.classList.add("hidden"); return; }
    const used = c ? c.used || 0 : 0, win = c && c.window, share = win ? Math.min(1, used / win) : 0;
    ctxEl.classList.remove("hidden");
    ctxEl.classList.toggle("high", share >= .8);
    // A ring that fills up (SVG would need its own CSS rules; a conic gradient is enough).
    const ring = el("span", { class: "ctx-ring" }); ring.style.setProperty("--p", `${Math.round(share * 360)}deg`);
    // (Short: the percentage, or the tokens when the window isn't known; the numbers are in the tooltip.)
    const label = c ? (win ? `${Math.max(1, Math.round(share * 100))}%` : tok(used)) : `${tok((k.input || 0) + (k.cacheRead || 0) + (k.cacheWrite || 0))} read`;
    ctxEl.replaceChildren(...(win ? [ring] : []), el("span", { class: win ? "ctx-text" : "" }, label));
    const read = k ? (k.input || 0) + (k.cacheRead || 0) + (k.cacheWrite || 0) : 0;
    ctxEl.title = [
      c ? `In context: ${used.toLocaleString()} / ${win ? win.toLocaleString() : "unknown"} tokens` : null,
      k ? `Tokens consumed: ${(read + (k.output || 0)).toLocaleString()} (${read.toLocaleString()} read, ${(k.output || 0).toLocaleString()} written)` : null,
      share >= .8 ? "Nearly full: the AI starts summarising or forgetting the oldest parts. A new chat starts empty." : null,
      "Click to open AI Usage"].filter(Boolean).join("\n");
  }

  function renderFoot() {
    const t = S.tab;
    if (!t) return;
    const v = t.visiting;
    // Not set up: no input (an empty chat shows the big "Set up Kural first"). An answer still running keeps it: Stop.
    const locked = !!S.notReady && t.status === "idle";
    const setupBar = locked && !v && t.messages.length > 0;
    composer.classList.toggle("hidden", !!v || locked);
    visitBar.classList.toggle("hidden", !v && !setupBar);
    if (setupBar) visitBar.replaceChildren(
      el("div", { class: "visit-text" }, "The chat works once Kural's AI is set up."),
      el("div", { class: "visit-actions" }, el("button", { class: "cb primary", onclick: () => post({ type: "getStarted" }) }, "Get started")));
    if (v) visitBar.replaceChildren(
      el("div", { class: "visit-text" }, "This chat is from the workspace ", el("b", {}, v.name), ". Each conversation stays with its own folder."),
      el("div", { class: "visit-actions" },
        v.canOpen ? el("button", { class: "cb", title: "Open that folder in a new window and carry on there", onclick: () => post({ type: "openWorkspace", id: t.id }) }, "Open its folder") : null,
        el("button", { class: "cb primary", title: "Start a new chat here that knows this conversation", onclick: () => { S.focusNext = true; post({ type: "continueHere", id: t.id }); } }, "Continue here")));
    const running = t.status !== "idle";
    modeBtn.replaceChildren(modeLabel(t.mode), icon("chevron-down", "chev"));
    const split = t.splitOn ? " · Parallel" : "";
    const mood = t.mood && t.mood !== "default" ? ` · ${moodLabel(t.mood)}` : "";
    const routing = t.autoRoute ? `Auto · ${cap(profileName(t.routingProfile))} · ` : "";
    modelBtn.replaceChildren(`${routing}${t.routingState || t.modelName || modelLabel(t.model)} · ${t.effort === "medium" ? "Med" : effortLabel(t.effort)}${mood}${split}`, icon("chevron-down", "chev"));
    renderContext(t);
    sendBtn.replaceChildren(icon(running ? "debug-stop" : "arrow-up"));
    sendBtn.title = running ? "Stop (Esc)" : "Send (Enter)";
    sendBtn.classList.toggle("stop", running);
    renderQueueBtn();
    renderQueue();
    // (While it answers, Enter doesn't stop it: what you send is added to the answer at its next step, or answered next.)
    // Short (Adithya: "Ask Kural something", nothing more); the mode shows on its own button.
    input.dataset.placeholder = running ? "Add to this answer…" : "Ask Kural something";
    renderPending();   // (picks waiting for Send change the hint)
  }
  const hasDraft = () => !isEmptyInput() || S.attachments.length > 0;
  function renderQueueBtn() { queueBtn.classList.toggle("hidden", !(S.tab && S.tab.status !== "idle" && !S.tab.visiting && (hasDraft() || choices.anyPicked()))); }
  // Picks waiting for Send: the line above the box, the box's hint, Send lit up.
  function renderPending() {
    const line = choices.lineNode();
    pendingEl.replaceChildren(...(line ? [line] : []));
    composer.classList.toggle("picked", !!line);
    if (line) input.dataset.placeholder = "Add a note (optional), then press Send";
    else if (S.tab) input.dataset.placeholder = S.tab.status !== "idle" ? "Add to this answer…" : "Ask Kural something";
    renderQueueBtn();
  }

  // The queue above the box: what you sent while it answered and it hasn't taken in yet.
  function renderQueue() {
    const q = (S.tab && S.tab.queued) || [];
    queueEl.classList.toggle("hidden", !q.length);
    if (!q.length) { queueEl.replaceChildren(); return; }
    const it = q.length === 1 ? "it" : "them";
    queueEl.replaceChildren(
      el("div", { class: "queue-head", title: `Kural adds ${it} to the answer at its next step, or answers ${it} right after. Stop puts ${it} back in the box.` },
        icon("history"), ` Queued${q.length > 1 ? ` (${q.length})` : ""}: Kural adds ${it} at its next step`),
      ...q.map((x) => el("div", { class: "queue-item", title: x.text }, x.text)));
  }

  // Your message as pieces: text and pills.
  function readInput() {
    const segs = [];
    const push = (v) => { if (!v) return; const l = segs[segs.length - 1]; if (l && l.t === "text") l.v += v; else segs.push({ t: "text", v }); };
    const walk = (node) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) push(n.data);
        else if (n.classList && n.classList.contains("pill")) segs.push({ t: "pill", ctx: JSON.parse(n.dataset.ctx) });
        else if (n.nodeName === "BR") push("\n");
        else { if (n.nodeName === "DIV" && segs.length) push("\n"); walk(n); }
      }
    };
    walk(input);
    return segs;
  }

  function isEmptyInput() { return !readInput().some((s) => s.t === "pill" || s.v.trim()); }

  // The round button: Stop while it answers, else Send.
  function sendOrStop() {
    const t = S.tab;
    if (!t) return;
    if (t.status !== "idle") { post({ type: "stop", tabId: t.id }); return; }
    sendMessage();
  }
  // Enter (and the send arrow): send. While an answer runs it goes to the queue: Kural adds it to that answer at its next
  // step, or answers it right after. Enter never stops an answer (Adithya: it used to): Stop is the button, or Esc.
  function sendMessage() {
    const t = S.tab;
    if (!t || t.visiting) return;
    if (sendPicks(t)) return;
    if (isEmptyInput() && !S.attachments.length) return;
    if (S.enh && S.enh.state === "running") { flash("Enhance is still working on it: wait, or press Stop", 2200); return; }
    if (t.status !== "idle" && S.editing && S.editing.tabId === t.id) return busyNote();   // (an edit waits for the answer)
    const segments = readInput();
    const contexts = segments.filter((s) => s.t === "pill").map((s) => s.ctx);
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // Keep the draft until the extension accepts it, including when routing cannot find an eligible model.
    S.pendingSend = { tabId: t.id, requestId, segments: JSON.stringify(segments), attachments: S.attachments.map((a) => a.id) };
    const editIndex = S.editing && S.editing.tabId === t.id ? S.editing.index : undefined;
    post({ type: "send", tabId: t.id, requestId, segments, contexts, attachments: S.pendingSend.attachments, editIndex });
    closePopup(); closeHistory();
    if (S.enh && S.enh.state !== "running") { S.enh = null; renderEnhance(); }
    voice.typed();   // (the "From your voice" note goes with the message)
  }

  function sendPicks(t) {
    if (!choices.anyPicked()) return false;
    const p = choices.pending();
    const note = readInput().filter((x) => x.t === "text").map((x) => x.v).join("").trim();
    if (p && p.cards.length) {
      p.cards.forEach((c, n) => post({ type: "answer", tabId: t.id, pid: c.pid, answers: c.answers, ...(note && n === p.cards.length - 1 ? { note } : {}) }));
    } else if (p && p.picks.length && t.status === "idle") {
      sendText(p.picks.map((x) => `${x.question} ${x.choices.join(", ")}`).join("\n") + (note ? `\n\n${note}` : ""), p.picks);
    } else { flash("Pick an answer for each question on the card, then press Send", 2400); return true; }
    input.replaceChildren(); choices.clear(); renderChips();
    return true;
  }
  // A message from the page itself (your picks, a question about a question), sent like one typed in the box.
  function sendText(text, picks) {
    const t = S.tab;
    if (!t || t.visiting || !String(text || "").trim()) return;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    post({ type: "send", tabId: t.id, requestId, segments: [{ t: "text", v: String(text) }], contexts: [], attachments: [], ...(picks && picks.length ? { picks } : {}) });
  }

  // Kural took the message you sent (as a new message, or into the queue): the box and its attachments empty (only if
  // you haven't typed something else since).
  function acceptDraft(requestId) {
    const P = S.pendingSend;
    if (!P || !S.tab || P.tabId !== S.tab.id || !requestId || requestId !== P.requestId) return;
    if (JSON.stringify(readInput()) === P.segments) input.replaceChildren();
    S.attachments = S.attachments.filter((a) => !P.attachments.includes(a.id));
    S.pendingSend = null; renderChips();
    if (S.editing && S.editing.tabId === S.tab.id) { S.editing = null; renderEditBar(); }
  }

  // --- caret ---
  let savedRange = null;
  function saveRange() {
    const sel = window.getSelection();
    if (sel.rangeCount && input.contains(sel.getRangeAt(0).startContainer)) savedRange = sel.getRangeAt(0).cloneRange();
  }
  document.addEventListener("selectionchange", saveRange, on);
  function caretRange() {
    if (savedRange && input.contains(savedRange.startContainer)) return savedRange;
    const r = document.createRange(); r.selectNodeContents(input); r.collapse(false); return r;
  }
  function insertNodes(nodes, range) {
    input.focus();
    const r = range || caretRange();
    r.deleteContents();
    const frag = document.createDocumentFragment();
    let lastNode = null;
    for (const n of nodes) { frag.append(n); lastNode = n; }
    r.insertNode(frag);
    const sel = window.getSelection(), after = document.createRange();
    after.setStartAfter(lastNode); after.collapse(true);
    sel.removeAllRanges(); sel.addRange(after);
    saveRange();
  }
  const insertPill = (ctx, range) => insertNodes([pillNode(ctx, false), document.createTextNode(" ")], range);

  // --- text from the chat as context ---
  // Select text in the chat (an answer, or a message you sent) and "Add to chat" puts it into your message as a quote
  // pill; what it says goes to the AI with your message (buildPrompt in lib/chat/index.js).
  const MAX_QUOTE = 8000;   // (a selection of the whole chat would otherwise be saved with every message)
  const quoteBtn = el("button", { class: "quote-btn", title: "Add the selected text to your message",
    onmousedown: (e) => e.preventDefault(),   // (a click would clear the selection before it's read)
    onclick: () => addQuote() }, icon("quote"), " Add to chat");
  // "Ask" opens a side chat under the answer the text is in (only for text in an answer, not in your own message or in a side chat).
  const askBtn = el("button", { class: "quote-btn hidden", title: "Ask a quick question about the selected text, right under the answer",
    onmousedown: (e) => e.preventDefault(), onclick: () => askAbout() }, icon("comment-discussion"), " Ask");
  const quoteBar = el("div", { class: "quote-bar hidden" }, askBtn, quoteBtn);
  app.append(quoteBar);
  function chatSelection() {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return null;
    const r = sel.getRangeAt(0), text = sel.toString().trim();
    return text && listEl.contains(r.commonAncestorContainer) ? { r, text } : null;
  }
  // The answer (message index) a selection lies in, if it can be asked about.
  function askTarget(s) {
    const a = s.r.commonAncestorContainer, node = a.nodeType === 1 ? a : a.parentElement;
    const msg = node && node.closest ? node.closest(".msg.assistant") : null;
    if (!msg || node.closest(".side") || !node.closest(".answer")) return -1;
    const i = Number(msg.getAttribute("data-i"));
    return Number.isInteger(i) && S.tab.messages[i] && S.tab.messages[i].role === "assistant" ? i : -1;
  }
  function placeQuoteBtn() {
    const s = S.tab && !S.tab.visiting ? chatSelection() : null;
    if (!s) { quoteBar.classList.add("hidden"); return; }
    const rects = s.r.getClientRects(), at = rects[rects.length - 1] || s.r.getBoundingClientRect();
    askBtn.classList.toggle("hidden", askTarget(s) < 0);
    quoteBar.classList.remove("hidden");
    const w = quoteBar.offsetWidth, h = quoteBar.offsetHeight, box = listEl.getBoundingClientRect(), col = app.getBoundingClientRect();
    // Under the selection's last line; above it when that's off the bottom of the chat. (Placed in the column: chat.css .col.)
    const top = at.bottom + 6 + h <= box.bottom ? at.bottom + 6 : Math.max(box.top + 4, at.top - h - 6);
    quoteBar.style.top = `${top - col.top}px`;
    quoteBar.style.left = `${Math.max(6, Math.min(at.right - col.left - w, col.width - w - 6))}px`;
  }
  function addQuote() {
    const s = chatSelection();
    quoteBar.classList.add("hidden");
    if (!s) return;
    const text = s.text.length > MAX_QUOTE ? `${s.text.slice(0, MAX_QUOTE)}…` : s.text, line = text.replace(/\s+/g, " ");
    insertPill({ kind: "quote", text, label: line.length > 40 ? `${line.slice(0, 40).trimEnd()}…` : line });
  }
  function askAbout() {
    const s = chatSelection(), i = s ? askTarget(s) : -1;
    quoteBar.classList.add("hidden");
    if (i < 0) return;
    const text = s.text;
    getSelection().removeAllRanges();
    side.start(i, text);
  }
  document.addEventListener("mouseup", () => setTimeout(placeQuoteBtn, 0), on);   // (after the click has set the selection)
  document.addEventListener("selectionchange", () => { if (!quoteBar.classList.contains("hidden") && !chatSelection()) quoteBar.classList.add("hidden"); }, on);
  listEl.addEventListener("scroll", () => quoteBar.classList.add("hidden"));
  // Side chat: a quick question under an answer (media/side.js). "Add to chat" under a side answer joins it to your message as a quote.
  const side = window.KURAL_SIDE({ el, icon, markdown: (t, finished) => md.markdown(t, finished), post, tab: () => S.tab, rerender: (i) => rerender(i), root: () => listEl,
    addToChat: ({ text, label }) => { const line = label.replace(/\s+/g, " "), t = text.length > MAX_QUOTE ? `${text.slice(0, MAX_QUOTE)}…` : text;
      insertPill({ kind: "quote", text: t, label: line.length > 40 ? `${line.slice(0, 40).trimEnd()}…` : line }); input.focus(); } });

  // Listen: an answer explained out loud (media/listen.js; the host half is lib/listen). Its sound plays in this page only.
  const listen = window.KURAL_LISTEN({ el, icon, post, tab: () => S.tab, root: () => listEl, rerender: (i) => rerender(i),
    AudioContext: window.AudioContext, every: (fn, ms) => setInterval(fn, ms), stopEvery: (id) => clearInterval(id) });
  voice.bar.after(listen.dock);   // (its player sits just above the chat box, by voice input's bar)

  // --- @ mentions, and "/" for your skills and commands ---

  function checkMention() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return closePopup();
    const r = sel.getRangeAt(0);
    const node = r.startContainer;
    if (node.nodeType !== 3 || !input.contains(node)) return closePopup();
    const before = node.data.slice(0, r.startOffset);
    // "/" as the first thing in the box or after a space or new line anywhere: your shortcuts, then Claude's skills and
    // commands (the host moves a skill to the front: Claude runs one only when the message starts with it). `lead`: it's
    // the first thing in the box; elsewhere nothing matching closes the list ("see /usr/bin" is a path).
    const sl = before.match(/(?:^|\s)\/([^\s/]*)$/);
    if (sl) {
      S.popup = { kind: "slash", node, start: r.startOffset - sl[1].length - 1, end: r.startOffset, query: sl[1], index: 0, items: [],
        lead: sl.index === 0 && atStart(node) };
      return renderPopup();
    }
    const m = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (!m) return closePopup();
    if (!S.files.length) post({ type: "files" });
    S.popup = { kind: "file", node, start: r.startOffset - m[1].length - 1, end: r.startOffset, query: m[1], index: 0, items: [] };
    renderPopup();
  }
  // Nothing before this text node in the box (no pill, no earlier line).
  function atStart(node) {
    const r = document.createRange(); r.selectNodeContents(input); r.setEnd(node, 0);
    return !r.toString().trim() && !r.cloneContents().querySelector(".pill");
  }

  // Best first: the name (or an alias, or the part after "plugin:") starting with what you typed, then names containing
  // it, then descriptions containing it.
  function slashScore(c, q) {
    if (!q) return 1;
    const ql = q.toLowerCase(), names = [c.name, ...(c.aliases || []), c.name.split(":").pop()].map((n) => n.toLowerCase());
    if (names.some((n) => n === ql)) return 100;
    if (names.some((n) => n.startsWith(ql))) return 90 - c.name.length / 100;
    if (names.some((n) => n.includes(ql))) return 70 - c.name.length / 100;
    return (c.description || "").toLowerCase().includes(ql) ? 30 : 0;
  }

  function score(path, q) {
    if (!q) return 1;
    const p = path.toLowerCase(), b = base(p), ql = q.toLowerCase();
    if (b.startsWith(ql)) return 100 - b.length / 100;
    if (b.includes(ql)) return 80 - b.length / 100;
    if (p.includes(ql)) return 60 - p.length / 1000;
    let j = 0; for (const ch of p) if (ch === ql[j]) j++;           // letters in order ("mnpy" → main.py)
    return j === ql.length ? 20 - p.length / 1000 : 0;
  }

  function renderPopup() {
    const P = S.popup;
    if (!P) return;
    if (P.kind === "slash") return renderSlash(P);
    P.items = S.files.map((f) => [score(f, P.query), f]).filter((x) => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 12).map((x) => x[1]);
    P.index = Math.min(P.index, Math.max(0, P.items.length - 1));
    popupEl.classList.remove("hidden");
    const rows = P.items.length
      ? P.items.map((f, i) => el("div", { class: `pop-item ${i === P.index ? "sel" : ""}`, onmousedown: (e) => { e.preventDefault(); P.index = i; pickMention(); } },
        el("span", { class: "pop-name" }, base(f)), el("span", { class: "pop-dir" }, dir(f))))
      : [el("div", { class: "pop-empty" }, S.files.length ? "No matching files" : "Loading files…")];
    popupEl.replaceChildren(...rows);
  }

  // Your shortcuts first (marked "Your shortcut"), then Claude's skills and commands, anywhere in the message (a
  // skill with a shortcut's name is left out: yours wins). Without shortcuts the last row makes one (Kural Settings).
  function renderSlash(P) {
    const list = S.tab && S.slash[S.tab.id] || { items: [], why: "Loading your skills…" };
    const mine = S.shortcuts.map((x) => ({ name: x.name, description: x.text.split("\n").find((l) => l.trim()) || "", text: x.text, shortcut: true }));
    const names = new Set(mine.map((x) => x.name));
    const pool = [...mine, ...list.items.filter((c) => !names.has(c.name))];
    const ranked = (items) => items.map((c) => [slashScore(c, P.query), c]).filter((x) => x[0] > 0).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
    P.items = [...ranked(pool.filter((c) => c.shortcut)), ...ranked(pool.filter((c) => !c.shortcut))].slice(0, 50);
    if (!mine.length) P.items.push({ make: true, name: "" });
    P.index = Math.min(P.index, Math.max(0, P.items.length - 1));
    popupEl.classList.remove("hidden");
    const row = (c, i) => c.make
      ? el("div", { class: `pop-item pop-cmd pop-make ${i === P.index ? "sel" : ""}`, title: "A name that stands for a text you write once, like /pr-summary (Kural Settings → Shortcuts)", onmousedown: (e) => { e.preventDefault(); P.index = i; pickMention(); } },
        icon("add"), el("span", { class: "pop-desc" }, "Make a shortcut…"))
      : el("div", { class: `pop-item pop-cmd ${i === P.index ? "sel" : ""}`, title: c.shortcut ? c.text.slice(0, 600) : c.description || c.name, onmousedown: (e) => { e.preventDefault(); P.index = i; pickMention(); } },
        el("span", { class: "pop-name" }, `/${c.name}`), c.shortcut ? el("span", { class: "pop-hint" }, "Your shortcut") : c.hint && el("span", { class: "pop-hint" }, c.hint),
        el("span", { class: "pop-desc" }, c.description || ""));
    // In the middle of a message nothing matching closes the list ("see /usr/bin" is a path); there, "Make a shortcut…"
    // shows only right after the "/".
    const found = P.items.some((c) => !c.make);
    if (!P.lead && !found && (mine.length || P.query)) { closePopup(); return; }
    const why = list.items.length || mine.length ? "No shortcut, skill or command matches" : list.why || "No skills or commands";
    const rows = [...(found || !P.lead ? [] : [el("div", { class: "pop-empty" }, why)]), ...P.items.filter((c) => found || c.make).map(row)];
    popupEl.replaceChildren(...rows);
    const sel = popupEl.querySelector(".pop-item.sel");
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: "nearest" });
  }

  function pickMention() {
    const P = S.popup;
    if (!P || !P.items.length) return;
    if (P.kind === "slash") {
      const c = P.items[P.index], r = document.createRange();
      if (c.make) { closePopup(); post({ type: "editShortcuts" }); return; }
      if (c.shortcut) {   // "/pr" → the /pr-summary chip
        r.setStart(P.node, Math.max(0, P.start)); r.setEnd(P.node, Math.min(P.node.data.length, P.end));
        closePopup();
        insertPill({ kind: "shortcut", name: c.name, text: c.text }, r);
        return;
      }
      // "/brain" → "/superpowers:brainstorming " (what you typed after it stays; in the middle of a message only the "/brain" is replaced).
      r.setStart(P.node, Math.max(0, P.start)); r.setEnd(P.node, Math.min(P.node.data.length, P.end));
      closePopup();
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      const after = P.node.data.slice(Math.min(P.node.data.length, P.end));
      document.execCommand("insertText", false, `/${c.name}${/^\s/.test(after) ? "" : " "}`);
      return;
    }
    const file = P.items[P.index];
    const r = document.createRange();
    r.setStart(P.node, Math.max(0, P.start)); r.setEnd(P.node, Math.min(P.node.data.length, P.end));
    closePopup();
    insertPill({ kind: "file", path: file }, r);
  }
  function closePopup() { S.popup = null; popupEl.classList.add("hidden"); }

  input.addEventListener("input", () => { checkMention(); requestAnimationFrame(caretIntoView); renderQueueBtn(); voice.typed(); });
  // A new line (Shift+Enter) or typing past the box's height: keep the line you're on in view. The box scrolls inside
  // (max-height); without this the caret went below its edge. At the end of the text, go to the very bottom (a caret on
  // an empty last line has no size to measure).
  function caretIntoView() {
    const sel = getSelection();
    if (!sel.rangeCount || !input.contains(sel.anchorNode)) return;
    const r = sel.getRangeAt(0);
    const tail = document.createRange(); tail.selectNodeContents(input); tail.setStart(r.endContainer, r.endOffset);
    if (!tail.toString().trim()) { input.scrollTop = input.scrollHeight; return; }
    const at = r.getBoundingClientRect(), box = input.getBoundingClientRect();
    if (!at.height) return;
    if (at.bottom > box.bottom) input.scrollTop += at.bottom - box.bottom + 4;
    else if (at.top < box.top) input.scrollTop -= box.top - at.top + 4;
  }
  // The box growing (a new line) makes the conversation above shorter: if you were at its end, stay there.
  new ResizeObserver(() => { if (stick) toBottom(); }).observe(composer);
  input.addEventListener("keydown", (e) => {
    const P = S.popup;
    // (No skill matches what you typed: Enter sends it as it is.)
    if (P && P.kind === "slash" && !P.items.length && e.key === "Enter") closePopup();
    else if (P) {
      if (e.key === "ArrowDown") { e.preventDefault(); P.index = Math.min(P.items.length - 1, P.index + 1); renderPopup(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); P.index = Math.max(0, P.index - 1); renderPopup(); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(); return; }
      if (e.key === "Escape") { e.preventDefault(); closePopup(); return; }
    }
    if (e.key === "Escape" && voice.escape()) { e.preventDefault(); e.stopPropagation(); return; }   // (a recording first)
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
    else if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); document.execCommand("insertText", false, "\n"); requestAnimationFrame(caretIntoView); }
    else if (e.key === "Escape" && S.tab && S.tab.status !== "idle") post({ type: "stop", tabId: S.tab.id });
    else if (e.key === "Escape" && S.editing) { e.preventDefault(); cancelEdit(); }   // (Escape leaves editing an earlier message)
  });
  // Pasting code copied from the editor turns it into a "main.py (L3-9)" reference.
  let pasteRange = null;
  input.addEventListener("paste", (e) => {
    // A screenshot or copied file: attach it.
    const files = [...(e.clipboardData.files || [])];
    if (files.length) { e.preventDefault(); attachFiles(files); return; }
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    pasteRange = caretRange().cloneRange();
    post({ type: "paste", text });
  });

  // Files dropped on the chat or pasted: read them here and hand them to Kural.
  function attachFiles(files) {
    for (const f of files) {
      if (f.size > 40 * 1024 * 1024) { post({ type: "log", message: `skipped ${f.name}: too big to drop (use the + button)` }); continue; }
      const r = new FileReader();
      r.onload = () => {
        const name = f.name && f.name !== "image.png" ? f.name : `screenshot-${new Date().toTimeString().slice(0, 8).replace(/:/g, "")}.png`;
        post({ type: "attachData", tabId: S.tab && S.tab.id, name, data: String(r.result).split(",")[1] || "" });
      };
      r.readAsDataURL(f);
    }
  }
  const dropTarget = app;
  // (Drags from the editor's own file explorer reach here when you hold Shift. Files from Finder or another
  // file manager can't: VS Code blocks those from web pages like this chat, so use + or paste instead. A dragged chat
  // tab never gets here: media/chat-columns.js takes it first.)
  dropTarget.addEventListener("dragover", (e) => {
    e.preventDefault();
    const ok = e.dataTransfer.effectAllowed || "all";
    e.dataTransfer.dropEffect = /copy|all/i.test(ok) ? "copy" : /move/i.test(ok) ? "move" : "link";
    composer.classList.add("drop");
  });
  dropTarget.addEventListener("dragleave", (e) => { if (!e.relatedTarget || !app.contains(e.relatedTarget)) composer.classList.remove("drop"); });
  dropTarget.addEventListener("drop", (e) => {
    e.preventDefault();
    composer.classList.remove("drop");
    const dt = e.dataTransfer;
    // From VS Code's file explorer: a list of file URIs. From your computer: the files themselves.
    const uriList = dt.getData("application/vnd.code.uri-list") || dt.getData("text/uri-list");
    const uris = uriList ? uriList.split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#")) : [];
    try { const res = JSON.parse(dt.getData("resourceurls") || "[]"); for (const u of res) if (!uris.includes(u)) uris.push(u); } catch { /* not from the explorer */ }
    if (uris.length) post({ type: "attachUris", tabId: S.tab && S.tab.id, uris });
    else if (dt.files && dt.files.length) attachFiles([...dt.files]);
  });

  // ---------- menus ----------
  function openMenu(kind, anchor) {
    if (S.menu === kind) return closeMenu();
    S.menu = kind;
    const t = S.tab;
    let items;
    menuEl.classList.toggle("wide", kind === "ticket" || kind === "device");
    if (kind === "add") {
      // (No "Link ticket" or "Pick from a browser" here any more, Adithya 22 Oct 2026: the browser's own bar adds
      // elements, and a ticket already linked keeps its chip with ×.)
      items = [
        el("div", { class: "mi", onclick: () => { closeMenu(); post({ type: "attachPick" }); } },
          el("span", { class: "mi-icon" }, icon("attach")), el("span", { class: "mi-label" }, "Add files"), el("span", { class: "mi-hint" }, "images, PDFs, code")),
        el("div", { class: "mi", onclick: () => { closeMenu(); S.deviceUI = null; post({ type: "devices" }); openMenu("device", anchor); } },
          el("span", { class: "mi-icon" }, icon("remote")), el("span", { class: "mi-label" }, t.device ? "Change device" : "Link device"),
          el("span", { class: "mi-hint" }, "Raspberry Pi, board computer… over SSH"))];
    } else if (kind === "more") {
      // The tab line's "…" (it was the panel title bar's; Adithya: everything in one place).
      const run = (what) => () => { closeMenu(); post({ type: "panelCommand", what }); };
      const row = (what, ic, label, hint) => el("div", { class: "mi", onclick: run(what) },
        el("span", { class: "mi-icon" }, icon(ic)), el("span", { class: "mi-label" }, label), hint ? el("span", { class: "mi-hint" }, hint) : null);
      items = [row("settings", "settings-gear", "Kural Settings"), row("getStarted", "rocket", "Get started", "set up an AI"),
        row("updates", "sync", "Check for updates"), row("whatsNew", "megaphone", "What's new")];
    } else if (kind === "device") {
      items = deviceItems(t);
    } else if (kind === "ticket") {
      items = ticketItems(t);
    } else if (kind === "mode") {
      // (No radio circles here, Adithya: the mode you're in is the highlighted row.)
      items = [el("div", { class: "mh" }, "Mode", el("span", { class: "mh-key" }, keys("Control+P plan"))), ...S.modes.map((md) =>
        el("div", { class: `mi mode-row ${t.mode === md.id ? "on" : ""}`, "aria-checked": String(t.mode === md.id), role: "menuitemradio",
          onclick: () => { post({ type: "setMode", tabId: t.id, mode: md.id }); closeMenu(); } },
          el("span", { class: "mi-label" }, md.label), el("span", { class: "mi-hint" }, md.hint)))];
    } else {
      const editing = t.mode === "agent" || t.mode === "debug" || t.mode === "auto";
      const local = /^ollama:/.test(t.model || "");
      // Claude's models: usable once Claude is set up (Get started); before that they say so and open it.
      // "Search models", then the Auto switch. Auto on: only the router's profile (the models are the router's to pick);
      // off: every model, filtered by the search box.
      const auto = !!t.autoRoute;
      const search = auto ? null : el("div", { class: "msearch" }, icon("search"),
        el("input", { type: "text", class: "msearch-in", placeholder: "Search models", "aria-label": "Search models", value: S.modelQuery || "",
          oninput: (e) => { S.modelQuery = e.target.value; filterModels(menuEl, S.modelQuery); }, onkeydown: (e) => { if (e.key === "Escape" && e.target.value) { e.stopPropagation(); e.target.value = ""; S.modelQuery = ""; filterModels(menuEl, ""); } } }));
      const flip = () => {
        if (!auto) { post({ type: "setRouterProfile", tabId: t.id, profile: profileName(t.routingProfile) }); return; }
        const ids = selectableModels(), back = ids.includes(t.model) ? t.model : ids[0];   // (the model it had before Auto, else the first)
        if (back) post({ type: "setModel", tabId: t.id, model: back });
      };
      const autoRow = el("div", { class: `mi auto-row${auto ? " on" : ""}`, role: "switch", "aria-checked": String(auto), tabindex: "0",
        "aria-label": "Auto, Model Router: Balanced quality and speed, recommended for most tasks",
        onclick: flip, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); flip(); } } },
        el("span", { class: "auto-text" }, el("span", { class: "mi-label" }, "Auto"),
          el("span", { class: "auto-sub" }, "Balanced quality and speed, recommended for most tasks")),
        el("span", { class: `switch${auto ? " on" : ""}`, "aria-hidden": "true" }, el("span", { class: "knob" })));
      const profiles = !auto ? [] : [mhead("Router profile", "", "router"),
        ...["balance","cost","intelligence"].map((profile) => el("div", { class: `mi ${profileName(t.routingProfile) === profile ? "on" : ""}`,onclick: () => { post({ type: "setRouterProfile",tabId: t.id,profile }); closeMenu(); } },
          el("span", { class: `check radio${profileName(t.routingProfile) === profile ? " on" : ""}` }),el("span", { class: "mi-label" },cap(profile)),
          el("span", { class: "mi-hint" }, { balance: "quality, then speed",cost: "saves your usage limits",intelligence: "most capable" }[profile])))];
      const models = auto ? [] : [
        mhead("Claude", S.claudeReady ? "" : "not set up", S.claudeReady ? "claude" : null, true), ...S.models.map((m) =>
        el("div", { "data-q": `${m.label} claude`.toLowerCase(), class: `mi ${t.model === m.id ? "on" : ""} ${S.claudeReady ? "" : "dim"}`, onclick: () => {
          if (S.claudeReady) post({ type: "setModel", tabId: t.id, model: m.id }); else post({ type: "getStarted", path: "claude" });
          closeMenu(); } },
          el("span", { class: `check radio${t.model === m.id ? " on" : ""}` }),
          el("span", { class: "mi-label" }, m.label), el("span", { class: "mi-hint" }, S.claudeReady ? m.hint : "set up Claude…"))),
        ...cliMenuItems(t),
        ...localMenuItems(t)];
      items = [search, autoRow, ...profiles, ...models,
        el("div", { class: "mh" }, "Intensity", el("span", { class: "mh-key" }, keys("Control+M / H / O"))),
        el("div", { class: "seg" }, S.efforts.map((e) => el("button", { class: t.effort === e.id ? "on" : "", title: levelHint(t, e.id), onclick: () => post({ type: "setEffort", tabId: t.id, effort: e.id }) }, e.label))),
        levelNote(t),
        ...split.menuItems(t),
        // Preferences (moods in the code): the four built-in ones, then yours (Kural Settings → Preferences), then a way to add one.
        el("div", { class: "mh" }, "Preference"),
        el("div", { class: "moods" }, S.moods.map((md) => el("button", { class: `mood-chip${t.mood === md.id ? " on" : ""}`, title: md.hint || "",
          "aria-pressed": String(t.mood === md.id), onclick: () => post({ type: "setMood", tabId: t.id, mood: md.id }) }, md.label)),
          el("button", { class: "mood-chip mood-add", title: "Add your own: who the AI should be and how it works with you (Kural Settings → Preferences)",
            onclick: () => { closeMenu(); post({ type: "editMoods" }); } }, icon("add"), " Add your own…")),
        ];
    }
    menuEl.replaceChildren(...items.filter(Boolean));
    menuEl.classList.remove("hidden");
    if (kind === "model") {
      if (S.modelQuery) filterModels(menuEl, S.modelQuery);
      const box = menuEl.querySelector(".msearch-in");
      if (box && S.modelQuery) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
    }
    const a = anchor.getBoundingClientRect(), col = app.getBoundingClientRect();   // (placed in the column: chat.css .col)
    menuEl.style.left = Math.max(6, Math.min(a.left - col.left, col.width - menuEl.offsetWidth - 6)) + "px";
    // (The tab line's "…" is at the top: its menu opens downwards; the box's menus open upwards.)
    if (kind === "more") { menuEl.style.top = (a.bottom - col.top + 4) + "px"; menuEl.style.bottom = ""; }
    else { menuEl.style.top = ""; menuEl.style.bottom = (col.bottom - a.top + 6) + "px"; }
    openMenu.anchor = anchor;
    if (kind === "ticket" && S.ticketUI) S.ticketUI.input.focus();   // keep typing after the list updates
    if (kind === "device" && S.deviceUI && S.deviceUI.focus) { const f = S.deviceUI.focus; S.deviceUI.focus = null; f.focus(); }
  }
  // A Gemini model comes in thinking levels (agy lists "… (Low)", "… (High)"): the intensity picks one. Which levels
  // this model has, and what each intensity button runs.
  const LEVEL_NEAR = { low: ["low", "minimal", "medium", "high"], medium: ["medium", "high", "low"], high: ["high", "medium", "xhigh", "low"], max: ["max", "xhigh", "high", "medium", "low"] };
  function geminiLevels(t) {
    const c = /^agy:(.+)$/.exec(t.model || ""); if (!c) return null;
    const cli = (S.clis || []).find((x) => x.id === "agy");
    const m = cli && cli.models.find((x) => x.id === c[1]);
    return m && m.efforts && Object.keys(m.efforts).length ? m.efforts : null;
  }
  const cap = (w) => w[0].toUpperCase() + w.slice(1);
  // Auto profiles were Balanced/Speed/Quality before Oct 2026 (lib/router/policy.js ALIASES).
  const profileName = (p) => ({ balanced: "balance", speed: "cost", quality: "intelligence" })[p] || p || "balance";
  function levelHint(t, effort) {
    const lv = geminiLevels(t); if (!lv) return "";
    const got = (LEVEL_NEAR[effort] || []).find((x) => lv[x]);
    return got ? `Runs ${modelLabel(t.model)} (${cap(got)})` : "";
  }
  function levelNote(t) {
    const lv = geminiLevels(t); if (!lv) return null;
    const order = ["minimal", "low", "medium", "high", "xhigh", "max"].filter((x) => lv[x]);
    return el("div", { class: "mi-note" }, `${modelLabel(t.model)} thinks at ${order.map(cap).join(", ")}: the intensity picks the nearest.`);
  }

  // ---------- Gemini and Codex ----------
  // Set up: a section with their models (from the program itself). Not set up: not in the menu (Adithya: set them up in
  // Get started or Kural Settings).
  const cliModels = (c) => (c.models.length ? c.models : [{ id: "default", label: `${c.short} (its default model)` }]).slice(0, 8);
  // Every model the menu lists (when Auto goes off, the chat goes back to one of these).
  function selectableModels() {
    const out = S.claudeReady ? S.models.map((m) => m.id) : [];
    for (const c of S.clis || []) if (c.ready) out.push(...cliModels(c).map((m) => `${c.id}:${m.id}`));
    const L = S.local;
    if (L && L.status.running && L.status.ok) out.push(...L.models.filter((x) => x.chat).map((x) => `ollama:${x.name}`));
    return out;
  }
  // Search models: hides the rows that don't match, and a heading with none left (no rebuild: the box keeps the keyboard).
  function filterModels(box, query) {
    const q = String(query || "").trim().toLowerCase();
    let head = null, any = false;
    const end = () => { if (head) head.classList.toggle("hidden", !!q && !any); };
    for (const n of box.children) {
      if (n.classList.contains("mh-model")) { end(); head = n; any = false; }
      else if (n.getAttribute("data-q") !== null) { const hit = !q || n.getAttribute("data-q").includes(q); n.classList.toggle("hidden", !hit); any = any || hit; }
      else if (n.classList.contains("mh") || n.classList.contains("seg")) { end(); head = null; }
    }
    end();
  }
  function cliMenuItems(t) {
    const out = [];
    for (const c of S.clis || []) {
      if (!c.ready) continue;
      out.push(mhead(c.label, c.account || "", c.id, true));
      for (const m of cliModels(c)) {
        const id = `${c.id}:${m.id}`;
        out.push(el("div", { "data-q": `${m.label} ${c.label}`.toLowerCase(), class: `mi ${!t.autoRoute && t.model === id ? "on" : ""}`, title: m.description || "", onclick: () => { post({ type: "setModel", tabId: t.id, model: id }); closeMenu(); } },
          el("span", { class: `check radio${!t.autoRoute && t.model === id ? " on" : ""}` }), el("span", { class: "mi-label ln" }, m.label),
          el("span", { class: "mi-hint" }, m.isDefault ? "default" : "")));
      }
    }
    return out;
  }

  // ---------- models on this computer (Ollama) ----------
  // In the model menu: the installed models that can chat (they need tools), and the way to get more.
  function localMenuItems(t) {
    // Ask Ollama again when the menu opens (models come and go); the menu redraws when the answer comes.
    // (At most every few seconds: the redraw itself calls this again.)
    if (!S.localAskedAt || Date.now() - S.localAskedAt > 3000) { S.localAskedAt = Date.now(); post({ type: "localModels" }); }
    // Only when there's a model that can chat; finding and downloading them is in Kural Settings (Your own model) now.
    const L = S.local;
    const chat = L && L.status.running && L.status.ok ? L.models.filter((x) => x.chat) : [];   // (models without tools can't chat)
    if (!chat.length) return [];
    const out = [mhead("On this computer", "offline", "local", true)];
    for (const m of chat) {
      const id = `ollama:${m.name}`;
      out.push(el("div", { "data-q": `${m.name} ollama local`.toLowerCase(), class: `mi ${!t.autoRoute && t.model === id ? "on" : ""}`, onclick: () => { post({ type: "setModel", tabId: t.id, model: id }); closeMenu(); } },
        el("span", { class: `check radio${!t.autoRoute && t.model === id ? " on" : ""}` }), el("span", { class: "mi-label ln", title: m.name }, m.name), el("span", { class: "mi-hint" }, [m.params, gb(m.size)].filter(Boolean).join(" · "))));
    }
    return out;
  }

  // The "Local models" page (in the chat panel, like History).
  function openLocal() {
    closeHistory(); S.showLocal = true;
    post({ type: "localModels" });
    if (!S.localSearch) post({ type: "localSearch", q: "" });
    renderLocal();
  }
  function closeLocal() { S.showLocal = false; S.confirmDeleteModel = null; localEl.classList.add("hidden"); listEl.classList.remove("hidden"); }

  function renderLocal() {
    if (!S.showLocal) return;
    listEl.classList.add("hidden"); historyEl.classList.add("hidden"); localEl.classList.remove("hidden");
    const L = S.local, R = S.localSearch;
    const t = S.tab;
    const pulls = (L && L.pulls) || {};
    const memory = L ? L.memory : 0;
    const search = el("input", { class: "h-search", placeholder: "Search Ollama's models (ones that can use tools)…", value: S.localQuery || "",
      onkeydown: (e) => { if (e.key === "Enter") { S.localQuery = e.target.value; S.localSearching = true; post({ type: "localSearch", q: e.target.value }); renderLocal(); } else if (e.key === "Escape") closeLocal(); } });
    const kids = [
      el("div", { class: "h-head" }, backBtn(closeLocal), el("span", { class: "h-title" }, "Models on this computer")),
      el("div", { class: "lm-note" }, "They run on your computer with Ollama: private, free, and they work offline. Slower and less capable than the big cloud models; bigger ones need more memory",
        memory ? ` (this computer has ${memory} GB).` : "."),
    ];
    if (!L) kids.push(el("div", { class: "h-empty" }, "Looking for Ollama…"));
    else if (!L.status.running) kids.push(el("div", { class: "lm-warn" }, "Ollama isn't running. ", el("button", { class: "cb primary", onclick: () => post({ type: "installOllama" }) }, "Install Ollama"),
      el("button", { class: "cb", onclick: () => post({ type: "localModels" }) }, "Check again")));
    else if (!L.status.ok) kids.push(el("div", { class: "lm-warn" }, icon("warning"), ` Your Ollama is ${L.status.version}. The chat needs ${L.minVersion} or newer: update Ollama.`));
    // Downloads in progress
    for (const [name, p] of Object.entries(pulls)) kids.push(el("div", { class: "lm-pull" },
      el("div", { class: "lm-row" }, el("span", { class: "lm-name" }, name), el("span", { class: "spacer" }), el("span", { class: "h-when" }, `${p.percent || 0}%`)),
      el("div", { class: "bar" }, el("span", { style: `width:${p.percent || 0}%` }))));
    // Installed
    const chatModels = L ? L.models.filter((x) => x.chat) : [];   // models without tools can't chat: not listed
    if (chatModels.length) {
      kids.push(el("div", { class: "h-group" }, "Installed"));
      for (const m of chatModels) {
        const id = `ollama:${m.name}`, using = t && t.model === id, confirming = S.confirmDeleteModel === m.name;
        kids.push(el("div", { class: "lm-item" },
          el("div", { class: "lm-row" }, el("span", { class: "lm-name" }, m.name), el("span", { class: "spacer" }),
            m.chat ? el("button", { class: `cb ${using ? "" : "primary"}`, disabled: using ? "" : null, onclick: () => { post({ type: "setModel", tabId: t.id, model: id }); closeLocal(); } }, using ? "In use" : "Use in chat") : null,
            confirming ? el("button", { class: "cb danger", onclick: () => { S.confirmDeleteModel = null; post({ type: "localDelete", name: m.name }); } }, "Delete?")
              : el("button", { class: "icon-btn small show", title: "Delete from this computer", onclick: () => { S.confirmDeleteModel = m.name; renderLocal(); } }, icon("trash"))),
          el("div", { class: "h-meta" }, [m.params, gb(m.size)].filter(Boolean).join(" · "))));
      }
    }
    // Search
    kids.push(el("div", { class: "h-group" }, "Get more"), search);
    if (S.localSearching) kids.push(el("div", { class: "h-empty" }, "Searching…"));
    else if (R) {
      if (R.from === "suggested") kids.push(el("div", { class: "lm-note" }, "Couldn't reach ollama.com, so these are Kural's suggestions."));
      if (!R.results.length) kids.push(el("div", { class: "h-empty" }, "No models found."));
      for (const m of R.results) {
        const local = m.sizes;   // (cloud-only models are already left out)
        kids.push(el("div", { class: "lm-item" },
          el("div", { class: "lm-row" }, el("span", { class: "lm-name" }, noEmoji(m.name)), el("span", { class: "spacer" }), m.pulls ? el("span", { class: "h-when" }, `${m.pulls} pulls`) : null),
          m.description ? el("div", { class: "lm-desc" }, noEmoji(m.description)) : null,
          el("div", { class: "lm-sizes" },
            ...m.capabilities.filter((c) => c !== "cloud").map((c) => el("span", { class: "lm-cap" }, noEmoji(c))),
            ...local.map((z) => {
              const name = `${m.name}:${z.size}`, have = L && L.models.some((x) => x.name === name), busy = !!pulls[name];
              const tooBig = memory && z.memory && z.memory > memory;
              return el("button", { class: `cb lm-size ${tooBig ? "danger" : ""}`, disabled: have || busy ? "" : null,
                title: have ? "Already on this computer" : `Download ${name}${z.memory ? `; needs about ${z.memory} GB of memory` : ""}${tooBig ? ` (this computer has ${memory} GB: too big)` : ""}`,
                onclick: () => post({ type: "localPull", name }) }, have ? [icon("check"), ` ${z.size}`] : [icon("cloud-download"), ` ${z.size}${z.memory ? ` · ~${z.memory} GB` : ""}`]);
            }))));
      }
    }
    localEl.replaceChildren(...kids.filter(Boolean));
  }

  // "+ → Link device": your saved devices (SSH), link one to this chat, or add one. The password goes to Kural once, to
  // put Kural's SSH key on the device; it isn't saved anywhere.
  function deviceItems(t) {
    const local = /^ollama:/.test(t.model || "");
    if (!S.deviceUI) S.deviceUI = { adding: !(S.devices || []).length && S.devicesLoaded, busy: false, error: "" };
    const U = S.deviceUI;
    const out = [el("div", { class: "mh" }, "Link a device to this chat", el("span", { class: "mh-key" }, "SSH"))];
    if (local) out.push(el("div", { class: "ticket-warn" }, el("span", { class: "warn-tri" }, icon("warning"), " "), "A model on this computer can't use a device: pick a Claude, Codex or Gemini model."));
    if (!S.devicesLoaded) out.push(el("div", { class: "ticket-status" }, "Loading your devices…"));
    for (const d of S.devices || []) {
      const on = t.device && t.device.id === d.id;
      out.push(el("div", { class: `mi ticket-row${on ? " on" : ""}`, title: `${d.user}@${d.host}${d.port !== 22 ? `:${d.port}` : ""}${d.system ? `
${d.system}` : ""}`,
        onclick: () => { post({ type: "linkDevice", tabId: t.id, id: d.id }); closeMenu(); input.focus(); } },
        el("span", { class: `check radio${on ? " on" : ""}` }), el("span", { class: "ticket-key" }, d.name),
        el("span", { class: "ticket-sum" }, `${d.user}@${d.host}`),
        el("button", { class: "icon-btn small show", title: `Open a terminal on ${d.name}`, onclick: (e) => { e.stopPropagation(); post({ type: "deviceTerminal", id: d.id }); closeMenu(); } }, icon("terminal"))));
    }
    if (!U.adding) {
      out.push(el("div", { class: "mi", onclick: () => { U.adding = true; U.error = ""; openMenu.refresh(); } },
        el("span", { class: "mi-icon" }, icon("add")), el("span", { class: "mi-label" }, "Add a device…")));
    } else out.push(deviceForm(t));
    if (t.device) out.push(el("div", { class: "sep" }), el("div", { class: "mi", onclick: () => { post({ type: "linkDevice", tabId: t.id, id: null }); closeMenu(); } },
      el("span", { class: "mi-icon" }, icon("close")), el("span", { class: "mi-label" }, `Unlink ${t.device.name}`)));
    if ((S.devices || []).length) out.push(el("div", { class: "mi", onclick: () => { post({ type: "manageDevices" }); closeMenu(); } },
      el("span", { class: "mi-icon" }, icon("settings-gear")), el("span", { class: "mi-label" }, "Manage devices…"), el("span", { class: "mi-hint" }, "password, remove")));
    return out;
  }
  function deviceForm(t) {
    const U = S.deviceUI;
    if (!U.form) {
      const f = (ph, type = "text", value = "") => el("input", { class: "ticket-q dev-in", placeholder: ph, type, value, spellcheck: "false", autocomplete: "off" });
      U.form = { name: f("Name, e.g. rpi-lab"), host: f("Address, e.g. 192.168.1.20 or raspberrypi.local"), port: f("Port", "number", "22"),
        user: f("Username, e.g. pi"), password: f("Password", "password") };
      for (const i of Object.values(U.form)) i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
      U.focus = U.form.name;
    }
    const F = U.form;
    const submit = () => {
      if (U.busy) return;
      U.busy = true; U.error = ""; U.reqId = Date.now();
      post({ type: "addDevice", tabId: t.id, reqId: U.reqId, device: { name: F.name.value, host: F.host.value, port: F.port.value, user: F.user.value, password: F.password.value } });
      openMenu.refresh();
    };
    return el("div", { class: "dev-form" },
      F.name, F.host, el("div", { class: "dev-row" }, F.user, F.port), F.password,
      U.error ? el("div", { class: "ticket-warn" }, el("span", { class: "warn-tri" }, icon("warning"), " "), U.error) : null,
      el("div", { class: "dev-row" },
        U.busy ? el("span", { class: "ticket-status" }, el("span", { class: "dots small" }, el("span"), el("span"), el("span")), " Connecting…")
          : el("button", { class: "cb primary solid", onclick: submit }, "Connect & save"),
        el("span", { class: "spacer" }),
        el("span", { class: "dev-note" }, icon("key"), " Used once to set up a key on the device. Not saved.")));
  }

  // "+ → Link ticket": search Jira (through your Atlassian connector) and link one ticket to this chat.
  function ticketItems(t) {
    const jira = (S.setups[t.id] || {}).jira || { ok: true };
    if (!S.ticketUI) {
      S.ticketUI = { query: "", id: 0, searching: false, issues: null, note: "", error: "" };
      S.ticketUI.input = el("input", { class: "ticket-q", placeholder: "Key (PROJ-123) or words, then Enter", spellcheck: "false" });
      S.ticketUI.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ticketSearch(S.ticketUI.input.value); } });
      if (jira.ok) setTimeout(() => { ticketSearch(""); S.ticketUI && S.ticketUI.input.focus(); }, 0);   // start with your recent tickets
    }
    const U = S.ticketUI;
    const out = [el("div", { class: "mh" }, "Link a Jira ticket to this chat")];
    if (!jira.ok) {
      out.push(el("div", { class: "ticket-warn" }, el("span", { class: "warn-tri" }, icon("warning"), " "), jira.why));
      return out;
    }
    out.push(el("div", { class: "ticket-search" }, U.input));
    if (U.searching) out.push(el("div", { class: "ticket-status" }, el("span", { class: "dots small" }, el("span"), el("span"), el("span")),
      " ", U.status || (U.query ? `Searching Jira for “${U.query}”…` : "Getting your recent tickets…")));
    else if (U.error) out.push(el("div", { class: "ticket-warn" }, el("span", { class: "warn-tri" }, icon("warning"), " "), U.error),
      el("div", { class: "mi", onclick: () => ticketSearch(U.query) }, el("span", { class: "mi-icon" }, icon("refresh")), el("span", { class: "mi-label" }, "Try again")));
    else if (U.issues && !U.issues.length) out.push(el("div", { class: "ticket-status" }, U.note || "No tickets found. Try other words or the ticket's key."));
    for (const i of (!U.searching && U.issues) || []) out.push(el("div", { class: `mi ticket-row${t.ticket && t.ticket.key === i.key ? " on" : ""}`, title: i.summary,
      onclick: () => { post({ type: "linkTicket", tabId: t.id, ticket: i }); closeMenu(); input.focus(); } },
      el("span", { class: "ticket-key" }, i.key), i.type ? el("span", { class: "ticket-type" }, i.type) : null,
      el("span", { class: "ticket-sum" }, i.summary), i.status ? el("span", { class: "mi-hint" }, i.status) : null));
    if (t.ticket) out.push(el("div", { class: "sep" }), el("div", { class: "mi", onclick: () => { post({ type: "linkTicket", tabId: t.id, ticket: null }); closeMenu(); } },
      el("span", { class: "mi-icon" }, icon("close")), el("span", { class: "mi-label" }, `Unlink ${t.ticket.key}`)));
    return out;
  }
  function ticketSearch(q) {
    const U = S.ticketUI; if (!U) return;
    U.query = q.trim(); U.id = Date.now(); U.searching = true; U.error = ""; U.note = ""; U.status = "";
    post({ type: "ticketSearch", tabId: S.tab.id, query: U.query, id: U.id });
    if (S.menu === "ticket") openMenu.refresh();
  }

  // A section's heading in the model menu, with a gear that opens that AI's settings (Kural Settings, on its card:
  // connectors, when to switch away near a limit; for Auto, the Model Router). (Claude Code's setup and connectors were
  // shown here; Adithya: keep the menu clean, put them in settings.)
  function mhead(label, key, ai, model) {
    const names = { router: "Model Router settings", local: "Your own model's settings" };
    const what = names[ai] || `${label} settings: connectors, when to switch near a limit`;
    return el("div", { class: `mh mh-gear${model ? " mh-model" : ""}` }, el("span", {}, label), el("span", { class: "spacer" }), key ? el("span", { class: "mh-key" }, key) : null,
      ai ? el("button", { class: "mh-btn", title: what, "aria-label": what, onclick: (e) => { e.stopPropagation(); closeMenu(); post({ type: "aiSettings", ai }); } }, icon("settings-gear")) : null);
  }
  openMenu.refresh = () => { const k = S.menu; S.menu = null; if (k) openMenu(k, openMenu.anchor); };
  function closeMenu() { S.menu = null; S.modelQuery = ""; menuEl.classList.add("hidden"); }
  // Clicking outside the panel (in the editor) or pressing Esc closes menus and the @ list.
  window.addEventListener("blur", () => { closeMenu(); closePopup(); }, on);
  document.addEventListener("keydown", (e) => {
    if (!port.active()) return;   // (another column has the keyboard)
    if (e.key === "Escape" && voice.escape()) { e.preventDefault(); return; }   // (cancels a recording: nothing is kept)
    if (e.key === "Escape" && S.menu) { e.preventDefault(); closeMenu(); input.focus(); return; }
    if (e.key === "Escape" && S.showHistory) { e.preventDefault(); closeHistory(); input.focus(); return; }
    // Tab shortcuts work while you're typing in the chat, too.
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.altKey && (e.key === "n" || e.key === "N")) { e.preventDefault(); S.focusNext = true; post({ type: "newTab" }); }
    else if (mod && e.key === "PageDown") { e.preventDefault(); cycleTab(1); }
    else if (mod && e.key === "PageUp") { e.preventDefault(); cycleTab(-1); }
  }, on);
  function cycleTab(d) {
    const i = S.tabs.findIndex((t) => t.id === S.activeId);
    if (i >= 0 && S.tabs.length > 1) { S.focusNext = true; post({ type: "switchTab", id: S.tabs[(i + d + S.tabs.length) % S.tabs.length].id }); }
  }
  document.addEventListener("mousedown", (e) => {
    if (S.menu && !menuEl.contains(e.target) && !modeBtn.contains(e.target) && !modelBtn.contains(e.target) && !attachBtn.contains(e.target)) closeMenu();
  }, on);
  listEl.addEventListener("click", (e) => {
    const remote = e.target.closest && e.target.closest(".img-remote");
    if (remote) { remote.replaceWith(el("img", { class: "md-img", src: remote.dataset.url, "data-url": remote.dataset.url, alt: remote.dataset.alt || "", title: "Click to open it full size" })); return; }
    // A picture: full size in its own editor tab.
    const pic = e.target.closest && e.target.closest("img.md-img[data-path], img.md-img[data-url]");
    if (pic) { post({ type: "openImage", path: pic.dataset.path, url: pic.dataset.url }); return; }
    const a = e.target.closest && e.target.closest("a.link[data-url]");
    if (a) { e.preventDefault(); post({ type: "openUrl", url: a.dataset.url }); return; }
    const f = e.target.closest && e.target.closest("a.link[data-path]");
    if (f) { e.preventDefault(); post({ type: "openFile", path: f.dataset.path, line: +f.dataset.line || undefined, endLine: +f.dataset.end || undefined }); return; }
    const r = e.target.closest && e.target.closest("code.ref");
    if (r) post({ type: "openFile", path: r.dataset.path, line: +r.dataset.line || undefined });
  });

  // A picture that can't be shown (moved, outside the folders Kural may show): its name instead of a broken image.
  listEl.addEventListener("error", (e) => {
    const t = e.target;
    if (t && t.tagName === "IMG" && (t.classList.contains("md-img") || t.classList.contains("att-photo"))) {
      t.replaceWith(el("span", { class: "img-missing" }, icon("file-media"), " ", t.alt || "image"));
    }
  }, true);

  // ---------- messages from the extension ----------
  const lastAssistant = () => { const m = S.tab && S.tab.messages; return m && m.length && m[m.length - 1].role === "assistant" ? m.length - 1 : -1; };
  let pending = null;
  const scheduleRerender = (i) => { if (pending === null) { pending = i; requestAnimationFrame(() => { const k = pending; pending = null; patches.clear(); if (S.tab && S.tab.messages[k]) rerender(k); }); } };
  // Streaming: the growing blocks are redrawn about 15 times a second (all deltas since the last redraw at once). Every
  // frame was 60 a second: Ross measured the page using 15 % of a core while an answer streamed.
  const patches = new Set();
  const PATCH_MS = 66;
  let patchTimer = null, lastPatch = 0;
  const schedulePatch = (i, k) => {
    if (pending !== null) return;   // a full redraw is coming anyway
    patches.add(`${i}:${k}`);
    if (patchTimer) return;
    patchTimer = setTimeout(() => requestAnimationFrame(() => {
      patchTimer = null; lastPatch = Date.now();
      const keys = [...patches]; patches.clear();
      for (const key of keys) { const [a, b] = key.split(":").map(Number); if (S.tab && S.tab.messages[a]) patchBlock(a, b); }
    }), Math.max(0, PATCH_MS - (Date.now() - lastPatch)));
  };
  const findAgent = (id) => { const i = lastAssistant(); return i >= 0 ? [i, S.tab.messages[i].blocks.find((b) => b.k === "agent" && b.id === id)] : [i, null]; };

  // (media/chat-columns.js hands each column the messages that are for it.)
  function onMessage(m) {
    const mine = S.tab && m.tabId === S.tab.id;
    switch (m.type) {
      case "config":
        S.models = m.models; S.efforts = m.efforts; S.modes = m.modes; S.version = m.version || ""; S.notReady = m.ready === false; S.claudeReady = m.claudeReady !== false; S.clis = m.clis || [];
        S.moods = m.moods || []; S.shortcuts = m.shortcuts || []; S.pics = m.pics || S.pics;
        renderFoot(); if (S.tab && !S.tab.messages.length) renderAll(); break;
      case "shortcuts": S.shortcuts = m.shortcuts || []; if (S.popup && S.popup.kind === "slash") renderPopup(); break;
      case "moods": S.moods = m.moods || S.moods; renderFoot(); if (S.menu === "model") openMenu.refresh(); break;
      case "tabs":
        const wasStatus = S.tab && S.tab.status;
        S.tabs = m.tabs; S.activeId = m.activeId;
        // A chat dragged into the editor area: its editor tab is its tab, so no tab bar of its own. In a column of the
        // side panel (split): its title above it.
        tabBar.classList.toggle("hidden", !!m.single);
        colHead.classList.toggle("hidden", !m.column);
        if (S.tab) { const s = m.tabs.find((x) => x.id === S.tab.id); if (s) Object.assign(S.tab, { status: s.status, model: s.model, effort: s.effort, mode: s.mode, title: s.title,
          split: s.split, workers: s.workers, splitOn: s.splitOn, mood: s.mood, ticket: s.ticket, device: s.device, queued: s.queued,
          autoRoute: s.autoRoute,routingProfile: s.routingProfile,routingState: s.routingState,modelName: s.modelName,tokens: s.tokens,context: s.context }); }
        renderTabs(); renderFoot(); renderChips(); if (S.menu) openMenu.refresh();
        if (S.tab) { const i = lastAssistant(); if (i >= 0 && (S.tab.messages[i].planReady || S.tab.status !== wasStatus)) rerender(i); }
        renderPending();
        break;
      case "setupReady": S.notReady = !m.ready; S.claudeReady = m.claudeReady !== false; if (m.clis) S.clis = m.clis; renderAll(); if (S.menu) openMenu.refresh(); break;
      case "showLocal": openLocal(); break;
      case "full": listen.onFull(m.tab && m.tab.id); S.tab = m.tab; renderAll(); renderEditBar(); enhanceTab(m.tab && m.tab.id); renderEnhance(); voice.tabChanged(); if (S.menu) closeMenu(); if (S.focusNext) { S.focusNext = false; input.focus(); } break;
      case "openLocal": closeMenu(); openLocal(); break;
      // Auto mode, a big task: "Use 3 agents?" for 15 s above the box; no answer = one agent.
      case "history": S.history = m.items; S.hereName = m.here || ""; renderHistory(); break;
      case "localModels": S.local = m; renderLocal(); if (S.menu === "model") openMenu.refresh(); break;
      case "localSearch": S.localSearch = m; S.localSearching = false; renderLocal(); break;
      case "localPull": if (S.local) { S.local.pulls = { ...(S.local.pulls || {}), [m.name]: { percent: m.percent, status: m.status } }; renderLocal(); } break;
      case "devices": S.devices = m.list || []; S.devicesLoaded = true; if (S.deviceUI && !S.devices.length) S.deviceUI.adding = true; if (S.menu === "device") openMenu.refresh(); break;
      case "deviceAdded": {
        const U = S.deviceUI;
        S.devices = m.list || S.devices;
        if (!U || U.reqId !== m.id) break;
        U.busy = false;
        if (m.ok) { S.deviceUI = null; if (S.menu === "device") closeMenu(); input.focus(); }
        else { U.error = m.error || "Couldn't connect."; if (S.menu === "device") openMenu.refresh(); }
        break;
      }
      case "ticketStatus": { const U = S.ticketUI; if (U && U.id === m.id && U.searching) { U.status = m.text; if (S.menu === "ticket") openMenu.refresh(); } break; }
      case "ticketResults": {
        const U = S.ticketUI;
        if (!U || U.id !== m.id) break;            // an older search
        U.searching = false; U.issues = m.issues || []; U.note = m.note || ""; U.error = m.error || "";
        if (S.menu === "ticket") openMenu.refresh();
        break;
      }
      case "showHistory": openHistory(); break;
      case "modelName": if (mine) { S.tab.modelName = m.name; renderFoot(); } break;
      case "append": if (mine) {
        if (m.msgs.some((x) => x.role === "user")) acceptDraft(m.requestId);
        for (const x of m.msgs) S.tab.messages.push(x); renderAll();
      } break;
      // A message you sent while it answered is in the queue (Kural took it: the box empties), or left it.
      case "queued": if (mine) { acceptDraft(m.requestId); S.tab.queued = m.queued || []; renderQueue(); renderQueueBtn(); } break;
      // Queued messages it never took in (you pressed Stop, or it stopped): back into the box, before what you're typing.
      case "unqueue": if (mine) {
        S.tab.queued = m.queued || [];
        const nodes = [];
        for (const it of m.items || []) {
          if (nodes.length) nodes.push(document.createTextNode("\n\n"));
          for (const x of it.segments || []) nodes.push(x.t === "text" ? document.createTextNode(x.v) : pillNode(x.ctx, false));
        }
        if (nodes.length) {
          if (!isEmptyInput()) nodes.push(document.createTextNode("\n\n"));
          const first = input.firstChild;
          for (const n of nodes) input.insertBefore(n, first);
          input.focus();
          const lost = (m.items || []).some((it) => it.attachments);
          flash(`Your queued message${m.items.length > 1 ? "s are" : " is"} back in the box${lost ? ": add the attachments again with +" : ""}`, 2600);
        }
        renderQueue(); renderQueueBtn();
      } break;
      case "delta": if (mine) {
        const i = lastAssistant(); if (i < 0) break;
        const msg = S.tab.messages[i];
        let b = msg.blocks[msg.blocks.length - 1];
        if (!b || b.k !== "text") { b = { k: "text", text: "" }; msg.blocks.push(b); b.text += m.text; appendBlock(i); break; }
        b.text += m.text; schedulePatch(i, msg.blocks.length - 1);
      } break;
      case "block": if (mine) { const i = lastAssistant(); if (i >= 0) { S.tab.messages[i].blocks.push(m.block); appendBlock(i); } } break;
      case "thinkDelta": if (mine) {
        const i = lastAssistant(); if (i < 0) break;
        const blocks = S.tab.messages[i].blocks, b = blocks[blocks.length - 1];
        if (b && b.k === "think") { b.text += m.text; schedulePatch(i, blocks.length - 1); }
      } break;
      case "agentActivity": if (mine) { const [i, a] = findAgent(m.agentId); if (a) { a.activity = m.activity; scheduleRerender(i); } } break;
      case "agentStep": if (mine) { const [i, a] = findAgent(m.agentId); if (a) { a.steps.push(m.step); scheduleRerender(i); } } break;
      case "agentState": if (mine) { const [i, a] = findAgent(m.agentId); if (a) { a.state = m.state; if (m.why) a.why = m.why; scheduleRerender(i); } } break;
      case "questionState": if (mine) { const i = lastAssistant(); if (i >= 0) { for (const b of S.tab.messages[i].blocks) if (b.pid === m.pid) { b.state = m.state; b.answers = m.answers; if (m.ask) b.ask = m.ask; } scheduleRerender(i); } } break;
      case "splitState": if (mine) { const i = lastAssistant(); if (i >= 0) { for (const b of S.tab.messages[i].blocks) if (b.pid === m.pid) Object.assign(b, { state: m.state, tasks: m.tasks || b.tasks, change: m.change }); scheduleRerender(i); } } break;
      case "permState": if (mine) { const i = lastAssistant(); if (i >= 0) { for (const b of S.tab.messages[i].blocks) if (b.pid === m.pid) b.state = m.state; scheduleRerender(i); } } break;
      case "patch": if (mine) { const i = m.index != null ? m.index : lastAssistant(); if (i >= 0) { Object.assign(S.tab.messages[i], m.msg); rerender(i); } renderFoot(); } break;
      case "sideDelta": if (mine) side.delta(m); break;
      case "sideState": if (mine) side.set(m); break;
      case "allowAll": break;
      case "files": S.files = m.files; if (S.popup) renderPopup(); break;
      case "pics": S.pics = m.pics; break;
      case "insertPill":
        closeHistory(); insertPill(m.ctx);
        if (m.text) document.execCommand("insertText", false, m.text);   // (a comment typed in the browser starts your message)
        input.focus();
        break;
      case "pasted":
        if (m.ctx) insertPill(m.ctx, pasteRange);
        else { input.focus(); if (pasteRange) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(pasteRange); } document.execCommand("insertText", false, m.text); }
        pasteRange = null; break;
      case "focus": input.focus(); break;
      case "setup": S.setups[m.tabId] = m.setup; if (S.menu === "model") openMenu.refresh(); break;
      case "enhanceState": onEnhanceState(m); break;
      case "voiceState": voice.onState(m); break;
      case "listenState": case "listenAudio": case "listenEnd": listen.onMessage(m); break;
      case "voiceToggle": voice.toggle(); break;
      case "slash": S.slash[m.tabId] = m.slash; if (S.popup && S.popup.kind === "slash" && S.tab && S.tab.id === m.tabId) renderPopup(); break;
      case "attached": S.attachments.push(...m.items); renderChips(); input.focus(); break;
      case "userAttachments": if (mine) {
        for (let i = S.tab.messages.length - 1; i >= 0; i--) if (S.tab.messages[i].role === "user") { S.tab.messages[i].attachments = m.attachments; scheduleRerender(i); break; }
      } break;
      case "flash": {   // a shortcut changed the model / intensity / mode: say so briefly
        let f = app.querySelector(".flash");
        if (!f) { f = el("div", { class: "flash" }); app.append(f); }
        f.textContent = m.text; f.classList.add("on");
        clearTimeout(S.flashTimer); S.flashTimer = setTimeout(() => f.classList.remove("on"), 1300);
        break;
      }
    }
  }

  renderTabs(); renderAll(); renderChips();
  post({ type: "ready" });
  return { onMessage, close: () => off.abort() };
};
