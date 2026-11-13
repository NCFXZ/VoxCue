// Fixed v9 credential helper. Frozen v1 v10 crypto and v2 code identity checks
// are reused unchanged; v1-v8 bytes stay archived. A first upgrade reads exactly
// one historical copy (one system authorization), copies the same key into this
// helper's own entry and never rewrites historical access. Superseded copies are
// removed later only by the non-interactive cleanup request.
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <Security/cssmapple.h>
#import <CommonCrypto/CommonCryptor.h>
#import <CommonCrypto/CommonKeyDerivation.h>
#include <unistd.h>
#include <limits.h>

static NSMutableData *vaultKeyBytes;
static OSStatus vaultPassword(CFTypeRef, UInt32, const char *, UInt32, const char *, UInt32 *, void **,
  SecKeychainItemRef *);
static OSStatus refuseArchivedCreation(SecItemClass, SecKeychainAttributeList *, UInt32, const void *,
  SecKeychainRef, SecAccessRef, SecKeychainItemRef *);
static OSStatus releaseVaultCopy(SecKeychainAttributeList *, void *);
// The archived v10 routine asks for its old fixed alias. Answer only with the key
// this helper already verified; it can neither query nor create another item.
#define SecKeychainFindGenericPassword vaultPassword
#define SecKeychainItemFreeContent releaseVaultCopy
#define SecKeychainItemCreateFromContent refuseArchivedCreation
namespace archived {
#include "CredentialsHardened.mm"
}
#undef SecKeychainItemCreateFromContent
#undef SecKeychainItemFreeContent
#undef SecKeychainFindGenericPassword

static const char *const vaultService = "VoxCue Credential Storage";
static const char *const vaultAccount = "VoxCue Key v9";
static const char *const vaultName = "VoxCue 登录信息";
// A prior vault generation takes priority; original aliases retain v1 ordering.
static const char *const sourceServices[] = {"VoxCue Credential Storage", "VoxCue Credential Storage",
  "VoxCue Credential Storage", "VoxCue Credential Storage", "VoxCue Safe Storage", "VoxCue Safe Storage"};
static const char *const sourceAccounts[] = {"VoxCue Key v8", "VoxCue Key v7", "VoxCue Key v6", "VoxCue Key", "VoxCue Key", "VoxCue"};
// Public maintenance diagnostics contain fixed alias IDs only, never secrets or paths.
static NSString *const sourceIDs[] = {@"v8", @"v7", @"v6", @"storage-key", @"safe-key", @"safe-default"};
static constexpr size_t sourceCount = sizeof(sourceAccounts) / sizeof(sourceAccounts[0]);
static NSString *ownPartition;
static NSData *ownApplicationIdentity;

static OSStatus vaultPassword(CFTypeRef, UInt32 serviceLength, const char *service, UInt32 accountLength,
    const char *account, UInt32 *length, void **data, SecKeychainItemRef *item) {
  if (item) *item = NULL;
  // Never report "not found": the archived routine would then try older aliases
  // or generate a key. Any request other than the verified key fails closed.
  const char *legacyService = "VoxCue Credential Storage", *legacyAccount = "VoxCue Key";
  if (!vaultKeyBytes.length || !length || !data || serviceLength != strlen(legacyService) ||
      accountLength != strlen(legacyAccount) || memcmp(service, legacyService, serviceLength) ||
      memcmp(account, legacyAccount, accountLength)) return errSecInternalComponent;
  void *copy = malloc(vaultKeyBytes.length);
  if (!copy) return errSecAllocate;
  memcpy(copy, vaultKeyBytes.bytes, vaultKeyBytes.length);
  *length = (UInt32)vaultKeyBytes.length;
  *data = copy;
  return errSecSuccess;
}
static OSStatus releaseVaultCopy(SecKeychainAttributeList *, void *data) {
  free(data);
  return errSecSuccess;
}
static OSStatus refuseArchivedCreation(SecItemClass, SecKeychainAttributeList *, UInt32, const void *,
    SecKeychainRef, SecAccessRef, SecKeychainItemRef *) {
  return errSecParam;
}

static NSDictionary *authenticatedVaultSelf() {
  const pid_t parent = getppid();
  SecCodeRef code = NULL;
  OSStatus status = SecCodeCopyGuestWithAttributes(NULL,
    (__bridge CFDictionaryRef)@{(__bridge id)kSecGuestAttributePid:@(parent)}, kSecCSDefaultFlags, &code);
  bool accepted = !status && archived::hardenedIdentity(code, @"com.voxcue.app");
  if (code) CFRelease(code);
  if (!accepted || parent != getppid()) return nil;
  code = NULL;
  status = SecCodeCopySelf(kSecCSDefaultFlags, &code);
  accepted = !status && archived::hardenedIdentity(code, @"com.voxcue.credentials.vault");
  NSDictionary *information = accepted ? archived::signingInfo(code) : nil;
  NSDictionary *entitlements = information[(__bridge id)kSecCodeInfoEntitlementsDict];
  if (code) CFRelease(code);
  return accepted && !entitlements.count ? information : nil;
}

static OSStatus matching(CFTypeRef keychains, const char *service, const char *account, NSMutableArray *items) {
  SecKeychainAttribute attributes[] = {
    {kSecServiceItemAttr, (UInt32)strlen(service), (void *)service},
    {kSecAccountItemAttr, (UInt32)strlen(account), (void *)account}
  };
  SecKeychainAttributeList list{2, attributes};
  SecKeychainSearchRef search = NULL;
  OSStatus status = SecKeychainSearchCreateFromAttributes(keychains, kSecGenericPasswordItemClass, &list, &search);
  if (status) return status;
  id owned = CFBridgingRelease(search);
  for (;;) {
    SecKeychainItemRef item = NULL;
    status = SecKeychainSearchCopyNext((__bridge SecKeychainSearchRef)owned, &item);
    if (status == errSecItemNotFound) return errSecSuccess;
    if (status) return status;
    [items addObject:CFBridgingRelease(item)];
    if (items.count > 32) return errSecDataTooLarge;
  }
}

static OSStatus exactAlias(id item, const char *service, const char *account) {
  UInt32 tags[] = {kSecServiceItemAttr, kSecAccountItemAttr};
  UInt32 formats[] = {CSSM_DB_ATTRIBUTE_FORMAT_STRING, CSSM_DB_ATTRIBUTE_FORMAT_STRING};
  SecKeychainAttributeInfo info{2, tags, formats};
  SecKeychainAttributeList *attributes = NULL;
  SecItemClass kind = (SecItemClass)0;
  OSStatus status = SecKeychainItemCopyAttributesAndData((__bridge SecKeychainItemRef)item, &info, &kind,
    &attributes, NULL, NULL);
  if (status) return status;
  bool serviceMatches = false, accountMatches = false;
  for (UInt32 index = 0; attributes && index < attributes->count; ++index) {
    SecKeychainAttribute value = attributes->attr[index];
    const char *expected = value.tag == kSecServiceItemAttr ? service : account;
    const bool equal = value.length == strlen(expected) && !memcmp(value.data, expected, value.length);
    if (value.tag == kSecServiceItemAttr) serviceMatches = equal;
    if (value.tag == kSecAccountItemAttr) accountMatches = equal;
  }
  if (attributes) SecKeychainItemFreeAttributesAndData(attributes, NULL);
  return kind == kSecGenericPasswordItemClass && serviceMatches && accountMatches ? errSecSuccess
    : errSecInvalidItemRef;
}

static OSStatus readKey(id item, NSMutableData *__strong *key) {
  UInt32 length = 0; void *bytes = NULL;
  OSStatus status = SecKeychainItemCopyContent((__bridge SecKeychainItemRef)item, NULL, NULL, &length, &bytes);
  if (status) return status;
  if (!length || length > 4096 || !bytes) {
    if (bytes) { archived::wipe(bytes, length); SecKeychainItemFreeContent(NULL, bytes); }
    return errSecDecode;
  }
  NSMutableData *value = [NSMutableData dataWithBytes:bytes length:length];
  if (bytes) { archived::wipe(bytes, length); SecKeychainItemFreeContent(NULL, bytes); }
  *key = value;
  return errSecSuccess;
}

static NSArray *partitionIDs(NSString *description) {
  if (!description.length || description.length > 32768 || description.length % 2 ||
      [description rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:
        @"0123456789abcdefABCDEF"] invertedSet]].location != NSNotFound) return nil;
  NSMutableData *bytes = [NSMutableData dataWithLength:description.length / 2];
  for (NSUInteger index = 0; index < description.length; index += 2) {
    unsigned value = 0;
    NSScanner *scanner = [NSScanner scannerWithString:[description substringWithRange:NSMakeRange(index, 2)]];
    if (![scanner scanHexInt:&value] || !scanner.atEnd) return nil;
    ((uint8_t *)bytes.mutableBytes)[index / 2] = (uint8_t)value;
  }
  id object = [NSPropertyListSerialization propertyListWithData:bytes options:0 format:NULL error:nil];
  NSArray *ids = [object isKindOfClass:NSDictionary.class] ? object[@"Partitions"] : nil;
  if (![object isKindOfClass:NSDictionary.class] || [object count] != 1 ||
      ![ids isKindOfClass:NSArray.class] || !ids.count || ids.count > 64) return nil;
  for (id value in ids)
    if (![value isKindOfClass:NSString.class] || ![value length] || [value length] > 256) return nil;
  return ids;
}

static void identityWord(NSMutableData *data, uint32 value) {
  value = CFSwapInt32HostToBig(value);
  [data appendBytes:&value length:sizeof(value)];
}

// A trusted application's CopyData is only its historical path, not its signing
// identity. Obtain the public CSSM subject through a temporary, in-memory access
// object. Compare every identity field; only the documented path comment is
// excluded so unchanged signed code can move without weakening its requirement.
static OSStatus findApplicationIdentity(const CSSM_LIST &list, NSUInteger depth,
    NSUInteger *remaining, NSMutableData *__strong *identity) {
  // Security.framework's public snapshot uses UNKNOWN (0) for these typed
  // lists; the head word and bounded element structure supply the actual type.
  if (depth > 8 || (list.ListType != CSSM_LIST_TYPE_UNKNOWN && list.ListType != CSSM_LIST_TYPE_SEXPR) ||
      !list.Head || !list.Tail)
    return errSecInvalidItemRef;
  const bool signature = list.Head->ElementType == CSSM_LIST_ELEMENT_WORDID &&
    list.Head->WordID == CSSM_ACL_SUBJECT_TYPE_CODE_SIGNATURE;
  if (signature && *identity) return errSecInvalidItemRef;
  NSMutableData *value = signature ? [NSMutableData data] : nil;
  NSUInteger index = 0;
  CSSM_LIST_ELEMENT_PTR last = NULL;
  for (auto element = list.Head; element; element = element->NextElement, ++index) {
    if (!*remaining) return errSecDataTooLarge;
    --*remaining;
    last = element;
    if (signature) {
      if (index < 2) {
        const uint32 expected = index ? CSSM_ACL_CODE_SIGNATURE_OSX : CSSM_ACL_SUBJECT_TYPE_CODE_SIGNATURE;
        if (element->ElementType != CSSM_LIST_ELEMENT_WORDID || element->WordID != expected)
          return errSecInvalidItemRef;
        identityWord(value, element->WordID);
      } else {
        const auto &bytes = element->Element.Word;
        if (element->ElementType != CSSM_LIST_ELEMENT_DATUM || !bytes.Data || !bytes.Length ||
            bytes.Length > 65536 || (index == 2 && bytes.Length != 20)) return errSecInvalidItemRef;
        if (index == 3) {
          if (bytes.Length > PATH_MAX + 1 || bytes.Data[bytes.Length - 1] ||
              memchr(bytes.Data, 0, bytes.Length) != bytes.Data + bytes.Length - 1)
            return errSecInvalidItemRef;
        } else {
          identityWord(value, bytes.Length);
          [value appendBytes:bytes.Data length:bytes.Length];
        }
      }
    } else if (element->ElementType == CSSM_LIST_ELEMENT_SUBLIST) {
      OSStatus status = findApplicationIdentity(element->Element.Sublist, depth + 1, remaining, identity);
      if (status) return status;
    } else if (element->ElementType == CSSM_LIST_ELEMENT_DATUM) {
      if (!element->Element.Word.Data || element->Element.Word.Length > 65536) return errSecInvalidItemRef;
    } else if (element->ElementType != CSSM_LIST_ELEMENT_WORDID) return errSecInvalidItemRef;
  }
  if (last != list.Tail) return errSecInvalidItemRef;
  if (signature) {
    // Signed current-generation entries must include an actual requirement blob.
    if (index < 5) return errSecInvalidItemRef;
    *identity = value;
  }
  return errSecSuccess;
}

static OSStatus applicationIdentity(SecTrustedApplicationRef application, NSData *__strong *identity) {
  SecAccessRef raw = NULL;
  OSStatus status = SecAccessCreate(CFSTR("VoxCue 登录信息"),
    (__bridge CFArrayRef)@[(__bridge id)application], &raw);
  if (status) return status;
  id access = CFBridgingRelease(raw);
  CSSM_ACL_OWNER_PROTOTYPE_PTR owner = NULL;
  CSSM_ACL_ENTRY_INFO_PTR entries = NULL;
  uint32 count = 0;
  status = SecAccessGetOwnerAndACL((__bridge SecAccessRef)access, &owner, &count, &entries);
  if (status || !owner || !entries || !count || count > 16) return status ?: errSecInvalidItemRef;
  NSUInteger remaining = 256;
  NSMutableData *found = nil;
  for (uint32 index = 0; index < count && !status; ++index)
    status = findApplicationIdentity(entries[index].EntryPublicInfo.TypedSubject, 0, &remaining, &found);
  if (status || !found.length) return status ?: errSecInvalidItemRef;
  *identity = found;
  return errSecSuccess;
}

static OSStatus verifyApplicationRule(SecACLRef rule) {
  CFArrayRef apps = NULL; CFStringRef description = NULL;
  SecKeychainPromptSelector prompt = (SecKeychainPromptSelector)0;
  OSStatus status = SecACLCopyContents(rule, &apps, &description, &prompt);
  NSArray *applications = apps ? CFBridgingRelease(apps) : nil;
  NSString *text = description ? CFBridgingRelease(description) : nil;
  if (status || applications.count != 1 || prompt || ![text isEqualToString:@"VoxCue 登录信息"])
    return status ?: errSecInvalidItemRef;
  NSData *identity = nil;
  status = applicationIdentity((__bridge SecTrustedApplicationRef)applications[0], &identity);
  return !status && [identity isEqualToData:ownApplicationIdentity] ? errSecSuccess : status ?: errSecInvalidItemRef;
}

// Only the current generation's exact policy is accepted. Historical generations
// are migration sources, never a reason to accept extra trust in the current item.
static OSStatus verifyVault(id item) {
  OSStatus status = exactAlias(item, vaultService, vaultAccount);
  SecAccessRef raw = NULL;
  if (!status) status = SecKeychainItemCopyAccess((__bridge SecKeychainItemRef)item, &raw);
  if (status) return status;
  id access = CFBridgingRelease(raw);
  CSSM_ACL_OWNER_PROTOTYPE_PTR owner = NULL;
  CSSM_ACL_ENTRY_INFO_PTR entries = NULL;
  uint32 count = 0;
  // The deprecated snapshot allocations are bounded to this one-request process.
  status = SecAccessGetOwnerAndACL((__bridge SecAccessRef)access, &owner, &count, &entries);
  if (status || !owner || owner->Delegate || !entries || count > 64) return status ?: errSecInvalidItemRef;
  CFArrayRef owners = SecAccessCopyMatchingACLList((__bridge SecAccessRef)access, kSecACLAuthorizationChangeACL);
  NSArray *ownerRules = owners ? CFBridgingRelease(owners) : nil;
  if (ownerRules.count != 1) return errSecInvalidItemRef;
  status = verifyApplicationRule((__bridge SecACLRef)ownerRules[0]);
  if (status) return status;
  NSUInteger partitions = 0;
  for (uint32 index = 0; index < count; ++index) {
    auto &entry = entries[index].EntryPublicInfo;
    if (entry.Delegate) return errSecInvalidItemRef;
    bool partition = false;
    for (uint32 tag = 0; tag < entry.Authorization.NumberOfAuthTags; ++tag)
      partition |= entry.Authorization.AuthTags[tag] == CSSM_ACL_AUTHORIZATION_PARTITION_ID;
    if (!partition) continue;
    auto head = entry.TypedSubject.Head;
    if (entry.Authorization.NumberOfAuthTags != 1 || entry.Delegate || !head || head->ElementType != CSSM_LIST_ELEMENT_WORDID ||
        head->WordID != CSSM_ACL_SUBJECT_TYPE_PARTITION ||
        strncmp(entry.EntryTag, CSSM_APPLE_ACL_TAG_PARTITION_ID, sizeof(entry.EntryTag))) return errSecInvalidItemRef;
    ++partitions;
  }
  if (partitions > 1) return errSecInvalidItemRef;
  CFArrayRef list = NULL;
  status = SecAccessCopyACLList((__bridge SecAccessRef)access, &list);
  if (status) return status;
  NSArray *rules = CFBridgingRelease(list);
  NSUInteger seenPartitions = 0;
  bool admitted = false;
  for (id value in rules) {
    SecACLRef rule = (__bridge SecACLRef)value;
    NSArray *tags = CFBridgingRelease(SecACLCopyAuthorizations(rule));
    if (!tags.count) return errSecInvalidItemRef;
    if ([tags containsObject:(__bridge id)kSecACLAuthorizationIntegrity]) {
      if (tags.count != 1) return errSecInvalidItemRef;
      continue;
    }
    if ([tags containsObject:(__bridge id)kSecACLAuthorizationPartitionID]) {
      if (tags.count != 1) return errSecInvalidItemRef;
      CFArrayRef apps = NULL; CFStringRef description = NULL;
      SecKeychainPromptSelector prompt = (SecKeychainPromptSelector)0;
      status = SecACLCopyContents(rule, &apps, &description, &prompt);
      if (apps) CFRelease(apps);
      NSString *text = description ? CFBridgingRelease(description) : nil;
      if (status) return status;
      ++seenPartitions;
      NSArray *ids = partitionIDs(text);
      admitted = ids.count == 1 && [ids[0] isEqualToString:ownPartition];
      continue;
    }
    status = verifyApplicationRule(rule);
    if (status) return status;
  }
  if (seenPartitions != partitions) return errSecInvalidItemRef;
  return !partitions || admitted ? errSecSuccess : errSecInvalidItemRef;
}

static OSStatus createVault(SecKeychainRef keychain, NSData *key) {
  SecTrustedApplicationRef application = NULL;
  OSStatus status = SecTrustedApplicationCreateFromPath(NULL, &application);
  if (status) return status;
  id helper = CFBridgingRelease(application);
  SecAccessRef raw = NULL;
  status = SecAccessCreate(CFSTR("VoxCue 登录信息"), (__bridge CFArrayRef)@[helper], &raw);
  if (status) return status;
  id access = CFBridgingRelease(raw);
  CFArrayRef list = NULL;
  status = SecAccessCopyACLList((__bridge SecAccessRef)access, &list);
  NSArray *rules = list ? CFBridgingRelease(list) : nil;
  // Owner, encrypt and decrypt rules all name only this helper. macOS adds the
  // real partition and integrity records itself; no partition record is forged.
  for (id value in rules) {
    if (status) break;
    CFArrayRef apps = NULL; CFStringRef description = NULL;
    SecKeychainPromptSelector prompt = (SecKeychainPromptSelector)0;
    status = SecACLCopyContents((__bridge SecACLRef)value, &apps, &description, &prompt);
    if (apps) CFRelease(apps);
    if (description) CFRelease(description);
    if (!status) status = SecACLSetContents((__bridge SecACLRef)value, (__bridge CFArrayRef)@[helper],
      CFSTR("VoxCue 登录信息"), prompt);
  }
  SecKeychainAttribute values[] = {
    {kSecServiceItemAttr, (UInt32)strlen(vaultService), (void *)vaultService},
    {kSecAccountItemAttr, (UInt32)strlen(vaultAccount), (void *)vaultAccount},
    {kSecLabelItemAttr, (UInt32)strlen(vaultName), (void *)vaultName}
  };
  SecKeychainAttributeList attributes{3, values};
  SecKeychainItemRef item = NULL;
  if (!status) status = SecKeychainItemCreateFromContent(kSecGenericPasswordItemClass, &attributes,
    (UInt32)key.length, key.bytes, keychain, (__bridge SecAccessRef)access, &item);
  if (item) CFRelease(item);
  return status;
}

static OSStatus firstSource(CFTypeRef keychains, id __strong *source) {
  for (size_t index = 0; index < sourceCount; ++index) {
    NSMutableArray *items = [NSMutableArray array];
    OSStatus status = matching(keychains, sourceServices[index], sourceAccounts[index], items);
    if (status) return status;
    if (!items.count) continue;
    // Search-list order is the order the earlier helpers used for this alias.
    status = exactAlias(items.firstObject, sourceServices[index], sourceAccounts[index]);
    if (!status) *source = items.firstObject;
    return status;
  }
  return errSecItemNotFound;
}

static OSStatus ownVault(CFTypeRef keychains, id __strong *vault) {
  NSMutableArray *items = [NSMutableArray array];
  OSStatus status = matching(keychains, vaultService, vaultAccount, items);
  if (status) return status;
  if (!items.count) return errSecItemNotFound;
  // Several same-name entries cannot be ordered safely; never pick one.
  if (items.count > 1) return errSecDuplicateItem;
  status = verifyVault(items.firstObject);
  if (!status) *vault = items.firstObject;
  return status;
}

// Load this helper's key. Without an own entry, read exactly one historical
// copy, store the same bytes in the source's keychain and prove the stored copy.
static OSStatus vaultKey(CFTypeRef keychains, SecKeychainRef fallback, bool encrypt, NSMutableData *__strong *key) {
  id vault = nil, source = nil;
  OSStatus status = ownVault(keychains, &vault);
  if (!status) return readKey(vault, key);
  if (status != errSecItemNotFound) return status;
  status = firstSource(keychains, &source);
  if (status && status != errSecItemNotFound) return status;
  NSMutableData *value = nil;
  id keychain = fallback ? (__bridge id)fallback : nil;
  if (source) {
    status = readKey(source, &value);
    SecKeychainRef owner = NULL;
    if (!status) status = SecKeychainItemCopyKeychain((__bridge SecKeychainItemRef)source, &owner);
    if (owner) keychain = CFBridgingRelease(owner);
  } else if (encrypt) {
    // Same first-write format as v1: base64 text of 16 random bytes.
    uint8_t random[16];
    status = SecRandomCopyBytes(kSecRandomDefault, sizeof(random), random);
    if (!status) value = [[[[NSData dataWithBytes:random length:sizeof(random)] base64EncodedStringWithOptions:0]
      dataUsingEncoding:NSUTF8StringEncoding] mutableCopy];
    archived::wipe(random, sizeof(random));
  } else {
    // A missing key never becomes a replacement key for existing ciphertext.
    return errSecItemNotFound;
  }
  if (!status) status = createVault((__bridge SecKeychainRef)keychain, value);
  if (status == errSecDuplicateItem) status = errSecSuccess;
  NSMutableData *stored = nil;
  if (!status) status = ownVault(keychains, &vault);
  if (!status) status = readKey(vault, &stored);
  if (!status && ![stored isEqualToData:value]) status = errSecDuplicateItem;
  if (stored) archived::wipe(stored.mutableBytes, stored.length);
  if (status) {
    if (value) archived::wipe(value.mutableBytes, value.length);
    return status;
  }
  *key = value;
  return errSecSuccess;
}

static bool needsInteraction(OSStatus status) {
  return status == errSecInteractionNotAllowed || status == errSecAuthFailed || status == errSecUserCanceled;
}

static bool validCipher(NSData *input) {
  return input.length >= 19 && (input.length - 3) % kCCBlockSizeAES128 == 0 &&
    memcmp(input.bytes, "v10", 3) == 0;
}

static NSData *cryptWithKey(NSData *input, bool encrypt, NSMutableData *key,
    SecKeychainRef keychain, OSStatus *status) {
  vaultKeyBytes = key;
  NSData *output = archived::crypt(input, encrypt, keychain, status);
  if (output) {
    NSData *roundtrip = archived::crypt(output, !encrypt, keychain, status);
    if (!roundtrip || ![roundtrip isEqualToData:input]) { *status = errSecDecode; output = nil; }
  }
  if (key) archived::wipe(key.mutableBytes, key.length);
  vaultKeyBytes = nil;
  return output;
}

// Local validation must not turn a cleanup gate into another migration request.
// The current generation is the only permitted key source, with interaction off.
static NSDictionary *validate(CFTypeRef keychains, SecKeychainRef keychain, NSData *input) {
  if (!validCipher(input)) return @{@"validation":@"invalid"};
  id vault = nil;
  NSMutableData *key = nil;
  OSStatus status = ownVault(keychains, &vault);
  if (!status) status = readKey(vault, &key);
  if (status) return @{@"validation":@"unavailable"};
  NSData *output = cryptWithKey(input, false, key, keychain, &status);
  return output ? @{@"data":[output base64EncodedStringWithOptions:0]}
    : @{@"validation":@"invalid"};
}

// Report whether the next request can finish without a system dialog. The lock
// state is checked before any ACL inspection or read of the selected entry.
static NSString *probe(CFTypeRef keychains, OSStatus *failure) {
  NSMutableArray *own = [NSMutableArray array];
  id target = nil;
  OSStatus status = matching(keychains, vaultService, vaultAccount, own);
  if (!status && own.count > 1) return @"conflict";
  if (!status && own.count) target = own.firstObject;
  else if (!status) {
    status = firstSource(keychains, &target);
    if (status == errSecItemNotFound) return @"ready";
  }
  SecKeychainRef keychain = NULL;
  SecKeychainStatus state = 0;
  if (!status) status = SecKeychainItemCopyKeychain((__bridge SecKeychainItemRef)target, &keychain);
  if (!status) status = SecKeychainGetStatus(keychain, &state);
  if (keychain) CFRelease(keychain);
  if (!status && !(state & kSecUnlockStateStatus)) return @"locked";
  if (!status && own.count) {
    status = verifyVault(target);
    if (status == errSecInvalidItemRef) return @"conflict";
  }
  NSMutableData *key = nil;
  if (!status) status = readKey(target, &key);
  if (key) archived::wipe(key.mutableBytes, key.length);
  if (!status) return @"ready";
  if (needsInteraction(status)) return @"authorize";
  *failure = status;
  return nil;
}

static NSDictionary *cleanup(CFTypeRef keychains) {
  // Removal never needs the key of a historical copy. Each exact reference is
  // deleted only while this helper's own entry is still present and readable.
  auto current = [&]() {
    id vault = nil;
    NSMutableData *key = nil;
    OSStatus status = ownVault(keychains, &vault);
    if (!status) status = readKey(vault, &key);
    if (key) archived::wipe(key.mutableBytes, key.length);
    return status;
  };
  auto deferred = [](NSString *reason) {
    // An incomplete enumeration cannot honestly report zero retained entries.
    return @{@"cleanup":@"deferred", @"removed":@0, @"retained":NSNull.null,
      @"retainedItems":@[], @"reason":reason};
  };
  if (current()) return deferred(@"current");
  NSMutableArray *items = [NSMutableArray array];
  NSMutableArray<NSNumber *> *aliases = [NSMutableArray array];
  for (size_t index = 0; index < sourceCount; ++index) {
    NSMutableArray *found = [NSMutableArray array];
    OSStatus status = matching(keychains, sourceServices[index], sourceAccounts[index], found);
    // Enumeration finishes before the first deletion. Unavailable historical
    // items are maintenance outcomes, not failures of the usable current key.
    if (status) return deferred(needsInteraction(status) ? @"authorization" : @"failed");
    for (id item in found) { [items addObject:item]; [aliases addObject:@(index)]; }
    if (items.count > 32) return deferred(@"failed");
  }
  NSUInteger removed = 0, retained = 0;
  NSMutableOrderedSet<NSString *> *retainedItems = [NSMutableOrderedSet orderedSet];
  NSString *reason = @"none";
  for (NSUInteger index = 0; index < items.count; ++index) {
    if (current()) {
      retained += items.count - index;
      for (NSUInteger next = index; next < items.count; ++next)
        [retainedItems addObject:sourceIDs[aliases[next].unsignedIntegerValue]];
      reason = @"current";
      break;
    }
    const size_t alias = aliases[index].unsignedIntegerValue;
    OSStatus status = exactAlias(items[index], sourceServices[alias], sourceAccounts[alias]);
    if (!status) status = SecKeychainItemDelete((__bridge SecKeychainItemRef)items[index]);
    if (!status || status == errSecItemNotFound) { ++removed; continue; }
    ++retained;
    [retainedItems addObject:sourceIDs[alias]];
    if ([reason isEqual:@"none"]) reason = needsInteraction(status) ? @"authorization" : @"failed";
  }
  NSString *state = !retained ? @"complete" : removed ? @"partial" : @"deferred";
  return @{@"cleanup":state, @"removed":@(removed), @"retained":@(retained),
    @"retainedItems":retainedItems.array, @"reason":reason};
}

int main(int argc, const char **argv) {
  @autoreleasepool {
    NSDictionary *identity = authenticatedVaultSelf();
    if (!identity) return 77;
    NSData *hash = identity[(__bridge id)kSecCodeInfoUnique];
    if (![hash isKindOfClass:NSData.class] || hash.length != 20) return 77;
    ownPartition = [@"cdhash:" stringByAppendingString:archived::hexData(hash)];
    SecTrustedApplicationRef application = NULL;
    if (SecTrustedApplicationCreateFromPath(NULL, &application) ||
        applicationIdentity(application, &ownApplicationIdentity)) {
      if (application) CFRelease(application);
      return 77;
    }
    CFRelease(application);
    SecKeychainRef keychain = NULL;
    CFTypeRef keychains = NULL;
#ifdef VOXCUE_CREDENTIAL_FIXTURE
    if ((argc != 2 && argc != 3) || SecKeychainOpen(argv[1], &keychain)) return 78;
    keychains = keychain;
    __attribute__((objc_precise_lifetime)) NSArray *temporaryKeychains = nil;
    if (argc == 3) {
      SecKeychainRef additional = NULL;
      if (SecKeychainOpen(argv[2], &additional)) { CFRelease(keychain); return 78; }
      temporaryKeychains = @[(__bridge id)keychain, CFBridgingRelease(additional)];
      keychains = (__bridge CFArrayRef)temporaryKeychains;
    }
    if (SecKeychainSetUserInteractionAllowed(false)) return 78;
#else
    if (argc != 1) return 78;
#endif
    NSMutableData *request = [NSMutableData data];
    uint8_t chunk[4096]; ssize_t count;
    while ((count = read(STDIN_FILENO, chunk, sizeof(chunk))) > 0) {
      if (request.length + count > 1024 * 1024) return 79;
      [request appendBytes:chunk length:(NSUInteger)count];
    }
    if (count < 0) return 79;
    id value = [NSJSONSerialization JSONObjectWithData:request options:0 error:nil];
    NSString *operation = [value isKindOfClass:NSDictionary.class] ? value[@"operation"] : nil;
    const bool crypto = [operation isEqual:@"encrypt"] || [operation isEqual:@"decrypt"];
    const bool validation = [operation isEqual:@"validate"];
    const bool dataOperation = crypto || validation;
    const bool maintenance = [operation isEqual:@"probe"] || [operation isEqual:@"cleanup"];
    if ((!dataOperation && !maintenance) || [value count] != (dataOperation ? 2u : 1u) ||
        (dataOperation && ![value[@"data"] isKindOfClass:NSString.class])) return 79;
    OSStatus status = errSecDecode;
    NSDictionary *reply = nil;
    if (maintenance || validation) {
      // Probe, validation and cleanup must fail before any access if disabling
      // interaction fails; ignoring this result would permit a password dialog.
      status = SecKeychainSetUserInteractionAllowed(false);
      if (status) {
        if (keychain) CFRelease(keychain);
        fprintf(stderr, "VoxCue credential operation failed (%d).\n", (int)status);
        return 80;
      }
      if (validation) {
        NSData *input = [[NSData alloc] initWithBase64EncodedString:value[@"data"] options:0];
        if (!input) return 79;
        reply = validate(keychains, keychain, input);
      } else if ([operation isEqual:@"probe"]) {
        NSString *state = probe(keychains, &status);
        if (state) reply = @{@"state":state};
      } else {
        reply = cleanup(keychains);
      }
    } else {
      const bool encrypt = [operation isEqual:@"encrypt"];
      NSData *input = [[NSData alloc] initWithBase64EncodedString:value[@"data"] options:0];
      if (!input) return 79;
      // Malformed ciphertext is rejected before any Keychain access.
      if (encrypt || validCipher(input)) {
        NSMutableData *key = nil;
        status = vaultKey(keychains, keychain, encrypt, &key);
        NSData *output = status ? nil : cryptWithKey(input, encrypt, key, keychain, &status);
        if (output) reply = @{@"data":[output base64EncodedStringWithOptions:0]};
      }
    }
    if (keychain) CFRelease(keychain);
    if (!reply) { fprintf(stderr, "VoxCue credential operation failed (%d).\n", (int)status); return 80; }
    NSData *bytes = [NSJSONSerialization dataWithJSONObject:reply options:0 error:nil];
    const uint8_t *cursor = (const uint8_t *)bytes.bytes; size_t left = bytes.length;
    while (left) { ssize_t written = write(STDOUT_FILENO, cursor, left); if (written <= 0) return 81; cursor += written; left -= written; }
    return 0;
  }
}
