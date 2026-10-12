// Takes the code out of Claude's reply to a Ctrl+K edit or an Apply.
// Claude is asked to put the code between a "<code>" line and a "</code>" line. Why: spaces at the very
// start of a reply can get lost, which broke the first line's indentation (4 spaces came back as 3).
// Spaces after "<code>" + line break are kept. No vscode here, so test/edits.test.js can check it.
//
// The wrapper tags must stand where a wrapper stands: "<code>" at the start of a line, "</code>" at the end of one.
// A sentence that merely mentions the tags ("I wrapped it in <code> tags:") is chatter, not the start of the code
// (it used to be taken as the start, and the chatter ended up in the file).
// Returns the code, or null when the reply has tags that make no wrapper (nothing is inserted then; callers say so).

function unwrap(reply) {
  const text = String(reply || "");
  const open = /^<code>/m.exec(text);
  let close = -1;
  for (const m of text.matchAll(/<\/code>[ \t]*(?=\r?\n|$)/g)) close = m.index;   // the last one: the code itself may contain "</code>"
  if (open && close >= open.index + 6) {
    let s = text.slice(open.index + 6, close);
    s = s.replace(/^[ \t]*\r?\n/, "");     // the line break right after <code>
    s = s.replace(/\r?\n[ \t]*$/, "");     // the line break right before </code>
    return s;
  }
  const m = text.match(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/);   // older habit: a markdown fence
  if (m) return m[1];
  if (/<\/?code>/.test(text)) return null;   // tags, but no wrapper: don't guess which text is the code
  return text;
}

module.exports = { unwrap };
