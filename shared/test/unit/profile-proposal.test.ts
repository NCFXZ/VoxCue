import { describe, expect, it } from 'vitest';
import { ProfileAnswerStream } from '../../../shared/electron/backend/chat/profile';
import { ChatGPTService } from '../../../shared/electron/backend/chat/service';
import type { UsageLedger } from '../../../shared/electron/backend/chat/usage';
import { validateChanges } from '../../../shared/electron/contracts/profile';
const base = {
  name: '旧姓名',
  role: '开发工程师',
  jobDescription: '现有 JD',
  background: '已有项目',
};
const changes = { name: '新姓名', jobDescription: '新的 JD', background: null };
const answer = '**已整理**，请确认。\n```python\nprint("你好")\n```';
describe('资料提案协议', () => {
  it('资料与技能逐字预览正确解码转义，仅完整提案可通过最终校验', () => {
    const stream = new ProfileAnswerStream();
    stream.append('{"answer":"已整理","changes":{"background":"第一行\\n中文\\u4f');
    expect(stream.preview()).toEqual({ background: '第一行\n中文' });
    expect(() => stream.finish(base)).toThrow('不完整');
    stream.append('60","skills":[{"id":"s","title":"控制","content":"闭环\\n逐步');
    expect(stream.preview()).toEqual({
      background: '第一行\n中文你',
      skills: [{ title: '控制', content: '闭环\n逐步' }],
    });
    stream.append('说明","sources":[]}]}}');
    expect(stream.finish(base).changes.background).toBe('第一行\n中文你');
    expect(base.background).toBe('已有项目');
  });
  it('预览过滤未知字段并限制内容，最终非法提案仍拒绝', () => {
    const stream = new ProfileAnswerStream();
    stream.append(
      JSON.stringify({
        answer: '预览',
        changes: { background: '长'.repeat(11000), admin: 'unsafe' },
      }),
    );
    expect(stream.preview()).toEqual({ background: '长'.repeat(10000) });
    expect(() => stream.finish(base)).toThrow();
  });
  it('逐字符 JSON 流只显示 Markdown 回答，不显示字段协议或转义符', () => {
    const stream = new ProfileAnswerStream();
    const json = JSON.stringify({ answer, changes }).replace('你好', '\\u4f60\\u597d');
    const visible = [...json].map((char) => stream.append(char)).join('');
    const result = stream.finish(base);
    expect(visible + result.delta).toBe(answer);
    expect(result.changes).toEqual({ name: '新姓名', jobDescription: '新的 JD' });
    expect(base.name).toBe('旧姓名');
  });
  it('拒绝未知、纯空白和过长字段，显式空字符串表示删除；过滤未变化字段，不接受不完整提案', () => {
    expect(() => validateChanges({ admin: 'yes' })).toThrow('未知字段');
    expect(() => validateChanges({ name: '   ' })).toThrow('无效');
    expect(validateChanges({ name: '', customInstructions: '', skills: [] })).toEqual({
      name: '',
      customInstructions: '',
      skills: [],
    });
    expect(() => validateChanges({ name: 'a'.repeat(61) })).toThrow('过长');
    const stream = new ProfileAnswerStream();
    stream.append(
      JSON.stringify({
        answer: '无变化',
        changes: { name: base.name, jobDescription: null, background: null },
      }),
    );
    expect(stream.finish(base).changes).toEqual({});
    const incomplete = new ProfileAnswerStream();
    incomplete.append('{"answer":"部分内容');
    expect(() => incomplete.finish(base)).toThrow('不完整');
  });
});
describe('附件聊天提案原生链路', () => {
  it('真实 SSE 在完成事件前发出资料预览，完整校验后才返回可确认提案', async () => {
    let transport!: ReadableStreamDefaultController<Uint8Array>;
    let markStarted!: () => void, markPreview!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const previewed = new Promise<void>((resolve) => {
      markPreview = resolve;
    });
    const service = new ChatGPTService({
      access: async () => ({ token: 'test-only', account: 'test' }),
      ledger: { add: async () => {} } as unknown as UsageLedger,
      fetch: async (url) =>
        String(url).endsWith('/models')
          ? Response.json({ models: [{ slug: 'test', display_name: 'Test', visibility: 'list' }] })
          : new Response(
              new ReadableStream({
                start(controller) {
                  transport = controller;
                  markStarted();
                },
              }),
              { headers: { 'content-type': 'text/event-stream' } },
            ),
    });
    const previews: unknown[] = [];
    let completed = false;
    const result = service
      .stream(
        {
          id: 'preview',
          modelId: 'test',
          webSearch: false,
          instructions: '',
          profile: base,
          turns: [{ role: 'user', content: '更新简历' }],
        },
        (event) => {
          if (event.type === 'profile-preview') {
            previews.push(event.preview);
            markPreview();
          }
        },
        new AbortController().signal,
      )
      .then((value) => {
        completed = true;
        return value;
      });
    await started;
    const send = (event: unknown) =>
      transport.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(event) + '\n\n'));
    const json = JSON.stringify({ answer: '待确认', changes: { background: '第一段与第二段' } });
    const cut = json.indexOf('与第二段');
    send({ type: 'response.output_text.delta', delta: json.slice(0, cut) });
    await previewed;
    expect(previews.at(-1)).toEqual({ background: '第一段' });
    expect(completed).toBe(false);
    expect(base.background).toBe('已有项目');
    send({ type: 'response.output_text.delta', delta: json.slice(cut) });
    send({
      type: 'response.completed',
      response: { id: 'complete', status: 'completed', output: [] },
    });
    transport.close();
    expect((await result).profileChanges).toEqual({ background: '第一段与第二段' });
  });
  function service(value: unknown) {
    return new ChatGPTService({
      access: async () => ({ token: 'private', account: 'account' }),
      ledger: { add: async () => {} } as unknown as UsageLedger,
      fetch: async (url: any, options?: RequestInit) => {
        if (String(url).endsWith('/models'))
          return Response.json({
            models: [{ slug: 'test-model', display_name: 'Test', visibility: 'list' }],
          });
        const body = JSON.parse(options!.body as string);
        expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
        expect(body.input[0].content[1].text).toContain('用户附件内容');
        expect(body.tools).toEqual([{ type: 'web_search' }]);
        return Response.json(value);
      },
    });
  }
  const request = {
    id: 'profile-test',
    modelId: 'test-model',
    webSearch: true,
    instructions: '',
    profile: base,
    turns: [
      {
        role: 'user' as const,
        content: '请整理简历',
        files: [{ name: 'resume.md', bytes: new TextEncoder().encode('用户附件内容') }],
      },
    ],
  };
  it('同一次请求保留附件与搜索，返回模型生成的提案而不修改现有资料', async () => {
    const received: string[] = [];
    const result = await service({
      object: 'response',
      id: 'resp',
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({ answer, changes }) }] }],
      usage: { input_tokens: 15, output_tokens: 25, total_tokens: 40 },
    }).stream(
      request,
      (event) => {
        if (event.type === 'delta') received.push(event.text);
      },
      new AbortController().signal,
    );
    expect(received.join('')).toBe(answer);
    expect(result.profileChanges).toEqual({ name: '新姓名', jobDescription: '新的 JD' });
    expect(result.usage?.totalTokens).toBe(40);
    expect(base.name).toBe('旧姓名');
  });
  it('模型拒答不作为资料更新，不完整或非法提案不会成功返回', async () => {
    const refused = await service({
      object: 'response',
      id: 'resp',
      status: 'completed',
      output: [{ content: [{ type: 'refusal', refusal: '无法处理' }] }],
    }).stream(request, () => {}, new AbortController().signal);
    expect(refused.profileChanges).toBeUndefined();
    await expect(
      service({
        object: 'response',
        id: 'resp',
        status: 'completed',
        output: [{ content: [{ type: 'output_text', text: '{"answer":"未完成' }] }],
      }).stream(request, () => {}, new AbortController().signal),
    ).rejects.toThrow('不完整');
    await expect(
      service({ object: 'response', id: 'resp', status: 'incomplete', output: [] }).stream(
        request,
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow('未完成');
    await expect(
      service({}).stream(
        { ...request, profile: { ...base, role: 1 } },
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow('请求无效');
  });
});
