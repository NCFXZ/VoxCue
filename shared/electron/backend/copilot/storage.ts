import { app } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
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
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, file);
}
export function createServiceSelection() {
  const file = path.join(app.getPath('userData'), 'auth-data', 'service.json');
  return {
    async read(): Promise<AIService> {
      const value = await readJson(file);
      if (value === null) return 'chatgpt'; // Existing installations keep their login.
      if (value !== 'chatgpt' && value !== 'copilot') throw Error('模型服务选择无效，请重新登录。');
      return value;
    },
    write: (value: AIService) => writeJson(file, value),
  };
}
