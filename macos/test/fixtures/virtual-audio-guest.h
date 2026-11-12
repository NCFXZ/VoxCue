#pragma once
#import <Foundation/Foundation.h>
#include <sys/sysctl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <limits.h>
#include <cstring>
#include <cstdlib>

// Native fail-closed companion to the runner's full UID/UUID/SIP attestation.
// Check before calling any Audio API, even when the fixture is invoked directly.
static NSDictionary *virtualAudioGuestContext() {
    int virtualized = 0; size_t size = sizeof(virtualized);
    if (sysctlbyname("kern.hv_vmm_present", &virtualized, &size, nullptr, 0) || virtualized != 1) return nil;
    const char *file = getenv("VOXCUE_TEST_GUEST_CONTEXT");
    if (!file) return nil;
    char resolved[PATH_MAX];
    if (!realpath(file, resolved) || strcmp(file, resolved)) return nil;
    NSString *root = [@(file) stringByDeletingLastPathComponent];
    struct stat info{}, directory{};
    if (lstat(file, &info) || !S_ISREG(info.st_mode) || info.st_uid != getuid() || info.st_nlink != 1 || (info.st_mode & 0777) != 0600 || info.st_size > 4096 || lstat(root.fileSystemRepresentation, &directory) || !S_ISDIR(directory.st_mode) || directory.st_uid != getuid() || (directory.st_mode & 0777) != 0700 || ![root.lastPathComponent hasPrefix:@"voxcue-macos-guest-"]) return nil;
    NSData *data = [NSData dataWithContentsOfFile:@(file)];
    if (!data) return nil;
    NSDictionary *value = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (![value isKindOfClass:NSDictionary.class] || [value[@"version"] intValue] != 1 || [value[@"guestUID"] unsignedIntValue] != getuid() || ![value[@"root"] isEqualToString:root] || ![value[@"nonce"] isKindOfClass:NSString.class] || [value[@"nonce"] length] != 32 || [value[@"nonce"] rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"abcdef0123456789"] invertedSet]].location != NSNotFound) return nil;
    return value;
}
