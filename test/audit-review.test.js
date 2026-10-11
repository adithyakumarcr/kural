const assert=require('assert'),Module=require('module');
class Position { constructor(line,character){this.line=line;this.character=character;} }
class Range { constructor(a,b,c,d){this.start=typeof a==='number'?new Position(a,b):a;this.end=typeof a==='number'?new Position(c,d):b;} }
let provider,willSave,applied=0,failApply=false,warning='',commands=[];
const handlers={};
const vscode={EndOfLine:{LF:1,CRLF:2},Position,Range,TextEdit:{delete:r=>({range:r})},
 EventEmitter:class{constructor(){this.event=()=>{}}fire(){}dispose(){}},WorkspaceEdit:class{constructor(){this.edits=[]}replace(uri,range,text){this.edits.push({uri,range,text})}},CodeLens:class{},
 Uri:{from:o=>({...o,toString:()=>`${o.scheme}:${o.path}?${o.query}`})},
 languages:{registerCodeLensProvider:()=>({})},
 window:{visibleTextEditors:[],createTextEditorDecorationType:()=>({}),onDidChangeVisibleTextEditors:()=>({}),showWarningMessage:s=>{warning=s},showInformationMessage:()=>{}},
 workspace:{getConfiguration:()=>({get:(_,d)=>d}),textDocuments:[],
 registerTextDocumentContentProvider:(_,p)=>{provider=p;return{}},onDidChangeTextDocument:f=>{handlers.change=f;return{}},onDidCloseTextDocument:()=>({}),
 onWillSaveTextDocument:f=>{willSave=f;return{}},
 applyEdit:async edit=>{applied++;if(failApply)return false;for(const e of edit.edits){doc.text=doc.text.slice(0,doc.offsetAt(e.range.start))+e.text+doc.text.slice(doc.offsetAt(e.range.end));doc.version++;}return true;},
 },commands:{registerCommand:()=>({}),executeCommand:async(...a)=>commands.push(a)},env:{appRoot:'/unused'},OverviewRulerLane:{Left:1}};
const load=Module._load;Module._load=function(n,...a){return n==='vscode'?vscode:load.call(this,n,...a)};
const {ReviewManager}=require('../extension/lib/edit/review');
const doc={uri:{path:'/test.js',toString:()=>'/test.js'},text:'old\nlast\n',version:1,eol:1,getText(){return this.text},get lineCount(){return this.text.split('\n').length},
 lineAt(l){const text=this.text.split('\n')[l];return{text,range:{end:new Position(l,text.length)}}},offsetAt(p){const ls=this.text.split('\n');return ls.slice(0,p.line).reduce((n,s)=>n+s.length+1,0)+p.character}};
vscode.workspace.textDocuments=[doc];
(async()=>{
 const review=new ReviewManager();review.register({subscriptions:[]});
 await review.propose(doc,0,1,'new');assert.strictEqual(doc.text,'old\nlast\n');assert.strictEqual(applied,0,'proposing must never edit the real file');
 assert.strictEqual(provider.provideTextDocumentContent(review.pending.preview),'new\nlast\n');
 // Auto Save of the original document leaves its content unchanged and never implicitly accepts.
 if(willSave)willSave({document:doc,reason:2,waitUntil:()=>{throw Error('auto save edited original')}});
 assert.ok(review.busy());assert.strictEqual(doc.text,'old\nlast\n');
 await review.finish(false);assert.strictEqual(doc.text,'old\nlast\n');assert.strictEqual(applied,0);
 await review.propose(doc,0,1,'new');await review.finish(true);assert.strictEqual(doc.text,'new\nlast\n');assert.strictEqual(applied,1);
 await review.propose(doc,0,1,'another');doc.text='user\nlast\n';doc.version++;assert.strictEqual(await review.finish(true),false);assert.strictEqual(doc.text,'user\nlast\n');assert.match(warning,/changed/);
 await review.propose(doc,0,1,'another');failApply=true;assert.strictEqual(await review.finish(true),false);assert.ok(review.busy());failApply=false;await review.finish(false);
 await review.propose(doc,1,1,'inserted');assert.strictEqual(review.pending.text,'user\ninserted\nlast\n');handlers.change({document:doc});assert.ok(!review.busy());assert.strictEqual(doc.text,'user\nlast\n');
 assert.ok(commands.some(a=>a[0]==='vscode.diff'));console.log('audit-review: proposal, Auto Save, reject, accept, stale buffer, failed apply and insertion PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
