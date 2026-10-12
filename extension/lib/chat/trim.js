// Keeps the last part of a conversation, so saving a chat stays quick. No vscode here (tests run without it).
//
// Drops messages from the start, two at a time (a question and its answer), until what is left is at most `max` characters
// as JSON (but never below 2 messages). The size is worked out once per message and added up: the first version
// stringified the whole remaining array after every drop, which is quadratic (a 5 MB chat took 1.6 s on every save, a 39 MB
// one 52 s, with the window frozen).

// Same result as: while (JSON.stringify(msgs).length > max && msgs.length > 2) msgs = msgs.slice(2)
function trimMessages(messages, max) {
  const n = messages.length;
  if (n <= 2) return messages;
  const lens = messages.map((m) => (JSON.stringify(m) || "null").length);   // (a message's own JSON; the array adds "[", "]" and n-1 commas)
  let total = 0;
  for (const l of lens) total += l;
  let k = 0;                                                    // messages dropped so far
  const size = () => 2 + total + (n - k - 1);                   // JSON.stringify(messages.slice(k)).length
  while (size() > max && n - k > 2) { total -= lens[k] + lens[k + 1]; k += 2; }
  return k ? messages.slice(k) : messages;
}

module.exports = { trimMessages };
