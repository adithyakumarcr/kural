// Router policy and local protocols: no real models, credentials or editor processes.
const assert=require('assert');
const fs=require('fs'),os=require('os'),path=require('path');
const {ModelRouter,ASSISTANTS}=require('../extension/lib/router');
const {LocalRouterClient,loopback,cosine,HELPERS,PREFIX,EXAMPLES_HASH}=require('../extension/lib/router/client');
const {eligible,classify,select,traits,needTier,contextWithinBudget,effortFor,limitUsed,profileOf}=require('../extension/lib/router/policy');
const {RouterMemory,similarity,words}=require('../extension/lib/router/learn');
const {record,canCheckpoint,handoff}=require('../extension/lib/router/journal');
const {excludedModel,completionModel}=require('../extension/lib/ai/model-policy');
const EXAMPLES=require('../extension/lib/router/examples.json').examples;
let passed=0,failed=0;
const check=async(name,fn)=>{try{await fn();passed++;console.log('ok  ',name);}catch(e){failed++;console.error('FAIL',name,e.stack);}};
const claude=(id,label,description)=>({id,label,description,provider:'Claude',providerId:'claude',ready:true,team:true,device:true,images:true,pdf:true,commands:true,connectors:true});
const models=[
 claude('haiku','Haiku','fastest'),claude('sonnet','Sonnet','fast and smart'),claude('opus','Opus','most capable'),
 {id:'agy:flash',label:'Gemini Flash',provider:'Google Gemini',ready:true,providerId:'agy',images:true},
 {id:'ollama:qwen3:8b',label:'Qwen 8B',provider:'Ollama',ready:true,providerId:'ollama',local:true,commands:true},
 {id:'codex:missing',label:'Missing',provider:'ChatGPT (Codex)',ready:false,providerId:'codex',commands:true},
];
// Codex and Gemini as their programs describe their models (Codex's own list; Antigravity's names).
const codex=(slug,label,description)=>({id:`codex:${slug}`,label,description,provider:'ChatGPT (Codex)',providerId:'codex',ready:true,images:true,device:true,commands:true});
const gemini=(slug,label)=>({id:`agy:${slug}`,label,description:'',provider:'Google Gemini',providerId:'agy',ready:true,images:true});
const three=[...models.slice(0,3),
 codex('gpt-6-luna','GPT-6-Luna','Fast and affordable model for easier tasks.'),codex('gpt-6-sol','GPT-6-Sol','Most capable model for complex work.'),
 codex('gpt-5.6-terra','GPT-5.6-Terra','Older balanced model for straightforward work.'),codex('gpt-6-terra','GPT-6-Terra','Balanced model for everyday coding.'),
 gemini('gemini-3.8-flash','Gemini 3.8 Flash'),gemini('gemini-3.8-pro','Gemini 3.8 Pro'),
 {id:'ollama:qwen3:4b',label:'qwen3:4b',provider:'Ollama',providerId:'ollama',local:true,ready:true,commands:true}];
const json=(data)=>({ok:true,json:async()=>data});
// A stand-in Ollama. Its "embedding" of an example points at the example's size (dims 0-2) and kind (dims 3-7), so the
// centroids are known; any other text gets opts.vector(text) (default: simple + search).
const SIZES=['simple','standard','complex'],KINDS=['search','explain','edit','review','other'];
const byText=new Map(EXAMPLES.map(e=>[e[0],e]));
const hot=(size,kind)=>[...SIZES.map(s=>s===size?1:0),...KINDS.map(k=>k===kind?1:0)];
function transport(opts={}) {
 const requests=[];
 const fetch=async(url,args={})=>{
  const body=args.body?JSON.parse(args.body):null;requests.push({url,args,body});
  if(opts.respond){const out=await opts.respond(url,body,args);if(out)return out;}
  if(url.endsWith('/api/tags'))return json({models:opts.tags||Object.values(HELPERS).map(h=>({name:h.model}))});
  if(url.endsWith('/api/show'))return json({capabilities:opts.caps||['embedding']});
  if(url.endsWith('/api/embed'))return json({embeddings:body.input.map(s=>{
   const text=Object.values(PREFIX).reduce((t,p)=>t.startsWith(p)?t.slice(p.length):t,s),e=byText.get(text);
   return e?hot(e[1],e[2]):opts.vector?opts.vector(text):hot('simple','search');
  }),prompt_eval_count:30});
  throw new Error('Unexpected endpoint');
 };
 return {fetch,requests};
}
function make(values={},fetch=async()=>{throw new Error('Native must not fetch');},trusted=true,list=models) {
 return new ModelRouter({secrets:{get:()=>{throw new Error('No routing secrets');}}},()=>({get:(k,d)=>Object.hasOwn(values,k)?values[k]:d}),()=>list,()=>trusted,fetch);
}
const local={assistant:'minilm',url:'http://127.0.0.1:11434',timeoutMs:1000};
const task=(complexity,intent='edit')=>({complexity,intent});
(async()=>{
 await check('Qwen 0.5B is excluded from helpers and dispatch, including legacy Tab settings',async()=>{
  for(const model of ['qwen2.5-coder:0.5b-base','ollama:qwen2.5-coder:0.5b','QWEN2.5:0.5B:latest'])assert.ok(excludedModel(model));
  for(const model of ['qwen3:0.6b','qwen2.5-coder:1.5b-base','qwen3:30.5b'])assert.ok(!excludedModel(model));
  assert.strictEqual(completionModel('qwen2.5-coder:0.5b-base'),'qwen2.5-coder:1.5b-base');
  assert.strictEqual(completionModel(undefined),'qwen2.5-coder:1.5b-base');
  assert.strictEqual(completionModel('qwen2.5-coder:3b-base'),'qwen2.5-coder:3b-base');
  const t=transport(),r=make({'modelRouter.assistant':'tab','tabCompletion.localModel':'qwen2.5-coder:0.5b-base','modelRouter.tab':true},t.fetch);
  assert.strictEqual((await r.route({prompt:'find config'})).source,'native');assert.strictEqual(r.lastAssistant,null);assert.strictEqual(t.requests.length,0);
  assert.strictEqual(r.tabEngine({localModel:'qwen2.5-coder:0.5b-base',localReady:true,claudeReady:false}),'none');
 });
 await check('native mode performs no network or credential reads',async()=>{
  const r=make();const d=await r.route({prompt:'where are the settings stored?',current:'sonnet'});
  assert.strictEqual(d.source,'native');assert.strictEqual(d.model,'haiku');assert.strictEqual(r.usage.calls,0);
 });
 await check('the profile and the task size decide together (Cost may get Opus, Intelligence may get Sonnet)',()=>{
  const pick=(profile,t)=>select(models,{prompt:'x',current:'sonnet',profile},{},t).model;
  // Balance: what the task needs.
  assert.deepStrictEqual(['simple','standard','complex'].map(c=>pick('balance',task(c))),['haiku','sonnet','opus']);
  // Cost: light where it can, but complex work still gets the most capable; reading/explaining stays light.
  assert.deepStrictEqual(['simple','standard','complex'].map(c=>pick('cost',task(c))),['haiku','sonnet','opus']);
  assert.strictEqual(pick('cost',task('standard','explain')),'haiku');
  // Intelligence: a step up, but a quick question still goes to a cheaper model than the top one.
  assert.deepStrictEqual(['simple','standard','complex'].map(c=>pick('intelligence',task(c))),['sonnet','opus','opus']);
  assert.deepStrictEqual([['cost','simple'],['intelligence','simple'],['cost','complex']].map(([p,c])=>needTier(p,task(c))),[1,2,3]);
  assert.match(select(models,{prompt:'x',profile:'intelligence'},{},task('simple')).reason,/needs a balanced model/);
 });
 await check('models of Codex and Gemini get their level from their names and descriptions',()=>{
  const tier=(id)=>traits(three.find(m=>m.id===id)).quality;
  assert.deepStrictEqual(['codex:gpt-6-luna','codex:gpt-6-terra','codex:gpt-6-sol','agy:gemini-3.8-flash','agy:gemini-3.8-pro'].map(tier),[1,2,3,1,3]);
  assert.ok(traits(three.find(m=>m.id==='codex:gpt-5.6-terra')).legacy);
  // Only Codex and Gemini set up: Auto moves between them by task size, and an old model loses to a current one.
  const two=three.filter(m=>['codex','agy'].includes(m.providerId));
  const pick=(t,current)=>select(two,{prompt:'x',current,profile:'balance'},{},t).model;
  assert.strictEqual(pick(task('simple'),'codex:gpt-6-luna'),'codex:gpt-6-luna');
  assert.strictEqual(pick(task('standard'),'codex:gpt-6-luna'),'codex:gpt-6-terra');
  assert.strictEqual(pick(task('complex'),'agy:gemini-3.8-flash'),'agy:gemini-3.8-pro');   // stays with Gemini: equal level
  assert.strictEqual(pick(task('complex'),'codex:gpt-6-luna'),'codex:gpt-6-sol');
 });
 await check('switching between Claude, Gemini and Codex follows the task, and a long chat keeps its AI on equal terms',()=>{
  const req=(t,current,historyChars=0,profile='balance')=>select(three,{prompt:'x',current,profile,historyChars},{},t);
  assert.strictEqual(req(task('simple'),'opus').model,'haiku');                    // Claude's light model
  assert.strictEqual(req(task('simple'),'agy:gemini-3.8-pro').model,'agy:gemini-3.8-flash');
  assert.strictEqual(req(task('complex'),'codex:gpt-6-luna').model,'codex:gpt-6-sol');
  // A busy Claude: its tier-2 work goes to Codex, unless the chat is long (handing over costs more).
  const busy=three.map(m=>m.providerId==='claude'?{...m,limitUsed:75}:m);
  assert.strictEqual(select(busy,{prompt:'x',current:'sonnet',profile:'balance',historyChars:0},{},task('standard')).model,'codex:gpt-6-terra');
  const long=select(busy,{prompt:'x',current:'sonnet',profile:'balance',historyChars:80000},{},task('standard'));
  assert.strictEqual(long.model,'sonnet');assert.match(long.reason,/stayed on the current model/);
  // Never below what the task needs: a complex task leaves a light model however long the chat.
  assert.strictEqual(select(three,{prompt:'x',current:'haiku',profile:'balance',historyChars:500000},{},task('complex')).model,'opus');
 });
 await check('models on this computer are never picked by Auto',async()=>{
  for(const t of ['simple','standard','complex'])for(const p of ['cost','balance','intelligence'])
   assert.ok(!select(three,{prompt:'x',current:'ollama:qwen3:4b',profile:p},{},task(t)).model.startsWith('ollama:'));
  const only=select([three.at(-1)],{prompt:'hi'},{});assert.ok(only.error);assert.match(only.error,/Claude, Google Gemini and ChatGPT/);
  assert.ok(!eligible(three,{}).some(m=>m.local));
 });
 await check('short follow-up requests retain the recent task context for routing',async()=>{
  const r=make();const d=await r.route({prompt:'Go ahead',current:'haiku',recentContext:'User: migrate the whole project from javascript to typescript across all modules'});
  assert.strictEqual(d.complexity,'complex');assert.strictEqual(d.model,'opus');
 });
 await check('user ratings change a model\'s level',()=>{
  assert.strictEqual(traits(models[0],{'haiku':{quality:999}}).quality,1);
  assert.strictEqual(traits(models[0],{'haiku':{quality:3}}).quality,3);
  assert.strictEqual(select(models,{prompt:'x',current:'sonnet'},{modelPreferences:{haiku:{quality:3}}},task('complex')).model,'haiku');
 });
 await check('eligibility excludes unavailable models and incompatible capabilities',()=>{
  assert.deepStrictEqual(eligible(models,{}).map(m=>m.id),['haiku','sonnet','opus','agy:flash']);
  assert.ok(select([],{},{}).error);
  assert.deepStrictEqual(eligible(models,{images:true,pdf:true,team:true,device:true,connectors:true}).map(m=>m.id),['haiku','sonnet','opus']);
  assert.ok(!eligible(models,{mode:'agent',editing:true}).some(m=>m.providerId==='agy'));
  assert.deepStrictEqual(eligible(three,{provider:'codex'}).map(m=>m.id).sort(),['codex:gpt-5.6-terra','codex:gpt-6-luna','codex:gpt-6-sol','codex:gpt-6-terra']);
 });
 await check('failed-step policy stays in provider and escalates without helper inference',async()=>{
  const r=make({'modelRouter.assistant':'minilm'});
  const out=await r.route({prompt:'rename variable',current:'haiku',provider:'claude',checkpoint:true});
  assert.strictEqual(out.model,'sonnet');assert.strictEqual(out.source,'native');
 });
 await check('local transport rejects non-loopback addresses and redirects',async()=>{
  for(const url of ['https://api.typesafe.ai','http://192.168.1.2:11434','http://localhost.evil:11434','http://user:pass@localhost','file:///tmp/x','http://localhost/path'])assert.throws(()=>loopback(url));
  assert.strictEqual(loopback('http://[::1]:11434'),'http://[::1]:11434');
  const t=transport(),c=new LocalRouterClient(t.fetch);await c.prepare(local);await c.classify('find config',local);
  assert.ok(t.requests.every(r=>r.url.startsWith('http://127.0.0.1:11434/')&&r.args.redirect==='error'));
  assert.ok(t.requests.every(r=>!r.args.headers||!r.args.headers.Authorization));
 });
 await check('Restricted Mode uses native routing and makes no helper calls',async()=>{
  let calls=0;const r=make({'modelRouter.assistant':'minilm'},async()=>{calls++;},false);
  assert.strictEqual((await r.route({prompt:'find config',current:'haiku'})).source,'native');assert.strictEqual(calls,0);
  assert.strictEqual(await r.prepare(),false);assert.strictEqual(calls,0);
 });
 await check('a helper gets ready once (examples embedded in batches, centroids saved) and then embeds one request',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kural-router-')),t=transport();
  const c=new LocalRouterClient(t.fetch,dir);
  await assert.rejects(c.classify('find config',local),/getting ready/);       // not ready: Native decides this one
  await c.prepare(local);
  const batches=t.requests.filter(r=>r.url.endsWith('/api/embed'));
  assert.ok(batches.length>=Math.ceil(EXAMPLES.length/64)&&batches.every(b=>b.body.input.length<=64));
  const saved=JSON.parse(fs.readFileSync(path.join(dir,'router-all-minilm_22m.json'),'utf8'));
  assert.strictEqual(saved.examples,EXAMPLES_HASH);assert.deepStrictEqual(Object.keys(saved.size),SIZES);
  const n=t.requests.length,out=await c.classify('find config',local);
  assert.strictEqual(t.requests.filter(r=>r.url.endsWith('/api/embed')).length-batches.length,1);
  assert.strictEqual(out.task.sizeProbs.simple>.9,true);assert.strictEqual(out.source,'minilm');
  // A new Kural start reads the saved centroids: no embedding of the examples again.
  const t2=transport(),c2=new LocalRouterClient(t2.fetch,dir);await c2.classify('find config',local);
  assert.strictEqual(t2.requests.filter(r=>r.url.endsWith('/api/embed')).length,1);
  // Changed examples (another hash): computed again.
  fs.writeFileSync(path.join(dir,'router-all-minilm_22m.json'),JSON.stringify({...saved,examples:'old'}));
  const c3=new LocalRouterClient(transport().fetch,dir);await assert.rejects(c3.classify('x',local),/getting ready/);
  assert.ok(n>0);fs.rmSync(dir,{recursive:true,force:true});
 });
 await check('the helper\'s view is blended with the word classifier\'s',async()=>{
  const t=transport({vector:()=>hot('complex','edit')}),r=make({'modelRouter.assistant':'granite'},t.fetch);
  await r.prepare();
  const words=classify('add a button to the page');assert.notStrictEqual(words.complexity,'complex');
  const d=await r.route({prompt:'add a button to the page',current:'sonnet'});
  assert.strictEqual(d.source,'granite');assert.strictEqual(d.complexity,'complex');assert.strictEqual(d.model,'opus');
  assert.ok(t.requests.every(r=>!r.url.endsWith('/api/generate')&&!r.url.endsWith('/api/chat')));   // embeddings only
  // Qwen3 Embedding gets the instruction prefix its model card asks for.
  const q=transport(),rq=make({'modelRouter.assistant':'qwen3'},q.fetch);await rq.prepare();await rq.route({prompt:'add a button',current:'sonnet'});
  assert.ok(q.requests.filter(r=>r.url.endsWith('/api/embed')).every(r=>r.body.model==='qwen3-embedding:0.6b'&&r.body.input.every(s=>s.startsWith('Instruct:'))));
 });
 await check('Native, MiniLM, Granite and Qwen3 are the choices; anything else is Native',async()=>{
  assert.deepStrictEqual(ASSISTANTS,['native','granite','qwen3','minilm']);
  const schema=require('../extension/package.json').contributes.configuration.properties['kural.modelRouter.assistant'];
  assert.deepStrictEqual([...schema.enum].sort(),[...ASSISTANTS].sort());
  for(const assistant of ['qwen','tab','unknown']){
   const t=transport(),r=make({'modelRouter.assistant':assistant},t.fetch);
   assert.strictEqual(r.options().assistant,'native');
   assert.strictEqual((await r.route({prompt:'find config',current:'sonnet'})).source,'native');
   assert.strictEqual((await r.rank('settings',[{file:'a',excerpt:'login'}])).source,'native');assert.strictEqual(t.requests.length,0);
   await assert.rejects(new LocalRouterClient(t.fetch).classify('find config',{...local,assistant}),/Not a local router helper/);
  }
 });
 await check('unavailable helpers fall back and cooldown prevents repeated waits',async()=>{
  const t=transport({tags:[]});const r=make({'modelRouter.assistant':'minilm'},t.fetch);
  assert.strictEqual(await r.prepare(),false);
  assert.strictEqual((await r.route({prompt:'find config'})).source,'native');
  const calls=t.requests.length;await r.route({prompt:'find another config'});assert.ok(t.requests.length-calls<=2);
 });
 await check('cloud Ollama models cannot assist routing even through localhost',async()=>{
  for(const opts of [{tags:[{name:'all-minilm:22m',remote_host:'https://remote'}]},{caps:['completion','cloud']}]){
   const t=transport(opts);const r=make({'modelRouter.assistant':'minilm'},t.fetch);
   assert.strictEqual(await r.prepare(),false);
   assert.strictEqual((await r.route({prompt:'find config'})).source,'native');assert.ok(!t.requests.some(r=>r.url.endsWith('/api/embed')));
  }
 });
 const ready=(c)=>{c.seeds.set('http://127.0.0.1:11434/all-minilm:22m',{size:{simple:hot('simple','search'),standard:hot('standard','search'),complex:hot('complex','search')},kind:{search:hot('simple','search')}});return c;};
 await check('deadlines include body reads and abort transports that ignore cancellation',async()=>{
  let signal;const c=ready(new LocalRouterClient(async(_,opts)=>{signal=opts.signal;return {ok:true,json:()=>new Promise(()=>{})};}));
  await assert.rejects(c.classify('x',{...local,timeoutMs:20}),/deadline/);assert.strictEqual(signal.aborted,true);
 });
 await check('Stop propagates cancellation instead of dispatching fallback work',async()=>{
  const ctl=new AbortController(),r=make({'modelRouter.assistant':'minilm'},async()=>new Promise(()=>{}));ready(r.client);
  const pending=r.route({prompt:'fix bug'},ctl.signal);setTimeout(()=>ctl.abort(),10);
  await assert.rejects(pending,{name:'AbortError'});assert.strictEqual(r.inflight,0);
 });
 await check('local HTTP errors never expose echoed task text',async()=>{
  const c=ready(new LocalRouterClient(async()=>({ok:false,status:500,json:()=>({error:'private prompt'})})));
  await assert.rejects(c.classify('private prompt',local),e=>e.message==='Ollama HTTP 500');
 });
 await check('zero, wrong-size and non-finite embeddings are rejected',()=>{
  for(const v of [[],[0,0],[1,NaN],[1]])assert.throws(()=>cosine(v,[1,0]));
 });
 await check('repeat classification uses the cache; Restricted Mode doesn\'t reuse it',async()=>{
  const t=transport(),r=make({'modelRouter.assistant':'minilm'},t.fetch);await r.prepare();
  await r.route({prompt:'find config'});const n=t.requests.length;
  await r.route({prompt:'find config'});assert.strictEqual(t.requests.length,n);
  r.trusted=()=>false;assert.strictEqual((await r.route({prompt:'find config'})).source,'native');assert.strictEqual(t.requests.length,n);
 });
 await check('native ranking retains real candidate contents and optional context respects budget',async()=>{
  const r=make();const out=await r.rank('login session',[{file:'a',excerpt:'paint button'},{file:'b',excerpt:'login session store'}]);
  assert.strictEqual(out.candidates[0].file,'b');assert.strictEqual(out.candidates[0].excerpt,'login session store');
  const big={file:'big',excerpt:'x'.repeat(1000)},small={file:'small',excerpt:'useful'};
  assert.deepStrictEqual(contextWithinBudget([big,small],200),[small]);
 });
 await check('helper ranking batches candidates and orders by similarity',async()=>{
  const t=transport({vector:s=>s.includes('unrelated')?[0,1]:[1,0]});const r=make({'modelRouter.assistant':'minilm'},t.fetch);
  const out=await r.rank('login',[{file:'a',excerpt:'unrelated'},{file:'b',excerpt:'login'}]);
  assert.strictEqual(out.source,'minilm');assert.strictEqual(out.candidates[0].file,'b');
  assert.strictEqual(t.requests.find(r=>r.url.endsWith('/api/embed')).body.input.length,3);
 });
 await check('malformed helper ranking vectors retain original lexical candidates',async()=>{
  const candidates=[{file:'a',excerpt:'login'},{file:'b',excerpt:'settings'}];
  const t=transport({respond:async(url)=>url.endsWith('/api/embed')?json({embeddings:[[0,0]],prompt_eval_count:1}):null});
  const r=make({'modelRouter.assistant':'minilm'},t.fetch);
  const out=await r.rank('login',candidates);assert.strictEqual(out.source,'native');assert.strictEqual(out.candidates.length,2);
  assert.strictEqual(out.candidates[0].file,'a');assert.strictEqual(r.usage.fallbacks,1);
 });
 await check('Tab selection is synchronous, has no inference and follows the profile',()=>{
  const values={'modelRouter.tab':true,'modelRouter.assistant':'minilm'},r=make(values);
  const req={localModel:'small',localReady:true,claudeReady:true};
  assert.strictEqual(r.tabEngine(req),'local');values['modelRouter.profile']='intelligence';assert.strictEqual(r.tabEngine(req),'claude');
  assert.strictEqual(r.tabEngine({...req,claudeReady:false}),'local');assert.strictEqual(r.tabEngine({...req,localReady:false,claudeReady:false}),'none');
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
  assert.strictEqual(select(models,{prompt:'x',profile:'cost'},{},task('simple')).effort,'low');
  assert.match(select(models,{prompt:'x',profile:'intelligence'},{},task('complex')).reason,/max intensity/);
 });
 await check('profiles are Cost, Balance and Intelligence; the old names still work',()=>{
  assert.deepStrictEqual(['speed','balanced','quality','cost','nonsense',undefined].map(profileOf),['cost','balance','intelligence','cost','balance','balance']);
  const schema=require('../extension/package.json').contributes.configuration.properties['kural.modelRouter.profile'];
  assert.deepStrictEqual(schema.enum,['balance','cost','intelligence']);assert.strictEqual(schema.default,'balance');
  const props=require('../extension/package.json').contributes.configuration.properties;
  assert.ok(!props['kural.modelRouter.allowedModels']&&!props['kural.modelRouter.allowCloud']);   // Auto uses every model of your AIs
 });
 await check('usage limits: a model past half its limit is avoided, most under Cost; at 98 % it is skipped',()=>{
  const two=[claude('sonnet','Sonnet'),codex('gpt-6-terra','GPT-6-Terra','Balanced model for everyday coding.')];
  const req={prompt:'x',current:'sonnet'},t=task('standard');
  assert.strictEqual(select(two,{...req,profile:'balance'},{},t).model,'sonnet');                    // no usage known: stays
  const busy=[{...two[0],limitUsed:90},two[1]];
  const cost=select(busy,{...req,profile:'cost'},{},t);assert.strictEqual(cost.model,'codex:gpt-6-terra');assert.match(cost.reason,/Sonnet avoided: 90% of its limit used/);
  // Intelligence: capability first; a busier but stronger model still wins.
  assert.strictEqual(select([{...claude('opus','Opus'),limitUsed:90},two[1]],{...req,profile:'intelligence'},{},t).model,'opus');
  const full=select([{...two[0],limitUsed:99},two[1]],{...req,profile:'intelligence'},{},t);
  assert.strictEqual(full.model,'codex:gpt-6-terra');assert.match(full.reason,/skipped Claude \(limit nearly reached\)/);
  assert.strictEqual(select([{...two[0],limitUsed:99}],req,{},t).model,'sonnet');                    // the only one: still used
 });
 await check('near a limit (80 %+) Auto leaves the AI even in a long chat: ChatGPT (Codex) before Gemini, the tier kept',()=>{
  const at=(p)=>three.map(m=>m.providerId==='claude'?{...m,limitUsed:p}:m);
  const ask=(list,t,history=200000,profile='balance',extra={})=>select(list,{prompt:'x',current:'sonnet',profile,historyChars:history,...extra},{},t);
  // 70 %: a long chat stays on its AI (handing it over costs more); 85 %: it leaves, to Codex's balanced model.
  assert.strictEqual(ask(at(70),task('standard')).model,'sonnet');
  const r=ask(at(85),task('standard'));assert.strictEqual(r.model,'codex:gpt-6-terra');assert.match(r.reason,/left Claude: 85% of its limit used/);
  for(const p of ['cost','intelligence'])assert.ok(ask(at(85),task('standard'),200000,p).model.includes(':'),p);   // (Claude's ids have no "provider:")
  // Complex work: the most capable elsewhere, Codex's before Gemini's (Gemini can't ask before a command).
  assert.strictEqual(ask(at(90),task('complex')).model,'codex:gpt-6-sol');
  // Only Gemini besides Claude: Gemini.
  const noCodex=at(90).filter(m=>m.providerId!=='codex');assert.strictEqual(ask(noCodex,task('complex')).model,'agy:gemini-3.8-pro');
  // Nothing else can do it: still Claude (never refused).
  assert.strictEqual(ask(at(95).filter(m=>m.providerId==='claude'),task('standard')).model,'sonnet');
  // Its answer just failed on the limit (avoid): any other AI, whatever the numbers say.
  const avoided=ask(three,task('standard'),0,'balance',{avoid:'claude'});assert.notStrictEqual(avoided.model.split(':').length,1);assert.match(avoided.reason,/Claude reached its limit: continued on ChatGPT \(Codex\)/);
  assert.strictEqual(ask(three.filter(m=>m.providerId==='claude'),task('standard'),0,'balance',{avoid:'claude'}).model,'sonnet');
 });
 await check('an AI that refused a request on its limit counts as full until it resets',()=>{
  assert.strictEqual(limitUsed({id:'sonnet'},{windows:[{id:'five_hour',usedPercent:40}],blockedUntil:Date.now()+60000}),100);
  assert.strictEqual(limitUsed({id:'sonnet'},{windows:[{id:'five_hour',usedPercent:40}],blockedUntil:Date.now()-1}),40);
  const usage=require('../extension/lib/ai/usage');usage._reset();
  const r=usage.fromClaude({rate_limit_info:{status:'rejected',resetsAt:Math.round(Date.now()/1000)+3600,unifiedWindows:{five_hour:{utilization:1,resetsAt:Math.round(Date.now()/1000)+3600}}}});
  usage.report('claude',r);assert.ok(usage.current('claude').blockedUntil>Date.now()+3500e3);
  usage.report('claude',usage.fromClaude({rate_limit_info:{status:'allowed',unifiedWindows:{five_hour:{utilization:.1}}}}));assert.strictEqual(usage.current('claude').blockedUntil,undefined);
  usage.markLimited('codex');assert.ok(usage.current('codex').blockedUntil>Date.now()+25*60e3);
  const {limitError}=require('../extension/lib/router/journal');
  for(const t of ['Claude AI usage limit reached|1791999999',"You've hit your session limit · resets 3pm","You've hit your usage limit. Try again at 5:00 PM.","Gemini: you've reached your plan's limit for now.",'API Error: 429 Too Many Requests'])assert.ok(limitError(t),t);
  for(const t of ['stopped','login','Something went wrong.','Credit balance is too low',undefined])assert.ok(!limitError(t),String(t));
 });
 await check('the handoff fits a budget: newer turns whole, older ones shortened, every request, plan and to-do kept',()=>{
  const big='z'.repeat(40000),msgs=[];
  for(let i=0;i<20;i++)msgs.push({role:'user',segments:[{t:'text',v:`REQUEST-${i}`}],sentText:`REQUEST-${i} ${big}`,attachments:i===0?[{name:'shot.png',kind:'image',path:'/tmp/shot.png'}]:undefined},
   {role:'assistant',model:'sonnet',mode:i===2?'plan':'agent',blocks:[{k:'text',text:i===2?`THE-PLAN ${big}`:`ANSWER-${i} ${big}`}],journal:{tools:[{id:`t${i}`,name:'TodoWrite',input:{todos:[{content:`TODO-${i}`}]},status:'complete'},{id:`r${i}`,name:'Read',input:{file_path:`f${i}.js`},status:'failed',result:big}]},changes:[{rel:`f${i}.js`,added:1,removed:0,state:'kept'}]});
  const whole=handoff(msgs);assert.ok(!/"compacted"/.test(whole)&&whole.length>1e6);
  for(const budget of [120000,40000]){
   const h=handoff(msgs,budget),record=/<kural_handoff>\n([\s\S]*)\n<\/kural_handoff>/.exec(h)[1];
   assert.ok(record.length<=budget,`${record.length} > ${budget}`);assert.match(h,/details are shortened/);
   for(const s of ['REQUEST-0','REQUEST-19','THE-PLAN','TODO-19','f0.js','f19.js','shot.png'])assert.ok(record.includes(s),`${budget}: ${s}`);
  }
 });
 await check('limitUsed: the fullest general window, and a model\'s own weekly window only for that model',()=>{
  const report={windows:[{id:'five_hour',usedPercent:20},{id:'seven_day',usedPercent:40},{id:'seven_day_opus',usedPercent:95}]};
  assert.strictEqual(limitUsed({id:'opus'},report),95);assert.strictEqual(limitUsed({id:'sonnet'},report),40);
  assert.strictEqual(limitUsed({id:'haiku'},null),null);assert.strictEqual(limitUsed({id:'x'},{windows:[]}),null);
  const r=make();r.usageOf=(p)=>p==='claude'?report:null;
  return r.availableModels().then(list=>{assert.strictEqual(list.find(m=>m.id==='opus').limitUsed,95);assert.ok(!('limitUsed' in list.find(m=>m.id==='agy:flash')));});
 });
 await check('attached context counts: many files or much text make it bigger, error output makes it a review',()=>{
  const base=classify('rename x').complexity;assert.strictEqual(base,'simple');
  assert.strictEqual(classify('rename x',{files:4}).complexity,'standard');
  assert.strictEqual(classify('rename x',{files:9}).complexity,'complex');
  const t=classify('this happens:\nTypeError: Cannot read properties of undefined\n    at load (src/app.js:12:5)');
  assert.strictEqual(t.intent,'review');assert.ok(t.signals.includes('error output'));assert.notStrictEqual(t.complexity,'simple');
  assert.ok(classify('make this bigger',{elements:1}).signals.includes('a picked page element'));
  assert.match(select(models,{prompt:'update these',current:'haiku'},{},classify('update these',{files:5})).reason,/5 files attached/);
 });
 await check('quick questions are simple, big jobs complex (the word classifier)',()=>{
  for(const p of ['whats 2+2','hi','rename tmp to result','what does chmod 755 mean'])assert.strictEqual(classify(p).complexity,'simple',p);
  for(const p of ['migrate the whole project from javascript to typescript','design the architecture for a payments platform across all services'])assert.strictEqual(classify(p).complexity,'complex',p);
  assert.strictEqual(select(models,{prompt:'whats 2+2',current:'opus',profile:'balance',historyChars:400000},{}).model,'haiku');
 });
 await check('Auto learning can be switched off: nothing new is learned and nothing learned is used (kural.modelRouter.learn)',()=>{
  let on=true,saved=null;const mem=new RouterMemory(()=>[],(v)=>saved=v,()=>on),p='refactor the payment module into services';
  assert.ok(mem.record('better',{prompt:p,model:'haiku',better:'opus'}));
  on=false;
  assert.ok(!mem.record('good',{prompt:'write the csv export function',model:'sonnet'}));assert.strictEqual(mem.items.length,1);   // (not learned)
  assert.deepStrictEqual(mem.advise(p).lean,{});                                                                               // (not used)
  on=true;assert.ok(mem.advise(p).lean.opus>0);                                                                                 // (kept: back on, it's used again)
 });
 await check('Auto learns: a model you picked instead leans similar requests its way; undone answers lean away',()=>{
  let saved=null;const mem=new RouterMemory(()=>[],(v)=>saved=v),now=Date.now();
  assert.ok(similarity(words('add a login page with tests'),words('add the login page and its tests'))>.5);
  assert.ok(!mem.record('better',{prompt:'hi',model:'haiku',better:'opus'}));                // too few words to learn from
  assert.ok(mem.record('better',{prompt:'refactor the payment module into services',model:'haiku',better:'opus'},now));
  assert.strictEqual(saved.length,1);
  const near=mem.advise('refactor the payment module into smaller services',now).lean;
  assert.ok(near.opus>0&&near.haiku<0);assert.deepStrictEqual(mem.advise('what time is it in tokyo',now).lean,{});
  const d=select(models,{prompt:'x',current:'haiku',learned:near},{},task('standard'));
  assert.strictEqual(d.model,'opus');assert.match(d.reason,/you chose a stronger model/);
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
 await check('routing stays far under 200 ms (native; a helper adds one embedding)',async()=>{
  const r=make({},undefined,true,three),times=[];
  for(let i=0;i<200;i++){const d=await r.route({prompt:EXAMPLES[i%EXAMPLES.length][0],current:'sonnet'});times.push(d.ms);}
  times.sort((a,b)=>a-b);assert.ok(times[190]<20,`p95 ${times[190]} ms`);
 });
 console.log(`router: ${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
})();
