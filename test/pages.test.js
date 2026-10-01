// The Tab panel's page script is built inside a template string, where a stray quote breaks it
// silently (the panel just shows up empty). Make sure it parses.
const Module = require("module");
const orig = Module._load;
Module._load = function (r, ...a) { return r === "vscode" ? { workspace: { getConfiguration: () => ({ get: () => 0 }) } } : orig.call(this, r, ...a); };
const html = require("../extension/lib/tabpanel.js")._page("N", "csp");
const js = html.split('<script nonce="N">')[1].split("</script>")[0];
new Function(js);   // throws on a syntax error
console.log("pages: ALL PASS");
