// The Kural Browser's proxy (extension/lib/browser/proxy.js): your page comes through with the element picker added,
// the headers that would block it removed, redirects and cookies pointed at the proxy, everything else unchanged
// (also the dev server's live-reload websocket).
const assert = require("assert");
const http = require("http"), net = require("net"), zlib = require("zlib");
const { startProxy, inject } = require("../extension/lib/browser/proxy");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const get = (url, headers = {}) => new Promise((resolve, reject) => {
  http.get(url, { headers }, (r) => { const b = []; r.on("data", (d) => b.push(d)); r.on("end", () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(b).toString("utf8") })); }).on("error", reject);
});

(async () => {
  await check("the picker goes first in <head> (or at the start)", async () => {
    assert.strictEqual(inject("<!doctype html><html><head><title>x</title></head></html>"), '<!doctype html><html><head><script src="/__kural/picker.js"></script><title>x</title></head></html>');
    assert.strictEqual(inject("<p>hi</p>"), '<script src="/__kural/picker.js"></script><p>hi</p>');
  });

  // A stand-in app, like a dev server on localhost.
  let seenHost = "";
  const app = http.createServer((req, res) => {
    seenHost = req.headers.host;
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip", "content-security-policy": "script-src 'self'",
        "x-frame-options": "DENY", "set-cookie": "sid=1; Domain=localhost; Path=/; Secure; SameSite=None" });
      res.end(zlib.gzipSync("<html><head><title>App</title></head><body><button class='go'>Log in</button></body></html>"));
    } else if (req.url === "/old") { res.writeHead(302, { location: `http://127.0.0.1:${app.address().port}/new` }); res.end(); }
    else if (req.url === "/app.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end("console.log(1)"); }
    else { res.writeHead(404); res.end("nope"); }
  });
  app.on("upgrade", (req, socket) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.on("data", (d) => socket.write("echo:" + d));
  });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const appUrl = `http://127.0.0.1:${app.address().port}`;
  const proxy = startProxy({ picker: () => "/*picker*/" });
  await proxy.ready;

  await check("the page: picker added, blocking headers gone, cookie made to work here", async () => {
    const src = proxy.open(appUrl + "/");
    assert.strictEqual(src, proxy.origin + "/");
    const r = await get(src, { "accept-encoding": "gzip" });
    assert.ok(r.body.includes('<head><script src="/__kural/picker.js"></script><title>App</title>'), r.body);
    assert.ok(r.body.includes("Log in"));
    assert.ok(!r.headers["content-security-policy"] && !r.headers["x-frame-options"] && !r.headers["content-encoding"]);
    assert.strictEqual(r.headers["set-cookie"][0], "sid=1; Path=/");
    assert.strictEqual(seenHost, `127.0.0.1:${app.address().port}`, "the app sees its own host");
  });
  await check("the picker itself, and other files unchanged", async () => {
    assert.strictEqual((await get(proxy.origin + "/__kural/picker.js")).body, "/*picker*/");
    assert.strictEqual((await get(proxy.origin + "/app.js")).body, "console.log(1)");
    assert.strictEqual((await get(proxy.origin + "/missing")).status, 404);
  });
  await check("a redirect stays in the proxy; the address bar gets the real address", async () => {
    const r = await get(proxy.origin + "/old");
    assert.strictEqual(r.headers.location, proxy.origin + "/new");
    assert.strictEqual(proxy.real(proxy.origin + "/new?a=1"), appUrl + "/new?a=1");
  });
  await check("live reload: a websocket passes straight through", async () => {
    const reply = await new Promise((resolve, reject) => {
      const s = net.connect(Number(proxy.origin.split(":").pop()), "127.0.0.1", () => {
        s.write("GET /hmr HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
      });
      let got = "";
      s.on("data", (d) => { got += d; if (got.includes("\r\n\r\n") && !got.includes("echo:")) s.write("ping"); if (got.includes("echo:ping")) { s.destroy(); resolve(got); } });
      s.on("error", reject);
      setTimeout(() => reject(new Error("no answer: " + got)), 3000);
    });
    assert.ok(reply.startsWith("HTTP/1.1 101"));
  });
  await check("nothing running there: a page that says so", async () => {
    const dead = net.createServer(); await new Promise((r) => dead.listen(0, "127.0.0.1", r)); const port = dead.address().port; await new Promise((r) => dead.close(r));
    proxy.open(`http://127.0.0.1:${port}/`);
    const r = await get(proxy.origin + "/");
    assert.strictEqual(r.status, 502);
    assert.ok(/Is your app running/.test(r.body));
  });
  await check("only web addresses", async () => { assert.throws(() => proxy.open("file:///etc/passwd")); });

  await proxy.close();   // (ends the open websocket too: this used to wait forever)
  app.close(); app.closeAllConnections();
  process.exit(fail ? 1 : 0);
})();
