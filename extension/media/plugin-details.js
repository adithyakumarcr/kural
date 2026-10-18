// A plugin's page (an editor tab, like an extension's): what it is, where it comes from, its buttons, and what it adds
// (installed plugins: Claude says, with the tokens it adds to every chat; others: what its folder holds).
// Talks to lib/plugins/index.js (openDetails).
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  document.body.classList.add("details");
  const setFs = (v) => { if (v) document.documentElement.style.setProperty("--fs", v); };
  setFs(document.documentElement.dataset.fs);
  window.addEventListener("error", (e) => vscode.postMessage({ type: "log", message: `${e.message} (${e.lineno})` }));
  const post = (m) => vscode.postMessage(m);

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  }
  const icon = (name) => el("i", { class: `codicon codicon-${name}`, "aria-hidden": "true" });
  const btn = (label, type, primary) => el("button", { class: `pbtn${primary ? " primary" : ""}`, onclick: () => post({ type }) }, label);
  const link = (label, url, ic) => url && el("a", { title: url, onclick: () => post({ type: "openLink", url }) }, icon(ic), label);

  function render(m) {
    const p = m.plugin;
    if (!p) { app.replaceChildren(el("div", { class: "page" }, el("p", { class: "gone" }, "This plugin isn't listed any more."))); return; }
    const can = m.can || {};
    const sub = [m.market && `From ${m.market}`, p.author && `by ${p.author}`, p.license, `for ${m.aiName}`].filter(Boolean);
    const state = p.installed ? (p.readOnly ? "Installed for this project" : p.enabled ? "Installed" : "Installed, turned off") : "";
    const acts = m.busy ? [el("span", { class: "busy" }, m.busy)]
      : !p.installed ? (p.installable ? [btn("Install", "install", true)] : [el("span", { class: "busy" }, "Its marketplace doesn't offer it to install.")])
      : p.readOnly ? [el("span", { class: "busy" }, "Set up by this project: change it there.")]
      : [can.toggle && btn(p.enabled ? "Turn Off" : "Turn On", p.enabled ? "disable" : "enable"), can.update && btn("Update", "update"), btn("Remove", "uninstall")].filter(Boolean);
    const page = el("div", { class: "page" },
      el("h1", {}, p.name, p.fullVersion && el("span", { class: "pver" }, p.fullVersion), state && el("span", { class: "tag" }, state)),
      el("div", { class: "sub" }, sub.flatMap((s, i) => i ? [el("span", { class: "sep" }, "·"), s] : [s])),
      el("p", { class: "desc" }, p.description || "No description."),
      el("div", { class: "acts" }, acts),
      el("div", { class: "links" }, link("Source", p.source, "github"), p.homepage !== p.source && link("Homepage", p.homepage, "link-external")),
      !p.installed && el("div", { class: "warn" }, m.risk));
    if (p.installed) {
      page.append(el("h2", {}, "What it adds"));
      const info = m.info;
      if (!info) page.append(el("p", { class: "cost" }, "Reading…"));
      else if (!info.components || !info.components.length) page.append(el("p", { class: "cost" }, "Kural can't tell what this plugin adds."));
      else {
        page.append(el("div", { class: "inv" }, info.components.flatMap((c) => [el("div", { class: "k" }, `${c.kind} (${c.count})`), el("div", { class: "v" }, c.items || (c.count ? "" : "none"))])));
        if (info.alwaysOn) page.append(el("p", { class: "cost" }, `Adds ${info.alwaysOn} to every chat, before you ask anything (Claude's estimate).`));
      }
      if (p.skills && p.skills.length && !(info && info.components && info.components.some((c) => c.kind === "Skills" && c.items)))
        page.append(el("div", { class: "inv" }, el("div", { class: "k" }, `Skills (${p.skills.length})`), el("div", { class: "v" }, p.skills.join(", "))));
    }
    app.replaceChildren(page);
  }

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.type === "details") render(m);
    else if (m.type === "fontScale") setFs(m.value);
  });
  post({ type: "ready" });
})();
