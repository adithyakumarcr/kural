const path = require("path");
const { LocalRouterClient,abortError,HELPERS } = require("./client");
const { profileOf,eligible,classify,select,contextWithinBudget,lexicalRank,limitUsed } = require("./policy");
const { performance } = require("perf_hooks");
const { createHash } = require("crypto");
const { excludedModel } = require("../ai/model-policy");
// Native = Kural's word classifier (built in); the others are helper models through Ollama (client.js HELPERS).
const ASSISTANTS = ["native",...Object.keys(HELPERS)];
class ModelRouter {
  constructor(context,settings,models,trusted = () => true,fetchImpl) {
    this.context=context;this.settings=settings;this.models=models;this.trusted=trusted;
    const store=context&&context.globalStorageUri&&context.globalStorageUri.fsPath;
    this.client=new LocalRouterClient(fetchImpl,store?path.join(store,"router"):null);this.listeners=new Set();this.samples=[];this.tasks=new Map();
    this.inflight=0;this.cooldowns=new Map();this.cache=new Map();this.last=null;this.lastAssistant=null;
    this.usage={ decisions:0,calls:0,inputTokens:0,fallbacks:0 };
    // Set by extension.js: usageOf(providerId) → lib/ai/usage.js current() report; memory → lib/router/learn.js.
    this.usageOf=()=>null;this.memory=null;
  }
  onChange(f) { this.listeners.add(f);return { dispose:()=>this.listeners.delete(f) }; }
  changed() { for (const f of this.listeners) f(); }
  options() {
    const c=this.settings(),number=(k,d,min,max)=>{const n=c.get(k,d);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):d;};
    // (No list of allowed models any more: Auto uses every model of the AIs you set up, never a model on this computer.)
    const assistant=c.get("modelRouter.assistant","native");
    return { profile:profileOf(c.get("modelRouter.profile","balance")),saveTokens:!!c.get("modelRouter.saveTokens",false),
      usageSwitch:require("../ai/usage-switch").options(c),
      assistant:ASSISTANTS.includes(assistant)?assistant:"native",
      url:c.get("tabCompletion.ollamaUrl","http://127.0.0.1:11434"),timeoutMs:number("modelRouter.timeoutMs",1500,100,10000),
      modelPreferences:c.get("modelRouter.modelPreferences",{})||{},search:!!c.get("modelRouter.search",false),context:!!c.get("modelRouter.context",false),
      contextChars:number("modelRouter.contextChars",12000,1000,60000),handoffChars:number("modelRouter.handoffChars",120000,10000,1000000),
      checkpoints:c.get("modelRouter.checkpoints",true)!==false,tab:!!c.get("modelRouter.tab",false) };
  }
  async availableModels() {
    return (await this.models()).map((m)=>{
      let used=null;try { used=limitUsed(m,this.usageOf(m.providerId)); } catch { /* no report yet */ }
      return {...m,observedTaskMs:this.taskMedian(m.id),...(Number.isFinite(used)?{limitUsed:used}:{})};
    });
  }
  taskMedian(id) { const v=[...(this.tasks.get(id)||[])].sort((a,b)=>a-b);return v.length?v[Math.floor(v.length/2)]:null; }
  taskDone(id,ms,ok) {
    if (ok && Number.isFinite(ms)) { const list=this.tasks.get(id)||[];list.push(ms);this.tasks.set(id,list.slice(-20)); }
    this.changed();
  }
  resetAssistance() { this.cooldowns.clear();this.cache.clear();this.client.verified.clear();this.client.seeds.clear();this.lastAssistant=null;this.changed(); }
  // Gets the chosen helper ready (its centroids: one batch of embeddings, then saved), outside any routing deadline.
  prepare() {
    const s=this.options();
    if (s.assistant==="native"||!this.trusted()) return Promise.resolve(false);
    return this.client.prepare(s).then((ok)=>{this.changed();return ok;},()=>false);
  }
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
    const t0=performance.now(),settings=this.options(),list=eligible(await this.availableModels(),request);
    if (signal && signal.aborted) throw abortError();
    const continuation = /^\s*(yes|okay|ok|go ahead|continue|build it|do it|implement (it|that|the plan))\b/i.test(String(request.prompt||"")) && String(request.prompt||"").length<200;
    const text = continuation && request.recentContext ? `Recent conversation: ${String(request.recentContext).slice(-1200)}\nLatest request: ${request.prompt}` : String(request.prompt||"");
    let task=classify(text,request.context),source="native",note="";
    if (settings.assistant!=="native" && this.trusted() && list.length>1 && !request.checkpoint) {
      const key=createHash("sha256").update(JSON.stringify([settings.assistant,settings.url,text])).digest("hex");
      try {
        let out=this.cache.get(key);
        if (!out || Date.now()-out.at>120000) {
          out={...await this.assist(settings,signal,()=>this.client.classify(text,settings,signal)),at:Date.now()};
          this.cache.set(key,out);if (this.cache.size>100) this.cache.delete(this.cache.keys().next().value);
        }
        // MiniLM's view is blended with the word classifier's (both are probabilities; the blend was the most accurate in
        // test/router-eval.js), and what came with the request still counts after it.
        task=classify(text,request.context,out.task);source=out.source;
      } catch(e) { if (signal && signal.aborted) throw e;note=` · native fallback: ${e.message}`;this.usage.fallbacks++; }
    }
    // Not at a checkpoint: that's the same answer continuing, nothing to learn from yet.
    const learned=this.memory&&!request.checkpoint?this.memory.advise(request.prompt||text).lean:null;
    const decision={...select(list,{...request,...(learned?{learned}:{})},settings,task),source,ms:performance.now()-t0};
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
    const threshold=out.source!=="native"?.25:.5;
    return {...out,candidates:contextWithinBudget(out.candidates.filter((c)=>c.relevance>=threshold),this.options().contextChars)};
  }
  // No model inference while typing: the profile decides between Tab's two engines synchronously. (Tab Completion keeps
  // its local engine: Auto in the chat never picks a model on this computer, Tab is a separate choice.)
  tabEngine({localModel,localReady,claudeReady}) {
    const s=this.options();if (!s.tab) return null;
    const local=localReady&&!excludedModel(localModel),cloud=claudeReady;
    if (!local&&!cloud) return "none";
    if (!cloud) return "local";if (!local) return "claude";
    return s.profile==="intelligence"&&!s.saveTokens?"claude":"local";
  }
}
module.exports={ModelRouter,ASSISTANTS};
