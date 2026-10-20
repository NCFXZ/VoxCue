import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { mkdir, writeFile, readFile, copyFile, cp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pbkdf2Sync, createCipheriv } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { loadDevelopmentSigning, signLocalCode } from '../../scripts/development-signing.mjs';
import { signMacApp } from '../../scripts/sign-app.mjs';
import { buildCredentials } from '../../scripts/build-credentials.mjs';

const signing = await loadDevelopmentSigning();
const run = (command, args, input, allowFailure = false) => {
  const result = spawnSync(command, args, { input, encoding: 'utf8', timeout: 30000 });
  if (!allowFailure && (result.error || result.status))
    throw (
      result.error ?? Error(`${path.basename(command)} failed (${result.status}): ${result.stderr}`)
    );
  return result;
};
const compile = (source, output) =>
  run('/usr/bin/xcrun', [
    'clang++',
    '-std=c++17',
    '-fobjc-arc',
    '-Wno-deprecated-declarations',
    '-mmacosx-version-min=14.2',
    '-O2',
    '-DVOXCUE_SIGNING_SHA1="' + signing.sha1.toLowerCase() + '"',
    source,
    '-framework',
    'Foundation',
    '-framework',
    'Security',
    '-o',
    output,
  ]);
const canonical = await buildCredentials();
// No Keychain access is possible when launched by an unsigned/unrelated parent.
const unrelated = run(canonical, [], '{}', true);
assert.equal(
  unrelated.status,
  77,
  JSON.stringify({
    signal: unrelated.signal,
    error: unrelated.error?.message,
    stderr: unrelated.stderr,
  }),
);
const keychainsBefore = run('/usr/bin/security', ['list-keychains', '-d', 'user']).stdout;
const helper = path.join(testRoot, 'credential-probe');
compile(path.join(workspace.platformRoot, 'test/fixtures/credential-probe.mm'), helper);
signLocalCode(helper, signing, 'com.voxcue.credentials', { preserveMetadata: false });
const source = path.join(testRoot, 'parent.mm');
await writeFile(
  source,
  `
#import <Foundation/Foundation.h>
#import <Security/Security.h>
int main(int argc, const char **argv) { @autoreleasepool {
 SecKeychainSetUserInteractionAllowed(false);
 SecKeychainRef keychain = NULL;
 NSString *mode = @(argv[1]);
 if ([mode isEqual:@"create"]) {
  const char *password = "synthetic-keychain-password";
  OSStatus s = SecKeychainCreate(argv[2], (UInt32)strlen(password), password, false, NULL, &keychain);
  if (s == noErr) CFRelease(keychain);
  return s == noErr ? 0 : 1;
 }
 if ([mode isEqual:@"legacy-write"] || [mode isEqual:@"legacy-read"] || [mode isEqual:@"delete"]) {
  if (SecKeychainOpen(argv[2], &keychain)) return 2;
  OSStatus s;
  const char *service = "Old upgrade fixture", *account = "fixture", *value = "synthetic";
  if ([mode isEqual:@"legacy-write"])
   s = SecKeychainAddGenericPassword(keychain, (UInt32)strlen(service), service, (UInt32)strlen(account), account, (UInt32)strlen(value), value, NULL);
  else if ([mode isEqual:@"delete"]) s = SecKeychainDelete(keychain);
  else {
   UInt32 length = 0; void *bytes = NULL;
   s = SecKeychainFindGenericPassword(keychain, (UInt32)strlen(service), service, (UInt32)strlen(account), account, &length, &bytes, NULL);
   if (bytes) SecKeychainItemFreeContent(NULL, bytes);
  }
  CFRelease(keychain);
  printf("%d", (int)s); return 0;
 }
 NSTask *task = [NSTask new];
 task.executableURL = [NSURL fileURLWithPath:@(argv[3])];
 task.arguments = [mode isEqual:@"seed"] ? @[@"seed", @(argv[2])] : @[@(argv[2])];
 task.standardInput = NSFileHandle.fileHandleWithStandardInput;
 task.standardOutput = NSFileHandle.fileHandleWithStandardOutput;
 task.standardError = NSFileHandle.fileHandleWithStandardError;
 [task launchAndReturnError:nil]; [task waitUntilExit]; return task.terminationStatus;
} }
`,
);
const parents = [];
const hashes = [];
for (const revision of [1, 2]) {
  const app = path.join(testRoot, `revision-${revision}.app`);
  const executable = path.join(app, 'Contents/MacOS/fixture');
  await mkdir(path.dirname(executable), { recursive: true });
  await mkdir(path.join(app, 'Contents/Resources/native'), { recursive: true });
  await writeFile(
    path.join(app, 'Contents/Info.plist'),
    `<?xml version="1.0"?><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.voxcue.app</string>
<key>CFBundleExecutable</key><string>fixture</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>${revision}</string></dict></plist>`,
  );
  compile(source, executable);
  const embedded = path.join(app, 'Contents/Resources/native/VoxCue.Credentials');
  await copyFile(canonical, embedded);
  await signMacApp(app, { signing });
  assert.deepEqual(await readFile(embedded), await readFile(canonical));
  hashes.push(
    run('/usr/bin/codesign', ['-d', '--verbose=4', app]).stderr.match(/CDHash=(.*)/)?.[1],
  );
  parents.push(executable);
}
assert.notEqual(hashes[0], hashes[1]);
const legacyApp = path.join(testRoot, 'legacy-adhoc.app');
await cp(path.dirname(path.dirname(path.dirname(parents[0]))), legacyApp, { recursive: true });
run('/usr/bin/codesign', ['--force', '--sign', '-', legacyApp]);
const legacyParent = path.join(legacyApp, 'Contents/MacOS/fixture');
const keychain = path.join(testRoot, 'synthetic.keychain-db');
run(parents[0], ['create', keychain]);
try {
  assert.equal(run(legacyParent, ['legacy-write', keychain]).stdout, '0');
  const legacyStatus = Number(run(parents[1], ['legacy-read', keychain]).stdout);
  assert.notEqual(
    legacyStatus,
    0,
    'Fixed signing does not authorize a historical ad-hoc Keychain item',
  );
  run(parents[0], ['seed', keychain, helper]);
  const plaintext = Buffer.from('synthetic 登录凭据，仅用于升级验证');
  const key = pbkdf2Sync('synthetic-safe-storage-password', 'saltysalt', 1003, 16, 'sha1');
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '));
  const legacyCipher = Buffer.concat([
    Buffer.from('v10'),
    cipher.update(plaintext),
    cipher.final(),
  ]);
  const request = (parent, operation, bytes) =>
    JSON.parse(
      run(
        parent,
        ['helper', keychain, helper],
        JSON.stringify({ operation, data: bytes.toString('base64') }),
      ).stdout,
    );
  assert.deepEqual(
    Buffer.from(request(parents[0], 'decrypt', legacyCipher).data, 'base64'),
    plaintext,
  );
  // New app code hash; helper bytes and Keychain caller stay identical. Interaction
  // is disabled throughout, so a password prompt would fail this assertion.
  assert.deepEqual(
    Buffer.from(request(parents[1], 'decrypt', legacyCipher).data, 'base64'),
    plaintext,
  );
  const encrypted = Buffer.from(request(parents[1], 'encrypt', plaintext).data, 'base64');
  assert.deepEqual(encrypted, legacyCipher, 'Existing Electron v10 format and key are preserved');
  assert.deepEqual(
    Buffer.from(request(parents[0], 'decrypt', encrypted).data, 'base64'),
    plaintext,
  );
  const invalid = run(
    parents[1],
    ['helper', keychain, helper],
    JSON.stringify({ operation: 'decrypt', data: 'AAAA' }),
    true,
  );
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.stdout, '');
} finally {
  assert.equal(run(parents[0], ['delete', keychain]).stdout, '0');
}
assert.equal(run('/usr/bin/security', ['list-keychains', '-d', 'user']).stdout, keychainsBefore);
assert.equal(await buildCredentials(), canonical);
console.log(
  JSON.stringify({
    passed: true,
    historicalAdHocItemDeniedWithoutAuthorization: true,
    fixedHelperSurvivesChangedAppHash: true,
    legacyV10Compatible: true,
    unchangedPackagedHelperBytes: true,
    unrelatedParentRejected: true,
    realLoginKeychainAccessed: false,
    userInteractionAllowed: false,
  }),
);
