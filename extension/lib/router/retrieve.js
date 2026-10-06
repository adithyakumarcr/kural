// Cheap local retrieval. Respect ignore/exclude settings, unsaved editors and workspace boundaries.
const vscode = require("vscode");
const fs = require("fs"), path = require("path"), os = require("os");
const ws = require("../workspace");
const T = require("../search/text");
const { within, isHomeOrAbove, HOME_PROTECTED } = require("../paths");
const { spawn } = require("child_process");

// Use rg's ignore rules for unsaved editors too. Explicitly searching their paths would bypass ignore files.
function visibleEditors(bin, root, globs, query, open, signal) {
  const allowed = new Set();
  const args = ["--files", "--hidden", "--null", "--no-config", "--no-messages", "--no-require-git"];
  if (!query.globalIgnore) args.push("--no-ignore-global");
  if (!query.parentIgnore) args.push("--no-ignore-parent");
  for (const g of globs) args.push("-g", `!${g}`);
  const proc = spawn(bin,args,{ cwd: root,windowsHide: true,stdio: ["ignore","pipe","ignore"] });
  const stop = () => proc.kill();
  const timer = setTimeout(stop,350);
  if (signal) signal.addEventListener("abort",stop,{ once: true });
  let buffer = "";
  const job = new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); if (signal) signal.removeEventListener("abort",stop); resolve(allowed); };
    proc.on("error",finish); proc.on("close",finish);
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data",(d) => {
      buffer += d.toString(); let end;
      while ((end = buffer.indexOf("\0")) >= 0) {
        const file = path.resolve(root,buffer.slice(0,end)); buffer = buffer.slice(end+1);
        if (open.has(file)) allowed.add(file);
      }
    });
  });
  return { job,stop };
}

const STOP = new Set("a an the this that these those to in on at for of and or is are was were be with from where what how why can could would should please find show explain code file files function user users implementation implement want need change make me my it does do using about responsible handles handled".split(" "));
function termsOf(query) {
  return [...new Set(String(query).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) || [])]
    .filter((w) => !STOP.has(w)).slice(0, 8);
}

async function retrieve(query, signal, exclude = []) {
  const terms = termsOf(query);
  if (!terms.length || !ws.folders().length || (signal && signal.aborted)) return [];
  const q = { pattern: terms.join("|"), isRegex: true, matchCase: false, useIgnore: true, followSymlinks: false };
  const found = new Map(), jobs = [];
  const bin = T.rgPath(vscode.env.appRoot);
  const open = new Map((vscode.workspace.textDocuments || []).filter((d) => d.uri.scheme === "file").map((d) => [d.uri.fsPath, d]));
  const roots = await Promise.all(ws.folders().map((f) => fs.promises.realpath(f.path).catch(() => f.path)));
  if (signal && signal.aborted) return [];
  const put = (file, matches) => {
    if (!matches.length || exclude.includes(ws.label(file))) return;
    const score = (m) => terms.reduce((n,t) => n + (m.text.toLowerCase().includes(t) ? 1 : 0) + (file.toLowerCase().includes(t) ? 1 : 0), 0);
    const best = [...matches].sort((a,b) => score(b)-score(a))[0];
    found.set(file, { ...best, lexical: score(best) });
  };
  const stop = () => jobs.forEach((j) => j.stop());
  const timer = setTimeout(stop, 350);
  if (signal) signal.addEventListener("abort", stop, { once: true });
  try {
    for (const f of ws.folders()) {
      const search = vscode.workspace.getConfiguration("search", vscode.Uri.file(f.path));
      const files = vscode.workspace.getConfiguration("files", vscode.Uri.file(f.path));
      let extra = [];
      if (isHomeOrAbove(f.path)) {
        const rel = path.relative(f.path, os.homedir()).split(path.sep).join("/");
        extra = HOME_PROTECTED.map((n) => `${rel ? rel + "/" : ""}${n}/**`);
      }
      const query = { ...q, globalIgnore: search.get("useGlobalIgnoreFiles"), parentIgnore: search.get("useParentIgnoreFiles"),
        excludeGlobs: [...T.settingGlobs(files.get("exclude"), search.get("exclude")),
        "**/node_modules/**", "**/.git/**", "**/.env*", "**/*.pem", ...extra] };
      jobs.push(T.runRg(bin, f.path, ["--no-require-git",...T.rgArgs(query)], (file, matches) => { if (!open.has(file)) put(file, matches); }, { max: 400 }));
      if ([...open.keys()].some((file) => within(file,[f.path]))) {
        const visible = visibleEditors(bin,f.path,query.excludeGlobs,query,open,signal);
        jobs.push({ stop: visible.stop,job: visible.job.then((allowed) => {
          for (const file of allowed) { const text = open.get(file).getText(); if (text.length <= 256000) put(file,T.searchText(text,q,80)); }
        }) });
      }
    }
    await Promise.all(jobs.map((j) => j.job));
    if (signal && signal.aborted) return [];
    const shortlist = [...found.entries()].sort((a,b) => b[1].lexical-a[1].lexical).slice(0, 16);
    const snippets = await Promise.all(shortlist.map(async ([file,m]) => {
      try {
        // A symlink must not turn automatic retrieval into a read outside the project.
        if (!within(await fs.promises.realpath(file), roots)) return null;
        const doc = open.get(file);
        if (!doc && (await fs.promises.stat(file)).size > 256000) return null;
        const text = doc ? doc.getText() : await fs.promises.readFile(file, "utf8");
        if (text.includes("\0")) return null;
        const lines = text.split(/\r?\n/), start = Math.max(0,m.line-7), end = Math.min(lines.length,m.line+12);
        return { file: ws.label(file), line: m.line, text: lines[m.line-1] || "", excerpt: lines.slice(start,end).join("\n").slice(0,2400), startLine: start+1 };
      } catch { return null; }
    }));
    return snippets.filter(Boolean);
  } finally { clearTimeout(timer); if (signal) signal.removeEventListener("abort", stop); }
}

module.exports = { retrieve, termsOf };
