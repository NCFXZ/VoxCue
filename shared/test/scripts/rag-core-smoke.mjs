import { testRoot, spawnTestProcess } from './test-workspace.mjs';
import workspace from '../../scripts/workspace.mjs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = workspace.platformRequire;
const root = process.cwd();
await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const output = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/rag-native-')));
const config = {
  output,
  root,
  model:
    process.env.VOXCUE_TEST_RAG_MODEL ??
    path.resolve('../shared/local-models/rag/multilingual-e5-small'),
  host: path.resolve('dist-electron/shared/electron/backend/knowledge/host.js'),
};
await writeFile(
  path.join(output, 'package.json'),
  JSON.stringify({ name: 'rag-native-acceptance', version: '1.0.0', main: 'main.cjs' }),
);
await writeFile(path.join(output, 'config.json'), JSON.stringify(config));
await writeFile(
  path.join(output, 'main.cjs'),
  `
const {app,dialog}=require('electron');dialog.showErrorBox=(title,message)=>{console.error(title,message);app.exit(91);};process.on('uncaughtException',error=>{console.error(error.stack);app.exit(92);});const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
const config=require('./config.json');app.setPath('userData',path.join(config.output,'userData'));
app.whenReady().then(async()=>{
 const {KnowledgeHost}=require(config.host);const {KnowledgeError}=require(path.join(config.root,'dist-electron/shared/electron/backend/knowledge/errors.js'));const events=[];let host=new KnowledgeHost(path.join(config.output,'knowledge'),config.model,e=>events.push(e));
 const signal=()=>new AbortController().signal;const input=(id,text)=>({documentId:id,baseId:'smoke',name:id+'.md',bytes:Buffer.from(text)});
 const results=[];const fixtures=require(path.join(config.root,'../shared/test/scripts/rag-fixtures.cjs'));
 try{
  const starting=host.initialize();host.child.stderr.on('data',d=>process.stderr.write(d));await starting;
  const pdf=await host.indexDocument({documentId:'pdf',baseId:'smoke',name:'fixture.pdf',bytes:fixtures.pdf()},signal());
  assert.equal(pdf.itemCount,2);const pdfHits=await host.search('gain',5,'keyword',signal());assert.equal(pdfHits[0].page,2);
  await host.removeDocument('pdf',signal());
  const docx=await host.indexDocument({documentId:'docx',baseId:'smoke',name:'fixture.docx',bytes:await fixtures.docx()},signal());assert.ok(docx.chunkCount);await host.removeDocument('docx',signal());
  const body='传感器提离采用 PID 闭环控制。 '+'The eddy current sensor uses PID feedback to control lift-off. '.repeat(150)+' tailguardxyz is retained.';
  const a=input('sensor','## Q001. How do you control sensor lift-off?\\n\\n'+body+'\\n\\n### 追问 1：怎样限幅？\\n\\n限制输出并保留完整追问。');
  const first=await host.indexDocument(a,signal());assert.ok(first.chunkCount>first.itemCount);
  const committed=await host.version('smoke',signal());assert.match(committed,/^[a-f0-9]{64}$/);
  const prepared=await host.prepareQuery('上一题：PID 控制\\n当前追问：这种方法怎样限幅？','这种方法怎样限幅？',signal());assert.ok(prepared.includes('PID'));
  const childHit=(await host.search('怎样限幅',5,'hybrid',signal(),'smoke',{rawLimit:60}))[0];assert.ok(childHit.matchedItemId);assert.match(childHit.revision,/^[a-f0-9]{64}$/);
  const expected={baseId:'smoke',documentId:'sensor',revision:childHit.revision};
  const detailed=await host.getItem(childHit.itemId,signal(),expected);assert.ok(detailed.rootContent.includes('tailguardxyz'));assert.equal(detailed.source.baseId,'smoke');
  assert.equal(await host.getItem(childHit.itemId,signal(),{...expected,baseId:'other'}),null);

  await assert.rejects(host.search('sensor',0,'hybrid',signal()),e=>e instanceof KnowledgeError&&e.code==='invalid_request');
  assert.equal((await host.indexDocument(a,signal())).updatedAt,first.updatedAt);
  for(const query of ['传感器提离如何闭环控制','How is sensor lift-off controlled?','Eddy Current PID 控制'])for(const mode of ['keyword','vector','hybrid']){
    const hits=await host.search(query,5,mode,signal());assert.ok(hits.length);const item=await host.getItem(hits[0].itemId);assert.ok(item.content.includes('tailguardxyz'));results.push({mode,count:hits.length});
  }
  const {RagChatService}=require(path.join(config.root,'dist-electron/shared/electron/application/rag.js'));
  let sent;const provider={models:async()=>[],usage:async()=>({}),resetUsage:async()=>({}),stream:async(req,emit,sig)=>{sig.throwIfAborted();sent=req;emit({id:req.id,type:'delta',text:'synthetic provider output'});return {usage:null,sources:[],answerText:'synthetic provider output'};}};
  const rag=new RagChatService(provider,host);
  const request={id:'native-rag',knowledgeBaseId:'smoke',modelId:'synthetic-provider',instructions:'Answer the question',webSearch:false,turns:[{role:'user',content:'How is sensor lift-off controlled?'}]};
  const completion=await rag.stream(request,()=>{},signal());assert.ok(sent.turns[0].content.includes('tailguardxyz'));assert.ok(sent.turns[0].content.includes('完整追问'));assert.equal(completion.rag.evidenceCount,1);results.push({rag:completion.rag,provider:'synthetic, no live account'});
  await host.close();host=new KnowledgeHost(path.join(config.output,'knowledge'),config.model);
  assert.equal((await host.listDocuments()).length,1);
  await host.updateDocument(input('sensor','## Q001. PID sensor update?\\n\\nnewrevisionxyz replaces old parameters.'),signal());
  assert.notEqual(await host.version('smoke',signal()),committed);assert.equal(await host.getItem(childHit.itemId,signal(),expected),null);
  assert.equal((await host.search('tailguardxyz',5,'keyword',signal())).length,0);
  assert.ok((await host.search('newrevisionxyz',5,'keyword',signal())).length);
  await host.removeDocument('sensor',signal());assert.equal((await host.listDocuments()).length,0);
  assert.equal((await host.search('sensor',5,'hybrid',signal())).length,0);
  await host.close();
  const missing=new KnowledgeHost(path.join(config.output,'missing-db'),path.join(config.output,'missing-model'));
  try{await assert.rejects(missing.indexDocument(input('x','## Q001. Sensor?\\n\\nA complete local answer.'),signal()),e=>e instanceof KnowledgeError&&e.code==='not_ready'&&/知识库检索未安装/.test(e.message));}finally{await missing.close();}
  const damagedRoot=path.join(config.output,'damaged-catalog');await fs.mkdir(damagedRoot);await fs.writeFile(path.join(damagedRoot,'catalog.json'),'null');
  const damaged=new KnowledgeHost(damagedRoot,config.model);try{await assert.rejects(damaged.initialize(),e=>e instanceof KnowledgeError&&e.code==='configuration');assert.equal(await fs.readFile(path.join(damagedRoot,'catalog.json'),'utf8'),'null');}finally{await damaged.close();}
  console.log(JSON.stringify({status:'passed',node:process.version,electron:process.versions.electron,results,events:events.map(e=>({phase:e.phase,completed:e.completed,total:e.total})),longAnswerChunks:first.chunkCount},null,2));app.exit(0);
 }catch(error){await host.close().catch(()=>{});console.error(JSON.stringify({status:'failed',error:String(error),stack:error.stack},null,2));app.exit(1);}
});`,
);
const env = { ...process.env, RUST_LOG: 'error' };
delete env.ELECTRON_RUN_AS_NODE;
const code = await new Promise((resolve, reject) => {
  const child = spawnTestProcess(require('electron'), [output], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const timer = setTimeout(() => {
    console.error(log);
    child.kill();
    reject(Error('RAG native smoke timeout'));
  }, 180000);
  child.on('error', reject);
  child.on('exit', async (code) => {
    clearTimeout(timer);
    await console.log(log);
    resolve(code);
  });
});
console.log(output);
if (code) process.exitCode = 1;
