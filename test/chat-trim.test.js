// PERF-1: saving a chat keeps only its last part (extension/lib/chat/trim.js). The first version stringified the whole rest of
// the conversation after every dropped pair: a 5 MB chat froze the window for 1.6 s on every save, a 39 MB one for 52 s.
// Same result as that loop, in time that grows with the size once.
const assert = require("assert");
const { trimMessages } = require("../extension/lib/chat/trim");

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

// The old loop, the reference for what is kept.
function reference(messages, max) {
  let msgs = messages, size = JSON.stringify(msgs).length;
  while (size > max && msgs.length > 2) { msgs = msgs.slice(2); size = JSON.stringify(msgs).length; }
  return msgs;
}
const msg = (i, kb) => ({ role: i % 2 ? "assistant" : "user", blocks: [{ k: "text", text: `m${i} ` + "é✓x".repeat(Math.max(0, Math.round(kb * 1024 / 3))) }] });
const chat = (n, kb) => Array.from({ length: n }, (_, i) => msg(i, kb));

check("same messages kept as the old loop (varied sizes, odd and even counts, limits around the edge)", () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let t = 0; t < 300; t++) {
    const n = Math.floor(rnd() * 14);
    const msgs = Array.from({ length: n }, (_, i) => msg(i, rnd() * 20));
    const total = JSON.stringify(msgs).length;
    for (const max of [0, 1, 500, Math.floor(total * rnd()), total - 1, total, total + 1]) {
      assert.deepStrictEqual(trimMessages(msgs, max), reference(msgs, max), `n=${n} max=${max}`);
    }
  }
});

check("never fewer than the last 2 messages; nothing to trim returns the same array", () => {
  const msgs = chat(7, 30);
  assert.strictEqual(trimMessages(msgs, 10).length, 1);   // 7 -> 5 -> 3 -> 1 (pairs are dropped while more than 2 remain)
  assert.strictEqual(trimMessages(chat(2, 100), 10).length, 2);
  const small = chat(4, 1);
  assert.strictEqual(trimMessages(small, 1e9), small);
  assert.deepStrictEqual(trimMessages([], 10), []);
});

check("a 5 MB chat is trimmed in well under 200 ms (the old loop took ~1.6 s)", () => {
  const msgs = chat(100, 50);   // ~5 MB
  assert.ok(JSON.stringify(msgs).length > 4.5e6);
  const t0 = process.hrtime.bigint();
  const kept = trimMessages(msgs, 150000);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(JSON.stringify(kept).length <= 150000 || kept.length <= 2);
  console.log(`      5 MB chat: ${ms.toFixed(0)} ms, ${kept.length} messages kept`);
  assert.ok(ms < 200, `took ${ms} ms`);
});

check("a 40 MB chat stays quick too (the old loop took ~52 s)", () => {
  const msgs = chat(800, 50);
  const t0 = process.hrtime.bigint();
  trimMessages(msgs, 150000);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`      40 MB chat: ${ms.toFixed(0)} ms`);
  assert.ok(ms < 1500, `took ${ms} ms`);
});

console.log(failed ? `chat-trim: ${failed} FAILED` : "chat-trim: ALL PASS");
process.exit(failed ? 1 : 0);
