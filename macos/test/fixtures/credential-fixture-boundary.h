#pragma once
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <sys/stat.h>
#include <unistd.h>
#include <limits.h>
#include <cstring>
#include <cerrno>

#ifndef VOXCUE_FIXTURE_ROOT
#error A credential fixture must be bound to one owned temporary root
#endif
static bool ownedFixtureRoot() {
  struct stat info{}; char resolved[PATH_MAX];
  return lstat(VOXCUE_FIXTURE_ROOT, &info) == 0 && S_ISDIR(info.st_mode) &&
    info.st_uid == getuid() && (info.st_mode & 077) == 0 &&
    realpath(VOXCUE_FIXTURE_ROOT, resolved) && strcmp(resolved, VOXCUE_FIXTURE_ROOT) == 0;
}
static bool ownedFixtureFile(NSString *path) {
  if (!ownedFixtureRoot() || !path || ![path.stringByDeletingLastPathComponent isEqual:@VOXCUE_FIXTURE_ROOT]) return false;
  struct stat info{}; char resolved[PATH_MAX];
  return lstat(path.fileSystemRepresentation, &info) == 0 && S_ISREG(info.st_mode) &&
    info.st_uid == getuid() && info.st_nlink == 1 && !(info.st_mode & 022) &&
    realpath(path.fileSystemRepresentation, resolved) && [path isEqual:@(resolved)];
}
static bool ownedFixtureKeychain(const char *value, bool creating = false) {
  NSString *path = value ? @(value) : nil;
  if (!ownedFixtureRoot() || !path || ![path.stringByDeletingLastPathComponent isEqual:@VOXCUE_FIXTURE_ROOT]) return false;
  NSArray *names = @[@"normal.keychain-db", @"different.keychain-db", @"denied.keychain-db",
    @"fresh.keychain-db", @"partial.keychain-db", @"no-partition.keychain-db", @"cross.keychain-db",
    @"cross-secondary.keychain-db", @"guard.keychain-db", @"symlink.keychain-db", @"synthetic.keychain-db"];
  if (![names containsObject:path.lastPathComponent]) return false;
  struct stat info{};
  if (creating) return lstat(value, &info) != 0 && errno == ENOENT;
  return ownedFixtureFile(path);
}
static OSStatus openFixtureKeychain(const char *value, SecKeychainRef *keychain) {
  if (!ownedFixtureKeychain(value)) return errSecParam;
  return SecKeychainOpen(value, keychain);
}

#ifdef VOXCUE_FIXTURE_HELPERS
static bool pinnedFixtureHelper(const char *value) {
  NSString *path = value ? @(value) : nil;
  NSDictionary *pins = VOXCUE_FIXTURE_HELPERS;
  NSString *expected = path ? pins[path] : nil;
  if (!expected || !ownedFixtureFile(path)) return false;
  SecStaticCodeRef code = NULL; CFDictionaryRef information = NULL;
  OSStatus status = SecStaticCodeCreateWithPath((__bridge CFURLRef)[NSURL fileURLWithPath:path], 0, &code);
  if (!status) status = SecStaticCodeCheckValidity(code, kSecCSStrictValidate, NULL);
  if (!status) status = SecCodeCopySigningInformation(code, kSecCSSigningInformation, &information);
  if (code) CFRelease(code);
  if (status) return false;
  NSDictionary *info = CFBridgingRelease(information);
  NSData *hash = info[(__bridge id)kSecCodeInfoUnique];
  if (![hash isKindOfClass:NSData.class]) return false;
  NSMutableString *hex = [NSMutableString string];
  for (NSUInteger index = 0; index < hash.length; ++index)
    [hex appendFormat:@"%02x", ((const uint8_t *)hash.bytes)[index]];
  return [expected isEqualToString:hex];
}
#endif
