// v1/v2 remain immutable recovery identities. Reuse their authentication,
// restricted ACL migration and v10 crypto without re-signing either old binary.
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <Security/cssmapple.h>
#import <CommonCrypto/CommonCryptor.h>
#import <CommonCrypto/CommonKeyDerivation.h>
#include <unistd.h>
#ifndef VOXCUE_CREDENTIAL_FROZEN_SOURCE
#define VOXCUE_CREDENTIAL_FROZEN_SOURCE "CredentialsHardened.mm"
#endif
namespace frozenCredentials {
#include VOXCUE_CREDENTIAL_FROZEN_SOURCE
}

static NSDictionary *authenticatedCleanupSelf() {
  const pid_t parent = getppid();
  SecCodeRef code = NULL;
  OSStatus status = SecCodeCopyGuestWithAttributes(NULL,
    (__bridge CFDictionaryRef)@{(__bridge id)kSecGuestAttributePid:@(parent)}, kSecCSDefaultFlags, &code);
  bool accepted = !status && frozenCredentials::hardenedIdentity(code, @"com.voxcue.app");
  if (code) CFRelease(code);
  if (!accepted || parent != getppid()) return nil;
  code = NULL;
  status = SecCodeCopySelf(kSecCSDefaultFlags, &code);
  accepted = !status && frozenCredentials::hardenedIdentity(code, @"com.voxcue.credentials.migrating");
  NSDictionary *information = accepted ? frozenCredentials::signingInfo(code) : nil;
  NSDictionary *entitlements = information[(__bridge id)kSecCodeInfoEntitlementsDict];
  if (code) CFRelease(code);
  return accepted && !entitlements.count ? information : nil;
}

static OSStatus matchingItems(CFTypeRef keychains, const char *service, const char *account,
    NSMutableArray *items) {
  SecKeychainAttribute attributes[] = {
    {kSecServiceItemAttr, (UInt32)strlen(service), (void *)service},
    {kSecAccountItemAttr, (UInt32)strlen(account), (void *)account}
  };
  SecKeychainAttributeList list{2, attributes};
  SecKeychainSearchRef search = NULL;
  OSStatus status = SecKeychainSearchCreateFromAttributes(keychains, kSecGenericPasswordItemClass, &list, &search);
  if (status) return status;
  id ownedSearch = CFBridgingRelease(search);
  for (;;) {
    SecKeychainItemRef item = NULL;
    status = SecKeychainSearchCopyNext((__bridge SecKeychainSearchRef)ownedSearch, &item);
    if (status == errSecItemNotFound) return errSecSuccess;
    if (status) return status;
    [items addObject:CFBridgingRelease(item)];
    if (items.count > 32) return errSecDataTooLarge;
  }
}

static OSStatus itemAlias(SecKeychainItemRef item, bool legacy, NSString **account) {
  UInt32 tags[] = {kSecServiceItemAttr, kSecAccountItemAttr};
  UInt32 formats[] = {CSSM_DB_ATTRIBUTE_FORMAT_STRING, CSSM_DB_ATTRIBUTE_FORMAT_STRING};
  SecKeychainAttributeInfo info{2, tags, formats};
  SecKeychainAttributeList *attributes = NULL;
  SecItemClass kind = (SecItemClass)0;
  OSStatus status = SecKeychainItemCopyAttributesAndData(item, &info, &kind, &attributes, NULL, NULL);
  if (status) return status;
  if (!attributes) return errSecInvalidItemRef;
  NSString *service = nil, *name = nil;
  for (UInt32 index = 0; index < attributes->count; ++index) {
    SecKeychainAttribute value = attributes->attr[index];
    NSString *text = [[NSString alloc] initWithBytes:value.data length:value.length encoding:NSUTF8StringEncoding];
    if (value.tag == kSecServiceItemAttr) service = text;
    if (value.tag == kSecAccountItemAttr) name = text;
  }
  SecKeychainItemFreeAttributesAndData(attributes, NULL);
  const bool valid = kind == kSecGenericPasswordItemClass &&
    [service isEqualToString:legacy ? @"VoxCue Safe Storage" : @"VoxCue Credential Storage"] &&
    ([name isEqualToString:@"VoxCue Key"] || (legacy && [name isEqualToString:@"VoxCue"]));
  if (valid && account) *account = name;
  return valid ? errSecSuccess : errSecInvalidItemRef;
}

static OSStatus verifyItem(SecKeychainItemRef item, NSString *partition,
    NSMutableArray<NSMutableData *> *secrets, NSData *expected, bool legacy = false) {
  OSStatus status = itemAlias(item, legacy, NULL);
  if (status) return status;
  UInt32 length = 0; void *bytes = NULL;
  status = SecKeychainItemCopyContent(item, NULL, NULL, &length, &bytes);
  if (status) return status;
  NSMutableData *password = [NSMutableData dataWithBytes:bytes length:length];
  if (bytes) { frozenCredentials::wipe(bytes, length); SecKeychainItemFreeContent(NULL, bytes); }
  [secrets addObject:password];
  if (!length || (expected && ![password isEqualToData:expected])) return errSecDecode;
  SecAccessRef changed = NULL;
  status = frozenCredentials::restrictedAccess(item, partition, &changed);
  // Cleanup must never silently accept an item whose migration is incomplete.
  if (changed) { CFRelease(changed); if (!status) status = errSecAuthFailed; }
  return status;
}

static OSStatus removeMigratedAliases(CFTypeRef keychains, NSString *partition) {
  NSMutableArray *current = [NSMutableArray array], *legacy = [NSMutableArray array];
  NSMutableArray<NSMutableData *> *secrets = [NSMutableArray array];
  @try {
    OSStatus status = matchingItems(keychains, "VoxCue Credential Storage", "VoxCue Key", current);
    if (status) return status;
    if (!current.count) return errSecItemNotFound;
    for (id item in current) {
      status = verifyItem((__bridge SecKeychainItemRef)item, partition, secrets, secrets.firstObject);
      if (status) return status;
    }
    NSData *password = secrets.firstObject;
    status = matchingItems(keychains, "VoxCue Safe Storage", "VoxCue Key", legacy);
    if (!status) status = matchingItems(keychains, "VoxCue Safe Storage", "VoxCue", legacy);
    if (status || current.count + legacy.count > 32) return status ?: errSecDataTooLarge;
    // Validate every exact reference before deleting the first one. Inconsistent
    // keys, denied reads or incomplete ACLs leave all legacy entries untouched.
    for (id item in legacy) {
      status = verifyItem((__bridge SecKeychainItemRef)item, partition, secrets, password, true);
      if (status) return status;
    }
    for (NSUInteger index = 0; index < legacy.count; ++index) {
      // Reconfirm retained current items before each irreversible deletion.
      for (id retained in current) {
        status = verifyItem((__bridge SecKeychainItemRef)retained, partition, secrets, password);
        if (status) return status;
      }
#ifdef VOXCUE_CREDENTIAL_FIXTURE
      const char *failure = getenv("VOXCUE_CREDENTIAL_FAIL_DELETE_AT");
      if (failure && (int)index == atoi(failure)) return errSecAuthFailed;
#endif
      status = itemAlias((__bridge SecKeychainItemRef)legacy[index], true, NULL);
      if (status) return status;
      // Keep the classic Keychain ACL semantics: SecItemDelete may try to edit
      // the owner of these legacy items. Delete only the exact, revalidated
      // references; never issue a service/account wildcard deletion.
      status = SecKeychainItemDelete((__bridge SecKeychainItemRef)legacy[index]);
      if (status && status != errSecItemNotFound) return status;
    }
    return errSecSuccess;
  } @finally {
    for (NSMutableData *password in secrets) frozenCredentials::wipe(password.mutableBytes, password.length);
  }
}

int main(int argc, const char **argv) {
  @autoreleasepool {
    NSDictionary *identity = authenticatedCleanupSelf();
    if (!identity) return 77;
    NSData *hash = identity[(__bridge id)kSecCodeInfoUnique];
    if (![hash isKindOfClass:NSData.class] || hash.length != 20) return 77;
    NSString *partition = [@"cdhash:" stringByAppendingString:frozenCredentials::hexData(hash)];
    frozenCredentials::authenticatedPartition = partition;
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
    SecKeychainSetUserInteractionAllowed(false);
    const char *failure = getenv("VOXCUE_CREDENTIAL_FAIL_ACL_AT");
    if (failure) frozenCredentials::failACLAt = atoi(failure);
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
      status = frozenCredentials::migrateAccess(keychains, partition);
      if (!status) output = frozenCredentials::crypt(input, encrypt, keychain, &status);
      if (output) {
        NSData *roundtrip = frozenCredentials::crypt(output, !encrypt, keychain, &status);
        if (!roundtrip || ![roundtrip isEqualToData:input]) { status = errSecDecode; output = nil; }
      }
      if (output) {
        status = removeMigratedAliases(keychains, partition);
        if (status) output = nil;
      }
    }
    if (keychain) CFRelease(keychain);
    if (!output) { fprintf(stderr, "VoxCue credential operation failed (%d).\n", (int)status); return 80; }
    NSData *reply = [NSJSONSerialization dataWithJSONObject:@{@"data":[output base64EncodedStringWithOptions:0]} options:0 error:nil];
    const uint8_t *bytes = (const uint8_t *)reply.bytes; size_t left = reply.length;
    while (left) { ssize_t written = write(STDOUT_FILENO, bytes, left); if (written <= 0) return 81; bytes += written; left -= written; }
    return 0;
  }
}
