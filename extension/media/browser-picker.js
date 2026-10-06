// Kural Browser's element picker. Added to every page shown in the Kural Browser (lib/browser/proxy.js). It does
// nothing until the Kural Browser's "Select element" is on; then the element under the mouse is outlined, and a click
// sends that element to the Kural Browser (which adds it to the chat): its tag, a CSS selector, text, HTML (shortened),
// main styles, size, and the React/Vue component with its source file when the dev build says so. Esc stops.
(function () {
  if (window.__kuralPicker || window.parent === window) return;
  window.__kuralPicker = true;
  const send = (m) => window.parent.postMessage(Object.assign({ kural: true }, m), "*");
  let on = false, box = null, tag = null, cur = null;

  function overlay() {
    if (box) return;
    box = document.createElement("div");
    box.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #8b6cef;background:rgba(139,108,239,.14);border-radius:3px;transition:all .04s;display:none";
    tag = document.createElement("div");
    tag.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;background:#8b6cef;color:#fff;font:600 11px/1.6 ui-monospace,Menlo,monospace;padding:0 6px;border-radius:3px;white-space:nowrap;display:none";
    document.documentElement.append(box, tag);
  }
  function hide() { if (box) { box.style.display = "none"; tag.style.display = "none"; } }

  function short(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    const cls = [...el.classList].slice(0, 2);
    if (cls.length) s += "." + cls.join(".");
    return s;
  }
  // A selector that finds this element: up to the nearest id, at most 6 steps.
  function selector(el) {
    const parts = [];
    for (let n = el, k = 0; n && n.nodeType === 1 && n !== document.documentElement && k < 6; n = n.parentElement, k++) {
      if (n.id) { parts.unshift("#" + CSS.escape(n.id)); break; }
      let p = n.tagName.toLowerCase();
      const cls = [...n.classList].filter((c) => !/^(hover|active|focus)/.test(c)).slice(0, 2);
      if (cls.length) p += "." + cls.map((c) => CSS.escape(c)).join(".");
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (same.length > 1) p += `:nth-of-type(${same.indexOf(n) + 1})`;
      parts.unshift(p);
    }
    return parts.join(" > ");
  }
  // React (dev builds): the component that drew it, and where it's written. Vue: the same from its own fields.
  function component(el) {
    try {
      const k = Object.keys(el).find((x) => x.startsWith("__reactFiber$") || x.startsWith("__reactInternalInstance$"));
      for (let f = k ? el[k] : null; f; f = f.return) {
        const t = f.type;
        const name = t && (t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)));
        if (name && typeof t !== "string") {
          const src = f._debugSource || (f._debugOwner && f._debugOwner._debugSource);
          return { name, framework: "React", file: src ? src.fileName : "", line: src ? src.lineNumber : 0 };
        }
      }
      for (let n = el; n; n = n.parentElement) {
        const v = n.__vueParentComponent || (n.__vue__ && n.__vue__.$);
        if (v && v.type) return { name: v.type.__name || v.type.name || "", framework: "Vue", file: v.type.__file || "", line: 0 };
      }
    } catch { /* not this framework */ }
    return null;
  }
  const STYLES = ["display", "position", "width", "height", "margin", "padding", "color", "background-color", "font-family", "font-size",
    "font-weight", "line-height", "border", "border-radius", "gap", "flex-direction", "justify-content", "align-items", "opacity", "z-index"];
  function describe(el) {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el), styles = {};
    for (const p of STYLES) { const v = cs.getPropertyValue(p); if (v && v !== "none" && v !== "normal" && v !== "auto" && v !== "0px") styles[p] = v; }
    // (Very long attributes, an SVG path or a data: picture, are shortened: they'd fill the chat with noise.)
    let html = el.outerHTML.replace(/\s([\w:-]+)="([^"]{200,})"/g, (m, k, v) => ` ${k}="${v.slice(0, 60)}…"`);
    if (html.length > 3000) html = html.slice(0, 3000) + "…";
    return { url: location.href, title: document.title, selector: selector(el), short: short(el), tag: el.tagName.toLowerCase(), id: el.id || "",
      classes: [...el.classList], text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 300), html, styles,
      size: [Math.round(r.width), Math.round(r.height)], component: component(el) };
  }

  function show(el) {
    overlay();
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    tag.textContent = `${short(el)}  ${Math.round(r.width)}×${Math.round(r.height)}`;
    const y = r.top > 22 ? r.top - 20 : r.bottom + 2;
    Object.assign(tag.style, { display: "block", left: Math.max(2, r.left) + "px", top: y + "px" });
  }
  function stop(tell) { on = false; cur = null; hide(); document.documentElement.style.cursor = ""; if (tell) send({ type: "pickStopped" }); }

  document.addEventListener("mousemove", (e) => { if (!on) return; const t = document.elementFromPoint(e.clientX, e.clientY); if (t && t !== box && t !== tag && t !== cur) { cur = t; show(t); } }, true);
  for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup"]) document.addEventListener(type, (e) => { if (on) { e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener("click", (e) => {
    if (!on) return;
    e.preventDefault(); e.stopPropagation();
    const el = cur || e.target;
    if (el && el.nodeType === 1) send({ type: "picked", info: describe(el) });
    stop(false);
  }, true);
  document.addEventListener("keydown", (e) => { if (on && e.key === "Escape") { e.preventDefault(); stop(true); } }, true);

  window.addEventListener("message", (e) => {
    if (e.source !== window.parent) return;
    const d = e.data || {};
    if (d.kuralPick === true) { on = true; document.documentElement.style.cursor = "crosshair"; }
    else if (d.kuralPick === false) stop(false);
    else if (d.kuralNav === "back") history.back();
    else if (d.kuralNav === "forward") history.forward();
    else if (d.kuralNav === "reload") location.reload();
  });

  // Where the page is now (the address bar follows links and single-page apps' own navigation).
  let last = "";
  const page = () => { const now = location.href + "\n" + document.title; if (now !== last) { last = now; send({ type: "page", url: location.href, title: document.title }); } };
  page();
  setInterval(page, 700);
})();
