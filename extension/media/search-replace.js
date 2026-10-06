// What a search means as a JavaScript regular expression, and what a match is replaced with: the same rules as VS Code's
// Search. Shared by the extension (lib/search/text.js: searching unsaved text, replacing) and the Search page
// (media/search.js: the "old → new" preview in the results), so the preview is exactly what Replace does.
(function (root) {
  // Is the search case sensitive? Match Case on, or Smart Case (VS Code's search.smartCase) with a capital letter.
  const caseSensitive = (q) => !!q.matchCase || (!!q.smartCase && /[A-Z]/.test(q.pattern || ""));
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

  // sticky: match exactly at lastIndex (replacing one match); otherwise global.
  function jsRegex(q, sticky = false) {
    const body = q.isRegex ? q.pattern : escape(q.pattern);
    const flags = (sticky ? "y" : "g") + (caseSensitive(q) ? "" : "i") + "m";
    try { return new RegExp(q.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${body})(?![\\p{L}\\p{N}_])` : body, flags + "u"); }
    catch {
      // (Some patterns are fine without the unicode flag, e.g. "\-".) A broken regex throws a SyntaxError here.
      return new RegExp(q.wholeWord ? `(?<![A-Za-z0-9_])(?:${body})(?![A-Za-z0-9_])` : body, flags);
    }
  }

  // The replace text with a match (an exec() result) → the new text. Regex: $1…$99, $<name>, $& and $0 (the whole
  // match), $$, \n \t \\, and \u \l (next character upper/lower) \U \L (the next group all upper/lower). Plain text:
  // as typed. Then Preserve Case: "FOO" → upper, "foo" → lower, "Foo" → capitalised (also per part in foo-bar, foo_bar).
  function replacement(m, q, replaceText) {
    let out = q.isRegex ? expand(replaceText || "", m) : (replaceText || "");
    if (q.preserveCase) out = preserveCase(m[0], out);
    return out;
  }

  function expand(pattern, m) {
    let out = "", ops = [];
    const take = (s) => {
      let r = s;
      for (const op of ops) {
        if (op === "U") r = r.toUpperCase(); else if (op === "L") r = r.toLowerCase();
        else if (op === "u") r = r.slice(0, 1).toUpperCase() + r.slice(1); else if (op === "l") r = r.slice(0, 1).toLowerCase() + r.slice(1);
      }
      ops = [];
      return r;
    };
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i], n = pattern[i + 1];
      if (c === "\\" && n !== undefined) {
        i++;
        if (n === "n") out += take("\n"); else if (n === "t") out += take("\t"); else if (n === "\\") out += take("\\");
        else if ("uUlL".includes(n)) ops.push(n);
        else out += take("\\" + n);
        continue;
      }
      if (c === "$" && n !== undefined) {
        if (n === "$") { out += take("$"); i++; continue; }
        if (n === "&") { out += take(m[0]); i++; continue; }
        if (n === "<") {
          const e = pattern.indexOf(">", i), name = e > 0 ? pattern.slice(i + 2, e) : "";
          if (name && m.groups && name in m.groups) { out += take(m.groups[name] || ""); i = e; continue; }
        }
        const d = /^\d{1,2}/.exec(pattern.slice(i + 1));
        if (d) {
          let k = d[0];
          if (k.length === 2 && Number(k) >= m.length) k = k[0];   // $12 with fewer groups: $1, then "2" (like JavaScript)
          if (Number(k) < m.length) { out += take(m[Number(k)] || ""); i += k.length; continue; }
        }
      }
      out += take(c);
    }
    return out;
  }

  function preserveCase(found, text) {
    if (!found || !text) return text;
    if (found.toUpperCase() === found && found.toLowerCase() !== found) return text.toUpperCase();
    if (found.toLowerCase() === found) return text.toLowerCase();
    for (const sep of ["-", "_"]) {
      const a = found.split(sep), b = text.split(sep);
      if (a.length > 1 && a.length === b.length) return b.map((p, i) => preserveCase(a[i], p)).join(sep);
    }
    const f = found[0];
    if (f.toUpperCase() === f && f.toLowerCase() !== f) return text[0].toUpperCase() + text.slice(1);
    if (f.toLowerCase() === f && f.toUpperCase() !== f) return text[0].toLowerCase() + text.slice(1);
    return text;
  }

  // The page's preview for one match, from the match text alone (the real replace sees the text around it too, which
  // only matters for lookarounds and ^ $).
  function previewOf(matchText, q, replaceText) {
    try {
      const re = jsRegex(q, true); re.lastIndex = 0;
      const m = re.exec(matchText);
      return replacement(m && m.index === 0 ? m : [matchText], q, replaceText);
    } catch { return replaceText || ""; }
  }

  const api = { caseSensitive, jsRegex, replacement, expand, preserveCase, previewOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.KuralReplace = api;
})(this);
