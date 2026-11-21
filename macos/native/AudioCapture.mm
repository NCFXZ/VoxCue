#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/CATapDescription.h>
#import <CoreAudio/AudioHardwareTapping.h>
#include <mach/mach_time.h>
#include <poll.h>
#include <unistd.h>
#include <fcntl.h>
#include <signal.h>
#include <atomic>
#include <array>
#include <vector>
#include <mutex>
#include <condition_variable>
#include <thread>
#include <cmath>
#include <cstring>
#include <algorithm>
#include "AudioSamples.h"

// stdout contains bounded Float32 PCM packets only. Control/error JSON goes to
// stderr. No files, network, screen capture, output muting or device reconfiguration.
static void json(NSFileHandle *file, id value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    [file writeData:data]; [file writeData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];
}
static AudioObjectPropertyAddress address(AudioObjectPropertySelector selector,
                                          AudioObjectPropertyScope scope = kAudioObjectPropertyScopeGlobal) {
    return {selector, scope, kAudioObjectPropertyElementMain};
}
template<class T> static OSStatus property(AudioObjectID object, AudioObjectPropertyAddress key, T &value) {
    UInt32 size = sizeof(T);
    return AudioObjectGetPropertyData(object, &key, 0, nullptr, &size, &value);
}
static NSString *stringProperty(AudioObjectID object, AudioObjectPropertySelector selector) {
    CFStringRef value = nullptr;
    if (property(object, address(selector), value) != noErr || !value) return @"";
    return CFBridgingRelease(value);
}
static bool hasChannels(AudioObjectID device, AudioObjectPropertyScope scope) {
    auto key = address(kAudioDevicePropertyStreamConfiguration, scope); UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(device, &key, 0, nullptr, &size) != noErr || size < sizeof(AudioBufferList)) return false;
    std::vector<uint8_t> memory(size); auto *buffers = reinterpret_cast<AudioBufferList *>(memory.data());
    if (AudioObjectGetPropertyData(device, &key, 0, nullptr, &size, buffers) != noErr) return false;
    for (UInt32 i = 0; i < buffers->mNumberBuffers; ++i) if (buffers->mBuffers[i].mNumberChannels) return true;
    return false;
}
static AudioObjectID defaultDevice(bool microphone) {
    AudioObjectID result = kAudioObjectUnknown;
    property(kAudioObjectSystemObject, address(microphone ? kAudioHardwarePropertyDefaultInputDevice : kAudioHardwarePropertyDefaultOutputDevice), result);
    return result;
}
static NSArray *inventory() {
    auto key = address(kAudioHardwarePropertyDevices); UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &key, 0, nullptr, &size) != noErr) return nil;
    std::vector<AudioObjectID> devices(size / sizeof(AudioObjectID));
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &key, 0, nullptr, &size, devices.data()) != noErr) return nil;
    NSMutableArray *result = [NSMutableArray array];
    for (auto device : devices) {
        UInt32 alive = 0; property(device, address(kAudioDevicePropertyDeviceIsAlive), alive);
        if (!alive) continue;
        NSString *uid = stringProperty(device, kAudioDevicePropertyDeviceUID);
        NSString *name = stringProperty(device, kAudioObjectPropertyName);
        if (!uid.length) continue;
        for (bool microphone : {true, false}) if (hasChannels(device, microphone ? kAudioObjectPropertyScopeInput : kAudioObjectPropertyScopeOutput))
            [result addObject:@{@"id":uid, @"name":name, @"source":microphone ? @"microphone" : @"system", @"default":@(device == defaultDevice(microphone))}];
    }
    return result;
}
static AudioObjectID selectedDevice(bool microphone, NSString *uid) {
    if (!uid.length) return defaultDevice(microphone);
    auto key = address(kAudioHardwarePropertyDevices); UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &key, 0, nullptr, &size) != noErr) return kAudioObjectUnknown;
    std::vector<AudioObjectID> devices(size / sizeof(AudioObjectID));
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &key, 0, nullptr, &size, devices.data()) != noErr) return kAudioObjectUnknown;
    for (auto device : devices) if ([stringProperty(device, kAudioDevicePropertyDeviceUID) isEqualToString:uid]) return device;
    return kAudioObjectUnknown; // Never silently change an invalid selected device.
}
static bool microphoneAllowed() {
    auto status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
    if (status == AVAuthorizationStatusNotDetermined) {
        dispatch_semaphore_t wait = dispatch_semaphore_create(0);
        [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL granted) { dispatch_semaphore_signal(wait); }];
        if (dispatch_semaphore_wait(wait, dispatch_time(DISPATCH_TIME_NOW, 90 * NSEC_PER_SEC))) return false;
        status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
    }
    return status == AVAuthorizationStatusAuthorized;
}

class Capture {
    static constexpr size_t maxFrames = 8192, slots = 32;
    struct Packet { std::array<uint8_t, 21 + maxFrames * 4> bytes; size_t size = 0, frames = 0; };
    std::array<Packet, slots> packets;
    std::atomic<size_t> head{0}, tail{0}, queuedFrames{0};
    std::mutex wakeMutex; std::condition_variable changed;
    std::thread writer;
    std::atomic<bool> stopping{false}, failed{false}, routeChanged{false};
    bool finished = false;
    std::chrono::steady_clock::time_point stopAt;
    AudioObjectID device = 0, tap = 0, aggregate = 0;
    AudioDeviceIOProcID io = nullptr;
    AudioStreamBasicDescription format{};
    voxcue::audio::OutputRoute outputRoute{};
    dispatch_queue_t queue = dispatch_queue_create("com.voxcue.audio", DISPATCH_QUEUE_SERIAL);
    double previousEnd = -1;
    mach_timebase_info_data_t timebase{};
    struct Listener { AudioObjectID object; AudioObjectPropertyAddress key; };
    std::vector<Listener> listeners;
    static OSStatus deviceChanged(AudioObjectID, UInt32, const AudioObjectPropertyAddress *, void *context) {
        static_cast<Capture *>(context)->routeChanged = true; return noErr;
    }
    OSStatus listen(AudioObjectID object, AudioObjectPropertyAddress key) {
        OSStatus status = AudioObjectAddPropertyListener(object, &key, deviceChanged, this);
        if (!status) listeners.push_back({object, key});
        return status;
    }
    OSStatus selectOutput(AudioObjectID physical) {
        auto key = address(kAudioDevicePropertyStreams, kAudioObjectPropertyScopeOutput);
        auto preferredKey = address(kAudioDevicePropertyPreferredChannelsForStereo, kAudioObjectPropertyScopeOutput);
        const auto read = [&](std::vector<AudioObjectID> &streams, std::vector<voxcue::audio::OutputStream> &metadata,
                              bool &hasPreferred, std::array<UInt32, 2> &preferred) -> OSStatus {
            UInt32 bytes = 0;
            if (AudioObjectGetPropertyDataSize(physical, &key, 0, nullptr, &bytes) || !bytes || bytes % sizeof(AudioObjectID) || bytes > 256 * sizeof(AudioObjectID)) return kAudioHardwareUnsupportedOperationError;
            streams.resize(bytes / sizeof(AudioObjectID));
            if (AudioObjectGetPropertyData(physical, &key, 0, nullptr, &bytes, streams.data()) || !bytes || bytes % sizeof(AudioObjectID) || bytes > streams.size() * sizeof(AudioObjectID)) return kAudioHardwareUnsupportedOperationError;
            streams.resize(bytes / sizeof(AudioObjectID));
            for (auto stream : streams) {
                AudioStreamBasicDescription streamFormat{}; UInt32 first = 0;
                if (property(stream, address(kAudioStreamPropertyVirtualFormat), streamFormat) || property(stream, address(kAudioStreamPropertyStartingChannel), first)) return kAudioHardwareUnsupportedOperationError;
                metadata.push_back({first, streamFormat.mChannelsPerFrame, stream});
            }
            hasPreferred = AudioObjectHasProperty(physical, &preferredKey);
            if (hasPreferred && property(physical, preferredKey, preferred)) return kAudioHardwareUnsupportedOperationError;
            return noErr;
        };
        std::vector<AudioObjectID> streams;
        std::vector<voxcue::audio::OutputStream> metadata;
        bool hasPreferred = false;
        std::array<UInt32, 2> preferred{};
        OSStatus status = read(streams, metadata, hasPreferred, preferred);
        if (status) return status;
        outputRoute = voxcue::audio::outputRoute(metadata.data(), metadata.size(), hasPreferred ? &preferred : nullptr);
        if (!outputRoute) return kAudioHardwareUnsupportedOperationError;
        status = listen(physical, key);
        if (!status && hasPreferred) status = listen(physical, preferredKey);
        auto configuration = address(kAudioDevicePropertyStreamConfiguration, kAudioObjectPropertyScopeOutput);
        if (!status && AudioObjectHasProperty(physical, &configuration)) status = listen(physical, configuration);
        for (auto stream : streams) {
            if (!status) status = listen(stream, address(kAudioStreamPropertyVirtualFormat));
            if (!status) status = listen(stream, address(kAudioStreamPropertyStartingChannel));
        }
        if (status) return status;
        std::vector<AudioObjectID> checkedStreams;
        std::vector<voxcue::audio::OutputStream> checkedMetadata;
        bool checkedHasPreferred = false;
        std::array<UInt32, 2> checkedPreferred{};
        status = read(checkedStreams, checkedMetadata, checkedHasPreferred, checkedPreferred);
        if (status || !voxcue::audio::sameOutputMetadata(metadata.data(), metadata.size(), hasPreferred ? &preferred : nullptr,
                checkedMetadata.data(), checkedMetadata.size(), checkedHasPreferred ? &checkedPreferred : nullptr)) {
            failed = true;
            return kAudioHardwareIllegalOperationError;
        }
        return noErr;
    }
    void receive(const AudioBufferList *input, const AudioTimeStamp *time) {
        if (stopping || failed || routeChanged || !input || !input->mNumberBuffers) return;
        if (outputRoute && input->mNumberBuffers > 256) { failed = true; return; }
        const auto shape = voxcue::audio::inspectBuffers(input, format, maxFrames);
        if (!shape.valid) { failed = true; return; }
        const size_t frames = shape.frames;
        if (!frames) return;
        const size_t writeIndex = tail.load(std::memory_order_relaxed);
        if (writeIndex - head.load(std::memory_order_acquire) == slots || (queuedFrames.load(std::memory_order_relaxed) + frames) / format.mSampleRate > 1.5) { failed = true; return; }
        auto &packet = packets[writeIndex % slots];
        uint32_t length = uint32_t(17 + frames * 4), rate = uint32_t(format.mSampleRate), flags = 0;
        const bool validHostTime = time && (time->mFlags & kAudioTimeStampHostTimeValid);
        if (!validHostTime) flags |= 4;
        double timestamp = double(validHostTime ? time->mHostTime : mach_absolute_time()) * timebase.numer / timebase.denom / 1e6;
        if (previousEnd >= 0 && std::abs(timestamp - previousEnd) > 100) flags |= 1;
        previousEnd = timestamp + frames * 1000 / format.mSampleRate;
        memcpy(packet.bytes.data(), &length, 4); packet.bytes[4] = 1;
        memcpy(packet.bytes.data()+5, &rate, 4); memcpy(packet.bytes.data()+9, &timestamp, 8); memcpy(packet.bytes.data()+17, &flags, 4);
        const bool converted = outputRoute
            ? voxcue::audio::writeSelectedMono(input, format, shape, outputRoute, packet.bytes.data() + 21)
            : voxcue::audio::writeMono(input, format, shape, packet.bytes.data() + 21);
        if (!converted) { failed = true; return; }
        packet.size = 21 + frames * 4; packet.frames = frames;
        queuedFrames.fetch_add(frames, std::memory_order_relaxed);
        tail.store(writeIndex + 1, std::memory_order_release);
        changed.notify_one();
    }
    void writePackets() {
        Packet packet;
        while (!failed) {
            {
                std::unique_lock<std::mutex> lock(wakeMutex);
                changed.wait_for(lock, std::chrono::milliseconds(20), [&]{ return head.load() != tail.load() || stopping || failed; });
                const size_t readIndex = head.load(std::memory_order_relaxed);
                if (readIndex == tail.load(std::memory_order_acquire)) { if (stopping) return; continue; }
                const auto &queued = packets[readIndex % slots];
                packet.size = queued.size;
                packet.frames = queued.frames;
                memcpy(packet.bytes.data(), queued.bytes.data(), queued.size);
                queuedFrames.fetch_sub(packet.frames, std::memory_order_relaxed);
                head.store(readIndex + 1, std::memory_order_release);
            }
            size_t offset = 0;
            while (offset < packet.size && !failed) {
                if (stopping && std::chrono::steady_clock::now() - stopAt > std::chrono::seconds(1)) { failed = true; break; }
                pollfd output{STDOUT_FILENO, POLLOUT, 0};
                int ready = poll(&output, 1, 100);
                if (ready < 0 && errno == EINTR) continue;
                if (ready < 0 || (ready && (output.revents & (POLLERR|POLLHUP)))) { failed = true; break; }
                if (!ready) continue;
                ssize_t written = write(STDOUT_FILENO, packet.bytes.data()+offset, packet.size-offset);
                if (written > 0) offset += size_t(written);
                else if (errno != EAGAIN && errno != EINTR) { failed = true; break; }
            }
        }
    }
public:
    OSStatus initialize(bool microphone, NSString *uid) {
        mach_timebase_info(&timebase);
        AudioObjectID physical = selectedDevice(microphone, uid);
        if (!physical || !hasChannels(physical, microphone ? kAudioObjectPropertyScopeInput : kAudioObjectPropertyScopeOutput)) return kAudioHardwareBadDeviceError;
        device = physical;
        OSStatus status;
        if (!microphone) {
            if ((status = selectOutput(physical))) return status;
            CATapDescription *description = [[CATapDescription alloc] initExcludingProcesses:@[] andDeviceUID:stringProperty(physical, kAudioDevicePropertyDeviceUID) withStream:outputRoute.stream];
            description.name = @"VoxCue system audio"; description.privateTap = YES; description.muteBehavior = CATapUnmuted;
            status = AudioHardwareCreateProcessTap(description, &tap); if (status) return status;
            NSString *tapUID = stringProperty(tap, kAudioTapPropertyUID);
            if (!tapUID.length) return kAudioHardwareIllegalOperationError;
            // Only the tap is an input. Adding a duplex physical subdevice would
            // accidentally include its microphone in the system-audio stream.
            NSDictionary *configuration = @{
                @kAudioAggregateDeviceNameKey:@"VoxCue private audio tap",
                @kAudioAggregateDeviceUIDKey:NSUUID.UUID.UUIDString,
                @kAudioAggregateDeviceIsPrivateKey:@YES,
                @kAudioAggregateDeviceTapAutoStartKey:@YES,
                @kAudioAggregateDeviceTapListKey:@[@{@kAudioSubTapUIDKey:tapUID, @kAudioSubTapDriftCompensationKey:@YES}]
            };
            status = AudioHardwareCreateAggregateDevice((__bridge CFDictionaryRef)configuration, &aggregate); if (status) return status;
            device = aggregate;
        }
        status = property(device, address(kAudioDevicePropertyStreamFormat, kAudioObjectPropertyScopeInput), format); if (status) return status;
        if (outputRoute && format.mChannelsPerFrame != outputRoute.channels) return kAudioHardwareUnsupportedOperationError;
        bool supported = (format.mFormatFlags & kAudioFormatFlagIsFloat) ? (format.mBitsPerChannel == 32 || format.mBitsPerChannel == 64) : ((format.mFormatFlags & kAudioFormatFlagIsSignedInteger) && (format.mBitsPerChannel == 16 || format.mBitsPerChannel == 32));
        if (format.mBytesPerFrame != (format.mBitsPerChannel / 8) * ((format.mFormatFlags & kAudioFormatFlagIsNonInterleaved) ? 1 : format.mChannelsPerFrame)) return kAudioHardwareUnsupportedOperationError;
        if (!supported || format.mFormatID != kAudioFormatLinearPCM || (format.mFormatFlags & kAudioFormatFlagIsBigEndian) || format.mSampleRate < 8000 || format.mSampleRate > 192000) return kAudioHardwareUnsupportedOperationError;
        status = listen(physical, address(kAudioDevicePropertyDeviceIsAlive)); if (status) return status;
        status = listen(physical, address(kAudioDevicePropertyNominalSampleRate)); if (status) return status;
        if (!uid.length) { status = listen(kAudioObjectSystemObject, address(microphone ? kAudioHardwarePropertyDefaultInputDevice : kAudioHardwarePropertyDefaultOutputDevice)); if (status) return status; }
        return noErr;
    }
    OSStatus start(bool collect) {
        Capture *capture = this;
        OSStatus status = AudioDeviceCreateIOProcIDWithBlock(&io, device, queue,
            ^(const AudioTimeStamp *, const AudioBufferList *input, const AudioTimeStamp *inputTime, AudioBufferList *, const AudioTimeStamp *) {
                if (collect) capture->receive(input, inputTime);
            });
        if (status) return status;
        if (collect) { fcntl(STDOUT_FILENO, F_SETFL, fcntl(STDOUT_FILENO, F_GETFL) | O_NONBLOCK); writer = std::thread([this]{ writePackets(); }); }
        return AudioDeviceStart(device, io);
    }
    bool healthy() { return !failed && !routeChanged; }
    NSString *errorCode() { return failed ? @"device-changed-or-backpressure" : @"device-changed"; }
    bool finish() {
        if (finished) return !failed;
        finished = true;
        if (io) { AudioDeviceStop(device, io); AudioDeviceDestroyIOProcID(device, io); dispatch_sync(queue, ^{}); }
        for (auto &listener : listeners) AudioObjectRemovePropertyListener(listener.object, &listener.key, deviceChanged, this);
        stopAt = std::chrono::steady_clock::now(); stopping = true; changed.notify_all();
        if (writer.joinable()) writer.join();
        if (aggregate) AudioHardwareDestroyAggregateDevice(aggregate);
        if (tap) AudioHardwareDestroyProcessTap(tap);
        return !failed;
    }
    ~Capture() { finish(); }
};
static int failure(NSString *code, OSStatus status = 0) {
    json(NSFileHandle.fileHandleWithStandardError, @{@"type":@"error", @"code":code, @"status":@(status)}); return 1;
}
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        signal(SIGPIPE, SIG_IGN);
        if (argc == 2 && strcmp(argv[1], "devices") == 0) {
            NSArray *devices = inventory(); if (!devices) return failure(@"inventory-failed");
            json(NSFileHandle.fileHandleWithStandardOutput, devices); return 0;
        }
        if (argc == 2 && strcmp(argv[1], "permissions") == 0) {
            json(NSFileHandle.fileHandleWithStandardOutput, @{@"microphone":@([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio]), @"system":@"no-public-preflight-api"}); return 0;
        }
        bool check = argc == 4 && strcmp(argv[1], "check") == 0;
        if ((!check && argc != 3) || (check && argc != 4)) return failure(@"invalid-request");
        const char *source = argv[check ? 2 : 1];
        bool microphone = strcmp(source, "microphone") == 0;
        if (!microphone && strcmp(source, "system") != 0) return failure(@"invalid-request");
        NSString *encoded = @(argv[check ? 3 : 2]);
        if (encoded.length > 4096) return failure(@"invalid-request");
        NSData *bytes = [[NSData alloc] initWithBase64EncodedString:encoded options:0];
        NSString *uid = bytes ? [[NSString alloc] initWithData:bytes encoding:NSUTF8StringEncoding] : nil;
        if (!uid || [uid rangeOfCharacterFromSet:[NSCharacterSet characterSetWithRange:NSMakeRange(0, 1)]].location != NSNotFound) return failure(@"invalid-request");
        Capture capture;
        OSStatus status = capture.initialize(microphone, uid);
        if (status || !capture.healthy()) return failure(!capture.healthy() ? capture.errorCode() : status == kAudioHardwareBadDeviceError ? @"device-unavailable" : status == kAudioHardwareUnsupportedOperationError ? @"unsupported-audio-format-or-layout" : @"initialize-failed", status);
        if (microphone && !microphoneAllowed()) return failure(@"permission-denied");
        // Core Audio has no public system-audio permission query. The explicit
        // user preflight starts/stops a no-op IOProc to request authorization;
        // it never reads, returns or feeds any sample buffers to ASR.
        status = capture.start(!check);
        if (status) return failure(status == kAudioDevicePermissionsError ? @"permission-denied" : @"start-failed", status);
        if (check) { if (!capture.finish() || !capture.healthy()) return failure(capture.errorCode()); json(NSFileHandle.fileHandleWithStandardOutput, @{@"ok":@YES, @"samplesRead":@0}); return 0; }
        json(NSFileHandle.fileHandleWithStandardError, @{@"type":@"started"});
        auto permissionChecked = std::chrono::steady_clock::now();
        while (capture.healthy()) {
            if (microphone && std::chrono::steady_clock::now() - permissionChecked > std::chrono::seconds(1)) {
                permissionChecked = std::chrono::steady_clock::now();
                if ([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio] != AVAuthorizationStatusAuthorized) return failure(@"permission-denied");
            }
            pollfd input{STDIN_FILENO, POLLIN, 0};
            if (poll(&input, 1, 50) > 0 && (input.revents & (POLLIN|POLLHUP))) { char byte; if (read(STDIN_FILENO, &byte, 1) <= 0) return capture.finish() ? 0 : failure(@"drain-failed"); }
        }
        capture.finish();
        return failure(capture.errorCode());
    }
}
