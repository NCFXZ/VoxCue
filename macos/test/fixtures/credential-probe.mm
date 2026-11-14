// Test-only seed operation, compiled into a disposable executable. Production
// Credentials.mm has no seed, custom service/account, or custom Keychain input.
#include "credential-fixture-boundary.h"
#define SecKeychainOpen openFixtureKeychain
#define VOXCUE_CREDENTIAL_FIXTURE 1
#define main credentialMain
#ifndef VOXCUE_FIXTURE_LEGACY_SOURCE
#error An isolated v1 parent identity source copy is required
#endif
#include VOXCUE_FIXTURE_LEGACY_SOURCE
#undef main

int main(int argc, const char **argv) {
  @autoreleasepool {
    if (argc == 3 && strcmp(argv[1], "seed") == 0) {
      if (!trustedParent()) return 77;
      SecKeychainSetUserInteractionAllowed(false);
      SecKeychainRef keychain = NULL;
      OSStatus status = SecKeychainOpen(argv[2], &keychain);
      const char *service = "VoxCue Safe Storage", *account = "VoxCue Key";
      const char *password = "synthetic-safe-storage-password";
      if (status == errSecSuccess)
        status = SecKeychainAddGenericPassword(keychain, (UInt32)strlen(service), service,
          (UInt32)strlen(account), account, (UInt32)strlen(password), password, NULL);
      if (keychain) CFRelease(keychain);
      return status == errSecSuccess ? 0 : 1;
    }
    return credentialMain(argc, argv);
  }
}
#undef SecKeychainOpen
