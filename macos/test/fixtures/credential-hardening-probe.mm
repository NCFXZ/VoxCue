// No production code changes: the fixture's explicit Keychain argument is also
// constrained inside the helper, independently of the parent launcher.
#include "credential-fixture-boundary.h"
#define VOXCUE_CREDENTIAL_FIXTURE 1
#define SecKeychainOpen openFixtureKeychain
#ifdef VOXCUE_FIXTURE_CHECKED_INTERACTION
static Boolean initialFixtureInteraction;
static void failFixtureInteraction() {
  const OSStatus restore = SecKeychainSetUserInteractionAllowed(initialFixtureInteraction);
  Boolean actual = !initialFixtureInteraction;
  const OSStatus read = SecKeychainGetUserInteractionAllowed(&actual);
  fprintf(stderr, "fixture-interaction-setup-failed restore=%d read=%d restored=%d\n",
    (int)restore, (int)read, actual == initialFixtureInteraction);
  exit(82);
}
static OSStatus checkedFixtureInteraction(Boolean allowed) {
  const OSStatus status = SecKeychainSetUserInteractionAllowed(allowed);
  Boolean actual = !allowed;
  const OSStatus read = SecKeychainGetUserInteractionAllowed(&actual);
  fprintf(stderr, "fixture-interaction requested=%d set=%d read=%d actual=%d\n",
    allowed, (int)status, (int)read, actual);
  if (status || read || actual != allowed) failFixtureInteraction();
  return status;
}
#define SecKeychainSetUserInteractionAllowed checkedFixtureInteraction
static OSStatus recordFixtureAccessRead(SecKeychainItemRef item, SecAccessRef *access) {
  fputs("fixture-acl-read\n", stderr);
  const OSStatus status = SecKeychainItemCopyAccess(item, access);
  fprintf(stderr, "fixture-acl-read-done (%d)\n", (int)status);
  return status;
}
#define SecKeychainItemCopyAccess recordFixtureAccessRead
static OSStatus recordFixtureContentRead(SecKeychainItemRef item, SecItemClass *kind,
    SecKeychainAttributeList *attributes, UInt32 *length, void **data) {
  fputs("fixture-content-read\n", stderr);
  const OSStatus status = SecKeychainItemCopyContent(item, kind, attributes, length, data);
  fprintf(stderr, "fixture-content-read-done (%d)\n", (int)status);
  return status;
}
#define SecKeychainItemCopyContent recordFixtureContentRead
#endif
static OSStatus recordFixtureAccessWrite(SecKeychainItemRef item, SecAccessRef access) {
  // Count actual Security.framework writes, never credential contents. A read
  // after completed authorization must not request another ACL replacement.
  fputs("fixture-acl-write\n", stderr);
  const OSStatus status = SecKeychainItemSetAccess(item, access);
#ifdef VOXCUE_FIXTURE_CHECKED_INTERACTION
  fprintf(stderr, "fixture-acl-commit-result (%d)\n", (int)status);
#endif
  return status;
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
#ifdef VOXCUE_FIXTURE_CHECKED_INTERACTION
#undef SecKeychainItemCopyAccess
#undef SecKeychainItemCopyContent
#undef SecKeychainSetUserInteractionAllowed
#endif
#undef SecKeychainOpen
#ifdef VOXCUE_FIXTURE_CHECKED_INTERACTION
int main(int argc, const char **argv) {
  if (SecKeychainGetUserInteractionAllowed(&initialFixtureInteraction)) return 82;
  const int result = archivedFixtureMain(argc, argv);
  const OSStatus status = SecKeychainSetUserInteractionAllowed(initialFixtureInteraction);
  Boolean actual = !initialFixtureInteraction;
  if (status || SecKeychainGetUserInteractionAllowed(&actual) ||
      actual != initialFixtureInteraction) failFixtureInteraction();
  return result;
}
#endif
