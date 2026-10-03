// Local models for the chat (extension/lib/ollama.js), against a stand-in Ollama (test/fake-ollama-chat.js).
const assert = require("assert");
const { Ollama, parseSearch, params, memoryGB, variantName, versionAtLeast } = require("../extension/lib/ollama");
const fake = require("./fake-ollama-chat");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };

// Shaped like ollama.com/search: each result is a list item with a /library/ link, a description, badges.
const SEARCH_HTML = `<ul>
<li x-test-model class="flex"><a href="/library/qwen3-coder" class="group"><h2><span x-test-search-response-title>qwen3-coder</span></h2>
  <p class="max-w-lg">Alibaba's performant long context models for agentic and coding tasks, up to 480B.</p>
  <div><span x-test-capability>tools</span> <span x-test-size>30b</span> <span x-test-size>480b</span> <span x-test-capability>cloud</span></div>
  <p><span x-test-pull-count>1.4M</span> <span>Pulls</span> <span x-test-tag-count>8</span> <span>Tags</span> <span>Updated</span> <span x-test-updated>2 months ago</span></p></a></li>
<li x-test-model class="flex"><a href="/library/gpt-oss"><h2>gpt-oss</h2><p>OpenAI&#39;s open-weight models &amp; more.</p>
  <span>tools</span><span>thinking</span><span>20b</span><span>120b</span><span>5.2M</span><span>Pulls</span><span>Updated 1 week ago</span></a></li>
<li><a href="/library/gpt-oss">duplicate</a></li>
<li><a href="/library/glm-ocr"><h2>glm-ocr</h2><p>Reads text in images.</p><span>vision</span><span>tools</span>
  <span>0.9b</span><span>7.8M</span><svg><path d="M1 2"/></svg><span>Downloads</span><span>12</span><span>Tags</span></a></li>
<li><a href="/blog/x">not a model</a></li>
</ul>`;

(async () => {
  const f = fake.start(11461);
  const ol = new Ollama(() => "http://127.0.0.1:11461/");
  await new Promise((r) => setTimeout(r, 100));

  await check("status: running, new enough for the chat", async () => {
    assert.deepStrictEqual(await ol.status(), { running: true, version: "0.15.2", ok: true });
  });
  await check("status: Ollama not running", async () => {
    const none = new Ollama(() => "http://127.0.0.1:1");
    assert.strictEqual((await none.status()).running, false);
  });
  await check("versions: 0.14.0 is the first that works", () => {
    assert.ok(versionAtLeast("0.14.0", "0.14.0") && versionAtLeast("0.15.2", "0.14.0") && versionAtLeast("1.0.0", "0.14.0"));
    assert.ok(!versionAtLeast("0.13.5", "0.14.0") && !versionAtLeast("0.9.9", "0.14.0"));
  });
  await check("models: only ones with tools can chat (not embeddings, not Tab's code model)", async () => {
    const m = await ol.models();
    assert.deepStrictEqual(m.filter((x) => x.chat).map((x) => x.name), ["qwen3-coder:30b", "qwen3:8b"]);
    assert.strictEqual(m.length, 4);
  });
  await check("bigger context: a copy made once, then reused, and not listed as a model", async () => {
    const v = await ol.withContext("qwen3-coder:30b", 32768);
    assert.strictEqual(v, "kural-qwen3-coder-30b-32k");
    await ol.withContext("qwen3-coder:30b", 32768);
    assert.strictEqual(f.created.length, 1);
    assert.deepStrictEqual(f.created[0].parameters, { num_ctx: 32768 });
    assert.ok(!(await ol.models()).some((x) => x.name.startsWith("kural-")));
  });
  await check("download: progress, then the model is there", async () => {
    const seen = [];
    await ol.pull("llama3.1:8b", (p) => seen.push(p.percent));
    assert.ok(seen.length >= 3 && seen.includes(50), seen.join());
    assert.ok((await ol.models()).some((x) => x.name === "llama3.1:8b" && x.chat));
  });
  await check("download: a model that doesn't exist says why", async () => {
    await assert.rejects(ol.pull("nope:1b"), /Ollama has no model called "nope:1b"/);
  });
  await check("delete", async () => {
    await ol.remove("llama3.1:8b");
    assert.ok(!(await ol.models()).some((x) => x.name === "llama3.1:8b"));
  });
  await check("search page: name, description, sizes, capabilities, pulls", () => {
    const r = parseSearch(SEARCH_HTML);
    assert.deepStrictEqual(r.map((x) => x.name), ["qwen3-coder", "gpt-oss", "glm-ocr"]);
    assert.deepStrictEqual(r[2].sizes, ["0.9b"]);                               // not "7.8M" (downloads), not "12"
    assert.strictEqual(r[2].pulls, "7.8M");
    assert.deepStrictEqual(r[0].sizes, ["30b", "480b"]);                      // not "480B" from the description
    assert.deepStrictEqual(r[0].capabilities, ["tools", "cloud"]);
    assert.strictEqual(r[0].pulls, "1.4M");
    assert.strictEqual(r[0].updated, "2 months ago");
    assert.strictEqual(r[1].description, "OpenAI's open-weight models & more.");
    assert.deepStrictEqual(r[1].sizes, ["20b", "120b"]);                       // not "5.2M" (pulls)
    assert.deepStrictEqual(r[1].capabilities, ["tools", "thinking"]);
  });
  await check("search: uses ollama.com, filtered to models with tools", async () => {
    let asked = "";
    const r = await ol.search("coder", async (u) => { asked = u; return { ok: true, text: async () => SEARCH_HTML }; });
    assert.ok(/ollama\.com\/search\?c=tools&q=coder/.test(asked), asked);
    assert.strictEqual(r.from, "ollama.com");
    assert.strictEqual(r.results.length, 3);
  });
  await check("search: leaves out cloud-only models (nothing to download, not offline)", async () => {
    const html = SEARCH_HTML.replace("</ul>", `<li><a href="/library/glm-5.3"><h2>glm-5.3</h2><p>Flagship coding model.</p>
      <span>tools</span><span>thinking</span><span>cloud</span><span>90K</span><span>Pulls</span></a></li></ul>`);
    const r = await ol.search("glm", async () => ({ ok: true, text: async () => html }));
    assert.ok(!r.results.some((m) => m.name === "glm-5.3"), r.results.map((m) => m.name).join());
    assert.ok(r.results.some((m) => m.name === "qwen3-coder"));   // has sizes and cloud: can be downloaded
  });
  await check("search offline: Kural's own suggestions, matching the words", async () => {
    const r = await ol.search("coding", async () => { throw new Error("offline"); });
    assert.strictEqual(r.from, "suggested");
    assert.ok(r.results.length >= 1 && r.results.every((m) => /coding/i.test(m.description)), JSON.stringify(r.results.map((m) => m.name)));
    assert.ok((await ol.search("", async () => { throw new Error("offline"); })).results.length >= 4);
  });
  await check("sizes and memory", () => {
    assert.strictEqual(params("30b"), 30); assert.strictEqual(params("500m"), 0.5); assert.strictEqual(params("e2b"), 2);
    assert.strictEqual(params("latest"), null);
    assert.strictEqual(memoryGB("30b"), 21); assert.strictEqual(memoryGB("8b"), 7);
    assert.strictEqual(variantName("gpt-oss:20b", 65536), "kural-gpt-oss-20b-64k");
  });

  f.close();
  console.log(fail ? `ollama: ${fail} FAILED` : "ollama: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
