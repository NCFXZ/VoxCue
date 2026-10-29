#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#include <node_api.h>
#include <string>

// Test-only inspection in this process's own synthetic save sheet.
// Saving/overwriting remains a real user action; no permission or input is injected.
static NSString *stringArg(napi_env env, napi_value value) {
    size_t size = 0;
    napi_get_value_string_utf8(env, value, nullptr, 0, &size);
    std::string text(size + 1, '\0');
    napi_get_value_string_utf8(env, value, text.data(), text.size(), &size);
    return [NSString stringWithUTF8String:text.c_str()];
}
static napi_value probe(napi_env env, napi_callback_info info) {
    napi_value args[1], result;
    size_t count = 1;
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    NSString *action = count ? stringArg(env, args[0]) : @"inspect";
    NSSavePanel *panel = nil;
    for (NSWindow *window in NSApp.windows)
        if ([window isKindOfClass:NSSavePanel.class] && window.isVisible)
            panel = (NSSavePanel *)window;
    NSDictionary *state = @{@"nativeSaveDialog": @(panel != nil),
                            @"eventPostingAllowed": @(CGPreflightPostEventAccess()),
                            @"title": panel.title ?: @""};
    NSData *json = [NSJSONSerialization dataWithJSONObject:state options:0 error:nil];
    napi_create_string_utf8(env, (const char *)json.bytes, json.length, &result);
    if ([action isEqualToString:@"cancel"] && panel) [panel cancel:nil];
    return result;
}
static napi_value init(napi_env env, napi_value exports) {
    napi_value function;
    napi_create_function(env, "probe", NAPI_AUTO_LENGTH, probe, nullptr, &function);
    napi_set_named_property(env, exports, "probe", function);
    return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
