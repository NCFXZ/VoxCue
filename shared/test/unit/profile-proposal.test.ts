import { codexAccess } from '../fixtures/codex-access';
import { describe, expect, it, vi } from 'vitest';
import {
  ProfileAnswerStream,
  profileInstructions,
} from '../../../shared/electron/backend/chat/profile';
import { ChatGPTService } from '../../../shared/electron/backend/chat/service';
import { ProfilePreviews } from '../../electron/backend/chat/profilePreviews';
import type { UsageLedger } from '../../../shared/electron/backend/chat/usage';
import { validateChanges } from '../../../shared/electron/contracts/profile';
import { validateRequest } from '../../../shared/electron/backend/chat/validation';
import { verifySkillProposal } from '../../../shared/electron/backend/chat/proposal';
const base = {
  name: '旧姓名',
  role: '开发工程师',
  jobDescription: '现有 JD',
  background: '已有项目',
};
const changes = { name: '新姓名', jobDescription: '新的 JD', background: null };
const answer = '**已整理**，请确认。\n```python\nprint("你好")\n```';
it('合并资料预览，正文即时返回，取消或替换消息后不发布旧预览', async () => {
  vi.useFakeTimers();
  try {
    const abort = new AbortController();
    const emit = vi.fn();
    const stream = new ProfileAnswerStream();
    using previews = new ProfilePreviews('test', emit, abort.signal);
    expect(stream.append('{"answer":"正文","changes":{"background":"')).toBe('正文');
    for (const char of '合成进度') {
      stream.append(char);
      previews.update(stream);
    }
    await vi.advanceTimersByTimeAsync(60);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({ preview: { background: '合成进度' } });
    stream.append('旧内容');
    previews.update(stream);
    previews.reset();
    await vi.advanceTimersByTimeAsync(60);
    expect(emit).toHaveBeenCalledTimes(1);
    const next = new ProfileAnswerStream();
    next.append('{"answer":"另一条","changes":{"name":"新名字"}}');
    previews.update(next);
    previews.flush();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1][0]).toMatchObject({ preview: { name: '新名字' } });
    previews.update(stream);
    abort.abort();
    await vi.advanceTimersByTimeAsync(60);
    expect(emit).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
describe('资料提案协议', () => {
  it.each([
    { background: '', jobDescription: '' },
    { background: '已确认简历', jobDescription: '' },
    { background: '', jobDescription: '已确认JD' },
  ])('自然语言请求交给模型判断，显式整套入口仍要求完整摘要：%j', (summaries) => {
    const request = {
      id: 'topic',
      modelId: 'synthetic',
      webSearch: true,
      instructions: '',
      profile: { ...base, ...summaries },
      turns: [{ role: 'user' as const, content: '请新增Kafka技能' }],
    };
    expect(validateRequest(request)).toEqual(request);
    expect(() => validateRequest({ ...request, profileTask: 'skills' })).toThrow('请求无效');
    expect(validateRequest({ ...request, webSearch: false })).toMatchObject({ webSearch: false });
    expect(() => validateRequest({ ...request, turns: [{ role: 'user', content: 123 }] })).toThrow(
      '对话内容无效。',
    );
  });
  it('来源问题逐项返回，保留内容供确认；整套条件与仅删除规则保留', () => {
    const source = { title: '合成来源', url: 'https://example.com/kafka' };
    const skill = { id: 'kafka', title: 'Kafka', content: '合成知识', sources: [source] };
    const request = {
      id: 'topic',
      modelId: 'synthetic',
      webSearch: true,
      instructions: '',
      profile: { ...base, background: '', jobDescription: '', skills: [skill] },
      turns: [{ role: 'user' as const, content: '请改写Kafka技能' }],
    };
    const next = () => ({ skills: [{ ...skill, content: '本次检索后的内容' }] });
    const sources = new Map([[source.url, source]]);
    expect(verifySkillProposal(request, next(), sources, true, 'topic')).toBeUndefined();
    for (const [webSearch, completed, actual, reason] of [
      [false, true, sources, 'search_disabled'],
      [true, false, sources, 'search_incomplete'],
      [true, true, new Map(), 'search_sources_missing'],
    ] as const) {
      const changes = next();
      expect(
        verifySkillProposal({ ...request, webSearch }, changes, actual, completed, 'topic'),
      ).toEqual([{ skillId: skill.id, reason, sources: [source] }]);
      expect(changes.skills[0]).toEqual({ ...skill, content: '本次检索后的内容', sources: [] });
    }
    expect(
      verifySkillProposal(
        request,
        {
          skills: [
            {
              ...next().skills[0],
              sources: [{ ...source, url: 'https://example.com/unreturned' }],
            },
          ],
        },
        sources,
        true,
        'topic',
      ),
    ).toEqual([
      {
        skillId: skill.id,
        reason: 'source_unmatched',
        sources: [{ ...source, url: 'https://example.com/unreturned' }],
      },
    ]);
    expect(() =>
      verifySkillProposal(
        { ...request, turns: [{ role: 'user', content: '生成技能' }] },
        next(),
        sources,
        true,
      ),
    ).toThrow('先确认');
    expect(
      verifySkillProposal(
        { ...request, webSearch: false, turns: [{ role: 'user', content: '删除Kafka技能' }] },
        { skills: [] },
        new Map(),
        false,
      ),
    ).toBeUndefined();
  });
  it('部分和全部来源失败不丢弃任何技能，未改条目不重验，未核验引用单独保留', () => {
    const source = { title: '工具来源', url: 'https://example.com/actual' };
    const unverified = { title: '未检索引用', url: 'https://example.com/unreturned' };
    const old = { id: 'old', title: '原有技能', content: '保留原文', sources: [unverified] };
    const skills = [
      old,
      { id: 'valid', title: '已匹配', content: '有效内容', sources: [source] },
      { id: 'partial', title: '部分匹配', content: '部分内容', sources: [source, unverified] },
      { id: 'none', title: '全部失配', content: '完整保留内容', sources: [unverified] },
      { id: 'missing', title: '缺少引用', content: '没有引用的内容', sources: [] },
    ];
    const changes = { skills: structuredClone(skills) };
    const request = {
      id: 'mixed',
      modelId: 'synthetic',
      webSearch: true,
      instructions: '',
      profile: { ...base, skills: [old] },
      turns: [{ role: 'user' as const, content: '更新技能' }],
    };
    expect(verifySkillProposal(request, changes, new Map([[source.url, source]]), true)).toEqual([
      { skillId: 'partial', reason: 'source_unmatched', sources: [unverified] },
      { skillId: 'none', reason: 'source_unmatched', sources: [unverified] },
    ]);
    expect(changes.skills.map(({ sources: _sources, ...entry }) => entry)).toEqual(
      skills.map(({ sources: _sources, ...entry }) => entry),
    );
    expect(changes.skills.map((entry) => entry.sources)).toEqual([
      [unverified],
      [source],
      [source],
      [],
      [],
    ]);
  });
  it('资料与技能逐字预览正确解码转义，仅完整提案可通过最终校验', () => {
    const stream = new ProfileAnswerStream();
    stream.append('{"answer":"已整理","changes":{"background":"第一行\\n中文\\u4f');
    expect(stream.preview()).toEqual({ background: '第一行\n中文' });
    expect(() => stream.finish(base)).toThrow('不完整');
    stream.append('60","skills":[{"id":"s","title":"控制","content":"闭环\\n逐步');
    expect(stream.preview()).toEqual({
      background: '第一行\n中文你',
      skills: [{ id: 's', title: '控制', content: '闭环\n逐步' }],
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
  it('技能稳定 ID 完整到达后才用于预览操作判定，非法 ID 不传给界面', () => {
    const stream = new ProfileAnswerStream();
    stream.append('{"answer":"预览","changes":{"skills":[{"id":"qt');
    expect(stream.preview()?.skills?.[0]).not.toHaveProperty('id');
    stream.append('-desktop","title":"Qt","content":"新内容');
    expect(stream.preview()?.skills?.[0]?.id).toBe('qt-desktop');
    const invalid = new ProfileAnswerStream();
    invalid.append('{"answer":"预览","changes":{"skills":[{"id":"../invalid","title":"Qt"');
    expect(invalid.preview()?.skills?.[0]).not.toHaveProperty('id');
  });
  it('字段按实际字符串闭合停止 loading，不依赖固定字段顺序或回复完成', () => {
    const stream = new ProfileAnswerStream();
    stream.append('{"answer":"预览","changes":{"customInstructions":"先说\\"结论\\"');
    expect(stream.preview()).toEqual({ customInstructions: '先说"结论"' });
    expect(stream.generation).toEqual({ fields: ['customInstructions'], skillIndexes: [] });
    stream.append('","name":"新姓名');
    expect(stream.preview()).toEqual({ name: '新姓名', customInstructions: '先说"结论"' });
    expect(stream.generation).toEqual({ fields: ['name'], skillIndexes: [] });
    stream.append('"');
    stream.preview();
    expect(stream.generation).toEqual({ fields: [], skillIndexes: [] });
    expect(() => stream.finish(base)).toThrow('不完整');
  });
  it('已完成技能不受后一条生成影响，闭合空数组与尾部空白不产生虚假技能', () => {
    const stream = new ProfileAnswerStream();
    stream.append(
      '{"answer":"预览","changes":{"skills":[{"id":"one","title":"一","content":"完整内容","sources":[]},{"id":"two","title":"二","content":"部分',
    );
    expect(stream.preview()?.skills).toHaveLength(2);
    expect(stream.generation).toEqual({ fields: ['skills'], skillIndexes: [1] });
    stream.append('内容","sources":[]}');
    stream.preview();
    expect(stream.generation).toEqual({ fields: ['skills'], skillIndexes: [] });
    stream.append(']}}');
    stream.preview();
    expect(stream.generation).toEqual({ fields: [], skillIndexes: [] });
    const empty = new ProfileAnswerStream();
    empty.append('{"answer":"删除","changes":{"skills":[  ');
    expect(empty.preview()).toEqual({ skills: [] });
    expect(empty.generation).toEqual({ fields: ['skills'], skillIndexes: [] });
    empty.append(']}}');
    empty.preview();
    expect(empty.generation).toEqual({ fields: [], skillIndexes: [] });
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
      access: async () => codexAccess('test', 'test-only'),
      ledger: { add: async () => {} } as unknown as UsageLedger,
      fetch: async (url) =>
        new URL(String(url)).pathname.endsWith('/models')
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
    const generations: unknown[] = [];
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
            generations.push(event.generation);
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
    await vi.waitFor(() => expect(generations.at(-1)).toEqual({ fields: [], skillIndexes: [] }));
    send({
      type: 'response.completed',
      response: { id: 'complete', status: 'completed', output: [] },
    });
    transport.close();
    expect((await result).profileChanges).toEqual({ background: '第一段与第二段' });
  });
  function service(value: unknown, inspect?: (body: any) => void) {
    return new ChatGPTService({
      access: async () => codexAccess('account', 'private'),
      ledger: { add: async () => {} } as unknown as UsageLedger,
      fetch: async (url: any, options?: RequestInit) => {
        if (new URL(String(url)).pathname.endsWith('/models'))
          return Response.json({
            models: [
              {
                slug: 'test-model',
                display_name: 'Test',
                visibility: 'list',
                web_search_tool_type: 'text',
              },
            ],
          });
        const body = JSON.parse(options!.body as string);
        expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
        expect(body.instructions).toContain(profileInstructions);
        expect(body.instructions).toContain('上传附件本身不代表要求修改资料');
        expect(body.instructions).toContain('不写联网状态、检索过程或来源核验说明');
        expect(body.instructions).toContain('本次确实新增或修改了简历或JD摘要');
        expect(body.instructions).toContain('把本次提案与已保存资料合并后两份摘要都非空');
        expect(body.instructions).toContain('待确认摘要也参与此次询问条件判断');
        expect(body.text.format.schema.properties.answer.description).toContain(
          '询问不代表本次生成技能',
        );
        expect(body.instructions).toContain('不使用待确认摘要生成技能');
        expect(body.instructions).not.toContain('也不在 answer 中询问是否更新技能');
        expect(body.instructions).toContain('优先采用官方文档、标准和可靠的一手资料');
        expect(body.instructions).toContain('资料有分歧时说明条件');
        expect(body.instructions).not.toMatch(/120–220|约80字|主动询问是否需要联网/);
        expect(body.input[0].content[1].text).toContain('用户附件内容');
        expect(body.tools).toEqual([{ type: 'web_search' }]);
        expect(body.tool_choice).toBe('auto');
        inspect?.(body);
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
  it.each([
    ['需要', '是否需要更新技能？'],
    ['yes', 'Would you like to update your skills?'],
    ['sí', '¿Quieres actualizar tus habilidades?'],
  ])('完整上下文交给模型，简短同意可返回未搜索的有效技能提案：%s', async (consent, question) => {
    const skills = [{ id: 'topic', title: '主题', content: '基于通用知识的参考内容', sources: [] }];
    const result = await service(
      {
        object: 'response',
        id: 'knowledge-only',
        status: 'completed',
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  answer: '请审阅技能提案。',
                  changes: { skills },
                  skillScope: 'all',
                }),
              },
            ],
          },
        ],
      },
      (body) => {
        expect(JSON.stringify(body.input)).toContain(question);
        expect(JSON.stringify(body.input)).toContain(consent);
      },
    ).stream(
      {
        ...request,
        turns: [
          ...request.turns,
          { role: 'assistant', content: question },
          { role: 'user', content: consent },
        ],
      },
      () => {},
      new AbortController().signal,
    );
    expect(result.profileChanges?.skills).toEqual(skills);
    expect(result.skillSourceIssues).toBeUndefined();
    expect(result.sources).toEqual([]);
    expect(base).not.toHaveProperty('skills');
  });
  it('模型范围元数据不进入资料或预览，主题例外不绕过整套入口与摘要确认', () => {
    const profile = { ...base, background: '', jobDescription: '' };
    const skills = [{ id: 'topic', title: '主题', content: '通用知识', sources: [] }];
    const stream = new ProfileAnswerStream();
    expect(
      stream.append(JSON.stringify({ answer: '请审阅', changes: { skills }, skillScope: 'topic' })),
    ).toBe('请审阅');
    expect(stream.preview()?.skills).toHaveLength(1);
    const proposal = stream.finish(profile);
    expect(proposal.changes).toEqual({ skills });
    expect(proposal.skillScope).toBe('topic');
    const input = { ...request, profile };
    expect(
      verifySkillProposal(input, proposal.changes, new Map(), false, proposal.skillScope),
    ).toBeUndefined();
    expect(() => verifySkillProposal(input, proposal.changes, new Map(), false, 'all')).toThrow(
      '先确认',
    );
    expect(() =>
      verifySkillProposal(
        { ...input, profileTask: 'skills' },
        proposal.changes,
        new Map(),
        false,
        'topic',
      ),
    ).toThrow('先确认');
    expect(() =>
      verifySkillProposal(
        input,
        { ...proposal.changes, background: '尚未保存' },
        new Map(),
        false,
        'topic',
      ),
    ).toThrow('先确认');
    for (const invalid of ['anything', 1, {}, []]) {
      const malformed = new ProfileAnswerStream();
      malformed.append(JSON.stringify({ answer: '无效', changes: {}, skillScope: invalid }));
      expect(() => malformed.finish(base)).toThrow('格式无效');
    }
  });
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
