import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { testRoot } from '../scripts/test-workspace.mjs';
import {
  assertOwnerElectronLaunch,
  verifySyntheticElectronPackage,
  syntheticElectronEntry,
  syntheticElectronHtml,
} from '../scripts/electron-launch-policy.mjs';

function fixture() {
  const root = path.join(testRoot, randomUUID());
  mkdirSync(root);
  const host = path.join(root, 'electron.exe');
  writeFileSync(host, 'inert executable identity; never executed');
  const profile = path.join(root, 'profile');
  mkdirSync(profile);
  return {
    root,
    host,
    profile,
    policy: {
      testRoot: root,
      defaultHost: host,
      platformRoot: path.resolve('..', 'windows'),
      developmentHosts: [{ path: host }],
      syntheticPackages: new Map(),
    },
  };
}

describe('owner-side Electron launch isolation', () => {
  it('rejects product executables regardless of name, inspector availability or environment', () => {
    const { root, host, profile, policy } = fixture();
    for (const name of ['VoxCue.exe', 'renamed-electron.exe', 'VoxCue.app/Contents/MacOS/VoxCue']) {
      const binary = path.join(root, name);
      expect(() =>
        assertOwnerElectronLaunch(
          { executablePath: binary, args: [], env: { COPILOT_TEST_USER_DATA: profile } },
          policy,
        ),
      ).toThrow(/require OS isolation/);
    }
    expect(() =>
      assertOwnerElectronLaunch({ executablePath: host, args: [policy.platformRoot] }, policy),
    ).toThrow(/owned entry\/profile/);
  });
  it('permits a known development host only with this run’s entry or profile', () => {
    const { root, host, profile, policy } = fixture();
    const entry = path.join(root, 'offline-electron-entry.cjs');
    writeFileSync(entry, '// inert isolated fixture');
    expect(() => assertOwnerElectronLaunch({ args: [entry], env: {} }, policy)).not.toThrow();
    expect(() =>
      assertOwnerElectronLaunch(
        {
          executablePath: host,
          args: [policy.platformRoot],
          env: { COPILOT_TEST_USER_DATA: profile },
        },
        policy,
      ),
    ).not.toThrow();
    expect(() =>
      assertOwnerElectronLaunch({ args: [entry], env: { ELECTRON_RUN_AS_NODE: '1' } }, policy),
    ).toThrow(/Node mode/);
    expect(() =>
      assertOwnerElectronLaunch(
        { args: [entry], env: { COPILOT_TEST_USER_DATA: path.dirname(root) } },
        policy,
      ),
    ).toThrow(/profile must belong/);
    expect(() =>
      assertOwnerElectronLaunch({ args: [root + '-other/entry.cjs'], env: {} }, policy),
    ).toThrow(/owned entry\/profile/);
  });
  it('revalidates inert installed fixture identity, literal profile and bytes before every launch', () => {
    const { root, host, profile, policy } = fixture();
    const app = path.join(root, 'installed/resources/app');
    mkdirSync(app, { recursive: true });
    const binary = path.join(root, 'installed/VoxCueUpdateTest-1234abcd.exe');
    copyFileSync(host, binary);
    writeFileSync(
      path.join(app, 'package.json'),
      JSON.stringify({
        name: 'voxcueupdatetest-1234abcd',
        productName: 'VoxCueUpdateTest-1234abcd',
        version: '0.1.0',
        main: 'main.cjs',
        description: 'Isolated NSIS test fixture',
        private: true,
      }),
    );
    writeFileSync(path.join(app, 'main.cjs'), syntheticElectronEntry(profile));
    writeFileSync(path.join(app, 'index.html'), syntheticElectronHtml);
    expect(() => verifySyntheticElectronPackage(binary, profile, policy)).not.toThrow();
    policy.syntheticPackages.set(binary, profile);
    expect(() =>
      assertOwnerElectronLaunch({ executablePath: binary, args: [], env: {} }, policy),
    ).not.toThrow();
    expect(() =>
      assertOwnerElectronLaunch({ executablePath: binary, args: ['other'], env: {} }, policy),
    ).toThrow(/no entry override/);
    writeFileSync(
      path.join(app, 'main.cjs'),
      syntheticElectronEntry(path.join(root, 'another-profile')),
    );
    expect(() => assertOwnerElectronLaunch({ executablePath: binary, env: {} }, policy)).toThrow(
      /code or runtime identity/,
    );
    writeFileSync(path.join(app, 'main.cjs'), syntheticElectronEntry(profile));
    writeFileSync(path.join(root, 'installed/resources/app.asar'), 'product code');
    expect(() => assertOwnerElectronLaunch({ executablePath: binary, env: {} }, policy)).toThrow(
      /require OS isolation/,
    );
  });
});
