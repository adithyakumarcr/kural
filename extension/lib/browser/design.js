// Design Mode's Kural side for one browser tab (no vscode here; lib/browser/design-host.js wires it to the editor and the
// chat). It puts design-page.js into the page, in Kural's own isolated world "kural-design" (also into every page the tab
// loads next: Page.addScriptToEvaluateOnNewDocument), listens to it through one binding only that world has
// (Runtime.addBinding), and turns its notes into what the chat's AI gets:
//   each element: tag, id, classes, attributes, a selector path, its first 200 characters of text, size and position, six
//   computed styles, the start of its HTML, and its React / Vue / Svelte component (name, the components around it, source
//   file and line in a dev build), read in the page's own world (PROBE: the page's JavaScript objects live there);
//   a picture cropped to the elements / the area / your markup, taken with Design Mode's own toolbar and outlines hidden;
//   your words, CSS you changed and text you edited (old -> new).
// Notes are sent at once (Return), go to the chat box (Cmd/Ctrl+L, Option/Alt+click, Dictate), or wait as pins (Batch) and
// go together with Send (n).
const fs = require("fs");
const path = require("path");

const WORLD = "kural-design";
const BINDING = "__kuralDesignSend";
let SOURCE = null;
const source = () => SOURCE || (SOURCE = fs.readFileSync(path.join(__dirname, "design-page.js"), "utf8"));
const MAX_PIXELS = 4e6;   // (a bigger picture is taken at the page's own scale, as a JPEG)

// Runs in the page's own world on the picked element (`this`): its framework component, if a dev build left the trail.
const PROBE = `function () {
  const out = { framework: null, name: null, stack: [], file: null, line: null };
  const s = (v, n) => (typeof v === "string" && v ? v.slice(0, n || 120) : null);
  try {
    const el = this;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
    if (key) {
      out.framework = "React";
      for (let f = el[key], i = 0; f && i < 120 && out.stack.length < 8; f = f.return, i++) {
        const t = f.type;
        if (!t || typeof t === "string") continue;
        const n = s(t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name)));
        if (n && out.stack[out.stack.length - 1] !== n) out.stack.push(n);
        if (!out.file && f._debugSource) { out.file = s(f._debugSource.fileName, 300); out.line = Number(f._debugSource.lineNumber) || null; }
      }
    }
    if (!out.framework) {
      let n = el; while (n && !n.__vueParentComponent && !n.__vue__) n = n.parentElement;
      if (n && n.__vueParentComponent) {
        out.framework = "Vue";
        for (let c = n.__vueParentComponent, i = 0; c && i < 60 && out.stack.length < 8; c = c.parent, i++) {
          const t = c.type || {};
          const nm = s(t.name || t.__name || (typeof t.__file === "string" ? t.__file.split(/[\\\\/]/).pop().replace(/\\.vue$/, "") : null));
          if (nm) out.stack.push(nm);
          if (!out.file && typeof t.__file === "string") out.file = s(t.__file, 300);
        }
      } else if (n && n.__vue__) {
        out.framework = "Vue";
        for (let c = n.__vue__, i = 0; c && i < 60 && out.stack.length < 8; c = c.$parent, i++) {
          const o = c.$options || {};
          const nm = s(o.name || o._componentTag);
          if (nm) out.stack.push(nm);
          if (!out.file && typeof o.__file === "string") out.file = s(o.__file, 300);
        }
      }
    }
    if (!out.framework) {
      let n = el; while (n && !n.__svelte_meta) n = n.parentElement;
      if (n) {
        const loc = n.__svelte_meta.loc || {};
        out.framework = "Svelte"; out.file = s(loc.file, 300); out.line = typeof loc.line === "number" ? loc.line + 1 : null;
        if (out.file) out.stack.push(out.file.split(/[\\\\/]/).pop().replace(/\\.svelte$/, ""));
      }
    }
  } catch (e) { /* a page that throws on its own objects: no component */ }
  if (!out.framework || (!out.stack.length && !out.file)) return null;   // (no component found: nothing to say)
  out.name = out.stack[0] || null;
  return out;
}`;

const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
// The smallest box around rectangles (viewport coordinates), with a margin, inside the page.
function unionRect(rects, vw, vh, margin = 8) {
  const list = rects.filter((r) => r && r.w > 0 && r.h > 0);
  if (!list.length) return null;
  const x1 = Math.max(0, Math.min(...list.map((r) => r.x)) - margin), y1 = Math.max(0, Math.min(...list.map((r) => r.y)) - margin);
  const x2 = Math.min(vw || Infinity, Math.max(...list.map((r) => r.x + r.w)) + margin), y2 = Math.min(vh || Infinity, Math.max(...list.map((r) => r.y + r.h)) + margin);
  return x2 - x1 >= 2 && y2 - y1 >= 2 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
}

class DesignSession {
  // session: a PageSession (cdp.js). hooks: onNotes(notes, { send, dictate }), onExit(), onBatch(on), log.
  constructor(session, { onNotes = async () => {}, onExit = () => {}, onBatch = () => {}, log = () => {} } = {}) {
    this.s = session;
    this.hooks = { onNotes, onExit, onBatch, log };
    this.ctx = null;            // the "kural-design" world in the main frame
    this.frameId = null;
    this.scriptId = null;
    this.offs = [];
    this.pending = [];          // Batch: notes saved as pins, sent together
    this.opts = { batch: false };
    this.busy = false;
    this.closed = false;
  }

  async start({ batch = false } = {}) {
    this.opts.batch = !!batch;
    const on = (e, f) => this.offs.push(this.s.on(e, f));
    on("Runtime.bindingCalled", (p) => { if (p.name === BINDING) this.message(p.payload); });
    on("Runtime.executionContextCreated", (p) => {
      const c = p.context || {};
      if (c.name === WORLD && c.auxData && c.auxData.frameId === this.frameId) this.ctx = c.id;
    });
    on("Runtime.executionContextsCleared", () => { this.ctx = null; });
    on("Page.frameNavigated", (p) => { if (p.frame && !p.frame.parentId) { this.frameId = p.frame.id; this.ctx = null; } });
    await this.s.send("Page.enable");
    await this.s.send("Runtime.enable");
    const { frameTree } = await this.s.send("Page.getFrameTree");
    this.frameId = frameTree.frame.id;
    await this.s.send("Runtime.addBinding", { name: BINDING, executionContextName: WORLD });
    // Every page the tab loads next starts in Design Mode too (a reload, your dev server's hot reload, a link).
    ({ identifier: this.scriptId } = await this.s.send("Page.addScriptToEvaluateOnNewDocument", { source: this.boot(), worldName: WORLD }));
    const { executionContextId } = await this.s.send("Page.createIsolatedWorld", { frameId: this.frameId, worldName: WORLD });
    this.ctx = executionContextId;
    await this.evaluate(this.boot());
  }
  boot() { return `${source()}\n;globalThis.__kuralDesign && globalThis.__kuralDesign.start(${JSON.stringify({ batch: this.opts.batch, pending: this.pending.length })});`; }

  async stop() {
    if (this.closed) return;
    this.closed = true;
    try { await this.call("stop"); } catch { /* the page is gone */ }
    try { if (this.scriptId) await this.s.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: this.scriptId }); } catch { /* gone */ }
    try { await this.s.send("Runtime.removeBinding", { name: BINDING }); } catch { /* gone */ }
    for (const off of this.offs.splice(0)) off();
  }

  // The world in the main frame (after a navigation the new page's world comes with the script; else one is made).
  async context() {
    if (this.ctx) return this.ctx;
    for (let i = 0; i < 20 && !this.ctx; i++) await new Promise((r) => setTimeout(r, 50));
    if (this.ctx) return this.ctx;
    const { executionContextId } = await this.s.send("Page.createIsolatedWorld", { frameId: this.frameId, worldName: WORLD });
    this.ctx = executionContextId;
    await this.s.send("Runtime.evaluate", { expression: this.boot(), contextId: this.ctx });
    return this.ctx;
  }
  async evaluate(expression, byValue = true) {
    for (let i = 0; ; i++) {
      try {
        const r = await this.s.send("Runtime.evaluate", { expression, contextId: await this.context(), returnByValue: byValue, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(clip(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text, 300));
        return byValue ? r.result.value : r.result;
      } catch (e) {
        if (i < 1 && /context|Cannot find|destroyed/i.test(e.message)) { this.ctx = null; continue; }
        throw e;
      }
    }
  }
  // __kuralDesign.<name>(...args) in the page.
  call(name, ...args) { return this.evaluate(`globalThis.__kuralDesign && globalThis.__kuralDesign.${name}(${args.map((a) => JSON.stringify(a)).join(",")})`); }

  // The chat's AI is clicking in this tab: Design Mode steps aside until its answer ends.
  async setBusy(on) { this.busy = !!on; try { await this.call("busy", this.busy); } catch (e) { this.hooks.log(`design: busy: ${e.message}`); } }
  async setBatch(on) { this.opts.batch = !!on; try { await this.call("batch", this.opts.batch); } catch { /* the next page starts with it */ } }

  async message(payload) {
    let m;
    try { m = JSON.parse(String(payload || "")); } catch { return; }
    if (!m || typeof m !== "object") return;
    try {
      if (m.type === "note") return await this.note(m);
      if (m.type === "sendAll") return await this.sendAll(m);
      if (m.type === "unpend") { const i = Number(m.index); if (i >= 0 && i < this.pending.length) this.pending.splice(i, 1); return; }
      if (m.type === "batch") { this.opts.batch = !!m.on; return this.hooks.onBatch(this.opts.batch); }
      if (m.type === "exit") return this.hooks.onExit();
    } catch (e) {
      this.hooks.log(`design: ${m.type}: ${e.message}`);
      if (m.type === "note") { try { await this.call("noteDone", { ok: false, message: `Kural couldn't take that note: ${clip(e.message, 160)}` }); } catch { /* gone */ } }
    }
  }

  // A note from the page: described, pictured, then sent / put in the chat box / kept as a pin.
  async note(m) {
    const mode = ["send", "save", "chat", "dictate"].includes(m.mode) ? m.mode : "send";
    const n = await this.build(m);
    if (mode === "save") {
      this.pending.push(n);
      await this.call("noteDone", { ok: true, mode, pending: this.pending.length });
      return;
    }
    await this.call("noteDone", { ok: true, mode });
    await this.hooks.onNotes([n], { send: mode === "send", dictate: mode === "dictate" });
  }
  async sendAll(m) {
    const notes = this.pending.splice(0);
    if (Array.isArray(m.textEdits) && m.textEdits.length) notes.push(await this.build({ ids: m.textEdits.map((t) => t.id), textEdits: m.textEdits, vw: m.vw, vh: m.vh }));
    await this.call("pending", 0);
    if (notes.length) await this.hooks.onNotes(notes, { send: true });
    this.hooks.onExit();   // (sending them all ends Design Mode, like Cursor's)
  }

  async build(m) {
    const ids = (Array.isArray(m.ids) ? m.ids : []).map(Number).filter((x) => x > 0).slice(0, 20);
    const elements = ids.length ? await this.describe(ids) : [];
    const short = new Map(elements.map((e) => [e.id, e.short]));
    const page = await this.evaluate("({ url: location.href, title: document.title })").catch(() => ({})) || {};
    const textEdits = (Array.isArray(m.textEdits) ? m.textEdits : []).slice(0, 40)
      .map((t) => ({ element: short.get(Number(t.id)) || "text", from: clip(t.from, 2000), to: clip(t.to, 2000) }));
    const css = (Array.isArray(m.css) ? m.css : []).slice(0, 40).map((c) => ({ prop: clip(c.prop, 60), from: clip(c.from, 200), to: clip(c.to, 200) }));
    const area = m.area && typeof m.area === "object" ? { x: +m.area.x || 0, y: +m.area.y || 0, w: +m.area.w || 0, h: +m.area.h || 0 } : null;
    const picture = await this.picture([...elements.map((e) => e.rect), area, m.markupBox], m).catch((e) => { this.hooks.log(`design: picture: ${e.message}`); return null; });
    return { text: clip(m.text, 4000), elements, area, css, textEdits, markup: Number(m.markup) || 0, picture, url: clip(page.url, 2000), title: clip(page.title, 200), quick: !!m.quick };
  }

  async describe(ids) {
    const list = await this.call("describe", ids);
    const out = [];
    for (const e of Array.isArray(list) ? list : []) {
      let component = null;
      try { component = await this.component(e.id); } catch (err) { this.hooks.log(`design: component: ${err.message}`); }
      out.push({ ...e, component });
    }
    return out;
  }
  // The element in the page's own world (where React, Vue and Svelte keep their objects), and PROBE on it.
  async component(id) {
    const ctx = await this.context();
    const r = await this.s.send("Runtime.evaluate", { expression: `globalThis.__kuralDesign.node(${Number(id)})`, contextId: ctx, objectGroup: "kural-design" });
    const own = r.result && r.result.objectId;
    if (!own) return null;
    try {
      const { node } = await this.s.send("DOM.describeNode", { objectId: own });
      const { object } = await this.s.send("DOM.resolveNode", { backendNodeId: node.backendNodeId, objectGroup: "kural-design" });
      const v = await this.s.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: PROBE, returnByValue: true });
      const c = v && v.result && v.result.value;
      if (!c || typeof c !== "object") return null;
      return { framework: clip(c.framework, 20), name: c.name ? clip(c.name, 120) : null, stack: (Array.isArray(c.stack) ? c.stack : []).slice(0, 8).map((x) => clip(x, 120)),
        file: c.file ? clip(c.file, 300) : null, line: Number(c.line) || null };
    } finally {
      this.s.send("Runtime.releaseObjectGroup", { objectGroup: "kural-design" }).catch(() => {});
    }
  }
  // A picture of the box around the note's elements, area and markup, without Design Mode's own toolbar and outlines.
  async picture(rects, m) {
    const box = unionRect(rects, Number(m.vw) || 0, Number(m.vh) || 0);
    if (!box) return null;
    await this.call("capture", true);
    try {
      const { cssVisualViewport: vv } = await this.s.send("Page.getLayoutMetrics");
      const dpr = Math.max(1, Number(m.dpr) || 1);
      const big = box.w * box.h * dpr * dpr > MAX_PIXELS;
      const clipBox = { x: box.x + (vv.pageX || 0), y: box.y + (vv.pageY || 0), width: box.w, height: box.h, scale: big ? 1 / dpr : 1 };
      const { data } = await this.s.send("Page.captureScreenshot", { format: big ? "jpeg" : "png", ...(big ? { quality: 85 } : {}), clip: clipBox }, 15000);
      return { data, mime: big ? "image/jpeg" : "image/png", width: Math.round(box.w), height: Math.round(box.h) };
    } finally {
      await this.call("capture", false).catch(() => {});
    }
  }
}

module.exports = { DesignSession, unionRect, PROBE, WORLD, BINDING };
