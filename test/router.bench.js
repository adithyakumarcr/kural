// Offline by default. --live sends only synthetic data to loopback Ollama, sequentially.
// node test/router.bench.js --live --samples=24 --timeout-ms=5000
const {ModelRouter}=require('../extension/lib/router');
const {loopback,MODEL}=require('../extension/lib/router/client');
const corpus=require('./fixtures/router-bench.json');
const os=require('os');
const models=['haiku','sonnet','opus'].map(id=>({id,label:id,providerId:'claude',ready:true,commands:true}));
const flag=(name)=>process.argv.find(s=>s.startsWith(name+'='))?.slice(name.length+1);
const timeout=Math.max(100,Math.min(10000,Number(flag('--timeout-ms'))||1500));
const sampleCount=Math.max(1,Math.min(100,Number(flag('--samples'))||corpus.tasks.length));
const stats=(samples)=>{
 if(!samples.length)return null;
 const v=[...samples].sort((a,b)=>a-b);
 return {medianMs:+v[Math.floor(v.length/2)].toFixed(3),p95Ms:+v[Math.min(v.length-1,Math.ceil(v.length*.95)-1)].toFixed(3)};
};
const ms=(v)=>+v.toFixed(3);
function router(assistant){
 const values={'modelRouter.assistant':assistant,'modelRouter.timeoutMs':timeout};
 return new ModelRouter({},()=>({get:(k,d)=>Object.hasOwn(values,k)?values[k]:d}),()=>models);
}
async function measure(assistant,model){
 const r=router(assistant),times=[],assistedTimes=[],cases=[];
 const first=await r.route({prompt:corpus.tasks[0].prompt,current:'sonnet'});
 // An initial timeout must not turn the whole warm benchmark into cooldown timings.
 // This reset is benchmark-only; runtime keeps its normal 30-second cooldown.
 if(assistant!=='native'&&r.lastAssistant&&!r.lastAssistant.ok&&!r.lastAssistant.reason.startsWith('Ambiguous'))r.resetAssistance();
 const warmup=await r.route({prompt:'Implement an input validation function and its tests',current:'sonnet'});
 r.cache.clear();
 for(let i=0;i<sampleCount;i++){
  const expected=corpus.tasks[i%corpus.tasks.length],prompt=expected.prompt;
  r.cache.clear(); // Force inference on repeated samples; cache is measured separately below.
  const d=await r.route({prompt,current:'sonnet'});
  times.push(d.ms);if(assistant!=='native'&&d.source===assistant)assistedTimes.push(d.ms);
  cases.push({...expected,predictedIntent:d.intent,predictedComplexity:d.complexity,model:d.model,source:d.source,ms:ms(d.ms),
   intentCorrect:d.intent===expected.intent,complexityCorrect:d.complexity===expected.complexity,
   ...(assistant!=='native'&&d.source==='native'?{fallback:r.lastAssistant?.reason||d.reason}:{} )});
 }
 const repeated=cases.find(c=>c.source===assistant)||cases[0];
 r.cache.clear();const repeatPrime=await r.route({prompt:repeated.prompt,current:'sonnet'});
 const cached=await r.route({prompt:repeated.prompt,current:'sonnet'});
 const ranks=[],rankingTimes=[],assistedRankingTimes=[];
 for(const expected of corpus.queries){
  const d=await r.rank(expected.query,corpus.candidates);
  const visible=d.candidates.filter(c=>c.relevance>0);
  const context=d.candidates.filter(c=>c.relevance>=(d.source==='minilm'?.25:.5));
  const search=d.candidates.filter(c=>c.relevance>=(d.source==='minilm'?.35:.6));
  rankingTimes.push(d.ms);if(assistant!=='native'&&d.source===assistant)assistedRankingTimes.push(d.ms);
  ranks.push({...expected,source:d.source,ms:ms(d.ms),top:visible.slice(0,3).map(c=>c.file),
   top1Correct:visible[0]?.file===expected.file,top3Correct:visible.slice(0,3).some(c=>c.file===expected.file),
   contextTop1Correct:context[0]?.file===expected.file,searchTop1Correct:search[0]?.file===expected.file,
   context:context.slice(0,3).map(c=>c.file),search:search.slice(0,3).map(c=>c.file),
   ...(assistant!=='native'&&d.source==='native'?{fallback:r.lastAssistant?.reason}:{} )});
 }
 return {assistant,model,deadlineMs:timeout,firstRequestMs:ms(first.ms),firstSource:first.source,
  warmupMs:ms(warmup.ms),warmupSource:warmup.source,samples:cases.length,assisted:assistedTimes.length,
  allDecisions:stats(times),assistedInference:stats(assistedTimes),
  repeatedPrompt:repeated.prompt,repeatPrimeSource:repeatPrime.source,repeatMs:ms(cached.ms),repeatSource:cached.source,
  taskChecks:{intentCorrect:cases.filter(c=>c.intentCorrect).length,complexityCorrect:cases.filter(c=>c.complexityCorrect).length,
   bothCorrect:cases.filter(c=>c.intentCorrect&&c.complexityCorrect).length,total:cases.length},
  ranking:{samples:ranks.length,assisted:assistedRankingTimes.length,allDecisions:stats(rankingTimes),assistedInference:stats(assistedRankingTimes),
   top1Correct:ranks.filter(c=>c.top1Correct).length,top3Correct:ranks.filter(c=>c.top3Correct).length,
   contextTop1Correct:ranks.filter(c=>c.contextTop1Correct).length,searchTop1Correct:ranks.filter(c=>c.searchTop1Correct).length,cases:ranks},
  usage:r.usage,cases,status:r.lastAssistant};
}
(async()=>{
 const report={timestamp:new Date().toISOString(),runtime:process.version,platform:process.platform,arch:process.arch,
  cpu:os.cpus()[0]?.model,totalMemoryGB:+(os.totalmem()/1024**3).toFixed(1),corpus:corpus.description,measures:[]};
 const native=router('native'),samples=[];
 for(let i=0;i<1100;i++){
  const d=await native.route({prompt:corpus.tasks[i%corpus.tasks.length].prompt,current:'sonnet',profile:['balanced','speed','quality'][i%3]});
  if(i>=100)samples.push(d.ms);
 }
 report.measures.push({assistant:'native',kind:'warm policy overhead',samples:samples.length,...stats(samples)});
 report.measures.push(await measure('native',null));
 if(process.argv.includes('--live')){
  const base=loopback('http://127.0.0.1:11434');let tags;
  try{
   const res=await fetch(base+'/api/tags',{signal:AbortSignal.timeout(1500),redirect:'error'});
   if(!res.ok)throw new Error('Unavailable');tags=await res.json();
   report.ollamaVersion=(await(await fetch(base+'/api/version',{signal:AbortSignal.timeout(1500),redirect:'error'})).json()).version;
  }catch{report.live='SKIP: local Ollama is unavailable; no downloads performed';console.log(JSON.stringify(report,null,2));return;}
  for(const [assistant,model] of [['minilm',MODEL]]){
   const installed=(tags.models||[]).find(m=>m.name===model||m.name===`${model}:latest`);
   if(!installed){report.measures.push({assistant,model,status:'SKIP: helper is not installed'});continue;}
   report.measures.push({...await measure(assistant,model),downloadBytes:installed.size,details:installed.details});
  }
 }else report.live='Not requested. Use --live to measure installed local helpers.';
 report.limit='Routing/ranking overhead and hand-labelled synthetic smoke checks only. Three answering-model descriptors are synthetic; no answering CLI starts. No representative accuracy, full-answer speedup, token saving or forced model unloading is measured. First request may use a resident model. Warmup resets an initial failure cooldown only for this benchmark; later errors retain runtime fallback behaviour.';
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
