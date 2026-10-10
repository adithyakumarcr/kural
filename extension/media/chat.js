// The Kural chat panel UI. A small web page inside the editor that talks to
// lib/chat.js through postMessage. No outside libraries, so it works offline.
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  // Text size follows the code editor's font (set by Kural; see lib/ui.js).
  const setFs = (v) => { if (v) document.documentElement.style.setProperty("--fs", v); };
  setFs(document.documentElement.dataset.fs);
  // Tell Kural when the chat has the keyboard, so its shortcuts (Ctrl+M, Ctrl+P, …) apply only here.
  window.addEventListener("focus", () => vscode.postMessage({ type: "focusChanged", focused: true }));
  window.addEventListener("blur", () => vscode.postMessage({ type: "focusChanged", focused: false }));
  window.addEventListener("error", (e) => vscode.postMessage({ type: "log", message: `${e.message} (${e.filename}:${e.lineno})` }));

  const S = {
    tabs: [], activeId: null, tab: null,
    models: [], efforts: [], modes: [], teamSizes: [2, 3, 4, 5], version: "",
    attachments: [], setups: {},
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
  const post = (m) => vscode.postMessage(m);
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
  const FRIENDS = ["Rachel", "Ross", "Monica", "Chandler", "Joey", "Phoebe"];
  const roleLabel = (id) => (S.roles.find((r) => r.id === id) || { label: id }).label;
  const moodLabel = (id) => (S.moods.find((m) => m.id === id) || { label: "" }).label;
  const effortLabel = (id) => (S.efforts.find((e) => e.id === id) || { label: "Medium" }).label;
  const modeLabel = (id) => (S.modes.find((m) => m.id === id) || { label: "Agent" }).label;
  const pillLabel = (c) => c.kind === "selection" ? `${base(c.path)} (L${c.startLine}-${c.endLine})` : c.kind === "element" || c.kind === "quote" ? c.label : base(c.path);
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

  function inline(s) {
    return esc(s)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (_, alt, src) => imageHtml(alt, src))
      .replace(/`([^`]+)`/g, (_, c) => {
        const m = c.match(/^([\w./-]+\.[A-Za-z0-9]+)(?::(\d+)(?:-(\d+))?)?$/);
        return m ? `<code class="ref" data-path="${m[1]}" data-line="${m[2] || ""}">${c}</code>` : `<code>${c}</code>`;
      })
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/(^|[^"])\[([^\]]+)\]\(([^)\s]+)\)/g, (_, pre, text, url) => pre + (/^https?:\/\//.test(url)
        ? `<a class="link" data-url="${url}" title="${url}">${text}</a>` : fileLink(text, url)))
      // A bare web address: clickable too (not inside `code`, a link or a picture made above).
      .split(/(<code[^>]*>[\s\S]*?<\/code>|<a [^>]*>[\s\S]*?<\/a>|<img [^>]*>|<span class="img-[^>]*>[\s\S]*?<\/span>)/).map((part, i) => i % 2 ? part
        : part.replace(/(^|[\s(>])(https?:\/\/[^\s<"]+[^\s<".,:;!?)\]'])/g, '$1<a class="link" data-url="$2">$2</a>')
          .replace(/(^|[\s(>])(www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<"]*[^\s<".,:;!?)\]'])?)/gi, '$1<a class="link" data-url="https://$2">$2</a>')).join("");
  }

  // "| a | b |" → ["a", "b"]   (a "|" inside `code` doesn't split)
  function cells(line) {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    const out = []; let cur = "", code = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "`") code = !code;
      if (ch === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
      if (ch === "|" && !code) { out.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  }
  const isSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
  const isRow = (line) => /^\s*\|.*\|\s*$/.test(line) || (line.includes("|") && line.trim().split("|").length > 2);

  function table(head, aligns, rows) {
    const al = (i) => aligns[i] ? { style: `text-align:${aligns[i]}` } : {};
    return el("div", { class: "table-wrap" }, el("table", {},
      el("thead", {}, el("tr", {}, head.map((h, i) => el("th", { ...al(i), html: inline(h) })))),
      el("tbody", {}, rows.map((r) => el("tr", {}, head.map((_, i) => el("td", { ...al(i), html: inline(r[i] || "") })))))));
  }

  function markdown(src, finished) {
    const out = [], lines = src.split("\n");
    let para = [], list = null;
    const flushPara = () => { if (para.length) { out.push(el("p", { html: inline(para.join(" ")) })); para = []; } };
    const flushList = () => { if (list) { out.push(list); list = null; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = line.match(/^\s*```(.*)$/);
      if (fence) {
        flushPara(); flushList();
        const code = []; let closed = false;
        for (i++; i < lines.length; i++) { if (/^\s*```\s*$/.test(lines[i])) { closed = true; break; } code.push(lines[i]); }
        out.push(codeCard(fence[1].trim(), code.join("\n"), closed || finished));
        continue;
      }
      // Table: a header row, then a |---|---| row, then data rows.
      if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
        flushPara(); flushList();
        const head = cells(line);
        const aligns = cells(lines[i + 1]).map((c) => /^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : "");
        const rows = [];
        for (i += 2; i < lines.length && isRow(lines[i]) && lines[i].trim(); i++) rows.push(cells(lines[i]));
        i--;
        out.push(table(head, aligns, rows));
        continue;
      }
      // Some answers squeeze a whole table onto one line: "| a | b || --- | --- || 1 | 2 |". Unsqueeze it.
      if (/\|\s*\|\s*:?-{2,}/.test(line) && (line.match(/\|\|/g) || []).length >= 2) {
        const rowsText = line.replace(/\|\s*\|/g, "|\n|").split("\n");
        if (rowsText.length > 2 && isSep(rowsText[1])) { lines.splice(i, 1, ...rowsText); i--; continue; }
      }
      const h = line.match(/^(#{1,4})\s+(.*)$/), li = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
      if (h) { flushPara(); flushList(); out.push(el(`h${Math.min(6, h[1].length + 2)}`, { html: inline(h[2]) })); }
      else if (li) { flushPara(); if (!list) list = el(/^\s*\d/.test(line) ? "ol" : "ul"); list.append(el("li", { html: inline(li[1]) })); }
      else if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flushPara(); flushList(); out.push(el("hr")); }
      else if (!line.trim()) { flushPara(); flushList(); }
      else { flushList(); para.push(line); }
    }
    flushPara(); flushList();
    return out;
  }

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
  const SHELL_LANGS = /^(sh|bash|zsh|shell|console)$/i;
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
    return el("div", { class: "code" },
      el("div", { class: "code-head" },
        file ? el("span", { class: "code-file", title: "Open file", onclick: () => post({ type: "openFile", path: file }) }, file)
          : el("span", { class: "code-lang" }, lang || "code"),
        el("span", { class: "spacer" }),
        btn("Copy", "Copy to clipboard", () => post({ type: "copy", code })),
        btn("Insert", "Insert at the cursor", () => post({ type: "insert", code })),
        btn("Apply", file ? `Apply to ${file} and review` : "Apply to the open file and review", () => post({ type: "apply", code, path: file }), "primary")),
      el("pre", {}, el("code", {}, highlight(code, lang))));
  }

  // ---------- layout ----------
  const tabsEl = el("div", { class: "tabs" });
  const historyBtn = el("button", { class: "icon-btn", title: "All chats (history)", onclick: () => toggleHistory() }, icon("clock"));
  // "+" and the clock stay put; only the tabs scroll (mouse wheel scrolls them sideways).
  const newTabBtn = el("button", { class: "tab-new", title: keys("New chat (Ctrl+Alt+N)"), onclick: () => { S.focusNext = true; closeHistory(); post({ type: "newTab" }); } }, icon("plus"));
  const tabBar = el("div", { class: "tabbar" }, tabsEl, newTabBtn, historyBtn);
  tabsEl.addEventListener("wheel", (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { tabsEl.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  const listEl = el("div", { class: "list" });
  // Follow new text only while you're at the bottom. Scrolled up to read? It stays put, and "Jump to latest" appears.
  let stick = true;
  const jumpBtn = el("button", { class: "jump hidden", title: "Jump to the latest", onclick: () => { stick = true; toBottom(); } }, icon("arrow-down"), " Latest");
  const atBottom = () => listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 24;
  const toBottom = () => { listEl.scrollTop = listEl.scrollHeight; jumpBtn.classList.add("hidden"); };
  const follow = () => { if (stick) toBottom(); else jumpBtn.classList.remove("hidden"); };
  listEl.addEventListener("scroll", () => { stick = atBottom(); if (stick) jumpBtn.classList.add("hidden"); });
  const historyEl = el("div", { class: "history hidden" });
  const localEl = el("div", { class: "history local hidden" });   // "Local models": search, download, use
  const chipsEl = el("div", { class: "chips" });
  const input = el("div", { class: "input", contenteditable: "plaintext-only", role: "textbox", "aria-multiline": "true", "data-placeholder": "" });
  const popupEl = el("div", { class: "popup hidden" });
  const menuEl = el("div", { class: "menu hidden" });
  const modeBtn = el("button", { class: "pick mode-pick", title: "Mode", onclick: (e) => openMenu("mode", e.currentTarget) });
  const modelBtn = el("button", { class: "pick", title: "Model, intensity and agent team", onclick: (e) => openMenu("model", e.currentTarget) });
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
  const composer = el("div", { class: "composer" }, popupEl, queueEl, editBar, chipsEl, input,
    el("div", { class: "foot" }, attachBtn, modeBtn, modelBtn, el("span", { class: "spacer" }), ctxEl,
      queueBtn, sendBtn));   // (type @ to mention a project file; + attaches anything)
  // A chat from another workspace: read it here; to go on, open its folder or continue it here.
  const visitBar = el("div", { class: "visit hidden" });
  const body = el("div", { class: "body" }, listEl, historyEl, localEl, jumpBtn);
  app.replaceChildren(tabBar, body, visitBar, composer, menuEl);

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
          title: `${t.title}\n${modelLabel(t.model)} · ${effortLabel(t.effort)} · ${modeLabel(t.mode)}${t.team ? ` · ${t.team} agents` : ""}\nDouble-click to rename`,
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
          // Drag a tab into the editor area: it opens there, split like VS Code's own editors (lib/chat/tab-editor.js).
          draggable: "true",
          ondragstart: (e) => {
            const uri = `kural-chat:/${t.id}.kuralchat`;
            e.dataTransfer.effectAllowed = "copyMove";
            e.dataTransfer.setData("ResourceURLs", JSON.stringify([uri]));
            e.dataTransfer.setData("text/uri-list", uri);
            e.dataTransfer.setData("text/plain", t.title);
          },
        },
        el("span", { class: "dot" }),
        el("span", { class: "tab-title" }, t.title),
        el("button", { class: "tab-x", title: "Close (stays in history)", onclick: (e) => { e.stopPropagation(); post({ type: "closeTab", id: t.id }); } }, icon("close")));
      }));
    const a = tabsEl.querySelector(".tab.active");
    if (a) a.scrollIntoView({ block: "nearest", inline: "nearest" });
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
        el("div", { class: "hints" }, hint("@", "mention a file"), hint("+", "attach"), hint("Ctrl+K", "edit in place")),
        S.version ? el("div", { class: "version" }, S.version) : null));
    } else {
      t.messages.forEach((m, i) => listEl.append(messageNode(m, i)));
    }
    stick = true; toBottom();
    renderFoot();
  }

  function rerender(i) {
    const old = listEl.querySelector(`[data-i="${i}"]`);
    const node = messageNode(S.tab.messages[i], i);
    if (old) old.replaceWith(node); else listEl.append(node);
    follow();
  }

  // While an answer streams in, only the part that grew is redrawn (a text block, or the thinking box's text), not the
  // whole message: the rest of the page doesn't move, and the thinking box keeps its scroll position.
  function patchBlock(i, k) {
    const msg = S.tab.messages[i], b = msg && msg.blocks[k];
    const wrap = listEl.querySelector(`[data-i="${i}"] [data-b="${k}"]`);
    if (!b || !wrap) return rerender(i);
    if (b.k === "text") wrap.replaceChildren(...markdown(b.text, !msg.running));
    else if (b.k === "think") {
      const body = wrap.querySelector(".think-body"), line = wrap.querySelector(".think-line");
      if (!body) return rerender(i);
      if (line) line.textContent = lastLine(b.text);
      if (b._open) {   // (closed: nothing to draw until you open it)
        const end = body.scrollHeight - body.scrollTop - body.clientHeight < 16;   // following its end?
        body.textContent = b.text;
        if (end) body.scrollTop = body.scrollHeight;
      } else body.textContent = b.text;
    } else return rerender(i);
    const line = listEl.querySelector(`[data-i="${i}"] .steps-line`);
    if (line) line.textContent = currentStep(msg, layout(msg).group);
    follow();
  }

  // Pills in sent messages open the file when clicked; pills you're still typing don't. A quote (text you selected in
  // the chat) opens nothing: pointing at it shows what it says.
  function pillNode(ctx, openable = true) {
    const quote = ctx.kind === "quote";
    return el("span", { class: `pill ${ctx.kind}`, contenteditable: "false", "data-ctx": JSON.stringify(ctx),
      title: quote ? String(ctx.text || "").slice(0, 600) : ctx.kind === "element" ? `${ctx.label} on ${ctx.path}${ctx.element && ctx.element.text ? `\n"${ctx.element.text.slice(0, 80)}"` : ""}` : openable ? `Open ${ctx.path}` : ctx.path,
      onclick: !openable || quote ? null : ctx.kind === "element" ? () => post({ type: "browser", url: ctx.path }) : () => post({ type: "openFile", path: ctx.path, line: ctx.startLine, endLine: ctx.endLine }) },
      ctx.kind === "element" || quote ? el("span", { class: "pill-icon" }, icon(quote ? "quote" : "inspect")) : el("span", { class: "pill-icon" }, ctx.kind === "selection" ? "{ }" : "@"),
      quote ? el("span", { class: "pill-text" }, pillLabel(ctx)) : pillLabel(ctx));
  }

  // Each block in its own wrapper (display: contents), so a streamed delta redraws just that block (patchBlock), and a
  // new block is added without redrawing the others (appendBlock).
  function blockNode(m, b, k, inSteps = false) {
    const w = el("div", { class: `blk${inSteps && b.k === "text" ? " interim" : ""}`, "data-b": k });
    if (b.k === "text") w.append(...markdown(b.text, !m.running));
    else if (b.k === "tool") w.append(toolNode(b));
    else if (b.k === "perm") w.append(permNode(b));
    else if (b.k === "agent") w.append(agentNode(b));
    else if (b.k === "question") w.append(questionNode(b));
    else if (b.k === "think") w.append(thinkNode(b, m.running && !b.done));
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
    if (!out || (k > 0 && !prev) || pending !== null || msg.blocks[k].k === "perm" || msg.blocks[k].k === "question" || msg.blocks[k].k === "steer" ||
      parts(msg).some((p) => p.group.length)) return rerender(i);
    // A previous live thinking box is finished once something comes after it.
    if (prev && msg.blocks[k - 1].k === "think") prev.replaceWith(blockNode(msg, msg.blocks[k - 1], k - 1));
    const node = blockNode(msg, msg.blocks[k], k);
    // (The first block goes after the lines on top: which model answers, the team's note.)
    const after = k === 0 ? (out.querySelector(".team-note") || out.querySelector(".model-attribution") || null) : out.querySelector(`[data-b="${k - 1}"]`);
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
  const flash = (text, ms = 1600) => { const f = document.querySelector(".flash") || document.body.appendChild(el("div", { class: "flash" }));
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
        el("div", { class: "bubble" }, (m.segments || []).map((s) => s.t === "text" ? s.v : pillNode(s.ctx)),
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
    if (m.team) out.append(el("div", { class: "team-note" }, m.teamLabel || (m.teamStyle === "discuss" ? `Discussion between ${m.team} agents` : `Team of ${m.team} agents`)));
    const P = parts(m);
    P.forEach((p, n) => {
      if (p.group.length) out.append(stepsNode(m, p.group, n, n === P.length - 1));
      p.outside.forEach((k) => out.append(blockNode(m, m.blocks[k], k)));
      if (p.steer !== null) out.append(blockNode(m, m.blocks[p.steer], p.steer));   // what you added while it worked
    });
    const waiting = (m.blocks || []).some((b) => (b.k === "perm" || b.k === "question") && b.state === "pending");
    const asking = (m.blocks || []).some((b) => b.k === "question" && b.state === "pending");
    if (m.running && waiting) out.append(el("div", { class: "working" }, el("span", { class: "wait-dot" }), asking ? "Waiting for your answer above" : "Waiting for your OK above"));
    else if (m.running && (m.waitingFor || []).length) out.append(el("div", { class: "working" }, el("span", { class: "dots" }, el("span"), el("span"), el("span")),
      el("span", {}, `Waiting for ${listNames(m.waitingFor)} to finish — the answer comes when everyone has reported`),
      // Agents that take too long (or got stuck): stop them and get the answer from what's there.
      el("button", { class: "cb", title: "Stop the agents still working and have the lead answer with what it has", onclick: () => post({ type: "finishTeam", tabId: S.tab.id }) }, "Finish now")));
    else if (m.running) out.append(el("div", { class: "working" }, el("span", { class: "dots" }, el("span"), el("span"), el("span")),
      el("span", { class: "elapsed", "data-t0": m.t0 }, workingText(m.t0))));
    if (m.running && !waiting) out.append(dykNode(m));   // "Did you know?" while it works
    if (m.note) out.append(el("div", { class: "note" }, m.note));
    if (m.error === "stopped") out.append(el("div", { class: "note" }, "Stopped."));
    else if (m.error === "login") out.append(el("div", { class: "note warn" }, `${m.errorWho || "Claude"} isn't logged in. `, el("button", { class: "cb primary", onclick: () => post({ type: "login", tabId: S.tab.id }) }, "Log in")));
    else if (m.error === "missing") out.append(el("div", { class: "note warn" }, "Claude isn't set up yet. Open Kural: Get Started, or pick a model on your computer."));
    else if (m.error) out.append(el("div", { class: "note warn" }, m.error, " ", el("button", { class: "cb", onclick: () => post({ type: "showLog" }) }, "Open log")));
    if (m.planReady) out.append(el("div", { class: "plan-bar" },
      m.planBuilt ? el("span", { class: "row-state" }, icon("check"), " Building it") : [
        el("span", { class: "plan-q" }, "Happy with this plan?"),
        el("span", { class: "spacer" }),
        el("button", { class: "cb primary solid big", disabled: S.tab.status !== "idle", onclick: () => post({ type: "buildPlan", tabId: S.tab.id, msgIndex: i }) }, "Build it")]));
    if (m.changes && m.changes.length) out.append(changesNode(m, i));
    if (!m.running && m.ms && last) out.append(el("div", { class: "meta" }, `${(m.ms / 1000).toFixed(1)} s`));
    if (!m.running && !S.tab.visiting) out.append(el("div", { class: "answer-actions" }, forkButton(i)));
    return el("div", { class: "msg assistant", "data-i": i }, out);
  }

  const listNames = (n) => n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}` : n[0];
  function workingText(t0) {
    const s = Math.round((Date.now() - (t0 || Date.now())) / 1000);
    return s < 2 ? "Thinking…" : `Thinking… ${s}s`;
  }
  setInterval(() => {
    for (const e of listEl.querySelectorAll(".elapsed")) e.textContent = workingText(+e.dataset.t0);
    // A "Did you know?" appearing (after a few seconds) makes the answer taller: keep following it if you were.
    let grew = false;
    for (const d of listEl.querySelectorAll(".dyk")) { const was = !!d.firstChild; if (fillDyk(d, true) && !was && d.firstChild) grew = true; }
    if (grew) follow();
  }, 1000);

  // ---------- "Did you know?" while an answer is worked on ----------
  // One short Kural tip or programming fact (media/facts.js) under "Thinking…", from a few seconds in (a quick answer
  // shows none), a new one every 15 s, with a Know more link (opens like any web link in the chat: Kural's browser tab).
  // Which one shows is worked out from the time (the answer's start picks where the list begins), so redrawing the answer
  // while it streams keeps the same fact. Fixed height (three lines), so a new fact never moves the answer. Gone when the
  // answer ends; off with the setting kural.chat.didYouKnow.
  const FACTS = Array.isArray(window.KURAL_FACTS) ? window.KURAL_FACTS : [];
  const DYK_AFTER = 4000, DYK_EVERY = 15000;
  function factIndex(t0, now = Date.now()) {
    if (S.didYouKnow === false || !FACTS.length || !t0 || now - t0 < DYK_AFTER) return -1;
    const start = (Math.floor(t0 / 1000) * 7919) % FACTS.length;
    return (start + Math.floor((now - t0 - DYK_AFTER) / DYK_EVERY)) % FACTS.length;
  }
  function dykNode(m) { const node = el("div", { class: "dyk", "data-t0": m.t0 }); fillDyk(node, false); return node; }
  // Shows the fact for now; true when it changed. fresh: fades in (a new fact, not a redraw of the same one).
  function fillDyk(node, fresh) {
    const i = factIndex(+node.dataset.t0);
    if (String(i) === node.dataset.i) return false;
    node.dataset.i = String(i);
    if (i < 0) { node.replaceChildren(); return true; }
    const f = FACTS[i];
    node.replaceChildren(
      el("div", { class: "dyk-head" }, icon("lightbulb"), el("span", { class: "dyk-label" }, "Did you know?"), el("span", { class: "spacer" }),
        el("a", { class: "dyk-more", title: f.u, onclick: (e) => { e.preventDefault(); post({ type: "openUrl", url: f.u }); } }, "Know more")),
      el("div", { class: `dyk-text${fresh ? " fresh" : ""}`, title: f.t }, f.t));
    return true;
  }

  // ONE dropdown per answer for how it worked: thoughts, tool steps (reads, searches, commands, edits…), permission cards
  // you've answered, and the short notes the model writes between them, so the chat shows the answer, not a stack of
  // "Thought for…" boxes and commands (Adithya). What stays outside: the text after the last step (the answer), anything
  // waiting for you (a permission or a question), agents' cards, the team's messages and pictures.
  // A message you added while it worked ("steer") splits the answer in parts, each with its own dropdown: what it did
  // after reading your message shows after it, not above it.
  const isStep = (b) => b.k === "think" || (b.k === "tool" && b.name !== "mcp__team__post") || (b.k === "perm" && b.state !== "pending");
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
  const STEP_KIND = { Bash: "command", run_command: "command", Read: "read", Grep: "search", Glob: "search", read_file: "read", list_dir: "search",
    Edit: "edit", Write: "edit", NotebookEdit: "edit", write_file: "edit", WebSearch: "web search", WebFetch: "web page" };
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : w.endsWith("search") ? "es" : "s"}`;
  function stepsLabel(m, ks, live = true) {
    const count = {};
    for (const k of ks) {
      const b = m.blocks[k];
      const kind = b.k === "think" ? "thought" : b.k === "tool" ? STEP_KIND[(b.name || "").replace(/^mcp__device__/, "")] || "step" : null;
      if (kind) count[kind] = (count[kind] || 0) + 1;
    }
    const order = ["thought", "read", "search", "edit", "command", "web search", "web page", "step"];
    const kinds = order.filter((k) => count[k]).map((k) => plural(count[k], k));
    const secs = m.ms && live ? Math.max(1, Math.round(m.ms / 1000)) : 0;   // (the time: the whole answer's, on its last part)
    return `${m.running && live ? "Working…" : secs ? `Worked for ${secs} s` : "Worked"}${kinds.length ? ` · ${kinds.join(", ")}` : ""}`;
  }
  // While it works: what it's doing now (its latest thought, or the step).
  function currentStep(m, ks) {
    const b = ks.length && m.blocks[ks[ks.length - 1]];
    if (!b || !m.running) return "";
    if (b.k === "think") return lastLine(b.text);
    if (b.k === "tool") return `${TOOL_VERB[b.name] || deviceVerb(b.name) || prettyTool(b.name)} ${b.detail || ""}`;
    if (b.k === "text") return lastLine(b.text);
    return "";
  }
  // n: which part of the answer (see parts); live: the last part (its dropdown shows what it's doing now).
  function stepsNode(m, ks, n = 0, live = true) {
    const open = () => !!(m._stepsOpen && m._stepsOpen[n]);
    const running = m.running && live;
    const node = el("div", { class: `steps${open() ? " open" : ""}${running ? " live" : ""}` });
    node.append(
      el("div", { class: "steps-head", title: open() ? "Hide the steps" : "Show every step", onclick: () => {
        m._stepsOpen = { ...(m._stepsOpen || {}), [n]: !node.classList.contains("open") }; node.classList.toggle("open", open()); } },
        el("span", { class: "think-caret" }), el("span", { class: "steps-label" }, stepsLabel(m, ks, live)),
        running ? el("span", { class: "steps-line" }, currentStep(m, ks)) : null),
      el("div", { class: "steps-body" }, ks.map((k) => blockNode(m, m.blocks[k], k, true))));
    return node;
  }

  const TOOL_VERB = { Read: "Read", Grep: "Searched", Glob: "Listed", Edit: "Edited", Write: "Wrote", NotebookEdit: "Edited", Bash: "Command", WebSearch: "Searched web", WebFetch: "Web page" };
  // A linked device's tools.
  const DEVICE_VERB = { run_command: "Device command", read_file: "Read on device", write_file: "Wrote on device", list_dir: "Listed on device" };
  const deviceVerb = (name) => { const m = /^mcp__device__(run_command|read_file|write_file|list_dir)$/.exec(name || ""); return m ? DEVICE_VERB[m[1]] : null; };
  // "mcp__claude_ai_Notion__notion-search" -> "Notion · notion-search"
  function prettyTool(name) {
    const m = /^mcp__(.+?)__(.+)$/.exec(name || "");
    return m ? `${m[1].replace(/^claude[._ ]ai[_ ]/i, "").replace(/_/g, " ")} · ${m[2]}` : name;
  }
  function toolNode(b) {
    // Team messages: "Ross → Rachel: what's the number?" as a small chat bubble.
    if (b.name === "mcp__team__post") {
      const [who, ...rest] = b.detail.split(": ");
      return el("div", { class: "team-msg" }, el("span", { class: "team-who" }, who), " ", rest.join(": "));
    }
    if (b.name === "mcp__team__read") return el("div", { class: "tool team-wait" }, b.detail);
    const file = ["Read", "Edit", "Write", "NotebookEdit"].includes(b.name) ? b.detail.split("  (")[0] : null;
    const pic = file && b.name === "Read" && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file) ? fileSrc(file) : null;
    return el("div", { class: `tool ${b.name}` },
      el("span", { class: "tool-name" }, TOOL_VERB[b.name] || deviceVerb(b.name) || prettyTool(b.name)), " ",
      file ? el("span", { class: "tool-file", onclick: () => post({ type: "openFile", path: file }) }, b.detail)
        : b.name === "Bash" || /run_command$/.test(b.name) ? el("code", {}, b.detail) : el("span", {}, b.detail),
      pic ? el("img", { class: "md-img tool-img", src: pic, alt: base(file), title: "Click to open it full size", onclick: () => post({ type: "openImage", path: file }) }) : null);
  }

  // The model's thinking (short summaries). Always one line, so nothing around it moves while it thinks: "Thinking…"
  // with its latest sentence, then "Thought for 12 s". Click to read all of it.
  const lastLine = (t) => { const s = String(t || "").trim().split(/\n+/).filter(Boolean); return s.length ? s[s.length - 1].replace(/^[*#\s]+|\*+$/g, "") : ""; };
  function thinkNode(b, live) {
    const secs = b.ms ? Math.max(1, Math.round(b.ms / 1000)) : 0;
    const node = el("div", { class: `think${b._open ? " open" : ""}${live ? " live" : ""}` });
    node.append(
      el("div", { class: "think-head", onclick: () => { b._open = !node.classList.contains("open"); node.classList.toggle("open", b._open); } },
        el("span", { class: "think-caret" }), el("span", { class: "think-label" }, live ? "Thinking…" : secs ? `Thought for ${secs} s` : "Thought"),
        live ? el("span", { class: "think-line" }, lastLine(b.text)) : null),
      el("div", { class: "think-body" }, b.text));
    return node;
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
  // (Messages between agents are shown in the answer itself; older chats kept them in the cards.)
  function agentSteps(b) {
    const keep = (s) => s.k === "say" || s.name === "mcp__team__post";
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

  // Claude's multiple-choice question. Your picks live on the block (b._sel, b._other) so a
  // redraw while you're choosing doesn't lose them.
  function questionNode(b) {
    const qs = b.questions || [];
    const card = el("div", { class: `question ${b.state}` });
    const who = b.agent ? el("span", { class: "perm-agent" }, b.agent) : null;
    if (b.state !== "pending") {
      card.append(el("div", { class: "q-title" }, who, b.state === "answered" ? "You answered" : "Skipped"));
      for (const q of qs) card.append(el("div", { class: "q-done" }, el("span", { class: "q-muted" }, q.question), " ",
        el("b", {}, b.answers && b.answers[q.question] ? b.answers[q.question] : "—")));
      return card;
    }
    b._sel = b._sel || qs.map(() => []);
    b._other = b._other || qs.map(() => "");
    const submit = el("button", { class: "cb primary solid", onclick: () => send() }, "Submit");
    const ready = () => qs.every((q, i) => b._sel[i].length || b._other[i].trim());
    const refresh = () => { submit.disabled = !ready(); };
    const answerOf = (q, i) => [...b._sel[i], ...(b._other[i].trim() ? [b._other[i].trim()] : [])].join(", ");
    const send = () => {
      if (!ready()) return;
      const answers = {};
      qs.forEach((q, i) => { answers[q.question] = answerOf(q, i); });
      post({ type: "answer", tabId: S.tab.id, pid: b.pid, answers });
    };
    card.append(el("div", { class: "q-title" }, who, qs.length > 1 ? "A few questions for you" : "A question for you"));
    qs.forEach((q, i) => {
      const multi = !!q.multiSelect;
      const box = el("div", { class: "q-block" },
        q.header ? el("span", { class: "q-chip" }, q.header) : null,
        el("div", { class: "q-text" }, q.question),
        multi ? el("div", { class: "q-muted small" }, "Pick one or more") : null);
      const rows = [];
      const paint = () => rows.forEach(([row, label]) => row.classList.toggle("on", b._sel[i].includes(label)));
      for (const o of q.options || []) {
        const row = el("button", { class: `q-opt ${multi ? "multi" : ""}`, onclick: () => {
          const sel = b._sel[i];
          if (multi) { const k = sel.indexOf(o.label); if (k >= 0) sel.splice(k, 1); else sel.push(o.label); }
          else { b._sel[i] = sel[0] === o.label ? [] : [o.label]; b._other[i] = ""; other.value = ""; }
          paint(); refresh();
        } }, el("span", { class: "q-mark" }), el("span", { class: "q-opt-text" }, el("span", { class: "q-label" }, o.label),
          o.description ? el("span", { class: "q-desc" }, o.description) : null));
        rows.push([row, o.label]);
        box.append(row);
      }
      const other = el("input", { class: "q-other", placeholder: "Other…", value: b._other[i], oninput: () => {
        b._other[i] = other.value;
        if (!multi && other.value.trim()) { b._sel[i] = []; paint(); }
        refresh();
      }, onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } } });
      box.append(other);
      paint();
      card.append(box);
    });
    card.append(el("div", { class: "perm-row" }, submit,
      el("button", { class: "cb", onclick: () => post({ type: "answer", tabId: S.tab.id, pid: b.pid, answers: null }) }, "Skip")));
    refresh();
    return card;
  }

  function permNode(b) {
    const what = b.tool === "Bash" ? "Run this command?" : b.tool === "WebFetch" ? "Open this web page?"
      : b.tool === "DeviceCommand" ? `Run this on ${b.where || "the device"}?` : b.tool === "DeviceWrite" ? `Write this file on ${b.where || "the device"}?`
      : b.tool === "Write" || b.tool === "Edit" || b.tool === "NotebookEdit" ? "Change this file?"
      : b.tool === "Read" ? "Read this file?" : b.tool === "Grep" || b.tool === "Glob" ? "Look through this folder?" : `Use ${prettyTool(b.tool)}?`;
    const card = el("div", { class: `perm ${b.state}` }, el("div", { class: "perm-q" }, b.agent ? el("span", { class: "perm-agent" }, typeof b.agent === "number" ? `Agent ${b.agent}` : b.agent) : null, what), el("pre", {}, b.detail));
    if (b.state === "pending") {
      // A file outside the project (read or change): yes or no for this one; "allow all" is only for commands.
      const fileCard = /^(Read|Grep|Glob|Write|Edit|NotebookEdit)$/.test(b.tool);
      const always = fileCard ? null : el("input", { type: "checkbox", id: `al-${b.pid}` });
      card.append(el("div", { class: "perm-row" },
        el("button", { class: "cb primary solid", onclick: () => post({ type: "permission", pid: b.pid, allow: true, always: !!(always && always.checked) }) }, fileCard ? "Allow" : "Run"),
        el("button", { class: "cb", onclick: () => post({ type: "permission", pid: b.pid, allow: false }) }, "Skip"),
        always ? el("label", { class: "always", for: `al-${b.pid}` }, always, b.where ? ` Allow everything on ${b.where} in this chat` : " Allow all commands in this chat") : null));
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
    const team = t.teamSize ? ` · ${t.teamStyle === "discuss" ? "discussion" : `${t.teamSize} agents`}` : "";
    const mood = t.mood && t.mood !== "default" ? ` · ${moodLabel(t.mood)}` : "";
    const routing = t.autoRoute ? `Auto · ${cap(profileName(t.routingProfile))} · ` : "";
    modelBtn.replaceChildren(`${routing}${t.routingState || t.modelName || modelLabel(t.model)} · ${t.effort === "medium" ? "Med" : effortLabel(t.effort)}${mood}${team}`, icon("chevron-down", "chev"));
    renderContext(t);
    sendBtn.replaceChildren(icon(running ? "debug-stop" : "arrow-up"));
    sendBtn.title = running ? "Stop (Esc)" : "Send (Enter)";
    sendBtn.classList.toggle("stop", running);
    renderQueueBtn();
    renderQueue();
    // (While it answers, Enter doesn't stop it: what you send is added to the answer at its next step, or answered next.)
    // Short (Adithya: "Ask Kural something", nothing more); the mode shows on its own button.
    input.dataset.placeholder = running ? "Add to this answer…" : "Ask Kural something";
  }
  const hasDraft = () => !isEmptyInput() || S.attachments.length > 0;
  function renderQueueBtn() { queueBtn.classList.toggle("hidden", !(S.tab && S.tab.status !== "idle" && !S.tab.visiting && hasDraft())); }

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
    if (isEmptyInput() && !S.attachments.length) return;
    if (t.status !== "idle" && S.editing && S.editing.tabId === t.id) return busyNote();   // (an edit waits for the answer)
    const segments = readInput();
    const contexts = segments.filter((s) => s.t === "pill").map((s) => s.ctx);
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // Keep the draft until the extension accepts it, including when routing cannot find an eligible model.
    S.pendingSend = { tabId: t.id, requestId, segments: JSON.stringify(segments), attachments: S.attachments.map((a) => a.id) };
    const editIndex = S.editing && S.editing.tabId === t.id ? S.editing.index : undefined;
    post({ type: "send", tabId: t.id, requestId, segments, contexts, attachments: S.pendingSend.attachments, editIndex });
    closePopup(); closeHistory();
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
  document.addEventListener("selectionchange", saveRange);
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
  const quoteBtn = el("button", { class: "quote-btn hidden", title: "Add the selected text to your message",
    onmousedown: (e) => e.preventDefault(),   // (a click would clear the selection before it's read)
    onclick: () => addQuote() }, icon("quote"), " Add to chat");
  app.append(quoteBtn);
  function chatSelection() {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return null;
    const r = sel.getRangeAt(0), text = sel.toString().trim();
    return text && listEl.contains(r.commonAncestorContainer) ? { r, text } : null;
  }
  function placeQuoteBtn() {
    const s = S.tab && !S.tab.visiting ? chatSelection() : null;
    if (!s) { quoteBtn.classList.add("hidden"); return; }
    const rects = s.r.getClientRects(), at = rects[rects.length - 1] || s.r.getBoundingClientRect();
    quoteBtn.classList.remove("hidden");
    const w = quoteBtn.offsetWidth, h = quoteBtn.offsetHeight, box = listEl.getBoundingClientRect();
    // Under the selection's last line; above it when that's off the bottom of the chat.
    const top = at.bottom + 6 + h <= box.bottom ? at.bottom + 6 : Math.max(box.top + 4, at.top - h - 6);
    quoteBtn.style.top = `${top}px`;
    quoteBtn.style.left = `${Math.max(6, Math.min(at.right - w, window.innerWidth - w - 6))}px`;
  }
  function addQuote() {
    const s = chatSelection();
    quoteBtn.classList.add("hidden");
    if (!s) return;
    const text = s.text.length > MAX_QUOTE ? `${s.text.slice(0, MAX_QUOTE)}…` : s.text, line = text.replace(/\s+/g, " ");
    insertPill({ kind: "quote", text, label: line.length > 40 ? `${line.slice(0, 40).trimEnd()}…` : line });
  }
  document.addEventListener("mouseup", () => setTimeout(placeQuoteBtn, 0));   // (after the click has set the selection)
  document.addEventListener("selectionchange", () => { if (!quoteBtn.classList.contains("hidden") && !chatSelection()) quoteBtn.classList.add("hidden"); });
  listEl.addEventListener("scroll", () => quoteBtn.classList.add("hidden"));

  // --- @ mentions ---

  function checkMention() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return closePopup();
    const r = sel.getRangeAt(0);
    const node = r.startContainer;
    if (node.nodeType !== 3 || !input.contains(node)) return closePopup();
    const before = node.data.slice(0, r.startOffset);
    const m = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (!m) return closePopup();
    if (!S.files.length) post({ type: "files" });
    S.popup = { node, start: r.startOffset - m[1].length - 1, end: r.startOffset, query: m[1], index: 0, items: [] };
    renderPopup();
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
    P.items = S.files.map((f) => [score(f, P.query), f]).filter((x) => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 12).map((x) => x[1]);
    P.index = Math.min(P.index, Math.max(0, P.items.length - 1));
    popupEl.classList.remove("hidden");
    const rows = P.items.length
      ? P.items.map((f, i) => el("div", { class: `pop-item ${i === P.index ? "sel" : ""}`, onmousedown: (e) => { e.preventDefault(); P.index = i; pickMention(); } },
        el("span", { class: "pop-name" }, base(f)), el("span", { class: "pop-dir" }, dir(f))))
      : [el("div", { class: "pop-empty" }, S.files.length ? "No matching files" : "Loading files…")];
    popupEl.replaceChildren(...rows);
  }

  function pickMention() {
    const P = S.popup;
    if (!P || !P.items.length) return;
    const file = P.items[P.index];
    const r = document.createRange();
    r.setStart(P.node, Math.max(0, P.start)); r.setEnd(P.node, Math.min(P.node.data.length, P.end));
    closePopup();
    insertPill({ kind: "file", path: file }, r);
  }
  function closePopup() { S.popup = null; popupEl.classList.add("hidden"); }

  input.addEventListener("input", () => { checkMention(); requestAnimationFrame(caretIntoView); renderQueueBtn(); });
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
    if (P) {
      if (e.key === "ArrowDown") { e.preventDefault(); P.index = Math.min(P.items.length - 1, P.index + 1); renderPopup(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); P.index = Math.max(0, P.index - 1); renderPopup(); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(); return; }
      if (e.key === "Escape") { e.preventDefault(); closePopup(); return; }
    }
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
  const dropTarget = document.body;
  // (Drags from the editor's own file explorer reach here when you hold Shift. Files from Finder or another
  // file manager can't: VS Code blocks those from web pages like this chat, so use + or paste instead.)
  dropTarget.addEventListener("dragover", (e) => {
    e.preventDefault();
    const ok = e.dataTransfer.effectAllowed || "all";
    e.dataTransfer.dropEffect = /copy|all/i.test(ok) ? "copy" : /move/i.test(ok) ? "move" : "link";
    composer.classList.add("drop");
  });
  dropTarget.addEventListener("dragleave", (e) => { if (!e.relatedTarget || !document.body.contains(e.relatedTarget)) composer.classList.remove("drop"); });
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
      const jira = (S.setups[t.id] || {}).jira || { ok: true };
      items = [
        el("div", { class: "mi", onclick: () => { closeMenu(); post({ type: "attachPick" }); } },
          el("span", { class: "mi-icon" }, icon("attach")), el("span", { class: "mi-label" }, "Add files"), el("span", { class: "mi-hint" }, "images, PDFs, code")),
        el("div", { class: "mi", title: jira.ok ? "" : jira.why, onclick: () => { closeMenu(); S.ticketUI = null; openMenu("ticket", anchor); } },
          el("span", { class: "mi-icon" }, icon("issues")), el("span", { class: "mi-label" }, t.ticket ? "Change ticket" : "Link ticket"),
          jira.ok ? el("span", { class: "mi-hint" }, "Jira epic, story, task…") : el("span", { class: "mi-hint warn-tri" }, icon("warning"), " Atlassian not connected")),
        el("div", { class: "mi", onclick: () => { closeMenu(); post({ type: "browserPick" }); } },
          el("span", { class: "mi-icon" }, icon("inspect")), el("span", { class: "mi-label" }, "Pick from a browser"), el("span", { class: "mi-hint" }, "your app: click an element to add it")),
        el("div", { class: "mi", onclick: () => { closeMenu(); S.deviceUI = null; post({ type: "devices" }); openMenu("device", anchor); } },
          el("span", { class: "mi-icon" }, icon("remote")), el("span", { class: "mi-label" }, t.device ? "Change device" : "Link device"),
          el("span", { class: "mi-hint" }, "Raspberry Pi, board computer… over SSH"))];
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
      const teamOn = !!t.team;
      const editing = t.mode === "agent" || t.mode === "auto";
      const local = /^ollama:/.test(t.model || "");
      // Claude's models: usable once Claude is set up (Get started); before that they say so and open it.
      items = [mhead("Auto · Model Router", "", "router"),
        ...["balance","cost","intelligence"].map((profile) => el("div", { class: `mi ${t.autoRoute && profileName(t.routingProfile) === profile ? "on" : ""}`,onclick: () => { post({ type: "setRouterProfile",tabId: t.id,profile }); closeMenu(); } },
          el("span", { class: `check radio${t.autoRoute && profileName(t.routingProfile) === profile ? " on" : ""}` }),el("span", { class: "mi-label" },cap(profile)),
          el("span", { class: "mi-hint" }, { balance: "quality, then speed",cost: "saves your usage limits",intelligence: "most capable" }[profile]))),
        el("div", { class: "sep" }),
        mhead("Claude", S.claudeReady ? "" : "not set up", S.claudeReady ? "claude" : null), ...S.models.map((m) =>
        el("div", { class: `mi ${!t.autoRoute && t.model === m.id ? "on" : ""} ${S.claudeReady ? "" : "dim"}`, onclick: () => {
          if (S.claudeReady) post({ type: "setModel", tabId: t.id, model: m.id }); else post({ type: "getStarted", path: "claude" });
          closeMenu(); } },
          el("span", { class: `check radio${!t.autoRoute && t.model === m.id ? " on" : ""}` }),
          el("span", { class: "mi-label" }, m.label), el("span", { class: "mi-hint" }, S.claudeReady ? m.hint : "set up Claude…"))),
        ...cliMenuItems(t),
        ...localMenuItems(t),
        el("div", { class: "mh" }, "Intensity", el("span", { class: "mh-key" }, keys("Control+M / H / O"))),
        el("div", { class: "seg" }, S.efforts.map((e) => el("button", { class: t.effort === e.id ? "on" : "", title: levelHint(t, e.id), onclick: () => post({ type: "setEffort", tabId: t.id, effort: e.id }) }, e.label))),
        levelNote(t),
        // Moods: the four built-in ones, then yours (Kural Settings → Moods), then a way to add one.
        el("div", { class: "mh" }, "Mood"),
        el("div", { class: "moods" }, S.moods.map((md) => el("button", { class: `mood-chip${t.mood === md.id ? " on" : ""}`, title: md.hint || "",
          "aria-pressed": String(t.mood === md.id), onclick: () => post({ type: "setMood", tabId: t.id, mood: md.id }) }, md.label)),
          el("button", { class: "mood-chip mood-add", title: "Add your own mood: who the AI should be and how it works with you (Kural Settings → Moods)",
            onclick: () => { closeMenu(); post({ type: "editMoods" }); } }, icon("add"), " Add your own mood…")),
        el("div", { class: "sep" }),
        // Claude Code teams, or Kural's team runner for Codex and Gemini.
        el("div", { class: `mi toggle-row ${local ? "dim off" : ""}`, onclick: () => { if (!local) post({ type: "setTeam", tabId: t.id, team: teamOn ? 0 : (S.teamSizes[1] || 3) }); } },
          el("div", { class: "tr-text" },
            el("div", { class: "mi-label" }, "Multiple agents"),
            el("div", { class: "tr-hint" }, local ? "Choose Claude, ChatGPT or Gemini" : teamOn ? teamHint(t) : "Split a task across agents, or let them discuss and decide")),
          el("span", { class: `switch ${teamOn && !local ? "on" : ""}` }, el("span"))),
        teamOn && !local ? el("div", { class: "seg team" }, S.teamStyles.map((st) => el("button", { class: t.teamStyle === st.id ? "on" : "", title: st.hint, onclick: () => post({ type: "setTeamStyle", tabId: t.id, style: st.id }) }, st.label))) : null,
        teamOn && !local ? el("div", { class: "roles" }, el("span", { class: "roles-h" }, "Roles"),
          S.roles.map((r) => el("button", { class: `role ${(t.roles || []).includes(r.id) ? "on" : ""}`, title: r.desc, onclick: () => post({ type: "toggleRole", tabId: t.id, role: r.id }) }, r.label))) : null,
        teamOn && !local && !(t.roles || []).length ? el("div", { class: "seg team" }, S.teamSizes.map((n) => el("button", { class: t.team === n ? "on" : "", onclick: () => post({ type: "setTeam", tabId: t.id, team: n }) }, `${n} agents`))) : null];
    }
    menuEl.replaceChildren(...items.filter(Boolean));
    menuEl.classList.remove("hidden");
    const a = anchor.getBoundingClientRect();
    menuEl.style.left = Math.max(6, Math.min(a.left, window.innerWidth - menuEl.offsetWidth - 6)) + "px";
    menuEl.style.bottom = (window.innerHeight - a.top + 6) + "px";
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
  function cliMenuItems(t) {
    const out = [];
    for (const c of S.clis || []) {
      if (!c.ready) continue;
      out.push(mhead(c.label, c.account || "", c.id));
      const models = c.models.length ? c.models : [{ id: "default", label: `${c.short} (its default model)` }];
      for (const m of models.slice(0, 8)) {
        const id = `${c.id}:${m.id}`;
        out.push(el("div", { class: `mi ${!t.autoRoute && t.model === id ? "on" : ""}`, title: m.description || "", onclick: () => { post({ type: "setModel", tabId: t.id, model: id }); closeMenu(); } },
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
    const out = [mhead("On this computer", "offline", "local")];
    for (const m of chat) {
      const id = `ollama:${m.name}`;
      out.push(el("div", { class: `mi ${!t.autoRoute && t.model === id ? "on" : ""}`, onclick: () => { post({ type: "setModel", tabId: t.id, model: id }); closeMenu(); } },
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

  // "Rachel (Developer) and Ross (Critic) talk it through and agree on a decision."
  function teamHint(t) {
    const roles = t.roles || [];
    const editing = t.mode === "agent" || t.mode === "auto";
    const and = (names) => names.length > 2 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names.join(" and ");
    const picked = S.roles.filter((r) => roles.includes(r.id));
    if (!picked.length) {
      const names = FRIENDS.slice(0, t.team);
      if (t.teamStyle === "discuss") return `${and(names)} talk it through and agree on a decision (any mode)`;
      return `${and(names)} split the work, run at the same time and message each other${editing ? "" : " (Agent and Auto modes)"}`;
    }
    if (t.teamStyle === "discuss") {
      const names = picked.map((r) => `${r.name} (${r.label})`);
      if (names.length < 2) names.push(FRIENDS.find((f) => !picked.some((r) => r.name === f)));
      return `${and(names)} talk it through and agree on a decision (any mode)`;
    }
    // The project team: you talk to the PM (the lead); it works in phases.
    const plan = picked.filter((r) => r.id === "researcher" || r.id === "architect");
    const dev = picked.some((r) => r.id === "developer"), tester = picked.find((r) => r.id === "tester");
    const parts = ["You talk to the Project Manager"];
    if (plan.length) parts.push(`${and(plan.map((r) => `${r.name} (${r.label})`))} plan${dev ? ", you OK the plan" : ""}`);
    if (dev) parts.push("1–3 Developers build (the PM decides)");
    if (tester) parts.push(`${tester.name} (Tester) checks the code`);
    return parts.join("; ") + (editing ? "" : " (Agent and Auto modes)");
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
    else if (U.error) out.push(el("div", { class: "ticket-warn" }, el("span", { class: "warn-tri" }, icon("warning"), " "), U.error));
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
  function mhead(label, key, ai) {
    const names = { router: "Model Router settings", local: "Your own model's settings" };
    const what = names[ai] || `${label} settings: connectors, when to switch near a limit`;
    return el("div", { class: "mh mh-gear" }, el("span", {}, label), el("span", { class: "spacer" }), key ? el("span", { class: "mh-key" }, key) : null,
      ai ? el("button", { class: "mh-btn", title: what, "aria-label": what, onclick: (e) => { e.stopPropagation(); closeMenu(); post({ type: "aiSettings", ai }); } }, icon("settings-gear")) : null);
  }
  openMenu.refresh = () => { const k = S.menu; S.menu = null; if (k) openMenu(k, openMenu.anchor); };
  function closeMenu() { S.menu = null; menuEl.classList.add("hidden"); }
  // Clicking outside the panel (in the editor) or pressing Esc closes menus and the @ list.
  window.addEventListener("blur", () => { closeMenu(); closePopup(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && S.menu) { e.preventDefault(); closeMenu(); input.focus(); return; }
    if (e.key === "Escape" && S.showHistory) { e.preventDefault(); closeHistory(); input.focus(); return; }
    // Tab shortcuts work while you're typing in the chat, too.
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.altKey && (e.key === "n" || e.key === "N")) { e.preventDefault(); S.focusNext = true; post({ type: "newTab" }); }
    else if (mod && e.key === "PageDown") { e.preventDefault(); cycleTab(1); }
    else if (mod && e.key === "PageUp") { e.preventDefault(); cycleTab(-1); }
  });
  function cycleTab(d) {
    const i = S.tabs.findIndex((t) => t.id === S.activeId);
    if (i >= 0 && S.tabs.length > 1) { S.focusNext = true; post({ type: "switchTab", id: S.tabs[(i + d + S.tabs.length) % S.tabs.length].id }); }
  }
  document.addEventListener("mousedown", (e) => {
    if (S.menu && !menuEl.contains(e.target) && !modeBtn.contains(e.target) && !modelBtn.contains(e.target) && !attachBtn.contains(e.target)) closeMenu();
  });
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

  window.addEventListener("message", (ev) => {
    const m = ev.data;
    const mine = S.tab && m.tabId === S.tab.id;
    if (m.type === "fontScale") { setFs(m.value); return; }
    switch (m.type) {
      case "config":
        S.models = m.models; S.efforts = m.efforts; S.modes = m.modes; S.teamSizes = m.teamSizes || S.teamSizes; S.version = m.version || ""; S.notReady = m.ready === false; S.claudeReady = m.claudeReady !== false; S.clis = m.clis || [];
        S.moods = m.moods || []; S.roles = m.roles || []; S.teamStyles = m.teamStyles || []; S.pics = m.pics || S.pics;
        S.didYouKnow = m.didYouKnow !== false;
        renderFoot(); if (S.tab && !S.tab.messages.length) renderAll(); break;
      case "didYouKnow": S.didYouKnow = m.on !== false; for (const d of listEl.querySelectorAll(".dyk")) fillDyk(d, true); break;
      case "moods": S.moods = m.moods || S.moods; renderFoot(); if (S.menu === "model") openMenu.refresh(); break;
      case "tabs":
        S.tabs = m.tabs; S.activeId = m.activeId;
        // A chat dragged into the editor area: its editor tab is its tab, so no tab bar of its own.
        tabBar.classList.toggle("hidden", !!m.single);
        if (S.tab) { const s = m.tabs.find((x) => x.id === S.tab.id); if (s) Object.assign(S.tab, { status: s.status, model: s.model, effort: s.effort, mode: s.mode, title: s.title, team: s.team,
          mood: s.mood, roles: s.roles, teamStyle: s.teamStyle, teamSize: s.teamSize, ticket: s.ticket, device: s.device, queued: s.queued,
          autoRoute: s.autoRoute,routingProfile: s.routingProfile,routingState: s.routingState,modelName: s.modelName,tokens: s.tokens,context: s.context }); }
        renderTabs(); renderFoot(); renderChips(); if (S.menu) openMenu.refresh();
        if (S.tab) { const i = lastAssistant(); if (i >= 0 && S.tab.messages[i].planReady) rerender(i); }
        break;
      case "setupReady": S.notReady = !m.ready; S.claudeReady = m.claudeReady !== false; if (m.clis) S.clis = m.clis; renderAll(); if (S.menu) openMenu.refresh(); break;
      case "showLocal": openLocal(); break;
      case "full": S.tab = m.tab; renderAll(); renderEditBar(); if (S.menu) closeMenu(); if (S.focusNext) { S.focusNext = false; input.focus(); } break;
      case "openLocal": closeMenu(); openLocal(); break;
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
      case "questionState": if (mine) { const i = lastAssistant(); if (i >= 0) { for (const b of S.tab.messages[i].blocks) if (b.pid === m.pid) { b.state = m.state; b.answers = m.answers; } scheduleRerender(i); } } break;
      case "permState": if (mine) { const i = lastAssistant(); if (i >= 0) { for (const b of S.tab.messages[i].blocks) if (b.pid === m.pid) b.state = m.state; scheduleRerender(i); } } break;
      case "patch": if (mine) { const i = m.index != null ? m.index : lastAssistant(); if (i >= 0) { Object.assign(S.tab.messages[i], m.msg); rerender(i); } renderFoot(); } break;
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
      case "attached": S.attachments.push(...m.items); renderChips(); input.focus(); break;
      case "userAttachments": if (mine) {
        for (let i = S.tab.messages.length - 1; i >= 0; i--) if (S.tab.messages[i].role === "user") { S.tab.messages[i].attachments = m.attachments; scheduleRerender(i); break; }
      } break;
      case "flash": {   // a shortcut changed the model / intensity / mode: say so briefly
        let f = document.querySelector(".flash");
        if (!f) { f = el("div", { class: "flash" }); document.body.append(f); }
        f.textContent = m.text; f.classList.add("on");
        clearTimeout(S.flashTimer); S.flashTimer = setTimeout(() => f.classList.remove("on"), 1300);
        break;
      }
    }
  });

  renderTabs(); renderAll(); renderChips();
  post({ type: "ready" });
})();
