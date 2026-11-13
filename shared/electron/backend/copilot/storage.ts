import { app } from 'electron';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicFile } from '../atomicFile';
import type { AIService, AuthSession } from '../../contracts/auth';
import type { CopilotLoginStorage } from './auth';

// Identity and selection only. OAuth tokens stay in the official runtime's OS vault.
export function createCopilotLoginStorage(): CopilotLoginStorage {
  const file = path.join(app.getPath('userData'), 'auth-data', 'copilot-session.json');
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
export function createServiceSelection() {
  const file = path.join(app.getPath('userData'), 'auth-data', 'service.json');
  type Selection = { service: AIService; connected: boolean | null };
  let value: Selection = { service: 'chatgpt', connected: null };
  let revision = 0;
  let repaired = false;
  let pendingSave = Promise.resolve();
  let query: Promise<AuthSession | null> | undefined;
  const ready = readJson(file).then((stored) => {
    if (stored === null) return;
    // Both previous releases wrote this string only following a successful login.
    // They left it behind on logout, so an actual provider check is still needed.
    if (stored === 'chatgpt' || stored === 'copilot') value = { service: stored, connected: true };
    else if (
      stored.version === 2 && (stored.service === 'chatgpt' || stored.service === 'copilot') &&
      typeof stored.connected === 'boolean'
    ) value = { service: stored.service, connected: stored.connected };
    else throw Error('模型服务选择无效，请重新登录。');
  });
  const save = async (service: AIService, connected: boolean) => {
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
    // Retire any late provider result before starting an explicit change.
    changing() {
      revision++;
      query = undefined;
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
      if (current !== revision) return null;
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
