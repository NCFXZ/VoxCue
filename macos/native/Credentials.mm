#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <CommonCrypto/CommonCryptor.h>
#import <CommonCrypto/CommonKeyDerivation.h>
#include <unistd.h>

static void wipe(void *memory, size_t length) {
  volatile uint8_t *bytes = (volatile uint8_t *)memory;
  while (length--) *bytes++ = 0;
}

// Standalone executable: never bind this code's signature to an app version or
// resource seal. A self-signed Keychain client's partition is its CDHash, not DR.
// The parent is authenticated before reading any request or accessing Keychain.
static bool trustedParent() {
  pid_t pid = getppid();
  NSDictionary *attributes = @{(__bridge id)kSecGuestAttributePid: @(pid)};
  SecCodeRef code = NULL;
  SecRequirementRef requirement = NULL;
  NSString *rule = @"(identifier \"com.voxcue.app\" or identifier \"com.voxcue.development\") and certificate root = H\"" VOXCUE_SIGNING_SHA1 "\"";
  OSStatus status = SecCodeCopyGuestWithAttributes(NULL, (__bridge CFDictionaryRef)attributes,
                                                  kSecCSDefaultFlags, &code);
  if (status == errSecSuccess)
    status = SecRequirementCreateWithString((__bridge CFStringRef)rule, kSecCSDefaultFlags, &requirement);
  if (status == errSecSuccess) status = SecCodeCheckValidity(code, kSecCSDefaultFlags, requirement);
  if (code) CFRelease(code);
  if (requirement) CFRelease(requirement);
  return status == errSecSuccess && pid == getppid();
}

static NSMutableData *findPassword(SecKeychainRef keychain, const char *service,
                                    const char *account, OSStatus *status) {
  UInt32 length = 0;
  void *bytes = NULL;
  *status = SecKeychainFindGenericPassword(keychain, (UInt32)strlen(service), service,
                                          (UInt32)strlen(account), account, &length, &bytes, NULL);
  if (*status != errSecSuccess) return nil;
  NSMutableData *password = [NSMutableData dataWithBytes:bytes length:length];
  if (bytes) { wipe(bytes, length); SecKeychainItemFreeContent(NULL, bytes); }
  return password;
}

static NSMutableData *passwordForOperation(SecKeychainRef keychain, bool encrypt, OSStatus *status) {
  const char *service = "VoxCue Credential Storage";
  const char *account = "VoxCue Key";
  NSMutableData *password = findPassword(keychain, service, account, status);
  if (password || *status != errSecItemNotFound) return password;

  // Import the same encryption password once. Preserve the existing Safe Storage
  // item, its ACL, and credentials.bin; never delete/recreate a user's old item.
  password = findPassword(keychain, "VoxCue Safe Storage", "VoxCue Key", status);
  if (!password && *status == errSecItemNotFound)
    password = findPassword(keychain, "VoxCue Safe Storage", "VoxCue", status);
  if (!password && *status == errSecItemNotFound && encrypt) {
    uint8_t random[16];
    *status = SecRandomCopyBytes(kSecRandomDefault, sizeof(random), random);
    if (*status == errSecSuccess) {
      NSData *data = [NSData dataWithBytes:random length:sizeof(random)];
      password = [[[data base64EncodedStringWithOptions:0] dataUsingEncoding:NSUTF8StringEncoding] mutableCopy];
    }
    wipe(random, sizeof(random));
  }
  if (!password) return nil; // Denial/locked/missing key never becomes a new key.
  *status = SecKeychainAddGenericPassword(keychain, (UInt32)strlen(service), service,
                                         (UInt32)strlen(account), account,
                                         (UInt32)password.length, password.bytes, NULL);
  if (*status == errSecDuplicateItem) {
    // Concurrent first launches must agree on the winner's password.
    wipe(password.mutableBytes, password.length);
    return findPassword(keychain, service, account, status);
  }
  if (*status != errSecSuccess) { wipe(password.mutableBytes, password.length); return nil; }
  return password;
}

static NSData *crypt(NSData *input, bool encrypt, SecKeychainRef keychain, OSStatus *status) {
  if (!encrypt && (input.length < 19 || memcmp(input.bytes, "v10", 3) != 0)) {
    *status = errSecDecode; return nil;
  }
  NSMutableData *password = passwordForOperation(keychain, encrypt, status);
  if (!password || !password.length) return nil;
  uint8_t key[16], iv[16];
  memset(iv, ' ', sizeof(iv));
  int derived = CCKeyDerivationPBKDF(kCCPBKDF2, (const char *)password.bytes, password.length,
                                     (const uint8_t *)"saltysalt", 9, kCCPRFHmacAlgSHA1, 1003,
                                     key, sizeof(key));
  wipe(password.mutableBytes, password.length);
  if (derived != kCCSuccess) { *status = errSecInternalComponent; return nil; }
  NSData *payload = encrypt ? input : [input subdataWithRange:NSMakeRange(3, input.length - 3)];
  NSMutableData *output = [NSMutableData dataWithLength:payload.length + kCCBlockSizeAES128];
  size_t size = 0;
  CCCryptorStatus result = CCCrypt(encrypt ? kCCEncrypt : kCCDecrypt, kCCAlgorithmAES,
                                    kCCOptionPKCS7Padding, key, sizeof(key), iv,
                                    payload.bytes, payload.length, output.mutableBytes, output.length, &size);
  wipe(key, sizeof(key));
  if (result != kCCSuccess) { *status = errSecDecode; return nil; }
  output.length = size;
  if (!encrypt) return output;
  NSMutableData *cipher = [NSMutableData dataWithBytes:"v10" length:3];
  [cipher appendData:output];
  return cipher;
}

int main(int argc, const char **argv) {
  @autoreleasepool {
    if (!trustedParent()) return 77;
    SecKeychainRef keychain = NULL;
#ifdef VOXCUE_CREDENTIAL_FIXTURE
    // This branch is compiled only into a disposable synthetic-keychain fixture.
    if (argc != 2 || SecKeychainOpen(argv[1], &keychain) != errSecSuccess) return 78;
    SecKeychainSetUserInteractionAllowed(false);
#else
    if (argc != 1) return 78;
#endif
    // Bounded stdin/stdout pipes only: no token, password, or file path in argv,
    // environment, diagnostics, temporary files, or a renderer-facing API.
    NSMutableData *request = [NSMutableData data];
    uint8_t chunk[4096];
    ssize_t count;
    while ((count = read(STDIN_FILENO, chunk, sizeof(chunk))) > 0) {
      if (request.length + count > 1024 * 1024) return 79;
      [request appendBytes:chunk length:(NSUInteger)count];
    }
    if (count < 0) return 79;
    id json = [NSJSONSerialization JSONObjectWithData:request options:0 error:nil];
    if (![json isKindOfClass:NSDictionary.class] || [json count] != 2 ||
        ![json[@"data"] isKindOfClass:NSString.class] ||
        !([json[@"operation"] isEqual:@"encrypt"] || [json[@"operation"] isEqual:@"decrypt"])) return 79;
    NSData *input = [[NSData alloc] initWithBase64EncodedString:json[@"data"] options:0];
    if (!input) return 79;
    OSStatus status = errSecSuccess;
    NSData *output = crypt(input, [json[@"operation"] isEqual:@"encrypt"], keychain, &status);
    if (keychain) CFRelease(keychain);
    if (!output) {
      fprintf(stderr, "VoxCue credential operation failed (%d).\n", (int)status);
      return 80;
    }
    NSData *reply = [NSJSONSerialization dataWithJSONObject:@{@"data": [output base64EncodedStringWithOptions:0]}
                                                  options:0 error:nil];
    const uint8_t *bytes = (const uint8_t *)reply.bytes;
    size_t left = reply.length;
    while (left) {
      ssize_t written = write(STDOUT_FILENO, bytes, left);
      if (written <= 0) return 81;
      bytes += written; left -= written;
    }
    return 0;
  }
}
