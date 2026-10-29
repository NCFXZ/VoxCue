import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalMode } from '../../electron/backend/localMode';

describe('local access preference', () => {
  it('requires explicit entry, survives restart and can return to login without touching other data', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voxcue-local-mode-'));
    try {
      const file = path.join(root, 'local-mode.json');
      await fs.writeFile(path.join(root, 'synthetic-data'), 'keep');
      const first = new LocalMode(file);
      await first.load();
      expect(first.active).toBe(false);
      await first.set(true);
      const restored = new LocalMode(file);
      await restored.load();
      expect(restored.active).toBe(true);
      await restored.set(false);
      const loggedOut = new LocalMode(file);
      await loggedOut.load();
      expect(loggedOut.active).toBe(false);
      expect(await fs.readFile(path.join(root, 'synthetic-data'), 'utf8')).toBe('keep');
      expect((await fs.readdir(root)).sort()).toEqual(['local-mode.json', 'synthetic-data']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('does not grant access on corruption or failed persistence and retires temporary writes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voxcue-local-mode-'));
    try {
      const file = path.join(root, 'local-mode.json');
      await fs.writeFile(file, '{"user":"fake"}');
      const mode = new LocalMode(file);
      await expect(mode.load()).rejects.toThrow();
      expect(mode.active).toBe(false);
      await expect(mode.set('yes' as never)).rejects.toThrow('Invalid');
      await fs.rm(file);
      await fs.mkdir(file);
      await expect(mode.set(true)).rejects.toThrow();
      expect(mode.active).toBe(false);
      expect(await fs.readdir(root)).toEqual(['local-mode.json']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('rejects concurrent transitions rather than committing an older choice', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voxcue-local-mode-'));
    try {
      const mode = new LocalMode(path.join(root, 'local-mode.json'));
      const entering = mode.set(true);
      await expect(mode.set(false)).rejects.toThrow('正在切换');
      await entering;
      expect(mode.active).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
