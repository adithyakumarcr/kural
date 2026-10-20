// A plugin's page (an editor tab, like an extension's): what it is, where it comes from, its buttons, what it adds (each
// skill, command and agent with its own description, the hooks and MCP servers with what they run) and its README.
// Installed plugins: read from their folder (and Claude's token estimate); others: from their GitHub repository
// (lib/plugins/contents.js). Everything shown is the plugin author's text: drawn as text, never as HTML.
// Talks to lib/plugins/index.js (openDetails).
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  document.body.classList.add("details");
  const setFs = (v) => { if (v) document.documentElement.style.setProperty("--fs", v); };
  setFs(document.documentElement.dataset.fs);
  window.addEventListener("error", (e) => vscode.postMessage({ type: "log", message: `${e.message} (${e.lineno})` }));
  const post = (m) => vscode.postMessage(m);

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
  const icon = (name) => el("i", { class: `codicon codicon-${name}`, "aria-hidden": "true" });
  const btn = (label, type, primary) => el("button", { class: `pbtn${primary ? " primary" : ""}`, onclick: () => post({ type }) }, label);
  const web = (u) => typeof u === "string" && /^https?:\/\/\S+$/i.test(u);
  const link = (label, url, ic) => web(url) && el("a", { title: url, onclick: () => post({ type: "openLink", url }) }, ic && icon(ic), label);

  // ---------- a README, as DOM nodes (no innerHTML): headings, paragraphs, lists, quotes, code, tables, links ----------
  // Pictures aren't loaded (a picture's address can carry data away; the page's CSP blocks them anyway): a link instead.
  // Links relative to the README go to its page on GitHub; #anchors and other schemes stay text.
  function resolve(url, base) {
    url = String(url || "").trim().replace(/^<|>$/g, "");
    if (!url || url[0] === "#") return "";
    if (web(url)) return url;
    if (/^[a-z][\w+.-]*:/i.test(url) || !base) return "";
    try { const u = new URL(url, base).href; return web(u) ? u : ""; } catch { return ""; }
  }
  // (Until nothing changes: removing one tag can join the pieces of another, "<scr<b>ipt>". The result only ever goes into
  // text nodes, but no tag should be left in it either.)
  const stripTags = (s) => {
    let prev;
    do {
      prev = s;
      s = s
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<\/?(?!https?:)[A-Za-z][^>]*>/g, "")
        .replace(/[<>]/g, "");
    } while (s !== prev);
    return s;
  };
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", mdash: "—", ndash: "–", hellip: "…" };
  const entities = (s) => s.replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] || m;
  });
  // Inline: `code`, ![picture](src), [text](link), <https://autolink>, **bold**, *em*, ~~struck~~; HTML tags dropped.
  function inline(text, base) {
    const out = [];
    let s = String(text), buf = "";
    const flush = () => { if (buf) { out.push(entities(buf)); buf = ""; } };
    const attr = (tag, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag); return m ? m[1] || m[2] || m[3] || "" : ""; };
    const RULES = [
      [/^`+/, (m) => { const tick = m[0], end = s.indexOf(tick, tick.length); if (end < 0) return null; const n = el("code", {}, s.slice(tick.length, end).trim()); return [n, end + tick.length]; }],
      [/^!\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/, (m) => { const u = resolve(m[2], base); return [u ? link(`Picture: ${m[1] || "untitled"}`, u, "file-media") : el("span", { class: "md-alt" }, m[1]), m[0].length]; }],
      [/^\[((?:[^\[\]]|\[[^\]]*\])*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/, (m) => { const u = resolve(m[2], base); const kids = inline(m[1], base); return [u ? el("a", { title: u, onclick: () => post({ type: "openLink", url: u }) }, kids) : el("span", {}, kids), m[0].length]; }],
      [/^<(https?:\/\/[^>\s]+)>/, (m) => [link(m[1], m[1]), m[0].length]],
      [/^<!--[\s\S]*?-->/, (m) => ["", m[0].length]],
      // (HTML: a picture becomes a link like ![…](…), a line break a space, any other tag is dropped and its text kept.)
      [/^<img\b[^>]*>/i, (m) => { const u = resolve(attr(m[0], "src"), base); return [u ? link(`Picture: ${entities(attr(m[0], "alt")) || "untitled"}`, u, "file-media") : "", m[0].length]; }],
      [/^<\/?[A-Za-z][\w-]*(?:\s[^>]*)?\/?>/, (m) => [/^<br/i.test(m[0]) ? " " : "", m[0].length]],
      [/^(\*\*|__)(?=\S)([\s\S]*?\S)\1/, (m) => [el("strong", {}, inline(m[2], base)), m[0].length]],
      [/^~~(?=\S)([\s\S]*?\S)~~/, (m) => [el("del", {}, inline(m[1], base)), m[0].length]],
      [/^(\*|_)(?=\S)([\s\S]*?\S)\1(?![\w*])/, (m) => [el("em", {}, inline(m[2], base)), m[0].length]],
    ];
    outer: while (s) {
      if ("`![<*_~".includes(s[0])) {
        for (const [re, make] of RULES) {
          const m = re.exec(s);
          if (!m) continue;
          const r = make(m);
          if (!r) continue;
          flush(); out.push(r[0]); s = s.slice(r[1]);
          continue outer;
        }
      }
      if (s[0] === "\\" && s.length > 1 && /[\\`*_{}[\]()#+\-.!~<>|]/.test(s[1])) { buf += s[1]; s = s.slice(2); continue; }
      buf += s[0]; s = s.slice(1);
    }
    flush();
    return out;
  }
  const isFence = (l) => /^ {0,3}(`{3,}|~{3,})/.exec(l);
  const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");
  const cells = (l) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
  const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  function markdown(text, base, depth = 0) {
    const lines = String(text).replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"), out = [];
    let para = [];
    const endPara = () => { if (para.length) { const t = para.join(" ").trim(); if (stripTags(t).trim() || /<img\b/i.test(t)) out.push(el("p", {}, inline(t, base))); para = []; } };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i], f = isFence(l);
      if (f) {
        endPara();
        const code = [];
        while (++i < lines.length && !(lines[i].trim().startsWith(f[1][0].repeat(f[1].length)) && /^\s*[`~]+\s*$/.test(lines[i]))) code.push(lines[i]);
        out.push(el("pre", {}, el("code", {}, code.join("\n"))));
        continue;
      }
      if (!l.trim()) { endPara(); continue; }
      const h = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
      if (h) { endPara(); out.push(el(`h${Math.min(6, h[1].length + 2)}`, { class: "md-h" }, inline(h[2], base))); continue; }
      if (/^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { endPara(); out.push(el("hr")); continue; }
      if (para.length && /^ {0,3}(=+|-+)\s*$/.test(l)) { const t = para.join(" "); para = []; out.push(el(l.trim()[0] === "=" ? "h3" : "h4", { class: "md-h" }, inline(t, base))); continue; }
      if (/^ {0,3}>/.test(l)) {
        endPara();
        const q = [];
        while (i < lines.length && /^ {0,3}>/.test(lines[i])) q.push(lines[i++].replace(/^ {0,3}> ?/, ""));
        i--;
        out.push(el("blockquote", {}, depth < 6 ? markdown(q.join("\n"), base, depth + 1) : q.join(" ")));
        continue;
      }
      if (l.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        endPara();
        const head = cells(l), rows = [];
        i += 2;
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
        i--;
        out.push(el("div", { class: "md-table" }, el("table", {}, el("thead", {}, el("tr", {}, head.map((c) => el("th", {}, inline(c, base))))),
          el("tbody", {}, rows.map((r) => el("tr", {}, head.map((_, k) => el("td", {}, inline(r[k] || "", base)))))))));
        continue;
      }
      const li = LIST.exec(l);
      if (li && (!para.length || li[1].length < 4)) {
        endPara();
        const indent = li[1].length, ordered = /\d/.test(li[2]), items = [];
        while (i < lines.length) {
          const m = LIST.exec(lines[i]);
          if (m && m[1].length <= indent + 1) { items.push([m[3]]); i++; continue; }
          // (Lines indented under an item, and blank lines between items, belong to it.)
          if (items.length && lines[i].trim() && /^\s+/.test(lines[i]) && (lines[i].match(/^\s*/)[0].length > indent)) { items[items.length - 1].push(lines[i].slice(Math.min(indent + 2, lines[i].match(/^\s*/)[0].length))); i++; continue; }
          if (items.length && !lines[i].trim() && i + 1 < lines.length && (LIST.exec(lines[i + 1]) || /^\s{2,}\S/.test(lines[i + 1]))) {
            const next = LIST.exec(lines[i + 1]);
            if (next && next[1].length < indent) break;
            items[items.length - 1].push(""); i++; continue;
          }
          break;
        }
        i--;
        const task = (t) => /^\[[ xX]\]\s/.test(t) ? [el("i", { class: `codicon codicon-${/^\[ \]/.test(t) ? "circle-large" : "pass"} md-task`, "aria-hidden": "true" }), t.slice(4)] : [null, t];
        out.push(el(ordered ? "ol" : "ul", {}, items.map((it) => {
          const [mark, first] = task(it[0]);
          const rest = it.slice(1);
          const body = rest.some((x) => x.trim()) && depth < 8 ? markdown([first, ...rest].join("\n"), base, depth + 1) : [el("span", {}, inline(first, base))];
          return el("li", {}, mark, body);
        })));
        continue;
      }
      // (An HTML block: <p align="center">, <details>… its text only.)
      para.push(l.trim());
    }
    endPara();
    return out;
  }

  // ---------- what it adds ----------
  const SHOWN = 12;
  const opened = new Set();     // groups whose "Show all" was pressed (kept while the page lives)
  const HINT = {
    Skills: "Instructions the AI reads when a task matches them.",
    Commands: "Typed after / in the chat.",
    Agents: "Helpers the AI can hand part of the work to.",
    Hooks: "Run by themselves at these moments, without asking.",
    "MCP servers": "Start with the AI and give it more tools, without asking.",
  };
  function group(g, key) {
    const all = opened.has(key), list = all ? g.items : g.items.slice(0, SHOWN);
    const box = el("section", { class: "grp" },
      el("h3", {}, g.kind, el("span", { class: "count" }, String(g.items.length))),
      HINT[g.kind] && el("p", { class: "hint" }, HINT[g.kind]),
      el("div", { class: "items" }, list.map((it) => el("div", { class: "item" },
        el("div", { class: "iname" }, web(it.web) ? el("a", { title: it.web, onclick: () => post({ type: "openLink", url: it.web }) }, it.name) : it.name),
        it.about && el("div", { class: "iabout" }, it.about),
        it.detail && el("pre", { class: "idetail" }, it.detail)))));
    if (g.items.length > SHOWN) box.append(el("button", { class: "more", onclick: () => { if (all) opened.delete(key); else opened.add(key); render(last); } },
      all ? "Show fewer" : `Show all ${g.items.length}`));
    return box;
  }
  const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const NOUN = { Skills: "skill", Commands: "command", Agents: "agent", Hooks: "hook", "MCP servers": "MCP server" };

  function adds(p, info) {
    const out = [el("h2", {}, "What it adds")];
    if (!info) { out.push(el("p", { class: "cost loading" }, icon("loading"), p.installed ? " Reading its files…" : " Reading its files on GitHub…")); return out; }
    if (info.error) {
      out.push(el("p", { class: "cost" }, info.error, " ", link("See it on GitHub", info.web)));
      return out;
    }
    const groups = Array.isArray(info.groups) ? info.groups : [];
    if (groups.length) {
      out.push(el("p", { class: "summary" }, groups.map((g) => plural(g.items.length, NOUN[g.kind] || g.kind)).join(" · ")));
      groups.forEach((g) => out.push(group(g, `${p.key}|${g.kind}`)));
      // (Kinds only Claude counted, like LSP servers.)
      const extra = (info.components || []).filter((c) => c.count && !groups.some((g) => g.kind === c.kind) && !["Skills", "Agents", "Commands", "Hooks", "MCP servers"].includes(c.kind));
      if (extra.length) out.push(el("div", { class: "inv" }, extra.flatMap((c) => [el("div", { class: "k" }, `${c.kind} (${c.count})`), el("div", { class: "v" }, c.items || "")])));
    } else if (info.components && info.components.length) {
      out.push(el("div", { class: "inv" }, info.components.flatMap((c) => [el("div", { class: "k" }, `${c.kind} (${c.count})`), el("div", { class: "v" }, c.items || (c.count ? "" : "none"))])));
    } else if (p.skills && p.skills.length) {
      out.push(el("div", { class: "inv" }, el("div", { class: "k" }, `Skills (${p.skills.length})`), el("div", { class: "v" }, p.skills.join(", "))));
    } else if (info.from === "github") {
      out.push(el("p", { class: "cost" }, "Its repository has no skills, commands, agents, hooks or MCP servers where Kural looks. ", link("See it on GitHub", info.web)));
    } else if (!p.installed && !info.from) {
      out.push(el("p", { class: "cost" }, "Kural can only look inside plugins kept on GitHub before they're installed."));
    } else out.push(el("p", { class: "cost" }, "Kural can't tell what this plugin adds."));
    if (info.alwaysOn) out.push(el("p", { class: "cost" }, `Adds ${info.alwaysOn} to every chat, before you ask anything (Claude's estimate).`));
    if (info.from === "github" && groups.length) out.push(el("p", { class: "cost" }, info.truncated ? "Read from its GitHub repository (a large one: only part of it). " : "Read from its GitHub repository, at the version its marketplace offers. ", link("See it on GitHub", info.web)));
    return out;
  }

  let last = null;
  function render(m) {
    last = m;
    const p = m.plugin;
    if (!p) { app.replaceChildren(el("div", { class: "page" }, el("p", { class: "gone" }, "This plugin isn't listed any more."))); return; }
    const can = m.can || {}, info = m.info, man = (info && info.manifest) || {};
    const sub = [m.market && `From ${m.market}`, (p.author || man.author) && `by ${p.author || man.author}`, p.license || man.license, `for ${m.aiName}`].filter(Boolean);
    // (Claude: where it's installed, when it's only for the open project.)
    const where = { project: " for this project (shared)", local: " for this project, only you" }[p.scope] || "";
    const state = p.installed ? (p.readOnly ? "Installed by your organisation" : (p.enabled ? "Installed" : "Installed, turned off") + where) : "";
    const acts = m.busy ? [el("span", { class: "busy" }, m.busy)]
      : !p.installed ? (p.installable ? [btn("Install", "install", true)] : [el("span", { class: "busy" }, "Its marketplace doesn't offer it to install.")])
      : p.readOnly ? [el("span", { class: "busy" }, "Set up for you by your organisation: Kural leaves it alone.")]
      : [can.toggle && btn(p.enabled ? "Turn Off" : "Turn On", p.enabled ? "disable" : "enable"), can.update && btn("Update", "update"), btn("Remove", "uninstall")].filter(Boolean);
    const source = p.source || (info && info.web);
    const page = el("div", { class: "page" },
      el("h1", {}, p.name, p.fullVersion && el("span", { class: "pver" }, p.fullVersion), state && el("span", { class: "tag" }, state)),
      el("div", { class: "sub" }, sub.flatMap((s, i) => i ? [el("span", { class: "sep" }, "·"), s] : [s])),
      el("p", { class: "desc" }, p.description || man.description || "No description."),
      el("div", { class: "acts" }, acts),
      el("div", { class: "links" }, link("Source", source, "github"), p.homepage !== source && link("Homepage", p.homepage, "link-external")),
      !p.installed && el("div", { class: "warn" }, m.risk),
      adds(p, info));
    if (info && info.readme && info.readme.text) page.append(el("h2", {}, "Read me"), el("div", { class: "md" }, markdown(info.readme.text, info.readme.base)));
    // (Redrawn on every change, Install's busy words too: the place you scrolled to stays.)
    const old = app.firstChild, same = old && old.getAttribute && old.getAttribute("data-key") === p.key, scroll = same ? old.scrollTop : 0;
    page.setAttribute("data-key", p.key);
    app.replaceChildren(page);
    if (same) page.scrollTop = scroll;
  }

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.type === "details") render(m);
    else if (m.type === "fontScale") setFs(m.value);
  });
  post({ type: "ready" });
})();
