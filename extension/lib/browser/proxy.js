// The Kural Browser's little proxy: your page (http://localhost:5173, any address) is loaded through
// http://127.0.0.1:<port>/…, so Kural can add its element picker (media/browser-picker.js) to every page. A page from
// another address can't be reached into from Kural's tab (browsers keep sites apart), so the picker has to come with
// the page. What it changes: HTML gets one <script> at the top; headers that forbid showing the page in a frame or
// running an added script (X-Frame-Options, Content-Security-Policy) are dropped; redirects and cookies are pointed at
// the proxy. Everything else (scripts, pictures, the dev server's live-reload websocket) passes through unchanged.
// Only this computer can reach it (127.0.0.1). No vscode inside (test/browser-proxy.test.js).

const http = require("http"), https = require("https"), net = require("net"), tls = require("tls"), zlib = require("zlib");

const PICKER_PATH = "/__kural/picker.js";
const TAG = `<script src="${PICKER_PATH}"></script>`;

// The page with the picker's <script> first in <head> (or at the very start).
function inject(html) {
  const m = /<head[^>]*>/i.exec(html);
  if (m) return html.slice(0, m.index + m[0].length) + TAG + html.slice(m.index + m[0].length);
  const d = /<!doctype[^>]*>/i.exec(html);
  return d ? html.slice(0, d.index + d[0].length) + TAG + html.slice(d.index + d[0].length) : TAG + html;
}

function decode(buf, enc) {
  enc = String(enc || "").toLowerCase();
  if (enc === "gzip" || enc === "x-gzip") return zlib.gunzipSync(buf);
  if (enc === "br") return zlib.brotliDecompressSync(buf);
  if (enc === "deflate") { try { return zlib.inflateSync(buf); } catch { return zlib.inflateRawSync(buf); } }
  return buf;
}

// picker(): the picker script's text (read fresh, so a changed file needs no restart).
function startProxy({ picker, log = () => {} }) {
  let target = null;   // a URL: where the page really is
  let origin = "";     // http://127.0.0.1:<port>
  const fix = (s) => (target && s ? String(s).split(target.origin).join(origin) : s);
  const back = (s) => (target && s ? String(s).split(origin).join(target.origin) : s);

  const server = http.createServer((req, res) => {
    if (req.url.startsWith(PICKER_PATH)) {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(picker());
      return;
    }
    if (!target) { res.writeHead(502, { "content-type": "text/plain" }); res.end("Kural Browser: no page to show yet."); return; }
    const lib = target.protocol === "https:" ? https : http;
    const headers = { ...req.headers, host: target.host };
    if (headers.origin) headers.origin = back(headers.origin);
    if (headers.referer) headers.referer = back(headers.referer);
    const up = lib.request({ protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, method: req.method, path: req.url, headers,
      rejectUnauthorized: false }, (r) => {
      const h = { ...r.headers };
      for (const k of ["content-security-policy", "content-security-policy-report-only", "x-frame-options", "cross-origin-opener-policy", "cross-origin-embedder-policy"]) delete h[k];
      if (h.location) h.location = fix(h.location);
      // Cookies set for localhost (or https only) wouldn't come back to 127.0.0.1 over http.
      if (h["set-cookie"]) h["set-cookie"] = [].concat(h["set-cookie"]).map((c) => c.replace(/;\s*Domain=[^;]*/ig, "").replace(/;\s*Secure/ig, "").replace(/;\s*SameSite=None/ig, ""));
      if (!/text\/html/i.test(h["content-type"] || "") || req.method === "HEAD") { res.writeHead(r.statusCode, h); r.pipe(res); return; }
      const parts = [];
      r.on("data", (d) => parts.push(d));
      r.on("end", () => {
        let body;
        try { body = inject(decode(Buffer.concat(parts), h["content-encoding"]).toString("utf8")); }
        catch (e) { log(`browser: couldn't read the page (${e.message})`); body = Buffer.concat(parts).toString("utf8"); }
        delete h["content-encoding"]; delete h["content-length"]; delete h["transfer-encoding"];
        h["cache-control"] = "no-store";
        res.writeHead(r.statusCode, h);
        res.end(body);
      });
    });
    up.on("error", (e) => {
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(502, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:2em;color:#888">
<h3>Nothing answers at ${escapeHtml(target.origin)}</h3><p>Is your app running? (${escapeHtml(e.code || e.message)})</p></body>`);
    });
    req.pipe(up);
  });

  // The dev server's live reload (Vite, webpack, Next…) is a websocket: passed straight through. (Kept in `open`
  // so closing the proxy ends them: a server waits for open websockets forever.)
  const open = new Set();
  server.on("upgrade", (req, socket, head) => {
    if (!target) { socket.destroy(); return; }
    const port = Number(target.port) || (target.protocol === "https:" ? 443 : 80);
    const s = target.protocol === "https:" ? tls.connect({ host: target.hostname, port, servername: target.hostname, rejectUnauthorized: false }) : net.connect(port, target.hostname);
    const start = () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i], v = req.rawHeaders[i + 1];
        lines.push(`${k}: ${/^host$/i.test(k) ? target.host : /^origin$/i.test(k) ? back(v) : v}`);
      }
      s.write(lines.join("\r\n") + "\r\n\r\n");
      if (head && head.length) s.write(head);
      s.pipe(socket); socket.pipe(s);
    };
    s.once(target.protocol === "https:" ? "secureConnect" : "connect", start);
    open.add(s); open.add(socket);
    const end = () => { open.delete(s); open.delete(socket); };
    s.on("close", end); socket.on("close", end);
    s.on("error", () => socket.destroy());
    socket.on("error", () => s.destroy());
  });

  const ready = new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => { origin = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });

  return {
    ready,
    get origin() { return origin; },
    // Show this address: returns where the frame goes (the proxy, same path).
    open(url) {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) throw new Error("only http and https addresses");
      target = new URL(u.origin);
      return origin + u.pathname + u.search + u.hash;
    },
    // The proxy's address of a page → the page's real address (for the address bar).
    real: (u) => back(u),
    get target() { return target ? target.origin : null; },
    close: () => new Promise((r) => { server.close(() => r()); if (server.closeAllConnections) server.closeAllConnections(); for (const x of open) x.destroy(); }),
  };
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

module.exports = { startProxy, inject, PICKER_PATH };
