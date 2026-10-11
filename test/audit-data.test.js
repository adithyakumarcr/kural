const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),Module=require('module');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kural-audit-data-'));
const vscode={workspace:{getConfiguration:()=>({get:(_,d)=>d}),fs:{writeFile:async(u,b)=>fs.writeFileSync(u.fsPath,b),delete:async(u)=>fs.unlinkSync(u.fsPath)}},env:{appRoot:'/unused'},Uri:{file:f=>({fsPath:f})},EventEmitter:class{}};
const load=Module._load;Module._load=function(n,...a){return n==='vscode'?vscode:load.call(this,n,...a)};
const {ChangeTracker}=require('../extension/lib/chat/changes');const {ClaudeProcess}=require('../extension/lib/ai/claude');
(async()=>{
 const file=path.join(tmp,'bytes'), original=Buffer.from([0xff,0xfe,0,0x61,0x80]);fs.writeFileSync(file,original);
 const c=new ChangeTracker(),turn={snaps:{}};c.snapshot(turn,file);const snap=c.get(turn.snaps[file]);
 // Also exercise persistence/reload without scheduling the cleanup timer.
 c.dir=path.join(tmp,'checkpoints');fs.mkdirSync(c.dir);fs.writeFileSync(c.diskFile(turn.snaps[file]),JSON.stringify(snap));c.snapshots.clear();
 fs.writeFileSync(file,'changed');assert.strictEqual(await c.undo(turn.snaps[file]),true);assert.deepStrictEqual(fs.readFileSync(file),original);
 assert.ok(c.unchangedSince(file,require('../extension/lib/chat/changes').hash(original)));
 const secret=path.join(tmp,'outside-secret');fs.writeFileSync(secret,'SYNTHETIC_KEEP');
 fs.unlinkSync(file);fs.symlinkSync(secret,file);
 await assert.rejects(()=>c.undo(turn.snaps[file]),/somewhere else/);assert.strictEqual(fs.readFileSync(secret,'utf8'),'SYNTHETIC_KEEP');
 const created=path.join(tmp,'new'),fresh={snaps:{}};c.snapshot(fresh,created);fs.writeFileSync(created,'new');
 const del=vscode.workspace.fs.delete;vscode.workspace.fs.delete=async()=>{throw Object.assign(new Error('permission denied'),{code:'EACCES'})};
 await assert.rejects(()=>c.undo(fresh.snaps[created]),/permission denied/);assert.ok(fs.existsSync(created));vscode.workspace.fs.delete=del;
 const messages=[], cp=new ClaudeProcess({name:'fixture'},{onMessage:m=>messages.push(m)});
 const text='தமிழ் — 🔒 — 日本語';const wire=Buffer.from(JSON.stringify({type:'assistant',text})+'\n');
 for(const b of wire)cp.onData(Buffer.from([b]));assert.strictEqual(messages[0].text,text);
 fs.rmSync(tmp,{recursive:true,force:true});console.log('audit-data: exact checkpoint bytes and one-byte UTF-8 streaming PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
