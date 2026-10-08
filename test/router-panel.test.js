// The Model Router panel (lib/router/panel.js): no profile row (Balance, Cost, Intelligence are picked in the chat's model
// menu), no list of models to choose from (Auto uses every cloud model of the AIs you set up), no "Picks from" or "Last
// choice" rows (Adithya, 8 Oct): only a slider from Faster to Quality (four steps: Native, MiniLM, Granite, Qwen3) and an
// info button that explains them.
// The page script runs on a tiny stand-in DOM, so a broken render fails here instead of showing an empty panel.
const assert = require("assert"), Module = require("module");
const updates = [];
const vscode = {
  workspace: { getConfiguration: () => ({ get: (_, d) => d, update: async (...a) => { updates.push(a); } }) },
  ConfigurationTarget: { Global: 1 },
  Uri: { joinPath: (...parts) => parts.join("/") },
};
const load = Module._load;
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const { RouterPanel, _page } = require("../extension/lib/router/panel");
const { HELPERS } = require("../extension/lib/router/client");

// Every element with an id, as a stand-in: text, class, hidden, attributes, click, children; the slider (#level) has a
// value and input/change events.
function dom(html, nonce) {
  const node = (props = {}) => {
    const cls = new Set(), attrs = {};
    const n = Object.assign({
      textContent: "", title: "", onclick: null, children: [], value: "",
      get className() { return [...cls].join(" "); },
      set className(v) { cls.clear(); for (const c of String(v).split(/\s+/)) if (c) cls.add(c); },
      classList: { toggle: (c, on = !cls.has(c)) => { if (on) cls.add(c); else cls.delete(c); return on; }, contains: (c) => cls.has(c) },
      setAttribute: (k, v) => { attrs[k] = String(v); }, getAttribute: (k) => attrs[k],
      replaceChildren: (...kids) => { n.children = kids; n.textContent = kids.map((k) => typeof k === "string" ? k : k.textContent).join(""); },
    }, props);
    return n;
  };
  const els = new Map();
  for (const m of html.matchAll(/<\w+[^>]*\bid="(\w+)"[^>]*>/g)) els.set(m[1], node({ hidden: /\bhidden\b/.test(m[0].replace(/"[^"]*"/g, "")) }));
  const sent = [], listeners = {};
  const doc = { getElementById: (id) => els.get(id), createElement: () => node(), activeElement: null };
  const js = html.split(`<script nonce="${nonce}">`)[1].split("</script>")[0];
  new Function("acquireVsCodeApi", "document", "window", js)(
    () => ({ postMessage: (m) => sent.push(m) }), doc,
    { addEventListener: (type, f) => { listeners[type] = f; } });
  return { $: (id) => els.get(id), sent, doc, state: (s) => listeners.message({ data: { type: "state", ...s } }) };
}

let passed = 0, failed = 0;
const check = async (name, fn) => { try { await fn(); passed++; console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

(async () => {
  const html = _page("N", "vscode-resource:", "codicons.css");

  await check("no profile row: Balance, Cost and Intelligence are picked in the chat's model menu", () => {
    assert.ok(!/Auto prefers|data-v="(cost|balance|intelligence)"/.test(html));
  });

  await check("info button (a Codicon) and a box explaining all four, with HELPERS' numbers", () => {
    assert.ok(html.includes("font-src vscode-resource:") && html.includes('href="codicons.css"'));
    assert.ok(/id="info"[^>]*aria-controls="about"[^>]*><i class="codicon codicon-info"/.test(html));
    for (const name of ["Native", "MiniLM", "Granite", "Qwen3"]) assert.ok(html.includes(`<b>${name}</b>`), name);
    assert.ok(html.includes(`${HELPERS.granite.note} · ${HELPERS.granite.size} download <span class="id">(${HELPERS.granite.model})</span>`));
    assert.ok(html.includes("74 % of task sizes right, instant"));
  });

  await check("no \"Picks from\" or \"Last choice\" rows; the info box says what Auto picks from", () => {
    assert.ok(!/Picks from|Last choice|id="ais"|id="last"/.test(html));
    assert.ok(html.includes("Auto picks from every cloud model of the AIs you set up"));
  });

  await check("the page script renders the helper; the info box opens and closes", () => {
    const p = dom(html, "N");
    assert.strictEqual(p.sent[0].type, "ready");
    p.state({ assistant: "granite", helper: { ...HELPERS.granite, state: "missing", ready: false }, download: null });
    // The slider: Granite is the third of four steps (Faster → Quality), its dot lit, its name in the text.
    assert.strictEqual(Number(p.$("level").value), 2);
    assert.deepStrictEqual(p.$("ticks").children.map((t) => t.className), ["", "", "on", ""]);
    assert.ok(p.$("assistantText").textContent.startsWith("Granite · granite-embedding:30m (about 63 MB) isn't on this computer"), p.$("assistantText").textContent);
    assert.strictEqual(p.$("download").hidden, false);   // Granite isn't on this computer yet
    assert.strictEqual(p.$("about").hidden, true);
    p.$("info").onclick();
    assert.strictEqual(p.$("about").hidden, false);
    assert.strictEqual(p.$("info").getAttribute("aria-expanded"), "true");
    p.$("info").onclick();
    assert.strictEqual(p.$("about").hidden, true);
    p.state({ assistant: "native", helper: null, download: null });
    assert.strictEqual(p.$("download").hidden, true);
    assert.strictEqual(Number(p.$("level").value), 0);
    assert.ok(p.$("assistantText").textContent.startsWith("Native · Kural's own word classifier"));
  });

  await check("the slider: moving it names the step (nothing chosen yet); letting go or a dot chooses it", () => {
    const p = dom(html, "N");
    p.state({ assistant: "native", helper: null, download: null });
    p.sent.length = 0;
    p.$("level").value = "3"; p.$("level").oninput();
    assert.ok(p.$("assistantText").textContent.startsWith("Qwen3 · "), p.$("assistantText").textContent);
    assert.deepStrictEqual(p.sent, []);
    p.$("level").onchange();
    assert.deepStrictEqual(p.sent, [{ type: "assistant", value: "qwen3" }]);
    p.$("ticks").children[1].onclick();
    assert.deepStrictEqual(p.sent[1], { type: "assistant", value: "minilm" });
    assert.strictEqual(String(p.$("level").value), "1");
  });

  await check("the panel's state: the helper only (no profile, no models, no AIs, no last choice; the models aren't even listed)", async () => {
    const posted = [];
    const router = { options: () => ({ assistant: "native", url: "http://127.0.0.1:11434" }),
      availableModels: async () => { throw new Error("the panel shouldn't list the models"); },
      last: { model: "codex:gpt-5", reason: "cost profile · simple search task" } };
    const panel = new RouterPanel({}, router);
    panel.view = { webview: { postMessage: (m) => posted.push(m) } };
    await panel.push();
    assert.deepStrictEqual(Object.keys(posted[0]).sort(), ["assistant", "download", "helper", "type"]);
    assert.strictEqual(posted[0].assistant, "native");
  });

  await check("the panel sets the helper, never the profile", async () => {
    let handler = null;
    const view = { webview: { cspSource: "vscode-resource:", asWebviewUri: (u) => u, onDidReceiveMessage: (f) => { handler = f; } }, onDidDispose: () => {} };
    const panel = new RouterPanel({ extensionUri: "ext" }, { options: () => ({}), availableModels: async () => [] });
    panel.resolveWebviewView(view);
    assert.ok(view.webview.options.localResourceRoots.length === 1 && view.webview.html.includes('href="ext/media/codicons/codicon.css"'));
    panel.view = null;   // (no state pushes in this check)
    await handler({ type: "profile", value: "cost" });
    assert.deepStrictEqual(updates, []);
    await handler({ type: "assistant", value: "granite" });
    assert.deepStrictEqual(updates, [["modelRouter.assistant", "granite", 1]]);
  });

  console.log(`router-panel: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
