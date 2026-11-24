import { app } from 'electron';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicFile } from '../atomicFile';
import type { AccountConnection, AccountService, AIService, AuthSession, AuthUser } from '../../contracts/auth';
import { isApiProvider, isRetiredApiProvider } from '../../contracts/apiConnections';
import type { CopilotLoginStorage } from './auth';

// Identity and selection only. OAuth tokens stay in the official runtime's OS vault.
export function createCopilotLoginStorage(root = app.getPath('userData')): CopilotLoginStorage {
  const file = path.join(root, 'auth-data', 'copilot-session.json');
  return {
    async read() {
      const value = await readJson(file);
      if (value === null) return null;
      if (
        value.mode !== 'copilot' ||
        !/^github\.com:[A-Za-z0-9-]{1,100}$/.test(value.user?.id) ||
        value.user.id !== `github.com:${value.user.name}` ||
        value.user.email !== ''
      )
        throw Error('Copilot 登录信息无效，请重新登录。');
      return { mode: 'copilot', user: { ...value.user }, expiresAt: null } as AuthSession;
    },
    write: (session) => writeJson(file, session),
  };
}
async function readJson(file: string): Promise<any> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await atomicFile(file, JSON.stringify(value));
}
// Display metadata only; enabling still verifies the official runtime's session.
export function createAccountServiceStorage(root = app.getPath('userData')) {
  const file = path.join(root, 'auth-data', 'account-services.json');
  let connections: AccountConnection[] = [];
  let closed = false;
  let repaired = false;
  let writing = Promise.resolve();
  const ready = readJson(file).then((stored) => {
    if (stored === null) return;
    if (!Array.isArray(stored) || stored.length > 2)
      throw Error('登录状态记录无效，请重新登录。');
    const parsed = stored.map((entry): AccountConnection => {
      const value = typeof entry === 'string' ? { service: entry, name: '', email: '' } : entry;
      if (!value || (value.service !== 'chatgpt' && value.service !== 'copilot') ||
          [value.name, value.email].some(field => typeof field !== 'string' ||
            field.length > 512 || /[\u0000-\u001f\u007f]/.test(field)))
        throw Error('登录状态记录无效，请重新登录。');
      return { service: value.service, name: value.name, email: value.email };
    });
    connections = [...new Map(parsed.map(entry => [entry.service, entry])).values()];
  });
  void ready.catch(() => {});
  return {
    async list() {
      await ready.catch((error) => { if (!repaired) throw error; });
      await writing;
      if (closed) throw Error('账号已变化，请重新操作。');
      return connections.map(entry => entry.service);
    },
    async details() {
      await ready.catch((error) => { if (!repaired) throw error; });
      await writing;
      if (closed) throw Error('账号已变化，请重新操作。');
      return connections.map(entry => ({ ...entry }));
    },
    set(service: AccountService, signedIn: boolean, user?: Pick<AuthUser, 'name' | 'email'>) {
      const job = writing.catch(() => {}).then(async () => {
        await ready.catch(() => {});
        if (closed) throw Error('账号已变化，请重新操作。');
        const previous = connections.find(item => item.service === service);
        const next = connections.filter((item) => item.service !== service);
        if (signedIn) next.push({ service,
          name: user?.name ?? previous?.name ?? '', email: user?.email ?? previous?.email ?? '',
        });
        await writeJson(file, next);
        connections = next;
        repaired = true;
      });
      writing = job;
      return job;
    },
    dispose() {
      closed = true;
      return writing.catch(() => {});
    },
  };
}
export function createServiceSelection(root = app.getPath('userData')) {
  const file = path.join(root, 'auth-data', 'service.json');
  type Selection = { service: AIService; connected: boolean | null };
  let value: Selection = { service: 'chatgpt', connected: null };
  let revision = 0;
  let repaired = false;
  let closed = false;
  let pendingSave = Promise.resolve();
  let query: Promise<AuthSession | null> | undefined;
  const ready = readJson(file).then((stored) => {
    if (stored === null) return;
    // Both previous releases wrote this string only following a successful login.
    // They left it behind on logout, so an actual provider check is still needed.
    if (stored === 'chatgpt' || stored === 'copilot') {
      value = { service: stored, connected: true };
      return;
    }
    if (stored.version === 2 && typeof stored.connected === 'boolean') {
      const { service, connected } = stored;
      if (service === 'chatgpt' || service === 'copilot' || isApiProvider(service)) {
        value = { service, connected };
        return;
      }
      if (isRetiredApiProvider(service)) {
        value = { service: 'chatgpt', connected: false };
        return;
      }
    }
    throw Error('模型服务选择无效，请重新登录。');
  });
  const save = async (service: AIService, connected: boolean) => {
    if (closed) throw Error('账号已变化，请重新操作。');
    const current = ++revision;
    const job = pendingSave.catch(() => {}).then(() => writeJson(file, { version: 2, service, connected }));
    pendingSave = job;
    await job;
    repaired = true;
    value = { service, connected };
    return current;
  };
  return {
    ready,
    get service() { return value.service; },
    get connected() { return value.connected; },
    // Retire any late provider result before starting an explicit change.
    changing() {
      revision++;
      query = undefined;
    },
    dispose() {
      closed = true;
      revision++;
      query = undefined;
      return pendingSave.catch(() => {});
    },
    async set(service: AIService, connected: boolean) {
      await ready.catch(() => {}); // An explicit choice can repair invalid metadata.
      await save(service, connected);
      query = undefined;
    },
    async session(
      mode: AIService | 'startup' | undefined,
      verify: (service: AIService) => Promise<AuthSession | null>,
    ) {
      const current = revision;
      await ready.catch((error) => { if (!repaired) throw error; });
      await pendingSave;
      if (closed || current !== revision) return null;
      const { service, connected } = value;
      if (mode === 'startup' && !connected) return null;
      if (mode === undefined && connected === false) return null;
      if (mode && mode !== 'startup' && mode !== service) return null;
      if (mode === 'startup' && query) return query;
      const check = async () => {
        let result: AuthSession | null;
        try {
          result = await verify(service);
        } catch (error) {
          if (current !== revision) return null;
          throw error;
        }
        if (current !== revision) return null;
        if (!result && connected) await save(service, false);
        if (result && mode === service && !connected) {
          const saved = await save(service, true);
          if (saved !== revision) return null;
          query = undefined;
        }
        return result;
      };
      const job = check();
      if (mode === 'startup') query = job;
      return job;
    },
  };
}
