import { describe, it, expect, vi } from 'vitest';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import {
  createTransaction,
  authorizationURL,
  validateCallback,
  verifyIdentity,
  issuer,
} from '../../../shared/electron/backend/auth/oauth';
import {
  ChatGPTAuthService,
  type AuthStorage,
  type CredentialRecord,
} from '../../../shared/electron/backend/auth/service';
function memoryStorage(initial: CredentialRecord | null = null) {
  let saved = initial;
  const storage: AuthStorage = {
    hostId: async () => 'urn:uuid:00000000-0000-4000-8000-000000000000',
    read: async () => saved,
    write: async (record) => {
      saved = structuredClone(record);
    },
  };
  return { storage, record: () => saved };
}
describe('ChatGPT OAuth identity boundary', () => {
  it('fresh PKCE/state/nonce, stable host and returning registration', () => {
    const first = createTransaction('http://127.0.0.1:1234/auth/callback', 'urn:uuid:host');
    const second = createTransaction(
      first.redirectUri,
      first.hostId,
      'oaiapp_saved',
      'subject',
      'test@example.test',
    );
    const initialURL = new URL(authorizationURL(first));
    const returningURL = new URL(authorizationURL(second));
    expect(first.state).not.toBe(second.state);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.verifier).not.toBe(second.verifier);
    expect(initialURL.searchParams.get('code_challenge_method')).toBe('S256');
    expect(initialURL.searchParams.get('code_challenge')).not.toBe(first.verifier);
    expect(initialURL.searchParams.get('ext_agent_host_id')).toBe(
      returningURL.searchParams.get('ext_agent_host_id'),
    );
    expect(initialURL.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(returningURL.searchParams.get('client_id')).toBe('oaiapp_saved');
    expect(returningURL.searchParams.has('agent_name_hint')).toBe(false);
  });
  it('rejects wrong/repeated state, missing registration and changed client ID', () => {
    const transaction = createTransaction('http://127.0.0.1:1234/auth/callback', 'host');
    const callback = new URL(
      `${transaction.redirectUri}?state=${transaction.state}&code=test&client_id=oaiapp_new`,
    );
    expect(validateCallback(callback, transaction).clientId).toBe('oaiapp_new');
    callback.searchParams.append('state', transaction.state);
    expect(() => validateCallback(callback, transaction)).toThrow('重复');
    callback.searchParams.set('state', 'wrong');
    expect(() => validateCallback(callback, transaction)).toThrow('校验');
    callback.searchParams.set('state', transaction.state);
    callback.searchParams.delete('client_id');
    expect(() => validateCallback(callback, transaction)).toThrow('注册');
    callback.searchParams.set('client_id', 'oaiapp_changed');
    expect(() => validateCallback(callback, { ...transaction, clientId: 'oaiapp_saved' })).toThrow(
      '不匹配',
    );
  });
  it('cryptographically verifies signature, issuer, audience, nonce and expiry', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const { privateKey: wrongKey } = await generateKeyPair('RS256');
    const key = createLocalJWKSet({
      keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'test' }],
    });
    const token = (
      options: { nonce?: string; audience?: string; iss?: string; exp?: number } = {},
      signingKey = privateKey,
    ) =>
      new SignJWT({ nonce: options.nonce ?? 'nonce', email: 'test@example.test', name: 'Test' })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer(options.iss ?? issuer)
        .setAudience(options.audience ?? 'oaiapp_test')
        .setSubject('subject')
        .setIssuedAt()
        .setExpirationTime(options.exp ?? Math.floor(Date.now() / 1000) + 3600)
        .sign(signingKey);
    expect((await verifyIdentity(await token(), 'oaiapp_test', 'nonce', key)).subject).toBe(
      'subject',
    );
    for (const invalid of [
      await token({ nonce: 'wrong' }),
      await token({ audience: 'wrong' }),
      await token({ iss: 'https://attacker.test' }),
      await token({ exp: Math.floor(Date.now() / 1000) - 60 }),
      await token({}, wrongKey),
    ]) {
      await expect(verifyIdentity(invalid, 'oaiapp_test', 'nonce', key)).rejects.toThrow();
    }
  });
});
describe('Local authentication service', () => {
  it('retries storage after a temporary Keychain denial without rewriting credentials', async () => {
    const record: CredentialRecord = {
      version: 1,
      hostId: 'host',
      clientId: 'oaiapp_fixture',
      subject: 'subject',
      name: 'Synthetic',
      email: '',
      expiresAt: Date.now() + 10000,
      idToken: 'synthetic-only',
    };
    const read = vi.fn().mockRejectedValueOnce(Error('Keychain denied')).mockResolvedValue(record);
    const write = vi.fn();
    const service = new ChatGPTAuthService({
      storage: { read, write, hostId: async () => 'host' },
      openBrowser: async () => {},
    });
    const first = await Promise.allSettled([service.session(), service.session()]);
    expect(first.every((result) => result.status === 'rejected')).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect((await service.session())?.user.name).toBe('Synthetic');
    expect(read).toHaveBeenCalledTimes(2);
    expect(write).not.toHaveBeenCalled();
  });
  it('stops explicit sign-in before opening a browser if the credential store cannot be read', async () => {
    const failure = Object.assign(Error('Synthetic storage unavailable'), { code: 'EIO' });
    const openBrowser = vi.fn(), write = vi.fn(), hostId = vi.fn();
    const service = new ChatGPTAuthService({
      storage: { read: vi.fn().mockRejectedValue(failure), write, hostId },
      openBrowser,
    });
    await expect(service.signIn()).rejects.toThrow('无法完成 ChatGPT 登录，请检查网络后重试。');
    expect(hostId).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
  it('validates loopback before exchange, persists issued registration and exposes no credentials', async () => {
    const data = memoryStorage();
    const network = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id_token: 'test-id-token',
          access_token: 'secret-access',
          refresh_token: 'secret-refresh',
          scope: 'openid profile email',
        }),
      ),
    );
    const verify = vi.fn().mockResolvedValue({
      subject: 'subject',
      name: 'Test',
      email: 'test@example.test',
      expiresAt: Date.now() + 3600000,
    });
    const service = new ChatGPTAuthService({
      storage: data.storage,
      fetch: network,
      verify,
      callbackLogo: async () => Buffer.from('synthetic-local-logo'),
      openBrowser: async (address) => {
        const url = new URL(address);
        const callback = new URL(url.searchParams.get('redirect_uri')!);
        callback.search = new URLSearchParams({
          state: 'attacker',
          code: 'bad',
          client_id: 'oaiapp_test',
        }).toString();
        const invalid = await fetch(callback);
        expect(invalid.status).toBe(400);
        expect(await invalid.text()).toContain('未能确认授权');
        expect(network).not.toHaveBeenCalled();
        callback.searchParams.set('state', url.searchParams.get('state')!);
        callback.searchParams.set('code', 'one-time-code');
        const received = await fetch(callback);
        expect(received.status).toBe(200);
        expect(received.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(received.headers.get('cache-control')).toBe('no-store');
        expect(received.headers.get('referrer-policy')).toBe('no-referrer');
        expect(received.headers.get('x-content-type-options')).toBe('nosniff');
        expect(received.headers.get('content-security-policy')).toMatch(
          /^default-src 'none'; style-src 'sha256-[^']+'; img-src data:;/,
        );
        const html = await received.text();
        expect(html).toContain('授权已收到');
        expect(html).toContain('你现在可以关闭此页面');
        expect(html).toContain(
          'data:image/png;base64,' + Buffer.from('synthetic-local-logo').toString('base64'),
        );
        expect(html).not.toMatch(/<(?:script|form|iframe)\b|https?:\/\//i);
        for (const secret of [
          'one-time-code',
          url.searchParams.get('state')!,
          'secret-access',
          'secret-refresh',
        ])
          expect(html).not.toContain(secret);
        // Receiving a code is not yet a verified application session.
        expect(html).not.toContain('登录成功');
        const repeated = await fetch(callback);
        expect(repeated.status).toBe(409);
        expect(await repeated.text()).toContain('授权链接已使用');
      },
    });
    const session = await service.signIn();
    expect(session.mode).toBe('chatgpt');
    expect(JSON.stringify(session)).not.toContain('token');
    expect(network).toHaveBeenCalledTimes(1);
    const form = network.mock.calls[0][1]!.body as URLSearchParams;
    expect(form.get('client_id')).toBe('oaiapp_test');
    expect(form.get('code')).toBe('one-time-code');
    expect(form.has('client_secret')).toBe(false);
    expect(verify).toHaveBeenCalled();
    expect(data.record()?.refreshToken).toBe('secret-refresh');
    expect(
      (
        await new ChatGPTAuthService({
          storage: data.storage,
          openBrowser: async () => {},
        }).session()
      )?.user.id,
    ).toBe('subject');
  });
  it('declined consent never exchanges a code or creates a session', async () => {
    const data = memoryStorage();
    const network = vi.fn<typeof fetch>();
    const service = new ChatGPTAuthService({
      storage: data.storage,
      fetch: network,
      openBrowser: async (address) => {
        const url = new URL(address);
        const callback = new URL(url.searchParams.get('redirect_uri')!);
        callback.search = new URLSearchParams({
          state: url.searchParams.get('state')!,
          error: 'access_denied',
        }).toString();
        await fetch(callback);
      },
    });
    await expect(service.signIn()).rejects.toThrow('未完成');
    expect(network).not.toHaveBeenCalled();
    expect(data.record()).toBeNull();
  });
  it('cancellation and timeout close the attempt without storing a session', async () => {
    const data = memoryStorage();
    const service = new ChatGPTAuthService({
      storage: data.storage,
      openBrowser: async () => {
        service.cancel();
      },
    });
    await expect(service.signIn()).rejects.toThrow('取消');
    const timeout = new ChatGPTAuthService({
      storage: data.storage,
      timeoutMs: 30,
      openBrowser: async () => {},
    });
    await expect(timeout.signIn()).rejects.toThrow('超时');
    expect(data.record()).toBeNull();
    expect(service.isPending()).toBe(false);
  });
  it('verification failure never persists credentials', async () => {
    const data = memoryStorage();
    const service = new ChatGPTAuthService({
      storage: data.storage,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ id_token: 'forged' }))),
      verify: async () => {
        throw new Error('invalid signature');
      },
      openBrowser: async (address) => {
        const url = new URL(address);
        const callback = new URL(url.searchParams.get('redirect_uri')!);
        callback.search = new URLSearchParams({
          state: url.searchParams.get('state')!,
          code: 'code',
          client_id: 'oaiapp_test',
        }).toString();
        await fetch(callback);
      },
    });
    await expect(service.signIn()).rejects.toThrow();
    expect(data.record()).toBeNull();
  });
  it('sign-out clears tokens, retains client mapping and warns when remote revocation fails', async () => {
    const data = memoryStorage({
      version: 1,
      hostId: 'host',
      clientId: 'oaiapp_test',
      subject: 'subject',
      name: 'Test',
      email: '',
      expiresAt: Date.now() + 10000,
      idToken: 'id',
      accessToken: 'access',
      refreshToken: 'refresh',
    });
    const network = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
    const service = new ChatGPTAuthService({
      storage: data.storage,
      fetch: network,
      openBrowser: async () => {},
    });
    expect((await service.signOut()).warning).toContain('未能确认');
    expect(await service.session()).toBeNull();
    expect(data.record()?.clientId).toBe('oaiapp_test');
    expect(data.record()?.refreshToken).toBeUndefined();
    expect(data.record()?.idToken).toBeUndefined();
  });
});
