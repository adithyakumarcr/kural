// BUG-9 / BUG-10: the crash scan (extension/lib/crash/scan.js, no vscode).
//  - BUG-10: "oom" inside another word (zoom, room, bloom) is not an out-of-memory crash;
//  - BUG-9: VS Code's session logs are found from the extension's own log folder (context.logUri), not guessed from the
//    storage path (a different --user-data-dir or logs path, Linux, portable installs).
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const scan = require("../extension/lib/crash/scan");

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

check("oom: only the word OOM (or 'out of memory') counts as a crash line", () => {
  for (const line of ["[error] zoom level changed", "room for improvement", "bloom filter built", "the broom closet", "Zoomed in", "boom"])
    assert.ok(!scan.CRASH_LINE.test(line), `not a crash: ${line}`);
  for (const line of ["[error] renderer OOM at 4 GB", "oom-killer invoked", "JavaScript heap out of memory", "GPU process crashed", "OOM"])
    assert.ok(scan.CRASH_LINE.test(line), `a crash: ${line}`);
});

check("logsRoot: the folder that holds the sessions is found from the extension's log folder", () => {
  const logs = path.resolve(path.sep, "data", "my-logs");   // (resolve: on Windows with its drive, "D:\\data\\my-logs")
  const logUri = path.join(logs, "20261011T101500", "window1", "exthost", "kural.kural");
  assert.strictEqual(scan.logsRoot(logUri, "/guess/logs"), logs);
  assert.strictEqual(scan.logsRoot(path.join(logs, "20261011T101500", "exthost1", "kural.kural"), "/guess/logs"), logs);   // (older layout)
  assert.strictEqual(scan.logsRoot("/somewhere/else/kural.kural", "/guess/logs"), "/guess/logs", "not a session layout: the guess");
  assert.strictEqual(scan.logsRoot(undefined, "/guess/logs"), "/guess/logs");
});

check("sessions are found under the logUri's root even when the storage-based guess is somewhere else", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-crash-"));
  const logs = path.join(tmp, "custom-logs");
  const old = path.join(logs, "20261009T080000"), now = path.join(logs, "20261011T101500");
  fs.mkdirSync(path.join(old, "window1", "exthost"), { recursive: true });
  fs.mkdirSync(path.join(now, "window1", "exthost", "kural.kural"), { recursive: true });
  fs.writeFileSync(path.join(old, "window1", "exthost", "exthost.log"), "2026-10-09 [error] renderer process gone (reason: oom)\n");
  const guess = path.join(tmp, "Kural", "logs");   // what storage-path arithmetic gives: no such folder
  const logUri = path.join(now, "window1", "exthost", "kural.kural");
  const since = new Date("2026-10-08T00:00:00").getTime(), nowMs = new Date("2026-10-11T10:00:00").getTime();
  assert.deepStrictEqual(scan.sessionsSince(guess, since, nowMs), [], "the guess finds nothing");
  const found = scan.sessionsSince(scan.logsRoot(logUri, guess), since, nowMs);
  assert.deepStrictEqual(found.map((s) => s.name), ["20261009T080000"]);
  assert.ok(scan.scanSession(found[0].dir).crashes.length >= 1, "its crash line is read");
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log(failed ? `crash-scan: ${failed} FAILED` : "crash-scan: ALL PASS");
process.exit(failed ? 1 : 0);
