// The chat's answers drawn from Markdown, in the "Calm reading" look (docs/superpowers/specs/2026-10-21-calm-chat-design.md).
// parse() turns the text into plain blocks; render() makes the page from them with the page's own el() only. Nothing the
// AI writes becomes HTML except through inline() (media/chat.js), which escapes it first. No outside libraries; the
// tests load it too (module.exports).
(function () {
  const ALERT = /^\[!(note|tip|important|warning|caution)\]\s*(.*)$/i;
  const LABELS = { note: "Note", tip: "Tip", important: "Important", warning: "Watch out", caution: "Risk" };
  const ICONS = { note: "info", tip: "lightbulb", important: "report", warning: "warning", caution: "error" };
  const BULLET = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
  const FENCE = /^\s*```(.*)$/;
  const NUM = /^[+−-]?[$€£]?\d[\d,]*(\.\d+)?\s?(%|s|ms|min|h|KB|MB|GB|k|x)?$/i;
  // A cell that is only one of these words: an icon and a color. "No" is grey, not red: "Breaking change: No" is good news.
  const STATUS = { passed: "good", pass: "good", ok: "good", success: "good", succeeded: "good", done: "good", yes: "good",
    failed: "bad", fail: "bad", error: "bad", broken: "bad", no: "neutral" };
  // A step that starts with its file: "`media/chat.js`: …", "**lib/chat/index.js** — …".
  const STEP_FILE = /^(?:`([^`\s]+\.[A-Za-z0-9]+)`|\*\*([^*\s]+\.[A-Za-z0-9]+)\*\*)(?::\s+|\s+[—–-]\s+)([\s\S]*)$/;
  const SENTENCES = /(?<=[.!?])\s+/;
  const YES_NO = /^(want me to|should i|shall i|do you want|would you like)\b.*\?$/i;

  // Options the AI wrote at the end of its answer: a question, then 2–6 short items (a numbered list: one choice;
  // "- [ ]" lines: several), or a yes/no question. null when it isn't clearly that (a plan's "Next steps:" stays text).
  function choicesOf(blocks) {
    const n = (blocks || []).length, last = n ? blocks[n - 1] : null;
    if (!last) return null;
    if (last.t === "list" && n >= 2 && blocks[n - 2].t === "p") {
      const items = last.items;
      if (items.length < 2 || items.length > 6 || items.some((it) => (it.children || []).length || it.text.length > 120)) return null;
      const question = blocks[n - 2].text.trim(), s = question.split(SENTENCES);
      const end = s[s.length - 1], before = s[s.length - 2] || "";
      if (!(/\?$/.test(end) || (/:$/.test(end) && /\?$/.test(before)))) return null;
      return { start: n - 2, end: n, question, showQuestion: true, multi: items.every((it) => !!it.task), options: items.map((it) => option(it.text)) };
    }
    if (last.t === "p") {
      const s = last.text.trim().split(SENTENCES), q = s[s.length - 1];
      if (YES_NO.test(q)) return { start: n, end: n, question: q, showQuestion: false, multi: false, options: [option("Yes"), option("No")] };
    }
    return null;
  }
  // "**Calm reading**: real headings" / "A — first" / "B (Recommended)" → { label, description, recommended }.
  function option(text) {
    let recommended = false;
    const t = String(text).replace(/\s*\(recommended\)\s*/i, () => { recommended = true; return " "; }).trim();
    let label = t, description = "";
    const bold = /^\*\*([^*]+)\*\*\s*([\s\S]*)$/.exec(t), split = /^(.*?)(?: — |: )([\s\S]*)$/.exec(t);
    if (bold) { label = bold[1]; description = bold[2].replace(/^[:—–-]\s*/, ""); }
    else if (split) { label = split[1]; description = split[2]; }
    const tidy = (s) => s.replace(/[\s.:]+$/, "").trim();
    return { label: tidy(label), description: tidy(description), recommended };
  }
  const indentOf = (line) => /^\s*/.exec(line)[0].replace(/\t/g, "  ").length;

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

  // Lines → blocks. `finished`: the whole text is there (a running answer's last block may still be half-written).
  function blocksOf(lines, finished) {
    const out = [];
    let para = [];
    const flush = () => { if (para.length) { out.push({ t: "p", text: para.join(" ") }); para = []; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = FENCE.exec(line);
      if (fence) {
        flush();
        const code = []; let closed = false;
        for (i++; i < lines.length; i++) { if (/^\s*```\s*$/.test(lines[i])) { closed = true; break; } code.push(lines[i]); }
        out.push({ t: "code", info: fence[1].trim(), code: code.join("\n"), closed: closed || false });
        continue;
      }
      // Table: a header row, then a |---|---| row, then data rows.
      if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
        flush();
        const head = cells(line);
        const aligns = cells(lines[i + 1]).map((c) => /^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : /^:-+$/.test(c) ? "left" : "");
        const rows = [];
        for (i += 2; i < lines.length && isRow(lines[i]) && lines[i].trim(); i++) rows.push(cells(lines[i]));
        i--;
        // A column of numbers ("0.4 s", "1,968", "12%", "$4.00", "+18") lines up on the right.
        const num = head.map((_, c) => { const v = rows.map((r) => (r[c] || "").trim()).filter(Boolean); return v.length > 0 && v.every((x) => NUM.test(x)); });
        out.push({ t: "table", head, aligns, rows, num });
        continue;
      }
      // Some answers squeeze a whole table onto one line: "| a | b || --- | --- || 1 | 2 |". Unsqueeze it.
      if (/\|\s*\|\s*:?-{2,}/.test(line) && (line.match(/\|\|/g) || []).length >= 2) {
        const rowsText = line.replace(/\|\s*\|/g, "|\n|").split("\n");
        if (rowsText.length > 2 && isSep(rowsText[1])) { lines = [...lines.slice(0, i), ...rowsText, ...lines.slice(i + 1)]; i--; continue; }
      }
      // A quote (">"), or one of GitHub's alerts ("> [!WARNING]"): its lines without the ">", read again as blocks.
      if (/^\s*>/.test(line)) {
        flush();
        const inner = [];
        for (; i < lines.length && /^\s*>/.test(lines[i]); i++) inner.push(lines[i].replace(/^\s*> ?/, ""));
        i--;
        const alert = inner.length ? ALERT.exec(inner[0].trim()) : null;
        if (alert) out.push({ t: "callout", kind: alert[1].toLowerCase(), title: alert[2].trim() || null, blocks: blocksOf(inner.slice(1), finished) });
        else out.push({ t: "quote", blocks: blocksOf(inner, finished) });
        continue;
      }
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) { flush(); out.push({ t: "h", level: h[1].length, text: h[2] }); continue; }
      if (BULLET.test(line)) { flush(); i = listAt(lines, i, out, finished); continue; }
      if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flush(); out.push({ t: "hr" }); continue; }
      if (!line.trim()) { flush(); continue; }
      para.push(line.trim());
    }
    flush();
    return out;
  }

  // A list from line i: its items; lines indented under an item (2 or more spaces more) belong to that item (a nested
  // list, or more of its text). Returns the index of the list's last line.
  function listAt(lines, i, out, finished) {
    const top = indentOf(lines[i]);
    const list = { t: "list", ordered: /^\s*\d/.test(lines[i]), items: [] };
    let item = null, under = [];
    const close = () => { if (item && under.length) item.children = blocksOf(dedent(under), finished); under = []; };
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) break;
      const b = BULLET.exec(line);
      const ind = indentOf(line);
      if (b && ind < top + 2) {
        close();
        const task = /^\[( |x|X)\]\s+([\s\S]*)$/.exec(b[3]);
        item = { text: task ? task[2] : b[3], task: task ? (task[1] === " " ? "open" : "done") : null, children: [] };
        list.items.push(item);
      } else if (ind >= top + 2 && item) {
        if (b || under.length) under.push(line); else item.text += ` ${line.trim()}`;
      } else break;
    }
    close();
    out.push(list);
    return i - 1;
  }
  const dedent = (lines) => { const n = Math.min(...lines.filter((l) => l.trim()).map(indentOf)); return lines.map((l) => l.replace(/^\s*/, (s) => s.replace(/\t/g, "  ").slice(n))); };

  function KURAL_MARKDOWN({ el, inline, codeCard, icon, onFile }) {
    function parse(src, opts = {}) {
      const blocks = blocksOf(String(src == null ? "" : src).split("\n"), !!opts.finished);
      // The point first: an answer that starts with "**Done:** …" (a label of 1–4 words) gets a box with that label.
      if (opts.lead && blocks[0] && blocks[0].t === "p") {
        const m = /^\*\*([^*:]+):\*\*\s+([\s\S]+)$/.exec(blocks[0].text);
        if (m && m[1].trim().split(/\s+/).length <= 4) blocks[0] = { t: "summary", label: m[1].trim(), text: m[2].trim() };
      }
      return blocks;
    }

    const html = (tag, text, props = {}) => el(tag, { ...props, html: inline(text) });
    function table(b) {
      // An alignment from the |---| row wins; else a column of numbers goes right.
      const al = (i) => b.aligns[i] ? { style: `text-align:${b.aligns[i]}` } : b.num && b.num[i] ? { class: "num" } : {};
      const cell = (tag, v, i) => {
        const kind = STATUS[String(v).trim().toLowerCase()];
        return kind ? el(tag, al(i), el("span", { class: `st ${kind}` }, icon(kind === "good" ? "check" : "close"), el("span", {}, String(v).trim()))) : html(tag, v, al(i));
      };
      return el("div", { class: "table-wrap" }, el("table", {},
        el("thead", {}, el("tr", {}, b.head.map((h, i) => html("th", h, al(i))))),
        el("tbody", {}, b.rows.map((r) => el("tr", {}, b.head.map((_, i) => cell("td", r[i] || "", i)))))));
    }
    // A numbered step that starts with its file: the file as a chip that opens it, then the rest.
    function stepItem(it) {
      const m = !it.task && STEP_FILE.exec(it.text);
      if (!m) return null;
      const path = m[1] || m[2];
      return el("li", {}, el("span", { class: "file-chip", "data-path": path, title: `Open ${path}`, onclick: () => onFile && onFile(path) }, path), " ",
        el("span", { html: inline(m[3]) }));
    }
    function list(b, finished) {
      return el(b.ordered ? "ol" : "ul", b.ordered ? { class: "md-steps" } : {}, b.items.map((it) => {
        const li = (b.ordered && stepItem(it)) || html("li", it.text, it.task ? { class: "task" } : {});
        if (it.task) li.prepend(el("span", { class: `task-box${it.task === "done" ? " done" : ""}` }));
        li.append(...render(it.children || [], { finished }));
        return li;
      }));
    }
    function node(b, finished) {
      switch (b.t) {
        case "p": return html("p", b.text);
        case "h": return html(`h${Math.min(6, b.level + 2)}`, b.text);
        case "hr": return el("hr");
        case "code": return codeCard(b.info, b.code, b.closed || finished);
        case "table": return table(b);
        case "list": return list(b, finished);
        case "quote": return el("div", { class: "md-quote" }, render(b.blocks, { finished }));
        case "callout": return el("div", { class: `callout c-${b.kind}` },
          el("div", { class: "callout-head" }, icon(ICONS[b.kind]), b.title ? html("span", b.title) : el("span", {}, LABELS[b.kind])),
          render(b.blocks, { finished }));
        case "summary": return el("div", { class: "sum" }, el("div", { class: "sum-label" }, b.label), html("p", b.text));
        default: return null;
      }
    }
    function render(blocks, opts = {}) { return (blocks || []).map((b) => node(b, !!opts.finished)).filter(Boolean); }
    const markdown = (src, finished, lead = false) => render(parse(src, { finished, lead }), { finished });
    return { parse, render, markdown, choicesOf };
  }

  if (typeof window !== "undefined") window.KURAL_MARKDOWN = KURAL_MARKDOWN;
  if (typeof module !== "undefined") module.exports = KURAL_MARKDOWN;
})();
