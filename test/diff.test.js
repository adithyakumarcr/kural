// Unit tests for the line diff behind every red/green review. No Claude needed.
// Run: node test/diff.test.js
const path = require("path");
const { diffLines } = require(path.resolve(__dirname, "../extension/lib/edit/diff.js"));

const show = (o) => o.map((x) => ({ same: " ", add: "+", del: "-" })[x.op] + x.text).join("\n");
const cases = [
  [["a", "b", "c"], ["a", "B", "c"], " a\n-b\n+B\n c"],
  [["a", "b"], ["a", "b", "c"], " a\n b\n+c"],
  [[], ["x", "y"], "+x\n+y"],
  [["x", "y"], [], "-x\n-y"],
  [["def f():", "    return 1"], ["def f(x):", '    """doc"""', "    return x"], '-def f():\n-    return 1\n+def f(x):\n+    """doc"""\n+    return x'],
];
let ok = true;
for (const [a, b, want] of cases) {
  const got = show(diffLines(a, b));
  if (got !== want) { ok = false; console.log(`FAIL\n${got}\n--- want\n${want}`); }
}
// Keeping same+add must give the new text; same+del must give the old text.
for (let t = 0; t < 500; t++) {
  const r = () => Array.from({ length: Math.floor(Math.random() * 12) }, () => "abcde"[Math.floor(Math.random() * 5)]);
  const a = r(), b = r(), d = diffLines(a, b);
  const nw = d.filter((x) => x.op !== "del").map((x) => x.text), od = d.filter((x) => x.op !== "add").map((x) => x.text);
  if (nw.join() !== b.join() || od.join() !== a.join()) { ok = false; console.log("ROUND TRIP FAIL", a, b); break; }
}
const big = Array.from({ length: 3000 }, (_, i) => "line " + i), big2 = big.slice(); big2[1500] = "changed";
const t0 = Date.now(); diffLines(big, big2);
if (Date.now() - t0 > 500) { ok = false; console.log("too slow on a 3000-line file"); }
// PERF-2: two big files with nothing in common used to build a table of n x m cells (20,000 lines: 13.6 s and 1.6 GB).
// Past the cutoff the changed middle is one block (all removed, then all added): coarser, but correct and instant.
for (const n of [6000, 20000]) {
  const a = Array.from({ length: n }, (_, i) => "old line " + i), b = Array.from({ length: n }, (_, i) => "new line " + i);
  const t1 = Date.now(), d = diffLines(a, b), ms = Date.now() - t1;
  if (ms > 1000) { ok = false; console.log(`${n} x ${n} different lines took ${ms} ms`); }
  if (d.filter((x) => x.op === "add").map((x) => x.text).join() !== b.join() || d.filter((x) => x.op === "del").map((x) => x.text).join() !== a.join()) { ok = false; console.log("big diff doesn't round-trip", n); }
  if (d.length !== 2 * n) { ok = false; console.log("big diff: expected one block of removals and additions", d.length); }
}
{ // a small change in the middle of a huge file is still exact (the common start and end are skipped first)
  const a = Array.from({ length: 50000 }, (_, i) => "line " + i), b = a.slice(); b[25000] = "changed"; b.splice(30000, 0, "inserted");
  const t1 = Date.now(), d = diffLines(a, b), ms = Date.now() - t1;
  const ch = d.filter((x) => x.op !== "same").map((x) => (x.op === "add" ? "+" : "-") + x.text);
  if (ms > 1000 || ch.join("|") !== "-line 25000|+changed|+inserted") { ok = false; console.log("large file with 2 edits:", ms, "ms", ch.slice(0, 5)); }
}
console.log(ok ? "diff: ALL PASS" : "diff: FAILED");
process.exit(ok ? 0 : 1);
