#import <Foundation/Foundation.h>
#include <cstdio>
#include <unistd.h>
#include <cstdlib>
#include <vector>
#include <cstring>

int main(int argc, char *argv[]) {
    @autoreleasepool {
        NSString *root = NSBundle.mainBundle.bundlePath.stringByDeletingLastPathComponent;
        NSString *runtime = [root stringByAppendingPathComponent:@".tools/electron-dev"];
        NSString *executable = [runtime stringByAppendingPathComponent:@"Electron.app/Contents/MacOS/Electron"];
        NSFileManager *files = NSFileManager.defaultManager;
        NSArray *required = @[@"package.json", @"dist/index.html", @"dist-electron/shared/electron/main.js", @"native/bin/VoxCue.Audio", @"native/bin/VoxCue.ScreenPermission.node", @"public/voxcue.png"];
        BOOL ready = [files isExecutableFileAtPath:executable];
        for (NSString *name in required) ready = ready && [files fileExistsAtPath:[root stringByAppendingPathComponent:name]];
        if (ready) {
            setenv("ELECTRON_OVERRIDE_DIST_PATH", runtime.fileSystemRepresentation, 1);
            chdir(root.fileSystemRepresentation);
            std::vector<char *> arguments{const_cast<char *>(executable.fileSystemRepresentation)};
            for (int i = 1; i < argc; ++i) if (strncmp(argv[i], "-psn_", 5) != 0) arguments.push_back(argv[i]);
            arguments.push_back(const_cast<char *>(root.fileSystemRepresentation)); arguments.push_back(nullptr);
            execv(executable.fileSystemRepresentation, arguments.data());
        }
        fprintf(stderr, "VoxCue: run corepack pnpm build before opening the development launcher.\n");
        return 1;
    }
}
