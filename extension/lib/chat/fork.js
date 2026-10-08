// A fork gets its own provider session. Only the recorded conversation up to the
// selected message and the chat's choices travel with it; runtime state never does.
const { handoff } = require("../router/journal");

function forkConversation(source, index, { id, sessionId, now = Date.now() }) {
  if (!source || source.visiting || source.status !== "idle" || !Number.isInteger(index) || index < 0 || index >= source.messages.length) return null;
  if (!["user", "assistant"].includes(source.messages[index].role) || source.messages[index].running) return null;
  const messages = JSON.parse(JSON.stringify(source.messages.slice(0, index + 1)));
  for (const m of messages) if (m.role === "assistant") {
    m.inherited = true;   // original checkpoints may be reviewed, but never kept or undone from the fork
    m.running = false;
    delete m.planReady; delete m.planBuilt;
    for (const b of m.blocks || []) {
      if (b.k === "perm" && b.state === "pending") b.state = "denied";
      if (b.k === "question" && b.state === "pending") b.state = "skipped";
    }
  }
  const choices = {};
  for (const key of ["model", "effort", "effortPinned", "mode", "prevMode", "mood", "team", "roles", "teamStyle", "autoRoute", "routingProfile", "ticket", "device", "workspace"]) {
    if (source[key] !== undefined) choices[key] = JSON.parse(JSON.stringify(source[key]));
  }
  return {
    ...choices, id, sessionId, title: `${(source.title || "Chat").slice(0, 53)} (fork)`, renamed: true,
    messages, started: false, status: "idle", unread: false, allowAll: false, modelName: null,
    createdAt: now, updatedAt: now, forkedFrom: { id: source.id, title: source.title, index },
    carryOver: { fork: true, text: handoff(messages) },
    // Attachments in the retained messages remain accessible; later grants and "Allow all" do not carry over.
    granted: [...new Set(messages.flatMap((m) => (m.attachments || []).flatMap((a) => [a.path, a.original]).filter(Boolean)))],
  };
}

module.exports = { forkConversation };
