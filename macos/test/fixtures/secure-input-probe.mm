#import <AppKit/AppKit.h>
#include <node_api.h>
#include <cstring>

static NSView *findView(NSView *view, void *address) {
    if ((__bridge void *)view == address) return view;
    for (NSView *child in view.subviews) {
        NSView *found = findView(child, address);
        if (found) return found;
    }
    return nil;
}
static NSView *ownedView(napi_env env, napi_value handle) {
    void *bytes = nullptr, *address = nullptr; size_t length = 0;
    if (![NSThread isMainThread] || napi_get_buffer_info(env, handle, &bytes, &length) != napi_ok ||
        length != sizeof(address)) return nil;
    memcpy(&address, bytes, sizeof(address));
    if (!address) return nil;
    for (NSWindow *window in NSApp.windows) {
        NSView *view = findView(window.contentView, address);
        if (view) return view;
    }
    return nil;
}

// Test-only AppKit inspection, scoped to a fixed synthetic control in this process.
static NSTextField *findField(NSView *view, NSString *label) {
    if ([view isKindOfClass:NSTextField.class] && [view.accessibilityLabel isEqual:label])
        return (NSTextField *)view;
    for (NSView *child in view.subviews) {
        NSTextField *field = findField(child, label);
        if (field) return field;
    }
    return nil;
}
static napi_value probe(napi_env env, napi_callback_info info) {
    char action[20], labelBytes[100]; napi_value args[3], result;
    size_t count = 3, length = 0;
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    if (count < 1 || napi_get_value_string_utf8(env, args[0], action, sizeof(action), &length) != napi_ok) {
        napi_throw_error(env, nullptr, "Invalid fixture action"); return nullptr;
    }
    NSString *label = @"Synthetic API key";
    if (count >= 2) {
        if (napi_get_value_string_utf8(env, args[1], labelBytes, sizeof(labelBytes), &length) != napi_ok ||
            length >= sizeof(labelBytes)) {
            napi_throw_error(env, nullptr, "Invalid synthetic label"); return nullptr;
        }
        label = [NSString stringWithUTF8String:labelBytes];
    }
    NSView *root = count == 3 ? ownedView(env, args[2]) : NSApp.keyWindow.contentView;
    if (count == 3 && !root) {
        napi_throw_error(env, nullptr, "Owned synthetic window is unavailable"); return nullptr;
    }
    NSTextField *field = findField(root, label);
    NSTextView *editor = (NSTextView *)field.currentEditor;
    NSString *state = !field ? @"closed" : field.hidden ? @"hidden" :
        [field isKindOfClass:NSSecureTextField.class] ? @"masked" : @"visible";
    if (!strcmp(action, "geometry")) {
        NSRect bounds = field.superview.bounds, frame = field.frame;
        NSDictionary *geometry = @{@"state": state,
            @"x": @(NSMinX(frame) - NSMinX(bounds)),
            @"y": @(field.superview.isFlipped ? NSMinY(frame) - NSMinY(bounds) : NSMaxY(bounds) - NSMaxY(frame)),
            @"width": @(NSWidth(frame)), @"height": @(NSHeight(frame)),
            @"font": @(field.font.pointSize), @"dark": @([field.appearance.name isEqual:NSAppearanceNameDarkAqua]),
            @"length": @((editor.string ?: field.stringValue).length),
            @"backingScale": @(field.window.backingScaleFactor)};
        NSData *json = [NSJSONSerialization dataWithJSONObject:geometry options:0 error:nil];
        napi_create_string_utf8(env, (const char *)json.bytes, json.length, &result);
        return result;
    } else if (!strcmp(action, "type")) {
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
