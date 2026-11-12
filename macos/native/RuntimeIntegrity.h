#pragma once
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <mach-o/dyld.h>
#include <limits.h>
#include <stdlib.h>

// Both the browser entry and the pre-MLX verifier use the same pinned resource
// check. This authenticates the complete sealed bundle, not an adjacent manifest.
static NSString *runtimeBundle(bool verifier) {
  char path[PATH_MAX], resolved[PATH_MAX];
  uint32_t size = sizeof(path);
  if (_NSGetExecutablePath(path, &size) || !realpath(path, resolved)) return nil;
  NSString *file = [NSString stringWithUTF8String:resolved];
  NSString *suffix = verifier ? @"/Contents/Resources/native/VoxCue.Integrity"
                              : @"/Contents/MacOS/VoxCue";
  if (![file hasSuffix:suffix]) return nil;
  NSString *bundle = [file substringToIndex:file.length - suffix.length];
  return [bundle.pathExtension isEqualToString:@"app"] ? bundle : nil;
}

static bool verifyRuntimeBundle(NSString *bundle) {
  if (!bundle) return false;
  SecStaticCodeRef code = nullptr;
  SecRequirementRef requirement = nullptr;
  NSString *rule = @"identifier \"com.voxcue.app\" and certificate root = H\"" VOXCUE_SIGNING_SHA1 @"\"";
  OSStatus status = SecRequirementCreateWithString((__bridge CFStringRef)rule,
                                                   kSecCSDefaultFlags, &requirement);
  if (status == errSecSuccess)
    status = SecStaticCodeCreateWithPath((__bridge CFURLRef)[NSURL fileURLWithPath:bundle],
                                         kSecCSDefaultFlags, &code);
  if (status == errSecSuccess)
    status = SecStaticCodeCheckValidity(code,
      kSecCSCheckAllArchitectures | kSecCSCheckNestedCode | kSecCSStrictValidate,
      requirement);
  if (code) CFRelease(code);
  if (requirement) CFRelease(requirement);
  return status == errSecSuccess;
}
