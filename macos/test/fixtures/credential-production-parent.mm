#include "credential-fixture-boundary.h"
// A formal-ID positive harness has no launcher interface: one fixed production
// binary, fixed invalid input and a compile-time argument scenario only.
int main(int argc, const char **) {
  @autoreleasepool {
    if (argc != 1 || !ownedFixtureRoot()) return 76;
    NSString *path = @VOXCUE_PRODUCTION_HELPER_PATH;
    struct stat info{}; char resolved[PATH_MAX];
    if (lstat(path.fileSystemRepresentation, &info) || !S_ISREG(info.st_mode) ||
        info.st_uid != getuid() || info.st_nlink != 1 || (info.st_mode & 022) ||
        !realpath(path.fileSystemRepresentation, resolved) || ![path isEqual:@(resolved)]) return 76;
    SecStaticCodeRef code = NULL; CFDictionaryRef information = NULL;
    OSStatus status = SecStaticCodeCreateWithPath((__bridge CFURLRef)[NSURL fileURLWithPath:path], 0, &code);
    if (!status) status = SecStaticCodeCheckValidity(code, kSecCSStrictValidate, NULL);
    if (!status) status = SecCodeCopySigningInformation(code, kSecCSSigningInformation, &information);
    if (code) CFRelease(code);
    if (status) return 76;
    NSDictionary *signing = CFBridgingRelease(information);
    NSData *hash = signing[(__bridge id)kSecCodeInfoUnique];
    NSMutableString *hex = [NSMutableString string];
    for (NSUInteger index = 0; index < hash.length; ++index)
      [hex appendFormat:@"%02x", ((const uint8_t *)hash.bytes)[index]];
    if (![hex isEqual:@VOXCUE_PRODUCTION_HELPER_HASH]) return 76;
    NSTask *task = [NSTask new];
    task.executableURL = [NSURL fileURLWithPath:path];
    task.arguments = VOXCUE_PRODUCTION_EXTRA_ARGUMENT ? @[@"must-not-be-opened.keychain-db"] : @[];
    task.environment = @{@"PATH":@"/usr/bin:/bin:/usr/sbin:/sbin"};
    NSPipe *input = [NSPipe pipe], *output = [NSPipe pipe], *error = [NSPipe pipe];
    task.standardInput = input; task.standardOutput = output; task.standardError = error;
    if (![task launchAndReturnError:nil]) return 75;
    // No inherited stdin, selectable request or arbitrary child argument.
    if (!VOXCUE_PRODUCTION_EXTRA_ARGUMENT) {
#ifdef VOXCUE_PRODUCTION_REQUEST_LANGUAGE
      [input.fileHandleForWriting writeData:[@"{\"operation\":\"decrypt\",\"data\":\"AAAA\",\"language\":\"en\"}" dataUsingEncoding:NSUTF8StringEncoding]];
#else
      [input.fileHandleForWriting writeData:[@"{\"operation\":\"decrypt\",\"data\":\"AAAA\"}" dataUsingEncoding:NSUTF8StringEncoding]];
#endif
    }
    [input.fileHandleForWriting closeFile];
    [task waitUntilExit];
    NSData *reply = [output.fileHandleForReading readDataToEndOfFile];
    NSData *diagnostic = [error.fileHandleForReading readDataToEndOfFile];
    if (reply.length || diagnostic.length > 512) return 74;
    return task.terminationStatus;
  }
}
