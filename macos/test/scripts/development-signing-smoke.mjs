import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  developmentRequirement,
  loadDevelopmentSigning,
  verifyLocalApp,
} from '../../scripts/development-signing.mjs';
import { signMacApp } from '../../scripts/sign-app.mjs';

const signing = await loadDevelopmentSigning();
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status) throw result.error ?? Error(result.stderr);
  return result.stdout + result.stderr;
}
const source = path.join(testRoot, 'main.c');
const entitlements = path.join(testRoot, 'entitlements.plist');
await writeFile(source, 'int main(void) { return 0; }\n');
await writeFile(
  entitlements,
  `<?xml version="1.0"?><plist version="1.0"><dict>
<key>com.apple.security.cs.allow-jit</key><true/>
</dict></plist>`,
);
for (const [kind, identifier] of [
  ['development', 'com.voxcue.development'],
  ['release', 'com.voxcue.app'],
]) {
  const requirements = [];
  const hashes = [];
  for (const revision of [1, 2]) {
    const app = path.join(testRoot, `${kind}-${revision}.app`);
    await mkdir(path.join(app, 'Contents/MacOS'), { recursive: true });
    await mkdir(path.join(app, 'Contents/Resources'));
    await writeFile(
      path.join(app, 'Contents/Info.plist'),
      `<?xml version="1.0"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${identifier}</string>
<key>CFBundleExecutable</key><string>fixture</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`,
    );
    await writeFile(path.join(app, 'Contents/Resources/revision'), String(revision));
    run('/usr/bin/xcrun', ['clang', source, '-o', path.join(app, 'Contents/MacOS/fixture')]);
    run('/usr/bin/codesign', ['--force', '--sign', '-', '--entitlements', entitlements, app]);
    const helper = path.join(app, 'Contents/Frameworks/Helper.app');
    await mkdir(path.join(helper, 'Contents/MacOS'), { recursive: true });
    await writeFile(
      path.join(helper, 'Contents/Info.plist'),
      `<?xml version="1.0"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${identifier}.helper</string>
<key>CFBundleExecutable</key><string>fixture</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`,
    );
    run('/usr/bin/xcrun', ['clang', source, '-o', path.join(helper, 'Contents/MacOS/fixture')]);
    await signMacApp(app, { signing, identifier, preserveMetadata: kind === 'development' });
    verifyLocalApp(app, signing, identifier);
    // Embedded helpers keep their own identifiers and use the same certificate.
    const helperRequirement = run('/usr/bin/codesign', ['-d', '-r-', helper]);
    assert.ok(helperRequirement.includes(identifier + '.helper'));
    assert.ok(helperRequirement.includes(signing.sha1.toLowerCase()));
    run(path.join(app, 'Contents/MacOS/fixture'), []);
    const requirement = run('/usr/bin/codesign', ['-d', '-r-', app]).match(/designated => .*/)?.[0];
    assert.equal(requirement, developmentRequirement(signing, identifier));
    requirements.push(requirement);
    hashes.push(run('/usr/bin/codesign', ['-d', '--verbose=4', app]).match(/^CDHash=(.*)$/m)?.[1]);
    if (kind === 'development')
      assert.match(
        run('/usr/bin/codesign', ['-d', '--entitlements', ':-', app]),
        /<key>com.apple.security.cs.allow-jit<\/key>\s*<true\/>/,
      );
  }
  assert.equal(requirements[0], requirements[1]);
  assert.ok(hashes[0] && hashes[1]);
  assert.notEqual(hashes[0], hashes[1], 'The fixtures must represent genuinely different builds');
  const second = path.join(testRoot, `${kind}-2.app`);
  // Replacing the certificate with an ad-hoc signature must fail the pinned rule.
  run('/usr/bin/codesign', ['--force', '--sign', '-', second]);
  assert.notEqual(
    spawnSync('/usr/bin/codesign', [
      '--verify',
      '-R',
      '=' + requirements[0].replace('designated => ', ''),
      second,
    ]).status,
    0,
  );
}
assert.deepEqual(await loadDevelopmentSigning(), signing, 'Rebuilds reuse the existing identity');
console.log(
  JSON.stringify({
    status: 'passed',
    developmentAndRelease: true,
    differentBuildsShareRequirement: true,
    entitlementsPreserved: true,
    changedIdentityRejected: true,
    realLoginDataAccessed: false,
    certificateSHA256: signing.sha256,
  }),
);

if (process.argv.includes('--packaged')) {
  const { buildMacApp } = await import('../../scripts/package-app.mjs');
  const { readFile, lstat } = await import('node:fs/promises');
  const workspace = (await import('../../../shared/scripts/workspace.mjs')).default;
  const { publicKey } = JSON.parse(
    await readFile(path.join(workspace.platformRoot, 'update-public-key.json'), 'utf8'),
  );
  const app = await buildMacApp(path.join(testRoot, 'packaged'), publicKey);
  verifyLocalApp(app, signing, 'com.voxcue.app');
  const asar = await import(workspace.platformRequire.resolve('@electron/asar'));
  const files = asar.listPackage(path.join(app, 'Contents/Resources/app.asar'));
  assert.ok(
    !files.some((file) =>
      /development-signing|keychain-password|local-signing-public|\.keychain-db/.test(file),
    ),
  );
  assert.equal(
    await lstat(path.join(app, 'Contents/Resources/development-signing')).catch(() => null),
    null,
  );
  console.log(
    JSON.stringify({
      status: 'passed',
      actualReleaseBundleSignedWithPinnedIdentity: true,
      signingSecretsExcluded: true,
      installerCreated: false,
      publishedAssetsChanged: false,
    }),
  );
}
