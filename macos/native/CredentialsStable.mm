// Preserve the frozen predecessors. Security.framework owns the integrity seal;
// it is not an application trust list and must never be rewritten as one.
#import <Foundation/Foundation.h>
#import <Security/Security.h>
static OSStatus copyCredentialPolicyACLs(SecAccessRef access, CFArrayRef *result) {
  CFArrayRef entries = NULL;
  OSStatus status = SecAccessCopyACLList(access, &entries);
  if (status) return status;
  NSMutableArray *policy = [NSMutableArray array];
  for (id value in (__bridge NSArray *)entries) {
    NSArray *tags = CFBridgingRelease(SecACLCopyAuthorizations((__bridge SecACLRef)value));
    if (!tags) { status = errSecInvalidItemRef; break; }
    if ([tags containsObject:(__bridge id)kSecACLAuthorizationIntegrity]) {
      // A mixed authorization is not a known system-only integrity record.
      if (tags.count != 1) { status = errSecInvalidItemRef; break; }
      continue;
    }
    [policy addObject:value];
  }
  CFRelease(entries);
  // The SecAccess itself retains its complete ACL, including the untouched seal.
  // Only enumeration for application-policy comparison/update is filtered.
  if (!status) *result = (CFArrayRef)CFBridgingRetain([policy copy]);
  return status;
}

#define SecAccessCopyACLList copyCredentialPolicyACLs
#ifndef VOXCUE_CREDENTIAL_CLEANUP_SOURCE
#define VOXCUE_CREDENTIAL_CLEANUP_SOURCE "CredentialsMigrating.mm"
#endif
#include VOXCUE_CREDENTIAL_CLEANUP_SOURCE
#undef SecAccessCopyACLList
