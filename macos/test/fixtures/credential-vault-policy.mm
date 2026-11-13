// Pure in-memory ACL policy fixture. No real or temporary Keychain is opened.
// The source copy only changes the parent identity and renames its entry point;
// all production policy checks below execute unchanged.
#include "credential-fixture-boundary.h"
#include <vector>
#include <mach-o/dyld.h>

#ifndef VOXCUE_FIXTURE_VAULT_SOURCE
#error An isolated source copy with a renamed entry point is required
#endif
#ifndef VOXCUE_FIXTURE_SELF_PATH
#error A fixed canonical fixture executable path is required
#endif
#ifndef VOXCUE_FIXTURE_VAULT_ACCOUNT
#define VOXCUE_FIXTURE_VAULT_ACCOUNT "VoxCue Key v8"
#endif

static id fixtureItem;
static SecAccessRef fixtureAccess;
static NSUInteger fixtureItemCalls;
static bool fixtureFailInteraction;

static OSStatus fixtureAttributes(SecKeychainItemRef item, SecKeychainAttributeInfo *, SecItemClass *kind,
    SecKeychainAttributeList **attributes, UInt32 *, void **data) {
  ++fixtureItemCalls;
  if (item != (__bridge SecKeychainItemRef)fixtureItem || data || !kind || !attributes) return errSecParam;
  static char service[] = "VoxCue Credential Storage", account[] = VOXCUE_FIXTURE_VAULT_ACCOUNT;
  static SecKeychainAttribute values[] = {
    {kSecServiceItemAttr, sizeof(service) - 1, service},
    {kSecAccountItemAttr, sizeof(account) - 1, account}
  };
  static SecKeychainAttributeList list{2, values};
  *kind = kSecGenericPasswordItemClass;
  *attributes = &list;
  return errSecSuccess;
}
static OSStatus fixtureFreeAttributes(SecKeychainAttributeList *, void *) { return errSecSuccess; }
static OSStatus fixtureCopyAccess(SecKeychainItemRef item, SecAccessRef *access) {
  ++fixtureItemCalls;
  if (item != (__bridge SecKeychainItemRef)fixtureItem || !fixtureAccess || !access) return errSecParam;
  *access = (SecAccessRef)CFRetain(fixtureAccess);
  return errSecSuccess;
}
static OSStatus fixtureSearch(CFTypeRef, SecItemClass, const SecKeychainAttributeList *, SecKeychainSearchRef *) {
  ++fixtureItemCalls;
  return errSecInternalComponent;
}
static OSStatus fixtureInteraction(Boolean allowed) {
  if (fixtureFailInteraction && !allowed) return errSecInternalComponent;
  return SecKeychainSetUserInteractionAllowed(allowed);
}

#define SecKeychainItemCopyAttributesAndData fixtureAttributes
#define SecKeychainItemFreeAttributesAndData fixtureFreeAttributes
#define SecKeychainItemCopyAccess fixtureCopyAccess
#define SecKeychainSearchCreateFromAttributes fixtureSearch
#define SecKeychainSetUserInteractionAllowed fixtureInteraction
#include VOXCUE_FIXTURE_VAULT_SOURCE
#undef SecKeychainSetUserInteractionAllowed
#undef SecKeychainSearchCreateFromAttributes
#undef SecKeychainItemCopyAccess
#undef SecKeychainItemFreeAttributesAndData
#undef SecKeychainItemCopyAttributesAndData

// Build real CSSM PARTITION subjects in an in-memory SecAccess. Nothing here is
// committed through SecKeychainItemSetAccess or any other storage API.
static OSStatus rewriteFixtureSignature(CSSM_LIST &list, NSData *path, NSData *requirement,
    NSUInteger depth, NSUInteger *remaining) {
  if (depth > 8 || !list.Head) return errSecInvalidItemRef;
  const bool signature = list.Head->ElementType == CSSM_LIST_ELEMENT_WORDID &&
    list.Head->WordID == CSSM_ACL_SUBJECT_TYPE_CODE_SIGNATURE;
  NSUInteger index = 0;
  for (auto element = list.Head; element; element = element->NextElement, ++index) {
    if (!*remaining) return errSecDataTooLarge;
    --*remaining;
    if (signature && (index == 3 || (index == 4 && requirement))) {
      NSData *value = index == 3 ? path : requirement;
      if (element->ElementType != CSSM_LIST_ELEMENT_DATUM) return errSecInvalidItemRef;
      element->Element.Word.Length = (uint32)value.length;
      element->Element.Word.Data = (uint8 *)value.bytes;
    } else if (element->ElementType == CSSM_LIST_ELEMENT_SUBLIST) {
      OSStatus status = rewriteFixtureSignature(element->Element.Sublist, path, requirement, depth + 1, remaining);
      if (status) return status;
    }
  }
  return signature && index < 5 ? errSecInvalidItemRef : errSecSuccess;
}

static OSStatus makePolicy(NSString *variant, SecAccessRef *result) {
  SecTrustedApplicationRef self = NULL, foreign = NULL;
  OSStatus status = SecTrustedApplicationCreateFromPath(NULL, &self);
  if (!status) status = SecTrustedApplicationCreateFromPath("/usr/bin/true", &foreign);
  if (status) { if (self) CFRelease(self); return status; }
  id ownApplication = CFBridgingRelease(self), otherApplication = CFBridgingRelease(foreign);
  SecAccessRef raw = NULL;
  status = SecAccessCreate(CFSTR("VoxCue 登录信息"), (__bridge CFArrayRef)@[ownApplication], &raw);
  if (status) return status;
  id access = CFBridgingRelease(raw);
  CFArrayRef list = NULL;
  status = SecAccessCopyACLList((__bridge SecAccessRef)access, &list);
  NSArray *rules = list ? CFBridgingRelease(list) : nil;
  for (id value in rules) {
    if (status) return status;
    SecACLRef rule = (__bridge SecACLRef)value;
    NSArray *tags = CFBridgingRelease(SecACLCopyAuthorizations(rule));
    const bool owner = [tags containsObject:(__bridge id)kSecACLAuthorizationChangeACL];
    const bool extra = ([variant isEqual:@"owner-extra"] && owner) ||
      ([variant isEqual:@"applications-extra"] && !owner);
    NSArray *apps = [variant isEqual:@"foreign-same-path"] ? @[otherApplication]
      : extra ? @[ownApplication, otherApplication] : @[ownApplication];
    status = SecACLSetContents(rule, (__bridge CFArrayRef)apps, CFSTR("VoxCue 登录信息"),
      (SecKeychainPromptSelector)0);
  }
  if (status) return status;
  CSSM_ACL_OWNER_PROTOTYPE_PTR owner = NULL;
  CSSM_ACL_ENTRY_INFO_PTR existing = NULL;
  uint32 count = 0;
  status = SecAccessGetOwnerAndACL((__bridge SecAccessRef)access, &owner, &count, &existing);
  if (status || !owner || !existing || count > 16) return status ?: errSecInvalidItemRef;
  if ([variant isEqual:@"moved-same-identity"] || [variant isEqual:@"foreign-same-path"] ||
      [variant isEqual:@"broad-same-path"]) {
    CFDataRef copiedPath = NULL;
    status = SecTrustedApplicationCopyData((__bridge SecTrustedApplicationRef)ownApplication, &copiedPath);
    NSData *path = copiedPath ? CFBridgingRelease(copiedPath) : nil;
    if (status) return status;
    if ([variant isEqual:@"moved-same-identity"]) {
      static const char oldPath[] = "/Applications/Previous VoxCue.app/Contents/Resources/native/VoxCue";
      path = [NSData dataWithBytes:oldPath length:sizeof(oldPath)];
    }
    NSData *requirement = nil;
    if ([variant isEqual:@"broad-same-path"]) {
      SecRequirementRef broad = NULL;
      CFDataRef data = NULL;
      status = SecRequirementCreateWithString(CFSTR("true"), kSecCSDefaultFlags, &broad);
      if (!status) status = SecRequirementCopyData(broad, kSecCSDefaultFlags, &data);
      if (broad) CFRelease(broad);
      requirement = data ? CFBridgingRelease(data) : nil;
      if (status) return status;
    }
    NSUInteger remaining = 256;
    status = rewriteFixtureSignature(owner->TypedSubject, path, requirement, 0, &remaining);
    for (uint32 index = 0; index < count && !status; ++index)
      status = rewriteFixtureSignature(existing[index].EntryPublicInfo.TypedSubject, path, requirement, 0, &remaining);
    if (status) return status;
  }
  NSArray *ids = [variant isEqual:@"partition-extra"]
    ? @[ownPartition, @"cdhash:0000000000000000000000000000000000000000"]
    : [variant isEqual:@"partition-foreign"] ? @[@"cdhash:0000000000000000000000000000000000000000"]
    : @[ownPartition];
  NSMutableDictionary *payload = [@{@"Partitions":ids} mutableCopy];
  if ([variant isEqual:@"partition-extra-field"]) payload[@"Unexpected"] = @YES;
  NSData *xml = [NSPropertyListSerialization dataWithPropertyList:payload
    format:NSPropertyListXMLFormat_v1_0 options:0 error:nil];
  if (!xml) return errSecDecode;
  CSSM_LIST_ELEMENT head{}, bytes{};
  head.ElementType = CSSM_LIST_ELEMENT_WORDID;
  head.WordID = [variant isEqual:@"partition-forged"] ? CSSM_ACL_SUBJECT_TYPE_ANY : CSSM_ACL_SUBJECT_TYPE_PARTITION;
  head.NextElement = &bytes;
  bytes.ElementType = CSSM_LIST_ELEMENT_DATUM;
  bytes.Element.Word.Length = (uint32)xml.length;
  bytes.Element.Word.Data = (uint8 *)xml.bytes;
  CSSM_ACL_AUTHORIZATION_TAG authorization = CSSM_ACL_AUTHORIZATION_PARTITION_ID;
  CSSM_ACL_ENTRY_INFO partition{};
  partition.EntryHandle = 0x7fff;
  partition.EntryPublicInfo.TypedSubject = {CSSM_LIST_TYPE_SEXPR, &head, &bytes};
  partition.EntryPublicInfo.Authorization = {1, &authorization};
  strlcpy(partition.EntryPublicInfo.EntryTag, CSSM_APPLE_ACL_TAG_PARTITION_ID,
    sizeof(partition.EntryPublicInfo.EntryTag));
  std::vector<CSSM_ACL_ENTRY_INFO> entries(existing, existing + count);
  entries.push_back(partition);
  return SecAccessCreateFromOwnerAndACL(owner, (uint32)entries.size(), entries.data(), result);
}

int main(int argc, const char **argv) {
  @autoreleasepool {
    // NSTask may spell /private/var as /var in argv[0]. Resolve the actual image,
    // require the compile-time exact canonical target, then apply every original
    // owned-file check to that target; arbitrary redirected paths remain rejected.
    char executable[PATH_MAX], resolved[PATH_MAX];
    uint32_t size = sizeof(executable);
    if (argc != 2 || _NSGetExecutablePath(executable, &size) || !realpath(executable, resolved) ||
        strcmp(resolved, VOXCUE_FIXTURE_SELF_PATH) || !ownedFixtureFile(@VOXCUE_FIXTURE_SELF_PATH)) {
      fprintf(stderr, "policy-helper: entry guard argc=%d root=%d file=%d\n", argc,
        ownedFixtureRoot(), ownedFixtureFile(@VOXCUE_FIXTURE_SELF_PATH));
      return 76;
    }
    NSDictionary *identity = authenticatedVaultSelf();
    if (!identity) return 77;
    NSString *mode = @(argv[1]);
    if ([mode isEqual:@"disable-ui"]) {
      fixtureFailInteraction = true;
      const int result = vaultFixtureMain(1, argv);
      fprintf(stderr, "fixture-policy-item-calls:%lu\n", (unsigned long)fixtureItemCalls);
      return fixtureItemCalls ? 91 : result;
    }
    if (![mode isEqual:@"policy"]) {
      fprintf(stderr, "policy-helper: invalid mode %s\n", mode.UTF8String); return 76;
    }
    NSData *hash = identity[(__bridge id)kSecCodeInfoUnique];
    if (![hash isKindOfClass:NSData.class] || hash.length != 20) return 77;
    ownPartition = [@"cdhash:" stringByAppendingString:archived::hexData(hash)];
    SecTrustedApplicationRef self = NULL;
    OSStatus status = SecTrustedApplicationCreateFromPath(NULL, &self);
    if (!status) status = applicationIdentity(self, &ownApplicationIdentity);
    if (status) {
      fprintf(stderr, "policy-helper: self identity extraction failed %d\n", (int)status);
      SecAccessRef diagnostic = NULL;
      if (self && !SecAccessCreate(CFSTR("VoxCue 登录信息"), (__bridge CFArrayRef)@[(__bridge id)self], &diagnostic)) {
        CSSM_ACL_OWNER_PROTOTYPE_PTR owner = NULL;
        CSSM_ACL_ENTRY_INFO_PTR entries = NULL; uint32 count = 0;
        if (!SecAccessGetOwnerAndACL(diagnostic, &owner, &count, &entries))
          for (uint32 index = 0; index < count; ++index)
            fprintf(stderr, "policy-helper: raw list type=%u head=%u count=%u\n",
              entries[index].EntryPublicInfo.TypedSubject.ListType,
              entries[index].EntryPublicInfo.TypedSubject.Head ? entries[index].EntryPublicInfo.TypedSubject.Head->WordID : 0, count);
        CFRelease(diagnostic);
      }
    }
    if (self) CFRelease(self);
    if (status) return 77;
    fixtureItem = [NSObject new];
    for (NSString *variant in @[@"own", @"moved-same-identity", @"foreign-same-path", @"broad-same-path",
        @"partition-extra", @"partition-foreign",
        @"applications-extra", @"owner-extra", @"partition-forged", @"partition-extra-field"]) {
      status = makePolicy(variant, &fixtureAccess);
      if (status) { fprintf(stderr, "fixture-policy-construct:%s:%d\n", variant.UTF8String, (int)status); return 92; }
      const OSStatus checked = verifyVault(fixtureItem);
      CFRelease(fixtureAccess); fixtureAccess = NULL;
      const bool expected = [variant isEqual:@"own"] || [variant isEqual:@"moved-same-identity"];
      if ((checked == errSecSuccess) != expected) {
        fprintf(stderr, "fixture-policy-unexpected:%s:%d\n", variant.UTF8String, (int)checked);
        return 93;
      }
      printf("PASS: in-memory ACL policy %s\n", variant.UTF8String);
    }
    return 0;
  }
}
