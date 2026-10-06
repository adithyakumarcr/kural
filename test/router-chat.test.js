// Actual chat dispatch/checkpoint methods with stand-in providers; no CLI starts or editor shutdown.
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),Module=require('module');
const load=Module._load;
const vscode={workspace:{isTrusted:true,workspaceFolders:[],textDocuments:[],getConfiguration:()=>({get:(_,d)=>d})},env:{appRoot:'/unused'},commands:{executeCommand:()=>{}},Uri:{file:(file)=>({scheme:'file',fsPath:file})}};
const proxy=new Proxy(vscode,{get:(o,k)=>o[k]||new Proxy(function(){},{get:()=>()=>{}})});
Module._load=function(r,...args){return r==='vscode'?proxy:load.call(this,r,...args);};
const {ChatView}=require('../extension/lib/chat');
const {Attachments}=require('../extension/lib/chat/attachments');
const {LocalAgent}=require('../extension/lib/ai/engine');
const {ChatArchive}=require('../extension/lib/chat/archive');
const brain=require('../extension/lib/ai');
const {ModelRouter}=require('../extension/lib/router');
brain.providerOf=(model)=>({ready:()=>true,label:model,id:brain.engineOf(model)});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kural-router-chat-'));
let passed=0,failed=0;
const check=async(name,fn)=>{try{await fn();passed++;console.log('ok  ',name);}catch(e){failed++;console.error('FAIL',name,e.stack);}};
function fixture(model='haiku') {
 const tab={id:'chat',title:'Example',status:'idle',model,mode:'ask',effort:'medium',autoRoute:true,routingProfile:'balanced',team:0,messages:[],engine:brain.engineOf(model),started:true};
 const chat=Object.create(ChatView.prototype),posted=[],sent=[];let kills=0;
 Object.assign(chat,{tabs:[tab],routingJobs:new Map(),runtime:new Map(),localReady:new Map(),attachments:new Attachments(),
  post:(m)=>posted.push(m),postTabs:()=>{},save:()=>{},remember:()=>{},isReady:()=>true,teamSize:()=>0,teamLabel:()=>null,endDevice:()=>{},
  buildPrompt:async(text)=>`PROJECT INSTRUCTIONS\n${text}`,prepareLocal:async()=>({ok:true}),procKey:(t)=>t.model,
  router:{options:()=>({context:false,checkpoints:true,handoffChars:120000}),route:async()=>({model:'codex:test',source:'native',ms:.1})},
  startProc:(t)=>{const r={proc:{send:(s)=>sent.push(s),kill:()=>kills++,setModel:()=>{},request:async()=>({}),opts:{}},procKey:t.model,agents:new Map(),perms:new Map(),tasks:new Map()};chat.runtime.set(t.id,r);return r;},
 });
 return {chat,tab,posted,sent,kills:()=>kills};
}
(async()=>{
 await check('legacy 0.5B Tab configuration uses 1.5B for actual suggestions and is absent from the picker',async()=>{
  const {LocalEngine,LOCAL_MODELS}=require('../extension/lib/tab/local');
  const fetchBefore=globalThis.fetch,configBefore=vscode.workspace.getConfiguration,requests=[];
  vscode.workspace.getConfiguration=()=>({get:(k,d)=>k==='tabCompletion.localModel'?'qwen2.5-coder:0.5b-base':d});
  globalThis.fetch=async(url,args={})=>{
   const body=args.body?JSON.parse(args.body):null;requests.push({url,body});
   return {ok:true,json:async()=>url.endsWith('/api/tags')?{models:[{name:'qwen2.5-coder:1.5b-base'}]}:{response:'42;',done:true}};
  };
  try{
   assert.ok(!LOCAL_MODELS.some(m=>/0\.5b/i.test(m.id)));assert.strictEqual(LOCAL_MODELS[0].id,'qwen2.5-coder:1.5b-base');
   const local=new LocalEngine();assert.ok(await local.ready());assert.strictEqual(await local.complete('return ', '}', null, true),'42;');
   assert.ok(requests.filter(r=>r.body).every(r=>r.body.model==='qwen2.5-coder:1.5b-base'));
   const count=requests.length;await local.pull('qwen2.5-coder:0.5b-base');assert.strictEqual(requests.length,count);
  }finally{globalThis.fetch=fetchBefore;vscode.workspace.getConfiguration=configBefore;}
 });
 await check('provider handoff sends full recorded constraints, context and completed tool results',async()=>{
  const f=fixture();f.tab.messages=[{role:'user',segments:[{t:'text',v:'Never deploy'}],sentText:'original source and constraints'},
   {role:'assistant',model:'haiku',blocks:[{k:'text',text:'Edited login.js'}],journal:{tools:[{id:'t1',name:'Edit',status:'complete',result:'edit applied'}]}}];
  const old=f.chat.startProc(f.tab);
  await f.chat.send(f.tab,[{t:'text',v:'Continue with tests'}],[]);
  assert.strictEqual(f.kills(),1);assert.strictEqual(old.stale,true);assert.strictEqual(f.sent.length,1);
  for(const text of ['Never deploy','original source and constraints','edit applied','PROJECT INSTRUCTIONS','Continue with tests'])assert.ok(f.sent[0].includes(text));
  const reply=f.tab.messages.at(-1);assert.strictEqual(reply.model,'codex:test');assert.deepStrictEqual(reply.models,['codex:test']);assert.strictEqual(f.tab.model,'codex:test');
  assert.ok(!f.tab.messages.at(-2).sentText.includes('kural_handoff'),'avoid quadratic carry-over records');
 });
 await check('handoff reattaches image bytes without duplicating attachment metadata',async()=>{
  const f=fixture();const file=path.join(dir,'image.png');fs.writeFileSync(file,'image bytes');
  f.tab.messages=[{role:'user',segments:[],attachments:[{name:'image.png',path:file,kind:'image'}]},{role:'assistant',blocks:[{k:'text',text:'I saw it'}]}];
  await f.chat.send(f.tab,[{t:'text',v:'Use the image'}],[]);
  assert.ok(Array.isArray(f.sent[0]));assert.strictEqual(f.sent[0].find(b=>b.type==='image').source.data,Buffer.from('image bytes').toString('base64'));
  assert.strictEqual(f.tab.messages.at(-2).attachments,undefined);
 });
 await check('oversized or missing-attachment handoffs do not dispatch or discard history',async()=>{
  for(const missing of [false,true]){
   const f=fixture();f.tab.messages=[{role:'user',segments:[{t:'text',v:'old context'}],attachments:missing?[{kind:'image',path:path.join(dir,'gone.png')}]:[]}];
   if(!missing)f.chat.router.options=()=>({handoffChars:1});
   await f.chat.send(f.tab,[{t:'text',v:'Continue'}],[]);
   assert.strictEqual(f.sent.length,0);assert.strictEqual(f.tab.messages.length,1);assert.strictEqual(f.tab.status,'idle');assert.strictEqual(f.tab.model,'haiku');assert.ok(f.posted.some(m=>m.type==='flash'));
  }
 });
 await check('Stop during model selection dispatches nothing and leaves no running state',async()=>{
  const f=fixture();let resolve;f.chat.router.route=()=>new Promise(r=>resolve=r);
  const pending=f.chat.send(f.tab,[{t:'text',v:'find config'}],[]);
  assert.strictEqual(f.tab.routingState,'Choosing model…');f.chat.forceStop(f.tab);
  resolve({model:'codex:test'});await pending;
  assert.strictEqual(f.sent.length,0);assert.strictEqual(f.tab.status,'idle');assert.strictEqual(f.tab.model,'haiku');assert.strictEqual(f.chat.routingJobs.size,0);
 });
 await check('late selection cannot override a manual model choice',async()=>{
  const f=fixture();let resolve;f.chat.router.route=()=>new Promise(r=>resolve=r);
  const pending=f.chat.send(f.tab,[{t:'text',v:'explain'}],[]);
  f.tab.autoRoute=false;f.tab.model='opus';resolve({model:'codex:test'});await pending;
  assert.strictEqual(f.tab.model,'opus');assert.strictEqual(f.sent.length,0);
 });
 await check('late cancelled routing cannot reset a newer running answer',async()=>{
  const f=fixture();let resolve,calls=0;f.chat.router.route=()=>++calls===1?new Promise(r=>resolve=r):Promise.resolve({model:'codex:test',source:'native'});
  const old=f.chat.send(f.tab,[{t:'text',v:'old prompt'}],[]);f.chat.forceStop(f.tab);
  await f.chat.send(f.tab,[{t:'text',v:'new prompt'}],[]);assert.strictEqual(f.tab.status,'running');
  resolve({model:'haiku'});await old;assert.strictEqual(f.tab.status,'running');assert.strictEqual(f.sent.length,1);
 });
 await check('native Claude checkpoint requires acknowledgement and preserves session',async()=>{
  const f=fixture();const r=f.chat.startProc(f.tab);r.turn={ask:'fix function',switches:0,reply:{running:true,models:['haiku']},journal:{tools:[{status:'failed',result:'test failed'}]}};
  f.chat.router=new ModelRouter({},()=>({get:(_,d)=>d}),()=>['haiku','sonnet','opus'].map(id=>({id,label:id,providerId:'claude',ready:true,commands:true})));
  let request;r.proc.request=async(value)=>{request=value;return {};};
  await f.chat.routingCheckpoint(f.tab,r);
  assert.deepStrictEqual(request,{subtype:'set_model',model:'sonnet'});assert.strictEqual(f.tab.model,'sonnet');assert.strictEqual(f.kills(),0);assert.deepStrictEqual(r.turn.reply.models,['haiku','sonnet']);assert.strictEqual(r.turn.switches,1);
 });
 await check('failed acknowledgement, permissions and permission-denied tools prevent escalation',async()=>{
  for(const reason of ['ack','pending','declined']){
   const f=fixture(),r=f.chat.startProc(f.tab);r.turn={ask:'fix',switches:0,reply:{running:true,models:['haiku']},journal:{tools:[{status:'failed',result:reason==='declined'?'Permission denied':'test failed'}]}};
   f.chat.router.route=async()=>({model:'sonnet',source:'native'});r.proc.request=async()=>null;if(reason==='pending')r.perms.set('p',()=>{});
   await f.chat.routingCheckpoint(f.tab,r);assert.strictEqual(f.tab.model,'haiku');assert.strictEqual(r.turn.switches,0);
  }
 });
 await check('late checkpoint acknowledgement cannot overwrite manual model selection',async()=>{
  const f=fixture(),r=f.chat.startProc(f.tab);r.turn={ask:'fix',switches:0,reply:{running:true,models:['haiku']},journal:{tools:[{status:'failed',result:'test failed'}]}};
  f.chat.router.route=async()=>({model:'sonnet',source:'native'});let acknowledge;
  r.proc.request=()=>new Promise(resolve=>acknowledge=resolve);
  const pending=f.chat.routingCheckpoint(f.tab,r);await new Promise(resolve=>setImmediate(resolve));
  f.tab.autoRoute=false;f.tab.model='opus';acknowledge({});await pending;assert.strictEqual(f.tab.model,'opus');
 });
 await check('local checkpoint changes the next request model and retains native tool history exactly once',async()=>{
  const seen=[];const agent=new LocalAgent({model:'small',cwd:dir},{onMessage:()=>{},onCheckpoint:async()=>agent.setModel('large')});
  agent.history.push({role:'user',content:'read a file'});
  agent.chat=async()=>{seen.push({model:agent.model,history:JSON.parse(JSON.stringify(agent.history))});return seen.length===1?{tool_calls:[{function:{name:'Read',arguments:{file_path:'a.js'}}}]}:{content:'done'};};
  agent.use=async()=>({text:'file contents',error:false});const result=await agent.turn();
  assert.strictEqual(result.is_error,false);assert.deepStrictEqual(seen.map(s=>s.model),['small','large']);
  assert.strictEqual(seen[1].history.filter(m=>m.role==='tool').length,1);assert.strictEqual(seen[1].history[0].content,'read a file');assert.strictEqual(seen[1].history.at(-1).content,'file contents');
 });
 await check('Auto profile and model changes persist even without a new message',()=>{
  const a=new ChatArchive(path.join(dir,'archive')),f=fixture();f.tab.messages=[{role:'user',segments:[]}];f.tab.updatedAt=1;
  assert.strictEqual(a.save(f.tab,{}),true);f.tab.routingProfile='quality';assert.strictEqual(a.save(f.tab,{}),true);assert.strictEqual(a.read('chat').routingProfile,'quality');
 });
 await check('Auto Tab uses policy without helper inference and invalidates suggestions when restrictions change',async()=>{
  const values={'tabCompletion.enabled':true,'tabCompletion.engine':'auto','tabCompletion.localModel':'small','tabCompletion.model':'haiku','modelRouter.tab':true,'modelRouter.profile':'quality'};
  vscode.workspace.getConfiguration=()=>({get:(k,d)=>Object.hasOwn(values,k)?values[k]:d});vscode.workspace.asRelativePath=()=> 'test.js';
  vscode.InlineCompletionTriggerKind={Automatic:0};vscode.Range=class{constructor(start,end){this.start=start;this.end=end;}};vscode.InlineCompletionItem=class{constructor(text){this.insertText=text;}};
  require('../extension/lib/ai/claude').isSetUp=()=>true;
  const router=new ModelRouter({},()=>vscode.workspace.getConfiguration(),()=>[]);let cloud=0,local=0,resolve;
  const session={ask:async()=>{cloud++;return '<insert>1</insert>';}};
  const provider=require('../extension/lib/tab/completion').completionProvider(session,{busy:()=>false},()=>{}, {ready:async()=>true,complete:async()=>{local++;return '2';}},null,router);
  const position={line:0,character:10},doc={uri:{scheme:'file',toString:()=>'/test.js'},version:1,languageId:'javascript',offsetAt:()=>10,getText:(range)=>range?'':'const n = ',lineAt:()=>({text:'const n = ',range:{end:position}})};
  const token={isCancellationRequested:false,onCancellationRequested:()=>({dispose:()=>{}})};
  assert.strictEqual((await provider.provideInlineCompletionItems(doc,position,{triggerKind:1},token)).length,1);assert.strictEqual(cloud,1);assert.strictEqual(local,0);
  values['modelRouter.allowedModels']=[];assert.deepStrictEqual(await provider.provideInlineCompletionItems(doc,position,{triggerKind:1},token),[]);assert.strictEqual(cloud,1);
  values['modelRouter.allowedModels']=null;session.ask=()=>{cloud++;return new Promise(r=>resolve=r);};
  const pending=provider.provideInlineCompletionItems(doc,position,{triggerKind:1},token);await new Promise(r=>setImmediate(r));values['modelRouter.allowCloud']=false;resolve('<insert>3</insert>');
  assert.deepStrictEqual(await pending,[]);assert.strictEqual(router.usage.calls,0);
 });
 await check('Auto learns from what you do next: carrying on, picking another model, undoing every change',async()=>{
  const {RouterMemory}=require('../extension/lib/router/learn');
  const routed=(ask,model)=>[{role:'user',segments:[{t:'text',v:ask}]},{role:'assistant',model,routing:{model,source:'native'},blocks:[{k:'text',text:'done'}],changes:[{id:'c1',state:'pending'},{id:'c2',state:'pending'}]}];
  // Carried on with the next message: "good".
  let f=fixture();f.chat.router.memory=new RouterMemory();f.tab.messages=routed('refactor the payment module into services','haiku');
  await f.chat.send(f.tab,[{t:'text',v:'now add tests'}],[]);
  assert.deepStrictEqual(f.chat.router.memory.items.map(e=>[e.kind,e.model]),[['good','haiku']]);assert.strictEqual(f.tab.messages[1].routingJudged,'good');
  // Picked another model right after: "better" (once; a second pick doesn't count again).
  f=fixture();f.chat.router.memory=new RouterMemory();f.chat.warm=()=>{};f.chat.tab=()=>f.tab;f.tab.messages=routed('refactor the payment module into services','haiku');
  await f.chat.handle({type:'setModel',tabId:'chat',model:'opus'});
  assert.deepStrictEqual(f.chat.router.memory.items.map(e=>[e.kind,e.model,e.better]),[['better','haiku','opus']]);assert.strictEqual(f.tab.autoRoute,false);
  // Undid every change of an Auto answer: "bad", even after carrying on ("good" is replaced); one undone of two isn't.
  f=fixture();f.chat.router.memory=new RouterMemory();f.chat.changes={undo:async()=>true,keep:()=>{}};f.tab.messages=routed('write the csv export function','sonnet');
  f.tab.messages[1].routingJudged='good';f.chat.router.memory.record('good',{prompt:'write the csv export function',model:'sonnet'});
  await f.chat.onChangeAction(f.tab,{msgIndex:1,id:'c1',action:'undo'});assert.strictEqual(f.chat.router.memory.items[0].kind,'good');
  await f.chat.onChangeAction(f.tab,{msgIndex:1,id:'c2',action:'undo'});
  assert.deepStrictEqual(f.chat.router.memory.items.map(e=>[e.kind,e.model]),[['bad','sonnet']]);
 });
 await check('routing request carries attached context and conversation size, not the open file',()=>{
  const file=path.join(dir,'big.js');fs.writeFileSync(file,'x'.repeat(50000));
  const ctx=ChatView.routingContext([{kind:'current',path:file},{kind:'file',path:file},{kind:'selection',code:'abc'},{kind:'element'}],[{kind:'image',path:file},{kind:'text',path:file}]);
  assert.deepStrictEqual(ctx,{files:3,chars:100003,elements:1});
  const f=fixture();f.tab.messages=[{role:'user',segments:[{t:'text',v:'hello'}]},{role:'assistant',blocks:[{k:'text',text:'hi there'}]}];
  const req=f.chat.routingRequest(f.tab,'next',[],[]);assert.strictEqual(req.historyChars,13);assert.deepStrictEqual(req.context,{files:0,chars:0,elements:0});
 });
 const html=require('../extension/lib/router/panel')._page('testnonce');new Function(html.split('<script nonce="testnonce">')[1].split('</script>')[0]);
 console.log(`router-chat: ${passed} passed, ${failed} failed; panel script parses`);fs.rmSync(dir,{recursive:true,force:true});process.exitCode=failed?1:0;
})();
