// Compile the shipping writer into this test process. Its stdout goes only to
// an owned pipe. No device is opened and no permission is queried.
#define main voxcue_capture_entry
#include "../../native/AudioCapture.mm"
#undef main
#include <cassert>
#include <memory>

int main(int argc, const char *argv[]) {
    assert(argc == 2);
    const bool stall = strcmp(argv[1], "stall") == 0;
    assert(stall || !strcmp(argv[1], "drain"));
    int pipefd[2];
    assert(pipe(pipefd) == 0);
    assert(dup2(pipefd[1], STDOUT_FILENO) >= 0);
    close(pipefd[1]);
    assert(fcntl(STDOUT_FILENO, F_SETFL, O_NONBLOCK) == 0);

    auto capture = std::make_unique<Capture>();
    capture->format.mFormatID = kAudioFormatLinearPCM;
    capture->format.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
    capture->format.mChannelsPerFrame = 1;
    capture->format.mBitsPerChannel = 32;
    capture->format.mBytesPerFrame = sizeof(float);
    capture->format.mSampleRate = 48000;
    mach_timebase_info(&capture->timebase);

    const std::vector<size_t> frames{8192, 7, 6000, 321};
    std::vector<uint8_t> received;
    std::thread reader;
    if (stall) {
        struct sigaction handler{};
        handler.sa_handler = [](int) {};
        sigemptyset(&handler.sa_mask);
        assert(sigaction(SIGUSR1, &handler, nullptr) == 0);
        std::array<uint8_t, 512> filler{};
        while (write(STDOUT_FILENO, filler.data(), filler.size()) > 0) {}
        assert(errno == EAGAIN);
    } else {
        reader = std::thread([&] {
            std::array<uint8_t, 513> piece;
            ssize_t n;
            while ((n = read(pipefd[0], piece.data(), piece.size())) > 0) {
                received.insert(received.end(), piece.begin(), piece.begin() + n);
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
            assert(n == 0);
        });
    }
    capture->writer = std::thread([&]{ capture->writePackets(); });
    for (size_t index = 0; index < frames.size(); ++index) {
        std::vector<float> samples(frames[index], float(index + 1) / 8);
        AudioBufferList input{};
        input.mNumberBuffers = 1;
        input.mBuffers[0] = {1, UInt32(samples.size() * sizeof(float)), samples.data()};
        capture->receive(&input, nullptr);
    }
    if (stall) {
        // Interrupt just the writer while its pipe has no space. The next poll should resume.
        for (int i = 0; i < 8; ++i) {
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
            if (!capture->healthy()) {
                fputs("The writer stopped after an interrupted poll.\n", stderr);
                return 2;
            }
            assert(pthread_kill(capture->writer.native_handle(), SIGUSR1) == 0);
        }
    }
    const auto start = std::chrono::steady_clock::now();
    assert(capture->finish() == !stall);
    assert(!capture->writer.joinable());
    const auto elapsed = std::chrono::steady_clock::now() - start;
    if (stall) assert(elapsed >= std::chrono::milliseconds(800) && elapsed < std::chrono::seconds(3));
    close(STDOUT_FILENO);
    if (reader.joinable()) reader.join();
    close(pipefd[0]);
    if (!stall) {
        size_t offset = 0;
        for (size_t index = 0; index < frames.size(); ++index) {
            const auto size = frames[index] * sizeof(float);
            assert(offset + size + 21 <= received.size());
            uint32_t length;
            memcpy(&length, received.data() + offset, 4);
            assert(length == size + 17 && received[offset + 4] == 1);
            for (size_t i = 0; i < frames[index]; ++i) {
                float sample;
                memcpy(&sample, received.data() + offset + 21 + i * sizeof(float), sizeof(float));
                assert(sample == float(index + 1) / 8);
            }
            offset += size + 21;
        }
        assert(offset == received.size());
    }
}
