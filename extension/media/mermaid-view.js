// Mermaid diagrams in chat answers (```mermaid blocks; media/chat.js mermaidCard). Mermaid (media/mermaid/, 5.5 MB) is
// loaded the first time a diagram shows, never at the page's start. Each diagram becomes a picture (an SVG data: address
// in an <img>), so nothing the AI wrote in it can run or link anywhere; Mermaid's "strict" level cleans it as well.
// One per page: every chat column shares the loaded Mermaid and the drawn diagrams.
(() => {
  // Mermaid measures each label in the page, where the CSP drops its own <style>; chat.css `.mm-measure` sets the same
  // font, and labels are plain SVG text (htmlLabels: false: HTML labels aren't valid XML, so the picture didn't load).
  const FONT = '"trebuchet ms", verdana, arial, sans-serif';
  const KEEP = 100;   // drawn diagrams kept (a redraw of the answer shows them again at once)
  const drawn = new Map();   // theme + code -> { src, w, h } or { error }
  let loading = null, queue = Promise.resolve(), count = 0;

  function load() {
    if (!loading) loading = new Promise((ok, fail) => {
      const src = document.documentElement.dataset.mermaid;
      if (!src) return fail(new Error("Mermaid isn't available here"));
      const s = document.createElement("script");
      s.nonce = (document.querySelector("script[nonce]") || {}).nonce || "";
      s.src = src;
      s.onload = () => (window.mermaid ? ok(window.mermaid) : fail(new Error("Mermaid didn't start")));
      s.onerror = () => { loading = null; fail(new Error("Couldn't load Mermaid")); };
      document.head.append(s);
    });
    return loading;
  }

  const theme = () => (/vscode-light|vscode-high-contrast-light/.test(document.body.className) ? "default" : "dark");

  // { src, w, h } for the picture, or { error } (Mermaid's message, e.g. "Parse error on line 3: …").
  function draw(code) {
    const t = theme(), key = `${t}\n${code}`;
    if (drawn.has(key)) return Promise.resolve(drawn.get(key));
    // (One at a time: Mermaid keeps its settings and ids page-wide.)
    const job = queue.then(() => load()).then((mm) => render(mm, code, t), (e) => ({ error: e.message })).then((r) => {
      drawn.set(key, r);
      if (drawn.size > KEEP) drawn.delete(drawn.keys().next().value);
      return r;
    });
    queue = job.catch(() => {});
    return job;
  }

  async function render(mm, code, t) {
    mm.initialize({ startOnLoad: false, securityLevel: "strict", theme: t, fontFamily: FONT, htmlLabels: false, suppressErrorRendering: true });
    const id = `kural-mm-${++count}`;
    const box = document.createElement("div");
    box.className = "mm-measure";
    document.body.append(box);
    try {
      const { svg } = await mm.render(id, code, box);
      return picture(svg);
    } catch (e) {
      const msg = String((e && e.message) || e).trim();
      return { error: msg.length > 400 ? `${msg.slice(0, 400)}…` : msg };
    } finally {
      box.remove();
      for (const left of [id, `d${id}`]) { const n = document.getElementById(left); if (n) n.remove(); }
    }
  }

  // Mermaid's SVG as a picture: written out as XML, with a real size (it says width="100%").
  function picture(svg) {
    const t = document.createElement("template");
    t.innerHTML = svg;
    const node = t.content.querySelector("svg");
    if (!node) return { error: "Mermaid drew nothing" };
    const [, , w, h] = (node.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    if (!(w > 0 && h > 0)) return { error: "Mermaid drew nothing" };
    node.setAttribute("width", String(Math.ceil(w)));
    node.setAttribute("height", String(Math.ceil(h)));
    node.removeAttribute("style");
    // (`click A "https://…"` stays a link in Mermaid's SVG; a picture can't follow it, and it isn't kept either. "#…"
    // points inside the picture: kept.)
    const XLINK = "http://www.w3.org/1999/xlink";
    for (const a of node.querySelectorAll("*")) {
      if (!/^#/.test(a.getAttribute("href") || "#")) a.removeAttribute("href");
      if (!/^#/.test(a.getAttributeNS(XLINK, "href") || "#")) a.removeAttributeNS(XLINK, "href");
    }
    return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(node))}`, w: Math.ceil(w), h: Math.ceil(h) };
  }

  window.KURAL_MERMAID = { draw };
})();
