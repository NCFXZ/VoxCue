// Test target only: consume the unmodified production Capture implementation in
// the process that owns a private aggregate. Private devices cannot be selected
// by a different helper process; this is source integration, not formal-binary
// permission acceptance, and this target is never included in an application.
#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/CATapDescription.h>
#import <CoreAudio/AudioHardwareTapping.h>
static AudioObjectID ownedCaptureTapAggregate = 0;
static NSInteger observedTapStream = -1;
static NSString *observedTapDevice;
static OSStatus observeCaptureAggregate(CFDictionaryRef description, AudioObjectID *created) {
    OSStatus status = AudioHardwareCreateAggregateDevice(description, created);
    if (!status) ownedCaptureTapAggregate = *created;
    return status;
}
static OSStatus observeCaptureTap(CATapDescription *description, AudioObjectID *created) {
    observedTapStream = description.stream.integerValue;
    observedTapDevice = [description.deviceUID copy];
    return AudioHardwareCreateProcessTap(description, created);
}
#define AudioHardwareCreateAggregateDevice observeCaptureAggregate
#define AudioHardwareCreateProcessTap observeCaptureTap
#define main VoxCueStandaloneAudioMain
#include "../../native/AudioCapture.mm"
#undef main
#undef AudioHardwareCreateAggregateDevice
#undef AudioHardwareCreateProcessTap
#include "virtual-audio-guest.h"

struct OwnedVirtualAggregate {
    AudioObjectID id = 0;
    ~OwnedVirtualAggregate() { if (id) AudioHardwareDestroyAggregateDevice(id); }
};
struct OwnedVirtualOutput {
    AudioObjectID device = 0;
    AudioDeviceIOProcID io = nullptr;
    dispatch_queue_t queue = dispatch_queue_create("com.voxcue.test.stream-output", DISPATCH_QUEUE_SERIAL);
    void stop() {
        if (!io) return;
        AudioDeviceStop(device, io); AudioDeviceDestroyIOProcID(device, io);
        dispatch_sync(queue, ^{}); io = nullptr;
    }
    ~OwnedVirtualOutput() { stop(); }
};
static NSArray *privateTapFormats() {
    AudioStreamBasicDescription format{};
    if (!ownedCaptureTapAggregate || property(ownedCaptureTapAggregate, address(kAudioDevicePropertyStreamFormat, kAudioObjectPropertyScopeInput), format)) return @[];
    return @[@{@"channels":@(format.mChannelsPerFrame), @"sampleRate":@(format.mSampleRate), @"bits":@(format.mBitsPerChannel), @"nonInterleaved":@((format.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0)}];
}
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSDictionary *context = virtualAudioGuestContext();
        if (!context) { fprintf(stderr, "Disposable guest context required before audio access.\n"); return 64; }
        if (argc != 2 || ![@[@"silence", @"first", @"second", @"both", @"preferred-second", @"change-preferred", @"direct16"] containsObject:@(argv[1])]) return 64;
        NSString *mode = @(argv[1]);
        const bool changePreferred = [mode isEqualToString:@"change-preferred"], direct = [mode isEqualToString:@"direct16"];
        const bool first = [mode isEqualToString:@"first"] || [mode isEqualToString:@"both"] || [mode isEqualToString:@"preferred-second"] || changePreferred;
        const bool second = [mode isEqualToString:@"second"] || [mode isEqualToString:@"both"] || [mode isEqualToString:@"preferred-second"] || changePreferred || direct;
        AudioObjectID two = selectedDevice(false, @"BlackHole2ch_UID"), sixteen = selectedDevice(false, @"BlackHole16ch_UID");
        if (!two || !sixteen) { json(NSFileHandle.fileHandleWithStandardError, @{@"pending":@"virtual-subdevice-unavailable"}); return 2; }
        Float64 rate = 0, otherRate = 0;
        if (property(two, address(kAudioDevicePropertyNominalSampleRate), rate) || property(sixteen, address(kAudioDevicePropertyNominalSampleRate), otherRate) || rate != otherRate || rate < 8000 || rate > 192000) return 2;
        NSString *ownedUID = [NSString stringWithFormat:@"com.voxcue.test.virtual-audio.%u.%@.%@", getuid(), context[@"nonce"], NSUUID.UUID.UUIDString];
        NSDictionary *configuration = @{
            @kAudioAggregateDeviceNameKey:@"VoxCue synthetic multi-stream output",
            @kAudioAggregateDeviceUIDKey:ownedUID,
            @kAudioAggregateDeviceIsPrivateKey:@YES,
            @kAudioAggregateDeviceIsStackedKey:@NO,
            @kAudioAggregateDeviceMainSubDeviceKey:@"BlackHole2ch_UID",
            @kAudioAggregateDeviceSubDeviceListKey:@[
                @{@kAudioSubDeviceUIDKey:@"BlackHole2ch_UID", @kAudioSubDeviceDriftCompensationKey:@NO},
                @{@kAudioSubDeviceUIDKey:@"BlackHole16ch_UID", @kAudioSubDeviceDriftCompensationKey:@YES}
            ]
        };
        OwnedVirtualAggregate aggregate;
        OSStatus status = direct ? noErr : AudioHardwareCreateAggregateDevice((__bridge CFDictionaryRef)configuration, &aggregate.id);
        if (status) return failure(@"fixture-aggregate-failed", status);
        const AudioObjectID device = direct ? sixteen : aggregate.id;
        if (direct) ownedUID = @"BlackHole16ch_UID";
        auto streamKey = address(kAudioDevicePropertyStreams, kAudioObjectPropertyScopeOutput);
        UInt32 bytes = 0;
        for (int attempt = 0; attempt < 20; ++attempt) {
            if (!AudioObjectGetPropertyDataSize(device, &streamKey, 0, nullptr, &bytes) && bytes >= (direct ? 1 : 2) * sizeof(AudioObjectID)) break;
            usleep(25000);
        }
        if (bytes < (direct ? 1 : 2) * sizeof(AudioObjectID) || bytes > 256) { json(NSFileHandle.fileHandleWithStandardError, @{@"pending":@"aggregate-does-not-expose-multiple-streams"}); return 2; }
        std::vector<AudioObjectID> streams(bytes / sizeof(AudioObjectID));
        if (AudioObjectGetPropertyData(device, &streamKey, 0, nullptr, &bytes, streams.data())) return 1;
        NSMutableArray *layout = [NSMutableArray array];
        UInt32 firstStart = 0, secondStart = 0, channels = 0;
        for (size_t index = 0; index < streams.size(); ++index) {
            AudioStreamBasicDescription format{}; UInt32 startingChannel = 0;
            if (property(streams[index], address(kAudioStreamPropertyVirtualFormat), format) || property(streams[index], address(kAudioStreamPropertyStartingChannel), startingChannel) || !startingChannel || format.mFormatID != kAudioFormatLinearPCM || !(format.mFormatFlags & kAudioFormatFlagIsFloat) || format.mBitsPerChannel != 32 || (format.mFormatFlags & kAudioFormatFlagIsBigEndian) || format.mSampleRate != rate) return 1;
            if (format.mChannelsPerFrame == 2) firstStart = startingChannel;
            else if (format.mChannelsPerFrame == 16) secondStart = startingChannel;
            else return 2;
            channels += format.mChannelsPerFrame;
            [layout addObject:@{@"index":@(index), @"startingChannel":@(startingChannel), @"channels":@(format.mChannelsPerFrame), @"sampleRate":@(rate)}];
        }
        if ((!direct && (!firstStart || channels != 18)) || !secondStart || (direct && channels != 16)) return 2;
        if (direct) firstStart = 17; // No two-channel substream in this direct case.
        auto preferredKey = address(kAudioDevicePropertyPreferredChannelsForStereo, kAudioObjectPropertyScopeOutput);
        std::array<UInt32, 2> preferred{};
        if (property(device, preferredKey, preferred)) return 2;
        if ([mode isEqualToString:@"preferred-second"] || changePreferred) {
            Boolean settable = false;
            if (AudioObjectIsPropertySettable(device, &preferredKey, &settable) || !settable) {
                json(NSFileHandle.fileHandleWithStandardError, @{@"pending":@"owned-aggregate-preferred-channels-not-settable", @"mode":mode}); return 2;
            }
            if (!changePreferred) {
                std::array<UInt32, 2> selected{secondStart, secondStart + 1}; UInt32 size = sizeof(selected);
                status = AudioObjectSetPropertyData(device, &preferredKey, 0, nullptr, size, selected.data());
                if (status || property(device, preferredKey, preferred) || preferred != selected) return failure(@"fixture-preference-set-failed", status);
            }
        }
        OwnedVirtualOutput output; output.device = device;
        __block uint64_t sequence = 0;
        std::atomic<bool> invalid{false}; auto *malformed = &invalid;
        status = AudioDeviceCreateIOProcIDWithBlock(&output.io, device, output.queue,
            ^(const AudioTimeStamp *, const AudioBufferList *, const AudioTimeStamp *, AudioBufferList *buffers, const AudioTimeStamp *) {
                if (!buffers) { *malformed = true; return; }
                UInt32 base = 1; size_t frames = 0;
                for (UInt32 b = 0; b < buffers->mNumberBuffers; ++b) {
                    auto &buffer = buffers->mBuffers[b];
                    if (!buffer.mData || !buffer.mNumberChannels || buffer.mNumberChannels > channels || base - 1 + buffer.mNumberChannels > channels || buffer.mDataByteSize % (4 * buffer.mNumberChannels)) { *malformed = true; return; }
                    size_t current = buffer.mDataByteSize / (4 * buffer.mNumberChannels);
                    if (current > 65536 || (frames && current != frames)) { *malformed = true; return; }
                    frames = current;
                    auto *samples = static_cast<float *>(buffer.mData);
                    for (size_t frame = 0; frame < frames; ++frame) {
                        const float a = first ? 0.2f * std::sin(2 * M_PI * 997 * (sequence + frame) / rate) : 0;
                        const float b = second ? 0.2f * std::sin(2 * M_PI * 1499 * (sequence + frame) / rate) : 0;
                        for (UInt32 c = 0; c < buffer.mNumberChannels; ++c) {
                            UInt32 channel = base + c;
                            samples[frame * buffer.mNumberChannels + c] = channel >= firstStart && channel < firstStart + 2 ? a : channel >= secondStart && channel < secondStart + 16 ? b : 0;
                        }
                    }
                    base += buffer.mNumberChannels;
                }
                if (base != channels + 1) *malformed = true;
                sequence += frames;
            });
        if (status) return failure(@"fixture-output-create-failed", status);
        if ((status = AudioDeviceStart(device, output.io))) return failure(@"fixture-output-start-failed", status);
        usleep(200000);
        json(NSFileHandle.fileHandleWithStandardError, @{@"type":@"fixture-started", @"uid":ownedUID, @"private":@(!direct), @"streams":layout, @"preferred":@[@(preferred[0]), @(preferred[1])], @"mode":mode, @"firstFrequency":@997, @"secondFrequency":@1499});
        Capture capture;
        if ((status = capture.initialize(false, ownedUID))) return failure(status == kAudioHardwareBadDeviceError ? @"device-unavailable" : @"initialize-failed", status);
        json(NSFileHandle.fileHandleWithStandardError, @{@"type":@"fixture-format", @"formats":privateTapFormats(), @"selectedStream":@(observedTapStream), @"captureDeviceUID":observedTapDevice ?: @""});
        if ((status = capture.start(true))) return failure(status == kAudioDevicePermissionsError ? @"permission-denied" : @"start-failed", status);
        json(NSFileHandle.fileHandleWithStandardError, @{@"type":@"started"});
        const auto began = std::chrono::steady_clock::now();
        bool changeApplied = false;
        auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(120);
        while (capture.healthy() && !invalid && std::chrono::steady_clock::now() < deadline) {
            if (changePreferred && !changeApplied && std::chrono::steady_clock::now() - began > std::chrono::seconds(1)) {
                std::array<UInt32, 2> selected{secondStart, secondStart + 1};
                status = AudioObjectSetPropertyData(device, &preferredKey, 0, nullptr, sizeof(selected), selected.data());
                changeApplied = !status && !property(device, preferredKey, preferred) && preferred == selected;
                json(NSFileHandle.fileHandleWithStandardError, @{@"type":@"fixture-route-change", @"applied":@(changeApplied), @"preferred":@[@(preferred[0]), @(preferred[1])]});
                if (!changeApplied) break;
            }
            pollfd input{STDIN_FILENO, POLLIN, 0};
            if (poll(&input, 1, 50) > 0 && (input.revents & (POLLIN|POLLHUP))) { char byte; if (read(STDIN_FILENO, &byte, 1) <= 0) break; }
        }
        const bool retiredByChange = changePreferred && changeApplied && !capture.healthy();
        bool healthy = capture.finish(); output.stop();
        json(NSFileHandle.fileHandleWithStandardError, @{@"type":@"fixture-stopped", @"healthy":@(healthy), @"malformed":@(invalid.load()), @"retiredByChange":@(retiredByChange)});
        return (changePreferred ? retiredByChange : healthy) && !invalid ? 0 : 1;
    }
}
