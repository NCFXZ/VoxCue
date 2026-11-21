#import <AppKit/AppKit.h>
#include <node_api.h>

// Test-only AppKit inspection, scoped to a fixed synthetic control in this process.
static NSTextField *findField(NSView *view) {
    if ([view isKindOfClass:NSTextField.class] && [view.accessibilityLabel isEqual:@"Synthetic API key"])
        return (NSTextField *)view;
    for (NSView *child in view.subviews) {
        NSTextField *field = findField(child);
        if (field) return field;
    }
    return nil;
}
static napi_value probe(napi_env env, napi_callback_info info) {
    char action[20]; napi_value arg, result;
    size_t count = 1, length = 0;
    napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr);
    if (count != 1 || napi_get_value_string_utf8(env, arg, action, sizeof(action), &length) != napi_ok) {
        napi_throw_error(env, nullptr, "Invalid fixture action"); return nullptr;
    }
    NSTextField *field = findField(NSApp.keyWindow.contentView);
    NSTextView *editor = (NSTextView *)field.currentEditor;
    NSString *state = !field ? @"closed" : field.hidden ? @"hidden" :
        [field isKindOfClass:NSSecureTextField.class] ? @"masked" : @"visible";
    if (!strcmp(action, "type")) {
        if (!editor) { napi_throw_error(env, nullptr, "Synthetic field has no editor"); return nullptr; }
        [editor insertText:@"synthetic-api-key" replacementRange:editor.selectedRange];
    } else if (!strcmp(action, "tab") || !strcmp(action, "enter")) {
        if (!editor) { napi_throw_error(env, nullptr, "Synthetic field lost focus"); return nullptr; }
        [editor doCommandBySelector:!strcmp(action, "tab") ? @selector(insertTab:) : @selector(insertNewline:)];
    }
    napi_create_string_utf8(env, state.UTF8String, NAPI_AUTO_LENGTH, &result);
    return result;
}
static napi_value init(napi_env env, napi_value exports) {
    napi_value function; napi_create_function(env, "probe", NAPI_AUTO_LENGTH, probe, nullptr, &function);
    napi_set_named_property(env, exports, "probe", function); return exports;
}
NAPI_MODULE(voxcue_secure_input_probe, init)
