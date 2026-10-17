// The AI's browser driver (extension/lib/browser/page.js) in a real Chromium: Chrome, started headless here with its
// DevTools pipe (the same protocol VS Code's browser tabs give Kural), on a stand-in reel composer
// (test/fixtures/browser/reel.html). It goes the whole way: pick a video, drag the cover frame, Next, a caption, the
// settings, Save draft; and Kural's rule holds: Share (by ref, by coordinates, as an icon), Enter in the caption and in a
// comment box, OK on "Publish this reel now?" are all refused, and the network stop fails Instagram's publish request even
// when the page itself sends it. Not part of npm test: it needs Chrome (KURAL_CHROME, or the usual places).
//   node test/browser-page.live.js
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const { spawn } = require("child_process");
const { Cdp } = require("../extension/lib/browser/cdp");
const { Page, Stop } = require("../extension/lib/browser/page");

const CHROME = [process.env.KURAL_CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.log("skip: no Chrome here (set KURAL_CHROME)"); process.exit(0); }

const FIX = path.join(__dirname, "fixtures", "browser");
const server = http.createServer((req, res) => {
  const f = path.join(FIX, path.basename(new URL(req.url, "http://x").pathname) || "reel.html");
  if (!fs.existsSync(f)) { res.statusCode = 404; res.end(); return; }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(fs.readFileSync(f));
});

function pipe(child) {
  const out = child.stdio[3], inp = child.stdio[4];
  let buf = "", onMsg = () => {}, onClose = () => {};
  inp.setEncoding("utf8");
  inp.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\0")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); onMsg(m); } });
  inp.on("close", () => onClose());
  return { send: (o) => out.write(JSON.stringify(o) + "\0"), onMessage: (f) => { onMsg = f; }, onClose: (f) => { onClose = f; }, close: () => child.kill() };
}
// A JPEG's width and height (its SOF marker).
function jpegSize(b64) {
  const b = Buffer.from(b64, "base64");
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
}
// The ref on the line that matches (from a snapshot).
const refOf = (text, re) => { const l = String(text).split("\n").find((x) => re.test(x)); const m = l && /\[(e\d+)\]/.exec(l); if (!m) throw new Error(`no line ${re} in:\n${text}`); return m[1]; };

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack || e.message); } };

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kural-chrome-"));
  // (Nothing leaves this computer: every name but this one fails to resolve.)
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--window-size=1200,900", "--force-device-scale-factor=2", "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1", "about:blank"],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const cdp = new Cdp(pipe(chrome));
  const video = path.join(profile, "clip.mp4");
  fs.writeFileSync(video, Buffer.alloc(2048, 1));
  const refused = [], asked = [];
  let commitAnswer = false;
  const hooks = { refused: (v) => refused.push(v), commit: async (v) => { asked.push(v); return commitAnswer ? { allow: true } : { allow: false, message: "The user said no." }; } };
  try {
    const session = await cdp.attach();
    const page = new Page(session, { label: "t1", platform: process.platform });
    await page.init();
    const blocked = [];
    await page.guardNetwork((rule, url) => blocked.push(url));
    const log = async () => (await session.send("Runtime.evaluate", { expression: "JSON.stringify(window.log)", returnByValue: true })).result.value;
    const has = async (s) => JSON.parse(await log()).includes(s);
    let snap;

    await check("open the page; the outline has the composer, Share marked", async () => {
      snap = await page.navigate({ url: `${base}/reel.html` });
      assert.ok(/Page "Create new reel" · http:\/\/127\.0\.0\.1/.test(snap), snap);
      assert.ok(/dialog "Create new reel"/.test(snap) && /button "Select from computer" \[e\d+\]/.test(snap), snap);
      assert.ok(/radio "4"/.test(snap) && /textbox "Add a comment…"/.test(snap), snap);
    });
    await check("the Create menu's Post opens the composer: allowed", async () => {
      snap = await page.click({ ref: refOf(page.last, /button "Create"/) }, hooks);
      assert.ok(/menuitem "Post" \[e\d+\]/.test(page.last), page.last);   // (not marked: it only opens the composer)
      snap = await page.click({ ref: refOf(page.last, /menuitem "Post"/) }, hooks);
      assert.ok(await has("menu-post"), await log());
    });
    await check("Search + Enter only searches", async () => {
      await page.type({ ref: refOf(page.last, /textbox "Search input"/), text: "cats" });
      await page.press({ key: "Enter" }, hooks);
      assert.ok(await has("searched:cats"), await log());
    });
    await check("Select from computer → the file chooser is Kural's → upload", async () => {
      snap = await page.click({ ref: refOf(page.last, /button "Select from computer"/) }, hooks);
      assert.ok(/A file chooser is open/.test(snap), snap);
      snap = await page.upload({ files: [video] });
      assert.ok(await has("file:clip.mp4"), await log());
      assert.ok(/slider "Cover frame"/.test(snap), snap);
    });
    await check("drag the cover frame; a key on the trim slider", async () => {
      snap = await page.drag({ ref: refOf(page.last, /slider "Cover frame"/), dx: 120 });
      assert.ok(JSON.parse(await log()).some((x) => /^cover:1[01]\d$|^cover:12\d$/.test(x)), await log());
      snap = await page.press({ key: "ArrowRight", ref: refOf(page.last, /slider "Trim start"/) }, hooks);
      assert.ok(await has("trim:1"), await log());
    });
    await check("Next → the caption step", async () => {
      snap = await page.click({ ref: refOf(page.last, /button "Next"/) }, hooks);
      assert.ok(/textbox "Write a caption\.\.\."/.test(snap) && /button "Share" \(publishes: Kural won't press it\)/.test(snap), snap);
    });
    await check("a caption with two lines (no Enter that could post)", async () => {
      snap = await page.type({ ref: refOf(page.last, /textbox "Write a caption/), text: "Morning run\nDay 2" });
      const t = (await session.send("Runtime.evaluate", { expression: "document.getElementById('caption').innerText", returnByValue: true })).result.value;
      assert.ok(/Morning run\s*\n\s*Day 2/.test(t), JSON.stringify(t));
      assert.ok(!(await has("CAPTION-ENTER")), await log());
    });
    await check("Enter in the caption: refused", async () => {
      await assert.rejects(page.press({ key: "Enter", ref: refOf(page.last, /textbox "Write a caption/) }, hooks), (e) => e instanceof Stop && /never lets the AI publish/.test(e.message));
      assert.ok(!(await has("CAPTION-ENTER")));
    });
    await check("settings: Share to Facebook (a switch) and the audience", async () => {
      snap = await page.click({ ref: refOf(page.last, /switch "Share to Facebook"/) }, hooks);
      assert.ok(await has("fb:true"), await log());
      snap = await page.select({ ref: refOf(page.last, /combobox "Audience"/), values: ["Close friends"] });
      assert.ok(await has("aud:Close friends"), await log());
    });
    await check("Share: refused by ref, at its coordinates, and as an icon", async () => {
      const n = refused.length;
      await assert.rejects(page.click({ ref: refOf(page.last, /button "Share" \(/) }, hooks), (e) => e instanceof Stop && /"Share" publishes on 127\.0\.0\.1/.test(e.message));
      const box = (await session.send("Runtime.evaluate", { expression: "JSON.stringify(document.getElementById('share').getBoundingClientRect())", returnByValue: true })).result.value;
      const r = JSON.parse(box);
      await assert.rejects(page.click({ x: r.x + r.width / 2, y: r.y + r.height / 2 }, hooks), Stop);
      const icon = JSON.parse((await session.send("Runtime.evaluate", { expression: "JSON.stringify(document.getElementById('iconShare').getBoundingClientRect())", returnByValue: true })).result.value);
      await assert.rejects(page.click({ x: icon.x + icon.width / 2, y: icon.y + icon.height / 2 }, hooks), Stop);
      assert.ok(!(await has("SHARED")) && !(await has("SHARED-ICON")), await log());
      assert.strictEqual(refused.length, n + 3);
    });
    await check("a drag that starts on Share is refused (a button may act when pressed); a lone \\r types no Enter", async () => {
      await assert.rejects(page.drag({ ref: refOf(page.last, /button "Share" \(/), dx: 5 }, hooks), (e) => e instanceof Stop && /publishes/.test(e.message));
      snap = await page.type({ ref: refOf(page.last, /textbox "Write a caption/), text: "one\rtwo", replace: false });
      assert.ok(!(await has("CAPTION-ENTER")) && !(await has("SHARED")), await log());
    });
    await check("Save draft: allowed", async () => {
      snap = await page.click({ ref: refOf(page.last, /button "Save draft"/) }, hooks);
      assert.ok(await has("draft"), await log());
    });
    await check("the same element keeps its ref", async () => {
      const a = refOf(page.last, /button "Save draft"/);
      snap = await page.snapshot();
      assert.strictEqual(refOf(page.last, /button "Save draft"/), a);
    });
    await check("the network stop: the page's own Share (not the AI) can't publish while Kural is attached", async () => {
      await session.send("Runtime.evaluate", { expression: "document.getElementById('share').click()" });
      for (let i = 0; i < 50 && !(await has("configure-failed")) && !(await has("configure-sent")); i++) await new Promise((r) => setTimeout(r, 100));
      assert.ok(await has("configure-failed"), await log());
      assert.ok(blocked.some((u) => /configure_to_clips/.test(u)), JSON.stringify(blocked));
    });
    await check("the page asks \"Publish this reel now?\": OK refused, Cancel fine", async () => {
      snap = await page.click({ ref: refOf(page.last, /button "Ask"/) }, hooks);
      assert.ok(/The page is asking \(confirm\): "Publish this reel now\?"/.test(snap), snap);
      await assert.rejects(page.click({ ref: refOf(page.last, /button "Save draft"/) }, hooks), /Answer it with the dialog tool/);
      await assert.rejects(page.dialog({ accept: true }, hooks), (e) => e instanceof Stop && /never lets the AI publish/.test(e.message));
      snap = await page.dialog({ accept: false }, hooks);
      assert.ok(await has("dialog-cancel"), await log());
    });
    await check("Discard asks first (here: the user says no)", async () => {
      commitAnswer = false;
      const n = asked.length;
      await assert.rejects(page.click({ ref: refOf(page.last, /button "Discard"/) }, hooks), /The user said no/);
      assert.strictEqual(asked.length, n + 1);
      assert.ok(!(await has("discarded")));
    });
    await check("a comment box: Enter and its Post are refused", async () => {
      snap = await page.type({ ref: refOf(page.last, /textbox "Add a comment…"/), text: "nice!" });
      await assert.rejects(page.press({ key: "Enter" }, hooks), Stop);
      await assert.rejects(page.click({ ref: refOf(page.last, /button "Post"/) }, hooks), Stop);
      assert.ok(!(await has("COMMENTED")) && !(await has("COMMENTED-ENTER")), await log());
    });
    await check("a quiz: choose 4, Submit asks first (here: yes)", async () => {
      snap = await page.click({ ref: refOf(page.last, /radio "4"/) }, hooks);
      commitAnswer = true;
      snap = await page.click({ ref: refOf(page.last, /button "Submit"/) }, hooks);
      assert.ok(await has("submitted:4"), await log());
      assert.strictEqual(asked[asked.length - 1].word, "submit");
    });
    await check("something over the page gets the click instead", async () => {
      await session.send("Runtime.evaluate", { expression: "document.getElementById('overlay').classList.add('on')" });
      await assert.rejects(page.click({ ref: refOf(page.last, /button "Save draft"/) }, hooks), /is covered by/);
      await session.send("Runtime.evaluate", { expression: "document.getElementById('overlay').classList.remove('on')" });
    });
    await check("a picture of the page, in the page's own pixels (on a screen with 2 pixels per page pixel)", async () => {
      const shot = await page.screenshot();
      assert.ok(shot.data.startsWith("/9j/") && shot.data.length > 2000, shot.data.slice(0, 20));
      const view = JSON.parse((await session.send("Runtime.evaluate", { expression: "JSON.stringify([innerWidth, innerHeight, devicePixelRatio])", returnByValue: true })).result.value);
      assert.strictEqual(view[2], 2);
      assert.deepStrictEqual(jpegSize(shot.data), [view[0], view[1]]);
      assert.deepStrictEqual([shot.width, shot.height], [view[0], view[1]]);
      // One element, after scrolling: its own size.
      await session.send("Runtime.evaluate", { expression: "document.body.style.height = '3000px'; scrollTo(0, 40)" });
      const r = JSON.parse((await session.send("Runtime.evaluate", { expression: "JSON.stringify(document.getElementById('draft').getBoundingClientRect())", returnByValue: true })).result.value);
      const part = await page.screenshot({ ref: refOf(page.last, /button "Save draft"/) });
      const [w, h] = jpegSize(part.data);
      assert.ok(Math.abs(w - r.width) <= 1 && Math.abs(h - r.height) <= 1, `${w}×${h} vs ${r.width}×${r.height}`);
      await session.send("Runtime.evaluate", { expression: "document.body.style.height = ''; scrollTo(0, 0)" });
    });
    await check("find on the page; wait for words", async () => {
      const f = await page.snapshot({ find: "Question 1" });
      assert.ok(/radiogroup "Question 1"/.test(f) && !/Save draft/.test(f), f);
      const w = await page.wait({ text: "Question 1", seconds: 3 });
      assert.ok(/"Question 1" is on the page/.test(w), w);
    });
    await check("a narrow tab that scrolls sideways (VS Code's beside the code): clicks still find their element", async () => {
      await session.send("Emulation.setDeviceMetricsOverride", { width: 400, height: 600, deviceScaleFactor: 2, mobile: false });
      try {
        snap = await page.snapshot();
        const n = refused.length;
        await assert.rejects(page.click({ ref: refOf(page.last, /button "Share" \(/) }, hooks), (e) => e instanceof Stop && /publishes/.test(e.message));
        assert.strictEqual(refused.length, n + 1);
        const before = JSON.parse(await log()).filter((x) => x === "draft").length;
        snap = await page.click({ ref: refOf(page.last, /button "Save draft"/) }, hooks);
        const sx = (await session.send("Runtime.evaluate", { expression: "scrollX", returnByValue: true })).result.value;
        assert.ok(sx > 0, `the page scrolled sideways (${sx})`);
        assert.strictEqual(JSON.parse(await log()).filter((x) => x === "draft").length, before + 1, await log());
        snap = await page.click({ ref: refOf(page.last, /button "Ask"/) }, hooks);
        assert.ok(/The page is asking \(confirm\)/.test(snap), snap);
        snap = await page.dialog({ accept: false }, hooks);
      } finally { await session.send("Emulation.clearDeviceMetricsOverride"); }
    });
    await check("another page, back; an old ref names nothing there", async () => {
      const old = refOf(page.last, /button "Save draft"/);
      snap = await page.click({ ref: refOf(page.last, /link "Second page"/) }, hooks);
      assert.ok(/Page "Second page"/.test(snap), snap);
      await assert.rejects(page.click({ ref: old }, hooks), new RegExp(`There's no ${old}`));
      snap = await page.navigate({ back: true });
      assert.ok(/Page "Create new reel"/.test(snap), snap);
      await assert.rejects(page.click({ ref: "e99999" }, hooks), /There's no e99999/);
    });
    page.close();
  } finally {
    cdp.close(); chrome.kill(); server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : "\nAll passed.");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
