const { LocalRouterClient,abortError } = require("./client");
const { profileOf,eligible,classify,select,contextWithinBudget,lexicalRank } = require("./policy");
const { performance } = require("perf_hooks");
const { createHash } = require("crypto");
const { excludedModel } = require("../ai/model-policy");
const ASSISTANTS = ["native","minilm"];
class ModelRouter {
  constructor(context,settings,models,trusted = () => true,fetchImpl) {
    this.context=context;this.settings=settings;this.models=models;this.trusted=trusted;
    this.client=new LocalRouterClient(fetchImpl);this.listeners=new Set();this.samples=[];this.tasks=new Map();
    this.inflight=0;this.cooldowns=new Map();this.cache=new Map();this.last=null;this.lastAssistant=null;
    this.usage={ decisions:0,calls:0,inputTokens:0,fallbacks:0 };
  }
  onChange(f) { this.listeners.add(f);return { dispose:()=>this.listeners.delete(f) }; }
  changed() { for (const f of this.listeners) f(); }
  options() {
    const c=this.settings(),number=(k,d,min,max)=>{const n=c.get(k,d);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):d;};
    const assistant=c.get("modelRouter.assistant","native"),allowed=c.get("modelRouter.allowedModels",null);
    return { profile:profileOf(c.get("modelRouter.profile","balanced")),allowedModels:Array.isArray(allowed)?allowed.filter((x)=>typeof x==="string"):null,
      allowCloud:c.get("modelRouter.allowCloud",true)!==false,saveTokens:!!c.get("modelRouter.saveTokens",false),
      assistant:ASSISTANTS.includes(assistant)?assistant:"native",
      url:c.get("tabCompletion.ollamaUrl","http://127.0.0.1:11434"),timeoutMs:number("modelRouter.timeoutMs",1500,100,10000),
      minSimilarity:number("modelRouter.minSimilarity",.25,0,1),minMargin:number("modelRouter.minMargin",.04,0,1),
      modelPreferences:c.get("modelRouter.modelPreferences",{})||{},search:!!c.get("modelRouter.search",false),context:!!c.get("modelRouter.context",false),
      contextChars:number("modelRouter.contextChars",12000,1000,60000),handoffChars:number("modelRouter.handoffChars",120000,10000,1000000),
      checkpoints:c.get("modelRouter.checkpoints",true)!==false,tab:!!c.get("modelRouter.tab",false) };
  }
  async availableModels() { return (await this.models()).map((m)=>({...m,observedTaskMs:this.taskMedian(m.id)})); }
  taskMedian(id) { const v=[...(this.tasks.get(id)||[])].sort((a,b)=>a-b);return v.length?v[Math.floor(v.length/2)]:null; }
  taskDone(id,ms,ok) {
    if (ok && Number.isFinite(ms)) { const list=this.tasks.get(id)||[];list.push(ms);this.tasks.set(id,list.slice(-20)); }
    this.changed();
  }
  resetAssistance() { this.cooldowns.clear();this.cache.clear();this.client.verified.clear();this.client.seeds.clear();this.lastAssistant=null;this.changed(); }
  async assist(settings,signal,fn) {
    if (!this.trusted()) throw new Error("Local assistance is disabled in Restricted Mode");
    if (signal && signal.aborted) throw abortError();
    if (this.inflight) throw new Error("Local router is busy; native policy used");
    const key=JSON.stringify([settings.assistant,settings.url]);
    if (Date.now()-(this.cooldowns.get(key)||0)<30000) throw new Error("Local assistance is cooling down after an error; native policy used");
    this.inflight++;
    try {
      const out=await fn();if (signal && signal.aborted) throw abortError();
      this.usage.calls++;this.usage.inputTokens+=out.tokens||0;
      this.lastAssistant={ok:true,source:settings.assistant};return out;
    } catch(e) {
      if (!(signal && signal.aborted)) {
        if (!e.message.startsWith("Ambiguous semantic match")) this.cooldowns.set(key,Date.now());
        this.lastAssistant={ok:false,reason:e.message};
      }
      throw e;
    } finally { this.inflight--; }
  }
  async route(request,signal) {
    const t0=performance.now(),settings=this.options(),list=eligible(await this.availableModels(),request,settings);
    if (signal && signal.aborted) throw abortError();
    const continuation = /^\s*(yes|okay|ok|go ahead|continue|build it|do it|implement (it|that|the plan))\b/i.test(String(request.prompt||"")) && String(request.prompt||"").length<200;
    const text = continuation && request.recentContext ? `Recent conversation: ${String(request.recentContext).slice(-1200)}\nLatest request: ${request.prompt}` : String(request.prompt||"");
    let task=classify(text),source="native",note="";
    if (settings.assistant!=="native" && this.trusted() && list.length>1 && !request.checkpoint) {
      const key=createHash("sha256").update(JSON.stringify([settings.assistant,settings.url,settings.minSimilarity,settings.minMargin,text])).digest("hex");
      try {
        let out=this.cache.get(key);
        if (!out || Date.now()-out.at>120000) {
          out={...await this.assist(settings,signal,()=>this.client.classify(text,settings,signal)),at:Date.now()};
          this.cache.set(key,out);if (this.cache.size>100) this.cache.delete(this.cache.keys().next().value);
        }
        // Known complex work and nontrivial edits/reviews retain a quality floor when a helper disagrees.
        const floor = task.complexity === "complex" ? "complex" :
          task.complexity === "standard" && ["edit","review"].includes(task.intent) ? "standard" : null;
        task={...out.task,complexity:floor === "complex" ? "complex" :
          floor === "standard" && out.task.complexity === "simple" ? "standard" : out.task.complexity};source=out.source;
      } catch(e) { if (signal && signal.aborted) throw e;note=` · native fallback: ${e.message}`;this.usage.fallbacks++; }
    }
    const decision={...select(list,request,settings,task),source,ms:performance.now()-t0};
    if (decision.reason) decision.reason+=note;
    this.last={...decision,profile:profileOf(request.profile||settings.profile)};this.usage.decisions++;
    this.samples.push(decision.ms);this.samples=this.samples.slice(-100);this.changed();return decision;
  }
  async rank(query,candidates,signal) {
    if (signal && signal.aborted) throw abortError();
    const settings=this.options(),t0=performance.now();let ranked=lexicalRank(query,candidates),source="native";
    if (settings.assistant!=="native" && candidates.length) {
      try {
        const out=await this.assist(settings,signal,()=>this.client.rank(query,candidates.slice(0,16),settings,signal));
        const lexical=new Map(ranked.map((c)=>[c.file,c.relevance]));
        ranked=out.candidates.map((c)=>({...c,relevance:.75*Math.max(0,c.similarity)+.25*(lexical.get(c.file)||0)}));
        ranked.sort((a,b)=>b.relevance-a.relevance);source=settings.assistant;
      } catch(e) { if (signal && signal.aborted) throw e;this.usage.fallbacks++; }
    }
    const ms=performance.now()-t0;this.lastRank={ms,count:ranked.length,source};this.changed();return {candidates:ranked,source,ms};
  }
  async selectContext(query,candidates,signal) {
    const out=await this.rank(query,candidates,signal);
    // These are relevance heuristics, not calibrated probabilities.
    const threshold=out.source==="minilm"?.25:.5;
    return {...out,candidates:contextWithinBudget(out.candidates.filter((c)=>c.relevance>=threshold),this.options().contextChars)};
  }
  // No model inference while typing. Apply the native profile and allowed-model policy synchronously.
  tabEngine({localModel,claudeModel,localReady,claudeReady}) {
    const s=this.options();if (!s.tab) return null;
    const allowed=(id)=>s.allowedModels===null||s.allowedModels.includes(id)||s.allowedModels.includes(`${id}:latest`);
    const local=localReady&&!excludedModel(localModel)&&allowed(`ollama:${localModel}`),cloud=claudeReady&&s.allowCloud&&allowed(claudeModel);
    if (!local&&!cloud) return "none";
    if (!cloud) return "local";if (!local) return "claude";
    return s.profile==="quality"&&!s.saveTokens?"claude":"local";
  }
}
module.exports={ModelRouter,ASSISTANTS};
