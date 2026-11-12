#import "RuntimeIntegrity.h"
#include <dlfcn.h>
#include <fcntl.h>
#include <stdio.h>
#include <string>
#include <vector>
#include <unistd.h>

extern char **environ;
static void removeInjectedEnvironment() {
  std::vector<std::string> names;
  for (char **entry = environ; entry && *entry; ++entry) {
    std::string name(*entry); name = name.substr(0, name.find('='));
    if (name.rfind("DYLD_", 0) == 0 || name.rfind("LD_", 0) == 0 ||
        name.rfind("NODE_", 0) == 0 || name == "ELECTRON_RUN_AS_NODE" ||
        name == "ELECTRON_NO_ASAR" || name == "ELECTRON_OVERRIDE_DIST_PATH")
      names.push_back(name);
  }
  // Fuses protect Electron itself. Remove the same ambient injection inputs
  // before it can inherit them into the fixed legacy helper or bundled SDKs.
  for (const auto &name : names) unsetenv(name.c_str());
}

static bool debugArgument(const char *argument) {
  std::string name(argument);
  if (name.empty() || name.front() != '-') return false;
  name.erase(0, name.find_first_not_of('-'));
  name = name.substr(0, name.find('='));
  for (char &c : name) if (c >= 'A' && c <= 'Z') c += 'a' - 'A';
  return name.rfind("remote-debugging", 0) == 0 || name.rfind("inspect", 0) == 0 ||
         name == "auto-open-devtools-for-tabs" || name == "type";
}

int main(int argc, char *argv[]) {
  // Launch Services may leave standard descriptors closed. Do not give later
  // native modules one of the reserved descriptor numbers.
  for (int fd = 0; fd < 3; ++fd) {
    if (fcntl(fd, F_GETFD) == -1) {
      int source = open("/dev/null", fd ? O_WRONLY : O_RDONLY);
      if (source < 0) return 70;
      if (source != fd) { dup2(source, fd); close(source); }
    }
  }
  for (int i = 1; i < argc; ++i) {
    if (debugArgument(argv[i])) {
      fputs("VoxCue: production debugging arguments are disabled.\n", stderr);
      return 64;
    }
  }
  removeInjectedEnvironment();
  @autoreleasepool {
    NSString *bundle = runtimeBundle(false);
    if (!verifyRuntimeBundle(bundle)) {
      fputs("VoxCue: application integrity verification failed.\n", stderr);
      return 78;
    }
    NSString *framework = [bundle stringByAppendingPathComponent:
      @"Contents/Frameworks/Electron Framework.framework/Electron Framework"];
    void *library = dlopen(framework.fileSystemRepresentation, RTLD_NOW | RTLD_GLOBAL);
    auto entry = library ? reinterpret_cast<int (*)(int, char **)>(dlsym(library, "ElectronMain")) : nullptr;
    if (!entry) {
      fputs("VoxCue: the signed Electron runtime could not be loaded.\n", stderr);
      return 70;
    }
    return entry(argc, argv);
  }
}
