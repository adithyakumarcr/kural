// The connector catalog (lib/ai/connector-catalog.js): the built-in list, the registry's answer in several shapes
// (from fixtures: the real registry can't be reached from the build machine), and the arguments that add one.
const assert = require("assert");
const K = require("../extension/lib/ai/connector-catalog");
const { NAME_RE } = require("../extension/lib/ai/connectors");
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const item = (id) => K.BUILT_IN.find((b) => b.id === id);

(async () => {
  await check("every built-in one is complete, and its name makes a valid connector name", () => {
    const ids = new Set();
    for (const b of K.BUILT_IN) {
      assert.ok(!ids.has(b.id), "duplicate " + b.id); ids.add(b.id);
      assert.ok(b.name && b.description && b.description.length < 80, b.id);
      assert.ok(b.kind === "remote" ? /^https:\/\/\S+$/.test(b.url) : b.package, b.id);
      assert.ok(NAME_RE.test(K.connectorName(b)), b.id);
      for (const i of b.inputs || []) assert.ok(i.key && i.label && (i.env || i.header || i.arg), b.id);
    }
    assert.ok(K.BUILT_IN.length >= 12);
  });

  await check("searching the built-in list: by name, by description, all words; empty = everything", async () => {
    assert.deepStrictEqual((await K.search("notio", async () => ({ servers: [] }))).items.map((x) => x.id), ["notion"]);
    assert.ok((await K.search("jira", async () => ({ servers: [] }))).items.some((x) => x.id === "atlassian"));
    assert.deepStrictEqual(K.matchBuiltIn("browser test").map((x) => x.id), ["playwright"]);
    assert.strictEqual(K.matchBuiltIn("").length, K.BUILT_IN.length);
    let asked = 0; const r = await K.search("", async () => { asked++; return {}; });
    assert.strictEqual(asked, 0); assert.strictEqual(r.items.length, K.BUILT_IN.length);   // (no network for the popular list)
  });

  await check("the registry's answer: { server, _meta } items, bare servers, camelCase and snake_case", () => {
    const fixture = { servers: [
      { server: { name: "io.example/weather", title: "Weather", description: "Forecasts\nfor anywhere.", remotes: [{ type: "sse", url: "https://w.example/sse" }, { type: "streamable-http", url: "https://w.example/mcp" }] }, _meta: {} },
      { name: "io.example/fs-tools", description: "Files", packages: [{ registryType: "npm", identifier: "@ex/fs-tools", version: "1.0.0",
        environmentVariables: [{ name: "FS_KEY", description: "Your key", isRequired: true, isSecret: true }, { name: "FS_DEBUG", isRequired: false }] }] },
      { name: "io.example/py-tools", packages: [{ registry_type: "pypi", name: "py-tools", environment_variables: [{ name: "PY_TOKEN", is_required: true, is_secret: true }] }] },
      { server: { name: "io.example/keyed", remotes: [{ type: "streamable-http", url: "https://k.example/mcp", headers: [{ name: "X-Api-Key", description: "API key", isRequired: true, isSecret: true }, { name: "X-Opt", isRequired: false }] }] } },
      { server: { name: "io.example/docker-only", packages: [{ registryType: "oci", identifier: "ghcr.io/x/y:1" }] } },
      { server: { name: "io.example/nothing" } },
      { server: { name: "io.example/templated", remotes: [{ type: "streamable-http", url: "https://{tenant}.example/mcp" }] } },
      { server: { name: "io.example/weather", remotes: [{ type: "streamable-http", url: "https://w2.example/mcp" }] } },   // (same id again)
      { server: { name: "com.notion/mcp", remotes: [{ type: "streamable-http", url: "https://mcp.notion.com/mcp" }] } },   // (a built-in one)
      null, "junk", {}] };
    const out = K.parseRegistry(fixture), byId = Object.fromEntries(out.map((x) => [x.id, x]));
    assert.deepStrictEqual(out.map((x) => x.id), ["reg:io.example/weather", "reg:io.example/fs-tools", "reg:io.example/py-tools", "reg:io.example/keyed"]);
    assert.deepStrictEqual([byId["reg:io.example/weather"].kind, byId["reg:io.example/weather"].url, byId["reg:io.example/weather"].transport], ["remote", "https://w.example/mcp", "http"]);
    assert.strictEqual(byId["reg:io.example/weather"].description, "Forecasts for anywhere.");
    assert.strictEqual(byId["reg:io.example/weather"].name, "Weather");
    assert.strictEqual(byId["reg:io.example/fs-tools"].name, "fs-tools");
    assert.deepStrictEqual([byId["reg:io.example/fs-tools"].kind, byId["reg:io.example/fs-tools"].package], ["npm", "@ex/fs-tools"]);
    assert.deepStrictEqual(byId["reg:io.example/fs-tools"].inputs.map((i) => [i.env, i.secret, i.label]), [["FS_KEY", true, "Your key"]]);   // (only the required one)
    assert.deepStrictEqual([byId["reg:io.example/py-tools"].kind, byId["reg:io.example/py-tools"].inputs[0].env], ["pypi", "PY_TOKEN"]);
    assert.deepStrictEqual(byId["reg:io.example/keyed"].inputs.map((i) => [i.header, i.secret]), [["X-Api-Key", true]]);
    assert.ok(!byId["reg:io.example/keyed"].signIn && byId["reg:io.example/weather"].signIn);
    assert.deepStrictEqual(K.parseRegistry([{ server: { name: "a/b", remotes: [{ type: "sse", url: "https://s.example/sse" }] } }]).map((x) => x.transport), ["sse"]);
    assert.deepStrictEqual(K.parseRegistry(null), []); assert.deepStrictEqual(K.parseRegistry({ servers: "x" }), []);
  });

  await check("search: built-in matches first, the registry's after; a failing registry gives the built-in ones and a note", async () => {
    let url = "";
    const ok = await K.search("weather notion", async (u) => { url = u; return { servers: [{ server: { name: "a/weather", remotes: [{ type: "streamable-http", url: "https://w/mcp" }] } }] }; });
    assert.match(url, /^https:\/\/registry\.modelcontextprotocol\.io\/v0\/servers\?search=weather%20notion&version=latest&limit=20$/);
    assert.deepStrictEqual(ok.items.map((x) => x.id), ["reg:a/weather"]);   // ("weather notion" matches no built-in as one phrase)
    const both = await K.search("notion", async () => ({ servers: [{ server: { name: "a/notion-x", remotes: [{ type: "streamable-http", url: "https://n/mcp" }] } }] }));
    assert.deepStrictEqual(both.items.map((x) => x.id), ["notion", "reg:a/notion-x"]);
    const down = await K.search("notion", async () => { throw new Error("offline"); });
    assert.deepStrictEqual(down.items.map((x) => x.id), ["notion"]); assert.match(down.note, /Couldn't reach the connector directory/);
  });

  await check("names: a slug of the name, different from the ones already there, always valid", () => {
    assert.strictEqual(K.connectorName({ name: "Hugging Face" }), "hugging-face");
    assert.strictEqual(K.connectorName({ name: "Notion" }, ["notion"]), "notion-2");
    assert.strictEqual(K.connectorName({ name: "Notion" }, ["Notion", "notion-2"]), "notion-3");
    assert.strictEqual(K.connectorName({ name: "  --Ünï/cødé!! " }), "n-c-d");
    assert.strictEqual(K.connectorName({ name: "!!!" , id: "reg:x/y"}), "reg-x-y");
    assert.strictEqual(K.connectorName({ name: "!!!" }), "connector");
    for (const n of ["x", "A.B", "-x", "~~", "9 lives", "a".repeat(100)]) assert.ok(NAME_RE.test(K.connectorName({ name: n })), n);
  });

  await check("adding to Claude: web address, SSE, header, environment variable, folder", () => {
    assert.deepStrictEqual(K.addArgs("claude", item("notion")), { name: "notion", args: ["mcp", "add", "-s", "user", "--transport", "http", "notion", "https://mcp.notion.com/mcp"] });
    assert.deepStrictEqual(K.addArgs("claude", item("asana")).args, ["mcp", "add", "-s", "user", "--transport", "sse", "asana", "https://mcp.asana.com/sse"]);
    assert.deepStrictEqual(K.addArgs("claude", item("notion"), {}, ["notion"]).args.slice(-2), ["notion-2", "https://mcp.notion.com/mcp"]);
    assert.deepStrictEqual(K.addArgs("claude", item("github"), { token: "ghp_1" }).args,
      ["mcp", "add", "-s", "user", "--transport", "http", "github", "https://api.githubcopilot.com/mcp/", "-H", "Authorization: Bearer ghp_1"]);   // (the header last: Claude's -H takes the rest)
    assert.deepStrictEqual(K.addArgs("claude", item("playwright")).args, ["mcp", "add", "-s", "user", "playwright", "--", "npx", "-y", "@playwright/mcp@latest"]);
    assert.deepStrictEqual(K.addArgs("claude", item("filesystem"), { folder: "/home/me/my docs" }).args,
      ["mcp", "add", "-s", "user", "filesystem", "--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "/home/me/my docs"]);
    const env = { id: "reg:a/e", name: "E", kind: "npm", package: "@ex/e", inputs: [{ key: "e:K", label: "Key", env: "K", secret: true }] };
    assert.deepStrictEqual(K.addArgs("claude", env, { "e:K": "v=1" }).args, ["mcp", "add", "-s", "user", "e", "-e", "K=v=1", "--", "npx", "-y", "@ex/e"]);
    assert.deepStrictEqual(K.addArgs("claude", { name: "Py", kind: "pypi", package: "py-tools" }).args, ["mcp", "add", "-s", "user", "py", "--", "uvx", "py-tools"]);
  });

  await check("adding to ChatGPT (Codex): streamable web addresses and commands; a header or SSE is refused in words", () => {
    assert.deepStrictEqual(K.addArgs("codex", item("context7")), { name: "context7", args: ["mcp", "add", "context7", "--url", "https://mcp.context7.com/mcp"] });
    assert.deepStrictEqual(K.addArgs("codex", item("playwright")).args, ["mcp", "add", "playwright", "--", "npx", "-y", "@playwright/mcp@latest"]);
    assert.deepStrictEqual(K.addArgs("codex", item("filesystem"), { folder: "/x" }).args, ["mcp", "add", "filesystem", "--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "/x"]);
    const env = { name: "E", kind: "npm", package: "@ex/e", inputs: [{ key: "e:K", label: "Key", env: "K" }] };
    assert.deepStrictEqual(K.addArgs("codex", env, { "e:K": "v" }).args, ["mcp", "add", "e", "--env", "K=v", "--", "npx", "-y", "@ex/e"]);
    assert.match(K.addArgs("codex", item("github"), { token: "t" }).error, /can't send a key/);
    assert.match(K.addArgs("codex", item("atlassian")).error, /SSE/);
    assert.match(K.forAi("codex", item("asana")).unsupported, /SSE/); assert.strictEqual(K.forAi("claude", item("asana")).unsupported, "");
    assert.match(K.addArgs("agy", item("notion")).error, /can't/);
  });

  await check("missing or odd values are refused before any program runs", () => {
    assert.match(K.addArgs("claude", item("github"), {}).error, /Fill in GitHub token/);
    assert.match(K.addArgs("claude", item("filesystem"), { folder: "  " }).error, /Fill in Folder/);
    assert.match(K.addArgs("claude", item("github"), { token: "a\nb" }).error, /one line/);
    assert.match(K.addArgs("claude", { name: "X", kind: "remote", url: "ftp://x" }).error, /no usable address/);
  });

  await check("registry names go through strict checks (no GitHub shortcuts, no odd variables or headers)", () => {
    const one = (pk) => K.fromRegistryServer({ name: "io.x/y", packages: [pk] });
    for (const id of ["user/repo", "attacker/repo", "github:a/b", "https://x.example/p.tgz", "-y", "../x", "@a/b/c", "a b"])
      assert.strictEqual(one({ registryType: "npm", identifier: id }), null, id);
    for (const id of ["@scope/pkg", "pkg", "pkg@1.2.3", "@scope/pkg@latest"]) assert.ok(one({ registryType: "npm", identifier: id }), id);
    for (const id of ["user/repo", "pkg@1", "git+https://x/y", "-x"]) assert.strictEqual(one({ registryType: "pypi", identifier: id }), null, id);
    assert.ok(one({ registryType: "pypi", identifier: "py-tools[cli]" }));
    const env = (name) => one({ registryType: "npm", identifier: "p", environmentVariables: [{ name, isRequired: true }] });
    for (const n of ["--scope=x", "A B", "NODE_OPTIONS", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "PATH", "PYTHONPATH", "HOME", "NODE_PATH", "A=B"]) assert.strictEqual(env(n), null, n);
    assert.strictEqual(env("MY_KEY").inputs[0].env, "MY_KEY");
    const hdr = (name, url = "https://k.example/mcp") => K.fromRegistryServer({ name: "io.x/k", remotes: [{ type: "streamable-http", url, headers: [{ name, isRequired: true }] }] });
    for (const n of ["X\nEvil: 1", "A B", "a:b", "x".repeat(65)]) assert.strictEqual(hdr(n), null, JSON.stringify(n));
    assert.strictEqual(hdr("X-Api-Key").inputs[0].header, "X-Api-Key");
    assert.strictEqual(hdr("X-Api-Key", "http://k.example/mcp"), null);                     // a key over plain http
    assert.ok(hdr("X-Api-Key", "http://localhost:3000/mcp")); assert.ok(hdr("X-Api-Key", "http://127.0.0.1/mcp"));
    // a hand-made item (not through the parser) is checked again when adding
    assert.match(K.addArgs("claude", { name: "E", kind: "npm", package: "p", inputs: [{ key: "k", label: "K", env: "--scope=x" }] }, { k: "v" }).error, /won't pass/);
    assert.match(K.addArgs("claude", { name: "E", kind: "remote", url: "https://x.example/m", inputs: [{ key: "k", label: "K", header: "A\nB" }] }, { k: "v" }).error, /won't pass/);
    assert.match(K.addArgs("claude", { name: "E", kind: "remote", url: "http://x.example/m", inputs: [{ key: "k", label: "K", header: "X-K" }] }, { k: "v" }).error, /https/);
    assert.match(K.addArgs("claude", { name: "E", kind: "npm", package: "user/repo", from: "registry" }).error, /package name/);
    assert.deepStrictEqual(K.addArgs("claude", { name: "E", kind: "npm", package: "p", inputs: [{ key: "k", label: "K", env: "MY_KEY" }] }, { k: "-x" }).args.slice(5, 8), ["-e", "MY_KEY=-x", "--"]);
  });

  await check("forAi says exactly what will run; the registry reader refuses a huge answer", async () => {
    assert.strictEqual(K.forAi("claude", { name: "N", kind: "npm", package: "@a/b" }).shows, "npx -y @a/b");
    assert.strictEqual(K.forAi("claude", { name: "N", kind: "pypi", package: "p" }).shows, "uvx p");
    assert.strictEqual(K.forAi("claude", { name: "N", kind: "remote", url: "https://x.example/m" }).shows, "https://x.example/m");
    const real = global.fetch, body = (n) => new Response(JSON.stringify({ servers: [], pad: "x".repeat(n) }));
    try {
      global.fetch = async () => body(2 << 20);
      assert.match((await K.search("a")).note, /Couldn't reach/);
      global.fetch = async () => { const r = body(10); Object.defineProperty(r.headers, "get", { value: () => "5000000" }); return r; };
      assert.match((await K.search("a")).note, /Couldn't reach/);
      global.fetch = async () => new Response(JSON.stringify({ servers: [{ name: "io.x/ok", packages: [{ registryType: "npm", identifier: "ok" }] }] }));
      assert.deepStrictEqual((await K.search("zzzz")).items.map((x) => x.id), ["reg:io.x/ok"]);
    } finally { global.fetch = real; }
  });

  console.log(failed ? `connector-catalog: ${failed} FAILED` : "connector-catalog: ALL PASS");
  process.exitCode = failed ? 1 : 0;
})();
