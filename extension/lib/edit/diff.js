// Line-by-line diff: which lines stayed, which were removed, which were added.
// Classic "longest common subsequence": find the most lines both versions share;
// everything else is a removal (old only) or an addition (new only).
//
// The table grows with (old lines x new lines) of the part that differs: 20,000 changed lines took 13.6 s and 1.6 GB. So a
// part over MAX_CELLS is first cut at "anchors" (lines that occur once on each side, in the same order: patience diff), and
// each piece between anchors is diffed on its own. A part with no anchors left is shown as ONE block (all removed, then all
// added): coarser, but correct (keeping the additions gives the new text, the removals the old text) and instant.

// The most table cells worked out exactly at once: 16 million = 64 MB, about 0.1 s.
const MAX_CELLS = 16e6;

function diffLines(oldLines, newLines) {
  const ops = [];
  diffRange(oldLines, newLines, 0, oldLines.length, 0, newLines.length, ops, 0);

  // Show each block of removals before its additions, like a normal diff.
  const out = [];
  let dels = [], adds = [];
  const flush = () => { for (const o of dels) out.push(o); for (const o of adds) out.push(o); dels = []; adds = []; };   // (no spread: 100,000+ arguments overflow the stack)
  for (const o of ops) {
    if (o.op === "same") { flush(); out.push(o); }
    else (o.op === "del" ? dels : adds).push(o);
  }
  flush();
  return out;
}

// Appends the ops for A[a0..a1) against B[b0..b1).
function diffRange(A, B, a0, a1, b0, b1, ops, depth) {
  // Identical lines at the start and end first: it keeps the table small.
  while (a0 < a1 && b0 < b1 && A[a0] === B[b0]) { ops.push({ op: "same", text: A[a0] }); a0++; b0++; }
  let ea = a1, eb = b1;
  while (ea > a0 && eb > b0 && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const n = ea - a0, m = eb - b0;

  if (n * m <= MAX_CELLS) {
    // lcs[i * w + j] = how many lines A[a0+i..] and B[b0+j..] have in common (one flat table: faster and smaller than rows)
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        lcs[i * w + j] = A[a0 + i] === B[b0 + j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[a0 + i] === B[b0 + j]) { ops.push({ op: "same", text: A[a0 + i] }); i++; j++; }
      else if (j < m && (i >= n || lcs[i * w + j + 1] >= lcs[(i + 1) * w + j])) { ops.push({ op: "add", text: B[b0 + j] }); j++; }
      else { ops.push({ op: "del", text: A[a0 + i] }); i++; }
    }
  } else {
    const anchors = depth < 20 ? anchorsOf(A, B, a0, ea, b0, eb) : [];
    if (!anchors.length) {
      for (let i = a0; i < ea; i++) ops.push({ op: "del", text: A[i] });
      for (let j = b0; j < eb; j++) ops.push({ op: "add", text: B[j] });
    } else {
      let pa = a0, pb = b0;
      for (const [i, j] of anchors) {
        diffRange(A, B, pa, i, pb, j, ops, depth + 1);
        ops.push({ op: "same", text: A[i] });
        pa = i + 1; pb = j + 1;
      }
      diffRange(A, B, pa, ea, pb, eb, ops, depth + 1);
    }
  }
  for (let k = ea; k < a1; k++) ops.push({ op: "same", text: A[k] });
}

// Lines that appear exactly once in A[a0..a1) and once in B[b0..b1), the longest run of them in the same order:
// [[indexInA, indexInB], …] (patience sorting: longest increasing subsequence).
function anchorsOf(A, B, a0, a1, b0, b1) {
  const seen = new Map();   // line -> index in A, or -1 when it appears more than once
  for (let i = a0; i < a1; i++) seen.set(A[i], seen.has(A[i]) ? -1 : i);
  const inB = new Map();    // line -> index in B, or -1
  for (let j = b0; j < b1; j++) inB.set(B[j], inB.has(B[j]) ? -1 : j);
  const pairs = [];         // in the order of B
  for (let j = b0; j < b1; j++) {
    const i = seen.get(B[j]);
    if (i !== undefined && i >= 0 && inB.get(B[j]) === j) pairs.push([i, j]);
  }
  // longest increasing subsequence on the A index
  const tails = [], prev = new Array(pairs.length).fill(-1);
  for (let k = 0; k < pairs.length; k++) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pairs[tails[mid]][0] < pairs[k][0]) lo = mid + 1; else hi = mid; }
    if (lo > 0) prev[k] = tails[lo - 1];
    tails[lo] = k;
  }
  const out = [];
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) out.push(pairs[k]);
  return out.reverse();
}

module.exports = { diffLines };
