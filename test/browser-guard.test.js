// Kural's rule for the AI in the browser: it never publishes (extension/lib/browser/guard.js). This table IS the
// specification: what a click, a key or a page's question is. "publish" = never done; "draft" and "normal" = done;
// "commit" = asks first in Agent mode.
const assert = require("assert");
const g = require("../extension/lib/browser/guard");

let failed = 0, rows = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.message); } };

// [label, composer?, kind]
const LABELS = [
  ["Share", false, "publish"], ["Share now", false, "publish"], ["Share reel", false, "publish"], ["SHARE", false, "publish"],
  ["Share →", false, "publish"], ["  share  ", false, "publish"], ["Share Post", false, "publish"], ["Publish", false, "publish"],
  ["Publish now", false, "publish"], ["Send", false, "publish"], ["Send message", false, "publish"], ["Tweet", false, "publish"],
  ["Repost", false, "publish"], ["Go live", false, "publish"], ["Boost post", false, "publish"], ["Add to story", false, "publish"],
  // other languages: the site's buttons are in yours
  ["Teilen", false, "publish"], ["Veröffentlichen", false, "publish"], ["Senden", false, "publish"], ["Partager", false, "publish"],
  ["Publier", false, "publish"], ["Compartir", false, "publish"], ["Publicar", false, "publish"], ["Condividi", false, "publish"],
  ["Delen", false, "publish"], ["Udostępnij", false, "publish"], ["Paylaş", false, "publish"], ["Dela", false, "publish"], ["Del", false, "publish"],
  ["Поделиться", false, "publish"], ["シェア", false, "publish"], ["投稿する", false, "publish"], ["分享", false, "publish"], ["发布", false, "publish"],
  ["공유", false, "publish"], ["शेयर करें", false, "publish"], ["பகிர்", false, "publish"], ["Bagikan", false, "publish"], ["مشاركة", false, "publish"],
  // ambiguous words: only in a composer (something is being written next to them)
  ["Post", true, "publish"], ["Post", false, "normal"], ["Post comment", true, "publish"], ["Comment", true, "publish"],
  ["Comment", false, "normal"], ["Reply", true, "publish"], ["Reply", false, "normal"], ["Schedule", true, "publish"],
  ["Schedule", false, "normal"], ["Posten", true, "publish"], ["Kommentieren", true, "publish"], ["投稿", true, "publish"], ["投稿", false, "normal"],
  // drafts are allowed, also when a publish word is in the label
  ["Save draft", false, "draft"], ["Save as draft", true, "draft"], ["Finish later", false, "draft"], ["Draft", false, "draft"],
  ["Als Entwurf speichern", false, "draft"], ["Enregistrer le brouillon", false, "draft"], ["Guardar borrador", false, "draft"],
  ["下書きを保存", false, "draft"], ["保存草稿", false, "draft"], ["வரைவு", false, "draft"], ["Save post as draft", true, "draft"],
  ["Share draft", false, "draft"],
  // not publishing
  ["Next", true, "normal"], ["Back", true, "normal"], ["Crop", true, "normal"], ["Select from computer", true, "normal"],
  ["Posts", true, "normal"], ["Shared with you", false, "normal"], ["Shares", false, "normal"], ["Sending options", false, "normal"],
  ["Postal code", true, "normal"], ["Delete-me", false, "commit"], ["Del mismo autor", false, "normal"], ["Drafts", false, "normal"],
  ["Share your thoughts about this long thing that someone wrote here and more and more words", false, "normal"],
  ["Create new reel", true, "normal"], ["Edit", true, "normal"], ["Cover photo", true, "normal"], ["", false, "normal"],
  // asks first in Agent mode
  ["Submit", false, "commit"], ["Submit answers", false, "commit"], ["Pay now", false, "commit"], ["Buy now", false, "commit"],
  ["Place order", false, "commit"], ["Delete", false, "commit"], ["Discard", true, "commit"], ["Log out", false, "commit"],
  ["Accept all", false, "commit"], ["Einreichen", false, "commit"], ["Löschen", false, "commit"], ["Verwerfen", true, "commit"],
];

check("labels", () => {
  for (const [label, composer, want] of LABELS) {
    assert.strictEqual(g.classifyLabel(label, { composer }).kind, want, `${JSON.stringify(label)} (composer ${composer})`);
    rows++;
  }
});

check("a click: the element and the clickable things around it", () => {
  const span = { role: "generic", labels: ["Share"] };   // (a span: it doesn't take clicks itself, but its button does)
  assert.strictEqual(g.classifyClick([{ role: "button", labels: ["Share"] }]).kind, "publish");
  assert.strictEqual(g.classifyClick([span, { role: "button", labels: [""] }]).kind, "publish");
  assert.strictEqual(g.classifyClick([{ role: "button", labels: ["Next"] }, { role: "dialog", labels: ["Create new reel"] }]).kind, "normal");
  // a switch or a box only sets something
  assert.strictEqual(g.classifyClick([{ role: "switch", labels: ["Share to Facebook"] }]).kind, "normal");
  assert.strictEqual(g.classifyClick([{ role: "checkbox", labels: ["Also share to Facebook"] }]).kind, "normal");
  // the most serious wins; a draft label wins on its own element
  assert.strictEqual(g.classifyClick([{ role: "button", labels: ["Save draft", "Share"] }]).kind, "draft");
  assert.strictEqual(g.classifyClick([{ role: "button", labels: ["Delete"] }, { role: "button", labels: ["Share"] }]).kind, "publish");
  assert.strictEqual(g.classifyClick([{ role: "button", labels: ["Post"], composer: true }]).kind, "publish");
  assert.strictEqual(g.classifyClick([{ role: "menuitem", labels: ["Post"], composer: false }]).kind, "normal");
  const v = g.classifyClick([{ role: "button", labels: ["", "Share"] }]);
  assert.strictEqual(v.label, "Share");
  rows += 10;
});

check("keys: Enter and Space", () => {
  const enter = { key: "Enter", modifiers: {} };
  const K = (focus, key = enter) => g.classifyKey(key, focus).kind;
  // on a button: like a click
  assert.strictEqual(K({ editable: false, chain: [{ role: "button", labels: ["Share"] }] }), "publish");
  assert.strictEqual(K({ editable: false, chain: [{ role: "button", labels: ["Share"] }] }, { key: " " }), "publish");
  assert.strictEqual(K({ editable: false, chain: [{ role: "button", labels: ["Next"] }] }), "normal");
  // in a text box with lines (a caption, a comment, a message): never
  assert.strictEqual(K({ editable: true, multiline: true, labels: ["Write a caption…"] }), "publish");
  assert.strictEqual(K({ editable: true, multiline: true, labels: ["Write a caption…"] }, { key: "Enter", modifiers: { shift: true } }), "normal");
  assert.strictEqual(K({ editable: true, multiline: false, labels: ["Add a comment…"] }), "publish");
  assert.strictEqual(K({ editable: true, multiline: false, labels: ["Aa"] }), "publish");   // Messenger
  assert.strictEqual(K({ editable: true, multiline: false, labels: ["Name"], form: { submits: [] } }, { key: "Enter", modifiers: { meta: true } }), "publish");
  // search boxes only search (Google's is a textarea)
  assert.strictEqual(K({ editable: true, multiline: true, labels: ["Search"], role: "combobox" }), "normal");
  assert.strictEqual(K({ editable: true, labels: ["Suchen"] }), "normal");
  assert.strictEqual(K({ editable: true, type: "search", labels: [""] }), "normal");
  // a one-line field in a form: what its submit button is
  assert.strictEqual(K({ editable: true, labels: ["Email"], form: { submits: ["Sign in"] } }), "commit");
  assert.strictEqual(K({ editable: true, labels: ["Your answer"], form: { submits: ["Send"] } }), "publish");
  assert.strictEqual(K({ editable: true, labels: ["Title"], form: { submits: ["Save draft"] } }), "normal");
  assert.strictEqual(K({ editable: true, labels: ["Postal code"] }), "commit");   // (not a message box: asks)
  // other keys
  assert.strictEqual(K({ editable: true, multiline: true, labels: ["Message"] }, { key: "Tab" }), "normal");
  assert.strictEqual(K({ editable: true, multiline: true, labels: ["Message"] }, { key: "a" }), "normal");
  rows += 17;
});

check("a page's question", () => {
  assert.strictEqual(g.classifyDialog("Publish this reel now?", true).kind, "publish");
  assert.strictEqual(g.classifyDialog("Publish this reel now?", false).kind, "normal");   // Cancel is fine
  assert.strictEqual(g.classifyDialog("Discard post? If you leave, your edits won't be saved.", true).kind, "normal");
  assert.strictEqual(g.classifyDialog("Leave site? Changes you made may not be saved.", true).kind, "normal");
  assert.strictEqual(g.classifyDialog("Save this as a draft?", true).kind, "draft");
  assert.strictEqual(g.classifyDialog("Are you sure you want to send this message?", true).kind, "publish");
  rows += 6;
});

check("the network stop (Instagram)", () => {
  const ig = "https://www.instagram.com";
  assert.ok(g.blockedRequest(`${ig}/api/v1/media/configure_to_clips/`, "POST"));
  assert.ok(g.blockedRequest(`${ig}/api/v1/media/configure/`, "POST"));
  assert.ok(g.blockedRequest(`${ig}/api/v1/media/configure_sidecar/`, "POST"));
  assert.ok(g.blockedRequest("https://i.instagram.com/api/v1/media/configure_to_story/", "POST"));
  assert.ok(g.blockedRequest(`${ig}/api/v1/web/comments/3141592/add/`, "POST"));
  assert.ok(g.blockedRequest(`${ig}/create/configure/`, "POST"));
  assert.strictEqual(g.blockedRequest(`${ig}/api/v1/media/configure_to_clips/`, "GET"), null);
  assert.strictEqual(g.blockedRequest(`${ig}/rupload_igvideo/fb_uploader_123`, "POST"), null);   // the upload itself isn't publishing
  assert.strictEqual(g.blockedRequest(`${ig}/api/v1/web/comments/3141592/`, "POST"), null);
  assert.strictEqual(g.blockedRequest("https://evil.example/www.instagram.com/api/v1/media/configure/", "POST"), null);
  assert.strictEqual(g.blockedRequest("https://www.instagram.com.evil.example/api/v1/media/configure/", "POST"), null);
  // Every rule's Fetch pattern is wider than its check (so the request reaches the check).
  const wild = (p) => new RegExp("^" + p.split("*").map((s) => s.replace(/[.?+^$()[\]{}|\\]/g, "\\$&")).join(".*") + "$", "i");
  for (const r of g.NETWORK) {
    const sample = { "publishing a post, reel or story": `${ig}/api/v1/media/configure_to_clips/`, "publishing a post": `${ig}/create/configure/`,
      "posting a comment": r.re.source.includes("api") ? `${ig}/api/v1/web/comments/1/add/` : `${ig}/web/comments/1/add/` }[r.what];
    assert.ok(wild(r.pattern).test(sample) && r.re.test(sample), `${r.pattern}: ${sample}`);
  }
  rows += 15;
});

check("what the AI is told", () => {
  const t = g.refusal({ kind: "publish", label: "Share", word: "share" }, "instagram.com");
  assert.ok(/"Share" publishes on instagram\.com/.test(t) && /never lets the AI publish/.test(t) && /press it themselves/.test(t), t);
  assert.ok(/\\n/.test(g.refusal({ kind: "publish", why: "enter-sends", label: "Write a caption…" })));
});

console.log(failed ? `\n${failed} failed` : `\nAll ${rows} cases pass.`);
process.exit(failed ? 1 : 0);
