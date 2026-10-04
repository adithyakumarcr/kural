// Get started page (lib/getstarted.js sends the state; this only draws it and sends clicks back).
// Ways to give Kural its AI: Claude (Claude Code + a Claude plan), your own model (Ollama, offline), ChatGPT (Codex CLI)
// or Gemini (Gemini CLI). Any one is enough.
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
  // Icons: Codicons (VS Code's icon set, media/codicons). Never emoji.
  const icon = (name) => el("i", { class: `codicon codicon-${name}`, "aria-hidden": "true" });
  const gb = (bytes) => bytes ? `${(bytes / 1e9).toFixed(bytes > 1e10 ? 0 : 1)} GB` : "";
  const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

  // One step: number/status mark, title, what it found, what to do.
  function step(n, title, state, ...body) {
    const mark = { ok: "check", fail: "close", warn: "warning" }[state];
    return el("section", { class: `step ${state}` },
      el("div", { class: "mark" }, state === "running" || state === "waiting" ? spin() : mark ? icon(mark) : String(n)),
      el("div", { class: "body" }, el("h2", {}, title), ...body));
  }

  // ---------- the choice ----------
  function choice(path, title, what, facts, done) {
    const on = S.path === path;
    return el("button", { class: `choice ${on ? "on" : ""}`, onclick: () => post({ type: "path", path }) },
      el("div", { class: "c-head" }, el("span", { class: `radio ${on ? "on" : ""}` }), el("strong", {}, title), el("span", { class: "spacer" }),
        done ? el("span", { class: "badge ok" }, icon("check"), " set up") : null),
      el("p", { class: "muted" }, what),
      el("ul", {}, ...facts.map((f) => el("li", {}, f))));
  }

  // ---------- Claude ----------
  function claudeStep() {
    const c = S.claude, waiting = S.waiting === "install";
    if (c.state === "checking") return step(1, "Install Claude Code", "running", el("p", { class: "muted" }, "Looking for Claude Code…"));
    if (c.state === "ok") return step(1, "Install Claude Code", "ok",
      el("p", {}, `Claude Code ${c.version}`, el("span", { class: "muted" }, ` · ${c.path}`)),
      c.chosen ? el("p", { class: "muted small" }, "You chose this file. ", link("Find it automatically instead", "forgetPath")) : null);
    const intro = c.state === "broken"
      ? [el("p", {}, "Found ", el("code", {}, c.path), ", but it doesn't run:"), el("pre", { class: "err" }, c.error), el("p", {}, "Install it again:")]
      : [el("p", {}, "Claude Code is Anthropic's program for Claude. Kural runs it in the background with your login, so there's no API key to paste.")];
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
    if (t.state === "ok") return step(3, "Test", "ok", el("p", {}, `Claude answered in ${secs(t.ms)}.`), el("p", { class: "muted small" }, "Everything works."));
    if (t.state === "fail") return step(3, "Test", "fail", el("p", {}, "The test request failed:"), el("pre", { class: "err" }, t.error),
      t.hint ? el("p", {}, t.hint) : null, el("div", { class: "row" }, btn("Run the test again", "test", "primary")));
    return step(3, "Test", "todo", el("p", {}, "Sends one tiny request to Claude (Haiku), the way Kural does, to make sure it all works."),
      el("div", { class: "row" }, btn("Run the test", "test", "primary")));
  }

  // ---------- your own model ----------
  function ollamaStep() {
    const o = S.local.ollama, waiting = S.waiting === "ollama";
    if (!o) return step(1, "Install Ollama", "running", el("p", { class: "muted" }, "Looking for Ollama…"));
    if (o.running && o.ok) return step(1, "Install Ollama", "ok", el("p", {}, `Ollama ${o.version}`, el("span", { class: "muted" }, " · running")));
    if (o.running) return step(1, "Install Ollama", "fail", el("p", {}, `Your Ollama is ${o.version}; Kural needs a newer one.`),
      el("div", { class: "row" }, btn("Update Ollama", "getOllama", "primary")));
    return step(1, "Install Ollama", waiting ? "waiting" : "todo",
      el("p", {}, "Ollama runs AI models on your own computer. Free, and nothing leaves your computer."),
      waiting ? el("p", { class: "note" }, "Install Ollama and start it. This page updates by itself when it's running.")
        : el("div", { class: "row" }, btn("Get Ollama", "getOllama", "primary"), el("span", { class: "muted" }, S.platform === "linux" ? "runs the official installer in a terminal" : "opens ollama.com/download")),
      el("p", { class: "muted small" }, "Installed already? Start the Ollama app, then ", link("check again", "recheck"), "."));
  }

  function modelStep() {
    const L = S.local, o = L.ollama;
    if (!o || !o.running || !o.ok) return step(2, "Pick a model", "todo", el("p", { class: "muted" }, "After step 1."));
    const pulls = L.pulls || {};
    const have = L.models.map((m) => el("label", { class: `pick ${L.chosen === m.name ? "on" : ""}`, onclick: () => post({ type: "pick", name: m.name }) },
      el("span", { class: `radio ${L.chosen === m.name ? "on" : ""}` }), el("strong", {}, m.name),
      el("span", { class: "muted" }, [m.params, gb(m.size)].filter(Boolean).join(" · "))));
    const fits = (L.recommended || []).filter((r) => !L.models.some((m) => m.name === r.name));
    const get = fits.map((r) => {
      const p = pulls[r.name];
      return el("div", { class: "pick get" }, el("strong", {}, r.name), el("span", { class: "muted" }, `${r.what} · needs ~${r.memory} GB`), el("span", { class: "spacer" }),
        p !== undefined ? el("span", { class: "dl" }, el("span", { class: "bar" }, el("span", { style: `width:${p}%` })), `${p}%`) : btn("Download", "pull", "small", { name: r.name }));
    });
    const chosen = L.chosen && L.models.some((m) => m.name === L.chosen);
    return step(2, "Pick a model", chosen ? "ok" : "todo",
      have.length ? [el("p", {}, "On this computer (models that can use tools, so they can read and edit your files):"), el("div", { class: "picks" }, ...have)]
        : el("p", {}, "You don't have a model that can work with files yet. Download one:"),
      get.length ? [el("p", { class: "muted small" }, have.length ? `Or download one that fits this computer (${S.memory} GB of memory):` : `These fit this computer (${S.memory} GB of memory):`), el("div", { class: "picks" }, ...get)] : null,
      el("p", { class: "muted small" }, "More models: after setup, model menu → ", el("strong", {}, "Find & download models"), "."));
  }

  function localTestStep() {
    const L = S.local, t = L.test;
    if (!L.chosen || !L.models.some((m) => m.name === L.chosen)) return step(3, "Test", "todo", el("p", { class: "muted" }, "After step 2."));
    if (t.state === "running") return step(3, "Test", "running", el("p", {}, `Asking ${L.chosen}…`), el("p", { class: "muted small" }, "The first answer also loads the model into memory: a big one can take a minute."));
    if (t.state === "ok") return step(3, "Test", "ok", el("p", {}, `${t.model} answered in ${secs(t.ms)}.`), el("p", { class: "muted small" }, "It works offline, with no account."));
    if (t.state === "fail") return step(3, "Test", "fail", el("p", {}, `${t.model} didn't answer:`), el("pre", { class: "err" }, t.error),
      el("div", { class: "row" }, btn("Run the test again", "testLocal", "primary")));
    return step(3, "Test", "todo", el("p", {}, `Sends one request to ${L.chosen}, the way Kural will use it.`), el("div", { class: "row" }, btn("Run the test", "testLocal", "primary")));
  }

  // ---------- Codex, Gemini (the same three steps) ----------
  function cliSteps(id) {
    const C = S.cliInfo[id], st = S.clis[id];
    const ib = (label, type, cls = "") => btn(label, type, cls, { id });
    const il = (label, type) => el("a", { href: "#", onclick: (e) => { e.preventDefault(); post({ type, id }); } }, label);
    // 1. Installed
    const i = st.install, installing = S.waiting === `install-${id}`;
    let one;
    if (i.state === "checking") one = step(1, `Install ${C.program}`, "running", el("p", { class: "muted" }, `Looking for ${C.program}…`));
    else if (i.state === "ok") one = step(1, `Install ${C.program}`, "ok", el("p", {}, `${C.program} ${i.version}`, el("span", { class: "muted" }, ` · ${i.path}`)),
      i.chosen ? el("p", { class: "muted small" }, "You chose this file. ", il("Find it automatically instead", "forgetCliPath")) : null);
    else one = step(1, `Install ${C.program}`, installing ? "waiting" : i.state === "broken" ? "fail" : "todo",
      i.state === "broken" ? [el("p", {}, "Found ", el("code", {}, i.path), ", but it doesn't run. Install it again:")]
        : el("p", {}, `${C.program} is the official program for ${C.short}. Kural runs it in the background with its own login, so there's no key to paste.`),
      installing ? el("p", { class: "note" }, "Installing (progress at the bottom right). If the install asks something, Kural asks you in a pop-up. This page updates by itself when it's done.")
        : el("div", { class: "row" }, ib("Install for me", "installCli", "primary"), el("span", { class: "muted" }, "with Homebrew or npm, whichever this computer has")),
      el("p", { class: "muted small" }, "Or paste this into a terminal yourself:"), code(C.install),
      C.installAlt ? el("p", { class: "muted small" }, "Or: ", el("code", {}, C.installAlt)) : null,
      installing ? null : el("p", { class: "muted small" }, il("Install in a terminal instead", "installCliTerminal")),
      el("p", { class: "muted small" }, /npm/.test(C.install) ? "npm comes with Node.js (nodejs.org). " : "", il("Install guide", "cliDocs"), " · ",
        i.chosen ? ["Not found at ", el("code", {}, i.chosenPath), " · ", il("Find it automatically", "forgetCliPath")] : il(`Already installed? Choose the ${id} file…`, "chooseCli")));
    // 2. Logged in
    const l = st.login, loggingIn = S.waiting === `login-${id}`;
    let two;
    if (l.state === "blocked" || l.state === "checking") two = step(2, "Log in", "todo", el("p", { class: "muted" }, "After step 1."));
    else if (l.state === "ok") two = step(2, "Log in", "ok", el("p", {}, "Logged in", [l.email, l.method, l.plan].filter(Boolean).length ? el("span", { class: "muted" }, ` · ${[l.email, l.plan || l.method].filter(Boolean).join(" · ")}`) : ""));
    else two = step(2, "Log in", loggingIn ? "waiting" : l.state === "unknown" ? "warn" : "todo",
      el("p", {}, l.state === "unknown" ? `Kural can't tell whether ${C.short} is logged in. The test (step 3) will tell.` : `Log in to ${C.short} once. Kural uses the same login as ${C.program}.`),
      loggingIn ? el("p", { class: "note" }, "Finish logging in in your browser. This page updates by itself.")
        : [el("div", { class: "row" }, ib("Log in", "loginCli", "primary"), el("span", { class: "muted" }, "opens the login page in your browser")),
          el("p", { class: "muted small" }, il("Log in in a terminal instead", "loginCliTerminal"))]);
    // 3. Test
    const t = st.test;
    let three;
    if (t.state === "blocked") three = step(3, "Test", "todo", el("p", { class: "muted" }, "After steps 1 and 2."));
    else if (t.state === "running") three = step(3, "Test", "running", el("p", {}, `Asking ${C.short}…`));
    else if (t.state === "ok") three = step(3, "Test", "ok", el("p", {}, `${C.short} answered in ${secs(t.ms)}.`), el("p", { class: "muted small" }, "Its models are in the chat's model menu."));
    else if (t.state === "fail") three = step(3, "Test", "fail", el("p", {}, "The test request failed:"), el("pre", { class: "err" }, t.error), el("div", { class: "row" }, ib("Run the test again", "testCli", "primary")));
    else three = step(3, "Test", "todo", el("p", {}, `Sends one tiny request to ${C.short}, the way Kural does.`), el("div", { class: "row" }, ib("Run the test", "testCli", "primary")));
    return [one, two, three];
  }

  // ---------- extras ----------
  function extra(name, have, what, ...rest) {
    return el("div", { class: "extra" },
      el("div", { class: "x-head" }, el("span", { class: `x-mark ${have ? "yes" : ""}` }, icon(have ? "pass-filled" : "circle-large-outline")), el("strong", {}, name), el("span", { class: "spacer" }), ...rest),
      el("p", { class: "muted small" }, what));
  }

  function optional() {
    const o = S.optional || {}, ol = o.ollama;
    const kids = [el("h3", {}, "For the full experience", el("span", { class: "tag" }, "optional")),
      el("p", { class: "muted small" }, "Kural works without these, but they make it better.")];
    kids.push(extra("Git", !!o.git, "Kural uses Git to see what changed in your project, and to write your commit messages." +
      (S.platform === "win32" ? " On Windows, Git also gives Claude Code a Bash shell for running commands." : ""),
      o.git ? el("span", { class: "muted" }, `Git ${o.git}`) : o.git === undefined ? spin() : btn("Get Git", "git")));
    const tabHave = ol && ol.running && o.tabModel;
    kids.push(extra("Tab Completion model", tabHave, `A small code model (${S.tabModel.id}, ${S.tabModel.size}) on your computer: grey suggestions as you type in a few hundred milliseconds, offline.` +
      (S.claudeReady ? " Without it, Tab Completion uses Claude Haiku." : ""),
      !ol ? spin() : !ol.running ? btn("Get Ollama", "ollama") : tabHave ? el("span", { class: "muted" }, "downloaded") : btn("Set up in the Tab Completion panel", "tabModel")));
    if (S.claudeReady && !S.localSet) kids.push(extra("Your own models", !!(o.chatModels && o.chatModels.length), "Chat with a model on your computer when you're offline or want privacy.",
      ol && ol.running ? btn(o.chatModels && o.chatModels.length ? "Find more" : "Find & download", "chatModels") : btn("Set up", "path", "", { path: "local" })));
    return el("section", { class: "optional" }, ...kids);
  }

  function render() {
    if (!S) return;
    const count = [S.claudeReady, !!S.localSet, ...Object.values(S.cliInfo || {}).map((c) => c.set)].filter(Boolean).length;
    const caption = count > 1 ? `${count} are set up. Switch between them in the chat's model menu.`
      : S.ready ? "All set. Open the chat on the right and ask for a change."
        : S.path ? "Finish the three steps to start. Until then Kural works as a plain code editor." : "Pick one to start. You can add others later.";
    app.replaceChildren(
      el("header", {},
        el("div", { class: "logo" }, "{K}"),
        el("div", {}, el("h1", {}, "Get started with Kural"), el("p", { class: "muted" }, "Pick where Kural's AI comes from. Kural checks each step, so it works the first time.")),
        el("span", { class: "spacer" }), btn("Check again", "recheck", "small")),
      el("div", { class: "choices" },
        choice("claude", "Claude", "Anthropic's Claude models: the most capable.", ["Needs a Claude plan and internet", "Agent teams, connectors, skills"], S.claudeReady),
        choice("local", "Your own model", "A model on your computer, through Ollama.", ["Free, no account, works offline", "Your code stays on your computer"], !!S.localSet),
        ...Object.entries(S.cliInfo || {}).map(([id, c]) => choice(id, c.label, c.what, c.facts, c.set))),
      ...(S.path === "claude" ? [claudeStep(), loginStep(), testStep()] : S.path === "local" ? [ollamaStep(), modelStep(), localTestStep()]
        : S.cliInfo && S.cliInfo[S.path] ? cliSteps(S.path) : []),
      el("div", { class: `go ${S.path ? "" : "nopath"}` },
        el("button", { class: "b big solid", disabled: !S.ready, onclick: () => post({ type: "done" }) }, "Start using Kural ", icon("arrow-right")),
        el("span", { class: "muted small" }, caption)),
      optional(),
      el("p", { class: "muted small foot" }, "Open this page again any time: Command Palette → ", el("strong", {}, "Kural: Get Started"), "."));
  }

  window.addEventListener("message", (e) => { if (e.data.type === "state") { S = e.data; render(); } });
  post({ type: "ready" });
})();
