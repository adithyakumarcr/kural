const vscode = require("vscode");
const { fontScale } = require("../ui");
const { PROFILES,traits } = require("./policy");
const { ASSISTANTS } = require("./index");
const { loopback, MODEL } = require("./client");
const { Ollama } = require("../ai/ollama");
const cfg = () => vscode.workspace.getConfiguration("kural");
const validPreferences = (v) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length<=255 &&
  Object.entries(v).every(([id,t]) => id.length<200 && t && typeof t==="object" && !Array.isArray(t) &&
    Object.entries(t).every(([k,n]) => ["quality","speed","tokens"].includes(k) && Number.isInteger(n) && n>=1 && n<=3));
const SETTINGS = {
  profile:(v)=>Object.hasOwn(PROFILES,v),assistant:(v)=>ASSISTANTS.includes(v),modelPreferences:validPreferences,
  allowedModels:(v)=>v===null||(Array.isArray(v)&&v.length<=255&&v.every((x)=>typeof x==="string"&&x.length<200)),
  allowCloud:(v)=>typeof v==="boolean",saveTokens:(v)=>typeof v==="boolean",
  search:(v)=>typeof v==="boolean",context:(v)=>typeof v==="boolean",checkpoints:(v)=>typeof v==="boolean",tab:(v)=>typeof v==="boolean",
  timeoutMs:(v)=>Number.isInteger(v)&&v>=100&&v<=10000,
};
class RouterPanel {
  constructor(context,router,refresh=async()=>{}) { this.context=context;this.router=router;this.refresh=refresh;this.view=null;this.revision=0;this.download=null; }
  register() {
    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider("kural.routerPanel",this),
      vscode.commands.registerCommand("kural.modelRouter",()=>vscode.commands.executeCommand("kural.routerPanel.focus")),
      this.router.onChange(()=>this.push().catch(()=>{})),
      vscode.workspace.onDidChangeConfiguration((e)=>{
        if(e.affectsConfiguration("kural.modelRouter.assistant")||e.affectsConfiguration("kural.tabCompletion.ollamaUrl"))this.router.resetAssistance();
        if(e.affectsConfiguration("kural.modelRouter")||e.affectsConfiguration("kural.tabCompletion.localModel")||e.affectsConfiguration("kural.tabCompletion.ollamaUrl"))this.push().catch(()=>{});
      }),
      { dispose:()=>{if(this.download)this.download.abort();} },
    );
    const status=vscode.window.createStatusBarItem("kural.modelRouter",vscode.StatusBarAlignment.Right,98);
    status.name="Model Router";status.text="$(git-compare) Model Router";status.command="kural.modelRouter";
    status.tooltip="Choose router assistance, allowed models, speed, quality and token preferences";status.show();this.context.subscriptions.push(status);
  }
  async downloadModel() {
    if(this.download)return;
    if(!vscode.workspace.isTrusted){vscode.window.showInformationMessage("Trust this workspace before setting up local router assistance.");return;}
    const settings=this.router.options();loopback(settings.url);
    if(settings.assistant!=="minilm")return;
    const model=MODEL;
    const ollama=new Ollama(()=>settings.url),ctl=new AbortController();this.download=ctl;
    try {
      await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:`Kural router: ${model}`,cancellable:true},async(progress,token)=>{
        const sub=token.onCancellationRequested(()=>ctl.abort());
        try {
          if(!(await ollama.status()).running){
            const pick=await vscode.window.showInformationMessage("Local router assistance needs Ollama running on this computer.","Install or start Ollama");
            if(pick!=="Install or start Ollama"||ctl.signal.aborted)return;
            await require("../tab/local").installOllama();
            if(ctl.signal.aborted||!(await ollama.status()).running)return;
          }
          await ollama.pull(model,(s)=>progress.report({message:`${s.status} ${s.percent}%`}),ctl.signal);
          this.router.resetAssistance();await this.refresh();
        } finally {sub.dispose();}
      });
    } catch(e){if(!ctl.signal.aborted)vscode.window.showWarningMessage(`Router model download failed: ${e.message}`);}
    finally {this.download=null;await this.push();}
  }
  async push() {
    if(!this.view)return;const revision=++this.revision,options=this.router.options();
    const models=(await this.router.availableModels()).map((m)=>({...m,traits:traits(m,options.modelPreferences)}));
    if(!this.view||revision!==this.revision)return;
    const times=[...this.router.samples].sort((a,b)=>a-b);
    this.view.webview.postMessage({type:"state",options,models,trusted:vscode.workspace.isTrusted,last:this.router.last,
      usage:this.router.usage,rank:this.router.lastRank,assistant:this.router.lastAssistant,downloading:!!this.download,
      median:times.length?times[Math.floor(times.length/2)]:null,p95:times.length?times[Math.min(times.length-1,Math.ceil(times.length*.95)-1)]:null});
  }
  resolveWebviewView(view) {
    this.view=view;view.webview.options={enableScripts:true};view.webview.html=page(require("crypto").randomBytes(16).toString("hex"));
    view.webview.onDidReceiveMessage(async(m)=>{
      try {
        if(m.type==="ready"||m.type==="refresh"){if(m.type==="refresh"){this.router.resetAssistance();await this.refresh();}await this.push();}
        else if(m.type==="download")await this.downloadModel();
        else if(m.type==="tabPanel")vscode.commands.executeCommand("kural.tabPanel.focus");
        else if(m.type==="set"&&Object.hasOwn(SETTINGS,m.key)&&SETTINGS[m.key](m.value))await cfg().update(`modelRouter.${m.key}`,m.value,vscode.ConfigurationTarget.Global);
      } catch {vscode.window.showWarningMessage("Model Router couldn't complete that action. Check its settings and Ollama connection.");}
    });
    view.onDidDispose(()=>{this.view=null;this.revision++;});
  }
}
function page(nonce) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family);font-size:calc(13px * ${fontScale()});color:var(--vscode-foreground);padding:12px 18px}
.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:10px 0}.muted{color:var(--vscode-descriptionForeground)}
button,select,input{font:inherit}button{cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:5px 10px;border-radius:4px}button:disabled{opacity:.5;cursor:default}
select,input[type=number]{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);padding:4px}
input[type=checkbox]{accent-color:var(--vscode-button-background)}fieldset{border:1px solid var(--vscode-widget-border);margin:12px 0}legend{padding:0 6px}
.model{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}.model small{color:var(--vscode-descriptionForeground)}
</style></head><body>
<div class="row"><b>Kural Model Router</b><button id="refresh">Refresh models</button></div>
<p class="muted">Choose Auto in the chat's model menu. Routing decisions stay on this computer; only the answering model receives the dispatched request.</p>
<div class="row"><label for="assistant">Router assistance</label><select id="assistant"><option value="native">Native only — no download</option><option value="minilm">MiniLM — local semantic matching</option></select><button id="download">Download helper</button><button id="tabPanel">Tab Completion settings</button></div>
<p id="helper" class="muted"></p><p id="connection" class="muted"></p>
<div class="row"><label for="profile">Default Auto profile</label><select id="profile"><option value="balanced">Balanced</option><option value="speed">Speed</option><option value="quality">Quality</option></select><span id="profileNote" class="muted"></span></div>
<div class="row"><label><input id="saveTokens" type="checkbox"> Prefer token efficiency</label><label><input id="allowCloud" type="checkbox"> Allow cloud answering models</label></div>
<fieldset><legend>Allowed models and your ratings</legend><div id="models"></div><button id="all">Use all configured models</button><button id="resetRatings">Reset model ratings</button>
<p class="muted">Ratings are hints: quality, speed, and token efficiency, from Low to High. Adjust them to your experience. Token savings are a preference, not a guarantee. Unchecking every model prevents Auto requests.</p></fieldset>
<fieldset><legend>Where to use the router</legend>
<div class="row"><label><input id="search" type="checkbox"> Search &amp; Ask ranking</label><label><input id="context" type="checkbox"> Retrieve useful chat context</label></div>
<div class="row"><label><input id="checkpoints" type="checkbox"> Reassess after failed tool steps</label><label><input id="tab" type="checkbox"> Use native policy for Auto Tab engine selection</label></div>
<p class="muted">Live model changes between completed tool steps support Claude and local models within their provider. Cross-provider handoffs occur between messages. Tab engine selection uses native rules without waiting for helper inference.</p></fieldset>
<div class="row"><label for="timeoutMs">Local assistance deadline (ms)</label><input id="timeoutMs" type="number" min="100" max="10000" step="50"><span class="muted">Unavailable helpers fall back to native policy.</span></div>
<p id="last"></p><p id="stats" class="muted"></p><p id="usage" class="muted"></p>
<script nonce="${nonce}">
const api=acquireVsCodeApi(),$=id=>document.getElementById(id);let S;
const send=(key,value)=>{S.options[key]=value;api.postMessage({type:'set',key,value});};
const notes={balanced:'Suitable quality, then speed',speed:'Prefer quick responses',quality:'Prefer capability, even when slower'};
window.addEventListener('message',e=>{if(e.data.type!=='state')return;S=e.data;const o=S.options;
$('connection').textContent=!S.trusted?'Restricted Mode: native policy only':S.assistant?(S.assistant.ok?'Local assistance succeeded':S.assistant.reason):'Native policy ready; helpers are optional';
$('assistant').value=o.assistant;$('download').disabled=!S.trusted||S.downloading||o.assistant!=='minilm';
$('helper').textContent=o.assistant==='native'?'Native capability checks and profile rules; no model inference.':'Uses all-minilm:22m through Ollama for task matching and snippet ranking. Ambiguous matches use native routing. Similarity scores are not success probabilities.';
$('profile').value=o.profile;$('profileNote').textContent=notes[o.profile];
for(const k of ['saveTokens','allowCloud','search','context','checkpoints','tab'])$(k).checked=!!o[k];
if(document.activeElement!==$('timeoutMs'))$('timeoutMs').value=o.timeoutMs;
$('models').replaceChildren(...S.models.map(m=>{const row=document.createElement('div');row.className='model';const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=o.allowedModels===null||o.allowedModels.includes(m.id);
input.onchange=()=>{const allowed=S.options.allowedModels===null?S.models.map(x=>x.id):[...S.options.allowedModels];send('allowedModels',input.checked?[...new Set([...allowed,m.id])]:allowed.filter(x=>x!==m.id));};
label.append(input,document.createTextNode(' '+m.label));const hint=document.createElement('small');hint.textContent=m.ready?(m.local?'on this computer':m.provider):'not set up';row.append(label,hint);
for(const k of ['quality','speed','tokens']){const l=document.createElement('label');l.textContent=(k==='tokens'?'Token efficiency':k)+' ';const select=document.createElement('select');select.setAttribute('aria-label',m.label+' '+k);
for(const [i,name] of ['Low','Medium','High'].entries()){const option=document.createElement('option');option.value=String(i+1);option.textContent=name;select.append(option);}select.value=String(m.traits[k]);
select.onchange=()=>send('modelPreferences',{...S.options.modelPreferences,[m.id]:{...(S.options.modelPreferences[m.id]||{}),[k]:Number(select.value)}});l.append(select);row.append(l);}return row;}));
$('last').textContent=S.last?(S.last.model||'No eligible model')+' · '+(S.last.reason||S.last.error)+' · '+S.last.ms.toFixed(1)+' ms':'No decisions yet';
$('stats').textContent=S.median===null?'No timing samples yet':'Routing time: median '+S.median.toFixed(1)+' ms · p95 '+S.p95.toFixed(1)+' ms (not answer time)';
$('usage').textContent='This window: '+S.usage.decisions+' decisions · '+S.usage.calls+' accepted helper results · '+S.usage.inputTokens+' successful local input tokens · '+S.usage.fallbacks+' native fallbacks'+(S.rank?' · last ranking '+S.rank.ms.toFixed(1)+' ms':'');});
for(const k of ['profile','assistant'])$(k).onchange=e=>send(k,e.target.value);
for(const k of ['saveTokens','allowCloud','search','context','checkpoints','tab'])$(k).onchange=e=>send(k,e.target.checked);
$('timeoutMs').onchange=e=>send('timeoutMs',Number(e.target.value));$('all').onclick=()=>send('allowedModels',null);$('resetRatings').onclick=()=>send('modelPreferences',{});
$('refresh').onclick=()=>api.postMessage({type:'refresh'});$('download').onclick=()=>{api.postMessage({type:'download'});$('download').disabled=true;};$('tabPanel').onclick=()=>api.postMessage({type:'tabPanel'});api.postMessage({type:'ready'});
</script></body></html>`;
}
module.exports={RouterPanel,_page:page,_validPreferences:validPreferences};
