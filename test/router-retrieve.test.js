// Real local rg retrieval over a temporary workspace; no model or editor process is started.
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),Module=require('module');
const {spawnSync}=require('child_process');
if(spawnSync('rg',['--version'],{stdio:'ignore'}).status!==0){console.log('router-retrieve: SKIP (rg unavailable)');process.exit(0);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kural-router-retrieve-')),root=path.join(dir,'project');fs.mkdirSync(root);
const file=(name,text)=>{const f=path.join(root,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,text);return f;};
const uri=(f)=>({scheme:'file',fsPath:f});
const documents=[],vscode={env:{appRoot:'/unused'},Uri:{file:uri},workspace:{workspaceFolders:[{name:'project',uri:uri(root)}],textDocuments:documents,
 getConfiguration:(section)=>({get:(key,d)=>key==='exclude'&&section==='search'?{'**/private':true}:d})}};
const load=Module._load;Module._load=function(r,...args){return r==='vscode'?vscode:load.call(this,r,...args);};
const {retrieve,termsOf}=require('../extension/lib/router/retrieve');
file('.gitignore','ignored/\n');file('src/login.js','function loginSession() { return sessionToken; }\n');
const unsaved=file('src/unsaved.js','old text\n');documents.push({uri:uri(unsaved),getText:()=> 'const loginSession = "unsaved";\n'});
for(const name of ['private/passwords.js','ignored/passwords.js','.env.local','node_modules/passwords.js','cert.pem']){
 const f=file(name,'login session secret\n');documents.push({uri:uri(f),getText:()=> 'login session sensitive unsaved\n'});
}
const outside=path.join(dir,'outside.js');fs.writeFileSync(outside,'login session outside\n');
try{fs.symlinkSync(outside,path.join(root,'outside-link.js'));}catch{}
(async()=>{try{
 assert.deepStrictEqual(termsOf('Find loginSession implementation'),['login','session']);
 const out=await retrieve('find login session');
 assert.ok(out.some(c=>c.file==='src/login.js'));assert.ok(out.some(c=>c.file==='src/unsaved.js'&&c.excerpt.includes('unsaved')));
 assert.ok(out.every(c=>c.file.startsWith('src/')),out.map(c=>c.file).join(','));
 const excluded=await retrieve('login session',null,['src/login.js']);assert.ok(!excluded.some(c=>c.file==='src/login.js'));
 const ctl=new AbortController();ctl.abort();assert.deepStrictEqual(await retrieve('login',ctl.signal),[]);
 console.log('router-retrieve: ALL PASS (unsaved text, ignore/exclude rules, workspace boundaries, explicit context, cancellation)');
 }catch(e){console.error(e.stack);process.exitCode=1;}finally{fs.rmSync(dir,{recursive:true,force:true});}})();
