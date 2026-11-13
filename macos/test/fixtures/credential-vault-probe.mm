// Fixture-only wrapper around a temporary copy of the current vault source whose
// parent identity is a random test identifier. Keychain access is restricted to
// owned temporary keychains; markers count reads/deletes, never contents.
#include "credential-fixture-boundary.h"
#define VOXCUE_CREDENTIAL_FIXTURE 1
#define SecKeychainOpen openFixtureKeychain
// Record attempts to enumerate a candidate alias even when no item exists.
// For a race, vary visibility across the two own-item searches while exercising
// the real duplicate-create response, ownership checks and stored secret reads.
static bool hideFixtureSearch;
static NSUInteger ownSearches;
static OSStatus recordFixtureSearch(CFTypeRef keychains, SecItemClass kind,
    const SecKeychainAttributeList *attributes, SecKeychainSearchRef *search) {
  hideFixtureSearch = false;
  for (UInt32 index = 0; attributes && index < attributes->count; ++index) {
    const auto &field = attributes->attr[index];
    if (field.tag != kSecAccountItemAttr) continue;
    NSString *account = [[NSString alloc] initWithBytes:field.data length:field.length encoding:NSUTF8StringEncoding];
    if ([@[@"VoxCue Key v6", @"VoxCue Key v7", @"VoxCue Key v8", @"VoxCue Key v9", @"VoxCue Key v10"]
          containsObject:account]) fputs("fixture-queried-candidate\n", stderr);
    const char *race = getenv("VOXCUE_FIXTURE_VAULT_RACE");
    if (!race || ![account isEqualToString:@VOXCUE_FIXTURE_VAULT_ACCOUNT]) continue;
    if (!keychains || CFGetTypeID(keychains) != CFArrayGetTypeID() ||
        CFArrayGetCount((CFArrayRef)keychains) != 2) return errSecParam;
    ++ownSearches;
    if (ownSearches == 1) hideFixtureSearch = true;
    if (ownSearches == 2 && !strcmp(race, "other")) {
      keychains = CFArrayGetValueAtIndex((CFArrayRef)keychains, 1);
      fputs("fixture-other-winner\n", stderr);
    }
  }
  return SecKeychainSearchCreateFromAttributes(keychains, kind, attributes, search);
}
static OSStatus nextFixtureItem(SecKeychainSearchRef search, SecKeychainItemRef *item) {
  if (hideFixtureSearch) {
    *item = NULL;
    fputs("fixture-hidden-initial-item\n", stderr);
    return errSecItemNotFound;
  }
  return SecKeychainSearchCopyNext(search, item);
}
#define SecKeychainSearchCreateFromAttributes recordFixtureSearch
#define SecKeychainSearchCopyNext nextFixtureItem
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
#undef SecKeychainSearchCopyNext
#undef SecKeychainSearchCreateFromAttributes
