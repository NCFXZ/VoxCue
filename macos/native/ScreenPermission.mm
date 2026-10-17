#include <node_api.h>
#include <CoreGraphics/CoreGraphics.h>

// Permission-only binding in Electron's own process identity. Never enumerates
// windows, reads pixels, captures audio, or changes macOS privacy settings.
static napi_value preflight(napi_env env, napi_callback_info) {
    napi_value value; napi_get_boolean(env, CGPreflightScreenCaptureAccess(), &value); return value;
}
struct Request { napi_async_work work; napi_deferred deferred; bool granted = false; };
static void execute(napi_env, void *data) {
    static_cast<Request *>(data)->granted = CGRequestScreenCaptureAccess();
}
static void complete(napi_env env, napi_status status, void *data) {
    auto *request = static_cast<Request *>(data); napi_value value;
    if (status == napi_ok) {
        napi_get_boolean(env, request->granted, &value);
        napi_resolve_deferred(env, request->deferred, value);
    } else {
        napi_value message; napi_create_string_utf8(env, "Screen permission request failed", NAPI_AUTO_LENGTH, &message);
        napi_create_error(env, nullptr, message, &value); napi_reject_deferred(env, request->deferred, value);
    }
    napi_delete_async_work(env, request->work); delete request;
}
static napi_value request(napi_env env, napi_callback_info) {
    auto *pending = new Request; napi_value promise, name;
    napi_create_promise(env, &pending->deferred, &promise);
    napi_create_string_utf8(env, "VoxCue screen permission", NAPI_AUTO_LENGTH, &name);
    if (napi_create_async_work(env, nullptr, name, execute, complete, pending, &pending->work) != napi_ok) {
        delete pending; napi_throw_error(env, nullptr, "Unable to create permission request"); return nullptr;
    }
    if (napi_queue_async_work(env, pending->work) != napi_ok) {
        napi_delete_async_work(env, pending->work); delete pending;
        napi_throw_error(env, nullptr, "Unable to queue permission request"); return nullptr;
    }
    return promise;
}
static napi_value initialize(napi_env env, napi_value exports) {
    napi_property_descriptor properties[] = {
        {"preflight", nullptr, preflight, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"request", nullptr, request, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, 2, properties); return exports;
}
NAPI_MODULE(voxcue_screen_permission, initialize)
