// How well each way of reading a request's size works, on extension/lib/router/examples.json (270 labelled requests),
// with 10-fold cross-validation: every request is classified using only the OTHER 90 % as examples, so nothing is tested
// on itself. Needs Ollama for the embedding models (nothing is downloaded here: missing models are skipped).
//
//   node test/router-eval.js                          native + every candidate model that's installed
//   node test/router-eval.js all-minilm:22m           one model
//   node test/router-eval.js --json > report.json     machine-readable
//
// Methods: native (Kural's word rules), knn (nearest neighbours vote, k=7, weighted by similarity), centroid (closest
// class average), logreg (a linear classifier trained on the other folds), and hybrid (the winner, but explicit words
// win, as in the router). Latency: one request's embedding, warm, 30 runs.
const { classify } = require("../extension/lib/router/policy");
const data = require("../extension/lib/router/examples.json").examples;
const URL_ = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const args = process.argv.slice(2), asJson = args.includes("--json");
const CANDIDATES = ["all-minilm:22m", "snowflake-arctic-embed:22m", "snowflake-arctic-embed:33m", "granite-embedding:30m",
  "nomic-embed-text", "embeddinggemma", "qwen3-embedding:0.6b", "mxbai-embed-large"];
// Models that expect a task prefix (their model cards).
const PREFIX = { "nomic-embed-text": "classification: ", "embeddinggemma": "task: classification | query: ",
  "qwen3-embedding:0.6b": "Instruct: Classify how much work this request to a coding assistant needs\nQuery: " };
const SIZES = ["simple", "standard", "complex"], KINDS = ["search", "explain", "edit", "review", "other"];

const post = async (p, body) => { const r = await fetch(URL_ + p, { method: "POST", body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${p} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`); return r.json(); };
const norm = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const pct = (a, n) => `${(100 * a / n).toFixed(1)}%`;
function folds(n, k = 10) {   // stratified by size, fixed order (reproducible)
  const f = Array(n);
  for (const s of SIZES) data.map((d, i) => [d, i]).filter(([d]) => d[1] === s).forEach(([, i], j) => { f[i] = j % k; });
  return f;
}
function knn(vecs, train, v, labelOf, k = 7) {
  const near = train.map((i) => [dot(vecs[i], v), i]).sort((a, b) => b[0] - a[0]).slice(0, k);
  const votes = {};
  for (const [s, i] of near) votes[labelOf(i)] = (votes[labelOf(i)] || 0) + Math.max(0, s) ** 3;
  const total = Object.values(votes).reduce((a, b) => a + b, 0) || 1;
  const [label, w] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return { label, share: w / total, top: near[0][0] };
}
function centroid(vecs, train, v, labelOf, labels) {
  let best = null;
  for (const l of labels) {
    const idx = train.filter((i) => labelOf(i) === l); if (!idx.length) continue;
    const c = norm(vecs[0].map((_, d) => idx.reduce((s, i) => s + vecs[i][d], 0)));
    const s = dot(c, v); if (!best || s > best.s) best = { label: l, s };
  }
  return best.label;
}
// Multinomial logistic regression, L2, plain gradient descent (small data, a few hundred steps).
function logreg(vecs, train, labelOf, labels, steps = 400, lr = 0.5, l2 = 1e-3) {
  const D = vecs[train[0]].length, W = labels.map(() => new Float64Array(D)), b = labels.map(() => 0);
  for (let t = 0; t < steps; t++) {
    const gW = labels.map(() => new Float64Array(D)), gb = labels.map(() => 0);
    for (const i of train) {
      const z = labels.map((_, c) => dot(W[c], vecs[i]) + b[c]), m = Math.max(...z), e = z.map((x) => Math.exp(x - m)), s = e.reduce((a, x) => a + x, 0);
      labels.forEach((l, c) => { const g = e[c] / s - (labelOf(i) === l ? 1 : 0); gb[c] += g; for (let d = 0; d < D; d++) gW[c][d] += g * vecs[i][d]; });
    }
    labels.forEach((_, c) => { b[c] -= lr * gb[c] / train.length; for (let d = 0; d < D; d++) W[c][d] -= lr * (gW[c][d] / train.length + l2 * W[c][d]); });
  }
  return (v) => labels[labels.map((_, c) => dot(W[c], v) + b[c]).reduce((bi, x, c, z) => x > z[bi] ? c : bi, 0)];
}
function score(pred, field) {   // field 1 = size, 2 = kind
  let ok = 0; const conf = {};
  pred.forEach((p, i) => { const want = data[i][field]; if (p === want) ok++; const k = `${want}>${p}`; conf[k] = (conf[k] || 0) + 1; });
  // Under-provisioning (a complex request read as simple) is the costly mistake: count it apart.
  const under = field === 1 ? pred.filter((p, i) => SIZES.indexOf(p) < SIZES.indexOf(data[i][1])).length : undefined;
  return { ok, n: pred.length, acc: ok / pred.length, conf, under };
}

// Words: a linear classifier on the words and word pairs of the request (no model needed: it runs in plain JavaScript).
const tokens = (s) => { const w = String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((x) => x.length > 1);
  return [...new Set([...w, ...w.slice(1).map((x, i) => w[i] + "_" + x), `len${Math.min(6, Math.round(Math.log2(1 + w.length)))}`])]; };
function wordsModel(train, labelOf, labels, opts = {}) {
  const vocab = new Map(); for (const i of train) for (const t of tokens(data[i][0])) vocab.set(t, (vocab.get(t) || 0) + 1);
  const keep = [...vocab].filter(([, n]) => n >= (opts.minCount || 1)).map(([t]) => t), index = new Map(keep.map((t, j) => [t, j]));
  const vec = (s) => { const v = new Float64Array(keep.length); for (const t of tokens(s)) if (index.has(t)) v[index.get(t)] = 1; return v; };
  const X = new Map(train.map((i) => [i, vec(data[i][0])]));
  const vecs = []; for (const [i, v] of X) vecs[i] = v;
  const f = logreg(vecs, train, labelOf, labels, opts.steps || 300, opts.lr || 1, opts.l2 || 1e-3);
  return (s) => f(vec(s));
}

(async () => {
  const report = { corpus: data.length, folds: 10, results: [] };
  const nat = data.map(([p]) => classify(p));
  report.results.push({ method: "native", size: score(nat.map((t) => t.complexity), 1), kind: score(nat.map((t) => t.intent), 2), latencyMs: 0.01 });
  if (!args.includes("--no-words")) { // the words classifier, same folds
    const f0 = folds(data.length), ps = [], pk = [];
    for (let fold = 0; fold < 10; fold++) {
      const train = data.map((_, i) => i).filter((i) => f0[i] !== fold), test = data.map((_, i) => i).filter((i) => f0[i] === fold);
      const ms = wordsModel(train, (i) => data[i][1], SIZES), mk = wordsModel(train, (i) => data[i][2], KINDS);
      for (const i of test) { ps[i] = ms(data[i][0]); pk[i] = mk(data[i][0]); }
    }
    report.results.push({ method: "words", size: score(ps, 1), kind: score(pk, 2), latencyMs: 0.05 });
  }
  let installed = [];
  try { installed = ((await (await fetch(URL_ + "/api/tags")).json()).models || []).map((m) => m.name.replace(/:latest$/, "")); } catch { /* no Ollama */ }
  const wanted = args.filter((a) => !a.startsWith("--"));
  const models = (wanted.length ? wanted : CANDIDATES).filter((m) => installed.includes(m) || installed.includes(m.replace(/:latest$/, "")));
  const f = folds(data.length);
  for (const model of models) try {
    const pre = PREFIX[model] || "";
    const t0 = performance.now();
    const out = await post("/api/embed", { model, input: data.map((d) => pre + d[0]), keep_alive: "5m" });
    const batchMs = performance.now() - t0;
    const vecs = out.embeddings.map(norm);
    const times = [];
    for (let r = 0; r < 30; r++) { const q = data[(r * 37) % data.length][0]; const s = performance.now(); await post("/api/embed", { model, input: [pre + q], keep_alive: "5m" }); times.push(performance.now() - s); }
    times.sort((a, b) => a - b);
    const sizeOf = (i) => data[i][1], kindOf = (i) => data[i][2];
    const pk = [], pc = [], pl = [], kk = [], hy = [], shares = [];
    for (let fold = 0; fold < 10; fold++) {
      const train = data.map((_, i) => i).filter((i) => f[i] !== fold), test = data.map((_, i) => i).filter((i) => f[i] === fold);
      const lr = logreg(vecs, train, sizeOf, SIZES);
      for (const i of test) {
        const s = knn(vecs, train, vecs[i], sizeOf); pk[i] = s.label; shares[i] = s.share;
        pc[i] = centroid(vecs, train, vecs[i], sizeOf, SIZES); pl[i] = lr(vecs[i]);
        kk[i] = knn(vecs, train, vecs[i], kindOf).label;
        hy[i] = nat[i].sure && nat[i].sure.complexity ? nat[i].complexity : s.label;
      }
    }
    // How sure the vote is vs. how often it's right (for the acceptance threshold).
    const sureCut = [.5, .6, .7, .8].map((c) => { const idx = shares.map((s, i) => [s, i]).filter(([s]) => s >= c).map(([, i]) => i);
      return { minShare: c, covered: idx.length, correct: idx.filter((i) => pk[i] === data[i][1]).length }; });
    report.results.push({ method: "embeddings", model, dims: vecs[0].length, batchMs: Math.round(batchMs),
      latencyMs: +times[15].toFixed(1), p95Ms: +times[28].toFixed(1),
      knn: score(pk, 1), centroid: score(pc, 1), logreg: score(pl, 1), hybrid: score(hy, 1), kind: score(kk, 2), sureCut });
    if (!asJson) console.error(`  done: ${model}`);
  } catch (e) { report.results.push({ method: "embeddings", model, error: e.message }); console.error(`  ${model}: ${e.message}`); }
  if (asJson) { console.log(JSON.stringify(report, null, 1)); return; }
  console.log(`${data.length} requests, 10-fold cross-validation. size = simple/standard/complex; under = read as smaller than it is.\n`);
  for (const r of report.results) {
    if (r.error) { console.log(`${r.model.padEnd(28)} failed: ${r.error}`); continue; }
    if (r.method === "native" || r.method === "words") { console.log(`${(r.method === "native" ? "native rules" : "words (trained)").padEnd(29)} size ${pct(r.size.ok, r.size.n)} (under ${r.size.under})  kind ${pct(r.kind.ok, r.kind.n)}`); continue; }
    console.log(`${r.model.padEnd(28)} knn ${pct(r.knn.ok, r.knn.n)} (under ${r.knn.under})  centroid ${pct(r.centroid.ok, r.centroid.n)}  logreg ${pct(r.logreg.ok, r.logreg.n)} (under ${r.logreg.under})  hybrid ${pct(r.hybrid.ok, r.hybrid.n)}  kind ${pct(r.kind.ok, r.kind.n)}  | ${r.latencyMs} ms (p95 ${r.p95Ms})  ${r.dims}d`);
  }
})();
