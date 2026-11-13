// No production code changes: the fixture's explicit Keychain argument is also
// constrained inside the helper, independently of the parent launcher.
#include "credential-fixture-boundary.h"
#define VOXCUE_CREDENTIAL_FIXTURE 1
#define SecKeychainOpen openFixtureKeychain
static OSStatus recordFixtureAccessWrite(SecKeychainItemRef item, SecAccessRef access) {
  // Count actual Security.framework writes, never credential contents. A read
  // after completed authorization must not request another ACL replacement.
  fputs("fixture-acl-write\n", stderr);
  return SecKeychainItemSetAccess(item, access);
}
#define SecKeychainItemSetAccess recordFixtureAccessWrite
#ifndef VOXCUE_FIXTURE_HARDENED_SOURCE
#error An isolated parent identity source copy is required
#endif
#ifdef VOXCUE_FIXTURE_CLEANUP
static OSStatus recordFixtureItemDelete(SecKeychainItemRef item) {
  fputs("fixture-item-delete\n", stderr);
  return SecKeychainItemDelete(item);
}
#define SecKeychainItemDelete recordFixtureItemDelete
#define VOXCUE_CREDENTIAL_FROZEN_SOURCE VOXCUE_FIXTURE_HARDENED_SOURCE
#include VOXCUE_FIXTURE_MIGRATING_SOURCE
#undef SecKeychainItemDelete
#else
#include VOXCUE_FIXTURE_HARDENED_SOURCE
#endif
#undef SecKeychainItemSetAccess
#undef SecKeychainOpen
