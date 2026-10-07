// Kural's word classifier (lib/router/words.js): the shipped weights match the examples, and it's fast.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { build } = require("../scripts/train-router");
const { classifyWords, tokens, _reset } = require("../extension/lib/router/words");
let passed = 0, failed = 0;
const check = (name, fn) => { try { fn(); passed++; console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

check("words-model.json is what scripts/train-router.js makes from examples.json (run it after changing the examples)", () => {
  const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "extension", "lib", "router", "words-model.json"), "utf8"));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(build())), shipped);
});
check("tokens: words, word pairs, a length bucket; file names count as \"file\"", () => {
  const t = tokens("Rename architecture.md now");
  assert.ok(t.includes("rename") && t.includes("file") && t.includes("rename_file") && !t.some((x) => x.includes("architecture")));
  assert.ok(t.some((x) => /^len\d$/.test(x)));
});
check("it classifies the obvious cases and gives probabilities", () => {
  _reset();
  const r = classifyWords("whats 2+2");
  assert.strictEqual(r.size, "simple");
  assert.ok(Math.abs(Object.values(r.sizeProbs).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.strictEqual(classifyWords("migrate the whole project from javascript to typescript").size, "complex");
  assert.strictEqual(classifyWords("add input validation to the signup form").size, "standard");
});
check("well under a millisecond per request", () => {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 2000; i++) classifyWords("add retry with exponential backoff to the http client and tests " + i);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 2000;
  assert.ok(ms < 0.5, `${ms} ms`);
});
console.log(`router-words: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
