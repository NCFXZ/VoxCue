import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const list = (...args: string[]) =>
  spawnSync(process.execPath, ['test/scripts/ui-refinement-matrix.mjs', '--list', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10000,
  });

it('lists the complete five-scale Mac matrix without starting GUI or preparing models', () => {
  const result = list();
  expect(result.status).toBe(0);
  const plan = JSON.parse(result.stdout);
  expect(plan.scales).toEqual(['1', '1.25', '1.5', '1.75', '2']);
  expect(new Set(plan.names).size).toBe(42);
  expect(plan.names).toEqual([
    'web-materials',
    'ui-material-refinement',
    'ui-alignment',
    'ui-refinement',
    'interview-screenshot',
    'interview-typography',
    'interview-chrome',
    'interview-ux',
    'typography',
    'updates',
    'updates-sidebar',
    'components-ui',
    'cloud-login',
    'cloud-account',
    'password-policy',
    'free-service',
    'account-erasure',
    'management-scrollbars',
    'client-update-ui',
    'shimmer',
    'knowledge',
    'local-mode',
    'telemetry',
    'settings',
    'shortcut-settings',
    'interview-badge-layout',
    'interview-shortcuts',
    'mobile-ui',
    'language',
    'preparation-guide',
    'profile-ui',
    'profile-selection',
    'history-branding',
    'history-scroll',
    'login',
    'login-entry',
    'composer',
    'conversations',
    'provider-ui',
    'chat-response',
    'chat-progress',
    'account-usage-overview',
  ]);
  expect(plan.models).toBe(true);
});

it('keeps explicit reruns and fixed scales, skips only audited model preparation and rejects typos', () => {
  const result = list('--scale=1.75', '--suite=language,account-usage-overview,language');
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    scales: ['1.75'],
    names: ['language', 'account-usage-overview', 'language'],
    models: false,
  });
  expect(list('--suite=profile-ui').status).toBe(0);
  expect(JSON.parse(list('--suite=profile-ui').stdout).models).toBe(true);
  expect(list('--suite=langauge').status).not.toBe(0);
  expect(list('--scale=3').status).not.toBe(0);
});

it('records a spawn failure and still executes every later selected protocol group', () => {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const cp = require('node:child_process');
    const { EventEmitter } = require('node:events');
    const { PassThrough } = require('node:stream');
    let launched = 0;
    cp.spawn = () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => false;
      const fail = launched++ === 0;
      queueMicrotask(() => fail
        ? child.emit('error', new Error('synthetic spawn failure'))
        : child.emit('exit', 0));
      return child;
    };
    require('node:module').syncBuiltinESMExports();
    process.argv = [process.execPath, 'functional-suite', 'cloud-protocol', 'server-connection', 'telemetry-v2-http'];
    import('../shared/test/scripts/functional-suite.mjs');
  `,
    ],
    { cwd: root, encoding: 'utf8', timeout: 10000 },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('synthetic spawn failure');
  const summary = JSON.parse(result.stdout.trim().split('\n').at(-1)!);
  expect(summary.total).toBe(3);
  expect(summary.passed).toBe(2);
  expect(
    summary.outcomes.map(({ name, passed }: { name: string; passed: boolean }) => [name, passed]),
  ).toEqual([
    ['cloud-protocol', false],
    ['server-connection', true],
    ['telemetry-v2-http', true],
  ]);
});
