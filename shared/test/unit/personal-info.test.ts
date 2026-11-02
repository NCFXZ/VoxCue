import { describe, expect, it, vi } from 'vitest';
import {
  validProfile,
  validateChanges,
  profileProposalStale,
  type PersonalInfo,
} from '../../../shared/electron/contracts/profile';
import {
  validateInterviewConfiguration,
  SpeechCoordinator,
} from '../../../shared/electron/application/speech';
import { ChatGPTService } from '../../../shared/electron/backend/chat/service';
import type { UsageLedger } from '../../../shared/electron/backend/chat/usage';
import { RagChatService } from '../../../shared/electron/application/rag';
import type { KnowledgePort } from '../../../shared/electron/backend/knowledge/types';
import type { AIChatService } from '../../../shared/electron/backend/chat/ports';
import { defaultInterviewConfiguration } from '../../../shared/src/services/speech';

const info: PersonalInfo = {
  name: '候选人',
  role: '软件工程师',
  background: '已确认：做过桌面项目。',
  jobDescription: '岗位要求：TypeScript、数据库。',
  customInstructions: '先给结论，接着解释原因。',
};
const source = { title: '官方资料', url: 'https://www.typescriptlang.org/docs/' };
const skill = {
  id: 'ts',
  title: 'TypeScript 类型系统',
  content: '区分类型检查与运行时校验，准备解释两者的边界。',
  sources: [source],
};
describe('个人信息扩展及确认基线', () => {
  it('兼容旧四字段；拒绝知识库字段、未知结构、重复条目、不安全来源和超限', () => {
    expect(validProfile({ name: '', role: '', background: '', jobDescription: '' })).toBe(true);
    expect(validProfile({ ...info, skills: [skill] })).toBe(true);
    for (const changes of [
      { knowledgeBaseId: 'other' },
      { role: 'removed' },
      { customInstructions: 'a'.repeat(16385) },
      { customInstructions: Array(2) },
      { skills: [skill, skill] },
      { skills: [{ ...skill, sources: [{ title: 'attack', url: 'javascript:alert(1)' }] }] },
      { customInstructions: [{ id: 'x', title: 'x', content: 'a'.repeat(6001) }] },
    ])
      expect(() => validateChanges(changes)).toThrow();
    expect(validateChanges({ customInstructions: '', skills: [], background: '' })).toEqual({
      customInstructions: '',
      skills: [],
      background: '',
    });
  });
  it('条目按内容比较，技能生成期间简历/JD变化也使提案过期', () => {
    expect(
      profileProposalStale(structuredClone(info), info, {
        customInstructions: structuredClone(info.customInstructions),
      }),
    ).toBe(false);
    expect(
      profileProposalStale({ ...info, customInstructions: '' }, info, { customInstructions: '' }),
    ).toBe(true);
    expect(
      profileProposalStale({ ...info, jobDescription: '新岗位' }, info, { skills: [skill] }),
    ).toBe(true);
    expect(profileProposalStale({ ...info, name: '新姓名' }, info, { skills: [skill] })).toBe(
      false,
    );
  });
  it('面试确认深拷贝资料与唯一知识库；错误字段或类型不能绕过主进程', async () => {
    const config = {
      ...defaultInterviewConfiguration(),
      mode: 'local' as const,
      profile: structuredClone(info),
      knowledgeBaseId: 'chosen-base',
    };
    const port = {
      call: vi.fn(async () => ({ state: 'idle' as const, model: 'test' })),
      stop: vi.fn(),
    };
    const coordinator = new SpeechCoordinator(port);
    await coordinator.confirm(config);
    config.profile.background = '后来改动';
    expect(coordinator.configuration?.profile?.background).toBe(info.background);
    expect(coordinator.configuration?.knowledgeBaseId).toBe('chosen-base');
    const copy = coordinator.configuration!;
    copy.profile!.customInstructions = '篡改';
    expect(coordinator.configuration?.profile?.customInstructions).toBe(info.customInstructions);
    expect(() =>
      validateInterviewConfiguration({ ...config, knowledgeBaseId: '../all' }),
    ).toThrow();
    expect(() =>
      validateInterviewConfiguration({ ...config, profile: { ...info, knowledgeBaseId: 'other' } }),
    ).toThrow();
  });
});

function core(): KnowledgePort {
  return {
    initialize: vi.fn(),
    indexDocument: vi.fn(),
    updateDocument: vi.fn(),
    invalidateDocument: vi.fn(),
    removeDocument: vi.fn(),
    listDocuments: vi.fn(),
    close: vi.fn(),
    search: vi.fn(async () => [
      {
        chunkId: 'a',
        itemId: 'a',
        documentId: 'a',
        baseId: 'chosen',
        title: 'TypeScript',
        name: 'chosen.md',
        excerpt: 'TypeScript',
        score: 1,
        mode: 'hybrid' as const,
      },
      {
        chunkId: 'b',
        itemId: 'b',
        documentId: 'b',
        baseId: 'other',
        title: 'TypeScript secret',
        name: 'other.md',
        excerpt: 'private-other-base',
        score: 1,
        mode: 'hybrid' as const,
      },
    ]),
    getItem: vi.fn(async (id) => ({
      itemId: id,
      documentId: id,
      kind: 'text' as const,
      title: 'TypeScript',
      content: id === 'a' ? 'chosen-evidence' : 'private-other-base',
      followUpIds: [],
      section: '',
    })),
  };
}
const request = {
  id: 'scope-test',
  modelId: 'model',
  instructions: '',
  webSearch: false,
  turns: [{ role: 'user' as const, content: 'TypeScript' }],
};
describe('本场知识库范围不可被模型扩大', () => {
  it('Local 仅读取所选库，未选择时不调用检索入口', async () => {
    const knowledge = core();
    const provider: AIChatService = {
      stream: vi.fn(async () => ({ answerText: 'answer', usage: null, sources: [] })),
      models: vi.fn(),
      usage: vi.fn(),
      resetUsage: vi.fn(),
    };
    const rag = new RagChatService(provider, knowledge);
    await rag.stream(
      { ...request, knowledgeBaseId: 'chosen' },
      vi.fn(),
      new AbortController().signal,
    );
    expect(knowledge.search).toHaveBeenCalledWith(
      'TypeScript',
      12,
      'hybrid',
      expect.any(AbortSignal),
      'chosen',
      { rawLimit: 60, grounded: true },
    );
    expect(knowledge.getItem).toHaveBeenCalledTimes(1);
    const enriched = vi.mocked(provider.stream).mock.calls[0][0];
    expect(enriched.turns[0].content).toContain('chosen-evidence');
    expect(enriched.turns[0].content).not.toContain('private-other-base');
    vi.mocked(knowledge.search).mockClear();
    await new RagChatService(provider, knowledge).stream(
      { ...request, knowledgeBaseId: null },
      vi.fn(),
      new AbortController().signal,
    );
    expect(knowledge.search).not.toHaveBeenCalled();
  });
});

describe('技能来源核验与可审阅提案', () => {
  const run = (
    searched: boolean,
    sources: object[],
    proposed = skill,
    transport: { streamedSources?: object[]; action?: object } = {},
  ) => {
    const service = new ChatGPTService({
      access: async () => ({ token: 'synthetic', account: 'test' }),
      ledger: { add: async () => {} } as unknown as UsageLedger,
      fetch: async (url, options) => {
        if (String(url).endsWith('/models'))
          return Response.json({
            models: [{ slug: 'model', display_name: 'Model', visibility: 'list' }],
          });
        const body = JSON.parse(String(options?.body));
        expect(body.tools).toEqual([{ type: 'web_search' }]);
        expect(body.tool_choice).toBe('auto');
        const terminal = {
          object: 'response',
          status: 'completed',
          id: 'test',
          output: [
            ...(searched
              ? [
                  {
                    id: 'search',
                    type: 'web_search_call',
                    status: 'completed',
                    action: transport.action ?? { sources },
                  },
                ]
              : []),
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({ answer: '请确认技能', changes: { skills: [proposed] } }),
                },
              ],
            },
          ],
        };
        if (transport.streamedSources)
          return new Response(
            [
              {
                type: 'response.output_item.done',
                output_index: 0,
                item: {
                  id: 'search',
                  type: 'web_search_call',
                  status: 'completed',
                  action: { sources: transport.streamedSources },
                },
              },
              { type: 'response.completed', response: terminal },
            ]
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join(''),
            { headers: { 'content-type': 'text/event-stream' } },
          );
        return Response.json(terminal);
      },
    });
    return service.stream(
      { ...request, profile: info, profileTask: 'skills', webSearch: true },
      vi.fn(),
      new AbortController().signal,
    );
  };
  it('搜索未完成、无工具来源或引用失配均保留完整提案并返回具体问题', async () => {
    for (const [searched, actual, reason] of [
      [false, [], 'search_incomplete'],
      [true, [], 'search_sources_missing'],
    ] as const) {
      const result = await run(searched, [...actual]);
      expect(result.profileChanges?.skills).toEqual([{ ...skill, sources: [] }]);
      expect(result.skillSourceIssues).toEqual([
        { skillId: skill.id, reason, sources: skill.sources },
      ]);
      expect(result.answerText).toBe('请确认技能');
    }
    const unverified = { title: '虚构', url: 'https://example.com/invented' };
    const failed = await run(true, [source], {
      ...skill,
      sources: [unverified],
    });
    expect(failed.profileChanges?.skills).toEqual([{ ...skill, sources: [] }]);
    expect(failed.skillSourceIssues).toEqual([
      { skillId: skill.id, reason: 'source_unmatched', sources: [unverified] },
    ]);
    const result = await run(true, [source]);
    expect(result.profileChanges?.skills).toEqual([skill]);
    expect(result.sources).toEqual([source]);
    expect(result.skillSourceIssues).toBeUndefined();
  });
  it('流式完成事件的真实来源不依赖终态再次携带，同页锚点/追踪参数可匹配并使用真实元数据', async () => {
    const actual = { title: '真实工具标题', url: source.url + '?utm_source=search#overview' };
    const proposed = { ...skill, sources: [{ title: '模型标题', url: source.url + '#types' }] };
    const result = await run(true, [], proposed, { streamedSources: [actual] });
    expect(result.profileChanges?.skills?.[0].sources).toEqual([actual]);
    expect(result.sources).toEqual([actual]);
  });
  it('真实打开/查找的网页也可作为技能来源，不要求重复列入搜索结果', async () => {
    for (const type of ['open_page', 'find_in_page']) {
      const result = await run(true, [], skill, { action: { type, url: source.url } });
      expect(result.profileChanges?.skills?.[0].sources[0].url).toBe(source.url);
    }
  });
  it('超过五十个检索来源后仍验证后续真实引用；只移除多余未匹配引用，至少保留一个真实来源', async () => {
    const many = Array.from({ length: 70 }, (_, index) => ({
      title: `文档${index}`,
      url: `https://example.com/docs/${index}`,
    }));
    const actual = many.at(-1)!;
    const result = await run(true, many, {
      ...skill,
      sources: [actual, { title: '未检索', url: 'https://example.com/missing' }],
    });
    expect(result.profileChanges?.skills?.[0].sources).toEqual([actual]);
    expect(result.skillSourceIssues).toEqual([
      {
        skillId: skill.id,
        reason: 'source_unmatched',
        sources: [{ title: '未检索', url: 'https://example.com/missing' }],
      },
    ]);
    expect(result.sources).toHaveLength(70);
  });
  it.each([
    'https://www.typescriptlang.org/other/',
    'https://other.example/docs/',
    source.url + '?version=1',
  ])('路径/域名/有意义的参数不同仍标为未核验，但保留可确认内容：%s', async (url) => {
    const result = await run(true, [source], { ...skill, sources: [{ title: '错误引用', url }] });
    expect(result.skillSourceIssues).toEqual([
      { skillId: skill.id, reason: 'source_unmatched', sources: [{ title: '错误引用', url }] },
    ]);
    expect(result.profileChanges?.skills).toEqual([{ ...skill, sources: [] }]);
  });
});
