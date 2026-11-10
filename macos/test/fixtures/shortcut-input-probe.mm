#import <AppKit/AppKit.h>
#include <node_api.h>
#include <string>

// Dispatch only within this synthetic host. No global event posting,
// Accessibility permission changes, hardware input or other applications.
static napi_value press(napi_env env, napi_callback_info info) {
    napi_value argument, result;
    size_t count = 1, length = 0;
    napi_get_cb_info(env, info, &count, &argument, nullptr, nullptr);
    if (count != 1) { napi_throw_error(env, nullptr, "Expected one owned chord"); return nullptr; }
    napi_get_value_string_utf8(env, argument, nullptr, 0, &length);
    std::string chord(length + 1, '\0');
    napi_get_value_string_utf8(env, argument, chord.data(), chord.size(), &length);
    chord.resize(length);
    if (chord == "inspect") {
        napi_get_boolean(env, NSApp.keyWindow != nil && NSApp.keyWindow.isVisible, &result);
        return result;
    }
    const bool shift = chord == "command-shift-h";
    if (!shift && chord != "command-k") {
        napi_throw_error(env, nullptr, "Unsupported synthetic chord"); return nullptr;
    }
    NSWindow *window = NSApp.keyWindow;
    if (!window || !window.isVisible) {
        napi_throw_error(env, nullptr, "Owned key window is unavailable"); return nullptr;
    }
    auto send = [&](NSEventType type, NSEventModifierFlags flags, unsigned short code,
                    NSString *characters, NSString *plain) {
        NSEvent *event = [NSEvent keyEventWithType:type location:NSZeroPoint modifierFlags:flags
            timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:window.windowNumber
            context:nil characters:characters charactersIgnoringModifiers:plain isARepeat:NO keyCode:code];
        [NSApp sendEvent:event];
    };
    send(NSEventTypeFlagsChanged, NSEventModifierFlagCommand, 55, @"", @"");
    if (shift) send(NSEventTypeFlagsChanged, NSEventModifierFlagCommand | NSEventModifierFlagShift, 56, @"", @"");
    send(NSEventTypeKeyDown, NSEventModifierFlagCommand | (shift ? NSEventModifierFlagShift : 0),
         shift ? 4 : 40, shift ? @"H" : @"k", shift ? @"h" : @"k");
    // Reproduce AppKit's missing letter keyup under Command.
    if (shift) send(NSEventTypeFlagsChanged, NSEventModifierFlagCommand, 56, @"", @"");
    send(NSEventTypeFlagsChanged, 0, 55, @"", @"");
    napi_get_undefined(env, &result);
    return result;
}
static napi_value init(napi_env env, napi_value exports) {
    napi_value function;
    napi_create_function(env, "press", NAPI_AUTO_LENGTH, press, nullptr, &function);
    napi_set_named_property(env, exports, "press", function);
    return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
