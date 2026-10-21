// A small DOM for the page tests (media/markdown.js, timeline.js, choices.js): tags, classes, attributes, children,
// textContent, closest and simple descendant selectors (from test/listen-page.test.js), plus what those pages use:
// `html` (a tiny HTML reader, so a test sees which tags really got made), values, events, scrolling.

const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
const decode = (s) => String(s).replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENT[m]);

class Node {
  constructor(tag, text) {
    this.tagName = String(tag).toUpperCase(); this.text = text; this.attrs = {}; this.kids = []; this.parent = null;
    this.cls = new Set(); this.on = {}; this.scrolled = 0; this.replaced = 0;
    this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 0; this.style = { cssText: "" };
  }
  get nodeType() { return this.tagName === "#TEXT" ? 3 : 1; }
  get childNodes() { return this.kids; }
  get children() { return this.kids.filter((k) => k.tagName !== "#TEXT"); }
  get firstChild() { return this.kids[0] || null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
  get classList() { return { add: (...c) => c.forEach((x) => this.cls.add(x)), remove: (...c) => c.forEach((x) => this.cls.delete(x)), contains: (c) => this.cls.has(c), toggle: (c, on) => { const v = on === undefined ? !this.cls.has(c) : !!on; if (v) this.cls.add(c); else this.cls.delete(c); return v; } }; }
  get className() { return [...this.cls].join(" "); }
  set className(s) { this.cls = new Set(String(s).split(/\s+/).filter(Boolean)); }
  get dataset() {
    const n = this;
    return new Proxy({}, { get: (_, k) => n.attrs[`data-${String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`],
      set: (_, k, v) => { n.attrs[`data-${String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = String(v); return true; } });
  }
  get value() { return this._value !== undefined ? this._value : (this.attrs.value || ""); }
  set value(v) { this._value = String(v); }
  get disabled() { return this._disabled !== undefined ? this._disabled : "disabled" in this.attrs; }
  set disabled(v) { this._disabled = !!v; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { this.on[t] = f; }
  dispatch(type, extra = {}) { const f = this.on[type]; if (f) return f({ target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...extra }); }
  click() { return this.dispatch("click"); }
  focus() {}
  append(...ks) { for (const k of ks.flat(Infinity)) { if (k == null || k === false) continue; const n = typeof k === "object" ? k : new Node("#text", String(k)); if (n.parent) n.remove(); n.parent = this; this.kids.push(n); } }
  prepend(...ks) { const old = this.kids; this.kids = []; this.append(...ks); for (const k of old) { this.kids.push(k); } }
  after(...ks) { const p = this.parent, i = p.kids.indexOf(this); const ns = ks.map((k) => typeof k === "object" ? k : new Node("#text", String(k))); ns.forEach((n) => { if (n.parent) n.remove(); n.parent = p; }); p.kids.splice(p.kids.indexOf(this) + 1, 0, ...ns); void i; }
  replaceChildren(...ks) { this.replaced++; for (const k of this.kids) k.parent = null; this.kids = []; this.append(...ks); }
  replaceWith(n) { const i = this.parent.kids.indexOf(this); n.parent = this.parent; this.parent.kids[i] = n; this.parent = null; }
  remove() { if (this.parent) this.parent.kids.splice(this.parent.kids.indexOf(this), 1); this.parent = null; }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  get textContent() { return this.text !== undefined ? this.text : this.kids.map((k) => k.textContent).join(""); }
  set textContent(v) { this.replaceChildren(String(v)); }
  set innerHTML(html) { this.replaceChildren(...readHtml(html)); }
  scrollIntoView() { this.scrolled++; }
  matches(compound) {
    const m = /^([a-z0-9]*)((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)$/i.exec(compound);
    if (!m) throw new Error(`selector ${compound}`);
    if (this.tagName === "#TEXT") return false;
    if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
    for (const c of (m[2].match(/\.[\w-]+/g) || [])) if (!this.cls.has(c.slice(1))) return false;
    for (const a of (m[3].match(/\[[\w-]+(?:="[^"]*")?\]/g) || [])) { const [, k, v] = /\[([\w-]+)(?:="([^"]*)")?\]/.exec(a); if (v === undefined ? !(k in this.attrs) : this.attrs[k] !== v) return false; }
    return true;
  }
  closest(sel) { for (let n = this; n; n = n.parent) if (n.tagName !== "#TEXT" && n.matches(sel)) return n; return null; }
  querySelectorAll(sel) {
    const parts = sel.trim().split(/\s+/), out = [];
    const walk = (n) => { for (const k of n.children) { let ok = k.matches(parts[parts.length - 1]); for (let i = parts.length - 2, a = k.parent; ok && i >= 0; i--) { while (a && a !== this && !a.matches(parts[i])) a = a.parent; if (!a || a === this) ok = false; else a = a.parent; } if (ok) out.push(k); walk(k); } };
    walk(this); return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

// Real tags in an HTML string become nodes (with their name="value" attributes); everything else is text.
function readHtml(html) {
  const root = new Node("#root"), stack = [root];
  const re = /<(\/?)([a-z][a-z0-9]*)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*(\/?)>/gi;
  let last = 0, m;
  const text = (s) => { if (s) stack[stack.length - 1].append(new Node("#text", decode(s))); };
  while ((m = re.exec(String(html)))) {
    text(String(html).slice(last, m.index)); last = re.lastIndex;
    if (m[1]) { for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === m[2].toUpperCase()) { stack.length = i; break; } continue; }
    const n = new Node(m[2]);
    for (const a of m[3].matchAll(/([a-z-]+)(?:="([^"]*)")?/gi)) { if (a[1] === "class") n.className = decode(a[2] || ""); else n.setAttribute(a[1], decode(a[2] || "")); }
    stack[stack.length - 1].append(n);
    if (!m[4] && !/^(img|br|hr|input)$/i.test(m[2])) stack.push(n);
  }
  text(String(html).slice(last));
  const kids = root.kids.slice(); for (const k of kids) k.parent = null;
  return kids;
}

const el = (tag, props = {}, ...kids) => {
  const n = new Node(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "html") n.append(...readHtml(v));
    else if (k === "style") n.style.cssText = v;
    else if (k.startsWith("on")) n.on[k.slice(2)] = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  n.append(...kids);
  return n;
};
const text = (n) => n.textContent;
// Every node under n (n included) with that tag.
const all = (n, tag) => { const out = []; const walk = (x) => { if (x.tagName === tag.toUpperCase()) out.push(x); x.kids.forEach(walk); }; walk(n); return out; };

module.exports = { Node, el, text, all, readHtml };
