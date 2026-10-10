// The list of profiles and which one is active. No vscode here (tests run without it).
//
// Saved as one value (globalState "kural.profiles.v1" in the extension):
//   { active: "<id>", list: [{ id, name, kind: "personal" | "work", share: boolean }] }
// The first profile is always the main one: id "default", named "Personal" until you rename it. It can't be deleted, and
// it is today's Kural (no separate logins, today's data places). `share` on another profile says whether its chats,
// History, open tabs and Tab Completion's memory are the main profile's (true) or its own (false).

const crypto = require("crypto");

const MAIN = "default";
const KINDS = ["personal", "work"];
const MAX_NAME = 30;

const mainProfile = (name = "Personal") => ({ id: MAIN, name, kind: "personal", share: true });

class ProfileStore {
  // read(): the saved value (or undefined); write(value): save it.
  constructor(read, write) { this.readRaw = read; this.writeRaw = write; }

  // Always a usable value: the main profile first, only known kinds, an active profile that exists.
  data() {
    const raw = this.readRaw() || {};
    const seen = new Set([MAIN]);
    const main = (Array.isArray(raw.list) ? raw.list : []).find((p) => p && p.id === MAIN);
    const list = [mainProfile(main && String(main.name || "").trim() ? main.name : "Personal")];
    for (const p of Array.isArray(raw.list) ? raw.list : []) {
      if (!p || typeof p.id !== "string" || seen.has(p.id) || !String(p.name || "").trim()) continue;
      seen.add(p.id);
      list.push({ id: p.id, name: String(p.name).trim().slice(0, MAX_NAME), kind: KINDS.includes(p.kind) ? p.kind : "personal", share: p.share !== false });
    }
    return { active: list.some((p) => p.id === raw.active) ? raw.active : MAIN, list };
  }

  list() { return this.data().list; }
  get(id) { return this.list().find((p) => p.id === id) || null; }
  active() { const d = this.data(); return d.list.find((p) => p.id === d.active); }
  async save(d) { await this.writeRaw(d); }

  // null when the name is fine, else what's wrong (said to the person). exceptId: the profile being renamed.
  checkName(name, exceptId) {
    const n = String(name || "").trim();
    if (!n) return "Give the profile a name.";
    if (n.length > MAX_NAME) return `Use at most ${MAX_NAME} characters.`;
    if (this.list().some((p) => p.id !== exceptId && p.name.toLowerCase() === n.toLowerCase())) return "A profile with this name already exists.";
    return null;
  }

  // A short readable id plus a random ending: "work-a1b2c3". It becomes a folder name, so only a-z, 0-9 and "-".
  newId(name) {
    const slug = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 12).replace(/-+$/, "") || "profile";
    const have = new Set(this.list().map((p) => p.id));
    let id;
    do { id = `${slug}-${crypto.randomBytes(3).toString("hex")}`; } while (have.has(id));
    return id;
  }

  async create({ name, kind, share }) {
    const bad = this.checkName(name);
    if (bad) throw new Error(bad);
    const d = this.data();
    const p = { id: this.newId(name), name: String(name).trim(), kind: KINDS.includes(kind) ? kind : "personal", share: share !== false };
    d.list.push(p);
    await this.save(d);
    return p;
  }

  async rename(id, name) {
    const bad = this.checkName(name, id);
    if (bad) throw new Error(bad);
    const d = this.data(), p = d.list.find((x) => x.id === id);
    if (!p) throw new Error("No such profile.");
    p.name = String(name).trim();
    await this.save(d);
    return p;
  }

  async setShare(id, share) {
    const d = this.data(), p = d.list.find((x) => x.id === id);
    if (!p) throw new Error("No such profile.");
    if (id === MAIN) throw new Error("The main profile's data is what the others share.");
    p.share = !!share;
    await this.save(d);
    return p;
  }

  async setActive(id) {
    const d = this.data();
    if (!d.list.some((p) => p.id === id)) throw new Error("No such profile.");
    d.active = id;
    await this.save(d);
  }

  // Not the main profile, not the one in use (its programs are running).
  async remove(id) {
    const d = this.data();
    if (id === MAIN) throw new Error("The main profile can't be deleted.");
    if (id === d.active) throw new Error("Switch to another profile first: this one is in use.");
    const i = d.list.findIndex((p) => p.id === id);
    if (i < 0) throw new Error("No such profile.");
    const [gone] = d.list.splice(i, 1);
    await this.save(d);
    return gone;
  }
}

module.exports = { ProfileStore, MAIN, KINDS, MAX_NAME };
