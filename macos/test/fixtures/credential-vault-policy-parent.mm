#include "credential-fixture-boundary.h"
#ifndef VOXCUE_FIXTURE_BOUND_HELPER
#error A fixed owned helper path is required
#endif
int main(int argc, const char **argv) {
  @autoreleasepool {
    if (argc != 2) { fputs("policy-parent: invalid argument count\n", stderr); return 76; }
    if (![@[@"policy", @"disable-ui"] containsObject:@(argv[1])]) {
      fputs("policy-parent: invalid mode\n", stderr); return 76;
    }
    if (!pinnedFixtureHelper(VOXCUE_FIXTURE_BOUND_HELPER)) {
      fprintf(stderr, "policy-parent: helper guard root=%d file=%d\n", ownedFixtureRoot(),
        ownedFixtureFile(@VOXCUE_FIXTURE_BOUND_HELPER));
      SecStaticCodeRef code = NULL; CFDictionaryRef information = NULL;
      OSStatus created = SecStaticCodeCreateWithPath((__bridge CFURLRef)
        [NSURL fileURLWithPath:@VOXCUE_FIXTURE_BOUND_HELPER], 0, &code);
      OSStatus checked = code ? SecStaticCodeCheckValidity(code, kSecCSStrictValidate, NULL) : created;
      OSStatus copied = code ? SecCodeCopySigningInformation(code, kSecCSSigningInformation, &information) : created;
      fprintf(stderr, "policy-parent: code create=%d check=%d information=%d\n", (int)created,
        (int)checked, (int)copied);
      if (information) CFRelease(information);
      if (code) CFRelease(code);
      return 76;
    }
    NSTask *task = [NSTask new];
    task.executableURL = [NSURL fileURLWithPath:@VOXCUE_FIXTURE_BOUND_HELPER];
    task.arguments = @[@(argv[1])];
    task.environment = @{@"PATH":@"/usr/bin:/bin:/usr/sbin:/sbin"};
    task.standardInput = NSFileHandle.fileHandleWithStandardInput;
    task.standardOutput = NSFileHandle.fileHandleWithStandardOutput;
    task.standardError = NSFileHandle.fileHandleWithStandardError;
    if (![task launchAndReturnError:nil]) return 75;
    [task waitUntilExit];
    return task.terminationStatus;
  }
}
