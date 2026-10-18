// Learn mood's lesson pages (extension/lib/learn/server.js, media/lesson.*, prompts.js lessonPrompt): the local server
// shows only the chat's own lesson files, with the token and Host it expects; pages get the slide runtime and a strict
// CSP; "Add to chat" takes only small, same-address posts; the reload check; and what the AI is told per mode.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { LessonServer, inject, CSP } = require("../extension/lib/learn/server");
const { lessonPrompt, moodPrompt } = require("../extension/lib/chat/prompts");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-lessons-"));
const root = path.join(tmp, "lessons");
const media = path.join(__dirname, "..", "extension", "media");
fs.mkdirSync(path.join(root, "chat1"), { recursive: true });
fs.mkdirSync(path.join(root, "chat2"), { recursive: true });
fs.writeFileSync(path.join(root, "chat1", "loops.html"), "<!doctype html><html><head><title>Loops</title></head><body><section class=\"slide\"><h1>Loops</h1></section></body></html>");
fs.writeFileSync(path.join(root, "chat1", "pic.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
fs.writeFileSync(path.join(root, "chat1", ".secret"), "no");
fs.writeFileSync(path.join(root, "chat2", "other.html"), "<p>other chat</p>");
fs.writeFileSync(path.join(tmp, "outside.html"), "<p>outside</p>");
try { fs.symlinkSync(path.join(tmp, "outside.html"), path.join(root, "chat1", "link.html")); } catch { /* no symlinks here (Windows) */ }

const added = [];
const server = new LessonServer({ root: (id) => path.join(root, id), media, onAdd: (id, item) => { added.push({ id, item }); return id === "chat1"; } });

// A raw request (any Host, any path, a body), so the checks a browser would never let a page skip can be tried.
function req(urlPath, { method = "GET", host, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port: server.port, path: urlPath, method, headers: { Host: host || `127.0.0.1:${server.port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    r.on("error", reject);
    if (body != null) r.write(body);
    r.end();
  });
}

(async () => {
  const url = await server.url("chat1", path.join(root, "chat1", "loops.html"));
  const base = new URL(url).pathname.replace(/[^/]*$/, "");   // /<token>/chat1/
  const token = base.split("/")[1];

  await check("the address: 127.0.0.1, a 64-character token, the chat and the file", () => {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{64}\/chat1\/loops\.html$/);
  });

  await check("a lesson page: the runtime right after <head>, the strict CSP, no caching", async () => {
    const r = await req(`${base}loops.html`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes(`<head><meta name="viewport"`), r.body);
    assert.ok(r.body.includes(`/${token}/__kural/lesson.css`) && r.body.includes(`/${token}/__kural/lesson.js`));
    assert.ok(r.body.indexOf("lesson.css") < r.body.indexOf("<title>"), "Kural's styles come before the page's own");
    assert.strictEqual(r.headers["content-security-policy"], CSP);
    assert.match(CSP, /default-src 'none'/); assert.match(CSP, /connect-src 'self'/); assert.doesNotMatch(CSP, /https?:/);
    assert.strictEqual(r.headers["cache-control"], "no-store");
  });

  await check("inject: a page without <head> gets the runtime first", () => {
    const out = inject("<p>hi</p>", "/t/");
    assert.ok(out.startsWith("<meta") && out.endsWith("<p>hi</p>"));
  });

  await check("the runtime files are served; other names aren't", async () => {
    const js = await req(`/${token}/__kural/lesson.js`);
    assert.strictEqual(js.status, 200); assert.match(js.headers["content-type"], /javascript/);
    assert.strictEqual((await req(`/${token}/__kural/server.js`)).status, 404);
    assert.strictEqual((await req(`/${token}/__kural/..%2Fserver.js`)).status, 404);
  });

  await check("other files in the lesson folder: by type, with the CSP", async () => {
    const r = await req(`${base}pic.svg`);
    assert.strictEqual(r.status, 200); assert.strictEqual(r.headers["content-type"], "image/svg+xml"); assert.ok(r.headers["content-security-policy"]);
  });

  await check("no token, a wrong token, or another Host: refused", async () => {
    assert.strictEqual((await req(`/chat1/loops.html`)).status, 404);
    assert.strictEqual((await req(`/${"0".repeat(64)}/chat1/loops.html`)).status, 404);
    assert.strictEqual((await req(`${base}loops.html`, { host: `evil.example:${server.port}` })).status, 403);
    assert.strictEqual((await req(`${base}loops.html`, { host: `localhost:${server.port}` })).status, 403);
  });

  await check("only files inside the chat's own folder: no hidden files, no ../, no links out, no other chat by path", async () => {
    assert.strictEqual((await req(`${base}.secret`)).status, 404);
    assert.strictEqual((await req(`${base}..%2F..%2Foutside.html`)).status, 404);
    assert.strictEqual((await req(`${base}..%2Fchat2%2Fother.html`)).status, 404);
    assert.strictEqual((await req(`/${token}/..%2Fchat1/loops.html`)).status, 404);
    assert.strictEqual((await req(`${base}missing.html`)).status, 404);
    if (fs.existsSync(path.join(root, "chat1", "link.html"))) assert.strictEqual((await req(`${base}link.html`)).status, 404);
    // (Another chat's own address works: each chat's page posts to its own chat.)
    assert.strictEqual((await req(`/${token}/chat2/other.html`)).status, 200);
  });

  await check("the reload check: the file's time, 0 when it's gone or outside", async () => {
    const t = JSON.parse((await req(`${base}__v?f=loops.html`)).body).t;
    assert.ok(t > 0);
    assert.strictEqual(JSON.parse((await req(`${base}__v?f=..%2F..%2Foutside.html`)).body).t, 0);
    assert.strictEqual(JSON.parse((await req(`${base}__v?f=gone.html`)).body).t, 0);
  });

  await check("Add to chat: a same-address JSON post reaches the chat, cleaned up", async () => {
    added.length = 0;
    const body = JSON.stringify({ text: "  a loop repeats  ", slide: 2, title: "Repeat", concept: "loop arrow", extra: "dropped" });
    const r = await req(`${base}add`, { method: "POST", headers: { Origin: `http://127.0.0.1:${server.port}`, "Content-Type": "application/json" }, body });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(added, [{ id: "chat1", item: { text: "a loop repeats", concept: "loop arrow", title: "Repeat", slide: 2 } }]);
  });

  await check("Add to chat refuses: another origin, no origin, GET, empty, too big, a bad slide number is dropped", async () => {
    added.length = 0;
    const ok = { Origin: `http://127.0.0.1:${server.port}` };
    const body = JSON.stringify({ text: "x" });
    assert.strictEqual((await req(`${base}add`, { method: "POST", headers: { Origin: "https://evil.example" }, body })).status, 403);
    assert.strictEqual((await req(`${base}add`, { method: "POST", body })).status, 403);
    assert.strictEqual((await req(`${base}add`)).status, 405);
    assert.strictEqual((await req(`${base}add`, { method: "POST", headers: ok, body: "{}" })).status, 400);
    assert.strictEqual((await req(`${base}add`, { method: "POST", headers: ok, body: "not json" })).status, 400);
    await req(`${base}add`, { method: "POST", headers: ok, body: JSON.stringify({ text: "y".repeat(20000) }) }).catch(() => null);
    assert.strictEqual(added.length, 0);
    await req(`${base}add`, { method: "POST", headers: ok, body: JSON.stringify({ text: "z", slide: -3 }) });
    assert.strictEqual(added[0].item.slide, null);
  });

  await check("Add to chat for a chat that's gone: 404", async () => {
    const r = await req(`/${token}/chat2/add`, { method: "POST", headers: { Origin: `http://127.0.0.1:${server.port}` }, body: JSON.stringify({ text: "x" }) });
    assert.strictEqual(r.status, 404);
  });

  await check("the runtime parses, and uses no emoji", () => {
    const js = fs.readFileSync(path.join(media, "lesson.js"), "utf8");
    new Function(js);   // (a syntax error throws)
    assert.doesNotMatch(js + fs.readFileSync(path.join(media, "lesson.css"), "utf8"), /\p{Extended_Pictographic}/u);
  });

  await check("Learn in Agent/Auto: how to write a lesson page, in this chat's folder, few words, visuals, data-concept", () => {
    for (const mode of ["agent", "auto"]) {
      const p = lessonPrompt("/store/lessons/chat1", mode);
      assert.ok(p.includes("/store/lessons/chat1/<short-topic-name>.html"));
      assert.match(p, /<section class=\\?"slide\\?">/); assert.match(p, /data-concept/); assert.match(p, /at most 6 words/);
      assert.match(p, /slide by slide/);
    }
  });

  await check("Learn in Plan/Ask: says lesson pages need Agent or Auto, and gives no folder", () => {
    for (const mode of ["plan", "ask"]) {
      const p = lessonPrompt("/store/lessons/chat1", mode);
      assert.match(p, /need Agent or Auto mode/); assert.ok(!p.includes("/store/lessons"));
    }
    assert.ok(!moodPrompt("learn").includes("Lesson pages"), "the mood's own text stays as it was (lessons are added by the chat)");
  });

  server.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (failed) { console.error(`${failed} failed`); process.exit(1); }
})();
