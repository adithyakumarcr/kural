// Line-by-line diff: which lines stayed, which were removed, which were added.
// Classic "longest common subsequence": find the most lines both versions share;
// everything else is a removal (old only) or an addition (new only).

function diffLines(oldLines, newLines) {
  // Skip identical lines at the start and end first. It keeps the table small,
  // which matters for whole-file diffs.
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
  let endOld = oldLines.length, endNew = newLines.length;
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) { endOld--; endNew--; }

  const a = oldLines.slice(start, endOld), b = newLines.slice(start, endNew);
  const n = a.length, m = b.length;
  // lcs[i][j] = how many lines a[i..] and b[j..] have in common
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const ops = [];
  for (let k = 0; k < start; k++) ops.push({ op: "same", text: oldLines[k] });
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { ops.push({ op: "same", text: a[i] }); i++; j++; }
    else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) { ops.push({ op: "add", text: b[j] }); j++; }
    else { ops.push({ op: "del", text: a[i] }); i++; }
  }
  for (let k = endOld; k < oldLines.length; k++) ops.push({ op: "same", text: oldLines[k] });

  // Show each block of removals before its additions, like a normal diff.
  const out = [];
  let dels = [], adds = [];
  const flush = () => { out.push(...dels, ...adds); dels = []; adds = []; };
  for (const o of ops) {
    if (o.op === "same") { flush(); out.push(o); }
    else (o.op === "del" ? dels : adds).push(o);
  }
  flush();
  return out;
}

module.exports = { diffLines };
