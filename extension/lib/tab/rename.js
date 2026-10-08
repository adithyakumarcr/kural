// Tab Completion's "also change it elsewhere" (Adithya: "let's say I fix one of the variables: also recommend the other
// files that use it"). This part notices that you changed a name: you typed over a word that was already there (or
// accepted a Tab suggestion that changed it), and once you're done with that word (the cursor leaves it, or a 1.5 s
// pause), it says old → new. lib/tab/rename-offer.js then looks for the old name in the project and offers to change it.
// Not a rename: a word you're typing right now (a new name growing letter by letter), keywords (let → const), edits that
// aren't one word (a whole line, a paste with spaces), undo/redo and edits by Kural itself (rename-offer.js).
// No vscode here (test/rename.test.js).

const WORD_CHAR = /[\p{L}\p{N}_$]/u;
const isWordChar = (c) => !!c && WORD_CHAR.test(c);
const IDENT = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;
// Words that are a language's own (changing let → const, string → number isn't renaming anything).
const KEYWORDS = new Set(("abstract and as assert async await bool boolean break byte case catch char class const continue def default del delete " +
  "do double elif else enum except export extends false final finally float fn for from func function global go goto if impl implements " +
  "import in instanceof int interface is lambda let long match mod module mut namespace new nil none not null number object of or override " +
  "package pass private protected pub public raise readonly return self short static str string struct super switch this throw throws trait " +
  "true try type typeof undefined union unknown unsafe use using val var void while with yield any never symbol bigint True False None " +
  "list dict tuple set map vec Self").split(" "));

// The part of a change that really changed: VS Code may report a wider one (Tab's suggestion replaces the rest of the
// line, rest included). change: { offset, length, text } in `before`.
function narrow(before, change) {
  const old = before.slice(change.offset, change.offset + change.length), text = change.text;
  let p = 0;
  while (p < old.length && p < text.length && old[p] === text[p]) p++;
  let s = 0;
  while (s < old.length - p && s < text.length - p && old[old.length - 1 - s] === text[text.length - 1 - s]) s++;
  return { offset: change.offset + p, length: old.length - p - s, text: text.slice(p, text.length - s) };
}

// The word around [start, end) (start = end: the word touching that spot).
function wordAt(text, start, end = start) {
  let a = start, b = end;
  while (a > 0 && isWordChar(text[a - 1])) a--;
  while (b < text.length && isWordChar(text[b])) b++;
  return { start: a, end: b, word: text.slice(a, b) };
}

const allWord = (s) => [...s].every(isWordChar);
// A name worth offering to change elsewhere: a real identifier, not a keyword; the old one 2+ characters (a lone i or x
// is everywhere).
const worthIt = (from, to) => from !== to && IDENT.test(from) && IDENT.test(to) && from.length >= 2 && !KEYWORDS.has(from) && !KEYWORDS.has(to);

class RenameWatch {
  // settleMs: a pause this long ends the word; freshMs: a word you typed (or changed) this recently is still being typed.
  constructor({ settleMs = 1500, freshMs = 5000 } = {}) {
    this.settleMs = settleMs; this.freshMs = freshMs;
    this.docs = new Map();   // uri -> { session: { from, start, end, at } | null, last: { offset, at } | null }
  }
  doc(uri) { if (!this.docs.has(uri)) this.docs.set(uri, { session: null, last: null }); return this.docs.get(uri); }

  // One change you made in a document (one cursor). before/after: the whole text; change: { offset, length, text }, offsets
  // in `before`. Returns a finished rename ({ uri, from, to }) when this change ended the word before it, else null.
  edit(uri, before, after, change, now = Date.now()) {
    const d = this.doc(uri), c = narrow(before, change);
    const word = (c.length || c.text.length) && allWord(c.text) && allWord(before.slice(c.offset, c.offset + c.length));
    const s = d.session;
    // Still the same word: follow it.
    if (s && word && c.offset >= s.start && c.offset + c.length <= s.end) {
      const w = wordAt(after, s.start, s.end - c.length + c.text.length);
      Object.assign(s, { start: w.start, end: w.end, at: now });
      d.last = { offset: c.offset + c.text.length, at: now };
      return null;
    }
    let done = null;
    if (s) { done = this.result(uri, s, before); d.session = null; }
    if (word) {
      // A word that was already there, changed (not one you're typing right now): follow it until you're done with it.
      const old = wordAt(before, c.offset, c.offset + c.length);
      const fresh = d.last && now - d.last.at < this.freshMs && d.last.offset >= old.start && d.last.offset <= old.end;
      if (old.word && !fresh && IDENT.test(old.word)) {
        const w = wordAt(after, old.start, old.end - c.length + c.text.length);
        d.session = { from: old.word, start: w.start, end: w.end, at: now };
      }
    }
    // (Where this change ended, for "typed right now": in `after`.)
    d.last = { offset: c.offset + c.text.length, at: now };
    return done;
  }

  // The cursor moved (offset in `text`, the document now): out of the word = done with it.
  cursor(uri, text, offset, now = Date.now()) {
    const d = this.docs.get(uri), s = d && d.session;
    if (!s || (offset >= s.start && offset <= s.end)) return null;
    d.session = null;
    return this.result(uri, s, text);
  }

  // Time passed: a word not touched for settleMs is done.
  tick(uri, text, now = Date.now()) {
    const d = this.docs.get(uri), s = d && d.session;
    if (!s || now - s.at < this.settleMs) return null;
    d.session = null;
    return this.result(uri, s, text);
  }

  // Forget a document (closed, or you moved to another one: rename-offer.js finishes it first with tick/cursor).
  drop(uri) { this.docs.delete(uri); }

  result(uri, s, text) {
    const w = wordAt(text, s.start, s.end);
    if (w.start !== s.start || w.end !== s.end) return null;   // (the text around it changed: not sure what it is now)
    return worthIt(s.from, w.word) ? { uri, from: s.from, to: w.word } : null;
  }
}

module.exports = { RenameWatch, narrow, wordAt, worthIt, KEYWORDS };
