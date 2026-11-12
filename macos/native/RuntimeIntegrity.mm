#import "RuntimeIntegrity.h"
#include <stdio.h>
#include <limits.h>
#include <thread>
#include <unistd.h>

int main(int argc, char *argv[]) {
  @autoreleasepool {
    char *end = nullptr;
    long owner = argc == 2 ? strtol(argv[1], &end, 10) : 0;
    if (owner <= 1 || owner > INT_MAX || !end || *end || getppid() != owner) return 78;
    // Bound this load check and retire if the Rust owner disappears, including
    // the fork-to-exec interval before this main begins.
    std::thread([owner] {
      for (int i = 0; i < 1800; ++i) {
        usleep(100000);
        if (getppid() != owner) _exit(74);
      }
      _exit(75);
    }).detach();
    if (!verifyRuntimeBundle(runtimeBundle(true))) {
      fputs("VoxCue: MLX runtime integrity verification failed.\n", stderr);
      return 78;
    }
    return 0;
  }
}
