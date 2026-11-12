#pragma once
#include <CoreAudio/CoreAudioTypes.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include "AudioRoute.h"

namespace voxcue::audio {
struct BufferShape {
    size_t frames = 0, channels = 0;
    bool valid = true;
};

inline BufferShape inspectBuffers(const AudioBufferList *input,
                                 const AudioStreamBasicDescription &format, size_t maxFrames) {
    const size_t stride = format.mBitsPerChannel / 8;
    if (!input || !input->mNumberBuffers) return {};
    if (!stride) return {0, 0, false};
    BufferShape shape{maxFrames, 0};
    for (UInt32 i = 0; i < input->mNumberBuffers; ++i) {
        const auto &buffer = input->mBuffers[i];
        if (!buffer.mNumberChannels || !buffer.mData) continue;
        const size_t frames = buffer.mDataByteSize / (stride * buffer.mNumberChannels);
        if (frames > maxFrames) return {0, 0, false};
        shape.frames = std::min(shape.frames, frames);
        shape.channels += buffer.mNumberChannels;
    }
    if (!shape.channels) shape.frames = 0;
    return shape;
}

inline float sample(const uint8_t *data, const AudioStreamBasicDescription &format) {
    if (format.mFormatFlags & kAudioFormatFlagIsFloat) {
        if (format.mBitsPerChannel == 32) { float value; memcpy(&value, data, 4); return value; }
        if (format.mBitsPerChannel == 64) { double value; memcpy(&value, data, 8); return float(value); }
    } else if (format.mFormatFlags & kAudioFormatFlagIsSignedInteger) {
        if (format.mBitsPerChannel == 16) { int16_t value; memcpy(&value, data, 2); return value / 32768.f; }
        if (format.mBitsPerChannel == 32) { int32_t value; memcpy(&value, data, 4); return value / 2147483648.f; }
    }
    return 0;
}

// Keep the existing all-channel average. A device/layout policy must not be
// inferred from silent channels; caller has already validated the PCM format.
inline bool writeMono(const AudioBufferList *input, const AudioStreamBasicDescription &format,
                      const BufferShape &shape, uint8_t *output) {
    if (!shape.valid || !shape.frames || !shape.channels) return false;
    const size_t stride = format.mBitsPerChannel / 8;
    for (size_t frame = 0; frame < shape.frames; ++frame) {
        double value = 0;
        for (UInt32 i = 0; i < input->mNumberBuffers; ++i) {
            const auto &buffer = input->mBuffers[i];
            if (!buffer.mData) continue;
            for (UInt32 channel = 0; channel < buffer.mNumberChannels; ++channel)
                value += sample(static_cast<const uint8_t *>(buffer.mData) +
                    (frame * buffer.mNumberChannels + channel) * stride, format);
        }
        const float mono = float(value / shape.channels);
        if (!std::isfinite(mono)) return false;
        memcpy(output + frame * sizeof(float), &mono, sizeof(float));
    }
    return true;
}

inline bool writeSelectedMono(const AudioBufferList *input, const AudioStreamBasicDescription &format,
                              const BufferShape &shape, const OutputRoute &route, uint8_t *output) {
    if (!shape.valid || !shape.frames || !route || route.count > 2 ||
        format.mChannelsPerFrame != route.channels || !input || input->mNumberBuffers > 256) return false;
    struct Reference { const uint8_t *data = nullptr; size_t channels = 0, channel = 0; };
    std::array<Reference, 2> references{};
    const size_t stride = format.mBitsPerChannel / 8;
    if (!stride) return false;
    size_t base = 0;
    for (UInt32 index = 0; index < input->mNumberBuffers; ++index) {
        const auto &buffer = input->mBuffers[index];
        if (buffer.mNumberChannels > route.channels || base > route.channels - buffer.mNumberChannels) return false;
        for (size_t selected = 0; selected < route.count; ++selected) {
            const size_t channel = route.selected[selected];
            if (channel >= base && channel - base < buffer.mNumberChannels) {
                if (!buffer.mData || buffer.mDataByteSize / (stride * buffer.mNumberChannels) < shape.frames) return false;
                references[selected] = {static_cast<const uint8_t *>(buffer.mData), buffer.mNumberChannels, channel - base};
            }
        }
        // A null/silent buffer still occupies its HAL channel positions.
        base += buffer.mNumberChannels;
    }
    if (base != route.channels) return false;
    for (size_t selected = 0; selected < route.count; ++selected) if (!references[selected].data) return false;
    for (size_t frame = 0; frame < shape.frames; ++frame) {
        double value = 0;
        for (size_t selected = 0; selected < route.count; ++selected) {
            const auto &reference = references[selected];
            value += sample(reference.data + (frame * reference.channels + reference.channel) * stride, format);
        }
        const float mono = float(value / route.count);
        if (!std::isfinite(mono)) return false;
        memcpy(output + frame * sizeof(float), &mono, sizeof(float));
    }
    return true;
}
}
