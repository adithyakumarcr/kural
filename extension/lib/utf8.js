// Text from a child process's output. A multi-byte character (Tamil, Japanese, emoji, é) can arrive cut in two between
// two chunks; adding the chunks as they come (`out += chunk`) turns both halves into U+FFFD. A StringDecoder keeps the
// unfinished bytes until the rest arrives. No vscode here (tests run without it).
const { StringDecoder } = require("string_decoder");

// Calls fn(text) for each chunk of `stream` ("data"), with characters never split. Strings pass through as they are.
function onText(stream, fn) {
  const decoder = new StringDecoder("utf8");
  stream.on("data", (d) => {
    const s = typeof d === "string" ? d : decoder.write(d);
    if (s) fn(s);
  });
}

module.exports = { onText };
