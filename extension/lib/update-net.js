// The updater's downloads, with limits (no vscode inside, so it can be tested): each request has a time limit and a
// size limit, so a slow, stuck or endless answer can't hang Kural or fill the disk. Also: is an error "no connection"?

const fs = require("fs");

const LIMITS = {
  list: { bytes: 8 * 1024 * 1024, ms: 30 * 1000 },          // GitHub's list of releases (JSON)
  manifest: { bytes: 64 * 1024, ms: 30 * 1000 },            // SHA256SUMS and SHA256SUMS.sig
  asset: { bytes: 2 * 1024 * 1024 * 1024, idleMs: 60 * 1000, ms: 30 * 60 * 1000 },   // the download itself
};

class TooBig extends Error {}

// fetch() that gives up after `ms` (also while the body is still coming: the same signal ends the stream).
function fetchLimited(url, { ms, headers, signal } = {}) {
  const timeout = AbortSignal.timeout(ms);
  return fetch(url, { headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
}

// The body as a Buffer, refusing more than `max` bytes (a claimed length is checked first, then what really arrives).
async function readCapped(res, max) {
  const said = +res.headers.get("content-length") || 0;
  if (said > max) throw new TooBig(`the answer is too big (${said} bytes; at most ${max})`);
  const parts = [];
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    got += value.length;
    if (got > max) { reader.cancel().catch(() => {}); throw new TooBig(`the answer is too big (more than ${max} bytes)`); }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

async function getText(url, limit, headers) {
  const res = await fetchLimited(url, { ms: limit.ms, headers });
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  return (await readCapped(res, limit.bytes)).toString("utf8");
}

// Downloads `url` into `file`. Stops when nothing arrives for `idleMs`, after `ms` in all, or past `max` bytes (and past
// the size GitHub lists for the file, when given). `cancel` is an AbortSignal (the Cancel button). onProgress(got, total).
async function downloadTo(url, file, { max = LIMITS.asset.bytes, idleMs = LIMITS.asset.idleMs, ms = LIMITS.asset.ms,
  expectedSize = 0, cancel, onProgress, headers } = {}) {
  const ctl = new AbortController();
  const stop = (why) => ctl.abort(why);
  const signals = [ctl.signal, AbortSignal.timeout(ms)];
  if (cancel) signals.push(cancel);
  const signal = AbortSignal.any(signals);
  let idle = setTimeout(() => stop(Object.assign(new Error("the download stalled"), { name: "TimeoutError" })), idleMs);
  const poke = () => { clearTimeout(idle); idle = setTimeout(() => stop(Object.assign(new Error("the download stalled"), { name: "TimeoutError" })), idleMs); };
  const limit = expectedSize > 0 ? Math.min(max, expectedSize) : max;
  const out = fs.createWriteStream(file);
  try {
    const res = await fetch(url, { signal, headers });
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const total = +res.headers.get("content-length") || 0;
    if (total > limit) throw new TooBig(`the download is bigger than expected (${total} bytes)`);
    const reader = res.body.getReader();
    let got = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      poke();
      got += value.length;
      if (got > limit) { reader.cancel().catch(() => {}); throw new TooBig("the download is bigger than expected"); }
      if (!out.write(value)) await new Promise((r) => out.once("drain", r));
      if (onProgress) onProgress(got, total);
    }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  } catch (e) {
    out.destroy();
    // An abort reports the reason it was given (the stall), or a plain AbortError.
    throw signal.aborted && signal.reason instanceof Error && !(cancel && cancel.aborted) ? signal.reason : e;
  } finally { clearTimeout(idle); }
}

// No network (or it gave up): fetch's "fetch failed" with a DNS/connection cause, or our time limits.
const NET_CODES = /^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ENETDOWN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)$/;
function isOffline(e) {
  for (let x = e, i = 0; x && i < 4; x = x.cause, i++) {
    if (x.name === "TimeoutError") return true;
    if (NET_CODES.test(x.code || "")) return true;
    if (Array.isArray(x.errors) && x.errors.some((y) => NET_CODES.test((y && y.code) || ""))) return true;   // AggregateError
  }
  return false;
}

module.exports = { LIMITS, TooBig, fetchLimited, readCapped, getText, downloadTo, isOffline };
