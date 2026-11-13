#include "credential-fixture-boundary.h"
static volatile int revision = VOXCUE_REVISION;
int main(int argc, const char **argv) {
  @autoreleasepool {
#ifdef VOXCUE_FIXTURE_BOUND_HELPER
    if (argc != 1) return 76;
    const char *bound[] = {argv[0], VOXCUE_FIXTURE_BOUND_HELPER, VOXCUE_FIXTURE_BOUND_KEYCHAIN};
    argc = 3; argv = bound;
#endif
    if ((argc != 3 && argc != 4) || revision < 1 || !pinnedFixtureHelper(argv[1]) ||
        !ownedFixtureKeychain(argv[2]) || (argc == 4 && !ownedFixtureKeychain(argv[3]))) return 76;
    NSTask *task = [NSTask new];
    task.executableURL = [NSURL fileURLWithPath:@(argv[1])];
    task.arguments = argc == 4 ? @[@(argv[2]), @(argv[3])] : @[@(argv[2])];
    NSMutableDictionary *environment = [@{@"PATH":@"/usr/bin:/bin:/usr/sbin:/sbin"} mutableCopy];
    const char *failure = getenv("VOXCUE_CREDENTIAL_FAIL_ACL_AT");
    if (failure) {
      if (strlen(failure) != 1 || failure[0] < '0' || failure[0] > '2') return 76;
      environment[@"VOXCUE_CREDENTIAL_FAIL_ACL_AT"] = @(failure);
    }
    const char *deletion = getenv("VOXCUE_CREDENTIAL_FAIL_DELETE_AT");
    if (deletion) {
      if (strlen(deletion) != 1 || deletion[0] < '0' || deletion[0] > '2') return 76;
      environment[@"VOXCUE_CREDENTIAL_FAIL_DELETE_AT"] = @(deletion);
    }
    task.environment = environment;
    task.standardInput = NSFileHandle.fileHandleWithStandardInput;
    task.standardOutput = NSFileHandle.fileHandleWithStandardOutput;
    task.standardError = NSFileHandle.fileHandleWithStandardError;
    if (![task launchAndReturnError:nil]) return 75;
    [task waitUntilExit];
    return task.terminationStatus;
  }
}
