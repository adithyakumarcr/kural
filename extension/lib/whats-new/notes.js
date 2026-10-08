// What's new: the "What's new in X" blocks of RELEASE_NOTES.md (the same text the GitHub Release shows), picked for the
// versions you just updated through and turned into a small HTML page. No vscode inside (test/whats-new.test.js).

const { compareVersions } = require("../version-compare");

const REPO = "https://github.com/adithyakumarcr/kural";
const HEAD = /^## What's new in (\d[0-9A-Za-z.-]*)\s*$/;

// "## What's new in 1.1.0-alpha.7" → { version, text } for every block, in file order.
function sections(md) {
  const out = [];
  let cur = null;
  for (const line of String(md || "").split(/\r?\n/)) {
    const h = HEAD.exec(line);
    if (h) { cur = { version: h[1], lines: [] }; out.push(cur); continue; }
    if (/^## /.test(line)) { cur = null; continue; }   // "Not released yet", "Downloads"…
    if (cur) cur.lines.push(line);
  }
  return out.map((s) => ({ version: s.version, text: s.lines.join("\n").trim() })).filter((s) => s.text);
}

// The blocks to show after an update from `from` to `to`: every version after `from` up to `to`, newest first.
// `from` unknown (an update by an older Kural that didn't remember versions): only `to`'s own block.
function between(md, from, to) {
  return sections(md)
    .filter((s) => compareVersions(s.version, to) <= 0 && (from ? compareVersions(s.version, from) > 0 : s.version === to))
    .sort((a, b) => compareVersions(b.version, a.version));
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// A link in the notes: a web address stays; a file of the repository (docs/windows-signing.md) → its page on GitHub.
function href(url) {
  if (/^https:\/\//i.test(url)) return url;
  if (/^[\w./-]+$/.test(url) && !url.includes("..")) return `${REPO}/blob/main/${url.replace(/^\.?\//, "")}`;
  return null;
}

// **bold**, `code`, [text](link); everything else is text (escaped first, so the notes can't add HTML).
function inline(s) {
  const code = [];
  let t = esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${code.push(c) - 1}\u0000`);
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const h = href(url.replace(/&amp;/g, "&"));
    return h ? `<a href="${esc(h)}">${text}</a>` : text;
  });
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${code[i]}</code>`);
}

// The notes' own markdown: bullets ("- " with indented continuation lines), paragraphs, ### headings.
function render(text) {
  const out = [];
  let list = null, para = null;
  const flush = () => {
    if (para) { out.push(`<p>${inline(para.join(" "))}</p>`); para = null; }
    if (list) { out.push(`<ul>${list.map((li) => `<li>${inline(li.join(" "))}</li>`).join("")}</ul>`); list = null; }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    const h = /^#{3,6}\s+(.*)$/.exec(line);
    if (h) { flush(); out.push(`<h3>${inline(h[1])}</h3>`); continue; }
    const b = /^\s*[-*]\s+(.*)$/.exec(line);
    if (b && !/^\s{2,}/.test(raw)) { if (para) flush(); (list = list || []).push([b[1]]); continue; }
    if (list) { list[list.length - 1].push(line.trim()); continue; }
    (para = para || []).push(line.trim());
  }
  flush();
  return out.join("\n");
}

// At startup: show What's new? `seen` = the version Kural last started as (remembered from this version on),
// `update` = lastUpdate()'s record of an update Check for Updates started ({ version, failed }), or nothing.
//   seen and now newer          → yes, every version since `seen` (Check for Updates, or installed by hand)
//   nothing seen, an update ran → yes, this version's notes (the update came from a Kural that didn't remember)
//   nothing seen, no update     → no: a new install (Get started greets you instead)
function decide({ seen, current, update }) {
  if (seen) return compareVersions(current, seen) > 0 ? { show: true, from: seen } : { show: false };
  if (update && !update.failed && compareVersions(current, update.version) >= 0) return { show: true, from: null };
  return { show: false };
}

module.exports = { sections, between, render, inline, decide, REPO };
