// Kural's own request classifier ("Native" in the Model Router): a linear model on the words and word pairs of a
// request, trained on lib/router/examples.json (270 labelled requests). No model download, no Ollama: scoring is a few
// table lookups (well under a millisecond). Cross-validated on the examples it reads the size right about 3 times in 4,
// against about half for the hand-written keyword rules it replaced (test/router-eval.js).
//
// The weights live in words-model.json, written by `node scripts/train-router.js` (deterministic: the same examples give
// the same file; test/router-words.test.js fails when the file is out of date with the examples). No vscode here.
const fs = require("fs");
const path = require("path");

const SIZES = ["simple", "standard", "complex"], KINDS = ["search", "explain", "edit", "review", "other"];

// Words (2+ letters, lower case, file names as "file"), pairs of neighbouring words, and a length bucket.
function tokens(text) {
  const w = String(text || "").toLowerCase()
    .replace(/[\w./-]*\w\.(?:[a-z][a-z0-9]{0,4})\b/g, " file ")
    .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((x) => x.length > 1);
  return [...new Set([...w, ...w.slice(1).map((x, i) => w[i] + "_" + x), `len${Math.min(6, Math.round(Math.log2(1 + w.length)))}`])];
}

// Multinomial logistic regression, L2, plain gradient descent from zero (so training is deterministic).
function train(examples, field, labels, { steps = 300, lr = 1, l2 = 1e-3 } = {}) {
  const vocab = [...new Set(examples.flatMap((e) => tokens(e[0])))].sort();
  const index = new Map(vocab.map((t, j) => [t, j]));
  const rows = examples.map((e) => tokens(e[0]).map((t) => index.get(t)));
  const want = examples.map((e) => labels.indexOf(e[field]));
  const W = labels.map(() => new Float64Array(vocab.length)), b = labels.map(() => 0);
  for (let s = 0; s < steps; s++) {
    const gW = labels.map(() => new Float64Array(vocab.length)), gb = labels.map(() => 0);
    rows.forEach((row, i) => {
      const z = labels.map((_, c) => b[c] + row.reduce((a, j) => a + W[c][j], 0));
      const m = Math.max(...z), e = z.map((x) => Math.exp(x - m)), sum = e.reduce((a, x) => a + x, 0);
      labels.forEach((_, c) => { const g = e[c] / sum - (want[i] === c ? 1 : 0); gb[c] += g; for (const j of row) gW[c][j] += g; });
    });
    labels.forEach((_, c) => {
      b[c] -= lr * gb[c] / rows.length;
      for (let j = 0; j < vocab.length; j++) W[c][j] -= lr * (gW[c][j] / rows.length + l2 * W[c][j]);
    });
  }
  // Rounded, and tokens that weigh almost nothing for every label are dropped: a smaller file, the same answers.
  const r = (x) => Math.round(x * 1000) / 1000;
  const keep = vocab.map((_, j) => j).filter((j) => labels.some((_, c) => Math.abs(W[c][j]) >= 0.002));
  return { labels, bias: b.map(r), weights: Object.fromEntries(keep.map((j) => [vocab[j], labels.map((_, c) => r(W[c][j]))])) };
}

// { label, probs: { label: p }, share: p of the label } for one head of the model.
function predict(head, text) {
  const z = head.labels.map((_, c) => head.bias[c]);
  for (const t of tokens(text)) { const w = head.weights[t]; if (w) w.forEach((x, c) => { z[c] += x; }); }
  const m = Math.max(...z), e = z.map((x) => Math.exp(x - m)), sum = e.reduce((a, x) => a + x, 0);
  const probs = Object.fromEntries(head.labels.map((l, c) => [l, e[c] / sum]));
  const c = z.indexOf(Math.max(...z));
  return { label: head.labels[c], probs, share: e[c] / sum };
}

let model = null;
function load() {
  if (!model) model = JSON.parse(fs.readFileSync(path.join(__dirname, "words-model.json"), "utf8"));
  return model;
}
// { size, kind, sizeProbs, sure } — sure: how much the size label leads (its probability).
function classifyWords(text) {
  const m = load(), s = predict(m.size, text), k = predict(m.kind, text);
  return { size: s.label, kind: k.label, sizeProbs: s.probs, kindProbs: k.probs, sizeShare: s.share, kindShare: k.share };
}

module.exports = { SIZES, KINDS, tokens, train, predict, classifyWords, _reset: () => { model = null; } };
