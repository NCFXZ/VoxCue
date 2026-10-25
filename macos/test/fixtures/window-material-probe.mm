#import <AppKit/AppKit.h>
#include <node_api.h>
#include <cstring>
#include <initializer_list>

// Test-only, read-only inspection of the current process's own BrowserWindow.
// No screen capture, other applications, or production material binding.
static void inspect(NSView *view, NSUInteger &sidebars, NSUInteger &visible) {
    if ([view isKindOfClass:[NSVisualEffectView class]]) {
        NSVisualEffectView *effect = (NSVisualEffectView *)view;
        if (effect.material == NSVisualEffectMaterialSidebar) {
            sidebars++;
            if (!effect.isHiddenOrHasHiddenAncestor && effect.alphaValue > 0 &&
                effect.bounds.size.width > 0 && effect.bounds.size.height > 0 &&
                effect.blendingMode == NSVisualEffectBlendingModeBehindWindow &&
                effect.state == NSVisualEffectStateFollowsWindowActiveState) visible++;
        }
    }
    for (NSView *child in view.subviews) inspect(child, sidebars, visible);
}

static napi_value probe(napi_env env, napi_callback_info info) {
    size_t count = 1, length = 0;
    napi_value args[1], result;
    void *bytes = nullptr;
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    if (count != 1 || napi_get_buffer_info(env, args[0], &bytes, &length) != napi_ok ||
        length != sizeof(void *)) {
        napi_throw_type_error(env, nullptr, "Expected this test window's native handle");
        return nullptr;
    }
    void *address = nullptr;
    memcpy(&address, bytes, sizeof(address));
    NSView *view = (__bridge NSView *)address;
    NSView *root = view.window.contentView.superview ?: view.window.contentView;
    NSUInteger sidebars = 0, visible = 0;
    if (root) inspect(root, sidebars, visible);
    napi_create_object(env, &result);
    for (auto field : {"sidebars", "visible"}) {
        napi_value value;
        napi_create_uint32(env, strcmp(field, "sidebars") == 0 ? sidebars : visible, &value);
        napi_set_named_property(env, result, field, value);
    }
    return result;
}

static napi_value init(napi_env env, napi_value exports) {
    napi_value function;
    napi_create_function(env, "probe", NAPI_AUTO_LENGTH, probe, nullptr, &function);
    napi_set_named_property(env, exports, "probe", function);
    return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
