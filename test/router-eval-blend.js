// The word classifier (lib/router/words.js) blended with an embedding model's view, as the router does (policy.js
// classify + client.js): 10-fold cross-validation on examples.json, for several blend weights. The embedding side is
// what client.js ships: the request's similarity to each size's average example (centroid), turned into probabilities.
//   node test/router-eval-blend.js granite-embedding:30m [all-minilm:22m …]
const { train, predict, SIZES, KINDS } = require("../extension/lib/router/words");
const { centroidProbs, PREFIX } = require("../extension/lib/router/client");
const data = require("../extension/lib/router/examples.json").examples;
const URL_ = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const norm = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };
const folds = (() => { const f = Array(data.length); for (const s of SIZES) data.map((d, i) => [d, i]).filter(([d]) => d[1] === s).forEach(([, i], j) => { f[i] = j % 10; }); return f; })();
const TEMPS = [0.01, 0.02, 0.05];
const argmax = (p) => Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];

(async () => {
  const models = process.argv.slice(2);
  // Words probabilities per request, from a model trained on the other 9 folds.
  const wordSize = [], wordKind = [];
  for (let fold = 0; fold < 10; fold++) {
    const tr = data.filter((_, i) => folds[i] !== fold);
    const ms = train(tr, 1, SIZES), mk = train(tr, 2, KINDS);
    data.forEach((d, i) => { if (folds[i] === fold) { wordSize[i] = predict(ms, d[0]).probs; wordKind[i] = predict(mk, d[0]).probs; } });
  }
  const acc = (probs, field) => probs.filter((p, i) => argmax(p) === data[i][field]).length / data.length;
  const under = (probs) => probs.filter((p, i) => SIZES.indexOf(argmax(p)) < SIZES.indexOf(data[i][1])).length;
  console.log(`words alone: size ${(100 * acc(wordSize, 1)).toFixed(1)}% (under ${under(wordSize)})  kind ${(100 * acc(wordKind, 2)).toFixed(1)}%`);
  for (const model of models) {
    const pre = PREFIX[model] || "";
    const out = await (await fetch(URL_ + "/api/embed", { method: "POST", body: JSON.stringify({ model, input: data.map((d) => pre + d[0]) }) })).json();
    const vecs = out.embeddings.map(norm), embSize = [], embKind = [];
    for (let fold = 0; fold < 10; fold++) {
      const tr = data.map((_, i) => i).filter((i) => folds[i] !== fold);
      const ex = tr.map((i) => ({ vec: vecs[i], size: data[i][1], kind: data[i][2] }));
      for (const t of TEMPS) data.forEach((_, i) => { if (folds[i] === fold) {
        (embSize[t] = embSize[t] || [])[i] = centroidProbs(vecs[i], ex, "size", SIZES, t); (embKind[t] = embKind[t] || [])[i] = centroidProbs(vecs[i], ex, "kind", KINDS, t); } });
    }
    for (const t of TEMPS) for (const w of [0, .25, .4, .5, .6, .75, 1]) {
      const bs = wordSize.map((p, i) => Object.fromEntries(SIZES.map((k) => [k, (1 - w) * p[k] + w * embSize[t][i][k]])));
      const bk = wordKind.map((p, i) => Object.fromEntries(KINDS.map((k) => [k, (1 - w) * p[k] + w * embKind[t][i][k]])));
      console.log(`${model.padEnd(26)} temp ${String(t).padEnd(5)} weight ${w.toFixed(2)}: size ${(100 * acc(bs, 1)).toFixed(1)}% (under ${under(bs)})  kind ${(100 * acc(bk, 2)).toFixed(1)}%`);
    }
  }
})();
