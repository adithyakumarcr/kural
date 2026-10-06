// Router policy and local protocols: no real models, credentials or editor processes.
const assert=require('assert');
const {ModelRouter,ASSISTANTS}=require('../extension/lib/router');
const {LocalRouterClient,loopback,cosine,SEEDS,LABELS}=require('../extension/lib/router/client');
const {eligible,classify,select,traits,contextWithinBudget,effortFor,limitUsed,profileOf}=require('../extension/lib/router/policy');
const {RouterMemory,similarity,words}=require('../extension/lib/router/learn');
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
   // Every example of a label points the same way (one direction per label: search, explain … complex).
   const index=SEEDS.findIndex(seed=>seed[1]===s);
   if(index>=0)return Array.from({length:LABELS.length},(_,i)=>i===LABELS.indexOf(SEEDS[index][0])?1:0);
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
  assert.strictEqual(calls[0].body.input.length,SEEDS.length+1);assert.strictEqual(calls[1].body.input.length,1);
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
 await check('profiles are Cost, Balance and Intelligence; the old names still work',()=>{
  assert.deepStrictEqual(['speed','balanced','quality','cost','nonsense',undefined].map(profileOf),['cost','balance','intelligence','cost','balance','balance']);
  assert.strictEqual(effortFor({complexity:'complex'},'quality'),'max');assert.strictEqual(effortFor({complexity:'standard'},'cost'),'low');
  const schema=require('../extension/package.json').contributes.configuration.properties['kural.modelRouter.profile'];
  assert.deepStrictEqual(schema.enum,['balance','cost','intelligence']);assert.strictEqual(schema.default,'balance');
  assert.strictEqual(make({'modelRouter.profile':'quality','modelRouter.tab':true}).tabEngine({localModel:'qwen2.5-coder:1.5b-base',claudeModel:'haiku',localReady:true,claudeReady:true}),'claude');
 });
 await check('usage limits: a model past half its limit is avoided, most under Cost; at 98 % it is skipped',()=>{
  const two=[{id:'sonnet',label:'Sonnet',provider:'Claude',providerId:'claude',ready:true},{id:'codex:gpt',label:'GPT',provider:'ChatGPT',providerId:'codex',ready:true}];
  const req={prompt:'add a feature with tests',current:'sonnet'};
  assert.strictEqual(select(two,{...req,profile:'balance'},{}).model,'sonnet');                      // no usage known: stays
  const busy=[{...two[0],limitUsed:90},two[1]];
  const cost=select(busy,{...req,profile:'cost'},{});assert.strictEqual(cost.model,'codex:gpt');assert.match(cost.reason,/Sonnet avoided: 90% of its limit used/);
  // Intelligence: capability first; a busier but stronger model still wins (equal ones: the less used).
  assert.strictEqual(select([{id:'opus',label:'Opus',provider:'Claude',providerId:'claude',ready:true,limitUsed:90},two[1]],{...req,profile:'intelligence'},{}).model,'opus');
  const full=select([{...two[0],limitUsed:99},two[1]],{...req,profile:'intelligence'},{});
  assert.strictEqual(full.model,'codex:gpt');assert.match(full.reason,/skipped Claude \(limit nearly reached\)/);
  assert.strictEqual(select([{...two[0],limitUsed:99}],req,{}).model,'sonnet');                      // the only one: still used
 });
 await check('limitUsed: the fullest general window, and a model\'s own weekly window only for that model',()=>{
  const report={windows:[{id:'five_hour',usedPercent:20},{id:'seven_day',usedPercent:40},{id:'seven_day_opus',usedPercent:95}]};
  assert.strictEqual(limitUsed({id:'opus'},report),95);assert.strictEqual(limitUsed({id:'sonnet'},report),40);
  assert.strictEqual(limitUsed({id:'haiku'},null),null);assert.strictEqual(limitUsed({id:'x'},{windows:[]}),null);
  const r=make();r.usageOf=(p)=>p==='claude'?report:null;
  return r.availableModels().then(list=>{assert.strictEqual(list.find(m=>m.id==='opus').limitUsed,95);assert.ok(!('limitUsed' in list.find(m=>m.id==='agy:flash')));});
 });
 await check('switching costs more the longer the conversation: a long chat stays on its model',()=>{
  // A simple request after Sonnet: Haiku suits it (faster), unless the conversation is long.
  const req={prompt:'rename x',current:'sonnet',profile:'balance'},claude=models.filter(m=>m.providerId==='claude');
  const short=select(claude,{...req,historyChars:0},{}),long=select(claude,{...req,historyChars:80000},{});
  assert.strictEqual(short.model,'haiku');assert.strictEqual(long.model,'sonnet');assert.match(long.reason,/stayed on the current model/);
  // Never below the task's floor: a complex task still leaves a small model, however long the chat.
  const hard=select(models,{prompt:'design a distributed architecture',current:'haiku',profile:'balance',historyChars:500000},{});
  assert.strictEqual(hard.model,'opus');
 });
 await check('attached context counts: many files or much text make it bigger, error output makes it a review',()=>{
  assert.strictEqual(classify('update these').complexity,'standard');
  // A tiny question isn't normal-sized work ("whats 2+2" went to Opus in a long chat); a short edit still is.
  assert.strictEqual(classify('whats 2+2').complexity,'simple');assert.strictEqual(classify("what's 2+2").intent,'explain');
  assert.strictEqual(classify('fix it').complexity,'standard');
  assert.strictEqual(select(models.filter(m=>m.providerId==='claude'),{prompt:'whats 2+2',current:'opus',profile:'balance',historyChars:400000},{}).model,'haiku');
  assert.strictEqual(classify('update these',{files:4}).complexity,'complex');
  assert.strictEqual(classify('rename x',{files:4}).complexity,'standard');
  assert.strictEqual(classify('rename x',{files:9}).complexity,'complex');
  const t=classify('this happens:\nTypeError: Cannot read properties of undefined\n    at load (src/app.js:12:5)');
  assert.strictEqual(t.intent,'review');assert.ok(t.signals.includes('error output'));
  assert.strictEqual(classify('make this bigger',{elements:1}).intent,'edit');
  assert.strictEqual(classify('Rename architecture.md to design.md').complexity,'simple');   // a file name isn't the task
  assert.match(select(models,{prompt:'update these',context:{files:5},current:'haiku'},{},classify('update these',{files:5})).reason,/5 files attached/);
 });
 await check('Auto learns: a model you picked instead leans similar requests its way; undone answers lean away',()=>{
  let saved=null;const mem=new RouterMemory(()=>[],(v)=>saved=v),now=Date.now();
  assert.ok(similarity(words('add a login page with tests'),words('add the login page and its tests'))>.5);
  assert.ok(!mem.record('better',{prompt:'hi',model:'haiku',better:'opus'}));                // too few words to learn from
  assert.ok(mem.record('better',{prompt:'refactor the payment module into services',model:'haiku',better:'opus'},now));
  assert.strictEqual(saved.length,1);
  const near=mem.advise('refactor the payment module into smaller services',now).lean;
  assert.ok(near.opus>0&&near.haiku<0);assert.deepStrictEqual(mem.advise('what time is it in tokyo',now).lean,{});
  const d=select(models,{prompt:'refactor the payment module into smaller services',current:'haiku',learned:near},{});
  assert.strictEqual(d.model,'opus');assert.match(d.reason,/you chose a stronger model/);
  // Undone after carrying on: "bad" replaces "good" for that answer; old lessons fade.
  mem.record('good',{prompt:'write the csv export function',model:'sonnet'},now);mem.record('bad',{prompt:'write the csv export function',model:'sonnet'},now);
  assert.strictEqual(mem.items.filter(e=>e.model==='sonnet').length,1);assert.ok(mem.advise('write the csv export function',now).lean.sonnet<0);
  const later=mem.advise('write the csv export function',now+180*86400000).lean.sonnet;assert.ok(later<0&&later>-.05);
  const reloaded=new RouterMemory(()=>[...saved,{kind:'bogus'}]);assert.strictEqual(reloaded.items.length,saved.length);
  mem.forget();assert.deepStrictEqual(saved,[]);
 });
 await check('the router uses what it learned (not at a checkpoint)',async()=>{
  const r=make();r.memory=new RouterMemory();r.memory.record('better',{prompt:'refactor the payment module into services',model:'haiku',better:'opus'});
  assert.strictEqual((await r.route({prompt:'refactor the payment module into services',current:'haiku'})).model,'opus');
  assert.strictEqual((await r.route({prompt:'refactor the payment module into services',current:'haiku',provider:'claude',checkpoint:true})).model,'sonnet');
 });
 await check('MiniLM keeps the half it is sure of; explicit words beat its guesses',async()=>{
  // search+simple vector, but equally close to standard and complex too: only the intent is sure.
  const t=transport({vector:()=>[1,0,0,0,0,1,1,1]}),c=new LocalRouterClient(t.fetch);
  assert.deepStrictEqual((await c.classify('which module keeps sessions',local)).task,{intent:'search'});
  const r=make({'modelRouter.assistant':'minilm'},transport({vector:()=>[0,0,0,0,1,1,0,0]}).fetch);   // MiniLM: other/simple
  const guess=await r.route({prompt:'which module keeps who is signed in',current:'sonnet'});
  assert.strictEqual(guess.source,'minilm');assert.strictEqual(guess.intent,'other');                // Native only guessed "other" too
  const explicit=await r.route({prompt:'implement retry handling for the client',current:'sonnet'});
  assert.strictEqual(explicit.intent,'edit');                                                         // "implement" wins over MiniLM's "other"
 });
 console.log(`router: ${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
})();
