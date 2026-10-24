// Parallel agents in the chat page (the host half: lib/split and the chat's askPlan). Two parts:
//   menuItems(tab)  the model menu's section: "Split big tasks" on or off, and which model the agents use by default
//   card(block)     the plan card: the lead's approach, one row per agent (its task, the files it plans to change, a
//                   model for it, your default picked), Go ahead / Stop, and a box for what to change in the plan
// The agents always use the chat's AI (Claude's models for a Claude chat, ChatGPT's for a Codex one…).
// Loaded by chat.js as a plain script (window.KURAL_SPLIT = make) and by the test with require().
(function () {
  function make(d) {
    // d: el, icon, post(msg), tab() → the shown chat, markdown(text, finished) → nodes, claudeModels() → [{ id, label }],
    //    clis() → [{ id, models }] (Codex, Gemini)
    const picked = new Map();   // "<tab>:<card>" → the model picked for each agent, while the card waits

    // The chat's AI's models.
    function modelsOf(model) {
      const cli = /^(codex|agy):/.exec(model || "");
      if (!cli) return d.claudeModels().map((m) => ({ id: m.id, label: m.label }));
      const c = (d.clis() || []).find((x) => x.id === cli[1]);
      return c ? (c.models || []).map((m) => ({ id: `${c.id}:${m.id}`, label: m.label || m.id })) : [];
    }

    // Pick one model: buttons side by side for a few (Opus · Sonnet · Haiku), a list for more.
    function choose(models, value, onPick, title) {
      if (models.length > 4) {
        const sel = d.el("select", { class: "split-pick", title }, models.map((m) => d.el("option", { value: m.id }, m.label)));
        sel.value = value;
        sel.addEventListener("change", () => onPick(sel.value));
        return sel;
      }
      const seg = d.el("div", { class: "seg split-seg", title });
      for (const m of models) {
        const b = d.el("button", { class: m.id === value ? "on" : "" }, m.label);
        b.addEventListener("click", () => { for (const x of seg.children) x.classList.toggle("on", x === b); onPick(m.id); });
        seg.append(b);
      }
      return seg;
    }

    function menuItems(t) {
      if (/^ollama:/.test(t.model || "")) return [];   // (one GPU for every agent: slower, not faster)
      const editing = t.mode === "agent" || t.mode === "auto", models = modelsOf(t.model);
      return [
        d.el("div", { class: "mh" }, "Parallel agents"),
        d.el("div", { class: `mi${t.split ? " on" : ""}`, role: "menuitemcheckbox", "aria-checked": String(!!t.split),
          title: "The model you picked plans and splits the request; agents build the parts at the same time, each in its own copy of the project (needs Git); Kural merges their work and the lead checks it.",
          onclick: () => d.post({ type: "setSplit", tabId: t.id, on: !t.split }) },
          d.el("span", { class: `check box${t.split ? " on" : ""}` }, t.split ? d.icon("check") : null),
          d.el("span", { class: "mi-label" }, "Split big tasks"),
          d.el("span", { class: "mi-hint" }, editing ? "agents work at once" : "Agent and Auto modes")),
        t.split && models.length ? d.el("div", { class: "split-workers" }, d.el("span", { class: "mi-hint" }, "Agents use"),
          choose(models, t.workers, (id) => d.post({ type: "setWorkers", tabId: t.id, model: id }), "The agents' model; you can change it per agent on the plan")) : null,
      ];
    }

    const TITLES = { pending: (n) => `Split the work between ${n} agents?`, approved: (n) => `${n} agents at work`,
      changed: () => "You asked to change the plan", stopped: () => "Stopped at the plan" };

    function card(b) {
      const t = d.tab(), key = `${t.id}:${b.pid}`, pending = b.state === "pending";
      if (pending && !picked.has(key)) picked.set(key, b.tasks.map((x) => x.model));
      const models = pending ? picked.get(key) : b.tasks.map((x) => x.model);
      const label = (id) => (b.models.find((m) => m.id === id) || { label: id }).label;
      const rows = b.tasks.map((task, i) => d.el("div", { class: "split-row" },
        d.el("span", { class: "split-n" }, String(i + 1)),
        d.el("div", { class: "split-task" }, d.el("div", { class: "split-title" }, task.title),
          (task.files || []).length ? d.el("div", { class: "split-files" }, task.files.slice(0, 5).join(", ") + (task.files.length > 5 ? ` +${task.files.length - 5}` : "")) : null),
        pending ? choose(b.models, models[i], (id) => { models[i] = id; }, `Agent ${i + 1}'s model`) : d.el("span", { class: "agent-role" }, label(models[i]))));
      const node = d.el("div", { class: `split question ${b.state}` },
        d.el("div", { class: "q-title" }, d.icon("organization"), (TITLES[b.state] || TITLES.pending)(b.tasks.length)),
        b.summary ? d.el("div", { class: "split-sum" }, ...d.markdown(b.summary, true)) : null, ...rows);
      if (b.change) node.append(d.el("div", { class: "q-said" }, `To change: ${b.change}`));
      if (!pending) { picked.delete(key); return node; }
      const send = (msg) => d.post({ type: "splitAnswer", tabId: t.id, pid: b.pid, ...msg });
      const change = d.el("input", { class: "q-other", placeholder: "Or say what to change in the plan, then press Enter" });
      change.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || !change.value.trim()) return;
        e.preventDefault(); if (e.stopPropagation) e.stopPropagation();
        send({ change: change.value.trim() });
      });
      node.append(change, d.el("div", { class: "q-foot" },
        d.el("span", { class: "q-hint" }, "Each agent works in its own copy; Kural merges their work, then the lead checks it."),
        d.el("span", { class: "spacer" }),
        d.el("button", { class: "cb", onclick: () => send({ go: false }) }, "Stop"),
        d.el("button", { class: "cb primary", onclick: () => send({ go: true, models: models.slice() }) }, "Go ahead")));
      return node;
    }

    return { menuItems, card, modelsOf };
  }

  if (typeof window !== "undefined") window.KURAL_SPLIT = make;
  if (typeof module !== "undefined") module.exports = make;
})();
