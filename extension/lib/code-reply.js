// Takes the code out of Claude's reply to a Ctrl+K edit or an Apply.
// Claude is asked to put the code between a "<code>" line and a "</code>" line. Why: spaces at the very
// start of a reply can get lost, which broke the first line's indentation (4 spaces came back as 3).
// Spaces after "<code>" + line break are kept. No vscode here, so test/edits.test.js can check it.

function unwrap(reply) {
  const text = String(reply || "");
  const a = text.indexOf("<code>"), b = text.lastIndexOf("</code>");   // last: the code itself may contain "</code>"
  if (a >= 0 && b > a) {
    let s = text.slice(a + 6, b);
    s = s.replace(/^[ \t]*\r?\n/, "");     // the line break right after <code>
    s = s.replace(/\r?\n[ \t]*$/, "");     // the line break right before </code>
    return s;
  }
  const m = text.match(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/);   // older habit: a markdown fence
  return m ? m[1] : text;
}

module.exports = { unwrap };
