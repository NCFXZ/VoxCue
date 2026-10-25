import path from 'node:path';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { verifyCodexRenewal } from './codex-renewal-fixture.mjs';

const { CodexUsageRuntime } = workspace.platformRequire(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/chat/codexUsage.js'),
);
await verifyCodexRenewal({ Runtime: CodexUsageRuntime, spawn: spawnTestProcess, root: testRoot });
