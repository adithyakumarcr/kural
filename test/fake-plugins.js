// The plugin commands of the three AI programs, for the stand-ins test/fake-claude.js, fake-codex.js and fake-agy.js:
// what Kural's Plugins tab runs (extension/lib/plugins/core.js), with the shapes the real programs printed on 18 Oct 2026
// (Claude Code 2.1.296, codex-cli 0.160.0, agy 1.4.2). State in a folder next to the fake's own state file.
//   Claude: Anthropic's plugin directory is built in (superpowers, code-review, needs-command: installing that one
//           needs its marketplace's command accepted, `--accept-command <sha256>`); `marketplace add
//           obra/superpowers-marketplace` adds 2 more. `details` works for installed plugins only, like the real one.
//   Codex:  no plugins until a marketplace is added (obra/superpowers-marketplace); no descriptions in its list.
//   agy:    `validate` / `install` a folder with .antigravity-plugin/plugin.json (or plugin.json) and skills/<name>/SKILL.md.
const fs = require("fs"), path = require("path");

const ACCEPT = "a".repeat(64);
const DIRECTORY = [
  { name: "superpowers", version: "6.4.2", description: "Core skills library for Claude Code: TDD, debugging, collaboration patterns, and proven techniques", source: { source: "url", url: "https://github.com/obra/superpowers.git", sha: "8ca22dba9a94a7e1f4c0de6b37c8e7b1f2a3d4e5" } },
  { name: "code-review", version: "1.0.0", description: "Reviews your changes before you open a pull request", source: { source: "github", repo: "anthropics/claude-plugins-official" } },
  { name: "needs-command", version: "0.1.0", description: "Installed by a command its marketplace declares", source: { source: "url", url: "https://example.com/needs-command.git" } },
];
const MARKETS = {
  "superpowers-marketplace": { repo: "obra/superpowers-marketplace", plugins: [
    { name: "superpowers", version: "7.0.0", description: "Core skills library: TDD, debugging, collaboration patterns, and proven techniques", source: { source: "url", url: "https://github.com/obra/superpowers.git" } },
    { name: "elements-of-style", version: "1.0.0", description: "Writing guidance from The Elements of Style", source: { source: "url", url: "https://github.com/obra/the-elements-of-style.git" } },
  ] },
};
const SKILLS = ["brainstorming", "systematic-debugging", "test-driven-development"];

const out = (o, pretty) => process.stdout.write((pretty ? JSON.stringify(o, null, 2) : JSON.stringify(o)) + "\n");
const load = (f, empty) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return empty; } };
const save = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2)); };
// A plugin folder like the real ones: a manifest and a few skills.
function writePlugin(dir, manifestDir, m) {
  fs.mkdirSync(path.join(dir, manifestDir), { recursive: true });
  fs.writeFileSync(path.join(dir, manifestDir, "plugin.json"), JSON.stringify({ name: m.name, version: m.version, description: m.description, author: { name: "Jesse Vincent" }, homepage: "https://github.com/obra/superpowers", license: "MIT" }));
  for (const s of SKILLS) { fs.mkdirSync(path.join(dir, "skills", s), { recursive: true }); fs.writeFileSync(path.join(dir, "skills", s, "SKILL.md"), `---\nname: ${s}\n---\n`); }
}
const marketOf = (src) => {
  const s = String(src || "").replace(/\.git$/, "").replace(/^https:\/\/github\.com\//, "");
  return Object.keys(MARKETS).find((k) => MARKETS[k].repo === s);
};
const after = (args, flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
// The words after the command, without options ("--json", "--", "--accept-command <sha>").
const words = (args) => { const w = []; for (let i = 0; i < args.length; i++) { if (args[i] === "--accept-command" || args[i] === "--scope" || args[i] === "-s") i++; else if (!args[i].startsWith("-")) w.push(args[i]); } return w; };

// ---------- Claude Code: `claude plugin …` ----------
function claude(args, stateFile) {
  if (args[0] !== "plugin" && args[0] !== "plugins") return false;
  const base = stateFile + ".plugins", file = path.join(base, "state.json");
  const st = load(file, { installed: {}, markets: [] });
  const catalog = () => [
    ...DIRECTORY.map((p) => ({ pluginId: `${p.name}@anthropic-plugin-directory`, name: p.name, description: p.description, marketplaceName: "anthropic-plugin-directory", version: p.version, source: p.source })),
    ...st.markets.flatMap((m) => MARKETS[m].plugins.map((p) => ({ pluginId: `${p.name}@${m}`, name: p.name, description: p.description, marketplaceName: m, version: p.version, source: p.source }))),
  ];
  const result = (o, ok = true) => { out({ command: args[1], outcome: ok ? "ok" : "failed", ...o }); if (!ok) process.stderr.write(`✘ ${o.message}\n`); process.exit(ok ? 0 : 1); };
  const sub = args[1], w = words(args.slice(2));
  if (sub === "list") {
    const installed = Object.entries(st.installed).map(([id, x]) => ({ id, version: x.version, scope: x.scope || "user", enabled: x.enabled, installPath: x.path,
      installedAt: "2026-10-18T13:20:15.693Z", lastUpdated: "2026-10-18T13:20:15.693Z", projectEnabled: false }));
    if (!args.includes("--available")) out(installed, true);
    else out({ installed, available: catalog().filter((p) => !st.installed[p.pluginId]) }, true);
    process.exit(0);
  }
  if (sub === "marketplace") {
    const what = args[2], ww = words(args.slice(3));
    if (what === "list") { out(st.markets.map((m) => ({ name: m, source: "github", repo: MARKETS[m].repo, installLocation: path.join(base, "markets", m) })), true); process.exit(0); }
    if (what === "add") {
      const m = marketOf(ww[0]);
      if (!m) { out({ command: "marketplace-add", outcome: "failed", message: `Failed to clone marketplace repository: ${ww[0]}` }); process.exit(1); }
      if (!st.markets.includes(m)) st.markets.push(m);
      save(file, st); out({ command: "marketplace-add", outcome: "ok", marketplace: m, message: `Cloning…\nSuccessfully added marketplace: ${m} (declared in user settings)` }); process.exit(0);
    }
    if (what === "remove") {
      if (!st.markets.includes(ww[0])) { out({ command: "marketplace-remove", outcome: "failed", message: `Marketplace '${ww[0]}' not found` }); process.exit(1); }
      st.markets = st.markets.filter((m) => m !== ww[0]);
      for (const id of Object.keys(st.installed)) if (id.endsWith("@" + ww[0])) delete st.installed[id];
      save(file, st); out({ command: "marketplace-remove", outcome: "ok", marketplace: ww[0], message: `Successfully removed marketplace: ${ww[0]}` }); process.exit(0);
    }
  }
  // (A bare name finds the installed plugin, like the real one.)
  const id = w[0] && (w[0].includes("@") ? w[0] : Object.keys(st.installed).find((k) => k.startsWith(w[0] + "@")) || w[0]);
  if (sub === "install") {
    const p = catalog().find((x) => x.pluginId === id || x.name === id);
    if (!p) result({ plugin: w[0], scope: "user", message: `Plugin "${w[0]}" not found in any configured marketplace`, failureCode: "not_found" }, false);
    if (p.name === "needs-command" && after(args, "--accept-command") !== ACCEPT && !args.includes("-y"))
      result({ plugin: p.pluginId, scope: "user", message: "This plugin is installed by running a command its marketplace declares: confirm it first", failureCode: "command_confirmation_required",
        shownCommand: { command: "npx -y @example/fetch-needs-command", sha256: ACCEPT } }, false);
    const dir = path.join(base, "cache", p.marketplaceName, p.name, p.version);
    writePlugin(dir, ".claude-plugin", p);
    st.installed[p.pluginId] = { version: `${p.version}-8ca22dba9a94`, enabled: true, path: dir };
    save(file, st); result({ plugin: p.pluginId, pluginId: p.pluginId, scope: "user", message: `Successfully installed plugin: ${p.pluginId} (scope: user)` });
  }
  const have = st.installed[id];
  if (["uninstall", "enable", "disable", "update", "details"].includes(sub) && !have) {
    if (sub === "details") { console.log(`Plugin "${w[0]}" not found. Run \`claude plugin list\` to see installed plugins, or pass --plugin-dir <path> to load one from disk.`); process.exit(1); }
    result({ plugin: w[0], scope: "user", message: `Plugin "${w[0]}" is not installed`, failureCode: "not_installed" }, false);
  }
  if (sub === "uninstall") { delete st.installed[id]; save(file, st); result({ plugin: id, pluginId: id, scope: "user", keptData: false, message: `Successfully uninstalled plugin: ${id.split("@")[0]} (scope: user)` }); }
  if (sub === "enable" || sub === "disable") { have.enabled = sub === "enable"; save(file, st); result({ plugin: w[0], pluginId: id, scope: "user", message: `Successfully ${sub}d plugin: ${id.split("@")[0]} (scope: user)` }); }
  if (sub === "update") result({ plugin: id, pluginId: id, scope: "user", message: `${id.split("@")[0]} is already at the latest version (${have.version}).`, updateOutcome: "up_to_date", oldVersion: have.version, newVersion: have.version });
  if (sub === "details") {
    const name = id.split("@")[0];
    console.log([`Superpowers (${name}) ${have.version.replace(/-.*$/, "")}`, "  Description: Core skills library", `  Source: ${id}`, "",
      "Component inventory", `  Skills (${SKILLS.length})  ${SKILLS.join(", ")}`, "  Agents (0)", "  Hooks (1)  SessionStart  (harness-only — no model context cost)",
      "  MCP servers (0)", "  LSP servers (0)", "", "Projected token cost", "  Always-on:   ~703 tok   added to every session", "",
      "  On-invoke cost is paid each time a skill or agent fires."].join("\n"));
    process.exit(0);
  }
  console.error(`error: unknown command '${sub}'`); process.exit(1);
}

// ---------- Codex: `codex plugin …` ----------
function codex(args, stateFile) {
  if (args[0] !== "plugin") return false;
  const base = stateFile + ".plugins", file = path.join(base, "state.json");
  const home = process.env.CODEX_HOME || path.join(base, "home");
  const st = load(file, { installed: {}, markets: [] });
  const err = (m) => { process.stderr.write(`Error: ${m}\n`); process.exit(1); };
  const entry = (m, p, installed) => ({ pluginId: `${p.name}@${m}`, name: p.name, marketplaceName: m, version: p.version, installed, enabled: installed,
    source: { source: "git", url: p.source.url }, marketplaceSource: { sourceType: "git", source: `https://github.com/${MARKETS[m].repo}.git` }, installPolicy: "AVAILABLE", authPolicy: "ON_INSTALL" });
  const sub = args[1];
  if (sub === "list") {
    const all = st.markets.flatMap((m) => MARKETS[m].plugins.map((p) => entry(m, p, !!st.installed[`${p.name}@${m}`])));
    out({ installed: all.filter((x) => x.installed), available: args.includes("--available") ? all.filter((x) => !x.installed) : [] }, true);
    process.exit(0);
  }
  if (sub === "marketplace") {
    const what = args[2], w = words(args.slice(3));
    const root = (m) => path.join(home, ".tmp", "marketplaces", m);
    if (what === "list") { out({ marketplaces: st.markets.map((m) => ({ name: m, root: root(m), marketplaceSource: { sourceType: "git", source: `https://github.com/${MARKETS[m].repo}.git` } })) }, true); process.exit(0); }
    if (what === "add") {
      const m = marketOf(w[0]);
      if (!m) err(`failed to clone ${w[0]}`);
      if (!st.markets.includes(m)) st.markets.push(m);
      // (Its catalog, where Kural reads the descriptions Codex's list leaves out.)
      save(path.join(root(m), ".claude-plugin", "marketplace.json"), { name: m, owner: { name: "Jesse Vincent" }, plugins: MARKETS[m].plugins });
      save(file, st); out({ marketplaceName: m, installedRoot: root(m), alreadyAdded: false }, true); process.exit(0);
    }
    if (what === "remove") {
      if (!st.markets.includes(w[0])) err(`marketplace \`${w[0]}\` is not configured`);
      st.markets = st.markets.filter((m) => m !== w[0]); save(file, st); out({ marketplaceName: w[0], installedRoot: root(w[0]) }, true); process.exit(0);
    }
  }
  const w = words(args.slice(2)), [name, m] = String(w[0] || "").split("@");
  const p = m && MARKETS[m] && st.markets.includes(m) && MARKETS[m].plugins.find((x) => x.name === name);
  if (sub === "add") {
    if (!p) err(`plugin \`${name}\` was not found in marketplace \`${m}\``);
    const dir = path.join(home, "plugins", "cache", m, name, p.version);
    writePlugin(dir, ".codex-plugin", p);
    st.installed[`${name}@${m}`] = true; save(file, st);
    out({ pluginId: `${name}@${m}`, name, marketplaceName: m, version: p.version, installedPath: dir, authPolicy: "ON_INSTALL" }, true); process.exit(0);
  }
  if (sub === "remove") {
    if (!st.installed[`${name}@${m}`]) err(`plugin \`${w[0]}\` is not installed`);
    delete st.installed[`${name}@${m}`]; save(file, st); out({ pluginId: `${name}@${m}`, name, marketplaceName: m }, true); process.exit(0);
  }
  err(`unrecognized subcommand '${sub}'`);
}

// ---------- Antigravity: `agy plugin …` ----------
function agyManifest(dir) {
  for (const f of [".antigravity-plugin/plugin.json", ".gemini-plugin/plugin.json", "plugin.json"]) {
    const m = load(path.join(dir, f), null);
    if (m && typeof m.name === "string") return { m, f };
  }
  return null;
}
function agy(args, stateFile) {
  if (args[0] !== "plugin" && args[0] !== "plugins") return false;
  const base = stateFile + ".plugins", file = path.join(base, "state.json"), home = path.join(base, "config", "plugins");
  const st = load(file, { installed: {} });
  const sub = args[1], w = words(args.slice(2));
  const skillsOf = (dir) => { try { return fs.readdirSync(path.join(dir, "skills")).filter((s) => fs.existsSync(path.join(dir, "skills", s, "SKILL.md"))).sort(); } catch { return []; } };
  if (sub === "list") {
    const list = Object.entries(st.installed).map(([name, x]) => ({ name, enabled: x.enabled, version: x.version, source: "antigravity", path: path.join(home, name), skills: skillsOf(path.join(home, name)) }));
    if (args.includes("--json")) out(list, true); else for (const x of list) console.log(`${x.name} ${x.version}`);
    process.exit(0);
  }
  if (sub === "validate") {
    const dir = w[0], man = dir && agyManifest(dir);
    const findings = man ? [] : [{ severity: "error", file: "plugin.json", message: "no plugin.json found at the plugin root or in .antigravity-plugin or .gemini-plugin" }];
    out({ dir, manifest: man ? man.f : "", name: man ? man.m.name : "", agentPluginsSpec: false,
      components: { agents: 0, hooks: 0, mcpServers: 0, rules: 0, sidecars: 0, skills: man ? skillsOf(dir).length : 0 }, findings }, true);
    process.exit(man ? 0 : 1);
  }
  if (sub === "install") {
    const dir = w[0], man = dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? agyManifest(dir) : null;
    if (!man) { process.stderr.write(`Error: install target must be a directory: ${dir}\n`); process.exit(1); }
    fs.rmSync(path.join(home, man.m.name), { recursive: true, force: true });
    fs.cpSync(dir, path.join(home, man.m.name), { recursive: true });
    st.installed[man.m.name] = { enabled: true, version: man.m.version || "" }; save(file, st);
    console.log(`  [ok]    ${man.m.name}\n          skills      : ${skillsOf(dir).length} processed`); process.exit(0);
  }
  if (sub === "enable" || sub === "disable") { if (st.installed[w[0]]) { st.installed[w[0]].enabled = sub === "enable"; save(file, st); } process.exit(0); }
  if (sub === "uninstall") {
    if (st.installed[w[0]]) { delete st.installed[w[0]]; fs.rmSync(path.join(home, w[0]), { recursive: true, force: true }); save(file, st); console.log(`Uninstalled plugin "${w[0]}"`); }
    process.exit(0);
  }
  process.stderr.write(`Error: unknown plugin command: ${sub}\n`); process.exit(1);
}

module.exports = { claude, codex, agy, writePlugin, ACCEPT, SKILLS };
