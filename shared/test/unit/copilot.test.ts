import { describe, expect, it, vi } from 'vitest';
import {
  CopilotAuthService,
  copilotAuthorizationUrl,
} from '../../../shared/electron/backend/copilot/auth';
import { CopilotChatService } from '../../../shared/electron/backend/copilot/service';
import { SelectedChatService } from '../../../shared/electron/application/providers';
import type { AuthSession } from '../../../shared/electron/contracts/auth';
import type { ChatEvent, ChatRequest } from '../../../shared/electron/contracts/chat';
import { profileFields } from '../../../shared/electron/contracts/profile';

const authorize =
  'https://github.com/login/oauth/authorize?client_id=official-sdk&state=state&code_challenge=challenge&code_challenge_method=S256&redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Fcallback';
function authentication(
  steps: any[] = [
    {
      kind: 'completed',
      result: { status: 'completed', host: 'https://github.com', login: 'Example' },
    },
  ],
) {
  let saved: AuthSession | null = null;
  const accounts = {
    get: vi.fn(async () => ({
      kind: 'activeAccount',
      authInfo: { type: 'user', host: 'https://github.com', login: 'Example' },
    })),
    set: vi.fn(async () => ({ ok: true })),
    login: {
      begin: vi.fn(async () => ({
        flowId: 'private-flow',
        step: { kind: 'open-url', url: authorize },
      })),
      advance: vi.fn(async () => steps.shift()),
      cancel: vi.fn(async () => {}),
    },
  };
  const write = vi.fn(async (session) => {
    saved = session;
  });
  const openBrowser = vi.fn(async () => {});
  const read = vi.fn(async () => saved);
  const service = new CopilotAuthService({
    storage: { read, write },
    control: async () => ({ rpc: { accounts } }) as any,
    openBrowser,
  });
  return { service, accounts, write, read, openBrowser };
}
describe('Copilot 浏览器授权边界', () => {
  it('只打开 GitHub PKCE + 本机回调；只保存无凭据的身份元数据', async () => {
    for (const url of [
      authorize.replace('https://github.com', 'https://evil.test'),
      authorize.replace('S256', 'plain'),
      authorize.replace('127.0.0.1', 'evil.test'),
      authorize.replace('/login/oauth/authorize', '/login/device'),
    ])
      expect(() => copilotAuthorizationUrl(url)).toThrow();
    const { service, openBrowser, write, accounts } = authentication();
    expect(await service.session()).toBeNull();
    expect(await service.signIn()).toEqual({
      mode: 'copilot',
      user: { id: 'github.com:Example', name: 'Example', email: '' },
      expiresAt: null,
    });
    expect(openBrowser).toHaveBeenCalledWith(authorize);
    expect(JSON.stringify(write.mock.calls)).not.toMatch(/token|private-flow|challenge/);
    expect(await service.access()).toEqual({ account: 'copilot:github.com:Example' });
    accounts.get.mockResolvedValueOnce({
      kind: 'activeAccount',
      authInfo: { type: 'gh-cli', host: 'https://github.com', login: 'Example' },
    });
    await expect(service.access()).rejects.toThrow('已失效');
    accounts.get.mockResolvedValueOnce({
      kind: 'activeAccount',
      authInfo: { type: 'user', host: 'https://github.com', login: 'Other' },
    });
    await expect(service.access()).rejects.toThrow('已变更');
    await service.signOut();
    expect(accounts.set).toHaveBeenCalledWith({ command: { kind: 'logout' } });
    expect(await service.session()).toBeNull();
  });
  it('退出后不接受迟到的运行时身份检查', async () => {
    const { service, accounts } = authentication();
    await service.signIn();
    let finish!: (value: any) => void;
    accounts.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = service.access();
    await vi.waitFor(() => expect(accounts.get).toHaveBeenCalledOnce());
    await service.signOut();
    finish({
      kind: 'activeAccount',
      authInfo: { type: 'user', host: 'https://github.com', login: 'Example' },
    });
    await expect(pending).rejects.toThrow('账户正在变更');
    expect(await service.session()).toBeNull();
  });
  it('退出期间及退出后的迟到本地身份读取不恢复会话', async () => {
    const { service, accounts, read } = authentication();
    const previous = await service.signIn();
    let finishRead!: (value: AuthSession | null) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    const pending = service.session();
    let finishLogout!: (value: { ok: boolean }) => void;
    accounts.set.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLogout = resolve;
        }),
    );
    const logout = service.signOut();
    await vi.waitFor(() => expect(accounts.set).toHaveBeenCalledOnce());
    expect(await service.session()).toBeNull();
    finishLogout({ ok: true });
    await logout;
    finishRead(previous);
    expect(await pending).toBeNull();
  });
  it('系统加密不可用时拒绝明文回退，不创建会话', async () => {
    const { service, write, accounts } = authentication([
      { kind: 'completed', result: { status: 'needs-plaintext-consent' } },
    ]);
    await expect(service.signIn()).rejects.toThrow('加密存储不可用');
    expect(write).not.toHaveBeenCalled();
    expect(accounts.login.cancel).toHaveBeenCalledWith({ flowId: 'private-flow' });
  });
  it('不把运行时原始错误或凭据带入公开错误', async () => {
    const fixture = authentication();
    fixture.accounts.login.begin.mockRejectedValueOnce(
      Error('远端错误 credential=synthetic-secret'),
    );
    await expect(fixture.service.signIn()).rejects.toThrow('无法完成 GitHub Copilot 登录');
    await fixture.service.signIn();
    fixture.accounts.get.mockRejectedValueOnce(Error('远端错误 credential=synthetic-secret'));
    await expect(fixture.service.access()).rejects.toThrow('无法检查 GitHub Copilot 授权');
    const catalog = chat(() => {});
    catalog.client.rpc.models.list.mockRejectedValueOnce(
      Error('远端错误 credential=synthetic-secret'),
    );
    await expect(catalog.service.models()).rejects.toThrow('无法获取 GitHub Copilot 模型列表');
    const streaming = chat(() => {
      throw Error('远端错误 credential=synthetic-secret');
    });
    await expect(
      streaming.service.stream(request, () => {}, new AbortController().signal),
    ).rejects.toThrow('GitHub Copilot 请求失败');
  });
  it('取消时释放尚在创建的授权流程，迟到结果不能登录', async () => {
    const { service, accounts, write } = authentication();
    let finish!: (value: any) => void;
    accounts.login.begin.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const attempt = service.signIn();
    await vi.waitFor(() => expect(accounts.login.begin).toHaveBeenCalled());
    await expect(service.signIn()).rejects.toThrow('正在进行');
    service.cancel();
    await expect(attempt).rejects.toThrow('取消');
    finish({ flowId: 'late-flow', step: { kind: 'open-url', url: authorize } });
    await vi.waitFor(() =>
      expect(accounts.login.cancel).toHaveBeenCalledWith({ flowId: 'late-flow' }),
    );
    expect(write).not.toHaveBeenCalled();
  });
});

const request: ChatRequest = {
  id: 'copilot-test',
  modelId: 'account-model',
  webSearch: false,
  instructions: '回答用户问题',
  turns: [{ role: 'user', content: '为什么' }],
};
function chat(
  run: (emit: (type: string, data: any) => void) => void | Promise<void>,
  idleTimeoutMs = 5000,
) {
  let handler: (event: any) => void = () => {};
  let eventId = 0;
  const emit = (type: string, data: any) => handler({ type, data, id: `event-${++eventId}` });
  const session = {
    sessionId: 'owned-session',
    on: vi.fn((callback) => {
      handler = callback;
      return () => {
        handler = () => {};
      };
    }),
    send: vi.fn(async (_options) => {
      await run(emit);
      return 'user-message';
    }),
    abort: vi.fn(async () => {}),
  };
  const model = {
    id: 'account-model',
    name: 'Account Model',
    vendor: 'Published Vendor',
    capabilities: { supports: { reasoningEffort: true } },
    supportedReasoningEfforts: ['low', 'high', 'invalid', 'none'],
  };
  const client = {
    createSession: vi.fn(async (_options) => session),
    deleteSession: vi.fn(async () => {}),
    rpc: {
      models: { list: vi.fn(async () => ({ models: [model] })) },
      tools: {
        list: vi.fn(async () => ({
          tools: [
            { name: 'web_search' },
            { name: 'web_fetch' },
            { name: 'powershell' },
            { name: 'view' },
          ],
        })),
      },
    },
  };
  const ledger = {
    get: vi.fn(async () => ({})),
    reset: vi.fn(async () => ({})),
    add: vi.fn(async () => {}),
  };
  const service = new CopilotChatService({
    client: async () => client as any,
    control: async () => session as any,
    access: async () => ({ account: 'copilot:synthetic' }),
    ledger: ledger as any,
    idleTimeoutMs,
  });
  return { service, client, session, ledger, emit };
}
function answer(emit: (type: string, data: any) => void, content = '合成回答') {
  emit('assistant.message_delta', { messageId: 'reply', deltaContent: content });
  emit('assistant.message', { messageId: 'reply', content });
  emit('session.idle', {});
}
describe('Copilot 服务适配与本机资料边界', () => {
  it('使用账户真实目录及其供应商；无搜索时没有网页或本机工具，私有推理不出 IPC', async () => {
    const { service, client, ledger } = chat((emit) => {
      emit('assistant.reasoning_delta', {
        reasoningId: 'private',
        deltaContent: 'PRIVATE THINKING',
      });
      for (let i = 0; i < 2; i++)
        emit('assistant.usage', { apiCallId: 'same-call', inputTokens: 12, outputTokens: 8 });
      answer(emit);
    });
    const events: ChatEvent[] = [];
    expect((await service.models())[0]).toMatchObject({
      reasoningEfforts: ['low', 'high'],
      provider: { id: 'copilot', modelVendor: 'Published Vendor' },
    });
    const result = await service.stream(
      { ...request, effort: 'low' },
      (event) => events.push(event),
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      answerText: '合成回答',
      provider: { id: 'copilot', modelName: 'Account Model' },
      usage: { totalTokens: 20 },
    });
    expect(JSON.stringify(events)).not.toContain('PRIVATE');
    expect(client.rpc.tools.list).not.toHaveBeenCalled();
    const config = client.createSession.mock.calls[0][0];
    expect(config).toMatchObject({
      availableTools: [],
      enableSkills: false,
      enableHostGitOperations: false,
      remoteSession: 'off',
    });
    expect(config).not.toHaveProperty('reasoningSummary');
    expect(config.onPermissionRequest({ kind: 'read', path: 'C:/private' })).toEqual({
      kind: 'reject',
    });
    expect(ledger.add).toHaveBeenCalledTimes(1);
    expect(ledger.add).toHaveBeenCalledWith('copilot:synthetic', 'same-call', {
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
    });
    expect(client.deleteSession).toHaveBeenCalledWith('owned-session');
  });
  it('结构化资料完整校验后才返回提案；只认实际搜索工具提供的来源', async () => {
    const profile = { name: '', background: '已确认简历', jobDescription: '已确认 JD', skills: [] };
    const changes = {
      ...Object.fromEntries(profileFields.map((key) => [key, null])),
      skills: [
        {
          id: 'skill',
          title: '核心技能',
          content: '精简技能说明',
          sources: [{ title: '模型标题', url: 'https://example.com/docs#section' }],
        },
      ],
    };
    const content = JSON.stringify({ answer: '请确认提案', changes });
    const { service, client } = chat((emit) => {
      emit('tool.execution_start', { toolCallId: 'search', toolName: 'web_search' });
      emit('tool.execution_complete', {
        toolCallId: 'search',
        success: true,
        result: {
          citableSources: [
            { url: 'https://example.com/docs?utm_source=search', title: '真实工具标题' },
          ],
        },
      });
      answer(emit, content);
    });
    const result = await service.stream(
      { ...request, profile, profileTask: 'skills', webSearch: true },
      () => {},
      new AbortController().signal,
    );
    expect(result.profileChanges?.skills?.[0].sources).toEqual([
      { url: 'https://example.com/docs?utm_source=search', title: '真实工具标题' },
    ]);
    expect(client.createSession.mock.calls[0][0].availableTools).toEqual([
      'web_search',
      'web_fetch',
    ]);
    const noSearch = chat((emit) => answer(emit, content));
    const unverified = await noSearch.service.stream(
      { ...request, profile, webSearch: true },
      () => {},
      new AbortController().signal,
    );
    expect(unverified.skillSourceIssues).toMatchObject([
      { skillId: 'skill', reason: 'search_incomplete' },
    ]);
    expect(unverified.profileChanges?.skills?.[0].sources).toEqual([]);
    expect(unverified.warning).toBeUndefined();
  });
  it('取消后忽略迟到数据并释放会话，未收到终止事件的连接会超时', async () => {
    const fixture = chat(async () => {});
    const events: ChatEvent[] = [];
    const controller = new AbortController();
    const pending = fixture.service.stream(
      request,
      (event) => events.push(event),
      controller.signal,
    );
    await vi.waitFor(() => expect(fixture.session.send).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toBeDefined();
    const count = events.length;
    answer(fixture.emit, 'LATE');
    expect(events).toHaveLength(count);
    expect(fixture.client.deleteSession).toHaveBeenCalled();
    const timeout = chat(async () => {}, 10);
    await expect(
      timeout.service.stream(request, () => {}, new AbortController().signal),
    ).rejects.toThrow('长时间未返回数据');
  });
  it('模型/服务选择不能通过另一个模型 ID 串到 ChatGPT', async () => {
    const first = { ...chat(() => {}).service, models: vi.fn(async () => []) } as any;
    const second = { ...chat(() => {}).service, models: vi.fn(async () => []) } as any;
    let selected = first;
    const router = new SelectedChatService(() => selected);
    await router.models();
    selected = second;
    await router.models();
    expect(first.models).toHaveBeenCalledOnce();
    expect(second.models).toHaveBeenCalledOnce();
    const fixture = chat(() => {});
    await expect(
      fixture.service.stream(
        { ...request, modelId: 'other-service-model' },
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow('当前不可用');
    expect(fixture.session.send).not.toHaveBeenCalled();
  });
});
