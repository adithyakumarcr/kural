// What the AI does in one browser page, through CDP (cdp.js): read it (snapshot.js), click, type, press keys, choose
// from a list, upload files, drag, scroll, take a picture, wait, go to an address, answer the page's own questions.
// Every click, key and answer is checked against Kural's rule first (guard.js: the AI never publishes). No vscode here.
//
// Clicks and keys are real input events (Input.dispatch*: the page can't tell them from a mouse and a keyboard), at the
// middle of the element, after checking that nothing covers it there. Kural's own code in the page runs in an "isolated
// world" (the page's elements, none of its JavaScript), so a page can't change what Kural's checks see by replacing
// functions. hooks: { commit(verdict) → Promise<{ allow, message? }> (Agent mode asks you), refused(verdict) }.

const path = require("path");
const guard = require("./guard");
const snapshot = require("./snapshot");
const keys = require("./keys");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s, n = 80) => { s = String(s == null ? "" : s).replace(/\s+/g, " "); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// Kural stopped this (the rule, your answer on a card, a dialog in the way): the AI is told why.
class Stop extends Error {}

// ---- Kural's code in the page (the isolated world): installed once per page as globalThis.__kural ----
function helpers() {
  const CLICK = /^(button|link|menuitem|menuitemcheckbox|menuitemradio|tab|option|switch|checkbox|radio|treeitem)$/;
  const BOUND = 'dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"], form, article';
  const SEARCHY = /search|such|recherch|buscar|búsqueda|pesquis|cerca|zoek|szukaj|sök|søg|поиск|検索|搜索|搜尋|검색|खोज|தேட|cari|بحث/i;
  const up = (e) => e.parentElement || (e.getRootNode && e.getRootNode().host) || null;
  const words = (e, n = 2) => String(e.innerText || e.textContent || "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, n).join(" ").slice(0, 160);
  const isText = (e) => !!e && e.nodeType === 1 && (e.tagName === "TEXTAREA" || e.isContentEditable ||
    (e.tagName === "INPUT" && /^(|text|email|number|password|search|tel|url|date|datetime-local|month|time|week)$/i.test(e.getAttribute("type") || "")));
  function role(e) {
    const r = (e.getAttribute("role") || "").trim().split(/\s+/)[0].toLowerCase();
    if (r) return r;
    if (e.tagName === "LABEL" && e.control) return role(e.control);
    if (e.tagName === "INPUT") {
      const t = (e.type || "text").toLowerCase();
      return /^(submit|button|image|reset|file)$/.test(t) ? "button" : t === "checkbox" ? "checkbox" : t === "radio" ? "radio" : t === "range" ? "slider" : t === "search" ? "searchbox" : "textbox";
    }
    if (e.tagName === "A") return e.hasAttribute("href") ? "link" : "";
    return { BUTTON: "button", SUMMARY: "button", SELECT: "combobox", TEXTAREA: "textbox", OPTION: "option" }[e.tagName] || (e.isContentEditable ? "textbox" : "");
  }
  function labels(e) {
    const doc = e.ownerDocument;
    const out = [e.getAttribute("aria-label"), e.getAttribute("title"), e.tagName === "INPUT" && /^(submit|button|reset)$/i.test(e.type) ? e.value : "",
      e.getAttribute("placeholder"), e.getAttribute("aria-placeholder")];
    const by = e.getAttribute("aria-labelledby");
    if (by) out.push(by.split(/\s+/).map((id) => { const x = id && doc.getElementById(id); return x ? words(x) : ""; }).join(" "));
    if (e.labels) for (const l of e.labels) out.push(words(l));
    if (!isText(e)) out.push(words(e));
    if (!words(e)) for (const i of e.querySelectorAll("img[alt], svg[aria-label], [aria-label]")) { out.push(i.getAttribute("alt") || i.getAttribute("aria-label")); if (out.length > 12) break; }
    return out.map((s) => String(s || "").trim()).filter(Boolean).slice(0, 12);
  }
  // Is something being written next to this element (a text box, a video being made), inside its dialog or form?
  const writing = (x, skip) => [...x.querySelectorAll('textarea, [contenteditable], input, video, canvas, img[src^="blob:"]')].some((c) => c !== skip &&
    (c.tagName === "VIDEO" || c.tagName === "CANVAS" || c.tagName === "IMG" || (isText(c) && c.type !== "search" && !SEARCHY.test(labels(c).join(" ")))));
  function composer(e) {
    let x = up(e);
    for (let i = 0; x && i < 7; i++, x = up(x)) {
      if (x === x.ownerDocument.body || x === x.ownerDocument.documentElement || x.tagName === "MAIN" || x.tagName === "NAV") return false;
      if (writing(x, e)) return true;
      if (x.matches(BOUND)) return false;
    }
    return false;
  }
  const clickable = (e) => CLICK.test(role(e)) || e.tagName === "BUTTON" || (e.tagName === "A" && e.hasAttribute("href")) || e.tagName === "SUMMARY" ||
    e.tagName === "LABEL" || e.hasAttribute("onclick") || (e.tagName === "INPUT" && /^(submit|button|image|reset)$/i.test(e.type));
  const item = (e) => ({ role: role(e) || e.tagName.toLowerCase(), labels: labels(e), composer: composer(e) });
  // The element and every element around it that takes clicks (guard.classifyClick). An element that takes clicks only
  // through the page's own script (no role, no button): itself, when it's small.
  function chain(start) {
    let e = start && start.nodeType === 1 ? start : start && (start.parentElement || (start.getRootNode && start.getRootNode().host));
    const first = e, out = [];
    for (let i = 0; e && i < 30; i++, e = up(e)) if (e.nodeType === 1 && clickable(e)) out.push(item(e));
    if (!out.length && first && words(first).length <= 40) out.push(item(first));
    return out;
  }
  function contains(e, other) { for (let x = other, i = 0; x && i < 300; i++) { if (x === e) return true; x = x.parentNode || x.host || null; } return false; }
  function describe(e) {
    const el = e && e.nodeType === 1 ? e : e && e.parentElement;
    if (!el) return "something";
    const r = role(el) || el.tagName.toLowerCase(), l = labels(el)[0] || words(el, 1);
    return `${r}${l ? ` "${l.slice(0, 60)}"` : ""}`;
  }
  function deepActive() {
    let a = document.activeElement;
    for (let i = 0; a && i < 20; i++) {
      if (a.shadowRoot && a.shadowRoot.activeElement) { a = a.shadowRoot.activeElement; continue; }
      if (a.tagName === "IFRAME") { try { const d = a.contentDocument; if (d && d.activeElement && d.activeElement !== d.body) { a = d.activeElement; continue; } } catch (x) { /* another site's frame */ } }
      break;
    }
    return a;
  }
  // What has the keyboard (guard.classifyKey).
  function focus() {
    const a = deepActive();
    if (!a || a === document.body || a === document.documentElement) return { editable: false, chain: [] };
    const editable = isText(a);
    const form = editable && (a.form || (a.closest && a.closest("form")));
    return {
      editable, role: role(a), type: String(a.getAttribute("type") || "").toLowerCase(),
      multiline: a.tagName === "TEXTAREA" || !!a.isContentEditable || a.getAttribute("aria-multiline") === "true",
      labels: labels(a), composer: composer(a), chain: editable ? [] : chain(a),
      form: form ? { submits: [...form.querySelectorAll('button, input[type="submit"], input[type="image"], [role="button"]')]
        .filter((b) => b.tagName !== "BUTTON" || (b.getAttribute("type") || "submit").toLowerCase() === "submit").map((b) => labels(b).join(" · ")).slice(0, 12) } : null,
    };
  }
  function editableIn(e) { if (isText(e)) return e; for (const c of e.querySelectorAll('textarea, input, [contenteditable]')) if (isText(c)) return c; return null; }
  function kind(e) {
    const t = editableIn(e);
    return { editable: !!t, input: !!t && t.tagName === "INPUT", rich: !!t && t.isContentEditable && t.tagName !== "INPUT" && t.tagName !== "TEXTAREA", password: !!t && t.type === "password" };
  }
  function place(e, all) {
    const t = editableIn(e) || e;
    t.focus();
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") { try { if (all) t.select(); else { const n = t.value.length; t.setSelectionRange(n, n); } } catch (x) { /* email, number */ } return true; }
    if (t.isContentEditable) {
      const r = t.ownerDocument.createRange(); r.selectNodeContents(t); if (!all) r.collapse(false);
      const s = t.ownerDocument.getSelection(); s.removeAllRanges(); s.addRange(r); return true;
    }
    return false;
  }
  function choose(e, values) {
    const sel = e.tagName === "SELECT" ? e : e.querySelector && e.querySelector("select");
    if (!sel) return { ok: false, why: "isn't a list of choices (a <select>): click it, then click the choice" };
    const want = (values || []).map((v) => String(v).trim().toLowerCase());
    const opts = [...sel.options];
    const hits = opts.filter((o) => want.includes(o.value.toLowerCase()) || want.includes(o.label.trim().toLowerCase()) || want.includes(o.text.trim().toLowerCase()));
    if (!hits.length) return { ok: false, why: `has no choice called ${(values || []).join(", ")}`, choices: opts.map((o) => o.text.trim()).slice(0, 40) };
    if (sel.multiple) for (const o of opts) o.selected = hits.includes(o); else sel.value = hits[0].value;
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, chosen: hits.map((o) => o.text.trim()) };
  }
  function fileInputs(scope) {
    const out = [];
    const walk = (root) => { for (const i of root.querySelectorAll('input[type="file"]')) out.push(i); for (const h of root.querySelectorAll("*")) if (h.shadowRoot) walk(h.shadowRoot); };
    walk(scope || document);
    return out;
  }
  function fileNear(e) {
    if (e.tagName === "INPUT" && e.type === "file") return e;
    if (e.tagName === "LABEL" && e.control && e.control.type === "file") return e.control;
    for (let x = e, i = 0; x && i < 8; i++, x = up(x)) { const f = x.nodeType === 1 ? fileInputs(x) : []; if (f.length === 1) return f[0]; if (f.length > 1) return null; }
    return null;
  }
  const onlyFile = () => { const f = fileInputs(document); return f.length === 1 ? f[0] : null; };
  const fileCount = () => fileInputs(document).length;
  const multiple = (e) => !!e.multiple;
  // Wait until the page stops changing for `ms` (at most `max`): true if it did.
  function quiet(ms, max) {
    return new Promise((res) => {
      let t = null;
      const ob = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => done(true), ms); });
      const done = (ok) => { ob.disconnect(); clearTimeout(t); clearTimeout(cap); res(ok); };
      ob.observe(document.documentElement || document, { subtree: true, childList: true, attributes: true, characterData: true });
      t = setTimeout(() => done(true), ms);
      const cap = setTimeout(() => done(false), max);
    });
  }
  const hasText = (s) => String(document.body ? document.body.innerText : "").toLowerCase().includes(String(s).toLowerCase());
  return { chain, contains, describe, focus, kind, place, choose, fileNear, onlyFile, fileCount, multiple, quiet, hasText };
}
const HELPERS = `globalThis.__kural = (${helpers.toString()})()`;

class Page {
  // session: a PageSession (cdp.js). platform: for ControlOrMeta. label: the tab's name for the AI ("t1").
  constructor(session, { platform = process.platform, label = "", log = () => {} } = {}) {
    this.s = session;
    this.platform = platform;
    this.label = label;
    this.log = log;
    this.refs = new Map();      // "e12" → { backend, role, name }: the same element keeps its ref while the page lives
    this.refOf = new Map();     // backend node id → "e12"
    this.nextRef = 1;
    this.last = "";             // the last snapshot, to say "the page looks the same"
    this.ctx = null;            // Kural's isolated world in the main frame
    this.frameId = null;
    this.dialogOpen = null;     // { type, message } while the page shows alert / confirm / prompt / "Leave site?"
    this.chooser = null;        // { backend, multiple, at } after a click opened a file chooser (still open: chosen())
    this.loading = false;
    this.offs = [];
  }

  async init() {
    const on = (e, f) => this.offs.push(this.s.on(e, f));
    on("Page.javascriptDialogOpening", (p) => { this.dialogOpen = { type: p.type || "alert", message: p.message || "" }; });
    on("Page.javascriptDialogClosed", () => { this.dialogOpen = null; });
    on("Page.fileChooserOpened", (p) => { if (p.backendNodeId) this.chooser = { backend: p.backendNodeId, multiple: p.mode === "selectMultiple", at: Date.now() }; });
    on("Page.frameStartedLoading", (p) => { if (p.frameId === this.frameId) this.loading = true; });
    on("Page.frameStoppedLoading", (p) => { if (p.frameId === this.frameId) this.loading = false; });
    on("Page.loadEventFired", () => { this.loading = false; });
    // A new page: a new world, and the old refs mean nothing (a new page in another process can reuse the old element
    // ids; its refs keep counting up, so an old ref never names a new element).
    on("Page.frameNavigated", (p) => { if (p.frame && !p.frame.parentId) { this.frameId = p.frame.id; this.ctx = null; this.chooser = null; this.refs.clear(); this.refOf.clear(); } });
    await this.s.send("Page.enable");
    const { frameTree } = await this.s.send("Page.getFrameTree");
    this.frameId = frameTree.frame.id;
  }
  close() { for (const off of this.offs.splice(0)) off(); }
  // A file chooser the page opened in the last 10 minutes and that hasn't had its files yet.
  chosen() { return this.chooser && Date.now() - this.chooser.at < 10 * 60 * 1000 ? this.chooser : null; }

  // ---- Kural's isolated world ----
  async world() {
    if (this.ctx) return this.ctx;
    const { executionContextId } = await this.s.send("Page.createIsolatedWorld", { frameId: this.frameId, worldName: "kural" });
    await this.s.send("Runtime.evaluate", { expression: HELPERS, contextId: executionContextId });
    this.ctx = executionContextId;
    return this.ctx;
  }
  // Run fn(contextId); after a navigation the world is gone: once more in a new one.
  async inWorld(fn) {
    for (let i = 0; ; i++) {
      try { return await fn(await this.world()); }
      catch (e) { if (i < 1 && /context|Cannot find|destroyed/i.test(e.message)) { this.ctx = null; continue; } throw e; }
    }
  }
  async evalWorld(expr, timeout) {
    return this.inWorld(async (contextId) => {
      const r = await this.s.send("Runtime.evaluate", { expression: expr, contextId, returnByValue: true, awaitPromise: true }, timeout);
      if (r.exceptionDetails) throw new Error(short(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text, 300));
      return r.result.value;
    });
  }
  async evalObj(expr) {
    return this.inWorld(async (contextId) => {
      const r = await this.s.send("Runtime.evaluate", { expression: expr, contextId, objectGroup: "kural" });
      return r.result && r.result.objectId ? r.result.objectId : null;
    });
  }
  // A page element as an object in Kural's world (an element in a frame: in that frame's own world, with the helpers made
  // again for the call).
  async resolve(backend, contextId) {
    try { return { id: (await this.s.send("DOM.resolveNode", { backendNodeId: backend, executionContextId: contextId, objectGroup: "kural" })).object.objectId, own: true }; }
    catch (e) {
      if (/context/i.test(e.message)) throw e;   // (Kural's world went with a navigation: inWorld makes a new one)
      if (/No node|not found|Could not find/i.test(e.message)) throw new Stop("That element isn't on the page any more: take a new snapshot (the snapshot tool).");
      return { id: (await this.s.send("DOM.resolveNode", { backendNodeId: backend, objectGroup: "kural" })).object.objectId, own: false };
    }
  }
  // helpers[name](element, ...args) → its value (byValue) or the remote object's id.
  async call(backend, name, args = [], byValue = true) {
    return this.inWorld(async (contextId) => {
      const o = await this.resolve(backend, contextId);
      const fn = o.own ? `function (...a) { return globalThis.__kural.${name}(this, ...a); }` : `function (...a) { return (${helpers.toString()})().${name}(this, ...a); }`;
      const r = await this.s.send("Runtime.callFunctionOn", { objectId: o.id, functionDeclaration: fn, arguments: args.map((a) => a && a.objectId ? a : { value: a }),
        returnByValue: byValue, awaitPromise: true, objectGroup: "kural" });
      if (r.exceptionDetails) throw new Error(short(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text, 300));
      return byValue ? r.result.value : r.result && r.result.objectId ? r.result.objectId : null;
    });
  }
  async backendOfObject(objectId) {
    if (!objectId) return null;
    const { node } = await this.s.send("DOM.describeNode", { objectId });
    return node && node.backendNodeId || null;
  }
  release() { return this.s.send("Runtime.releaseObjectGroup", { objectGroup: "kural" }).catch(() => {}); }

  // ---- reading the page ----
  async info() {
    try {
      const h = await this.s.send("Page.getNavigationHistory", {}, 5000);
      const e = h.entries[h.currentIndex] || {};
      return { url: e.url || "", title: e.title || "" };
    } catch { return { url: "", title: "" }; }
  }
  site(url) { try { return new URL(url).host.replace(/^www\./, ""); } catch { return ""; } }
  async header() {
    const { url, title } = await this.info();
    const out = [`Page ${JSON.stringify(short(title, 120))} · ${url}${this.label ? ` (tab ${this.label})` : ""}`];
    if (this.dialogOpen) out.push(`The page is asking (${this.dialogOpen.type}): ${JSON.stringify(short(this.dialogOpen.message, 300))}. Answer it with the dialog tool before anything else.`);
    if (this.chosen()) out.push("A file chooser is open: choose the file(s) with the upload tool.");
    return out.join("\n");
  }
  ref(backend) {
    let r = this.refOf.get(backend);
    if (!r) { r = `e${this.nextRef++}`; this.refOf.set(backend, r); }
    return r;
  }
  // The page as an outline with refs (snapshot.js). find: only the lines with these words.
  async snapshot({ find } = {}) {
    if (this.dialogOpen) return this.header();   // (the page waits for its question to be answered: nothing else answers)
    const refs = new Map();
    const take = (nodes, maxChars) => {
      const b = snapshot.build(nodes, { maxChars, refFor: (backend) => this.ref(backend) });
      for (const [k, v] of b.refs) refs.set(k, v);
      return b.text;
    };
    const { nodes } = await this.s.send("Accessibility.getFullAXTree", {}, 25000);
    let text = take(nodes);
    // Frames inside the page (a form or a player from the same site): their own trees. Another site's: named only.
    try {
      const { frameTree } = await this.s.send("Page.getFrameTree");
      const frames = [];
      const walk = (t) => { for (const c of t.childFrames || []) { frames.push(c.frame); walk(c); } };
      walk(frameTree);
      let listed = 0;
      for (const f of frames.slice(0, 20)) {
        if (listed >= 6) break;
        // (Frames you can't see, a site's trackers and helpers, aren't worth a line.)
        try {
          const { backendNodeId } = await this.s.send("DOM.getFrameOwner", { frameId: f.id });
          const { quads } = await this.s.send("DOM.getContentQuads", { backendNodeId });
          if (!quads || !quads.length) continue;
        } catch { continue; }
        listed++;
        const where = JSON.stringify(short(f.url, 100));
        try {
          const r = await this.s.send("Accessibility.getFullAXTree", { frameId: f.id }, 8000);
          const t = take(r.nodes, 8000);
          if (t.trim()) text += `\n- frame ${where}\n${t.replace(/^/gm, "  ")}`;
        } catch { text += `\n- frame ${where} (from another site: its contents aren't listed; the screenshot tool shows it)`; }
      }
    } catch { /* no frames */ }
    for (const [k, v] of refs) this.refs.set(k, v);
    const out = `${await this.header()}\n\n${text || "(The page is empty.)"}`;
    this.last = out;
    return find ? `${await this.header()}\n\n${snapshot.filter(text, find)}` : out;
  }
  target(ref) {
    const key = String(ref || "").trim().replace(/^\[|\]$/g, "");
    const r = this.refs.get(key);
    if (!r) throw new Stop(`There's no ${key || "ref"} on the page: take a new snapshot (the snapshot tool) and use a ref from it.`);
    return { ...r, ref: key };
  }
  // Where to click it: the middle of the part of it that's on screen (scrolled there first).
  async pointOf(backend) {
    await this.s.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: backend }).catch(() => {});
    let quads;
    try { ({ quads } = await this.s.send("DOM.getContentQuads", { backendNodeId: backend })); }
    catch (e) { throw new Stop(/No node|not found/i.test(e.message) ? "That element isn't on the page any more: take a new snapshot." : "That element isn't visible (it has no size, or it's hidden)."); }
    const { cssLayoutViewport: vp } = await this.s.send("Page.getLayoutMetrics");
    for (const q of quads || []) {
      const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
      const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(vp.clientWidth, Math.max(...xs));
      const y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(vp.clientHeight, Math.max(...ys));
      if (x1 - x0 >= 1 && y1 - y0 >= 1)
        return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, box: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) } };
    }
    throw new Stop("That element isn't visible on the screen (no size, or outside the page). Scroll to it, or take a new snapshot.");
  }
  // What's on top at a point of the screen (x, y as for a click: relative to what's shown). Chromium's hit test takes
  // the point on the whole page (scrolled part included), a click the point on the screen: measured with Chrome 155 and
  // in VS Code's browser tab, where a narrow tab scrolls sideways.
  async hit({ x, y }) {
    const { cssVisualViewport: vv } = await this.s.send("Page.getLayoutMetrics");
    try {
      const r = await this.s.send("DOM.getNodeForLocation", { x: Math.round(x + (vv.pageX || 0)), y: Math.round(y + (vv.pageY || 0)), includeUserAgentShadowDOM: false, ignorePointerEventsNone: true });
      return r.backendNodeId || null;
    } catch (e) { if (/No node found/i.test(e.message)) return null; throw e; }
  }

  // ---- Kural's rule ----
  async check(v, hooks) {
    if (v.kind === "publish") {
      const { url } = await this.info();
      if (hooks && hooks.refused) hooks.refused({ ...v, site: this.site(url) });
      throw new Stop(guard.refusal(v, this.site(url)));
    }
    if (v.kind === "commit" && hooks && hooks.commit) {
      const ok = await hooks.commit(v);
      if (!ok || !ok.allow) throw new Stop((ok && ok.message) || "The user chose not to do this. Continue without it, or ask them.");
    }
  }
  idle() {
    if (this.dialogOpen) throw new Stop(`The page is asking (${this.dialogOpen.type}): ${JSON.stringify(short(this.dialogOpen.message, 300))}. Answer it with the dialog tool first.`);
  }

  // ---- doing things ----
  // A click by ref (the middle of the element) or at x, y (a picture's coordinates, from the screenshot tool).
  async click({ ref, x, y, double = false, button = "left" } = {}, hooks) {
    this.idle();
    let t = null, pt;
    if (ref) { t = this.target(ref); pt = await this.pointOf(t.backend); }
    else if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) pt = { x: Number(x), y: Number(y) };
    else throw new Stop("Give the ref of what to click (from a snapshot), or x and y.");
    const hit = await this.hit(pt);
    if (!hit) throw new Stop("There's nothing to click at that point.");
    // What gets the click is what's on top there: a dialog or a banner over the element gets it instead.
    if (t && hit !== t.backend) {
      let inside = true;
      try { const o = await this.inWorld(async (ctx) => (await this.resolve(hit, ctx)).id); inside = await this.call(t.backend, "contains", [{ objectId: o }]); } catch { /* can't tell: the check below is on what's really there */ }
      if (!inside) {
        const what = await this.call(hit, "describe").catch(() => "something else");
        this.release();
        throw new Stop(`${t.ref} is covered by ${what} there. Close or move that first (or click it, if that's what you meant).`);
      }
    }
    // (If Kural can't see what's there, it doesn't click: the rule fails closed.)
    const chain = await this.call(hit, "chain").catch((e) => { throw e instanceof Stop ? e : new Stop(`Kural couldn't check what's at that point (${short(e.message, 120)}), so it didn't click.`); });
    await this.check(guard.classifyClick(chain), hooks);
    await this.withChooser(() => this.mouse(pt, { double, button }));
    this.release();
    const what = t ? `${t.role}${t.name ? ` "${short(t.name, 60)}"` : ""}` : `at ${Math.round(pt.x)}, ${Math.round(pt.y)}`;
    return this.after(`Clicked ${what}.`);
  }
  async mouse({ x, y }, { double = false, button = "left" } = {}) {
    const b = ["left", "right", "middle"].includes(button) ? button : "left";
    const buttons = { left: 1, right: 2, middle: 4 }[b];
    await this.input("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    for (let n = 1; n <= (double ? 2 : 1) && !this.dialogOpen; n++) {
      await this.input("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: b, buttons, clickCount: n });
      await this.input("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: b, buttons: 0, clickCount: n });
    }
  }
  // One input event. A click or key that makes the page ask something (confirm(), "Leave site?") only gets its answer from
  // Chromium once the question is answered: Kural stops waiting when the question appears.
  async input(method, params) {
    const p = this.s.send(method, params);
    p.catch(() => {});
    await this.untilAsked(p);
  }
  // A page's upload button opens a file chooser: Kural catches it (for the upload tool) instead of the computer's own window.
  async withChooser(fn) {
    await this.s.send("Page.setInterceptFileChooserDialog", { enabled: true }).catch(() => {});
    try { return await fn(); }
    finally { setTimeout(() => this.s.send("Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {}), 1500); }
  }

  // Type into a text box: replacing what's there (replace), or after it. Lines: "\n" in the text.
  async type({ ref, text = "", replace = true } = {}) {
    this.idle();
    const t = this.target(ref);
    await this.pointOf(t.backend).catch(() => {});
    const k = await this.call(t.backend, "kind");
    if (!k.editable) throw new Stop(`${t.ref} (${t.role} "${short(t.name, 60)}") isn't a text box. Click it first if it opens one, or use the text box's own ref.`);
    await this.call(t.backend, "place", [!!replace]);
    this.release();
    // (Every line break as "\n": a lone "\r" is the Enter key's character.)
    let s = String(text == null ? "" : text).replace(/\r\n?/g, "\n");
    if (k.input) s = s.replace(/\n/g, " ");
    if (replace && !s) await this.key(keys.parse("Backspace", this.platform));
    else if (k.rich && /\n/.test(s)) {
      // (A rich text box, like a caption: a new line is Shift+Enter there. Plain Enter can post: guard.classifyKey.)
      const lines = s.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (i) await this.key(keys.parse("Shift+Enter", this.platform));
        if (lines[i]) await this.s.send("Input.insertText", { text: lines[i] });
      }
    } else await this.s.send("Input.insertText", { text: s });
    return this.after(`Typed ${k.password ? "the password" : JSON.stringify(short(s, 80))} into ${t.role} "${short(t.name, 60)}".`);
  }
  async key(k) { for (const e of keys.events(k)) { if (this.dialogOpen) break; await this.input("Input.dispatchKeyEvent", e); } }
  // A key (Enter, Escape, Tab, ArrowDown, "a", Shift+Tab, ControlOrMeta+A), on what has the keyboard or on ref.
  async press({ key, ref } = {}, hooks) {
    this.idle();
    const k = keys.parse(key, this.platform);
    if (!k) throw new Stop(`Kural doesn't know the key ${JSON.stringify(key)}. Use names like Enter, Escape, Tab, ArrowDown, Backspace, Space, a, Shift+Tab, ControlOrMeta+A.`);
    if (ref) { const t = this.target(ref); await this.pointOf(t.backend).catch(() => {}); await this.s.send("DOM.focus", { backendNodeId: t.backend }).catch(() => {}); }
    const focus = await this.evalWorld("globalThis.__kural.focus()").catch(() => null);
    if (!focus && /^(Enter| )$/.test(k.key)) throw new Stop("Kural couldn't check what has the keyboard, so it didn't press that key (Enter and Space can send things).");
    await this.check(guard.classifyKey({ key: k.key, modifiers: k.mods }, focus || {}), hooks);
    await this.withChooser(() => this.key(k));
    return this.after(`Pressed ${key}.`);
  }
  // Pick choices in a list (<select>) by their text or value.
  async select({ ref, values } = {}) {
    this.idle();
    const t = this.target(ref);
    const r = await this.call(t.backend, "choose", [Array.isArray(values) ? values : [values]]);
    this.release();
    if (!r.ok) throw new Stop(`${t.ref} ${r.why}${r.choices ? ` (its choices: ${r.choices.join(" | ")})` : ""}.`);
    return this.after(`Chose ${r.chosen.map((c) => JSON.stringify(c)).join(", ")} in ${t.role} "${short(t.name, 60)}".`);
  }
  // Files for the page's file box: the one a click opened (the file chooser), the one at ref, or the page's only one.
  async upload({ ref, files } = {}) {
    this.idle();
    files = (files || []).map(String).filter(Boolean);
    if (!files.length) throw new Stop("Which files? Give their full paths.");
    let backend = null, multiple = true;
    if (this.chosen()) ({ backend, multiple } = this.chooser);
    else {
      if (ref) backend = await this.backendOfObject(await this.call(this.target(ref).backend, "fileNear", [], false));
      if (!backend) {
        const n = await this.evalWorld("globalThis.__kural.fileCount()");
        if (n > 1 && !ref) throw new Stop(`This page has ${n} file boxes: give the ref of the upload button or area to use.`);
        if (n === 1) backend = await this.backendOfObject(await this.evalObj("globalThis.__kural.onlyFile()"));
      }
      if (backend) multiple = await this.call(backend, "multiple");
    }
    this.release();
    if (!backend) throw new Stop("There's no file box on this page yet: click the page's own upload button first (\"Select from computer\", \"Upload\"), then use the upload tool.");
    if (files.length > 1 && !multiple) throw new Stop("That file box takes one file.");
    await this.s.send("DOM.setFileInputFiles", { files, backendNodeId: backend });
    this.chooser = null;
    return this.after(`Chose ${files.map((f) => path.basename(f)).join(", ")} for the page.`, 4000);
  }
  // Drag from ref (or x, y) to toRef (or toX, toY, or by dx, dy): a slider, a trim handle, a crop box.
  async drag({ ref, x, y, toRef, toX, toY, dx, dy } = {}, hooks) {
    this.idle();
    const from = ref ? await this.pointOf(this.target(ref).backend) : Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? { x: Number(x), y: Number(y) } : null;
    if (!from) throw new Stop("Drag from where? Give ref, or x and y.");
    const to = toRef ? await this.pointOf(this.target(toRef).backend)
      : Number.isFinite(Number(toX)) && Number.isFinite(Number(toY)) ? { x: Number(toX), y: Number(toY) }
      : { x: from.x + (Number(dx) || 0), y: from.y + (Number(dy) || 0) };
    // A button that acts when it's pressed (or let go of) acts on a drag too: both ends are checked like a click.
    for (const pt of [from, to]) {
      const hit = await this.hit(pt);
      if (!hit) continue;
      const chain = await this.call(hit, "chain").catch((e) => { throw e instanceof Stop ? e : new Stop(`Kural couldn't check what's at that point (${short(e.message, 120)}), so it didn't drag.`); });
      await this.check(guard.classifyClick(chain), hooks);
    }
    this.release();
    await this.s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
    await this.s.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 });
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await this.s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps, button: "left", buttons: 1 });
      await sleep(16);
    }
    await this.s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1 });
    return this.after(`Dragged from ${Math.round(from.x)}, ${Math.round(from.y)} to ${Math.round(to.x)}, ${Math.round(to.y)}.`);
  }
  // The mouse wheel over ref (or the middle of the page): dy > 0 is down.
  async scroll({ ref, dx = 0, dy = 600 } = {}) {
    this.idle();
    let pt;
    if (ref) pt = await this.pointOf(this.target(ref).backend);
    else { const { cssLayoutViewport: vp } = await this.s.send("Page.getLayoutMetrics"); pt = { x: vp.clientWidth / 2, y: vp.clientHeight / 2 }; }
    await this.s.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: pt.x, y: pt.y, deltaX: Number(dx) || 0, deltaY: Number(dy) || 0 });
    await sleep(350);
    return this.after(`Scrolled ${Number(dy) >= 0 ? "down" : "up"}${dx ? ` and ${Number(dx) > 0 ? "right" : "left"}` : ""}.`);
  }
  // A picture of what's on screen (or of one element): { data (base64), mime, width, height }. In the page's own pixels
  // (CSS pixels, not the screen's: a Retina screen has two of those per pixel), so a point in it is what click takes.
  async screenshot({ ref } = {}) {
    this.idle();
    const { cssVisualViewport: vv } = await this.s.send("Page.getLayoutMetrics");
    const dpr = Number(await this.evalWorld("devicePixelRatio", 3000).catch(() => 1)) || 1;
    let box = { x: 0, y: 0, width: vv.clientWidth, height: vv.clientHeight };
    if (ref) box = (await this.pointOf(this.target(ref).backend)).box;
    const clip = { x: box.x + vv.pageX, y: box.y + vv.pageY, width: Math.max(1, box.width), height: Math.max(1, box.height), scale: 1 / dpr };
    const { data } = await this.s.send("Page.captureScreenshot", { format: "jpeg", quality: 80, clip }, 15000);
    return { data, mime: "image/jpeg", width: Math.round(clip.width), height: Math.round(clip.height) };
  }
  // Wait for words to appear (text) or go (gone), or just a while (seconds).
  async wait({ text, gone, seconds } = {}) {
    const words = text || gone;
    const max = Math.min(Math.max(Number(seconds) || (words ? 15 : 2), 0.2), 60) * 1000;
    const end = Date.now() + max;
    if (!words) { await sleep(max); return this.after(`Waited ${Math.round(max / 100) / 10} s.`); }
    for (;;) {
      if (this.dialogOpen) return this.after("The page asked something meanwhile.");
      const has = await this.evalWorld(`globalThis.__kural.hasText(${JSON.stringify(String(words))})`, 5000).catch(() => null);
      if (text ? has === true : has === false) return this.after(text ? `${JSON.stringify(text)} is on the page.` : `${JSON.stringify(gone)} is gone.`);
      if (Date.now() > end) return this.after(text ? `Waited ${max / 1000} s: ${JSON.stringify(text)} didn't appear.` : `Waited ${max / 1000} s: ${JSON.stringify(gone)} is still there.`);
      await sleep(500);
    }
  }
  // Another address, or back / forward / reload.
  async navigate({ url, back, forward, reload } = {}) {
    this.idle();
    this.loading = true;
    let done;
    try {
      if (url) {
        const r = await this.untilAsked(this.s.send("Page.navigate", { url }, 30000));
        if (r && r.errorText) throw new Stop(`Couldn't open ${url}: ${r.errorText}.`);
        if (r && !r.loaderId) this.loading = false;   // (the same page: only its #part changed)
        done = `Opened ${url}.`;
      } else if (reload) { await this.s.send("Page.reload", {}); done = "Reloaded the page."; }
      else {
        const h = await this.s.send("Page.getNavigationHistory");
        const e = h.entries[h.currentIndex + (back ? -1 : 1)];
        if (!e) throw new Stop(back ? "There's no page to go back to." : "There's no page to go forward to.");
        await this.untilAsked(this.s.send("Page.navigateToHistoryEntry", { entryId: e.id }));
        done = back ? "Went back." : "Went forward.";
      }
    } catch (e) { this.loading = false; throw e; }
    return this.after(done);
  }
  // Answer the page's own question: OK (accept) or Cancel; text for a prompt. "Leave site?" (your changes may be lost)
  // asks first like Discard does; OK to "Publish this?" is never said.
  async dialog({ accept, text } = {}, hooks) {
    const d = this.dialogOpen;
    if (!d) throw new Stop("The page isn't asking anything right now.");
    const v = guard.classifyDialog(d.message, !!accept);
    if (v.kind === "publish") await this.check({ ...v, why: "dialog" }, hooks);
    if (accept && d.type === "beforeunload") await this.check({ kind: "commit", word: "leave", label: "Leave the page (changes on it may be lost)" }, hooks);
    await this.s.send("Page.handleJavaScriptDialog", { accept: !!accept, ...(text !== undefined && text !== null ? { promptText: String(text) } : {}) });
    this.dialogOpen = null;
    return this.after(accept ? "Said OK." : "Said Cancel.");
  }

  // A tab that was just opened: until its page (url, not the blank one before it) has loaded, at most ms.
  async ready(url, ms = 15000) {
    const end = Date.now() + ms;
    const blank = !url || /^about:/.test(url);
    for (;;) {
      const s = await this.evalWorld("[document.readyState, location.href]", 3000).catch(() => null);
      if (s && s[0] === "complete" && (blank || !/^about:/.test(s[1]))) break;
      if (Date.now() > end || this.dialogOpen) break;
      if (!s) this.ctx = null;   // (the blank page's world went with it)
      await sleep(200);
    }
    this.loading = false;
    await this.settle(1500);
  }

  // ---- after an action: let the page settle, then what it shows now ----
  // (A promise that a page's question would hold up: given up on when the question appears.)
  async untilAsked(p) {
    let stop = false;
    const asked = (async () => { while (!stop) { if (this.dialogOpen) return null; await sleep(100); } return null; })();
    try { return await Promise.race([p, asked]); } finally { stop = true; }
  }
  async settle(max = 2000) {
    await sleep(120);
    const end = Date.now() + 10000;
    while (this.loading && !this.dialogOpen && Date.now() < end) await sleep(100);
    if (this.dialogOpen) return;
    await this.untilAsked(this.evalWorld(`globalThis.__kural.quiet(250, ${max})`, max + 3000).catch(() => {}));
  }
  async after(done, max) {
    await this.settle(max);
    const before = this.last;
    const now = await this.snapshot();
    return now === before ? `${done}\n\n(The page looks the same as before.)` : `${done}\n\n${now}`;
  }

  // The second stop: requests that publish on sites Kural knows (guard.NETWORK) fail while Kural is attached.
  async guardNetwork(onBlocked) {
    this.offs.push(this.s.on("Fetch.requestPaused", (p) => {
      const req = p.request || {};
      const rule = guard.blockedRequest(req.url, req.method);
      (rule ? this.s.send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" })
        : this.s.send("Fetch.continueRequest", { requestId: p.requestId })).catch(() => {});
      if (rule && onBlocked) onBlocked(rule, req.url);
    }));
    await this.s.send("Fetch.enable", { patterns: guard.NETWORK.map((r) => ({ urlPattern: r.pattern, requestStage: "Request" })) });
  }
}

module.exports = { Page, Stop, helpers };
