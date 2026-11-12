#include "../../native/AudioSamples.h"
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

using namespace voxcue::audio;
static size_t cases = 0;
static void check(bool condition, const char *message) {
    if (!condition) throw std::runtime_error(message);
}
static void near(float actual, float expected) {
    check(std::abs(actual - expected) <= 0.000001f, "Unexpected converted sample");
}
struct Fixture {
    AudioStreamBasicDescription format{};
    std::vector<uint8_t> list;
    std::vector<std::vector<uint8_t>> data;
    size_t frames;
    AudioBufferList *buffers() { return reinterpret_cast<AudioBufferList *>(list.data()); }
    Fixture(size_t channels, bool planar, UInt32 bits = 32, bool floating = true, size_t count = 3)
        : list(offsetof(AudioBufferList, mBuffers) + (planar ? channels : 1) * sizeof(AudioBuffer)),
          data(planar ? channels : 1), frames(count) {
        format.mFormatID = kAudioFormatLinearPCM;
        format.mFormatFlags = (floating ? kAudioFormatFlagIsFloat : kAudioFormatFlagIsSignedInteger) |
            kAudioFormatFlagIsPacked | (planar ? kAudioFormatFlagIsNonInterleaved : 0);
        format.mBitsPerChannel = bits; format.mChannelsPerFrame = UInt32(channels);
        format.mSampleRate = 48000;
        format.mBytesPerFrame = UInt32(bits / 8 * (planar ? 1 : channels));
        buffers()->mNumberBuffers = UInt32(data.size());
        for (size_t index = 0; index < data.size(); ++index) {
            const size_t bufferChannels = planar ? 1 : channels;
            data[index].resize(frames * bufferChannels * bits / 8);
            buffers()->mBuffers[index] = {UInt32(bufferChannels), UInt32(data[index].size()), data[index].data()};
        }
    }
    void set(size_t frame, size_t channel, double value) {
        const bool planar = format.mFormatFlags & kAudioFormatFlagIsNonInterleaved;
        const size_t buffer = planar ? channel : 0;
        const size_t offset = planar ? frame : frame * format.mChannelsPerFrame + channel;
        auto *destination = data[buffer].data() + offset * format.mBitsPerChannel / 8;
        if (format.mFormatFlags & kAudioFormatFlagIsFloat) {
            if (format.mBitsPerChannel == 32) { const float sample = float(value); memcpy(destination, &sample, 4); }
            else memcpy(destination, &value, 8);
        } else if (format.mBitsPerChannel == 16) {
            const int16_t sample = int16_t(value); memcpy(destination, &sample, 2);
        } else { const int32_t sample = int32_t(value); memcpy(destination, &sample, 4); }
    }
    void expect(const std::vector<float> &expected, const OutputRoute *route = nullptr) {
        const auto shape = inspectBuffers(buffers(), format, 8192);
        check(shape.valid && shape.frames == expected.size(), "Unexpected frame shape");
        // Production packets put Float32 data at byte 21; retain unaligned writes.
        std::vector<uint8_t> output(shape.frames * sizeof(float) + 2, 0xa7);
        check(route ? writeSelectedMono(buffers(), format, shape, *route, output.data() + 1)
                    : writeMono(buffers(), format, shape, output.data() + 1), "Conversion rejected valid PCM");
        check(output.front() == 0xa7 && output.back() == 0xa7, "Conversion exceeded destination");
        for (size_t frame = 0; frame < shape.frames; ++frame) {
            float actual; memcpy(&actual, output.data() + 1 + frame * 4, 4);
            near(actual, expected[frame]);
        }
        ++cases;
    }
};
int main() {
    try {
        for (bool planar : {false, true}) for (size_t channels : {2, 8, 16}) {
            for (size_t pair = 0; pair < channels; pair += 2) {
                Fixture f(channels, planar);
                for (size_t channel : {pair, pair + 1}) {
                    f.set(0, channel, .5); f.set(1, channel, -.75); f.set(2, channel, .25);
                }
                f.expect({float(1. / channels), float(-1.5 / channels), float(.5 / channels)});
            }
            Fixture all(channels, planar), silent(channels, planar), opposite(channels, planar);
            for (size_t channel = 0; channel < channels; ++channel) {
                all.set(0, channel, .5); all.set(1, channel, -1); all.set(2, channel, 1.25);
                for (size_t frame = 0; frame < 3; ++frame) opposite.set(frame, channel, channel % 2 ? -1 : 1);
            }
            all.expect({.5, -1, 1.25}); silent.expect({0, 0, 0}); opposite.expect({0, 0, 0});
            for (UInt32 bits : {16, 32}) {
                Fixture integer(channels, planar, bits, false);
                const double scale = bits == 16 ? 32768. : 2147483648.;
                for (size_t channel = 0; channel < channels; ++channel) {
                    integer.set(0, channel, -scale); integer.set(1, channel, scale - 1); integer.set(2, channel, scale / 4);
                }
                integer.expect({-1, float((scale - 1) / scale), .25});
            }
            Fixture doublePrecision(channels, planar, 64);
            for (size_t channel = 0; channel < channels; ++channel) {
                doublePrecision.set(0, channel, .125); doublePrecision.set(1, channel, -.5);
            }
            doublePrecision.expect({.125, -.5, 0});
        }
        for (double invalid : {std::numeric_limits<double>::quiet_NaN(),
                               std::numeric_limits<double>::infinity(),
                               -std::numeric_limits<double>::infinity()}) {
            Fixture f(16, true, 64); f.set(1, 15, invalid);
            const auto shape = inspectBuffers(f.buffers(), f.format, 8192);
            uint8_t output[12];
            check(!writeMono(f.buffers(), f.format, shape, output), "Non-finite PCM accepted");
            ++cases;
        }
        Fixture uneven(2, true);
        uneven.buffers()->mBuffers[1].mDataByteSize = 8;
        uneven.expect({0, 0});
        Fixture oversized(2, false, 32, true, 8193);
        check(!inspectBuffers(oversized.buffers(), oversized.format, 8192).valid, "Oversized packet accepted"); ++cases;
        Fixture maximum(16, true, 32, true, 8192);
        maximum.set(8191, 15, 1);
        std::vector<float> expected(8192); expected.back() = 1.f / 16;
        maximum.expect(expected);
        Fixture absent(2, true);
        absent.buffers()->mBuffers[0].mData = nullptr;
        absent.buffers()->mBuffers[1].mNumberChannels = 0;
        check(inspectBuffers(absent.buffers(), absent.format, 8192).frames == 0, "Absent PCM produced frames"); ++cases;
        check(inspectBuffers(nullptr, absent.format, 8192).frames == 0, "Null input produced frames"); ++cases;
        for (bool planar : {false, true}) for (uint32_t channels : {2, 8, 16}) {
            const OutputStream stream{1, channels};
            for (uint32_t pair = 0; pair < channels; pair += 2) {
                const std::array<uint32_t, 2> preferred{pair + 1, pair + 2};
                const auto route = outputRoute(&stream, 1, &preferred);
                check(route && route.stream == 0 && route.selected[0] == pair && route.selected[1] == pair + 1, "Preferred pair mapping failed");
                Fixture selected(channels, planar);
                for (auto channel : {pair, pair + 1}) {
                    selected.set(0, channel, .5); selected.set(1, channel, -.75); selected.set(2, channel, 1.25);
                }
                selected.expect({.5, -.75, 1.25}, &route);
            }
        }
        const OutputStream unordered[] = {{17, 2}, {1, 16}};
        const std::array<uint32_t, 2> lowPair{1, 2}, highPair{17, 18}, crossed{16, 17}, duplicate{5, 5}, zero{0, 1}, beyond{18, 19};
        auto first = outputRoute(unordered, 2, &highPair), second = outputRoute(unordered, 2, &lowPair);
        check(first && first.stream == 0 && first.selected[0] == 0, "HAL array stream index reordered"); ++cases;
        check(second && second.stream == 1 && second.selected[1] == 1, "Starting channel not translated to local offset"); ++cases;
        check(!outputRoute(unordered, 2, &crossed), "Cross-stream pair accepted"); ++cases;
        check(!outputRoute(unordered, 2, &zero) && !outputRoute(unordered, 2, &beyond), "Invalid preferred channel accepted"); ++cases;
        auto mono = outputRoute(unordered, 2, &duplicate);
        check(mono && mono.count == 1 && mono.selected[0] == 4, "Repeated preferred channel must be a mono selection"); ++cases;
        Fixture duplicateChannel(16, true);
        duplicateChannel.set(0, 4, .125); duplicateChannel.set(1, 4, -.5); duplicateChannel.set(2, 4, 1.25);
        duplicateChannel.expect({.125, -.5, 1.25}, &mono);
        const OutputStream monoStream{1, 1}, stereoStream{1, 2}, multiStream{1, 16}, invalidStart{0, 2}, invalidWidth{1, 0}, overflow{UINT32_MAX, 2};
        check(outputRoute(&monoStream, 1, nullptr).count == 1 && outputRoute(&stereoStream, 1, nullptr).count == 2, "Missing mono/stereo preference fallback failed"); ++cases;
        check(!outputRoute(&multiStream, 1, nullptr) && !outputRoute(unordered, 2, nullptr), "Missing multichannel preference was guessed"); ++cases;
        check(!outputRoute(&invalidStart, 1, &lowPair) && !outputRoute(&invalidWidth, 1, &lowPair) && !outputRoute(&overflow, 1, &lowPair), "Invalid stream metadata accepted"); ++cases;
        const OutputStream overlap[] = {{1, 16}, {16, 2}};
        check(!outputRoute(overlap, 2, &lowPair) && !outputRoute(nullptr, 0, &lowPair) && !outputRoute(&stereoStream, 257, &lowPair), "Overlapping or oversized stream list accepted"); ++cases;
        Fixture nullBefore(16, true);
        nullBefore.buffers()->mBuffers[0].mData = nullptr;
        const std::array<uint32_t, 2> lastPair{15, 16};
        auto last = outputRoute(&multiStream, 1, &lastPair);
        for (bool planar : {false, true}) {
            Fixture selectedInteger(16, planar, 16, false), selectedDouble(16, planar, 64);
            for (auto channel : {14, 15}) {
                selectedInteger.set(0, channel, -32768); selectedInteger.set(1, channel, 32767); selectedInteger.set(2, channel, 8192);
                selectedDouble.set(0, channel, .125); selectedDouble.set(1, channel, -.5); selectedDouble.set(2, channel, 1.25);
            }
            selectedInteger.expect({-1, 32767.f / 32768, .25}, &last);
            selectedDouble.expect({.125, -.5, 1.25}, &last);
        }
        nullBefore.set(0, 14, .5); nullBefore.set(0, 15, .5);
        nullBefore.expect({.5, 0, 0}, &last);
        uint8_t selectedOutput[12];
        auto selectedShape = inspectBuffers(nullBefore.buffers(), nullBefore.format, 8192);
        auto missing = outputRoute(&multiStream, 1, &lowPair);
        check(!writeSelectedMono(nullBefore.buffers(), nullBefore.format, selectedShape, missing, selectedOutput), "Null selected channel was remapped to a neighbor"); ++cases;
        auto wrongFormat = nullBefore.format; wrongFormat.mChannelsPerFrame = 2;
        check(!writeSelectedMono(nullBefore.buffers(), wrongFormat, selectedShape, last, selectedOutput), "Unexpected tap channel count accepted"); ++cases;
        nullBefore.set(1, 15, std::numeric_limits<double>::quiet_NaN());
        check(!writeSelectedMono(nullBefore.buffers(), nullBefore.format, selectedShape, last, selectedOutput), "Non-finite selected PCM accepted"); ++cases;
        const std::vector<OutputStream> snapshot{{1, 16, 41}, {17, 2, 52}};
        const auto matches = [&](const std::vector<OutputStream> &after, const std::array<uint32_t, 2> *preference) {
            return sameOutputMetadata(snapshot.data(), snapshot.size(), &lowPair,
                                      after.data(), after.size(), preference);
        };
        check(matches(snapshot, &lowPair), "Unchanged output snapshot rejected"); ++cases;
        const std::array<uint32_t, 2> changedPair{7, 8};
        check(!matches(snapshot, &changedPair), "Preferred pair changed before listener registration was accepted"); ++cases;
        check(!matches(snapshot, nullptr), "Preferred property disappearance was accepted"); ++cases;
        check(!sameOutputMetadata(snapshot.data(), snapshot.size(), nullptr, snapshot.data(), snapshot.size(), &lowPair),
              "Preferred property appearance was accepted"); ++cases;
        check(sameOutputMetadata(snapshot.data(), snapshot.size(), nullptr, snapshot.data(), snapshot.size(), nullptr),
              "Unchanged missing preference rejected"); ++cases;
        for (size_t field = 0; field < 3; ++field) {
            auto changed = snapshot;
            if (field == 0) changed[0].identity++;
            if (field == 1) changed[0].startingChannel++;
            if (field == 2) changed[0].channels--;
            check(!matches(changed, &lowPair), "Output stream changed before listener registration was accepted"); ++cases;
        }
        auto replaced = snapshot;
        std::swap(replaced[0].identity, replaced[1].identity);
        const auto beforeRoute = outputRoute(snapshot.data(), snapshot.size(), &lowPair);
        const auto afterRoute = outputRoute(replaced.data(), replaced.size(), &lowPair);
        check(beforeRoute.stream == afterRoute.stream && beforeRoute.channels == afterRoute.channels &&
              !matches(replaced, &lowPair), "An equal route concealed replacement stream identities"); ++cases;
        std::swap(replaced[0], replaced[1]);
        check(!matches(replaced, &lowPair), "HAL stream reorder was accepted"); ++cases;
        replaced = snapshot; replaced.pop_back();
        check(!matches(replaced, &lowPair), "Output stream removal was accepted"); ++cases;
        std::vector<OutputStream> maximumMetadata(256);
        for (size_t index = 0; index < maximumMetadata.size(); ++index)
            maximumMetadata[index] = {uint32_t(index * 2 + 1), 2, uint32_t(index + 1)};
        auto maximumCopy = maximumMetadata;
        check(sameOutputMetadata(maximumMetadata.data(), 256, &lowPair, maximumCopy.data(), 256, &lowPair),
              "Maximum bounded metadata snapshot rejected"); ++cases;
        maximumCopy.back().identity++;
        check(!sameOutputMetadata(maximumMetadata.data(), 256, &lowPair, maximumCopy.data(), 256, &lowPair),
              "Last bounded stream replacement was ignored"); ++cases;
        check(!sameOutputMetadata(snapshot.data(), 257, &lowPair, snapshot.data(), 257, &lowPair) &&
              !sameOutputMetadata(nullptr, 0, nullptr, nullptr, 0, nullptr) &&
              !sameOutputMetadata(nullptr, 2, &lowPair, snapshot.data(), 2, &lowPair),
              "Invalid metadata snapshot bounds accepted"); ++cases;
        std::cout << "PASS: " << cases << " native PCM conversion cases; actual production conversion, 2/8/16 channels, "
                  << "interleaved/planar, every stereo pair, silence, phase cancellation, Float32/64, Int16/32, "
                  << "finite amplitude, NaN/Infinity, buffer and frame bounds. No device or permission access.\n";
        std::cout << "PASS: production preferred-channel mapper preserves HAL stream index, translates startingChannel, rejects cross-stream/invalid/unknown multi-channel layouts; selected 2/8/16ch keeps stereo amplitude, null buffers retain positions. Microphone all-channel average remains unchanged.\n";
        std::cout << "PASS: production metadata recheck detects preferred-property changes, stream replacement/order/shape and count changes across listener registration, even when the computed route remains equal.\n";
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n'; return 1;
    }
}
