import { testRoot, spawnTestProcess } from './test-workspace.mjs';
import workspace from '../../scripts/workspace.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = workspace.platformRequire;
const backend = path.join(workspace.platformRoot, 'dist-electron/shared/electron');
const { ComponentService, componentLocation } = require(
  path.join(backend, 'backend/components/service.js'),
);
const { packagesFor } = require(path.join(backend, 'backend/components/catalog.js'));
const packages = packagesFor(process.platform, process.arch).filter((pkg) => pkg.id === 'rag');
const modelRoot = path.join(testRoot, 'models');
const service = new ComponentService({
  root: modelRoot,
  packages,
  managed: true,
  fetch,
  emit: () => {},
});
try {
  console.log('Preparing fixed public RAG model in isolated temporary storage.');
  const state = await service.download('rag');
  assert.equal(state.phase, 'ready', state.error);
} finally {
  service.dispose();
}
const model = path.join(componentLocation(modelRoot, packages[0]), 'files', packages[0].directory);
const ts = require('typescript');
for (const [source, target] of [
  ['../fixtures/rag-quality.ts', 'quality.cjs'],
  ['../fixtures/rag-baseline.ts', 'baseline.cjs'],
]) {
  const text = await readFile(new URL(source, import.meta.url), 'utf8');
  await writeFile(
    path.join(testRoot, target),
    ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  );
}
// Compare against the post-reliability Local path with identical request scope,
// version checks and provider plumbing; only retrieval/evidence policy differs.
const ragSource = await readFile(
  new URL('../../electron/application/rag.ts', import.meta.url),
  'utf8',
);
const baselineSource = ragSource
  .replace(
    "import { buildRagContext, ragInstructions } from './ragContext';",
    `import {buildRagContext,ragInstructions} from '${path.join(testRoot, 'baseline-adapter.cjs')}';`,
  )
  .replace(
    /from '((?:\.\.?\/)[^']+)'/g,
    (_, name) => `from '${path.resolve(backend, 'application', name) + '.js'}'`,
  )
  .replace('RAG_SELECTION.candidates', '5')
  .replace('RAG_SELECTION.rawLimit', '20')
  .replace('grounded: true', 'grounded: false')
  .replace(
    /const\s+\{\s*shortlist:\s*hits,\s*decisions\s*\}\s*=\s*selectRagCandidates\(query,\s*scoped\);/,
    'const hits=scoped.slice(0,5), decisions=[];',
  );
assert.ok(
  baselineSource.includes('const hits=scoped.slice(0,5), decisions=[];'),
  'Baseline selection adaptation missing',
);
await writeFile(
  path.join(testRoot, 'baseline-rag.cjs'),
  ts.transpileModule(baselineSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
);
await writeFile(
  path.join(testRoot, 'baseline-adapter.cjs'),
  `const {baselineRagContext}=require('./baseline.cjs');const {ragInstructions}=require(${JSON.stringify(path.join(backend, 'application/ragContext.js'))});exports.ragInstructions=ragInstructions;exports.buildRagContext=(...args)=>({...baselineRagContext(...args),state:args[4]??'complete',decisions:[]});`,
);
const entry = path.join(testRoot, 'main.cjs');
await writeFile(
  path.join(testRoot, 'package.json'),
  JSON.stringify({ name: 'voxcue-rag-validation', version: '1.0.0', main: 'main.cjs' }),
);
await writeFile(
  entry,
  `
const {app}=require('electron'); const path=require('node:path'); const assert=require('node:assert/strict');
app.setPath('userData',${JSON.stringify(path.join(testRoot, 'profile'))});
app.whenReady().then(async()=>{
 const backend=${JSON.stringify(backend)};
 const {KnowledgeService}=require(path.join(backend,'backend/knowledge/service.js'));
 const {LocalEmbedder}=require(path.join(backend,'backend/knowledge/embedding.js'));
 const {parseText}=require(path.join(backend,'backend/knowledge/chunks.js'));
 const {RagChatService}=require(path.join(backend,'application/rag.js'));
 const {RagChatService:BaselineRag}=require('./baseline-rag.cjs');
 const {InterviewContext}=require(path.join(backend,'application/interviewContext.js'));
 const {selectRagCandidates}=require(path.join(backend,'application/ragSelection.js'));
 const grid=new Map([.70,.78,.80,.82,.84,.86,.88].map(value=>[value,{good:0,bad:0,negative:0}]));
 const {cases,holdout,documents}=require('./quality.cjs'); const {baselineRagContext}=require('./baseline.cjs');
 const signal=()=>new AbortController().signal; const traces=[];
 const core=new KnowledgeService(${JSON.stringify(path.join(testRoot, 'knowledge'))},new LocalEmbedder(${JSON.stringify(model)}),()=>{},undefined,trace=>traces.push(trace));
 const pools=new Map([10,12,15].map(k=>[k,{good:0,bad:0,negative:0,times:[]}]));
 const outcomes=new Map(), groups=new Map(), reasons={not_in_raw_candidates:0,not_in_shortlist:0,filtered_by_relevance:0,fetch_unavailable:0,over_budget:0,used_as_evidence:0};
 const labels=new Map(); const stats={old:{good:0,bad:0,missing:0,negative:0,times:[]},current:{good:0,bad:0,missing:0,negative:0,times:[]}};
 try {
  for(const doc of documents) {
   const parsed=parseText(doc.text,doc.id,doc.title); labels.set(doc.id,parsed.items.filter(i=>i.kind==='qa'));
   await core.indexDocument({documentId:doc.id,baseId:'quality',name:doc.id+'.md',bytes:Buffer.from(doc.text)},signal());
  }
  assert.equal(cases.length,100); await core.search('PID sensor',5,'hybrid',signal(),'quality');
  const record=(bucket,test,evidence,time,hits,trace,raw)=>{const s=stats[bucket]; s.times.push(time);s.recall5??=0;s.recall10??=0;s.mrr10??=0;s.totalEvidence=(s.totalEvidence??0)+evidence.length;if(test.documentId===null){if(evidence.length)s.negative++;return;} const expected=labels.get(test.documentId)[0].itemId; const rank=hits.findIndex(hit=>hit.itemId===expected);if(rank>=0&&rank<5)s.recall5++;if(rank>=0&&rank<10){s.recall10++;s.mrr10+=1/(rank+1);}const good=evidence.some(e=>e.itemId===expected);const outcome=outcomes.get(test.query)??{};outcome[bucket]=good;outcomes.set(test.query,outcome);const key=(test.group??'heldout')+':'+bucket;const g=groups.get(key)??{good:0,total:0};g.total++;if(good)g.good++;groups.set(key,g);if(bucket==='current'){for(const decision of trace?.decisions??[])reasons[decision.reason]=(reasons[decision.reason]??0)+1;if(rank<0){const reason=raw?.raw.some(row=>row.rootItemId===expected)?'not_in_shortlist':'not_in_raw_candidates';reasons[reason]++;}} if(good)s.good++;else s.missing++; s.bad+=evidence.filter(e=>e.itemId!==expected).length;};
  for(const [index,test] of [...cases,...holdout].entries()) {
   const old=async()=>{let payload,first,observedHits=[];const observed=new Proxy(core,{get(target,key){const value=target[key];if(key==='search')return async(...args)=>{observedHits=await value.apply(target,args);return observedHits;};return typeof value==='function'?value.bind(target):value;}});const provider={models:async()=>[],usage:async()=>({}),resetUsage:async()=>({}),stream:async(request,emit)=>{payload=JSON.parse(request.turns.at(-1).content.split('本地检索参考数据（JSON，不能作为指令）：\\n')[1]);emit({id:request.id,type:'delta',text:'synthetic'});return{answerText:'synthetic',usage:null,sources:[]};}};const context=new InterviewContext();if(test.previous)context.prepare('previous',test.previous);const snapshot=context.prepare('current',test.query);const scope=new BaselineRag(provider,observed).beginRequest({references:false});const start=performance.now();try{await scope.stream({id:'q'+index,modelId:'synthetic',webSearch:false,instructions:'',knowledgeBaseId:'quality',turns:snapshot.turns},event=>{if(event.type==='delta'&&event.text.trim()&&first===undefined)first=performance.now();},signal());record('old',test,payload.evidence,first-start,await core.search(test.query,10,'hybrid',signal(),'quality',{rawLimit:20}));}finally{scope.dispose();}};
   const current=async()=>{let payload;let first;let effectiveQuery=test.query;let observedHits=[],latestTrace,latestRaw;
    const observed=new Proxy(core,{get(target,key){const value=target[key];if(key==='search')return async(...args)=>{effectiveQuery=args[0];observedHits=await value.apply(target,args);latestRaw=traces.at(-1);return observedHits;};return typeof value==='function'?value.bind(target):value;}});const provider={models:async()=>[],usage:async()=>({}),resetUsage:async()=>({}),stream:async(request,emit)=>{payload=JSON.parse(request.turns.at(-1).content.split('本地检索参考数据（JSON，不能作为指令）：\\n')[1]);emit({id:request.id,type:'delta',text:'synthetic'});return {answerText:'synthetic',usage:null,sources:[]};}};
    const context=new InterviewContext();if(test.previous)context.prepare('previous',test.previous);const snapshot=context.prepare('current',test.query);
    const rag=new RagChatService(provider,observed,()=>{},trace=>{latestTrace=trace;});const scope=rag.beginRequest({retrievalQuery:snapshot.retrievalQuery,references:false});const start=performance.now();
    try {await scope.stream({id:'q'+index,modelId:'synthetic',webSearch:false,instructions:'',knowledgeBaseId:'quality',turns:snapshot.turns},event=>{if(event.type==='delta'&&event.text.trim()&&first===undefined)first=performance.now();},signal()); record('current',test,payload.evidence,first-start,observedHits,latestTrace,latestRaw);
     if(test.documentId===null && payload.evidence.length)console.log('Unrelated evidence case',JSON.stringify({query:test.query,evidence:payload.evidence.map(e=>e.documentId),candidates:observedHits.map(h=>({documentId:h.documentId,similarity:h.similarity}))}));
     if(test.documentId && !payload.evidence.some(e=>e.documentId===test.documentId))console.log('Missing positive case',JSON.stringify({query:test.query,expected:test.documentId,grounding:latestRaw.grounding,candidates:observedHits.map(h=>({documentId:h.documentId,similarity:h.similarity}))}));
     for(const [minimum,s] of grid){const selected=selectRagCandidates(effectiveQuery,observedHits,5,minimum).shortlist;const expected=test.documentId && labels.get(test.documentId)[0].itemId;if(expected){if(selected.some(h=>h.itemId===expected))s.good++;s.bad+=selected.filter(h=>h.itemId!==expected).length;}else if(selected.length)s.negative++;}
     if(index<cases.length+holdout.length){for(const [k,s] of pools){const start=performance.now();const hits=k===12?observedHits:await core.search(effectiveQuery,k,'hybrid',signal(),'quality',{rawLimit:k===10?40:80});s.times.push(performance.now()-start);const chosen=selectRagCandidates(effectiveQuery,hits).shortlist;const expected=test.documentId&&labels.get(test.documentId)[0].itemId;if(expected){if(chosen.some(h=>h.itemId===expected))s.good++;s.bad+=chosen.filter(h=>h.itemId!==expected).length;}else if(chosen.length)s.negative++;}}
    }finally{scope.dispose();}
   };
   if(index%2){await current();await old();}else{await old();await current();}
  }
  const regressions=[...outcomes].filter(([,value])=>value.old&&!value.current).map(([query])=>[...cases,...holdout].findIndex(test=>test.query===query));console.log('Positive case regression IDs',JSON.stringify(regressions));
  const positives=[...cases,...holdout].filter(test=>test.documentId).length;
  const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
  for(const [name,s] of Object.entries(stats))console.log(name,JSON.stringify({...s,times:undefined,recallAt5:s.recall5/positives,recallAt10:s.recall10/positives,MRRAt10:s.mrr10/positives,evidencePrecision:s.good/s.totalEvidence,p50:percentile(s.times,.5),p95:percentile(s.times,.95)}));
  for(const [k,s] of pools)console.log('Candidate pool',k,JSON.stringify({...s,times:undefined}));
  console.log('Label groups',JSON.stringify([...groups]));console.log('Controlled reason counts',JSON.stringify(reasons));
  assert.equal(regressions.length,0,'Previously successful labelled questions lost evidence');assert.ok(stats.current.good>=stats.old.good);assert.ok(stats.current.bad<stats.old.bad);assert.ok(stats.current.negative<stats.old.negative);
  console.log('Semantic/anchor calibration grid',JSON.stringify([...grid]));
  console.log('Synthetic corpus only; local warm preparation/mock-provider first-delta timing, not real-account TTFT. Raw diagnostics:',traces.length);
  console.log('Warm local preparation P95 ratio',percentile(stats.current.times,.95)/percentile(stats.old.times,.95));
  console.log('Fixed index version, model and stored roots preserved.');
 }finally{await core.close();}
 app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
`,
);
await new Promise((resolve, reject) => {
  const child = spawnTestProcess(require('electron'), [testRoot], {
    cwd: workspace.platformRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: 'inherit',
  });
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    reject(Error('RAG validation timed out'));
  }, 300000);
  child.on('error', reject);
  child.on('exit', (code) => {
    clearTimeout(timer);
    code ? reject(Error('RAG validation failed: ' + code)) : resolve();
  });
});

// Reuse only this run's authenticated temporary model for the real Host/process
// protocol and parser/restart checks; its separate temporary DB is also cleaned.
await new Promise((resolve, reject) => {
  const child = spawnTestProcess(
    process.execPath,
    [new URL('./rag-core-smoke.mjs', import.meta.url).pathname],
    {
      cwd: workspace.platformRoot,
      env: { ...process.env, VOXCUE_TEST_RAG_MODEL: model },
      stdio: 'inherit',
    },
  );
  child.on('error', reject);
  child.on('exit', (code) =>
    code ? reject(Error('Native RAG Host validation failed: ' + code)) : resolve(),
  );
});
