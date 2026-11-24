import { describe, expect, it, vi } from 'vitest';
import { DeepSeekProfileStream, deepSeekStructureRequest } from '../../electron/backend/api/deepseekProfile';
import { createApiChatService } from '../../electron/backend/api/service';
import { ProfileOutputError } from '../../electron/backend/chat/profile';
import type { UsageLedger } from '../../electron/backend/chat/usage';
import type { ChatEvent, ChatRequest, ChatTurn } from '../../electron/contracts/chat';

const none = '<profile_intent>none</profile_intent>';
const proposal = '<profile_intent>proposal</profile_intent>';
const base = Object.freeze({ name: '合成用户', background: '合成简历摘要', jobDescription: '合成岗位', language: '简体中文' });
const advice = '你的优势在于**工程实践**。\n\n- 能独立交付合成项目\n- 能把复杂问题讲清楚';
const proposed = '已生成职位描述的修改提案，确认保存前资料保持原值。';
const update = (changes: object, answer = proposed, scope: unknown = null) =>
  `${proposal}\n${answer}\n<profile_proposal>\n${JSON.stringify({ changes, skillScope: scope })}\n</profile_proposal>`;
const pieces = (text: string, size: number) => text.match(new RegExp(`[\\s\\S]{1,${size}}`, 'gu')) ?? [];

function parse(text: string, size = text.length) {
  const stream = new DeepSeekProfileStream();
  const visible = pieces(text, size).map(chunk => stream.append(chunk)).join('');
  return { stream, visible };
}

describe('DeepSeek preparation protocol', () => {
  it.each([1, 3, 7, 1000])('streams an ordinary answer as it arrives with %i-character chunks', size => {
    const stream = new DeepSeekProfileStream();
    const outputs = pieces(`  ${none}\n${advice}\n`, size).map(chunk => stream.append(chunk));
    const firstText = outputs.findIndex(output => output);
    expect(outputs.join('')).toBe(advice);
    // Text is released while later chunks are still pending, never only at the end.
    if (size < 100) expect(firstText).toBeLessThan(outputs.length - 3);
    expect(stream.previewReady).toBe(false);
    expect(stream.preview()).toBeUndefined();
    expect(stream.finish(base)).toEqual({ answerText: advice, delta: '', changes: {}, skillScope: null });
  });

  it.each([1, 4, 9])('previews a proposal split across %i-character chunks and saves only the requested field', size => {
    const wire = update({ name: base.name, jobDescription: '硬件工程师' });
    const stream = new DeepSeekProfileStream();
    let visible = '';
    let partial: string | undefined;
    for (const chunk of pieces(wire, size)) {
      visible += stream.append(chunk);
      const value = stream.preview()?.jobDescription;
      if (value && value !== '硬件工程师') {
        partial = value;
        expect(stream.generation?.fields).toContain('jobDescription');
      }
    }
    expect(visible).toBe(proposed);
    if (size < 9) expect(partial).toBeTruthy();
    expect(stream.preview()).toEqual({ name: base.name, jobDescription: '硬件工程师' });
    expect(stream.generation).toEqual({ fields: [], skillIndexes: [] });
    expect(stream.finish(base)).toEqual({
      answerText: proposed, delta: '', changes: { jobDescription: '硬件工程师' }, skillScope: null,
    });
    expect(base.jobDescription).toBe('合成岗位');
  });

  const claim = '已将职位描述更新为“硬件工程师”，请在提案卡片中确认保存。';
  const envelope = JSON.stringify({ answer: '已更新。', changes: { jobDescription: '硬件工程师' } });
  it.each([
    ['plain text that claims an update', claim, '没有标明本轮是否修改资料', claim],
    ['the former JSON envelope', envelope, '没有标明本轮是否修改资料', envelope],
    ['a proposal block after a no-change intent', `${none}\n已更新。\n<profile_proposal>{"changes":{"jobDescription":"硬件工程师"}}</profile_proposal>`, '标明不修改资料却返回了提案', '已更新。'],
    ['a proposal intent without a proposal', `${proposal}\n已将职位描述更新为硬件工程师，请在卡片中确认。`, '没有返回提案内容', '已将职位描述更新为硬件工程师，请在卡片中确认。'],
    ['a truncated proposal', `${proposal}\n${proposed}\n<profile_proposal>{"changes":{"jobDescription":"硬件`, '提案不完整', proposed],
    ['an unknown root member', `${proposal}\n${proposed}\n<profile_proposal>{"changes":{"jobDescription":"硬件工程师"},"answer":"x"}</profile_proposal>`, '提案不完整', proposed],
    ['an unknown profile field', update({ salary: '高' }), '资料更新包含未知字段：salary。', proposed],
    ['a proposal identical to the saved profile', update({ jobDescription: base.jobDescription, name: base.name }), '与当前资料相同', proposed],
    ['conflicting intents', `${none}\n第一段。${proposal}\n第二段。`, '相互矛盾', '第一段。\n第二段。'],
    ['two proposals', `${update({ name: '甲' })}\n<profile_proposal>{"changes":{"name":"乙"}}</profile_proposal>\n结尾。`, '多个资料提案', proposed + '\n结尾。'],
    ['a stray closing tag', `${none}\n正文</profile_proposal>继续。`, '格式无效', '正文继续。'],
  ])('keeps the answer visible but reports %s as an unresolved structure', (_case, wire, issue, shown) => {
    for (const size of [1, 5, wire.length]) {
      const { stream, visible } = parse(wire, size);
      const result = stream.finish(base);
      expect(visible + result.delta).toBe(shown);
      expect(result).toMatchObject({ answerText: shown, changes: {}, skillScope: null });
      expect(result.issue).toContain(issue);
    }
  });

  it('requests a full retry only for a blank answer', () => {
    for (const wire of [`${none}\n  \n`, '  \n', proposal]) {
      const { stream, visible } = parse(wire, 2);
      expect(visible).toBe('');
      expect(() => stream.finish(base)).toThrow(ProfileOutputError);
      expect(() => stream.finish(base)).toThrow('空白回答');
    }
  });

  it('reads a structure follow-up without showing any of its text', () => {
    const follow = (wire: string) => {
      const stream = new DeepSeekProfileStream(true);
      expect(pieces(wire, 3).map(chunk => stream.append(chunk)).join('')).toBe('');
      return stream.finish(base);
    };
    expect(follow(none)).toEqual({ answerText: '', delta: '', changes: {}, skillScope: null });
    expect(follow(update({ jobDescription: '硬件工程师' }, '这段文字不会显示。'))).toEqual({
      answerText: '', delta: '', changes: { jobDescription: '硬件工程师' }, skillScope: null,
    });
    expect(follow('仍然没有标记。').issue).toContain('没有标明本轮是否修改资料');
    expect(follow('').issue).toContain('没有标明本轮是否修改资料');
  });

  it('tolerates fences, raw line breaks in JSON strings, a missing closing tag and repeated identical intent', () => {
    const background = '负责合成检测软件。\n\t维护回归测试。';
    const wire = `${proposal}\n已整理简历摘要。${proposal}\n<profile_proposal>\n\`\`\`json\n{"changes":{"background":"${background}"},"skillScope":null}\n\`\`\``;
    const { stream, visible } = parse(wire, 2);
    expect(visible).toBe('已整理简历摘要。');
    expect(stream.preview()).toEqual({ background });
    expect(stream.finish(base)).toMatchObject({ answerText: '已整理简历摘要。', changes: { background } });

    const literal = `${none}\n比较 a < b，标签 <profile_note> 保留。<`;
    const plain = parse(literal, 3);
    expect(plain.visible + plain.stream.finish(base).delta).toBe('比较 a < b，标签 <profile_note> 保留。<');

    const after = `${update({ name: '新名字' }, '第一部分。')}\n补充说明。`;
    const tail = parse(after, 4);
    expect(tail.visible).toBe('第一部分。\n补充说明。');
    expect(tail.stream.finish(base)).toMatchObject({ answerText: '第一部分。\n补充说明。', changes: { name: '新名字' } });
  });

  it('moves a nested skillScope or source list back out and names any other unknown field', () => {
    const skills = [{ id: 'signals', title: '信号完整性', content: '阻抗匹配与端接。', sources: [] }];
    const summaries = { ...base, background: '已确认简历', jobDescription: '已确认 JD' };
    const nested = parse(update({ skills, skillScope: 'all', sources: [] }, '已生成技能提案。'), 6).stream;
    expect(nested.preview()?.skills).toHaveLength(1);
    expect(nested.finish(summaries)).toEqual({
      answerText: '已生成技能提案。', delta: '', changes: { skills }, skillScope: 'all',
    });
    const unknown = parse(update({ targetRole: '硬件工程师' })).stream;
    expect(unknown.finish(summaries)).toMatchObject({ changes: {}, issue: '资料更新包含未知字段：targetRole。' });
  });

  it('accepts skills whose source list or id needs a harmless repair', () => {
    const summaries = { ...base, background: '已确认简历', jobDescription: '已确认 JD' };
    const wire = update({ skills: [{ id: '闭环控制', title: '闭环控制', content: '正文' }] }, '已生成技能提案。', 'all');
    const result = parse(wire, 5).stream.finish(summaries);
    expect(result).toMatchObject({ changes: { skills: [{ id: 'skill-1', title: '闭环控制', content: '正文', sources: [] }] } });
    expect(result.issue).toBeUndefined();
  });

  it('previews skill items incrementally and keeps their sources for validation', () => {
    const skills = [{ id: 'signals', title: '信号完整性', content: '阻抗匹配与端接。', sources: [] }];
    const wire = update({ skills }, '已生成技能提案。', 'topic');
    const stream = new DeepSeekProfileStream();
    stream.append(wire.slice(0, wire.indexOf('端接')));
    expect(stream.preview()).toEqual({ skills: [{ id: 'signals', title: '信号完整性', content: '阻抗匹配与' }] });
    expect(stream.generation).toEqual({ fields: ['skills'], skillIndexes: [0] });
    stream.append(wire.slice(wire.indexOf('端接')));
    expect(stream.finish(base)).toMatchObject({ changes: { skills }, skillScope: 'topic' });
  });
});

const key = 'synthetic-deepseek-profile-key';
const catalog = () => Response.json({ data: ['deepseek-flash', 'deepseek-v4-pro'].map(id => ({
  id, effort: { supported_levels: ['low', 'high', 'max'] }, input_modalities: ['text'], output_modalities: ['text'],
})) });
const usage = { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 };

// A server stream the test drives chunk by chunk, in either DeepSeek wire format.
function controlledReply(model: string) {
  const encoder = new TextEncoder();
  const cancel = vi.fn();
  let output!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { output = controller; }, cancel }),
    { headers: { 'content-type': 'text/event-stream' } });
  const send = (event: object) => output.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  const pro = model === 'deepseek-v4-pro';
  let text = '';
  return {
    response, cancel,
    push(delta: string) {
      text += delta;
      send(pro
        ? { type: 'response.output_text.delta', delta, item_id: 'synthetic-message', output_index: 0, content_index: 0 }
        : { id: 'synthetic-response', choices: [{ delta: { content: delta }, finish_reason: null }] });
    },
    end() {
      send(pro
        ? { type: 'response.completed', response: { id: 'synthetic-response', status: 'completed', output: [{
            id: 'synthetic-message', type: 'message', role: 'assistant', phase: 'final_answer',
            content: [{ type: 'output_text', text }],
          }], usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 } } }
        : { id: 'synthetic-response', choices: [{ delta: {}, finish_reason: 'stop' }], usage });
      output.close();
    },
  };
}

// A complete reply in the wire format of the endpoint that was actually requested.
const completed = (text: string) => (url: string) => {
  const reply = controlledReply(url.endsWith('/responses') ? 'deepseek-v4-pro' : 'deepseek-flash');
  reply.push(text);
  reply.end();
  return reply.response;
};

function harness(model: string, replies: Array<(url: string) => Response>, turns: ChatTurn[], profile: ChatRequest['profile'] = base) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${key}`);
    if (init?.method !== 'POST') return catalog();
    posts.push({ url: String(url), body: JSON.parse(String(init.body)) });
    const reply = replies[posts.length - 1];
    if (!reply) throw Error('unexpected extra request');
    return reply(String(url));
  });
  const service = createApiChatService('deepseek', async () => ({ key }), { add: vi.fn() } as unknown as UsageLedger, fetcher);
  const events: ChatEvent[] = [];
  const abort = new AbortController();
  const request: ChatRequest = { id: 'deepseek-profile', modelId: model, instructions: '根据当前上下文答复。', profile, webSearch: true, turns };
  const result = service.stream(request, event => events.push(event), abort.signal);
  const settled = vi.fn();
  void result.then(settled, settled);
  return { posts, events, abort, result, settled };
}

const visibleText = (events: ChatEvent[]) => events.reduce((text, event) =>
  event.type !== 'delta' ? text : event.replace ? event.text : text + event.text, '');
const systemText = (body: Record<string, unknown>) =>
  String(body.instructions ?? (body.messages as { content: string }[])[0].content);
const user = (content: string): ChatTurn => ({ role: 'user', content });

describe.each(['deepseek-flash', 'deepseek-v4-pro'])('DeepSeek preparation on %s', model => {
  it('shows ordinary answer text before the server finishes and proposes no change', async () => {
    const reply = controlledReply(model);
    const run = harness(model, [() => reply.response], [user('我的优势是什么')]);
    await vi.waitFor(() => expect(run.posts).toHaveLength(1));
    reply.push(`${none}\n你的优势`);
    await vi.waitFor(() => expect(visibleText(run.events)).toBe('你的优势'));
    reply.push('在于**工程实践**。');
    await vi.waitFor(() => expect(visibleText(run.events)).toBe('你的优势在于**工程实践**。'));
    expect(run.settled).not.toHaveBeenCalled();
    reply.end();
    const result = await run.result;
    expect(result).toMatchObject({ answerText: '你的优势在于**工程实践**。', profileChanges: undefined });
    expect(run.events.some(event => event.type === 'profile-preview')).toBe(false);
    const [{ url, body }] = run.posts;
    expect(url).toBe(model === 'deepseek-v4-pro' ? 'https://api.deepseek.com/responses' : 'https://api.deepseek.com/chat/completions');
    expect(body).not.toHaveProperty('response_format');
    expect(body).not.toHaveProperty('text');
    expect(body.tools).toEqual([{ type: model === 'deepseek-v4-pro' ? 'web_search' : 'deepseek_web_search' }]);
    expect(systemText(body)).toContain(`本轮不提出资料修改时写 ${none}`);
    expect(systemText(body)).not.toContain('JSON Schema');
  });

  it('streams a reviewable proposal for only the requested field and keeps the profile unchanged', async () => {
    const reply = controlledReply(model);
    const profile = { ...base };
    const run = harness(model, [() => reply.response], [user('更新我的JD为硬件工程师')], profile);
    await vi.waitFor(() => expect(run.posts).toHaveLength(1));
    const wire = update({ jobDescription: '硬件工程师', name: base.name });
    const split = [wire.indexOf('提案'), wire.indexOf('<profile_pro') + 5, wire.indexOf('Description') + 4, wire.indexOf('工程师"')];
    let start = 0;
    for (const end of split) {
      reply.push(wire.slice(start, end));
      start = end;
    }
    await vi.waitFor(() => expect(run.events).toContainEqual(expect.objectContaining({
      type: 'profile-preview', preview: { jobDescription: '硬件' },
      generation: { fields: ['jobDescription'], skillIndexes: [] },
    })));
    expect(visibleText(run.events)).toBe(proposed);
    expect(run.settled).not.toHaveBeenCalled();
    reply.push(wire.slice(start));
    reply.end();
    const result = await run.result;
    expect(result.answerText).toBe(proposed);
    expect(result.profileChanges).toEqual({ jobDescription: '硬件工程师' });
    expect(profile).toEqual(base);
    expect(run.posts).toHaveLength(1);
  });

  it.each([
    ['a pending', '[本机操作状态：这份提案尚未保存；用户可以继续普通聊天，不必先确认或拒绝。]', '合成岗位'],
    ['a saved', '[本机操作状态：用户已在应用中确认这份提案，已成功保存：职位描述摘要；其余字段保持原值。不要再要求发送确认或拒绝；当前资料以本次提供的 profile 为准。]', '软件工程师'],
    ['a missing', '', '合成岗位'],
  ])('proposes the latest target role after %s earlier proposal', async (_state, note, savedRole) => {
    const turns: ChatTurn[] = [
      user('把目标岗位改成软件工程师'),
      { role: 'assistant', content: '已生成职位描述的修改提案。' + (note ? '\n\n' + note : '') },
      user('不对，改成硬件工程师'),
    ];
    const profile = { ...base, jobDescription: savedRole };
    const run = harness(model, [completed(update({ jobDescription: '硬件工程师' }))], turns, profile);
    const result = await run.result;
    expect(result.profileChanges).toEqual({ jobDescription: '硬件工程师' });
    expect(profile.jobDescription).toBe(savedRole);
    const system = systemText(run.posts[0].body);
    expect(system).toContain('多轮对话以最新一条用户消息为准');
    expect(system).toContain('没有这一标注的历史回答没有可操作的提案卡片');
    expect(system).toContain('不让用户去操作之前的卡片');
    const history = JSON.stringify(run.posts[0].body);
    if (note) expect(history).toContain(JSON.stringify(note).slice(1, -1));
    expect(history).toContain('不对，改成硬件工程师');
  });

  it('keeps a streamed answer without the intent line and asks only for its structure', async () => {
    const claim = '已将职位描述更新为“硬件工程师”，请在提案卡片中确认保存。';
    const reply = controlledReply(model);
    const run = harness(model, [() => reply.response, completed(update({ jobDescription: '硬件工程师' }, '这段文字不会显示。'))],
      [user('更新我的JD为硬件工程师')]);
    await vi.waitFor(() => expect(run.posts).toHaveLength(1));
    reply.push(claim.slice(0, 9));
    await vi.waitFor(() => expect(visibleText(run.events)).toBe(claim.slice(0, 9)));
    reply.push(claim.slice(9));
    reply.end();
    const result = await run.result;
    expect(result).toMatchObject({ answerText: claim, profileChanges: { jobDescription: '硬件工程师' } });
    expect(visibleText(run.events)).toBe(claim);
    expect(run.events).toContainEqual(expect.objectContaining({
      type: 'activity', activity: expect.objectContaining({ phase: 'organizing', status: 'in_progress' }),
    }));
    const [first, structure] = run.posts;
    expect(first.body.tools).toEqual([{ type: model === 'deepseek-v4-pro' ? 'web_search' : 'deepseek_web_search' }]);
    expect(structure.url).toBe('https://api.deepseek.com/chat/completions');
    expect(structure.body).toMatchObject({ model, stream: true });
    expect(structure.body).not.toHaveProperty('tools');
    expect(structure.body).not.toHaveProperty('response_format');
    const messages = structure.body.messages as { role: string; content: string }[];
    expect(messages.slice(-3)).toEqual([
      { role: 'user', content: '更新我的JD为硬件工程师' },
      { role: 'assistant', content: claim },
      { role: 'user', content: deepSeekStructureRequest },
    ]);
    expect(systemText(structure.body)).not.toContain('本次请求未提供联网检索工具');
  });

  it('keeps a searched ordinary answer when the structure follow-up proposes no change', async () => {
    const answer = '已检索到合成框架的最新公告，下面是要点。';
    const run = harness(model, [completed(answer), completed(none)], [user('帮我联网搜一下合成框架的最新新闻')]);
    const result = await run.result;
    expect(result).toMatchObject({ answerText: answer, profileChanges: undefined });
    expect(visibleText(run.events)).toBe(answer);
    expect(systemText(run.posts[0].body)).toContain('需要最新资料或核验时，使用联网搜索');
    expect(systemText(run.posts[0].body)).not.toContain('本次请求未提供联网检索工具');
    expect(run.posts).toHaveLength(2);
    expect(run.events.some(event => event.type === 'profile-preview')).toBe(false);
  });

  it('reports an unresolved structure after one follow-up and keeps the shown answer', async () => {
    const claim = '已将职位描述更新为“硬件工程师”，请在提案卡片中确认保存。';
    const run = harness(model, [completed(claim), completed(claim)], [user('更新我的JD为硬件工程师')]);
    await expect(run.result).rejects.toThrow('DeepSeek 没有标明本轮是否修改资料，个人信息未修改。');
    expect(run.posts).toHaveLength(2);
    expect(visibleText(run.events)).toBe(claim);
    expect(run.events.some(event => event.type === 'profile-preview')).toBe(false);
  });

  it('cancels while the answer is streaming without retrying or emitting late text', async () => {
    const reply = controlledReply(model);
    const run = harness(model, [() => reply.response], [user('我的优势是什么')]);
    await vi.waitFor(() => expect(run.posts).toHaveLength(1));
    reply.push(`${none}\n正在回答`);
    await vi.waitFor(() => expect(visibleText(run.events)).toBe('正在回答'));
    run.abort.abort();
    await expect(run.result).rejects.toMatchObject({ name: 'AbortError' });
    const before = run.events.length;
    try { reply.push('迟到的正文'); } catch { /* The client already cancelled this stream. */ }
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(run.events).toHaveLength(before);
    expect(reply.cancel).toHaveBeenCalledOnce();
    expect(run.posts).toHaveLength(1);
  });
});
