// Included inside frozenCredentials by the unchanged cleanup implementation.
// macOS owns real partition records: changing their protected tag through the
// normal SetAccess API is forbidden, even after an ordinary owner UI grant.
static CFStringRef loginName() { return CFSTR("VoxCue 登录信息"); }
static OSStatus namedAccess(CFStringRef, CFArrayRef applications, SecAccessRef *access) {
  return SecAccessCreate(loginName(), applications, access);
}
static OSStatus namedItem(SecItemClass, const SecKeychainAttributeList *, UInt32,
  const void *, SecKeychainRef, SecAccessRef, SecKeychainItemRef *);
#define SecAccessCreate namedAccess
#define SecKeychainItemCreateFromContent namedItem
namespace archivedPolicy {
#include VOXCUE_COMPATIBLE_HARDENED_SOURCE
}
#undef SecKeychainItemCreateFromContent
#undef SecAccessCreate
using archivedPolicy::wipe;
using archivedPolicy::hexData;
using archivedPolicy::hardenedIdentity;
using archivedPolicy::signingInfo;
using archivedPolicy::crypt;
static NSString *__strong &authenticatedPartition = archivedPolicy::authenticatedPartition;
#ifdef VOXCUE_CREDENTIAL_FIXTURE
static int failACLAt = -1;
#endif

static bool only(NSArray *tags, CFStringRef authorization) {
  return tags.count == 1 && [tags containsObject:(__bridge id)authorization];
}
static NSArray *partitionIDs(NSString *description) {
  if (!description.length || description.length > 32768 || description.length % 2 ||
      [description rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:
        @"0123456789abcdef"] invertedSet]].location != NSNotFound) return nil;
  NSMutableData *bytes = [NSMutableData dataWithLength:description.length / 2];
  for (NSUInteger i = 0; i < description.length; i += 2) {
    unsigned value = 0;
    if (![[NSScanner scannerWithString:[description substringWithRange:NSMakeRange(i, 2)]]
        scanHexInt:&value]) return nil;
    ((uint8_t *)bytes.mutableBytes)[i / 2] = (uint8_t)value;
  }
  id object = [NSPropertyListSerialization propertyListWithData:bytes options:0 format:NULL error:nil];
  NSArray *ids = [object isKindOfClass:NSDictionary.class] ? object[@"Partitions"] : nil;
  if (![object isKindOfClass:NSDictionary.class] || [object count] != 1 ||
      ![ids isKindOfClass:NSArray.class] || !ids.count || ids.count > 32) return nil;
  for (id value in ids)
    if (![value isKindOfClass:NSString.class] || ![value length] || [value length] > 256) return nil;
  return ids;
}

// Copy raw public ACL metadata to distinguish the old ANY-or-PROMPT record from
// a real CSSM partition subject. No password content is read by this inspection.
static OSStatus removeMalformedPartition(SecAccessRef access, bool *changed) {
  CFArrayRef all = NULL;
  OSStatus status = SecAccessCopyACLList(access, &all);
  if (status) return status;
  const bool bounded = CFArrayGetCount(all) <= 64;
  CFRelease(all);
  if (!bounded) return errSecDataTooLarge;
  CSSM_ACL_OWNER_PROTOTYPE_PTR owner = NULL;
  CSSM_ACL_ENTRY_INFO_PTR entries = NULL;
  uint32 count = 0;
  // The deprecated snapshot allocations are bounded to this one-request process.
  status = SecAccessGetOwnerAndACL(access, &owner, &count, &entries);
  if (status || !owner || !entries || count > 64) return status ?: errSecInvalidItemRef;
  NSArray *rules = CFBridgingRelease(SecAccessCopyMatchingACLList(access, kSecACLAuthorizationPartitionID));
  NSUInteger index = 0;
  NSMutableArray *remove = [NSMutableArray array];
  for (uint32 i = 0; i < count; ++i) {
    auto &entry = entries[i].EntryPublicInfo;
    bool partition = false;
    for (uint32 j = 0; j < entry.Authorization.NumberOfAuthTags; ++j)
      partition |= entry.Authorization.AuthTags[j] == CSSM_ACL_AUTHORIZATION_PARTITION_ID;
    if (!partition) continue;
    if (entry.Authorization.NumberOfAuthTags != 1 || index >= rules.count) return errSecInvalidItemRef;
    SecACLRef acl = (__bridge SecACLRef)rules[index++];
    NSArray *tags = CFBridgingRelease(SecACLCopyAuthorizations(acl));
    if (!only(tags, kSecACLAuthorizationPartitionID)) return errSecInvalidItemRef;
    CFArrayRef apps = NULL; CFStringRef description = NULL;
    SecKeychainPromptSelector prompt = (SecKeychainPromptSelector)0;
    status = SecACLCopyContents(acl, &apps, &description, &prompt);
    NSArray *ids = status ? nil : partitionIDs((__bridge NSString *)description);
    if (apps) CFRelease(apps);
    if (description) CFRelease(description);
    if (status || !ids) return status ?: errSecInvalidItemRef;
    auto head = entry.TypedSubject.Head;
    if (head && head->ElementType == CSSM_LIST_ELEMENT_WORDID &&
        head->WordID == CSSM_ACL_SUBJECT_TYPE_PARTITION) continue;
    // Recognize only the frozen helper's exact unrestricted prompt form. A
    // custom/restricted/mixed record fails closed instead of being discarded.
    auto one = head ? head->NextElement : NULL, two = one ? one->NextElement : NULL;
    auto any = two ? two->NextElement : NULL, ask = any ? any->NextElement : NULL;
    auto a = any && any->ElementType == CSSM_LIST_ELEMENT_SUBLIST ? any->Element.Sublist.Head : NULL;
    auto p = ask && ask->ElementType == CSSM_LIST_ELEMENT_SUBLIST ? ask->Element.Sublist.Head : NULL;
    if (!head || head->ElementType != CSSM_LIST_ELEMENT_WORDID || head->WordID != CSSM_ACL_SUBJECT_TYPE_THRESHOLD ||
        !one || one->ElementType != CSSM_LIST_ELEMENT_WORDID || one->WordID != 1 ||
        !two || two->ElementType != CSSM_LIST_ELEMENT_WORDID || two->WordID != 2 ||
        !a || a->ElementType != CSSM_LIST_ELEMENT_WORDID || a->WordID != CSSM_ACL_SUBJECT_TYPE_ANY || a->NextElement ||
        !p || p->ElementType != CSSM_LIST_ELEMENT_WORDID || p->WordID != CSSM_ACL_SUBJECT_TYPE_KEYCHAIN_PROMPT ||
        ask->NextElement || entry.Delegate || entry.EntryTag[0] || apps || prompt) return errSecInvalidItemRef;
    for (NSString *identifier in ids)
      if ([identifier rangeOfString:@"^cdhash:[a-f0-9]{40}$" options:NSRegularExpressionSearch].location == NSNotFound)
        return errSecInvalidItemRef;
    [remove addObject:(__bridge id)acl];
  }
  if (index != rules.count) return errSecInvalidItemRef;
  for (id rule in remove) {
    status = SecACLRemove((__bridge SecACLRef)rule);
    if (status) return status;
  }
  *changed |= remove.count != 0;
  return errSecSuccess;
}

static OSStatus restrictedAccess(SecKeychainItemRef item, NSString *partition, SecAccessRef *result) {
  SecAccessRef raw = NULL;
  OSStatus status = SecKeychainItemCopyAccess(item, &raw);
  if (status) return status;
  id access = CFBridgingRelease(raw);
  bool changed = false;
  status = removeMalformedPartition((__bridge SecAccessRef)access, &changed);
  if (status || changed) return status ?: errSecInvalidItemRef;
  SecTrustedApplicationRef application = NULL;
  status = SecTrustedApplicationCreateFromPath(NULL, &application);
  if (status) return status;
  id retainedApplication = CFBridgingRelease(application);
  CFDataRef identity = NULL;
  status = SecTrustedApplicationCopyData((__bridge SecTrustedApplicationRef)retainedApplication, &identity);
  id trustedData = identity ? CFBridgingRelease(identity) : nil;
  CFArrayRef entries = NULL;
  if (!status) status = SecAccessCopyACLList((__bridge SecAccessRef)access, &entries);
  for (id value in (__bridge NSArray *)entries) {
    if (status) break;
    SecACLRef acl = (__bridge SecACLRef)value;
    NSArray *tags = CFBridgingRelease(SecACLCopyAuthorizations(acl));
    if (!tags) { status = errSecInvalidItemRef; break; }
    if ([tags containsObject:(__bridge id)kSecACLAuthorizationIntegrity]) {
      if (!only(tags, kSecACLAuthorizationIntegrity)) status = errSecInvalidItemRef;
      continue;
    }
    CFArrayRef apps = NULL; CFStringRef description = NULL;
    SecKeychainPromptSelector prompt = (SecKeychainPromptSelector)0;
    status = SecACLCopyContents(acl, &apps, &description, &prompt);
    if (!status && [tags containsObject:(__bridge id)kSecACLAuthorizationPartitionID]) {
      // macOS extends this list through its normal read-authorization flow.
      // Preserve every system entry and never rewrite its protected payload.
      if (!only(tags, kSecACLAuthorizationPartitionID) ||
          ![partitionIDs((__bridge NSString *)description) containsObject:partition]) status = errSecAuthFailed;
    } else if (!status) {
      CFDataRef previous = NULL;
      if (apps && CFArrayGetCount(apps) == 1)
        status = SecTrustedApplicationCopyData((SecTrustedApplicationRef)CFArrayGetValueAtIndex(apps, 0), &previous);
      const bool equal = previous && CFEqual(previous, (__bridge CFDataRef)trustedData) &&
        description && CFEqual(description, loginName());
      if (previous) CFRelease(previous);
      if (!status && !equal) {
        NSArray *onlySelf = @[retainedApplication];
        status = SecACLSetContents(acl, (__bridge CFArrayRef)onlySelf, loginName(), prompt);
        changed = true;
      }
    }
    if (apps) CFRelease(apps);
    if (description) CFRelease(description);
  }
  if (entries) CFRelease(entries);
  if (!status && changed) *result = (SecAccessRef)CFBridgingRetain(access);
  return status;
}

static OSStatus nameCurrentItem(SecKeychainItemRef item) {
  UInt32 tags[] = {kSecServiceItemAttr, kSecAccountItemAttr, kSecLabelItemAttr};
  UInt32 formats[] = {CSSM_DB_ATTRIBUTE_FORMAT_STRING, CSSM_DB_ATTRIBUTE_FORMAT_STRING,
    CSSM_DB_ATTRIBUTE_FORMAT_STRING};
  SecKeychainAttributeInfo requested{3, tags, formats};
  SecKeychainAttributeList *attributes = NULL;
  OSStatus status = SecKeychainItemCopyAttributesAndData(item, &requested, NULL, &attributes, NULL, NULL);
  if (status) return status;
  NSString *service = nil, *account = nil, *label = nil;
  for (UInt32 i = 0; attributes && i < attributes->count; ++i) {
    auto value = attributes->attr[i];
    NSString *text = [[NSString alloc] initWithBytes:value.data length:value.length encoding:NSUTF8StringEncoding];
    if (value.tag == kSecServiceItemAttr) service = text;
    if (value.tag == kSecAccountItemAttr) account = text;
    if (value.tag == kSecLabelItemAttr) label = text;
  }
  if (attributes) SecKeychainItemFreeAttributesAndData(attributes, NULL);
  if (![service isEqualToString:@"VoxCue Credential Storage"] ||
      ![account isEqualToString:@"VoxCue Key"] || [label isEqualToString:(__bridge NSString *)loginName()])
    return errSecSuccess;
  const char *name = "VoxCue 登录信息";
  SecKeychainAttribute value{kSecLabelItemAttr, (UInt32)strlen(name), (void *)name};
  SecKeychainAttributeList list{1, &value};
  // A null data pointer changes metadata only; it never replaces the password.
  return SecKeychainItemModifyAttributesAndData(item, &list, 0, NULL);
}

static OSStatus migrateAccess(CFTypeRef keychains, NSString *partition) {
  const char *services[] = {"VoxCue Credential Storage", "VoxCue Safe Storage", "VoxCue Safe Storage"};
  const char *accounts[] = {"VoxCue Key", "VoxCue Key", "VoxCue"};
  NSMutableArray *items = [NSMutableArray array], *accesses = [NSMutableArray array];
  NSMutableArray<NSMutableData *> *passwords = [NSMutableArray array];
  @try {
    OSStatus status = errSecSuccess;
    for (size_t i = 0; i < 3; ++i) {
      SecKeychainAttribute attributes[] = {{kSecServiceItemAttr, (UInt32)strlen(services[i]), (void *)services[i]},
        {kSecAccountItemAttr, (UInt32)strlen(accounts[i]), (void *)accounts[i]}};
      SecKeychainAttributeList list{2, attributes};
      SecKeychainSearchRef search = NULL;
      status = SecKeychainSearchCreateFromAttributes(keychains, kSecGenericPasswordItemClass, &list, &search);
      if (status) return status;
      id retainedSearch = CFBridgingRelease(search);
      for (;;) {
        SecKeychainItemRef item = NULL;
        status = SecKeychainSearchCopyNext((__bridge SecKeychainSearchRef)retainedSearch, &item);
        if (status == errSecItemNotFound) break;
        if (status) return status;
        [items addObject:CFBridgingRelease(item)];
        if (items.count > 32) return errSecDataTooLarge;
        SecAccessRef access = NULL;
        status = SecKeychainItemCopyAccess(item, &access);
        bool changed = false;
        if (!status) status = removeMalformedPartition(access, &changed);
        if (!status && changed) status = SecKeychainItemSetAccess(item, access);
        if (access) CFRelease(access);
#ifdef VOXCUE_CREDENTIAL_FIXTURE
        if (!status && changed) fputs("fixture-structural-repair\n", stderr);
#endif
        if (status) return status;
        UInt32 length = 0; void *bytes = NULL;
        status = SecKeychainItemCopyContent(item, NULL, NULL, &length, &bytes);
        if (status) return status;
        NSMutableData *password = [NSMutableData dataWithBytes:bytes length:length];
        if (bytes) { wipe(bytes, length); SecKeychainItemFreeContent(NULL, bytes); }
        [passwords addObject:password];
        if (!length || ![password isEqualToData:passwords.firstObject]) return errSecDecode;
      }
    }
    for (id value in items) {
      SecAccessRef access = NULL;
      status = restrictedAccess((__bridge SecKeychainItemRef)value, partition, &access);
      if (status) return status;
      [accesses addObject:access ? CFBridgingRelease(access) : NSNull.null];
    }
    for (NSUInteger i = 0; i < items.count; ++i) {
      if (accesses[i] == NSNull.null) continue;
#ifdef VOXCUE_CREDENTIAL_FIXTURE
      if ((int)i == failACLAt) return errSecAuthFailed;
#endif
      status = SecKeychainItemSetAccess((__bridge SecKeychainItemRef)items[i], (__bridge SecAccessRef)accesses[i]);
      if (status) return status;
    }
    for (id value in items) {
      SecAccessRef pending = NULL;
      status = restrictedAccess((__bridge SecKeychainItemRef)value, partition, &pending);
      if (pending) { CFRelease(pending); if (!status) status = errSecAuthFailed; }
      if (!status) status = nameCurrentItem((__bridge SecKeychainItemRef)value);
      if (status) return status;
    }
    return errSecSuccess;
  } @finally {
    for (NSMutableData *password in passwords) wipe(password.mutableBytes, password.length);
  }
}

static OSStatus namedItem(SecItemClass kind, const SecKeychainAttributeList *attributes,
    UInt32 length, const void *bytes, SecKeychainRef keychain, SecAccessRef access,
    SecKeychainItemRef *result) {
  bool changed = false;
  OSStatus status = removeMalformedPartition(access, &changed);
  if (status) return status;
  const char *label = "VoxCue 登录信息";
  if (kind != kSecGenericPasswordItemClass || !attributes || attributes->count != 2) return errSecParam;
  SecKeychainAttribute values[] = {attributes->attr[0], attributes->attr[1],
    {kSecLabelItemAttr, (UInt32)strlen(label), (void *)label}};
  SecKeychainAttributeList named{3, values};
  return SecKeychainItemCreateFromContent(kind, &named, length, bytes, keychain, access, result);
}
