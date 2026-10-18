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
    ['shared/src/services/bad.ts', 'node:fs'],
    ['macos/src/bad.tsx', 'node:fs'],
    ['macos/src/bad.tsx', 'shared/electron/backend/auth/storage.ts'],
    ['shared/src/components/bad.tsx', 'shared/electron/backend/speech/service.ts'],
    ['shared/src/stores/bad.ts', 'shared/src/components/PreparationPage.tsx'],
    ['shared/electron/backend/speech/bad.ts', 'shared/electron/ipc/chat.ts'],
    ['macos/electron/updates/bad.ts', 'shared/electron/backend/auth/storage.ts'],
    ['macos/electron/updates/bad.ts', 'shared/electron/backend/speech/service.ts'],
    ['shared/electron/backend/chat/bad.ts', 'shared/electron/application/chat.ts'],
    ['shared/electron/contracts/bad.ts', 'shared/electron/backend/auth/service.ts'],
    ['shared/electron/application/bad.ts', 'shared/electron/backend/chat/service.ts'],
    ['shared/electron/preload.ts', 'shared/electron/contracts/desktop.ts'],
    ['shared/src/services/knowledge.ts', '@lancedb/lancedb'],
    ['shared/src/services/knowledge.ts', '@huggingface/transformers'],
    ['shared/electron/backend/chat/bad.ts', '@lancedb/lancedb'],
    ['shared/electron/backend/knowledge/bad.ts', 'shared/electron/backend/auth/service.ts'],
    ['shared/electron/backend/knowledge/host.ts', 'shared/electron/backend/knowledge/service.ts'],
    ['shared/electron/backend/speech/engine.ts', 'shared/electron/application/interviewContext.ts'],
    ['shared/src/stores/interview.ts', 'shared/electron/application/interviewContext.ts'],
    ['shared/electron/contracts/speech.ts', 'shared/electron/application/interviewContext.ts'],
    ['shared/electron/contracts/speech.ts', 'shared/electron/backend/speech/models.ts'],
    ['shared/electron/main.ts', 'shared/electron/backend/speech/engine.ts'],
    ['shared/electron/backend/speech/host.ts', 'shared/electron/backend/speech/engine.ts'],
    ['shared/src/stores/updates.ts', 'electron-updater'],
    ['shared/electron/main.ts', 'electron-updater'],
    ['shared/src/services/auth.ts', '@github/copilot-sdk'],
    ['shared/electron/preload.ts', '@github/copilot-sdk'],
    ['shared/electron/application/interviewContext.ts', '@github/copilot-sdk'],
    ['shared/electron/backend/updates/service.ts', 'shared/electron/backend/auth/storage.ts'],
    ['shared/electron/backend/updates/service.ts', 'shared/electron/backend/knowledge/service.ts'],
    ['windows/electron/platform.ts', 'shared/electron/backend/auth/storage.ts'],
    ['macos/electron/platform.ts', 'shared/electron/ipc/chat.ts'],
    ['shared/electron/platform/index.ts', 'shared/electron/window.ts'],
    ['shared/electron/window.ts', 'shared/electron/application/speech.ts'],
    ['shared/electron/window.ts', 'shared/electron/backend/speech/host.ts'],
    ['shared/electron/backend/auth/storage.ts', 'shared/electron/platform/index.ts'],
    ['shared/electron/application/speech.ts', 'shared/electron/window.ts'],
    ['shared/electron/application/interviewContext.ts', 'shared/electron/screenshot.ts'],
    ['shared/electron/screenshot.ts', 'node:fs'],
    ['shared/electron/screenshot.ts', 'shared/electron/backend/auth/storage.ts'],
    ['shared/electron/screenshot.ts', 'shared/electron/backend/chat/service.ts'],
    ['shared/electron/backend/updates/releases.ts', 'electron-updater'],
    ['shared/electron/backend/updates/releases.ts', 'electron'],
    ['shared/electron/backend/updates/releases.ts', 'shared/electron/backend/updates/provider.ts'],
    ['windows/electron/speech/capture.ts', 'macos/electron/platform.ts'],
    ['macos/electron/platform.ts', 'windows/electron/speech/capture.ts'],
    ['shared/electron/backend/speech/host.ts', 'windows/electron/speech/capture.ts'],
    ['shared/electron/main.ts', 'windows/electron/speech/capture.ts'],
    ['shared/electron/platform/index.ts', 'macos/electron/platform.ts'],
    ['macos/electron/screenPermission.ts', 'node:fs'],
    ['macos/electron/screenPermission.ts', 'shared/electron/screenshot.ts'],
    ['shared/src/services/speech.ts', 'macos/electron/platform.ts'],
    ['shared/electron/backend/chat/service.ts', './missing-module'],
    ['shared/src/services/chat.ts', 'shared/test/fixtures/mock.ts'],
    ['windows/electron/speech/capture.ts', 'windows/test/scripts/fixture.ts'],
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
            'shared/electron/preload.ts',
            [{ target: 'shared/electron/contracts/desktop.ts', line: 1, typeOnly: true }],
          ],
          [
            'shared/src/stores/preparation.ts',
            [{ target: 'shared/electron/contracts/profile.ts', line: 1, typeOnly: false }],
          ],
        ]),
      ),
    ).toEqual([]);
  });
  it('新知识后台可使用已授权 LanceDB/本地推理，旧 SQLite 方案仍拒绝', () => {
    for (const target of ['@lancedb/lancedb', '@huggingface/transformers', 'pdf-parse', 'mammoth'])
      expect(
        boundaryViolations(
          new Map([
            [
              'shared/electron/backend/knowledge/service.ts',
              [{ target, line: 1, typeOnly: false }],
            ],
          ]),
        ),
      ).toEqual([]);
    expect(
      boundaryViolations(
        new Map([
          [
            'shared/electron/backend/knowledge/service.ts',
            [{ target: 'sqlite-vec', line: 1, typeOnly: false }],
          ],
        ]),
      ),
    ).not.toEqual([]);
  });
  it('双向频道检查拒绝缺失路由和未声明的 preload 频道', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'voxcue-ipc-architecture-'));
    try {
      mkdirSync(path.join(root, 'shared/electron/contracts'), { recursive: true });
      mkdirSync(path.join(root, 'shared/electron/ipc'), { recursive: true });
      writeFileSync(
        path.join(root, 'shared/electron/contracts/desktop.ts'),
        `
        interface DesktopInvokeMap { 'chat:send': unknown; }
        interface DesktopSendMap {}
        interface DesktopEventMap {}
      `,
      );
      writeFileSync(path.join(root, 'shared/electron/main.ts'), '');
      writeFileSync(
        path.join(root, 'shared/electron/preload.ts'),
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
