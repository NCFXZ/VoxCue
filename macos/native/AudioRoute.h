#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <limits>

namespace voxcue::audio {
struct OutputStream {
    uint32_t startingChannel = 0;
    uint32_t channels = 0;
    uint32_t identity = 0;
};
struct OutputRoute {
    size_t stream = 0;
    uint32_t channels = 0;
    std::array<uint32_t, 2> selected{};
    size_t count = 0;
    explicit operator bool() const { return count != 0; }
};

// Initialization reads the routing metadata again after installing listeners.
// Preserve object identity and HAL order even when two streams have the same
// channel shape; an equal computed route alone cannot detect their replacement.
inline bool sameOutputMetadata(const OutputStream *before, size_t beforeCount,
                               const std::array<uint32_t, 2> *beforePreferred,
                               const OutputStream *after, size_t afterCount,
                               const std::array<uint32_t, 2> *afterPreferred) {
    if (!before || !after || !beforeCount || beforeCount > 256 || beforeCount != afterCount ||
        bool(beforePreferred) != bool(afterPreferred)) return false;
    if (beforePreferred && *beforePreferred != *afterPreferred) return false;
    for (size_t index = 0; index < beforeCount; ++index)
        if (before[index].identity != after[index].identity ||
            before[index].startingChannel != after[index].startingChannel ||
            before[index].channels != after[index].channels) return false;
    return true;
}

// HAL stream order is the tap's stream index; preferred channel numbers are
// one-based across the output device, not offsets in a chosen stream.
inline OutputRoute outputRoute(const OutputStream *streams, size_t count,
                               const std::array<uint32_t, 2> *preferred) {
    if (!streams || !count || count > 256) return {};
    for (size_t i = 0; i < count; ++i) {
        const auto &stream = streams[i];
        if (!stream.startingChannel || !stream.channels || stream.channels > 256 ||
            uint64_t(stream.startingChannel) + stream.channels - 1 > std::numeric_limits<uint32_t>::max()) return {};
        for (size_t j = 0; j < i; ++j)
            if (uint64_t(stream.startingChannel) < uint64_t(streams[j].startingChannel) + streams[j].channels &&
                uint64_t(streams[j].startingChannel) < uint64_t(stream.startingChannel) + stream.channels) return {};
    }
    if (!preferred) {
        // Missing preferences are unambiguous only for a single mono/stereo
        // stream. Never infer a pair from signal levels or multiple streams.
        if (count != 1 || streams[0].channels > 2) return {};
        return {0, streams[0].channels, {0, streams[0].channels - 1}, streams[0].channels};
    }
    if (!(*preferred)[0] || !(*preferred)[1]) return {};
    for (size_t index = 0; index < count; ++index) {
        const auto &stream = streams[index];
        const uint64_t end = uint64_t(stream.startingChannel) + stream.channels;
        if ((*preferred)[0] < stream.startingChannel || (*preferred)[0] >= end ||
            (*preferred)[1] < stream.startingChannel || (*preferred)[1] >= end) continue;
        return {index, stream.channels,
            {(*preferred)[0] - stream.startingChannel, (*preferred)[1] - stream.startingChannel},
            (*preferred)[0] == (*preferred)[1] ? size_t(1) : size_t(2)};
    }
    return {}; // Cross-stream pairs cannot be served by one bounded tap.
}
}
