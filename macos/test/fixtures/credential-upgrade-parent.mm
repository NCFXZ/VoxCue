#include "credential-fixture-boundary.h"
int main(int argc, const char **argv) {
  @autoreleasepool {
    if (argc < 3) return 76;
    NSString *mode = @(argv[1]);
    const bool create = [mode isEqual:@"create"], seed = [mode isEqual:@"seed"],
      helper = [mode isEqual:@"helper"], write = [mode isEqual:@"legacy-write"],
      read = [mode isEqual:@"legacy-read"], remove = [mode isEqual:@"delete"];
    if (!(create || seed || helper || write || read || remove) ||
        argc != ((seed || helper) ? 4 : 3) || !ownedFixtureKeychain(argv[2], create) ||
        ((seed || helper) && !pinnedFixtureHelper(argv[3]))) return 76;
    SecKeychainSetUserInteractionAllowed(false);
    SecKeychainRef keychain = NULL;
    if (create) {
      const char *password = "synthetic-keychain-password";
      OSStatus status = SecKeychainCreate(argv[2], (UInt32)strlen(password), password, false, NULL, &keychain);
      if (keychain) CFRelease(keychain);
      return status ? 1 : 0;
    }
    if (write || read || remove) {
      if (SecKeychainOpen(argv[2], &keychain)) return 2;
      OSStatus status;
      const char *service = "Old upgrade fixture", *account = "fixture", *value = "synthetic";
      if (write) status = SecKeychainAddGenericPassword(keychain, (UInt32)strlen(service), service,
        (UInt32)strlen(account), account, (UInt32)strlen(value), value, NULL);
      else if (remove) status = SecKeychainDelete(keychain);
      else {
        UInt32 length = 0; void *bytes = NULL;
        status = SecKeychainFindGenericPassword(keychain, (UInt32)strlen(service), service,
          (UInt32)strlen(account), account, &length, &bytes, NULL);
        if (bytes) { memset(bytes, 0, length); SecKeychainItemFreeContent(NULL, bytes); }
      }
      CFRelease(keychain); printf("%d", (int)status); return 0;
    }
    NSTask *task = [NSTask new];
    task.executableURL = [NSURL fileURLWithPath:@(argv[3])];
    task.arguments = seed ? @[@"seed", @(argv[2])] : @[@(argv[2])];
    task.environment = @{@"PATH":@"/usr/bin:/bin:/usr/sbin:/sbin"};
    task.standardInput = NSFileHandle.fileHandleWithStandardInput;
    task.standardOutput = NSFileHandle.fileHandleWithStandardOutput;
    task.standardError = NSFileHandle.fileHandleWithStandardError;
    if (![task launchAndReturnError:nil]) return 75;
    [task waitUntilExit]; return task.terminationStatus;
  }
}
