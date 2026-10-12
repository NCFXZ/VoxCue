import { describe, expect, it } from 'vitest';
import { ProfileAnswerStream } from '../electron/backend/chat/profile';
import { ChatGPTService } from '../electron/backend/chat/service';
import type { UsageLedger } from '../electron/backend/chat/usage';
import { validateChanges } from '../electron/contracts/profile';
const base = {
  name: '旧姓名',
  role: '开发工程师',
  jobDescription: '现有 JD',
  background: '已有项目',
};
const changes = { name: '新姓名', role: null, jobDescription: '新的 JD', background: null };
const answer = '**已整理**，请确认。\n```python\nprint("你好")\n```';
describe('资料提案协议', () => {
  it('逐字符 JSON 流只显示 Markdown 回答，不显示字段协议或转义符', () => {
    const stream = new ProfileAnswerStream();
    const json = JSON.stringify({ answer, changes }).replace('你好', '\\u4f60\\u597d');
    const visible = [...json].map((char) => stream.append(char)).join('');
    const result = stream.finish(base);
    expect(visible + result.delta).toBe(answer);
    expect(result.changes).toEqual({ name: '新姓名', jobDescription: '新的 JD' });
    expect(base.name).toBe('旧姓名');
  });
  it('拒绝未知、空值和过长字段，过滤未变化字段，不接受不完整提案', () => {
    expect(() => validateChanges({ admin: 'yes' })).toThrow('未知字段');
    expect(() => validateChanges({ name: '' })).toThrow('无效');
    expect(() => validateChanges({ name: 'a'.repeat(61) })).toThrow('过长');
    const stream = new ProfileAnswerStream();
    stream.append(
      JSON.stringify({
        answer: '无变化',
        changes: { name: base.name, role: null, jobDescription: null, background: null },
      }),
    );
    expect(stream.finish(base).changes).toEqual({});
    const incomplete = new ProfileAnswerStream();
    incomplete.append('{"answer":"部分内容');
    expect(() => incomplete.finish(base)).toThrow('不完整');
  });
});
describe('附件聊天提案原生链路', () => {
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
