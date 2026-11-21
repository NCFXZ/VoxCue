#include <CoreAudio/HostTime.h>
#include <node_api.h>

static napi_value now(napi_env env, napi_callback_info) {
    napi_value result;
    const double milliseconds = AudioConvertHostTimeToNanos(AudioGetCurrentHostTime()) / 1e6;
    napi_create_double(env, milliseconds, &result);
    return result;
}

static napi_value initialize(napi_env env, napi_value) {
    napi_value clock;
    napi_create_function(env, "captureClockNow", NAPI_AUTO_LENGTH, now, nullptr, &clock);
    return clock;
}

NAPI_MODULE(voxcue_audio_clock, initialize)
