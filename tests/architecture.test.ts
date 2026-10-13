import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  dependencies,
  boundaryViolations,
  runtimeCycles,
  checkArchitecture,
  ipcCoverage,
} from '../scripts/check-architecture.mjs';

describe('长期模块边界', () => {
  it('当前实际源码没有越层依赖或运行时环', () => {
    const result = checkArchitecture(process.cwd());
    expect(result.violations).toEqual([]);
    expect(result.cycles).toEqual([]);
  });
  it('区分 type-only、重导出、动态 import 和 CommonJS require', () => {
    const edges = dependencies(
      'sample.ts',
      `
      import type { A } from './a';
      import { type B } from './b';
      export type { C } from './c';
      export { type D } from './d';
      type E = import('./e').E;
      export { F } from './f';
      import('./g');
      require('./h');
      import I = require('./i');
    `,
    );
    expect(edges.map((edge: { typeOnly: boolean }) => edge.typeOnly)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });
  it('类型引用环不当作运行时环，动态依赖环会失败', () => {
    const graph = new Map([
      ['a', [{ target: 'b', typeOnly: true }]],
      ['b', [{ target: 'a', typeOnly: false }]],
    ]);
    expect(runtimeCycles(graph)).toEqual([]);
    graph.get('a')![0].typeOnly = false;
    expect(runtimeCycles(graph)).toEqual([['a', 'b', 'a']]);
  });
  it.each([
    ['src/services/bad.ts', 'node:fs'],
    ['src/components/bad.tsx', 'electron/backend/speech/service.ts'],
    ['src/stores/bad.ts', 'src/components/PreparationPage.tsx'],
    ['electron/backend/speech/bad.ts', 'electron/ipc/chat.ts'],
    ['electron/backend/chat/bad.ts', 'electron/application/chat.ts'],
    ['electron/contracts/bad.ts', 'electron/backend/auth/service.ts'],
    ['electron/application/bad.ts', 'electron/backend/chat/service.ts'],
    ['electron/preload.ts', 'electron/contracts/desktop.ts'],
  ])('拒绝 %s → %s', (file, target) => {
    expect(
      boundaryViolations(new Map([[file, [{ target, line: 1, typeOnly: false }]]])),
    ).not.toEqual([]);
  });
  it('preload 可以导入共享类型，Renderer 可以复用公开纯校验', () => {
    expect(
      boundaryViolations(
        new Map([
          [
            'electron/preload.ts',
            [{ target: 'electron/contracts/desktop.ts', line: 1, typeOnly: true }],
          ],
          [
            'src/stores/preparation.ts',
            [{ target: 'electron/contracts/profile.ts', line: 1, typeOnly: false }],
          ],
        ]),
      ),
    ).toEqual([]);
  });
  it('双向频道检查拒绝缺失路由和未声明的 preload 频道', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'voxcue-ipc-architecture-'));
    try {
      mkdirSync(path.join(root, 'electron/contracts'), { recursive: true });
      mkdirSync(path.join(root, 'electron/ipc'), { recursive: true });
      writeFileSync(
        path.join(root, 'electron/contracts/desktop.ts'),
        `
        interface DesktopInvokeMap { 'chat:send': unknown; }
        interface DesktopSendMap {}
        interface DesktopEventMap {}
      `,
      );
      writeFileSync(path.join(root, 'electron/main.ts'), '');
      writeFileSync(
        path.join(root, 'electron/preload.ts'),
        "invoke('chat:send'); invoke('private:raw');",
      );
      expect(ipcCoverage(root)).toEqual([
        'Main DesktopInvokeMap missing chat:send',
        'Preload DesktopInvokeMap undeclared private:raw',
      ]);
    } finally {
      if (
        path.dirname(root) !== path.resolve(tmpdir()) ||
        !path.basename(root).startsWith('voxcue-ipc-architecture-')
      )
        throw new Error('Unexpected architecture fixture path');
      rmSync(root, { recursive: true, force: true });
    }
  });
});
