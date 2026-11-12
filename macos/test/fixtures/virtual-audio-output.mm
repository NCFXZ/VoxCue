#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
#include "virtual-audio-guest.h"
#include <unistd.h>
#include <poll.h>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <vector>

// This fixture writes only a fixed synthetic waveform to explicitly selected
// BlackHole outputs. It never reads an input buffer or changes a default device.
static void json(id value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    [NSFileHandle.fileHandleWithStandardOutput writeData:data];
    [NSFileHandle.fileHandleWithStandardOutput writeData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];
}
static AudioObjectPropertyAddress key(AudioObjectPropertySelector selector, AudioObjectPropertyScope scope = kAudioObjectPropertyScopeGlobal) {
    return {selector, scope, kAudioObjectPropertyElementMain};
}
template<class T> static OSStatus get(AudioObjectID device, AudioObjectPropertyAddress address, T &value) {
    UInt32 size = sizeof(T);
    return AudioObjectGetPropertyData(device, &address, 0, nullptr, &size, &value);
}
static NSString *uid(AudioObjectID device) {
    CFStringRef value = nullptr;
    if (get(device, key(kAudioDevicePropertyDeviceUID), value) || !value) return @"";
    return CFBridgingRelease(value);
}
static bool allowed(NSString *value) {
    return [value isEqualToString:@"BlackHole2ch_UID"] || [value isEqualToString:@"BlackHole16ch_UID"];
}
static std::vector<AudioObjectID> devices() {
    auto address = key(kAudioHardwarePropertyDevices); UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, nullptr, &size) || size > 4096) return {};
    std::vector<AudioObjectID> values(size / sizeof(AudioObjectID));
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr, &size, values.data())) return {};
    return values;
}
static NSArray *streams(AudioObjectID device) {
    auto address = key(kAudioDevicePropertyStreams, kAudioObjectPropertyScopeOutput); UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(device, &address, 0, nullptr, &size) || size > 4096) return nil;
    std::vector<AudioObjectID> values(size / sizeof(AudioObjectID));
    if (AudioObjectGetPropertyData(device, &address, 0, nullptr, &size, values.data())) return nil;
    NSMutableArray *result = [NSMutableArray array];
    for (auto stream : values) {
        AudioStreamBasicDescription format{}; UInt32 channel = 0;
        if (get(stream, key(kAudioStreamPropertyVirtualFormat), format) || get(stream, key(kAudioStreamPropertyStartingChannel), channel)) return nil;
        [result addObject:@{@"channels":@(format.mChannelsPerFrame), @"sampleRate":@(format.mSampleRate), @"startingChannel":@(channel)}];
    }
    return result;
}
static NSDictionary *channelPreferences(AudioObjectID device) {
    UInt32 stereo[2] = {0, 0};
    OSStatus status = get(device, key(kAudioDevicePropertyPreferredChannelsForStereo, kAudioObjectPropertyScopeOutput), stereo);
    NSMutableDictionary *result = [@{@"stereoStatus":@(status)} mutableCopy];
    if (!status) result[@"stereoChannels"] = @[@(stereo[0]), @(stereo[1])];
    auto address = key(kAudioDevicePropertyPreferredChannelLayout, kAudioObjectPropertyScopeOutput); UInt32 size = 0;
    status = AudioObjectGetPropertyDataSize(device, &address, 0, nullptr, &size);
    if (!status && size >= offsetof(AudioChannelLayout, mChannelDescriptions) && size <= 65536) {
        std::vector<uint8_t> bytes(size);
        status = AudioObjectGetPropertyData(device, &address, 0, nullptr, &size, bytes.data());
        auto *layout = reinterpret_cast<AudioChannelLayout *>(bytes.data());
        if (!status && layout->mNumberChannelDescriptions <= 256 && offsetof(AudioChannelLayout, mChannelDescriptions) + layout->mNumberChannelDescriptions * sizeof(AudioChannelDescription) <= size) {
            NSMutableArray *labels = [NSMutableArray array];
            for (UInt32 index = 0; index < layout->mNumberChannelDescriptions; ++index) [labels addObject:@(layout->mChannelDescriptions[index].mChannelLabel)];
            result[@"layout"] = @{@"tag":@(layout->mChannelLayoutTag), @"bitmap":@(layout->mChannelBitmap), @"labels":labels};
        }
    }
    result[@"layoutStatus"] = @(status);
    return result;
}
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (!virtualAudioGuestContext()) { fprintf(stderr, "Disposable guest context required before audio access.\n"); return 64; }
        const bool list = argc == 2 && !strcmp(argv[1], "--list");
        if (!list && (argc != 4 || strcmp(argv[1], "--output") || !allowed(@(argv[2])))) return 64;
        if (list) {
            NSMutableArray *result = [NSMutableArray array];
            for (auto device : devices()) {
                NSString *name = uid(device);
                if (!allowed(name)) continue;
                NSArray *layout = streams(device);
                if (layout) [result addObject:@{@"uid":name, @"streams":layout, @"preferences":channelPreferences(device)}];
            }
            json(result); return 0;
        }
        NSString *name = @(argv[2]), *mode = @(argv[3]);
        AudioObjectID selected = kAudioObjectUnknown;
        for (auto device : devices()) if ([uid(device) isEqualToString:name]) selected = device;
        if (!selected) { json(@{@"pending":@"whitelisted-virtual-device-unavailable"}); return 2; }
        AudioStreamBasicDescription format{};
        if (get(selected, key(kAudioDevicePropertyStreamFormat, kAudioObjectPropertyScopeOutput), format)) return 1;
        const UInt32 channels = [name isEqualToString:@"BlackHole2ch_UID"] ? 2 : 16;
        if (format.mFormatID != kAudioFormatLinearPCM || !(format.mFormatFlags & kAudioFormatFlagIsFloat) || (format.mFormatFlags & kAudioFormatFlagIsBigEndian) || format.mBitsPerChannel != 32 || format.mChannelsPerFrame != channels || format.mSampleRate < 8000 || format.mSampleRate > 192000) return 1;
        int pair = -1;
        if (![mode isEqualToString:@"silence"] && ![mode isEqualToString:@"all"]) {
            NSScanner *scanner = [NSScanner scannerWithString:mode];
            if (![scanner scanInt:&pair] || !scanner.isAtEnd || pair < 0 || pair + 1 >= channels || pair % 2) return 64;
        }
        const bool silent = [mode isEqualToString:@"silence"], all = [mode isEqualToString:@"all"];
        dispatch_queue_t queue = dispatch_queue_create("com.voxcue.test.virtual-tone", DISPATCH_QUEUE_SERIAL);
        AudioDeviceIOProcID io = nullptr;
        __block uint64_t sequence = 0;
        std::atomic<uint64_t> written{0};
        std::atomic<bool> malformed{false};
        auto *count = &written; auto *invalid = &malformed;
        OSStatus status = AudioDeviceCreateIOProcIDWithBlock(&io, selected, queue,
            ^(const AudioTimeStamp *, const AudioBufferList *, const AudioTimeStamp *, AudioBufferList *output, const AudioTimeStamp *) {
                if (!output || !output->mNumberBuffers) { *invalid = true; return; }
                UInt32 base = 0; size_t frames = 0;
                for (UInt32 b = 0; b < output->mNumberBuffers; ++b) {
                    auto &buffer = output->mBuffers[b];
                    if (!buffer.mData || !buffer.mNumberChannels || buffer.mNumberChannels > channels || base + buffer.mNumberChannels > channels || buffer.mDataByteSize % (4 * buffer.mNumberChannels)) { *invalid = true; return; }
                    size_t current = buffer.mDataByteSize / (4 * buffer.mNumberChannels);
                    if (current > 65536 || (frames && current != frames)) { *invalid = true; return; }
                    frames = current;
                    auto *samples = static_cast<float *>(buffer.mData);
                    for (size_t f = 0; f < frames; ++f) {
                        const float tone = silent ? 0 : 0.2f * std::sin(2 * M_PI * 997 * (sequence + f) / format.mSampleRate);
                        for (UInt32 c = 0; c < buffer.mNumberChannels; ++c) {
                            const UInt32 channel = base + c;
                            samples[f * buffer.mNumberChannels + c] = all || (int(channel) >= pair && int(channel) < pair + 2) ? tone : 0;
                        }
                    }
                    base += buffer.mNumberChannels;
                }
                if (base != channels) { *invalid = true; return; }
                sequence += frames; count->fetch_add(frames);
            });
        if (status) { json(@{@"error":@"create-output-failed", @"status":@(status)}); return 1; }
        status = AudioDeviceStart(selected, io);
        if (status) { AudioDeviceDestroyIOProcID(selected, io); json(@{@"error":@"start-output-failed", @"status":@(status)}); return 1; }
        json(@{@"started":@YES, @"uid":name, @"mode":mode, @"sampleRate":@(format.mSampleRate), @"channels":@(channels), @"frequency":@997, @"amplitude":@0.2});
        auto until = std::chrono::steady_clock::now() + std::chrono::seconds(120);
        while (!malformed && std::chrono::steady_clock::now() < until) {
            pollfd input{STDIN_FILENO, POLLIN, 0};
            if (poll(&input, 1, 50) > 0 && (input.revents & (POLLIN|POLLHUP))) { char byte; if (read(STDIN_FILENO, &byte, 1) <= 0) break; }
        }
        AudioDeviceStop(selected, io); AudioDeviceDestroyIOProcID(selected, io); dispatch_sync(queue, ^{});
        json(@{@"stopped":@YES, @"framesWritten":@(written.load()), @"malformed":@(malformed.load())});
        return malformed ? 1 : 0;
    }
}
