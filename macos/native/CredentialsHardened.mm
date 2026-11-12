// Preserve the frozen v1 source and its v10/password implementation. This new
// identity narrows execution and migrates access; it never rotates an old key.
#import <Foundation/Foundation.h>
#import <Security/Security.h>
static OSStatus addRestrictedPassword(SecKeychainRef, UInt32, const char *, UInt32, const char *, UInt32, const void *, SecKeychainItemRef *);
#define SecKeychainAddGenericPassword addRestrictedPassword
#define main legacyCredentialMain
#include "Credentials.mm"
#undef main
#undef SecKeychainAddGenericPassword
#import <Security/cssmapple.h>
static NSString *authenticatedPartition;
#ifdef VOXCUE_CREDENTIAL_FIXTURE
static int failACLAt = -1;
#endif

static NSString *hexData(NSData *data) {
  NSMutableString *hex = [NSMutableString stringWithCapacity:data.length * 2];
  const uint8_t *bytes = (const uint8_t *)data.bytes;
  for (NSUInteger index = 0; index < data.length; ++index) [hex appendFormat:@"%02x", bytes[index]];
  return hex;
}

static NSDictionary *signingInfo(SecCodeRef code) {
  CFDictionaryRef information = NULL;
  if (SecCodeCopySigningInformation(code, kSecCSSigningInformation, &information)) return nil;
  return CFBridgingRelease(information);
}

static bool hardenedIdentity(SecCodeRef code, NSString *identifier) {
  SecRequirementRef requirement = NULL;
  NSString *rule = [NSString stringWithFormat:@"identifier \"%@\" and certificate root = H\"" VOXCUE_SIGNING_SHA1 "\"", identifier];
  OSStatus status = SecRequirementCreateWithString((__bridge CFStringRef)rule, kSecCSDefaultFlags, &requirement);
  if (!status) status = SecCodeCheckValidity(code, kSecCSDefaultFlags, requirement);
  if (requirement) CFRelease(requirement);
  NSDictionary *information = signingInfo(code);
  NSDictionary *entitlements = information[(__bridge id)kSecCodeInfoEntitlementsDict];
  if ([entitlements[@"com.apple.security.cs.allow-dyld-environment-variables"] boolValue] ||
      [entitlements[@"com.apple.security.cs.allow-unsigned-executable-memory"] boolValue] ||
      [entitlements[@"com.apple.security.get-task-allow"] boolValue]) return false;
  if ([identifier isEqual:@"com.voxcue.credentials.hardened"] && entitlements.count) return false;
  return !status && ([information[(__bridge id)kSecCodeInfoFlags] unsignedIntValue] & kSecCodeSignatureRuntime);
}

static NSDictionary *authenticatedSelf() {
  const pid_t parent = getppid();
  SecCodeRef code = NULL;
  OSStatus status = SecCodeCopyGuestWithAttributes(NULL,
    (__bridge CFDictionaryRef)@{(__bridge id)kSecGuestAttributePid: @(parent)}, kSecCSDefaultFlags, &code);
  bool accepted = !status && hardenedIdentity(code, @"com.voxcue.app");
  if (code) CFRelease(code);
  if (!accepted || parent != getppid()) return nil;
  code = NULL;
  status = SecCodeCopySelf(kSecCSDefaultFlags, &code);
  accepted = !status && hardenedIdentity(code, @"com.voxcue.credentials.hardened");
  NSDictionary *information = accepted ? signingInfo(code) : nil;
  if (code) CFRelease(code);
  return information;
}

static OSStatus addPartition(SecAccessRef access, NSString *partition) {
  NSData *xml = [NSPropertyListSerialization dataWithPropertyList:@{@"Partitions":@[partition]}
    format:NSPropertyListXMLFormat_v1_0 options:0 error:nil];
  if (!xml) return errSecAllocate;
  SecACLRef entry = NULL;
  OSStatus status = SecACLCreateWithSimpleContents(access, NULL, (__bridge CFStringRef)hexData(xml),
    (SecKeychainPromptSelector)0, &entry);
  if (!status) status = SecACLUpdateAuthorizations(entry, (__bridge CFArrayRef)@[(__bridge id)kSecACLAuthorizationPartitionID]);
  if (entry) CFRelease(entry);
  return status;
}

static OSStatus addRestrictedPassword(SecKeychainRef keychain, UInt32 serviceLength, const char *service,
    UInt32 accountLength, const char *account, UInt32 length, const void *password, SecKeychainItemRef *item) {
  if (!authenticatedPartition) return errSecAuthFailed;
  SecAccessRef access = NULL;
  SecTrustedApplicationRef application = NULL;
  CFArrayRef entries = NULL;
  OSStatus status = SecAccessCreate(CFSTR("VoxCue Credential Storage"), NULL, &access);
  if (!status) status = SecTrustedApplicationCreateFromPath(NULL, &application);
  if (!status) status = SecAccessCopyACLList(access, &entries);
  NSArray *applications = application ? @[(__bridge id)application] : @[];
  for (CFIndex index = 0; !status && index < CFArrayGetCount(entries); ++index) {
    SecACLRef entry = (SecACLRef)CFArrayGetValueAtIndex(entries, index);
    CFArrayRef previous = NULL; CFStringRef description = NULL; SecKeychainPromptSelector prompt;
    status = SecACLCopyContents(entry, &previous, &description, &prompt);
    if (!status) status = SecACLSetContents(entry, (__bridge CFArrayRef)applications, description, prompt);
    if (previous) CFRelease(previous); if (description) CFRelease(description);
  }
  if (!status) status = addPartition(access, authenticatedPartition);
  SecKeychainAttribute attributes[] = {
    {kSecServiceItemAttr, serviceLength, (void *)service}, {kSecAccountItemAttr, accountLength, (void *)account}
  };
  SecKeychainAttributeList list{2, attributes};
  if (!status) status = SecKeychainItemCreateFromContent(kSecGenericPasswordItemClass, &list,
    length, password, keychain, access, item);
  if (entries) CFRelease(entries);
  if (application) CFRelease(application);
  if (access) CFRelease(access);
  return status;
}

// Updating both the trusted application list and the partition is necessary:
// leaving the old CDHash in either trust layer retains the old executable path.
// The owner may need to approve this change through the standard Keychain UI.
static OSStatus restrictedAccess(SecKeychainItemRef item, NSString *partition, SecAccessRef *result) {
  SecAccessRef access = NULL;
  SecTrustedApplicationRef application = NULL;
  CFArrayRef entries = NULL;
  OSStatus status = SecKeychainItemCopyAccess(item, &access);
  if (!status) status = SecTrustedApplicationCreateFromPath(NULL, &application);
  if (!status) status = SecAccessCopyACLList(access, &entries);
  NSArray *applications = application ? @[(__bridge id)application] : @[];
  NSData *xml = [NSPropertyListSerialization dataWithPropertyList:@{@"Partitions":@[partition]}
    format:NSPropertyListXMLFormat_v1_0 options:0 error:nil];
  CFDataRef trustedData = NULL;
  if (!status) status = SecTrustedApplicationCopyData(application, &trustedData);
  bool foundPartition = false, changed = false;
  if (!xml) status = errSecAllocate;
  for (CFIndex index = 0; !status && index < CFArrayGetCount(entries); ++index) {
    SecACLRef entry = (SecACLRef)CFArrayGetValueAtIndex(entries, index);
    NSArray *tags = CFBridgingRelease(SecACLCopyAuthorizations(entry));
    if (!tags) { status = errSecInvalidItemRef; break; }
    const bool isPartition = [tags containsObject:(__bridge id)kSecACLAuthorizationPartitionID];
    CFArrayRef previous = NULL; CFStringRef description = NULL;
    SecKeychainPromptSelector prompt = (SecKeychainPromptSelector)0;
    status = SecACLCopyContents(entry, &previous, &description, &prompt);
    if (!status && isPartition) changed |= ![(__bridge NSString *)description isEqualToString:hexData(xml)];
    else if (!status) {
      CFDataRef previousData = NULL;
      const bool single = previous && CFArrayGetCount(previous) == 1;
      if (single) status = SecTrustedApplicationCopyData((SecTrustedApplicationRef)CFArrayGetValueAtIndex(previous, 0), &previousData);
      changed |= !single || !previousData || !CFEqual(previousData, trustedData);
      if (previousData) CFRelease(previousData);
    }
    if (!status) status = SecACLSetContents(entry, isPartition ? previous : (__bridge CFArrayRef)applications,
      isPartition ? (__bridge CFStringRef)hexData(xml) : description, prompt);
    if (previous) CFRelease(previous);
    if (description) CFRelease(description);
    foundPartition |= isPartition;
  }
  if (!status && !foundPartition) { status = addPartition(access, partition); changed = true; }
  if (trustedData) CFRelease(trustedData);
  if (entries) CFRelease(entries);
  if (application) CFRelease(application);
  if (!status && changed) *result = access;
  else if (access) CFRelease(access);
  return status;
}

static OSStatus migrateAccess(CFTypeRef keychains, NSString *partition) {
  const char *services[] = {"VoxCue Credential Storage", "VoxCue Safe Storage", "VoxCue Safe Storage"};
  const char *accounts[] = {"VoxCue Key", "VoxCue Key", "VoxCue"};
  NSMutableArray *items = [NSMutableArray array], *accesses = [NSMutableArray array];
  NSMutableArray<NSMutableData *> *passwords = [NSMutableArray array];
  OSStatus status = errSecSuccess;
  @try {
    // Inspect every known alias before changing anything. Denial, a locked item
    // or inconsistent passwords fails closed, without importing/generating a key.
    for (size_t index = 0; index < 3; ++index) {
      SecKeychainAttribute attributes[] = {
        {kSecServiceItemAttr, (UInt32)strlen(services[index]), (void *)services[index]},
        {kSecAccountItemAttr, (UInt32)strlen(accounts[index]), (void *)accounts[index]}
      };
      SecKeychainAttributeList list{2, attributes};
      SecKeychainSearchRef search = NULL;
      status = SecKeychainSearchCreateFromAttributes(keychains, kSecGenericPasswordItemClass, &list, &search);
      if (status) return status;
      id ownedSearch = CFBridgingRelease(search);
      while (true) {
        SecKeychainItemRef item = NULL;
        status = SecKeychainSearchCopyNext((__bridge SecKeychainSearchRef)ownedSearch, &item);
        if (status == errSecItemNotFound) { status = errSecSuccess; break; }
        if (status) return status;
        [items addObject:CFBridgingRelease(item)];
        if (items.count > 32) return errSecDataTooLarge;
        UInt32 length = 0; void *bytes = NULL;
        status = SecKeychainItemCopyContent(item, NULL, NULL, &length, &bytes);
        if (status) return status;
        NSMutableData *password = [NSMutableData dataWithBytes:bytes length:length];
        if (bytes) { wipe(bytes, length); SecKeychainItemFreeContent(NULL, bytes); }
        [passwords addObject:password];
        if (!length || ![password isEqualToData:passwords.firstObject]) return errSecDecode;
      }
    }
    for (id item in items) {
      SecAccessRef access = NULL;
      status = restrictedAccess((__bridge SecKeychainItemRef)item, partition, &access);
      if (status) return status;
      [accesses addObject:access ? CFBridgingRelease(access) : NSNull.null];
    }
    for (NSUInteger index = 0; index < items.count; ++index) {
      if (accesses[index] == NSNull.null) continue;
#ifdef VOXCUE_CREDENTIAL_FIXTURE
      if ((int)index == failACLAt) return errSecAuthFailed;
#endif
      status = SecKeychainItemSetAccess((__bridge SecKeychainItemRef)items[index], (__bridge SecAccessRef)accesses[index]);
      if (status) return status;
    }
    return errSecSuccess;
  } @finally {
    for (NSMutableData *password in passwords) wipe(password.mutableBytes, password.length);
  }
}

int main(int argc, const char **argv) {
  @autoreleasepool {
    NSDictionary *identity = authenticatedSelf();
    if (!identity) return 77;
    NSData *hash = identity[(__bridge id)kSecCodeInfoUnique];
    if (![hash isKindOfClass:NSData.class] || hash.length != 20) return 77;
    authenticatedPartition = [@"cdhash:" stringByAppendingString:hexData(hash)];
    SecKeychainRef keychain = NULL;
    CFTypeRef migrationKeychains = NULL;
#ifdef VOXCUE_CREDENTIAL_FIXTURE
    if ((argc != 2 && argc != 3) || SecKeychainOpen(argv[1], &keychain)) return 78;
    migrationKeychains = keychain;
    __attribute__((objc_precise_lifetime)) NSArray *temporaryKeychains = nil;
    if (argc == 3) {
      SecKeychainRef additional = NULL;
      if (SecKeychainOpen(argv[2], &additional)) { CFRelease(keychain); return 78; }
      temporaryKeychains = @[(__bridge id)keychain, CFBridgingRelease(additional)];
      migrationKeychains = (__bridge CFArrayRef)temporaryKeychains;
    }
    SecKeychainSetUserInteractionAllowed(false);
    const char *failAt = getenv("VOXCUE_CREDENTIAL_FAIL_ACL_AT");
    if (failAt) failACLAt = atoi(failAt);
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
    if (![value isKindOfClass:NSDictionary.class] || [value count] != 2 ||
      ![value[@"data"] isKindOfClass:NSString.class] ||
      !([value[@"operation"] isEqual:@"encrypt"] || [value[@"operation"] isEqual:@"decrypt"])) return 79;
    const bool encrypt = [value[@"operation"] isEqual:@"encrypt"];
    NSData *input = [[NSData alloc] initWithBase64EncodedString:value[@"data"] options:0];
    if (!input) return 79;
    OSStatus status = errSecDecode;
    NSData *output = nil;
    if (encrypt || (input.length >= 19 && memcmp(input.bytes, "v10", 3) == 0)) {
      status = migrateAccess(migrationKeychains, authenticatedPartition);
      if (!status) output = crypt(input, encrypt, keychain, &status);
    }
    if (keychain) CFRelease(keychain);
    if (!output) { fprintf(stderr, "VoxCue credential operation failed (%d).\n", (int)status); return 80; }
    NSData *reply = [NSJSONSerialization dataWithJSONObject:@{@"data":[output base64EncodedStringWithOptions:0]} options:0 error:nil];
    const uint8_t *bytes = (const uint8_t *)reply.bytes; size_t left = reply.length;
    while (left) { ssize_t written = write(STDOUT_FILENO, bytes, left); if (written <= 0) return 81; bytes += written; left -= written; }
    return 0;
  }
}
