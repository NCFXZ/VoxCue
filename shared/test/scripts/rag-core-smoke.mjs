import { testRoot, spawnTestProcess } from './test-workspace.mjs';
import workspace from '../../scripts/workspace.mjs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { randomBytes, randomInt } from 'node:crypto';
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
  topic: ['marionette theatre', 'map library', 'lantern workshop', 'botanical gallery'][randomInt(4)],
  shelf: 'cabinet ' + randomInt(1000, 10000),
  marker: 'ledger' + randomBytes(8).toString('hex'),
  replacement: 'ledger' + randomBytes(8).toString('hex'),
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
 const {KnowledgeHost}=require(config.host);
 const {LibraryKnowledgeHost}=require(path.join(path.dirname(config.host),'workerHost.js'));
 const {libraryKey}=require(path.join(path.dirname(config.host),'libraryLayout.js'));
 const {KnowledgeError}=require(path.join(config.root,'dist-electron/shared/electron/backend/knowledge/errors.js'));const events=[];
 const {profileDirectory}=require(path.join(config.root,'dist-electron/shared/electron/accountProfilePaths.js'));
 const storage=path.join(profileDirectory(path.join(config.output,'userData'),'demo'),'knowledge-v1');
 const platform=require(path.join(config.root,'dist-electron/shared/electron/platform/index.js')).selectDesktopPlatform();
 const aliases=[];
 const prepare=platform.prepareKnowledgeDatabase && (folder=>{
  const lease=platform.prepareKnowledgeDatabase(folder);
  assert.ok(lease,'Long account fixture must exercise the Windows native path');
  aliases.push(lease.path);return lease;
 });
 let onProgress;
 const publish=e=>{events.push(e);onProgress?.(e);};
 const openHost=()=>new LibraryKnowledgeHost(storage,config.model,publish,prepare);
 let host=openHost();
 const signal=()=>new AbortController().signal;const input=(id,text)=>({documentId:id,baseId:'smoke',name:id+'.md',bytes:Buffer.from(text)});
 const results=[];const fixtures=require(path.join(config.root,'../shared/test/scripts/rag-fixtures.cjs'));
 try{
  await host.initialize();
  const batchId = 'formats-batch';
  const formatIds = ['doc', 'docx', 'pdf', 'text'];
  await host.beginIndexBatch(batchId, 'smoke', formatIds, signal());
  const pdfPages=['Dispatch ledger for the '+config.topic, 'Packing slip '+config.marker];
  const docxText=['物品交接名册 '+config.topic, '本轮待检柜位 '+config.shelf];
  const textMarker = 'text' + config.marker;
  const docMarker = 'word' + config.marker;
  await host.indexDocument({documentId:'text',baseId:'smoke',name:'fixture.txt',bytes:Buffer.from('Packing slip '+textMarker),batchId},signal());
  await host.indexDocument({documentId:'doc',baseId:'smoke',name:'fixture.doc',bytes:fixtures.doc('物品交接名册 '+docMarker),batchId},signal());
  const pdf=await host.indexDocument({documentId:'pdf',baseId:'smoke',name:'fixture.pdf',bytes:fixtures.pdf(pdfPages),batchId},signal());
  const docx=await host.indexDocument({documentId:'docx',baseId:'smoke',name:'fixture.docx',bytes:await fixtures.docx(docxText),batchId},signal());
  assert.equal((await host.listDocuments()).length, 0);
  assert.deepEqual(await host.search(config.marker, 5, 'hybrid', signal(), 'smoke'), []);
  await host.finishIndexBatch(batchId, true, signal());
  assert.deepEqual((await host.listDocuments()).map(doc => doc.documentId).sort(), formatIds);
  assert.equal(pdf.itemCount,2);const pdfHits=await host.search(config.marker,5,'keyword',signal());assert.equal(pdfHits[0].page,2);
  for (const [query, documentId] of [[textMarker, 'text'], [docMarker, 'doc']]) {
    const [hit] = await host.search(query, 5, 'keyword', signal(), 'smoke');
    assert.equal(hit?.documentId, documentId);
    const cited = await host.getItem(hit.itemId, signal(), {baseId:'smoke', documentId, revision:hit.revision});
    assert.ok(cited.rootContent.includes(query));
  }
  const cancelled = 'cancelled-formats';
  await host.beginIndexBatch(cancelled, 'smoke', ['cancelled-note', 'next-note'], signal());
  const draft = input('cancelled-note', 'Unpublished receipt '+config.replacement);
  await host.indexDocument({ ...draft, batchId: cancelled }, signal());
  const previous = await host.search(config.marker, 5, 'keyword', signal(), 'smoke');
  assert.equal(previous[0]?.documentId, 'pdf');
  assert.equal((await host.search(config.replacement, 5, 'keyword', signal(), 'smoke')).length, 0);
  await host.finishIndexBatch(cancelled, false, signal());
  assert.deepEqual((await host.listDocuments()).map(doc => doc.documentId).sort(), formatIds);
  assert.equal((await host.search(config.replacement, 5, 'keyword', signal(), 'smoke')).length, 0);
  assert.ok(docx.chunkCount);
  for (const documentId of formatIds) await host.removeDocument(documentId, signal());
  assert.deepEqual(await host.listDocuments(), []);
  const question='Where is the dispatch ledger for the '+config.topic+' stored?';
  const followUp='怎样复核交接凭证？';
  const receipt='逐一比对封签和名册，核对柜位 '+config.shelf+'。';
  const body='本次交接凭证的柜位是 '+config.shelf+'。 '+
    ('The dispatch ledger for the '+config.topic+' is stored in '+config.shelf+'. ').repeat(95)+
    ' Dispatch seal '+config.marker+'.';
  const a=input('ledger','## Q001. '+question+'\\n\\n'+body+'\\n\\n### 追问 1：'+followUp+'\\n\\n'+receipt);
  const first=await host.indexDocument(a,signal());assert.ok(first.chunkCount>first.itemCount);
  const committed=await host.version('smoke',signal());assert.match(committed,/^[a-f0-9]{64}$/);
  const follow=await host.search(followUp,6,'hybrid',signal(),'smoke',{rawLimit:60,grounded:true,history:[question]});assert.equal(follow[0]?.documentId,'ledger');
  const childHit=(await host.search(followUp,5,'hybrid',signal(),'smoke',{rawLimit:60}))[0];assert.ok(childHit.matchedItemId);assert.match(childHit.revision,/^[a-f0-9]{64}$/);
  const expected={baseId:'smoke',documentId:'ledger',revision:childHit.revision};
  const detailed=await host.getItem(childHit.itemId,signal(),expected);assert.ok(detailed.rootContent.includes(config.marker));assert.equal(detailed.source.baseId,'smoke');
  assert.equal(await host.getItem(childHit.itemId,signal(),{...expected,baseId:'other'}),null);
  assert.equal((await host.search(question,5,'hybrid',signal(),'other')).length,0);

  await assert.rejects(host.search(question,0,'hybrid',signal()),e=>e instanceof KnowledgeError&&e.code==='invalid_request');
  assert.equal((await host.indexDocument(a,signal())).updatedAt,first.updatedAt);
  for(const query of ['交接凭证的柜位',question,config.topic+' 交接'])for(const mode of ['keyword','vector','hybrid']){
    const hits=await host.search(query,5,mode,signal());assert.ok(hits.length);const item=await host.getItem(hits[0].itemId);assert.ok(item.content.includes(config.marker));results.push({mode,count:hits.length});
  }
  const {RagChatService}=require(path.join(config.root,'dist-electron/shared/electron/application/rag.js'));
  let sent;const provider={models:async()=>[],usage:async()=>({}),resetUsage:async()=>({}),stream:async(req,emit,sig)=>{sig.throwIfAborted();sent=req;emit({id:req.id,type:'delta',text:'synthetic provider output'});return {usage:null,sources:[],answerText:'synthetic provider output'};}};
  const rag=new RagChatService(provider,host);
  const request={id:'native-rag',knowledgeBaseId:'smoke',modelId:'synthetic-provider',instructions:'Answer the question',webSearch:false,turns:[{role:'user',content:question}]};
  const completion=await rag.stream(request,()=>{},signal());assert.ok(sent.turns[0].content.includes(config.marker));assert.ok(sent.turns[0].content.includes(receipt));assert.equal(completion.rag.evidenceCount,1);results.push({rag:completion.rag,provider:'synthetic, no live account'});
  const [source] = completion.localSources;
  assert.equal(source.reference, 'KB1');
  assert.equal(source.documentId, expected.documentId);
  assert.equal(source.revision, expected.revision);
  const cited = await host.getItem(source.itemId, signal(), {
    baseId: source.baseId, documentId: source.documentId, revision: source.revision,
  });
  assert.ok(cited.rootContent.includes(config.marker));
  await host.close();
  for(const alias of aliases)await assert.rejects(fs.lstat(alias),{code:'ENOENT'});
  assert.ok((await fs.readdir(path.join(storage,'lance'))).some(name=>name.endsWith('.lance')));
  host=openHost();
  assert.equal((await host.listDocuments()).length,1);
  await host.updateDocument(input('ledger','## Q001. '+question+'\\n\\nThe replacement dispatch seal is '+config.replacement+'.'),signal());
  assert.notEqual(await host.version('smoke',signal()),committed);assert.equal(await host.getItem(childHit.itemId,signal(),expected),null);
  assert.equal((await host.search(config.marker,5,'keyword',signal())).length,0);
  assert.ok((await host.search(config.replacement,5,'keyword',signal())).length);
  await host.removeDocument('ledger',signal());assert.equal((await host.listDocuments()).length,0);
  assert.equal((await host.search(question,5,'hybrid',signal())).length,0);
  const {KnowledgeCoordinator}=require(path.join(config.root,'dist-electron/shared/electron/application/knowledge.js'));
  const coordinator=new KnowledgeCoordinator(host,config.model,()=>{});
  const interrupted={...input('in-progress',body),baseId:'interrupted',batchId:'interrupted-batch'};
  const retained={...input('retained-index','Synthetic unrelated retained text.'),baseId:'keep'};
  await host.indexDocument(retained,signal());
  await coordinator.call({op:'begin-index-batch',requestId:interrupted.batchId,baseId:interrupted.baseId,documentIds:[interrupted.documentId,'next-file']});
  let deleting;
  onProgress=event=>{
    coordinator.progress(event);
    if(!deleting&&event.documentId===interrupted.documentId&&event.phase==='embedding'){
      deleting=coordinator.call({op:'remove-base',requestId:'delete-in-progress',baseId:interrupted.baseId});
      void deleting.catch(()=>{});
    }
  };
  await assert.rejects(coordinator.call({op:'import',requestId:'edit-in-progress',...interrupted}));
  assert.ok(deleting,'Issued deletion while the utility was embedding');
  await deleting;
  onProgress=undefined;
  assert.deepEqual((await host.listDocuments()).map(doc=>doc.documentId),[retained.documentId]);
  assert.equal((await host.search(config.marker,5,'keyword',signal(),'interrupted')).length,0);
  assert.ok((await host.search('unrelated retained',5,'keyword',signal(),'keep')).length);
  results.push({deletion:'cancelled a live index batch and preserved the unrelated library'});
  const target = { ...input('target-original', 'Synthetic target-only marker ' + config.marker), baseId: 'target' };
  await host.indexDocument(target, signal());
  const batch = 'keep-during-removal';
  const preserved = { ...input('kept-during-removal', 'Synthetic concurrent indexing marker ' + config.replacement), baseId: 'keep' };
  await coordinator.call({ op: 'begin-index-batch', requestId: batch, baseId: 'keep', documentIds: [retained.documentId, preserved.documentId] });
  let removed = false;
  const removal = coordinator.call({ op: 'remove-base', requestId: 'remove-other-library', baseId: 'target' })
    .then(() => { removed = true; });
  void removal.catch(() => {});
  for (const doc of [retained, preserved])
    await coordinator.call({ op: 'import', requestId: 'index-' + doc.documentId, batchId: batch, ...doc });
  assert.equal(removed, false, 'Deletion is still pending as the unrelated batch publishes');
  await coordinator.call({ op: 'finish-index-batch', requestId: 'commit-keep-batch', batchId: batch, commit: true });
  await removal;
  assert.deepEqual((await host.listDocuments()).map(doc => doc.documentId).sort(), [retained.documentId, preserved.documentId].sort());
  assert.equal((await host.search(config.marker, 5, 'keyword', signal(), 'target')).length, 0);
  assert.equal((await host.search(config.replacement, 5, 'keyword', signal(), 'keep'))[0]?.documentId, preserved.documentId);
  results.push({ deletion: 'unrelated batch published successfully during a pending library erasure' });
  await host.indexDocument(target, signal());
  const beforeSplit = (await host.search(config.replacement, 5, 'keyword', signal(), 'keep'))[0];
  const originals = path.join(config.output, 'originals');
  await fs.mkdir(originals);
  for (const doc of [retained, preserved, target]) await fs.writeFile(path.join(originals, doc.name), doc.bytes);
  await host.close();
  // The layout switch discards generated shared data before the model starts a rebuild.
  host = new KnowledgeHost(storage, path.join(config.output, 'missing-model'), publish, prepare);
  const migrating = performance.now();
  await host.initialize();
  const migrationMs = Math.round(performance.now() - migrating);
  assert.deepEqual(await host.listDocuments(), []);
  const aFolder = path.join(storage, 'libraries', libraryKey('target'));
  const bFolder = path.join(storage, 'libraries', libraryKey('keep'));
  await assert.rejects(fs.lstat(path.join(storage, 'catalog.json')), { code: 'ENOENT' });
  assert.deepEqual((await fs.readdir(path.join(storage, 'lance'))).filter(name => name.endsWith('.lance')), []);
  await host.close();

  const rebuild = async doc => {
    const bytes = await fs.readFile(path.join(originals, doc.name));
    assert.deepEqual(bytes, doc.bytes);
    return host.indexDocument({ ...doc, bytes }, signal());
  };
  const progressStart = events.length;
  host = new KnowledgeHost(storage, config.model, publish, prepare);
  await rebuild(retained);
  await host.close();
  host = new KnowledgeHost(storage, config.model, publish, prepare);
  assert.deepEqual((await host.listDocuments()).map(doc => doc.documentId), [retained.documentId]);
  await rebuild(preserved);
  await rebuild(target);
  assert.deepEqual((await host.listDocuments()).map(doc => doc.documentId).sort(), [retained.documentId, preserved.documentId, target.documentId].sort());
  assert.ok(events.slice(progressStart).some(event => event.documentId === preserved.documentId && event.phase === 'embedding' && event.completed > 0));
  assert.ok(events.slice(progressStart).some(event => event.documentId === preserved.documentId && event.phase === 'ready'));
  for (const folder of [aFolder, bFolder])
    assert.ok((await fs.readdir(path.join(folder, 'lance'))).some(name => name.endsWith('.lance')));
  const rebuiltHit = (await host.search(config.replacement, 5, 'keyword', signal(), 'keep'))[0];
  assert.equal(rebuiltHit.itemId, beforeSplit.itemId);
  assert.notEqual(rebuiltHit.revision, beforeSplit.revision);
  assert.equal(await host.getItem(beforeSplit.itemId, signal(), beforeSplit), null);
  const rebuiltCitation = await host.getItem(rebuiltHit.itemId, signal(), rebuiltHit);
  assert.ok(rebuiltCitation.rootContent.includes(config.replacement));
  results.push({ rebuiltLibraries: 'Retired shared files, indexed the same originals with native progress, and continued incomplete work after restarting', migrationMs });

  // Gate only the target directory's disk cleanup. The tested app code and both
  // database workers run normally, including while the deletion is still pending.
  const independent = new KnowledgeCoordinator(host, config.model, () => {});
  onProgress = event => independent.progress(event);
  const retired = path.join(storage, 'removed-libraries', libraryKey('target'), 'index');
  const reachedDisk = Promise.withResolvers(), releaseDisk = Promise.withResolvers();
  const originalRm = fs.rm;
  let removedOnDisk = false, deletionMs;
  fs.rm = async (file, options) => {
    if (file === retired) {
      reachedDisk.resolve();
      await releaseDisk.promise;
      const started = performance.now();
      await originalRm(file, options);
      deletionMs = Math.round(performance.now() - started);
      return;
    }
    return originalRm(file, options);
  };
  const deletionStarted = performance.now();
  const erasing = independent.call({op:'remove-base', requestId:'parallel-delete', baseId:'target'})
    .then(() => { removedOnDisk = true; });
  let detachMs;
  try {
    const detached = await Promise.race([reachedDisk.promise.then(() => true), erasing.then(() => false)]);
    detachMs = Math.round(performance.now() - deletionStarted);
    assert.equal(detached, true);
    await assert.rejects(fs.lstat(aFolder), { code: 'ENOENT' });
    assert.ok((await fs.lstat(retired)).isDirectory());
    const imported = { ...input('parallel-first', 'A concurrent synthetic marker ' + config.replacement), baseId: 'keep' };
    await independent.call({ op: 'import', requestId: 'parallel-first-request', ...imported });
    assert.equal(removedOnDisk, false, 'The retained library committed while target cleanup was pending');
    assert.ok((await host.listDocuments()).some(doc => doc.documentId === imported.documentId && doc.available));

    const openBatch = 'parallel-keep-batch';
    const draft = { ...input('parallel-draft', 'An unpublished synthetic draft.'), baseId: 'keep', batchId: openBatch };
    await independent.call({ op: 'begin-index-batch', requestId: openBatch, baseId: 'keep', documentIds: [draft.documentId, 'parallel-last'] });
    await independent.call({ op: 'import', requestId: 'parallel-draft-request', ...draft });
    releaseDisk.resolve();
    await erasing;
    assert.equal(removedOnDisk, true, 'Target cleanup completed while the retained batch was still open');
    await assert.rejects(fs.lstat(retired), { code: 'ENOENT' });
    assert.equal((await host.listDocuments()).some(doc => doc.documentId === draft.documentId), false);
    const last = { ...input('parallel-last', 'Synthetic end of retained batch.'), baseId: 'keep', batchId: openBatch };
    await independent.call({ op: 'import', requestId: 'parallel-last-request', ...last });
    await independent.call({ op: 'finish-index-batch', requestId: 'parallel-batch-commit', batchId: openBatch, commit: true });
    assert.ok((await host.listDocuments()).some(doc => doc.documentId === last.documentId && doc.available));
    assert.deepEqual(await host.search(config.marker, 5, 'hybrid', signal(), 'target'), []);
    assert.ok((await host.search(config.replacement, 5, 'hybrid', signal(), 'keep')).some(hit => hit.documentId === imported.documentId));
  } finally {
    releaseDisk.resolve();
    await erasing.catch(() => {});
    fs.rm = originalRm;
    onProgress = undefined;
  }
  await host.close();
  host = new KnowledgeHost(storage, config.model, publish, prepare);
  assert.ok((await host.listDocuments()).every(doc => doc.baseId === 'keep'));
  assert.deepEqual(await host.getItem(rebuiltHit.itemId, signal(), rebuiltHit), rebuiltCitation);
  results.push({ isolatedLibraries: 'Deletion and indexing progressed independently; rebuilt citations survived restart', detachMs, deletionMs });
  await host.close();
  const missing=new LibraryKnowledgeHost(path.join(config.output,'missing-db'),path.join(config.output,'missing-model'));
  try{await assert.rejects(missing.indexDocument(a,signal()),e=>e instanceof KnowledgeError&&e.code==='not_ready'&&/知识库检索未安装/.test(e.message));}finally{await missing.close();}
  const damagedRoot=path.join(config.output,'damaged-catalog');await fs.mkdir(damagedRoot);await fs.writeFile(path.join(damagedRoot,'catalog.json'),'null');
  const damaged=new LibraryKnowledgeHost(damagedRoot,config.model);try{await assert.rejects(damaged.initialize(),e=>e instanceof KnowledgeError&&e.code==='configuration');assert.equal(await fs.readFile(path.join(damagedRoot,'catalog.json'),'utf8'),'null');}finally{await damaged.close();}
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
if (code !== 0) process.exitCode = 1;
