#import <AppKit/AppKit.h>
#include <node_api.h>
#include <cstring>

// Read-only AppKit hit testing of this process's owned synthetic BrowserWindow.
// No global input, screen capture, permissions or other application's windows.
static napi_value probe(napi_env env, napi_callback_info info) {
    napi_value args[3], result;
    size_t count = 3, length = 0;
    void *bytes = nullptr, *address = nullptr;
    double x = 0, y = 0;
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    if (count != 3 || napi_get_buffer_info(env, args[0], &bytes, &length) != napi_ok ||
        length != sizeof(void *) || napi_get_value_double(env, args[1], &x) != napi_ok ||
        napi_get_value_double(env, args[2], &y) != napi_ok) {
        napi_throw_type_error(env, nullptr, "Expected owned native handle and content point");
        return nullptr;
    }
    memcpy(&address, bytes, sizeof(address));
    NSView *view = (__bridge NSView *)address;
    NSView *content = view.window.contentView;
    NSView *root = content.superview ?: content;
    if (!content || ![NSApp.windows containsObject:view.window] || x < 0 || x > 1 || y < 0 || y > 1) {
        napi_throw_type_error(env, nullptr, "Expected a point in this process's own content view");
        return nullptr;
    }
    NSPoint point = NSMakePoint(x * content.bounds.size.width,
        (content.isFlipped ? y : 1 - y) * content.bounds.size.height);
    NSView *hit = [root hitTest:[content convertPoint:point toView:root.superview]];
    NSView *contentHit = [content hitTest:[content convertPoint:point toView:content.superview]];
    NSDictionary *state = @{@"nativeHit": @(hit != nil),
                            @"contentReceivesMouse": @(contentHit != nil)};
    NSData *json = [NSJSONSerialization dataWithJSONObject:state options:0 error:nil];
    napi_create_string_utf8(env, (const char *)json.bytes, json.length, &result);
    return result;
}
static napi_value init(napi_env env, napi_value exports) {
    napi_value function;
    napi_create_function(env, "probe", NAPI_AUTO_LENGTH, probe, nullptr, &function);
    napi_set_named_property(env, exports, "probe", function);
    return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
