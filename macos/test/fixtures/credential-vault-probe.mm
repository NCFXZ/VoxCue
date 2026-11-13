// Fixture-only wrapper around a temporary copy of the canonical v6 source whose
// parent identity is a random test identifier. Keychain access is restricted to
// owned temporary keychains; markers count reads/deletes, never contents.
#include "credential-fixture-boundary.h"
#define VOXCUE_CREDENTIAL_FIXTURE 1
#define SecKeychainOpen openFixtureKeychain
static OSStatus recordFixtureRead(SecKeychainItemRef item, SecItemClass *kind,
    SecKeychainAttributeList *attributes, UInt32 *length, void **data) {
  fputs("fixture-item-read\n", stderr);
  return SecKeychainItemCopyContent(item, kind, attributes, length, data);
}
static OSStatus recordFixtureDelete(SecKeychainItemRef item) {
  static int attempt = 0;
  fputs("fixture-item-delete\n", stderr);
  const char *failure = getenv("VOXCUE_CREDENTIAL_FAIL_DELETE_AT");
  // Simulate a deletion that would need interaction; nothing is removed.
  if (failure && atoi(failure) == attempt++) return errSecInteractionNotAllowed;
  return SecKeychainItemDelete(item);
}
#define SecKeychainItemCopyContent recordFixtureRead
#define SecKeychainItemDelete recordFixtureDelete
#ifndef VOXCUE_FIXTURE_VAULT_SOURCE
#error An isolated parent identity source copy is required
#endif
#include VOXCUE_FIXTURE_VAULT_SOURCE
#undef SecKeychainItemDelete
#undef SecKeychainItemCopyContent
#undef SecKeychainOpen
