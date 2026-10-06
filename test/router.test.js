// Router policy and local protocols: no real models, credentials or editor processes.
const assert=require('assert');
const {ModelRouter,ASSISTANTS}=require('../extension/lib/router');
const {LocalRouterClient,loopback,cosine,SEEDS}=require('../extension/lib/router/client');
const {eligible,classify,select,traits,contextWithinBudget,effortFor}=require('../extension/lib/router/policy');
const {record,canCheckpoint,handoff}=require('../extension/lib/router/journal');
const {excludedModel,completionModel}=require('../extension/lib/ai/model-policy');
let passed=0,failed=0;
const check=async(name,fn)=>{try{await fn();passed++;console.log('ok  ',name);}catch(e){failed++;console.error('FAIL',name,e.stack);}};
const models=[
 {id:'haiku',label:'Haiku',ready:true,providerId:'claude',team:true,device:true,images:true,pdf:true,commands:true,connectors:true},
 {id:'sonnet',label:'Sonnet',ready:true,providerId:'claude',team:true,device:true,images:true,pdf:true,commands:true,connectors:true},
 {id:'opus',label:'Opus',ready:true,providerId:'claude',team:true,device:true,images:true,pdf:true,commands:true,connectors:true},
 {id:'agy:flash',label:'Gemini Flash',ready:true,providerId:'agy',images:true},
 {id:'ollama:qwen3:8b',label:'Qwen 8B',ready:true,providerId:'ollama',local:true,commands:true},
 {id:'codex:missing',label:'Missing',ready:false,providerId:'codex',commands:true},
];
const json=(data)=>({ok:true,json:async()=>data});
function transport(opts={}) {
 const requests=[];
 const fetch=async(url,args={})=>{
  const body=args.body?JSON.parse(args.body):null;requests.push({url,args,body});
  if(opts.respond){const out=await opts.respond(url,body,args);if(out)return out;}
  if(url.endsWith('/api/tags'))return json({models:opts.tags||['all-minilm:22m'].map(name=>({name}))});
  if(url.endsWith('/api/show'))return json({capabilities:opts.caps||['embedding']});
  if(url.endsWith('/api/embed'))return json({embeddings:body.input.map(s=>{
   const index=SEEDS.findIndex(seed=>seed[1]===s);
   if(index>=0)return Array.from({length:8},(_,i)=>i===index?1:0);
   return opts.vector?opts.vector(s):[1,0,0,0,0,1,0,0];
  }),prompt_eval_count:30});
  throw new Error('Unexpected endpoint');
 };
 return {fetch,requests};
}
function make(values={},fetch=async()=>{throw new Error('Native must not fetch');},trusted=true) {
 return new ModelRouter({secrets:{get:()=>{throw new Error('No routing secrets');}}},()=>({get:(k,d)=>Object.hasOwn(values,k)?values[k]:d}),()=>models,()=>trusted,fetch);
}
const local={assistant:'minilm',url:'http://127.0.0.1:11434',timeoutMs:1000,minSimilarity:.25,minMargin:.04};
(async()=>{
 await check('Qwen 0.5B is excluded from helpers and dispatch, including legacy Tab settings',async()=>{
  for(const model of ['qwen2.5-coder:0.5b-base','ollama:qwen2.5-coder:0.5b','QWEN2.5:0.5B:latest'])assert.ok(excludedModel(model));
  for(const model of ['qwen3:0.6b','qwen2.5-coder:1.5b-base','qwen3:30.5b'])assert.ok(!excludedModel(model));
  assert.strictEqual(completionModel('qwen2.5-coder:0.5b-base'),'qwen2.5-coder:1.5b-base');
  assert.strictEqual(completionModel(undefined),'qwen2.5-coder:1.5b-base');
  assert.strictEqual(completionModel('qwen2.5-coder:3b-base'),'qwen2.5-coder:3b-base');
  const forbidden={id:'ollama:qwen2.5:0.5b',ready:true,local:true,providerId:'ollama'};
  assert.deepStrictEqual(eligible([forbidden],{},{}),[]);
  const t=transport(),r=make({'modelRouter.assistant':'tab','tabCompletion.localModel':'qwen2.5-coder:0.5b-base','modelRouter.tab':true},t.fetch);
  assert.strictEqual((await r.route({prompt:'find config'})).source,'native');assert.strictEqual(r.lastAssistant,null);assert.strictEqual(t.requests.length,0);
  assert.strictEqual(r.tabEngine({localModel:'qwen2.5-coder:0.5b-base',localReady:true,claudeReady:false}),'none');
 });
 await check('native mode performs no network or credential reads',async()=>{
  const r=make();const d=await r.route({prompt:'where are settings stored',current:'sonnet'});
  assert.strictEqual(d.source,'native');assert.strictEqual(d.model,'haiku');assert.strictEqual(r.usage.calls,0);
 });
 await check('native profiles choose different quality floors',()=>{
  const req={prompt:'design a distributed architecture across multiple modules',current:'sonnet'};
  assert.strictEqual(select(models,{...req,profile:'balanced'},{}).model,'opus');
  assert.strictEqual(select(models,{...req,profile:'speed'},{}).model,'sonnet');
  assert.strictEqual(select(models,{prompt:'rename a variable',profile:'quality'},{}).model,'opus');
 });
 await check('short follow-up requests retain the recent task context for routing',async()=>{
  const r=make();const d=await r.route({prompt:'Go ahead',current:'haiku',recentContext:'User: Design a distributed architecture across modules'});
  assert.strictEqual(d.complexity,'complex');assert.strictEqual(d.model,'opus');
 });
 await check('user ratings and token preference change choices within capability requirements',()=>{
  const prefs={'haiku':{speed:1,tokens:3},'agy:flash':{speed:2,tokens:1}};
  const req={prompt:'find config',current:'haiku'};
  assert.strictEqual(select(models,req,{modelPreferences:prefs,allowedModels:['haiku','agy:flash']}).model,'agy:flash');
  assert.strictEqual(select(models,req,{modelPreferences:prefs,allowedModels:['haiku','agy:flash'],saveTokens:true}).model,'haiku');
  assert.strictEqual(traits(models[0],{'haiku':{quality:999}}).quality,1);
 });
 await check('eligibility excludes unavailable, empty allowlists and incompatible capabilities',()=>{
  assert.deepStrictEqual(eligible(models,{}, {allowedModels:['opus','codex:missing']}).map(m=>m.id),['opus']);
  assert.deepStrictEqual(eligible(models,{}, {allowedModels:[]}),[]);
  assert.ok(select([],{},{}).error);
  assert.deepStrictEqual(eligible(models,{images:true,pdf:true,team:true,device:true,connectors:true},{}).map(m=>m.id),['haiku','sonnet','opus']);
  assert.ok(!eligible(models,{mode:'agent',editing:true},{}).some(m=>m.providerId==='agy'));
 });
 await check('local-only limits answering models without disabling local helpers',async()=>{
  const t=transport();const r=make({'modelRouter.assistant':'minilm','modelRouter.allowCloud':false},t.fetch);
  assert.strictEqual((await r.route({current:'sonnet'})).model,'ollama:qwen3:8b');assert.strictEqual(t.requests.length,0);
 });
 await check('failed-step policy stays in provider and escalates without helper inference',async()=>{
  const r=make({'modelRouter.assistant':'minilm'});
  const out=await r.route({prompt:'rename variable',current:'haiku',provider:'claude',checkpoint:true});
  assert.strictEqual(out.model,'sonnet');assert.strictEqual(out.source,'native');
 });
 await check('local transport rejects non-loopback addresses and redirects',async()=>{
  for(const url of ['https://api.typesafe.ai','http://192.168.1.2:11434','http://localhost.evil:11434','http://user:pass@localhost','file:///tmp/x','http://localhost/path'])assert.throws(()=>loopback(url));
  assert.strictEqual(loopback('http://[::1]:11434'),'http://[::1]:11434');
  const t=transport();await new LocalRouterClient(t.fetch).classify('find config',local);
  assert.ok(t.requests.every(r=>r.url.startsWith('http://127.0.0.1:11434/')&&r.args.redirect==='error'));
  assert.ok(t.requests.every(r=>!r.args.headers||!r.args.headers.Authorization));
 });
 await check('Restricted Mode uses native routing and makes no helper calls',async()=>{
  let calls=0;const r=make({'modelRouter.assistant':'minilm'},async()=>{calls++;},false);
  assert.strictEqual((await r.route({prompt:'find config',current:'haiku'})).source,'native');assert.strictEqual(calls,0);
 });
 await check('MiniLM only labels tasks; answering models remain governed by native policy',async()=>{
  const t=transport({vector:()=>[0,0,1,0,0,0,0,1]});
  const r=make({'modelRouter.assistant':'minilm','modelRouter.allowedModels':['haiku','sonnet']},t.fetch);
  const out=await r.route({prompt:'add a feature',current:'haiku'});
  assert.strictEqual(out.model,'sonnet');assert.strictEqual(out.source,'minilm');
  assert.ok(t.requests.some(r=>r.url.endsWith('/api/embed')));
  assert.ok(t.requests.every(r=>!r.url.endsWith('/api/generate')));
 });
 await check('helpers cannot lower known nontrivial edits or reviews to a simple task',async()=>{
  const t=transport({}),r=make({'modelRouter.assistant':'minilm'},t.fetch);
  for(const prompt of ['Add a function and unit tests','Review this module for bugs']){
   const d=await r.route({prompt,current:'haiku'});assert.strictEqual(d.source,'minilm');assert.strictEqual(d.complexity,'standard');assert.strictEqual(d.model,'sonnet');
  }
  assert.strictEqual((await r.route({prompt:'Rename a variable',current:'haiku'})).complexity,'simple');
 });
 await check('only Native and MiniLM are selectable; removed helpers default safely to Native',async()=>{
  assert.deepStrictEqual(ASSISTANTS,['native','minilm']);
  const candidates=[{file:'a',excerpt:'login'},{file:'b',excerpt:'settings'}];
  for(const assistant of ['qwen','tab','unknown']){
   const t=transport(),r=make({'modelRouter.assistant':assistant},t.fetch);
   assert.strictEqual(r.options().assistant,'native');assert.ok(!Object.hasOwn(r.options(),'assistantModel'));
   assert.strictEqual((await r.route({prompt:'find config',current:'sonnet'})).source,'native');
   assert.strictEqual((await r.rank('settings',candidates)).source,'native');assert.strictEqual(t.requests.length,0);
   const client=new LocalRouterClient(t.fetch);
   await assert.rejects(client.classify('find config',{...local,assistant}),/only local router helper/);
   await assert.rejects(client.rank('settings',candidates,{...local,assistant}),/only local router helper/);
   assert.strictEqual(t.requests.length,0);
  }
  const schema=require('../extension/package.json').contributes.configuration.properties['kural.modelRouter.assistant'];
  assert.deepStrictEqual(schema.enum,ASSISTANTS);
 });

 await check('unavailable helpers fall back and cooldown prevents repeated waits',async()=>{
  const t=transport({tags:[]});const r=make({'modelRouter.assistant':'minilm'},t.fetch);
  assert.strictEqual((await r.route({prompt:'find config'})).source,'native');const calls=t.requests.length;
  await r.route({prompt:'find another config'});assert.strictEqual(t.requests.length,calls);
  r.resetAssistance();await r.route({prompt:'find other config'});assert.ok(t.requests.length>calls);
 });
 await check('cloud Ollama models cannot assist routing even through localhost',async()=>{
  for(const opts of [{tags:[{name:'all-minilm:22m',remote_host:'https://remote'}]},{caps:['completion','cloud']}]){
   const t=transport(opts);const r=make({'modelRouter.assistant':'minilm'},t.fetch);
   assert.strictEqual((await r.route({prompt:'find config'})).source,'native');assert.ok(!t.requests.some(r=>r.url.endsWith('/api/embed')));
  }
 });
 await check('deadlines include body reads and abort transports that ignore cancellation',async()=>{
  let signal;const c=new LocalRouterClient(async(_,opts)=>{signal=opts.signal;return {ok:true,json:()=>new Promise(()=>{})};});
  await assert.rejects(c.classify('x',{...local,timeoutMs:20}),/deadline/);assert.strictEqual(signal.aborted,true);
 });
 await check('Stop propagates cancellation instead of dispatching fallback work',async()=>{
  const ctl=new AbortController(),r=make({'modelRouter.assistant':'minilm'},async()=>new Promise(()=>{}));
  const pending=r.route({prompt:'fix bug'},ctl.signal);setTimeout(()=>ctl.abort(),10);
  await assert.rejects(pending,{name:'AbortError'});assert.strictEqual(r.inflight,0);
 });
 await check('local HTTP errors never expose echoed task text',async()=>{
  const c=new LocalRouterClient(async()=>({ok:false,status:500,json:()=>({error:'private prompt'})}));
  await assert.rejects(c.classify('private prompt',local),e=>e.message==='Ollama HTTP 500');
 });
 await check('MiniLM matches task prototypes and caches their vectors',async()=>{
  const t=transport(),r=make({'modelRouter.assistant':'minilm'},t.fetch);
  const d=await r.route({prompt:'locate setting',current:'sonnet'});assert.strictEqual(d.source,'minilm');assert.strictEqual(d.model,'haiku');
  await r.route({prompt:'locate preference',current:'sonnet'});
  const calls=t.requests.filter(r=>r.url.endsWith('/api/embed'));
  assert.strictEqual(calls[0].body.input.length,9);assert.strictEqual(calls[1].body.input.length,1);
 });
 await check('ambiguous MiniLM matches are not treated as calibrated confidence',async()=>{
  const t=transport({vector:()=>[1,1,1,1,1,1,1,1]});const r=make({'modelRouter.assistant':'minilm'},t.fetch);
  assert.strictEqual((await r.route({prompt:'something'})).source,'native');
 });
 await check('zero, wrong-size and non-finite embeddings are rejected',()=>{
  for(const v of [[],[0,0],[1,NaN],[1]])assert.throws(()=>cosine(v,[1,0]));
 });
 await check('known complex requests cannot be downgraded by local classifier',async()=>{
  const t=transport(),r=make({'modelRouter.assistant':'minilm'},t.fetch);
  assert.strictEqual((await r.route({prompt:'design a distributed architecture',current:'haiku'})).model,'opus');
 });
 await check('repeat classification uses bounded cache, new settings produce a new request',async()=>{
  const t=transport();const values={'modelRouter.assistant':'minilm'},r=make(values,t.fetch);
  await r.route({prompt:'find config'});const n=t.requests.length;
  await r.route({prompt:'find config'});assert.strictEqual(t.requests.length,n);
  values['modelRouter.minMargin']=.05;await r.route({prompt:'find config'});assert.ok(t.requests.length>n);
 });
 await check('cached classifications are not reused after entering Restricted Mode',async()=>{
  const t=transport(),r=make({'modelRouter.assistant':'minilm'},t.fetch);await r.route({prompt:'find config'});const calls=t.requests.length;
  r.trusted=()=>false;assert.strictEqual((await r.route({prompt:'find config'})).source,'native');assert.strictEqual(t.requests.length,calls);
 });
 await check('native ranking retains real candidate contents and optional context respects budget',async()=>{
  const r=make();const out=await r.rank('login session',[{file:'a',excerpt:'paint button'},{file:'b',excerpt:'login session store'}]);
  assert.strictEqual(out.candidates[0].file,'b');assert.strictEqual(out.candidates[0].excerpt,'login session store');
  const big={file:'big',excerpt:'x'.repeat(1000)},small={file:'small',excerpt:'useful'};
  assert.deepStrictEqual(contextWithinBudget([big,small],200),[small]);
 });
 await check('MiniLM ranking batches candidates and orders by similarity',async()=>{
  const t=transport({vector:s=>s.includes('unrelated')?[0,1]:[1,0]});const r=make({'modelRouter.assistant':'minilm'},t.fetch);
  const out=await r.rank('login',[{file:'a',excerpt:'unrelated'},{file:'b',excerpt:'login'}]);
  assert.strictEqual(out.source,'minilm');assert.strictEqual(out.candidates[0].file,'b');
  assert.strictEqual(t.requests.find(r=>r.url.endsWith('/api/embed')).body.input.length,3);
 });
 await check('malformed MiniLM ranking vectors retain original lexical candidates',async()=>{
  const candidates=[{file:'a',excerpt:'login'},{file:'b',excerpt:'settings'}];
  const t=transport({respond:async(url)=>url.endsWith('/api/embed')?json({embeddings:[[0,0]],prompt_eval_count:1}):null});
  const r=make({'modelRouter.assistant':'minilm'},t.fetch);
  const out=await r.rank('login',candidates);assert.strictEqual(out.source,'native');assert.strictEqual(out.candidates.length,2);
  assert.strictEqual(out.candidates[0].file,'a');assert.strictEqual(r.usage.fallbacks,1);
 });
 await check('Tab selection is synchronous, has no inference and enforces allowlist/cloud preference',()=>{
  const values={'modelRouter.tab':true,'modelRouter.assistant':'minilm'},r=make(values);
  const req={localModel:'small',claudeModel:'haiku',localReady:true,claudeReady:true};
  assert.strictEqual(r.tabEngine(req),'local');values['modelRouter.profile']='quality';assert.strictEqual(r.tabEngine(req),'claude');
  values['modelRouter.allowCloud']=false;assert.strictEqual(r.tabEngine(req),'local');
  values['modelRouter.allowedModels']=[];assert.strictEqual(r.tabEngine(req),'none');
 });
 await check('journal joins tool results and waits for tools, permissions and agents',()=>{
  const j={tools:[]},r={perms:new Map(),agents:new Map(),turn:{reply:{running:true},journal:j}};
  record(j,{message:{content:[{type:'tool_use',id:'t1',name:'Edit',input:{file_path:'a'}}]}});assert.strictEqual(canCheckpoint(r),false);
  record(j,{message:{content:[{type:'tool_result',tool_use_id:'t1',content:'edited'}]}});assert.strictEqual(canCheckpoint(r),true);
  assert.strictEqual(j.tools[0].result,'edited');r.perms.set('p',()=>{});assert.strictEqual(canCheckpoint(r),false);r.perms.clear();r.agents.set('a',{state:'running'});assert.strictEqual(canCheckpoint(r),false);
 });
 await check('handoff preserves constraints, sent context, attachments, tools and changes without hidden reasoning',()=>{
  const text=handoff([{role:'user',segments:[{t:'text',v:'Do not deploy'}],sentText:'old source',attachments:[{path:'photo.png',kind:'image'}]},
   {role:'assistant',model:'haiku',blocks:[{k:'text',text:'working'},{k:'think',text:'private reasoning'}],journal:{tools:[{id:'t1',status:'complete',result:'test passed'}]},changes:[{rel:'login.js'}]}]);
  for(const s of ['Do not deploy','old source','photo.png','test passed','login.js'])assert.ok(text.includes(s));assert.ok(!text.includes('private reasoning'));assert.match(text,/do not repeat/);
 });
 await check('Auto sets intensity from task size and profile',async()=>{
  const e=(c,p,s)=>effortFor({complexity:c},p,s);
  assert.deepStrictEqual(['simple','standard','complex'].map(c=>e(c,'balanced')),['low','medium','high']);
  assert.deepStrictEqual(['simple','standard','complex'].map(c=>e(c,'speed')),['low','low','medium']);
  assert.deepStrictEqual(['simple','standard','complex'].map(c=>e(c,'quality')),['medium','high','max']);
  assert.strictEqual(e('complex','balanced',{saveTokens:true}),'medium');
  assert.strictEqual(select(models,{prompt:'rename a variable',profile:'speed'},{}).effort,'low');
  assert.match(select(models,{prompt:'architect a distributed system',profile:'quality'},{}).reason,/max intensity/);
 });
 console.log(`router: ${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
})();
