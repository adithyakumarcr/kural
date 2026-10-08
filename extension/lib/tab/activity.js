// What you've been doing in this workspace, so Tab's suggestions fit you and your current work.
//
// The models never learn (their knowledge is fixed). What changes is what Kural shows them with each
// request: a short note about your recent work. Kural remembers, per workspace, on this computer only:
//   - what you asked the chat, and which files it changed for you (Undo removes a file again)
//   - Ctrl+K and chat "Apply" changes you accepted, with what you asked for
//   - Tab suggestions you accepted (your style)
//   - commands you run in the terminal, and how often
// and, until you close Kural, which files you edited last (and where).
//
// Tab in the editor gets: your current task, files you edited, an edit you just made elsewhere, and a few
// suggestions you accepted in this language. Tab in the terminal gets your usual commands; for a commit
// message, what you did in Kural since the last commit (so the message says *why*, not only what).
//
// Only when you turn it on (setting kural.tabCompletion.learnFromActivity, off by default): what you type can hold
// things a filter misses. Saved in VS Code's workspace storage on this computer; never sent anywhere except inside
// Tab's own requests to the AI you use.
// No vscode here (tests run without it): extension.js and chat.js feed it events.

const MAX_WORK = 40, MAX_ACCEPTED = 30, MAX_COMMANDS = 100;
const RECENT_WORK_MS = 3 * 60 * 60 * 1000;   // "your current task" = chat/Ctrl+K work in the last 3 hours
// Never kept: anything that looks like a password or key. One regex; its pieces catch:
//   password=… token: … api_key=… auth=…  |  "Bearer …", "Authorization:"  |  mysql/psql/mongo -p<password>
//   X-Api-Key headers  |  private_key / private-key  |  -----BEGIN (PEM keys and certificates)  |  AKIA… (AWS key id)
//   ghp_… (GitHub token)  |  sk-… (OpenAI-style keys)  |  xoxb-/xoxp-… (Slack)  |  eyJ….  (a JWT)
const SECRET = /(pass(word|wd)?|secret|token|api[_-]?key|auth)\s*[=:]|bearer\s|authorization:|\b(mysql|psql|mongo(sh)?)\b.*\s-p\S+|x-api-key|private[_-]?key|-----BEGIN|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|sk-[A-Za-z0-9]{20,}|xox[baprs]-|eyJ[A-Za-z0-9_-]{10,}\./i;

const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const ago = (t, now) => {
  const m = Math.round((now - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

class Activity {
  // store: { get(key), update(key, value) } (VS Code's workspaceState); enabled: () => boolean
  constructor(store, enabled = () => true, now = () => Date.now()) {
    this.store = store;
    this.enabled = enabled;
    this.now = now;
    const saved = (store && store.get("kural.activity.v1")) || {};
    this.work = saved.work || [];           // [{ t, source, ask, files: [rel] }]
    this.accepted = saved.accepted || [];   // [{ t, file, lang, before, text }]
    this.commands = saved.commands || {};   // line -> { n, t }
    this.edits = new Map();                 // rel -> { t, line, lang, text }   (not saved)
    this.saveTimer = null;
  }

  save() {
    if (!this.store || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.store.update("kural.activity.v1", { work: this.work, accepted: this.accepted, commands: this.commands });
      if (this.onChange) this.onChange();   // e.g. the Tab panel's counts
    }, 2000);
    if (this.saveTimer.unref) this.saveTimer.unref();
  }

  forget() {
    this.work = []; this.accepted = []; this.commands = {}; this.edits.clear();
    if (this.store) this.store.update("kural.activity.v1", undefined);
  }

  // Anything saved from before (to offer deleting it when learning is off).
  hasData() { return this.work.length + this.accepted.length + Object.keys(this.commands).length > 0; }

  counts() { return { work: this.work.length, accepted: this.accepted.length, commands: Object.keys(this.commands).length }; }

  // ---------- events ----------
  // source: "chat" | "Ctrl+K" | "Apply" | "Insert"; files: workspace-relative paths it changed (may be empty).
  addWork(source, ask, files = []) {
    if (!this.enabled() || !String(ask || "").trim() || SECRET.test(ask)) return;
    this.work.push({ t: this.now(), source, ask: clip(ask, 240), files: [...new Set(files)].slice(0, 12) });
    if (this.work.length > MAX_WORK) this.work.splice(0, this.work.length - MAX_WORK);
    this.save();
  }
  // You undid a file the chat changed: it's no longer part of that work.
  undone(file) {
    let changed = false;
    for (const w of this.work) if (w.files.includes(file)) { w.files = w.files.filter((f) => f !== file); changed = true; }
    if (changed) this.save();
  }
  tabAccepted(file, lang, before, text) {
    if (!this.enabled() || !String(text || "").trim() || SECRET.test(text) || SECRET.test(before)) return;
    this.accepted.push({ t: this.now(), file, lang, before: clip(before, 120), text: String(text).slice(0, 300) });
    if (this.accepted.length > MAX_ACCEPTED) this.accepted.splice(0, this.accepted.length - MAX_ACCEPTED);
    this.save();
  }
  // text: a few lines around the edit (the caller reads them from the document).
  edited(file, lang, line, text) {
    if (!this.enabled()) return;
    this.edits.delete(file);                 // re-insert: Map order = most recent last
    this.edits.set(file, { t: this.now(), line, lang, text: String(text || "").slice(0, 500) });
    if (this.edits.size > 20) this.edits.delete(this.edits.keys().next().value);
  }
  ranCommand(line) {
    line = String(line || "").trim();
    if (!this.enabled() || !line || line.length > 300 || SECRET.test(line)) return;   // never keep passwords/tokens
    const c = this.commands[line] || { n: 0, t: 0 };
    this.commands[line] = { n: c.n + 1, t: this.now() };
    const keys = Object.keys(this.commands);
    if (keys.length > MAX_COMMANDS) {
      keys.sort((a, b) => this.commands[a].t - this.commands[b].t);
      for (const k of keys.slice(0, keys.length - MAX_COMMANDS)) delete this.commands[k];
    }
    this.save();
  }

  // ---------- notes for the models ----------
  // For Tab in the editor. Short on purpose: every character makes the suggestion a little slower.
  tabNote(file, lang) {
    if (!this.enabled()) return "";
    const now = this.now(), out = [];
    const work = this.work.filter((w) => now - w.t < RECENT_WORK_MS).slice(-3).reverse();
    if (work.length) {
      out.push("Current task (what they asked for recently):");
      for (const w of work) out.push(`- ${ago(w.t, now)}, ${w.source}: "${w.ask}"${w.files.length ? ` (changed ${w.files.slice(0, 4).join(", ")})` : ""}`);
    }
    const others = [...this.edits.entries()].filter(([f]) => f !== file).reverse();
    if (others.length) out.push(`Files they edited recently: ${others.slice(0, 5).map(([f]) => f).join(", ")}`);
    const last = others[0];
    if (last && now - last[1].t < 30 * 60 * 1000 && last[1].text.trim()) {
      out.push(`Their last edit elsewhere (${last[0]}, line ${last[1].line + 1}):\n${last[1].text}`);
    }
    const mine = this.accepted.filter((a) => a.lang === lang);
    const examples = [...mine.filter((a) => a.file === file), ...mine.filter((a) => a.file !== file)].slice(-3);
    if (examples.length) {
      out.push("Suggestions they accepted before (their style):");
      for (const a of examples) out.push(`- after ${JSON.stringify(a.before)}: ${JSON.stringify(a.text.slice(0, 160))}`);
    }
    return out.length ? `Their recent work (hints only; never copy this into the file):\n${out.join("\n")}\n\n` : "";
  }

  // For Tab in the terminal. commit: { since (ms, last commit time), files: changed files } or null.
  terminalNote(typed, commit) {
    if (!this.enabled()) return "";
    const now = this.now(), out = [];
    if (commit) {
      const since = commit.since || now - RECENT_WORK_MS;
      const touches = (w) => !commit.files || !commit.files.length || !w.files.length || w.files.some((f) => commit.files.some((c) => c.endsWith(f) || f.endsWith(c)));
      const work = this.work.filter((w) => w.t >= since && touches(w)).slice(-6);
      if (work.length) {
        out.push("What they did in the editor since the last commit (the reason behind the changes):");
        for (const w of work) out.push(`- ${w.source}: "${w.ask}"${w.files.length ? ` → ${w.files.slice(0, 4).join(", ")}` : ""}`);
      }
    } else {
      const head = typed.trim().split(/\s+/)[0];
      const usual = Object.entries(this.commands)
        .filter(([line]) => line.startsWith(typed.trim()) || line.split(/\s+/)[0] === head)
        .sort((a, b) => b[1].n - a[1].n || b[1].t - a[1].t).slice(0, 6);
      if (usual.length) out.push(`Commands they often run here:\n${usual.map(([line, c]) => `$ ${line}   (${c.n}×)`).join("\n")}`);
    }
    return out.length ? `${out.join("\n")}\n` : "";
  }
}

module.exports = { Activity, SECRET };
