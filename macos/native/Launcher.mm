#import <AppKit/AppKit.h>
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
        NSArray *required = @[@"package.json", @"dist/index.html", @"dist-electron/shared/electron/main.js", @"native/bin/VoxCue.Audio", @"native/bin/VoxCue.ScreenPermission.node", @"native/bin/VoxCue.SidebarGlass.node", @"public/voxcue.png"];
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
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        [NSApp activateIgnoringOtherApps:YES];
        NSAlert *alert = [[NSAlert alloc] init];
        alert.messageText = @"VoxCue 暂时无法启动";
        alert.informativeText = @"请保留此快捷方式在 macos 文件夹内，并先在项目根目录运行 corepack pnpm build。快捷方式不会自动编译或下载依赖。";
        [alert addButtonWithTitle:@"好"]; [alert runModal];
        return 1;
    }
}
