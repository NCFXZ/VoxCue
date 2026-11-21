import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';

export async function assertLocalizedPermissions(bundle) {
  const source = path.join(testRoot, 'localized-permissions.m');
  const executable = path.join(testRoot, 'localized-permissions');
  const plist = path.join(testRoot, 'localized-permissions.plist');
  await writeFile(
    plist,
    '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleAllowMixedLocalizations</key><true/></dict></plist>',
  );
  await writeFile(
    source,
    `#import <Foundation/Foundation.h>
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSBundle *bundle = [NSBundle bundleWithPath:[NSString stringWithUTF8String:argv[1]]];
    NSMutableDictionary *values = [NSMutableDictionary dictionary];
    for (NSString *key in @[@"NSMicrophoneUsageDescription", @"NSAudioCaptureUsageDescription", @"NSScreenCaptureUsageDescription"])
      values[key] = [bundle objectForInfoDictionaryKey:key] ?: @"";
    NSData *json = [NSJSONSerialization dataWithJSONObject:values options:0 error:nil];
    fwrite(json.bytes, 1, json.length, stdout);
  }
}
`,
  );
  execFileSync('/usr/bin/xcrun', [
    'clang',
    '-fobjc-arc',
    '-Wl,-sectcreate,__TEXT,__info_plist,' + plist,
    source,
    '-framework',
    'Foundation',
    '-o',
    executable,
  ]);
  const original = JSON.parse(
    execFileSync(
      '/usr/bin/plutil',
      ['-convert', 'json', '-o', '-', path.join(bundle, 'Contents/Info.plist')],
      { encoding: 'utf8' },
    ),
  );
  for (const language of ['en-GB', 'zh-Hans', 'zh-CN', 'zh-Hant', 'fr']) {
    const localized = JSON.parse(
      execFileSync(executable, [bundle, '-AppleLanguages', '(' + language + ')'], {
        encoding: 'utf8',
      }),
    );
    for (const [key, value] of Object.entries(localized)) {
      if (language === 'zh-Hans' || language === 'zh-CN') {
        assert.equal(value, original[key]);
        if (key !== 'NSScreenCaptureUsageDescription') assert.match(value, /启用面试录音.*本机.*不上传/);
      } else {
        assert.ok(
          value.length > 40 && !/\p{Script=Han}/u.test(value),
          `${language}: ${key} must use English`,
        );
        assert.match(
          value,
          key === 'NSScreenCaptureUsageDescription'
            ? /only.*Screenshot.*only.*Send/
            : /locally.*saved on this Mac only when interview recording is enabled.*never uploaded/,
        );
      }
    }
  }
  console.log(
    'PASS: Foundation selects English permission descriptions and preserves the original Simplified Chinese text without requesting access.',
  );
}
