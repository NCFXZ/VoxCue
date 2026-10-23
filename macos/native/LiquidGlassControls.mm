#include "LiquidGlassControls.h"
#import <objc/runtime.h>
#include <cstring>

// Shared DOM owns semantics; AppKit renders the three fixed toolbar actions.
@interface VoxCueMaterialButton : NSButton
@end
@implementation VoxCueMaterialButton
- (BOOL)acceptsFirstResponder { return NO; }
@end

@interface VoxCueGlassControlHost : NSView
@property(nonatomic, strong) NSControl *control;
@property(nonatomic) napi_threadsafe_function changed;
@property(nonatomic) BOOL behindContent;
@property(nonatomic,strong) NSColor *foreground;
@end
@implementation VoxCueGlassControlHost
- (NSView *)hitTest:(NSPoint)point {
    return self.behindContent ? nil : [super hitTest:point];
}
- (void)changed:(NSControl *)sender {
    if(self.behindContent)return;
    bool *enabled = new bool(true);
    if (napi_call_threadsafe_function(self.changed, enabled, napi_tsfn_nonblocking) != napi_ok)
        delete enabled;
}
- (void)dealloc {
    if (_changed) napi_release_threadsafe_function(_changed, napi_tsfn_release);
}
@end

static char buttonKeys[3];
bool VoxCueIsGlassControl(NSView *view) { return [view isKindOfClass:VoxCueGlassControlHost.class]; }
void VoxCueRaiseGlassControls(NSView *host) {
    for (NSInteger index = 0; index < 3; index++) {
        VoxCueGlassControlHost *view = objc_getAssociatedObject(host, &buttonKeys[index]);
        if (view) VoxCuePositionGlassControl(host, view, view.behindContent);
    }
}
static void deliver(napi_env env, napi_value callback, void *, void *data) {
    bool *enabled = static_cast<bool *>(data);
    if (env && callback) {
        napi_value value, receiver;
        napi_get_boolean(env, *enabled, &value);
        napi_get_undefined(env, &receiver);
        napi_call_function(env, receiver, callback, 1, &value, nullptr);
    }
    delete enabled;
}
napi_value VoxCueConfigureGlassButton(napi_env env, napi_callback_info info) {
    size_t count = 4, length = 0;
    napi_value args[4], result;
    void *data = nullptr, *pointer = nullptr;
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    if (count != 4 || !NSThread.isMainThread ||
        napi_get_buffer_info(env, args[0], &data, &length) != napi_ok || length != sizeof(pointer)) {
        napi_throw_error(env, nullptr, "Invalid material button request"); return nullptr;
    }
    std::memcpy(&pointer, data, sizeof(pointer));
    NSInteger buttonIndex = -1;
    {
        char action[16]; size_t size = 0;
        napi_get_value_string_utf8(env, args[1], action, sizeof(action), &size);
        buttonIndex = strcmp(action, "sidebar") == 0 ? 0 : strcmp(action, "profile") == 0 ? 1 : strcmp(action, "start") == 0 ? 2 : -1;
        if (buttonIndex < 0) { napi_throw_error(env, nullptr, "Invalid material action"); return nullptr; }
    }
    void *key = &buttonKeys[buttonIndex];
    napi_value placement = args[2];
    NSView *host = ((__bridge NSView *)pointer).window.contentView;
    bool active = false;
    {
        if (host) {
            napi_value nullValue; bool remove = false;
            napi_get_null(env, &nullValue); napi_strict_equals(env, placement, nullValue, &remove);
            VoxCueGlassControlHost *view = objc_getAssociatedObject(host, key);
            if (remove) {
                [view removeFromSuperview];
                objc_setAssociatedObject(host, key, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
            } else {
                double x = 0, y = 0, width = 0, height = 0;
                double *numbers[] = {&x, &y, &width, &height};
                const char *names[] = {"x", "y", "width", "height"};
                for (size_t index = 0; index < sizeof(numbers) / sizeof(numbers[0]); index++) {
                    napi_value value; napi_get_named_property(env, placement, names[index], &value);
                    napi_get_value_double(env, value, numbers[index]);
                }
                napi_value state;
                if (!view) {
                    view = [[VoxCueGlassControlHost alloc] initWithFrame:NSZeroRect];
                    {
                        NSButton *button = [[VoxCueMaterialButton alloc] initWithFrame:NSZeroRect];
                        [button setButtonType:NSButtonTypeMomentaryPushIn];
                        button.bezelStyle = NSBezelStyleGlass;
                        button.bezelColor = nil;
                        button.borderShape = buttonIndex == 0 ? NSControlBorderShapeCircle : NSControlBorderShapeCapsule;
                        button.tintProminence = NSTintProminenceNone;
                        button.title = buttonIndex == 1 ? @"个人信息" : buttonIndex == 2 ? @"开始面试" : @"";
                        button.font = [NSFont systemFontOfSize:14 weight:NSFontWeightMedium];
                        button.image = [NSImage imageWithSystemSymbolName:buttonIndex == 0 ? @"sidebar.left" : buttonIndex == 1 ? @"person" : @"play" accessibilityDescription:nil];
                        button.symbolConfiguration = [NSImageSymbolConfiguration configurationWithPointSize:buttonIndex == 0 ? 17 : 15 weight:NSFontWeightRegular];
                        button.imagePosition = buttonIndex == 0 ? NSImageOnly : NSImageLeading;
                        button.focusRingType=NSFocusRingTypeNone;
                        button.cell.showsFirstResponder=NO;
                        button.imageHugsTitle = YES;
                        button.alignment = NSTextAlignmentCenter;
                        view.control = button;
                    }
                    view.control.controlSize = NSControlSizeRegular;
                    [view.control sizeToFit];
                    view.control.target = view; view.control.action = @selector(changed:);
                    [view.control setAccessibilityHidden:YES];
                    [view addSubview:view.control];
                    napi_value name; napi_create_string_utf8(env, "Liquid Glass toolbar button", NAPI_AUTO_LENGTH, &name);
                    napi_threadsafe_function callback;
                    napi_status status = napi_create_threadsafe_function(env, args[3], nullptr, name,
                        0, 1, nullptr, nullptr, nullptr, deliver, &callback);
                    if (status != napi_ok) {
                        napi_throw_error(env, nullptr, "Unable to attach material button"); return nullptr;
                    }
                    view.changed = callback;
                    napi_unref_threadsafe_function(env, callback);
                    objc_setAssociatedObject(host, key, view, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
                }
                view.frame = NSMakeRect(x, host.isFlipped ? y : NSHeight(host.bounds) - y - height, width, height);
                {
                    NSButton *button = (NSButton *)view.control;
                    bool disabled = false;
                    bool behind = false;
                    napi_get_named_property(env, placement, "behindContent", &state); napi_get_value_bool(env, state, &behind);
                    view.behindContent = behind;
                    napi_get_named_property(env, placement, "disabled", &state); napi_get_value_bool(env, state, &disabled);
                    button.enabled = !disabled && !behind;
                    napi_value colorValue; char colorText[8] = {}; size_t colorLength = 0;
                    napi_get_named_property(env, placement, "foregroundColor", &colorValue);
                    napi_get_value_string_utf8(env, colorValue, colorText, sizeof(colorText), &colorLength);
                    unsigned int rgb = 0; sscanf(colorText, "#%x", &rgb);
                    NSColor *foreground = [NSColor colorWithSRGBRed:((rgb >> 16) & 255) / 255.0 green:((rgb >> 8) & 255) / 255.0 blue:(rgb & 255) / 255.0 alpha:1];
                    if(![view.foreground isEqual:foreground]) {
                    view.foreground=foreground;button.contentTintColor = foreground;
                    button.attributedTitle = [[NSAttributedString alloc] initWithString:button.title attributes:@{ NSForegroundColorAttributeName: foreground, NSFontAttributeName: button.font }];
                    NSImage *symbol = [NSImage imageWithSystemSymbolName:buttonIndex == 0 ? @"sidebar.left" : buttonIndex == 1 ? @"person" : @"play" accessibilityDescription:nil];
                    NSImageSymbolConfiguration *configuration = [[NSImageSymbolConfiguration configurationWithPointSize:buttonIndex == 0 ? 17 : 15 weight:NSFontWeightRegular] configurationByApplyingConfiguration:[NSImageSymbolConfiguration configurationWithPaletteColors:@[foreground]]];
                    button.image = [symbol imageWithSymbolConfiguration:configuration];
                    }
                    bool hovered=false,pressed=false;
                    napi_get_named_property(env,placement,"hovered",&state);napi_get_value_bool(env,state,&hovered);
                    napi_get_named_property(env,placement,"pressed",&state);napi_get_value_bool(env,state,&pressed);
                    BOOL highlighted=button.enabled && (hovered || pressed);
                    if(button.cell.highlighted!=highlighted)[button highlight:highlighted];
                    button.bezelStyle = NSBezelStyleGlass;
                    button.frame = view.bounds;
                }
                VoxCueRaiseGlassControls(host);
                active = true;
            }
        }
    }
    napi_get_boolean(env, active, &result); return result;
}
