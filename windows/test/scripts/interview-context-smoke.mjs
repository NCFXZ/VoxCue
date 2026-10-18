import { closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { offlineElectronEntry } from '../../../shared/test/scripts/offline-electron-entry.mjs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/interview-context-')));
const fixture = path.join(profile, 'main.cjs');
const codeAnswer = [
  '我用哈希表记录已经遍历的值。',
  '',
  '```python',
  'def two_sum(nums, target):',
  '    seen = {}',
  '    for i, num in enumerate(nums):',
  '        complement = target - num',
  '        if complement in seen:',
  '            return [seen[complement], i]',
  '        seen[num] = i',
  '    return []',
  '```',
  '',
  '平均时间复杂度为 O(n)，空间复杂度为 O(n)。',
].join('\n');
await writeFile(
  fixture,
  `
const {app}=require('electron'); app.setAppPath(${JSON.stringify(process.cwd())});
const {ChatGPTAuthService}=require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/auth/service.js'))});
const {ChatGPTService}=require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/chat/service.js'))});
const {SpeechHost}=require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/speech/host.js'))});
// This context regression uses synthetic speech/provider ports and requires no
// model files. Component download/removal protections have separate regressions.
const {ComponentService}=require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/components/service.js'))});
const componentState=ComponentService.prototype.state;
ComponentService.prototype.state=function(){
  const state=componentState.call(this);
  return {...state,phase:'ready',error:null,items:state.items.map(item=>({...item,phase:'ready',received:item.bytes}))};
};
ComponentService.prototype.status=async function(){return this.state();};
ComponentService.prototype.ready=()=>true;
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/speech/models.js'))}).speechModelInstalled=()=>true;
require(${JSON.stringify(path.resolve('test/fixtures/interview-access-fixture.cjs'))})(${JSON.stringify(path.resolve('dist-electron/windows/electron/speech/access.js'))});
ChatGPTAuthService.prototype.session=async()=>({mode:'chatgpt',user:{id:'fixture',name:'Test',email:''},expiresAt:Date.now()+3600000});
ChatGPTService.prototype.models=async()=>[{id:'test-model',label:'Test Model',description:'',reasoningEfforts:['low']}];
ChatGPTService.prototype.usage=async()=>({requests:0,inputTokens:0,outputTokens:0,totalTokens:0,updatedAt:null});
globalThis.contextRequests=[];
ChatGPTService.prototype.stream=async(request,emit)=>{
  if(request.id.startsWith('history-title-')) return {answerText:'合成面试记录',usage:null,sources:[]};
  globalThis.contextRequests.push(request);
  if(request.turns.at(-1).content.includes('两数之和')) {
    const answerText=${JSON.stringify(codeAnswer)};
    emit({id:request.id,type:'delta',text:answerText.slice(0,answerText.lastIndexOf(String.fromCharCode(96).repeat(3)))});
    await new Promise(resolve=>{globalThis.finishCode=resolve;});
    return {answerText,usage:null,sources:[]};
  }
  return {answerText:'合成 AI 建议 '+globalThis.contextRequests.length+'：可以使用 Redis 缓存。',usage:null,sources:[]};
};
SpeechHost.prototype.call=async function(call){
  globalThis.emitContextSpeech=(event)=>this.emit(event);
  const state=call.op==='start'?'running':call.op==='pause'?'paused':'idle';
  if(call.op!=='devices') this.emit({type:'status',status:{state,model:'Synthetic speech port'}});
  return {state,model:'Synthetic speech port',devices:[]};
};
SpeechHost.prototype.stop=()=>{};
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/main.js'))});
`,
);
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [await offlineElectronEntry(fixture)], env });
try {
  const errors = [];
  const main = await app.firstWindow();
  main.on('pageerror', (error) => errors.push(error.message));
  main.setDefaultTimeout(20000);
  await main
    .getByRole('button', { name: '聊天模型', exact: true })
    .getByText('Test Model', { exact: true })
    .waitFor();
  const open = async () => {
    await main.getByRole('button', { name: '开始面试', exact: true }).click();
    const confirmation = main.getByRole('dialog', { name: '开始面试', exact: true });
    const [floating] = await Promise.all([
      app.waitForEvent('window'),
      confirmation.getByRole('button', { name: '确认开始', exact: true }).click(),
    ]);
    floating.setDefaultTimeout(20000);
    floating.on('pageerror', (error) => errors.push(error.message));
    await floating.getByText('语音模型已就绪', { exact: true }).waitFor();
    await floating.getByRole('button', { name: '静音后自动提交完整问题', exact: true }).click();
    return floating;
  };
  let floating = await open();
  const emit = async (id, source, text, final = true, reason = 'silence') =>
    app.evaluate(
      (_electron, value) => {
        globalThis.emitContextSpeech({
          type: 'segment',
          segment: { ...value, startMs: Date.now(), endMs: Date.now() + 10 },
        });
      },
      { id, source, text, final, reason },
    );
  const send = async (count, text) => {
    if (text) await floating.getByRole('textbox', { name: '面试提问', exact: true }).fill(text);
    await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
    await floating
      .getByText(`合成 AI 建议 ${count}：可以使用 Redis 缓存。`, { exact: true })
      .waitFor();
  };
  await emit('q1', 'system', '你的项目用什么数据库？');
  await floating
    .locator('.transcript-item')
    .getByText('你的项目用什么数据库？', { exact: true })
    .waitFor();
  await send(1);
  assert.equal(
    await floating.locator('.floating-question').first().innerText(),
    '你的项目用什么数据库？',
  );
  await emit('a1', 'microphone', '我实际用 PostgreSQL，没有使用 Redis。');
  await emit('interim', 'microphone', '尚未确认的临时猜测', false);
  assert.equal(
    await app.evaluate(() => globalThis.contextRequests.length),
    1,
    'Microphone cannot trigger an AI answer',
  );
  await floating.getByRole('button', { name: '转写面板', exact: true }).click();
  await emit('q2', 'system', '为什么没有采用它？');
  await send(2, '为什么没有采用它？');
  const second = await app.evaluate(() => globalThis.contextRequests[1]);
  assert.ok(second.instructions.includes('直接给出面试者能当场口述的第一人称答案'));
  assert.ok(second.instructions.includes('60–90秒'));
  assert.ok(second.instructions.includes('明确的时长、篇幅或格式要求优先'));
  assert.ok(second.instructions.includes('使用标注语言、保留换行和缩进的代码块'));
  assert.ok(second.instructions.includes('不反问、索要资料、请求确认或等待回复'));
  assert.ok(second.instructions.includes('不因检索未命中而停止作答'));
  assert.ok(second.instructions.includes('之前的 AI 建议不视为实际发言或本人经历'));
  assert.equal(second.knowledgeBaseId, null);
  const context = JSON.parse(second.turns[0].content.split('\n').slice(1).join('\n'));
  assert.ok(
    context.timeline.some((e) => e.kind === 'interviewee' && e.text.includes('PostgreSQL')),
  );
  assert.ok(context.timeline.some((e) => e.kind === 'ai_suggestion' && e.text.includes('Redis')));
  assert.ok(
    context.timeline.some((e) => e.kind === 'submitted_question' && e.text.includes('数据库')),
  );
  assert.ok(!second.turns[0].content.includes('尚未确认的临时猜测'));
  assert.ok(second.turns.at(-1).content.startsWith('为什么没有采用它？'));
  await floating.getByRole('button', { name: '转写面板', exact: true }).click();
  await floating.getByText('我实际用 PostgreSQL，没有使用 Redis。', { exact: true }).waitFor();
  await app.evaluate(() =>
    globalThis.emitContextSpeech({
      type: 'gap',
      source: 'system',
      message: '系统音频发生短暂间断，转写已继续。',
    }),
  );
  await emit('broken', 'system', '被中断的半句', true, 'discontinuity');
  await floating.getByText('音频间断，片段可能不完整', { exact: true }).waitFor();
  await floating
    .getByRole('status')
    .getByText('系统音频发生短暂间断，转写已继续。', { exact: true })
    .waitFor();
  assert.equal(
    await floating.getByRole('textbox', { name: '面试提问', exact: true }).inputValue(),
    '',
  );
  await floating.screenshot({ animations: 'disabled' });
  const assertNoticeLayout = async () => {
    const boxes = await floating.evaluate(() => {
      const panels = document.querySelector('.floating-panels').getBoundingClientRect();
      const notices = document.querySelector('.floating-notices').getBoundingClientRect();
      return {
        panelBottom: panels.bottom,
        noticeTop: notices.top,
        noticeBottom: notices.bottom,
        height: innerHeight,
      };
    });
    assert.ok(
      boxes.noticeTop >= boxes.panelBottom,
      'Notices must stay below the conversation panels',
    );
    assert.ok(boxes.noticeBottom <= boxes.height, 'Notices must fit inside the floating window');
  };
  await assertNoticeLayout();
  await app.evaluate(() =>
    globalThis.emitContextSpeech({
      type: 'activity',
      source: 'microphone',
      speaking: false,
      level: 0,
    }),
  );
  assert.equal(await floating.locator('.floating-notices .floating-warning').count(), 1);
  await app.evaluate(() =>
    globalThis.emitContextSpeech({ type: 'activity', source: 'system', speaking: false, level: 0 }),
  );
  await floating.locator('.floating-notices').waitFor({ state: 'hidden' });
  await app.evaluate(() =>
    globalThis.emitContextSpeech({
      type: 'status',
      status: { state: 'error', model: 'test', error: '合成系统转写错误' },
    }),
  );
  await floating.getByRole('alert').getByText('合成系统转写错误', { exact: true }).waitFor();
  await assertNoticeLayout();
  await app.evaluate(() =>
    globalThis.emitContextSpeech({ type: 'status', status: { state: 'running', model: 'test' } }),
  );
  await floating.getByRole('alert').waitFor({ state: 'hidden' });
  await floating.reload();
  await floating.getByText('语音模型已就绪', { exact: true }).waitFor();
  await emit('q3', 'system', '那么并发量怎么处理？');
  await send(3, '那么并发量怎么处理？');
  const third = await app.evaluate(() => globalThis.contextRequests[2]);
  assert.ok(
    third.turns[0].content.includes('PostgreSQL'),
    'Reload must preserve main-owned context',
  );
  assert.ok(third.turns[0].content.includes('previousQuestionId'));
  assert.ok(!third.turns[0].content.includes('被中断的半句'));
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  floating = await open();
  await send(4, '新场次：介绍一个排序算法');
  const fresh = await app.evaluate(() => globalThis.contextRequests[3]);
  assert.equal(fresh.turns.length, 1);
  assert.ok(!JSON.stringify(fresh).includes('PostgreSQL'));
  await floating.getByRole('button', { name: '关闭截图保护', exact: true }).click();
  await floating.getByText('此窗口未隐藏', { exact: true }).waitFor();
  await assertNoticeLayout();
  await floating.getByRole('button', { name: '开启截图保护', exact: true }).click();
  await floating.getByText('此窗口未隐藏', { exact: true }).waitFor({ state: 'hidden' });
  await floating.getByRole('button', { name: '关闭截图保护', exact: true }).click();
  const codeQuestion = '用 Python 写两数之和，解释控制在20秒。';
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).fill(codeQuestion);
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  const lastAnswer = floating.locator('.floating-answer-item').last();
  await lastAnswer.locator('.markdown-code-block pre').waitFor();
  assert.equal(await lastAnswer.locator('.floating-question').innerText(), codeQuestion);
  const code = lastAnswer.locator('pre code');
  assert.ok((await code.getAttribute('class')).includes('language-python'));
  assert.ok((await code.textContent()).includes('\n    seen = {}\n'));
  assert.equal(
    await floating.getByRole('button', { name: '停止当前回答', exact: true }).count(),
    1,
  );
  await app.evaluate(() => globalThis.finishCode());
  await lastAnswer
    .getByText('平均时间复杂度为 O(n)，空间复杂度为 O(n)。', { exact: true })
    .waitFor();
  assert.equal(await lastAnswer.getByRole('button', { name: '复制代码', exact: true }).count(), 1);
  assert.equal(
    (await app.evaluate(() => globalThis.contextRequests[4])).turns.at(-1).content,
    codeQuestion,
  );
  assert.equal(await floating.locator('[title], [data-focus-tip]').count(), 0);
  assert.equal(await main.locator('[title], [data-focus-tip]').count(), 0);
  await lastAnswer.locator('.floating-question').scrollIntoViewIfNeeded();
  for (const theme of ['light', 'dark']) {
    await floating.evaluate((theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }, theme);
    await app.evaluate(() =>
      globalThis.emitContextSpeech({
        type: 'gap',
        source: 'system',
        message: '系统音频发生间断，请等待转写恢复。'.repeat(4),
      }),
    );
    await floating
      .getByText('系统音频发生间断，请等待转写恢复。'.repeat(4), { exact: true })
      .waitFor();
    await assertNoticeLayout();
    await floating.screenshot({ animations: 'disabled' });
  }
  for (let i = 0; i < 5; i++) await floating.evaluate(() => window.desktop.resizeInterview(-1));
  await assertNoticeLayout();
  await floating.screenshot({ animations: 'disabled' });
  await app.evaluate(() =>
    globalThis.emitContextSpeech({ type: 'activity', source: 'system', speaking: false, level: 0 }),
  );
  await floating
    .getByText('系统音频发生间断，请等待转写恢复。'.repeat(4), { exact: true })
    .waitFor({ state: 'hidden' });
  assert.equal(await floating.getByText('此窗口未隐藏', { exact: true }).isVisible(), true);
  assert.deepEqual(errors, []);
  const result = {
    status: 'passed',
    nativeSpeech: false,
    liveAccount: false,
    checks: [
      'interviewer question chain',
      'actual candidate answer priority',
      'AI suggestion separately labelled',
      'interim excluded',
      'panel toggle preserves context',
      'gap warning and incomplete exclusion',
      'reload persistence',
      'new session isolation',
      '60–90 second oral length default and explicit user requirement preserved',
      'streaming fenced Python code and indentation',
      'automatic and manual submitted question bubbles',
      'no native or custom hover tips',
      'source-specific gap recovery and speech error recovery',
      'capture notice disappears when protection is enabled',
      'notices below panels in both themes and smaller window',
    ],
  };
  await console.log(JSON.stringify(result, null, 2));
  console.log({ ...result, profile });
} finally {
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await closeUiApp(app);
}
