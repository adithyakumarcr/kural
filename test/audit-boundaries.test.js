// Harmless security regressions: all credentials, hooks and repositories are disposable fixtures.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), Module = require('module');
const { spawnSync } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kural-audit-boundaries-'));
const project = path.join(tmp, 'project'), storage = path.join(tmp, 'storage');
fs.mkdirSync(project); fs.mkdirSync(storage);
const vscode = { workspace: { isTrusted: true, workspaceFolders: [{ name: 'project', uri: { scheme: 'file', fsPath: project } }], textDocuments: [], getConfiguration: () => ({get: (_, d) => d}) }, env: { appRoot: '/unused' } };
const load = Module._load; Module._load = function(n, ...args) { return n === 'vscode' ? vscode : load.call(this, n, ...args); };
const { projectInstructions } = require('../extension/lib/chat/project');
const { decide } = require('../extension/lib/chat/permission-policy');
const { runsLater, within } = require('../extension/lib/paths');
const scope = require('../extension/lib/profiles/scope');
const ws = require('../extension/lib/workspace');
const { _test: { gitContext } } = require('../extension/lib/tab/terminal');
let failed = 0;
async function check(name, fn) { try { await fn(); console.log('ok  ', name); } catch(e) { failed++; console.error('FAIL', name, e.stack); } }
(async () => {
 await check('repository instruction symlinks cannot disclose an outside synthetic secret', () => {
  const outside = path.join(tmp, 'secret.txt'); fs.writeFileSync(outside, 'SYNTHETIC_SECRET');
  fs.symlinkSync(outside, path.join(project, 'CLAUDE.md'));
  assert.ok(!projectInstructions(project).text.includes('SYNTHETIC_SECRET'));
  fs.unlinkSync(path.join(project, 'CLAUDE.md')); fs.writeFileSync(path.join(project, 'CLAUDE.md'), 'normal project note');
  assert.match(projectInstructions(project).text, /normal project note/);
  assert.deepStrictEqual(projectInstructions(project, false), { text: '', files: [] });
  const rules = path.join(tmp, 'rules'); fs.mkdirSync(rules); fs.writeFileSync(path.join(rules, 'rule.md'), 'SYNTHETIC_SECRET');
  fs.mkdirSync(path.join(project, '.claude')); fs.symlinkSync(rules, path.join(project, '.claude', 'rules'));
  assert.ok(!projectInstructions(project).text.includes('SYNTHETIC_SECRET'));
 });
 await check('executable config and symlink aliases require approval in Agent; normal code still works', () => {
  for (const f of ['.git/config', '.git', '.claude/hooks/run.sh', '.claude/commands/build.md', '.claude/agents/helper.md']) {
   assert.ok(runsLater(path.join(project, f)), f);
   assert.ok(decide({tool:'Write', input:{file_path:f},mode:'agent',cwd:project,writeRoots:[project]}).ask, f);
  }
  fs.mkdirSync(path.join(project,'.git')); fs.writeFileSync(path.join(project,'.git/config'),'');
  const alias=path.join(project,'innocent.txt'); fs.symlinkSync(path.join(project,'.git/config'),alias);
  assert.ok(runsLater(alias));
  assert.ok(decide({tool:'Edit',input:{file_path:alias},mode:'agent',writeRoots:[project]}).ask);
  assert.ok(decide({tool:'Write',input:{file_path:'app.js'},mode:'agent',cwd:project,writeRoots:[project]}).allow);
 });
 await check('Ask and Plan deny mutation even with Allow all or notice; web fetch asks in Agent', () => {
  for(const mode of ['ask','plan']) for(const tool of ['Write','Edit','NotebookEdit','Bash','DeviceCommand','DeviceWrite'])
   assert.ok(decide({tool,input:{file_path:path.join(project,'a'),command:'echo harmless'},mode,writeRoots:[project],allowAll:true,notice:true}).deny, `${mode}/${tool}`);
  assert.ok(decide({tool:'WebFetch',input:{url:'https://example.invalid'},mode:'agent'}).ask);
 });
 await check('implicit read roots exclude SSH keys, saved chats, credentials and unrelated temp files', () => {
  for(const n of ['ssh','chats','checkpoints','profiles/other/chats']) fs.mkdirSync(path.join(storage,n),{recursive:true});
  scope.configure({storage,profile:{id:'default',share:true}}); ws.setWorkDir(path.join(storage,'work'));
  for(const f of ['ssh/id_ed25519','chats/private.json','checkpoints/a.json','profiles/other/chats/private.json']) assert.ok(!within(path.join(storage,f),ws.aiRoots()),f);
  assert.ok(!within(path.join(tmp,'secret.txt'),ws.aiRoots()));
  assert.ok(within(path.join(storage,'images/a.png'),ws.aiRoots()));
 });
 await check('terminal Git context does not run repository fsmonitor or diff textconv hooks', async () => {
  if(process.platform==='win32') { console.log('SKIP shell hook fixture on Windows'); return; }
  const repo=path.join(tmp,'crafted');fs.mkdirSync(repo);
  const git=(...a)=>{const r=spawnSync('git',a,{cwd:repo,encoding:'utf8'});assert.strictEqual(r.status,0,r.stderr);};
  git('init','-q');const marker=path.join(repo,'marker'); const hook=path.join(repo,'hook.sh');
  fs.writeFileSync(hook,`#!/bin/sh\nprintf hooked > '${marker.replace(/'/g,"'\\''")}'\n`,{mode:0o700});
  git('config','core.fsmonitor',hook);git('config','diff.audit.textconv',hook);
  fs.writeFileSync(path.join(repo,'a.txt'),'one\n');fs.writeFileSync(path.join(repo,'.gitattributes'),'*.txt diff=audit\n');
  git('add','.');fs.writeFileSync(path.join(repo,'a.txt'),'two\n');fs.rmSync(marker,{force:true});
  await gitContext(repo,true);assert.ok(!fs.existsSync(marker),'context read executed a hook');
  vscode.workspace.isTrusted=false;const r=await gitContext(repo,true);assert.strictEqual(r.text,'');
 });
 fs.rmSync(tmp,{recursive:true,force:true});process.exitCode=failed?1:0;
})();
