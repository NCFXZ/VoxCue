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
import {
  ProviderCredentialAccess,
  ProviderCredentialUnavailable,
} from '../../electron/backend/auth/providerCredentialAccess';

const authorize =
  'https://github.com/login/oauth/authorize?client_id=official-sdk&state=state&code_challenge=challenge&code_challenge_method=S256&redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Fcallback';
function authentication(
  steps: any[] = [
    {
      kind: 'completed',
      result: { status: 'completed', host: 'https://github.com', login: 'Example' },
    },
  ],
  credentialAccess?: ProviderCredentialAccess,
  retire?: () => Promise<void>,
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
    credentialAccess,
    retire,
  });
  return { service, accounts, write, read, openBrowser };
}
describe('Copilot 浏览器授权边界', () => {
  it('恢复须匹配官方活动账户，空记录不启动 SDK，暂时失败不等于退出', async () => {
    const { service, accounts } = authentication();
    expect(await service.verifiedSession()).toBeNull();
    expect(accounts.get).not.toHaveBeenCalled();
    const session = await service.signIn();
    expect(await service.verifiedSession()).toEqual(session);
    expect(accounts.get).toHaveBeenCalledExactlyOnceWith({ query: { kind: 'activeAccount' } });
    accounts.get.mockRejectedValueOnce(Error('offline'));
    await expect(service.verifiedSession()).rejects.toThrow('无法检查');
    accounts.get.mockResolvedValueOnce({
      kind: 'activeAccount',
      authInfo: { type: 'user', host: 'https://github.com', login: 'Changed' },
    });
    expect(await service.verifiedSession()).toBeNull();
  });
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
    const cliAccount = {
      kind: 'activeAccount',
      authInfo: { type: 'user', host: 'https://github.com', login: 'Example' },
    };
    const previous = structuredClone(cliAccount);
    accounts.get.mockResolvedValue(cliAccount);
    accounts.set.mockImplementationOnce(async () => {
      cliAccount.authInfo.login = '';
      return { ok: true };
    });
    expect(await service.signOut()).toEqual({ warning: null });
    expect(accounts.set).not.toHaveBeenCalled();
    expect(cliAccount).toEqual(previous);
    expect(await service.session()).toBeNull();
    await expect(service.access()).rejects.toThrow('请重新登录');
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
    expect(accounts.set).not.toHaveBeenCalled();
    expect(await service.session()).toBeNull();
  });
  it('退出期间及退出后的迟到本地身份读取不恢复会话', async () => {
    const { service, accounts, read, write } = authentication();
    const previous = await service.signIn();
    let finishRead!: (value: AuthSession | null) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    const pending = service.session();
    let finishLogout!: () => void;
    const persist = write.getMockImplementation()!;
    write.mockClear();
    write.mockImplementationOnce(async (session) => {
      await new Promise<void>((resolve) => {
        finishLogout = resolve;
      });
      await persist(session);
    });
    const logout = service.signOut();
    expect(write).toHaveBeenCalledExactlyOnceWith(null);
    expect(accounts.set).not.toHaveBeenCalled();
    expect(await service.session()).toBeNull();
    await expect(service.access()).rejects.toThrow('账户正在变更');
    await expect(service.signIn()).rejects.toThrow('正在进行');
    await expect(service.signOut()).rejects.toThrow('请先取消');
    finishLogout();
    expect(await logout).toEqual({ warning: null });
    finishRead(previous);
    expect(await pending).toBeNull();
    expect(await service.session()).toBeNull();
    await expect(service.access()).rejects.toThrow('请重新登录');
    expect(accounts.set).not.toHaveBeenCalled();
  });
  it('系统加密不可用时拒绝明文回退，不创建会话', async () => {
    const { service, write, accounts } = authentication([
      { kind: 'completed', result: { status: 'needs-plaintext-consent' } },
    ]);
    await expect(service.signIn()).rejects.toThrow('加密存储不可用');
    expect(write).not.toHaveBeenCalled();
    expect(accounts.login.cancel).toHaveBeenCalledWith({ flowId: 'private-flow' });
  });
  it('官方存储无法保存时停止本次启动的账号和模型读取，只保留本机断开', async () => {
    const stop = vi.fn();
    const gate = new ProviderCredentialAccess('copilot', stop);
    const { service, accounts, write, openBrowser } = authentication(
      [{ kind: 'completed', result: { status: 'needs-plaintext-consent' } }],
      gate,
    );
    await expect(service.signIn()).rejects.toBeInstanceOf(ProviderCredentialUnavailable);
    await expect(service.access()).rejects.toBeInstanceOf(ProviderCredentialUnavailable);
    await expect(service.signIn()).rejects.toBeInstanceOf(ProviderCredentialUnavailable);
    expect(accounts.login.begin).toHaveBeenCalledTimes(1);
    expect(accounts.login.cancel).not.toHaveBeenCalled();
    expect(openBrowser).toHaveBeenCalledTimes(1);
    expect(accounts.get).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(1);
    await service.signOut();
    expect(accounts.set).not.toHaveBeenCalled();
    await expect(service.signIn()).rejects.toBeInstanceOf(ProviderCredentialUnavailable);
  });
  it('并发账号核对收到钥匙串拒绝后不会发出第二个 RPC', async () => {
    const gate = new ProviderCredentialAccess('copilot');
    const { service, accounts } = authentication(undefined, gate);
    await service.signIn();
    accounts.get.mockRejectedValueOnce(Error('Keychain: errSecAuthFailed (-25293)'));
    const attempts = await Promise.allSettled([service.access(), service.access()]);
    for (const result of attempts) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected')
        expect(result.reason).toBeInstanceOf(ProviderCredentialUnavailable);
    }
    expect(accounts.get).toHaveBeenCalledTimes(1);
    await expect(service.session()).rejects.toBeInstanceOf(ProviderCredentialUnavailable);
  });
  it('普通浏览器取消及 HTTP 权限错误允许再次主动连接', async () => {
    const gate = new ProviderCredentialAccess('copilot');
    const { service, accounts, openBrowser } = authentication(undefined, gate);
    openBrowser.mockRejectedValueOnce(Error('Browser login cancelled by user'));
    await expect(service.signIn()).rejects.toThrow('无法完成');
    expect(accounts.login.cancel).toHaveBeenCalledExactlyOnceWith({ flowId: 'private-flow' });
    accounts.login.begin.mockRejectedValueOnce(
      Object.assign(Error('Forbidden'), { statusCode: 403 }),
    );
    await expect(service.signIn()).rejects.toThrow('无法完成');
    await expect(service.signIn()).resolves.toMatchObject({ mode: 'copilot' });
    expect(gate.denied).toBe(false);
  });
  it('登录 RPC 的系统钥匙串错误步骤与普通 OAuth 拒绝分别处理', async () => {
    const gate = new ProviderCredentialAccess('copilot');
    const { service, write } = authentication(
      [
        { kind: 'error', message: 'OAuth authorization declined by user' },
        { kind: 'error', message: 'Keychain: errSecUserCanceled (-128)' },
      ],
      gate,
    );
    await expect(service.signIn()).rejects.toThrow('授权未完成');
    expect(gate.denied).toBe(false);
    await expect(service.signIn()).rejects.toMatchObject({ reason: 'denied' });
    expect(gate.denied).toBe(true);
    expect(write).not.toHaveBeenCalled();
    const unavailable = authentication(
      [{ kind: 'completed', result: { status: 'needs-plaintext-consent' } }],
      new ProviderCredentialAccess('copilot'),
    );
    await expect(unavailable.service.signIn()).rejects.toMatchObject({ reason: 'unavailable' });
    const locked = authentication(
      [{ kind: 'error', message: 'Keychain: errSecInteractionNotAllowed (-25308)' }],
      new ProviderCredentialAccess('copilot'),
    );
    await expect(locked.service.signIn()).rejects.toMatchObject({ reason: 'unavailable' });
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
    await expect(service.signOut()).rejects.toThrow('请先取消');
    service.cancel();
    await expect(attempt).rejects.toThrow('取消');
    finish({ flowId: 'late-flow', step: { kind: 'open-url', url: authorize } });
    await vi.waitFor(() =>
      expect(accounts.login.cancel).toHaveBeenCalledWith({ flowId: 'late-flow' }),
    );
    expect(write).not.toHaveBeenCalled();
  });
  it.each(['acknowledged', 'unconfirmed'])(
    '取消不结算的 OAuth 轮询后仍能登录，旧流程的迟到拒绝不暂停新的登录：%s',
    async (cancel) => {
      const gate = new ProviderCredentialAccess('copilot');
      const retire = vi.fn(async () => {});
      const { service, accounts, write } = authentication(undefined, gate, retire);
      let settle!: (value: unknown) => void;
      accounts.login.advance.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            settle = resolve;
          }),
      );
      if (cancel === 'unconfirmed')
        accounts.login.cancel.mockRejectedValueOnce(Error('old flow closed'));
      const first = service.signIn();
      await vi.waitFor(() => expect(accounts.login.advance).toHaveBeenCalledOnce());
      service.cancel();
      await expect(first).rejects.toThrow('取消');
      expect(accounts.login.cancel).toHaveBeenCalledExactlyOnceWith({ flowId: 'private-flow' });
      expect(retire).toHaveBeenCalledTimes(cancel === 'unconfirmed' ? 1 : 0);
      await expect(service.signIn()).resolves.toMatchObject({ mode: 'copilot' });
      settle({ kind: 'completed', result: { status: 'needs-plaintext-consent' } });
      await Promise.resolve();
      expect(gate.denied).toBe(false);
      expect(write).toHaveBeenCalledTimes(1);
    },
  );
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
  credentialAccess?: ProviderCredentialAccess,
  retire?: () => Promise<void>,
) {
  let handler: (event: any) => void = () => {};
  let eventId = 0;
  const emit = (type: string, data: any) => handler({ type, data, id: `event-${++eventId}` });
  const session = {
    sessionId: 'owned-session',
    rpc: { quota: { refresh: vi.fn(async (): Promise<any> => ({})) } },
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
    credentialAccess,
    retire,
  });
  return { service, client, session, ledger, emit };
}
function answer(emit: (type: string, data: any) => void, content = '合成回答') {
  emit('assistant.message_delta', { messageId: 'reply', deltaContent: content });
  emit('assistant.message', { messageId: 'reply', content });
  emit('session.idle', {});
}
describe('Copilot 服务适配与本机资料边界', () => {
  it('超时额度 RPC 退休后释放模型队列，迟到的旧运行时权限错误不暂停新请求', async () => {
    const timeout = new AbortController();
    const timeoutFactory = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    try {
      const gate = new ProviderCredentialAccess('copilot');
      let retired!: () => void, late!: (reason: Error) => void;
      const retire = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            retired = resolve;
          }),
      );
      const fixture = chat(() => {}, 5000, gate, retire);
      fixture.session.rpc.quota.refresh.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            late = reject;
          }),
      );
      const read = fixture.service.accountUsage().catch((error) => error);
      await vi.waitFor(() => expect(fixture.session.rpc.quota.refresh).toHaveBeenCalledOnce());
      const catalog = fixture.service.models();
      timeout.abort();
      await vi.waitFor(() => expect(retire).toHaveBeenCalledOnce());
      expect(fixture.client.rpc.models.list).not.toHaveBeenCalled();
      retired();
      await expect(read).resolves.toBeInstanceOf(Error);
      await expect(catalog).resolves.toHaveLength(1);
      late(Error('Keychain: errSecUserCanceled'));
      await Promise.resolve();
      expect(gate.denied).toBe(false);
    } finally {
      timeoutFactory.mockRestore();
    }
  });
  it('模型 RPC 明确报告系统存储拒绝后，主动发送与后台额度查询共享暂停状态', async () => {
    const gate = new ProviderCredentialAccess('copilot');
    const fixture = chat(() => {}, 5000, gate);
    fixture.client.rpc.models.list.mockRejectedValueOnce(Error('OSStatus -25308'));
    await expect(fixture.service.models()).rejects.toBeInstanceOf(ProviderCredentialUnavailable);
    await expect(fixture.service.accountUsage()).rejects.toBeInstanceOf(
      ProviderCredentialUnavailable,
    );
    await expect(
      fixture.service.stream(request, () => {}, new AbortController().signal),
    ).rejects.toBeInstanceOf(ProviderCredentialUnavailable);
    expect(fixture.client.rpc.models.list).toHaveBeenCalledTimes(1);
    expect(fixture.client.createSession).not.toHaveBeenCalled();
  });
  it('远端会话权限错误不被当作本地钥匙串拒绝', async () => {
    const gate = new ProviderCredentialAccess('copilot');
    const fixture = chat(
      (emit) =>
        emit('session.error', {
          errorType: 'authorization',
          statusCode: 403,
          message: 'Keychain: errSecAuthFailed',
        }),
      5000,
      gate,
    );
    await expect(
      fixture.service.stream(request, () => {}, new AbortController().signal),
    ).rejects.toMatchObject({ detail: { status: 403, code: 'copilot_authorization' } });
    expect(gate.denied).toBe(false);
    await expect(fixture.service.models()).resolves.toHaveLength(1);
  });
  it('发送时拒绝钥匙串后不再向被终止的运行时发送清理 RPC', async () => {
    const gate = new ProviderCredentialAccess('copilot');
    const fixture = chat(() => {}, 5000, gate);
    fixture.session.send.mockRejectedValueOnce(Error('Keychain: errSecUserCanceled'));
    await expect(
      fixture.service.stream(request, () => {}, new AbortController().signal),
    ).rejects.toBeInstanceOf(ProviderCredentialUnavailable);
    expect(fixture.session.abort).not.toHaveBeenCalled();
    expect(fixture.client.deleteSession).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    '基于模型知识的技能无需搜索来源；工具能力缺失仍可回答：%s',
    async (toolsAvailable) => {
      const skills = [{ id: 'topic', title: 'Topic', content: 'Model knowledge', sources: [] }];
      const content = JSON.stringify({
        answer: 'Review this proposal.',
        changes: { skills },
        skillScope: 'topic',
      });
      const fixture = chat((emit) => answer(emit, content));
      if (!toolsAvailable) fixture.client.rpc.tools.list.mockResolvedValue({ tools: [] });
      const result = await fixture.service.stream(
        {
          ...request,
          webSearch: true,
          profile: { name: '', background: '', jobDescription: '' },
          turns: [
            { role: 'assistant', content: 'Add a Kafka skill?' },
            { role: 'user', content: 'yes' },
          ],
        },
        () => {},
        new AbortController().signal,
      );
      expect(result.profileChanges?.skills).toEqual(skills);
      expect(result.skillSourceIssues).toBeUndefined();
      const config = fixture.client.createSession.mock.calls[0][0];
      expect(config.systemMessage.content).toContain('根据任务判断是否需要使用');
      expect(config.systemMessage.content).not.toContain('否则不要新增或改写技能');
      expect(config.availableTools).toEqual(toolsAvailable ? ['web_search', 'web_fetch'] : []);
      expect(config.onPermissionRequest({ kind: 'read', path: 'C:/private' })).toEqual({
        kind: 'reject',
      });
    },
  );
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
