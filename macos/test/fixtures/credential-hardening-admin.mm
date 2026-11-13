#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <Security/cssmapple.h>
#include "credential-fixture-boundary.h"
static const char *fixturePassword = "synthetic-keychain-password";
static const char *services[] = {"VoxCue Credential Storage", "VoxCue Safe Storage", "VoxCue Safe Storage"};
static const char *accounts[] = {"VoxCue Key", "VoxCue Key", "VoxCue"};
#ifndef VOXCUE_FIXTURE_VAULT_ACCOUNT
#define VOXCUE_FIXTURE_VAULT_ACCOUNT "VoxCue Key v6"
#endif
static NSString *hex(NSData *data) {
  NSMutableString *text = [NSMutableString string];
  for (NSUInteger index = 0; index < data.length; ++index) [text appendFormat:@"%02x", ((const uint8_t *)data.bytes)[index]];
  return text;
}
static NSArray *partitions(NSString *description) {
  if (description.length % 2) return nil;
  NSMutableData *data = [NSMutableData data];
  for (NSUInteger index = 0; index < description.length; index += 2) {
    unsigned int value = 0;
    if (![[NSScanner scannerWithString:[description substringWithRange:NSMakeRange(index, 2)]] scanHexInt:&value]) return nil;
    uint8_t byte = uint8_t(value); [data appendBytes:&byte length:1];
  }
  return [NSPropertyListSerialization propertyListWithData:data options:0 format:nil error:nil][@"Partitions"];
}
int main(int argc, const char **argv) {
  @autoreleasepool {
    if (argc < 3) return 76;
    NSString *mode = @(argv[1]);
    const bool create = [mode isEqual:@"create"], seed = [mode isEqual:@"seed"];
    const bool vault = [mode isEqual:@"vault"], plant = [mode isEqual:@"plant"];
    if (!(create || seed || vault || plant || [mode isEqual:@"inspect"] || [mode isEqual:@"delete"] ||
          [mode isEqual:@"unrelated"]) ||
        argc != (seed ? 6 : 3) || !ownedFixtureKeychain(argv[2], create)) return 76;
    if (seed && (strcmp(argv[3], VOXCUE_FIXTURE_LEGACY_PATH) ||
        strcmp(argv[4], VOXCUE_FIXTURE_HARDENED_PATH) ||
        !pinnedFixtureHelper(argv[3]) || !pinnedFixtureHelper(argv[4]) ||
        ![@[@"normal", @"different", @"denied", @"partial", @"no-partition", @"cross",
            @"legacy-only", @"current-only"] containsObject:@(argv[5])])) return 76;
    SecKeychainSetUserInteractionAllowed(false);
    SecKeychainRef keychain = NULL;
    OSStatus status = [mode isEqual:@"create"]
      ? SecKeychainCreate(argv[2], (UInt32)strlen(fixturePassword), fixturePassword, false, NULL, &keychain)
      : SecKeychainOpen(argv[2], &keychain);
    if (status) { fprintf(stderr, "Keychain fixture open/create: %d\n", (int)status); return 2; }
    if ([mode isEqual:@"delete"]) { status = SecKeychainDelete(keychain); CFRelease(keychain); return status ? 3 : 0; }
    if ([mode isEqual:@"create"]) { CFRelease(keychain); return 0; }
    if ([mode isEqual:@"unrelated"]) {
      status = SecKeychainFindGenericPassword(keychain, 19, "VoxCue Safe Storage", 9, "Unrelated",
        NULL, NULL, NULL);
      CFRelease(keychain); return status ? 12 : 0;
    }
    if (plant || vault) {
      // The v6 own entry: plant a same-name foreign entry, or report its
      // application rules and whether this unrelated tool can read it.
      const char *service = "VoxCue Credential Storage", *account = VOXCUE_FIXTURE_VAULT_ACCOUNT;
      if (plant) {
        status = SecKeychainAddGenericPassword(keychain, (UInt32)strlen(service), service,
          (UInt32)strlen(account), account, 17, "synthetic-planted", NULL);
        CFRelease(keychain); return status ? 14 : 0;
      }
      SecKeychainItemRef item = NULL;
      status = SecKeychainFindGenericPassword(keychain, (UInt32)strlen(service), service,
        (UInt32)strlen(account), account, NULL, NULL, &item);
      if (status == errSecItemNotFound) { fputs("null", stdout); CFRelease(keychain); return 0; }
      if (status) return 15;
      SecAccessRef access = NULL; CFArrayRef entries = NULL;
      status = SecKeychainItemCopyAccess(item, &access);
      if (!status) status = SecAccessCopyACLList(access, &entries);
      NSMutableArray *rules = [NSMutableArray array];
      for (CFIndex n = 0; !status && n < CFArrayGetCount(entries); ++n) {
        SecACLRef entry = (SecACLRef)CFArrayGetValueAtIndex(entries, n);
        NSArray *tags = CFBridgingRelease(SecACLCopyAuthorizations(entry));
        CFArrayRef apps = NULL; CFStringRef description = NULL; SecKeychainPromptSelector prompt;
        status = SecACLCopyContents(entry, &apps, &description, &prompt);
        if (!status) [rules addObject:@{@"tags":tags, @"applications":@(apps ? CFArrayGetCount(apps) : -1),
          @"description":description ? (__bridge NSString *)description : @""}];
        if (apps) CFRelease(apps); if (description) CFRelease(description);
      }
      UInt32 length = 0; void *data = NULL;
      const OSStatus read = SecKeychainItemCopyContent(item, NULL, NULL, &length, &data);
      if (data) SecKeychainItemFreeContent(NULL, data);
      if (entries) CFRelease(entries); if (access) CFRelease(access); CFRelease(item);
      if (status) return 16;
      NSData *json = [NSJSONSerialization dataWithJSONObject:@{@"rules":rules, @"readable":@(read == errSecSuccess)}
        options:0 error:nil];
      fwrite(json.bytes, 1, json.length, stdout);
      CFRelease(keychain);
      return 0;
    }
    if ([mode isEqual:@"seed"]) {
      if (argc != 6) return 4;
      status = SecKeychainUnlock(keychain, (UInt32)strlen(fixturePassword), fixturePassword, true);
      if (status) { fprintf(stderr, "Fixture unlock: %d\n", (int)status); return 4; }
      NSArray *paths = @[@(argv[3]), @(argv[4]), NSBundle.mainBundle.executablePath];
      NSMutableArray *applications = [NSMutableArray array], *ids = [NSMutableArray array];
      for (NSString *path in paths) {
        SecTrustedApplicationRef application = NULL;
        status = SecTrustedApplicationCreateFromPath(path.fileSystemRepresentation, &application);
        if (status) return 5;
        [applications addObject:CFBridgingRelease(application)];
        SecStaticCodeRef code = NULL; CFDictionaryRef information = NULL;
        status = SecStaticCodeCreateWithPath((__bridge CFURLRef)[NSURL fileURLWithPath:path], 0, &code);
        if (!status) status = SecCodeCopySigningInformation(code, kSecCSSigningInformation, &information);
        if (code) CFRelease(code);
        if (status) return 6;
        NSDictionary *info = CFBridgingRelease(information);
        [ids addObject:[@"cdhash:" stringByAppendingString:hex(info[(__bridge id)kSecCodeInfoUnique])]];
      }
      const bool denied = strcmp(argv[5], "denied") == 0;
      if (denied) { [applications removeObjectAtIndex:1]; [ids removeObjectAtIndex:1]; }
      NSData *xml = [NSPropertyListSerialization dataWithPropertyList:@{@"Partitions":ids} format:NSPropertyListXMLFormat_v1_0 options:0 error:nil];
      for (size_t index = 0; index < 3; ++index) {
        if ((index == 0 && strcmp(argv[5], "legacy-only") == 0) ||
            (index > 0 && strcmp(argv[5], "current-only") == 0)) continue;
        const char *value = index == 2 && strcmp(argv[5], "different") == 0
          ? "synthetic-different-password" : "synthetic-safe-storage-password";
        SecAccessRef access = NULL; CFArrayRef entries = NULL;
        status = SecAccessCreate(CFSTR("Synthetic migration authorization"), (__bridge CFArrayRef)applications, &access);
        if (!status) status = SecAccessCopyACLList(access, &entries);
        // Pre-authorize the migration in this newly created fixture. Production
        // never receives the Keychain password or changes its owner implicitly.
        for (CFIndex n = 0; !status && n < CFArrayGetCount(entries); ++n) {
          SecACLRef entry = (SecACLRef)CFArrayGetValueAtIndex(entries, n);
          CFArrayRef previous = NULL; CFStringRef description = NULL; SecKeychainPromptSelector prompt;
          status = SecACLCopyContents(entry, &previous, &description, &prompt);
          if (!status) status = SecACLSetContents(entry, (__bridge CFArrayRef)applications,
            description, (SecKeychainPromptSelector)0);
          if (previous) CFRelease(previous); if (description) CFRelease(description);
        }
        SecACLRef partition = NULL;
        if (!status && strcmp(argv[5], "no-partition") != 0) status = SecACLCreateWithSimpleContents(access, NULL,
          (__bridge CFStringRef)hex(xml), (SecKeychainPromptSelector)0, &partition);
        if (!status && partition) status = SecACLUpdateAuthorizations(partition,
          (__bridge CFArrayRef)@[(__bridge id)kSecACLAuthorizationPartitionID]);
        SecKeychainAttribute attributes[] = {
          {kSecServiceItemAttr, (UInt32)strlen(services[index]), (void *)services[index]},
          {kSecAccountItemAttr, (UInt32)strlen(accounts[index]), (void *)accounts[index]}
        };
        SecKeychainAttributeList attributeList{2, attributes};
        SecKeychainItemRef item = NULL;
        if (!status) status = SecKeychainItemCreateFromContent(kSecGenericPasswordItemClass,
          &attributeList, (UInt32)strlen(value), value, keychain, access, &item);
        if (item) CFRelease(item); if (partition) CFRelease(partition);
        if (entries) CFRelease(entries); if (access) CFRelease(access);
        if (status) { fprintf(stderr, "Seed authorized ACL: %d\n", (int)status); return 8; }
      }
      status = SecKeychainAddGenericPassword(keychain, 19, "VoxCue Safe Storage", 9, "Unrelated",
        15, "synthetic-other", NULL);
      if (status) return 13;
    } else if ([mode isEqual:@"inspect"]) {
      NSMutableArray *result = [NSMutableArray array];
      for (size_t index = 0; index < 3; ++index) {
        SecKeychainItemRef item = NULL;
        status = SecKeychainFindGenericPassword(keychain, (UInt32)strlen(services[index]), services[index],
          (UInt32)strlen(accounts[index]), accounts[index], NULL, NULL, &item);
        if (status == errSecItemNotFound) { [result addObject:NSNull.null]; continue; }
        if (status) return 9;
        SecAccessRef access = NULL; CFArrayRef entries = NULL;
        status = SecKeychainItemCopyAccess(item, &access);
        if (!status) status = SecAccessCopyACLList(access, &entries);
        CSSM_ACL_OWNER_PROTOTYPE_PTR owner = NULL;
        CSSM_ACL_ENTRY_INFO_PTR raw = NULL; uint32 count = 0;
        if (!status) status = SecAccessGetOwnerAndACL(access, &owner, &count, &raw);
        NSMutableArray *subjects = [NSMutableArray array];
        for (uint32 i = 0; !status && i < count; ++i) {
          auto &entry = raw[i].EntryPublicInfo;
          for (uint32 j = 0; j < entry.Authorization.NumberOfAuthTags; ++j)
            if (entry.Authorization.AuthTags[j] == CSSM_ACL_AUTHORIZATION_PARTITION_ID)
              [subjects addObject:@(entry.TypedSubject.Head ? entry.TypedSubject.Head->WordID : 0)];
        }
        NSUInteger subject = 0;
        NSMutableArray *rules = [NSMutableArray array];
        for (CFIndex n = 0; !status && n < CFArrayGetCount(entries); ++n) {
          SecACLRef entry = (SecACLRef)CFArrayGetValueAtIndex(entries, n);
          NSArray *tags = CFBridgingRelease(SecACLCopyAuthorizations(entry));
          CFArrayRef apps = NULL; CFStringRef description = NULL; SecKeychainPromptSelector prompt;
          status = SecACLCopyContents(entry, &apps, &description, &prompt);
          if (!status) [rules addObject:@{@"tags":tags, @"applications":@(apps ? CFArrayGetCount(apps) : -1),
            @"subject":[tags containsObject:(__bridge id)kSecACLAuthorizationPartitionID] && subject < subjects.count
              ? subjects[subject++] : @0,
            @"partitions":[tags containsObject:(__bridge id)kSecACLAuthorizationPartitionID] ? partitions((__bridge NSString *)description) ?: @[] : @[]}];
          if (apps) CFRelease(apps); if (description) CFRelease(description);
        }
        if (entries) CFRelease(entries); if (access) CFRelease(access); CFRelease(item);
        if (status) return 10;
        [result addObject:rules];
      }
      NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
      fwrite(json.bytes, 1, json.length, stdout);
    } else return 11;
    CFRelease(keychain);
    return 0;
  }
}
