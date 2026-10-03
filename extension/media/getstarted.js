// Get started page (lib/getstarted.js sends the state; this only draws it and sends clicks back).
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  const post = (m) => vscode.postMessage(m);
  let S = null;

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  }
  const btn = (label, type, cls = "", extra = {}) => el("button", { class: `b ${cls}`, onclick: () => post({ type, ...extra }) }, label);
  const link = (label, type) => el("a", { href: "#", onclick: (e) => { e.preventDefault(); post({ type }); } }, label);
  const code = (text) => el("div", { class: "cmd" }, el("code", {}, text), el("button", { class: "b small", onclick: () => post({ type: "copy", text }) }, "Copy"));
  const spin = () => el("span", { class: "spin" });

  // One step: number/status mark, title, what it found, what to do.
  function step(n, title, state, ...body) {
    const mark = { ok: "✓", fail: "✕", warn: "!", running: "", waiting: "" }[state];
    return el("section", { class: `step ${state}` },
      el("div", { class: "mark" }, state === "running" || state === "waiting" ? spin() : mark || String(n)),
      el("div", { class: "body" }, el("h2", {}, title), ...body));
  }

  function claudeStep() {
    const c = S.claude, waiting = S.waiting === "install";
    if (c.state === "checking") return step(1, "Install Claude Code", "running", el("p", { class: "muted" }, "Looking for Claude Code…"));
    if (c.state === "ok") return step(1, "Install Claude Code", "ok",
      el("p", {}, `Claude Code ${c.version}`, el("span", { class: "muted" }, ` · ${c.path}`)),
      c.chosen ? el("p", { class: "muted small" }, "You chose this file. ", link("Find it automatically instead", "forgetPath")) : null);
    const intro = c.state === "broken"
      ? [el("p", {}, "Found ", el("code", {}, c.path), ", but it doesn't run:"), el("pre", { class: "err" }, c.error), el("p", {}, "Install it again:")]
      : [el("p", {}, "Kural's AI comes from Claude Code, Anthropic's coding tool. Kural runs it in the background with your login, so there's no API key to paste.")];
    return step(1, "Install Claude Code", waiting ? "waiting" : c.state === "broken" ? "fail" : "todo",
      ...intro,
      waiting ? el("p", { class: "note" }, "Installing in the terminal below. This page updates by itself when it's done.")
        : el("div", { class: "row" }, btn("Install for me", "install", "primary"), el("span", { class: "muted" }, "runs Anthropic's official installer in a terminal (about a minute)")),
      el("p", { class: "muted small" }, `Or paste this into a ${S.install.shell} yourself:`),
      code(S.install.command),
      el("p", { class: "muted small" }, link("Other ways to install (Homebrew, npm, WinGet)", "docs"), " · ",
        c.chosen ? ["Not found at ", el("code", {}, c.chosenPath), " · ", link("Find it automatically", "forgetPath")] : link("Already installed? Choose the claude file…", "choose")));
  }

  function loginStep() {
    const l = S.login, waiting = S.waiting === "login";
    if (l.state === "blocked" || l.state === "checking") return step(2, "Log in", "todo", el("p", { class: "muted" }, "After step 1."));
    if (l.state === "ok") return step(2, "Log in", "ok", el("p", {}, "Logged in", l.method ? el("span", { class: "muted" }, ` · ${l.method}`) : ""));
    const plan = el("p", { class: "muted small" }, "You need a Claude Pro, Max, Team or Enterprise plan, or an Anthropic Console account (pay as you go). The free plan doesn't include Claude Code.");
    if (l.state === "unknown") return step(2, "Log in", "warn",
      el("p", {}, "Your Claude Code can't say whether it's logged in. The test (step 3) will tell; if it says you're not logged in, log in here."),
      el("div", { class: "row" }, btn("Log in", "login")), plan);
    return step(2, "Log in", waiting ? "waiting" : "todo",
      el("p", {}, "Log in to Claude once. Kural uses the same login as Claude Code."),
      waiting ? el("p", { class: "note" }, "Finish logging in in your browser (the terminal below shows the link). This page updates by itself.")
        : el("div", { class: "row" }, btn("Log in", "login", "primary"), el("span", { class: "muted" }, "opens your browser")),
      plan);
  }

  function testStep() {
    const t = S.test;
    if (t.state === "blocked") return step(3, "Test", "todo", el("p", { class: "muted" }, "After steps 1 and 2."),
      S.claude.state === "ok" ? el("p", { class: "muted small" }, "Using Claude Code with an API key, Bedrock or another provider? ", link("Run the test anyway", "test")) : null);
    if (t.state === "running") return step(3, "Test", "running", el("p", {}, "Asking Claude…"), el("p", { class: "muted small" }, "One tiny request to Claude Haiku, sent the way Kural sends them."));
    if (t.state === "ok") return step(3, "Test", "ok", el("p", {}, `Claude answered in ${(t.ms / 1000).toFixed(1)} s.`), el("p", { class: "muted small" }, "Everything Kural needs works."));
    if (t.state === "fail") return step(3, "Test", "fail", el("p", {}, "The test request failed:"), el("pre", { class: "err" }, t.error),
      t.hint ? el("p", {}, t.hint) : null, el("div", { class: "row" }, btn("Run the test again", "test", "primary")));
    return step(3, "Test", "todo", el("p", {}, "Sends one tiny request to Claude (Haiku), the way Kural does, to make sure it all works."),
      el("div", { class: "row" }, btn("Run the test", "test", "primary")));
  }

  // Optional extras: what they add, whether they're there.
  function extra(name, have, what, ...rest) {
    return el("div", { class: `extra ${have ? "have" : ""}` },
      el("div", { class: "x-head" }, el("span", { class: `x-mark ${have ? "yes" : ""}` }, have ? "✓" : "○"), el("strong", {}, name), el("span", { class: "spacer" }), ...rest),
      el("p", { class: "muted small" }, what));
  }

  function optional() {
    const o = S.optional || {}, ol = o.ollama;
    const kids = [el("h3", {}, "For the full experience", el("span", { class: "tag" }, "optional")),
      el("p", { class: "muted small" }, "Kural works without these, but they make it better.")];
    kids.push(extra("Git", !!o.git, "Claude uses Git to see what changed in your project, and Tab writes your commit messages from it." +
      (S.platform === "win32" ? " On Windows, Git also gives Claude Code a Bash shell for running commands." : ""),
      o.git ? el("span", { class: "muted" }, `Git ${o.git}`) : o.git === undefined ? spin() : btn("Get Git", "git")));
    kids.push(extra("Ollama", ol && ol.running && ol.ok, "Runs small AI models on your own computer: Tab suggestions in a few hundred milliseconds, and chat models that work offline.",
      !ol ? spin() : !ol.running ? btn("Get Ollama", "ollama") : !ol.ok ? el("span", { class: "warn" }, `Ollama ${ol.version}: update to 0.14+`) : el("span", { class: "muted" }, `Ollama ${ol.version}`)));
    if (ol && ol.running) {
      kids.push(el("div", { class: "sub" },
        el("div", { class: "x-head" }, el("span", { class: `x-mark ${o.tabModel ? "yes" : ""}` }, o.tabModel ? "✓" : "○"), `Tab model: ${S.tabModel.id}`, el("span", { class: "muted" }, ` (${S.tabModel.size})`),
          el("span", { class: "spacer" }), o.tabModel ? el("span", { class: "muted" }, "downloaded") : btn("Set up in the Tab panel", "tabModel")),
        el("div", { class: "x-head" }, el("span", { class: `x-mark ${o.chatModels && o.chatModels.length ? "yes" : ""}` }, o.chatModels && o.chatModels.length ? "✓" : "○"),
          o.chatModels && o.chatModels.length ? `Chat models: ${o.chatModels.join(", ")}` : "Chat models for offline use: none yet",
          el("span", { class: "spacer" }), btn(o.chatModels && o.chatModels.length ? "Find more" : "Find & download", "chatModels"))));
    }
    return el("section", { class: "optional" }, ...kids);
  }

  function render() {
    if (!S) return;
    app.replaceChildren(
      el("header", {},
        el("div", { class: "logo" }, "{K}"),
        el("div", {}, el("h1", {}, "Get started with Kural"), el("p", { class: "muted" }, "Three steps. Kural checks each one, so it works the first time.")),
        el("span", { class: "spacer" }), btn("Check again", "recheck", "small")),
      claudeStep(), loginStep(), testStep(),
      el("div", { class: "go" },
        el("button", { class: "b big solid", disabled: !S.ready, onclick: () => post({ type: "done" }) }, "Start using Kural →"),
        el("span", { class: "muted small" }, S.ready ? "All set. Open the chat on the right and ask for a change." :
          "Finish the three steps to start. Until then Kural works as a plain code editor.")),
      optional(),
      el("p", { class: "muted small foot" }, "Open this page again any time: Command Palette → ", el("strong", {}, "Kural: Get Started"), "."));
  }

  window.addEventListener("message", (e) => { if (e.data.type === "state") { S = e.data; render(); } });
  post({ type: "ready" });
})();
