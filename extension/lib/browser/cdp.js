// The Chrome DevTools Protocol (CDP), the way Chrome's own DevTools talk to a page, over any connection to a browser: the
// one VS Code gives Kural for one of its browser tabs (a vscode.window browser tab's startCDPSession(): a small "browser"
// whose only page is that tab; VS Code's main process stands in for Chrome's browser commands), or a real Chrome's
// --remote-debugging-pipe in test/browser-page.live.js. No vscode here.
//
//   transport: { send(obj), onMessage(fn(obj)), onClose(fn), close() }

const TIMEOUT = 20000;

class Cdp {
  constructor(transport) {
    this.t = transport;
    this.ids = 0;
    this.pending = new Map();     // id → { resolve, reject, method, timer }
    this.listeners = new Map();   // event → Set(fn(params, sessionId))
    this.closed = false;
    this.closers = [];
    transport.onMessage((m) => this.receive(m));
    transport.onClose(() => this.gone());
  }

  // One command; its answer (or an Error with the browser's message). sessionId: a page attached with attach().
  send(method, params = {}, sessionId, timeout = TIMEOUT) {
    if (this.closed) return Promise.reject(new Error("The browser tab isn't connected any more."));
    const id = ++this.ids;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`The page didn't answer in time (${method}).`)); }, timeout);
      this.pending.set(id, { resolve, reject, method, timer });
      try { this.t.send({ id, method, params, ...(sessionId ? { sessionId } : {}) }); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }

  receive(m) {
    if (!m || typeof m !== "object") return;
    if (typeof m.id === "number") {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(Object.assign(new Error(m.error.message || `${p.method} failed`), { cdp: m.error, method: p.method }));
      else p.resolve(m.result || {});
      return;
    }
    if (typeof m.method === "string") for (const f of [...(this.listeners.get(m.method) || [])]) { try { f(m.params || {}, m.sessionId); } catch { /* a listener's own problem */ } }
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
    return () => { const s = this.listeners.get(method); if (s) s.delete(fn); };
  }
  onClose(fn) { this.closers.push(fn); }

  gone() {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error("The browser tab isn't connected any more.")); }
    this.pending.clear();
    for (const f of this.closers) { try { f(); } catch { /* ignore */ } }
  }
  close() { try { this.t.close(); } catch { /* closed */ } this.gone(); }

  // The page to work on (targetId: which one; default the first page), attached with its own session id.
  async attach(targetId) {
    if (!targetId) {
      const { targetInfos = [] } = await this.send("Target.getTargets");
      const page = targetInfos.find((t) => t.type === "page");
      if (!page) throw new Error("This browser tab has no page.");
      targetId = page.targetId;
      this.target = page;
    }
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    return new PageSession(this, sessionId, targetId);
  }
}

// One attached page: commands and events for it only.
class PageSession {
  constructor(cdp, id, targetId) { this.cdp = cdp; this.id = id; this.targetId = targetId; }
  send(method, params = {}, timeout) { return this.cdp.send(method, params, this.id, timeout); }
  on(method, fn) { return this.cdp.on(method, (p, sid) => { if (sid === this.id) fn(p); }); }
  get closed() { return this.cdp.closed; }
}

module.exports = { Cdp, PageSession, TIMEOUT };
