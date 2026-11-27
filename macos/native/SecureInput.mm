#import <AppKit/AppKit.h>
#include <node_api.h>
#include <cmath>
#include <cstring>

// Only the main process loads this binding. Resolve Electron's handle against existing
// Cocoa views before using it, so a stale handle cannot target a newly opened window.
static NSView *findView(NSView *root, void *pointer) {
    if ((__bridge void *)root == pointer) return root;
    for (NSView *child in root.subviews) {
        NSView *found = findView(child, pointer);
        if (found) return found;
    }
    return nil;
}
static NSView *ownerView(napi_env env, napi_value handle) {
    void *data = nullptr, *pointer = nullptr;
    size_t length = 0;
    if (![NSThread isMainThread] || napi_get_buffer_info(env, handle, &data, &length) != napi_ok ||
        length != sizeof(pointer)) return nil;
    memcpy(&pointer, data, sizeof(pointer));
    if (!pointer) return nil;
    for (NSWindow *win in NSApp.windows) {
        NSView *view = findView(win.contentView, pointer);
        if (view) return view;
    }
    return nil;
}
static NSString *stringArg(napi_env env, napi_value value) {
    char bytes[512];
    size_t length;
    if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok ||
        length >= sizeof(bytes) || napi_get_value_string_utf8(env, value, bytes, sizeof(bytes), &length) != napi_ok)
        return nil;
    return [[NSString alloc] initWithBytes:bytes length:length encoding:NSUTF8StringEncoding];
}
static napi_value fail(napi_env env) {
    napi_throw_error(env, nullptr, "Native secure input unavailable");
    return nullptr;
}
static napi_threadsafe_function callbackFor(napi_env env, napi_value callback) {
    napi_value name;
    napi_create_string_utf8(env, "VoxCue native input", NAPI_AUTO_LENGTH, &name);
    napi_threadsafe_function fn = nullptr;
    if (napi_create_threadsafe_function(env, callback, nullptr, name, 0, 1, nullptr, nullptr, nullptr,
        [](napi_env env, napi_value cb, void *, void *raw) {
            NSString *value = CFBridgingRelease(raw);
            if (!env || !cb) return;
            napi_value arg, receiver, result;
            if (value) napi_create_string_utf8(env, value.UTF8String, [value lengthOfBytesUsingEncoding:NSUTF8StringEncoding], &arg);
            else napi_get_null(env, &arg);
            napi_get_undefined(env, &receiver);
            napi_call_function(env, receiver, cb, 1, &arg, &result);
        }, &fn) != napi_ok) return nullptr;
    return fn;
}
static void send(napi_threadsafe_function callback, NSString *value) {
    if (!callback) return;
    void *copy = (void *)CFBridgingRetain(value);
    if (napi_call_threadsafe_function(callback, copy, napi_tsfn_nonblocking) != napi_ok)
        (void)CFBridgingRelease(copy);
}
@interface VoxCueKeyField : NSObject <NSTextFieldDelegate>
@property(nonatomic, weak) NSView *owner;
@property(nonatomic, strong) NSTextField *field;
@property(nonatomic, copy) NSString *label;
@property(nonatomic) napi_threadsafe_function callback;
- (void)install:(BOOL)visible;
- (NSString *)value;
@end
@implementation VoxCueKeyField
- (NSString *)value { return self.field.currentEditor.string ?: self.field.stringValue; }
- (void)install:(BOOL)visible {
    NSTextField *old = self.field;
    NSTextView *editor = (NSTextView *)old.currentEditor;
    NSRange selection = editor ? editor.selectedRange : NSMakeRange(NSNotFound, 0);
    NSString *text = old ? self.value : @"";
    NSTextField *field = visible ? [NSTextField new] : [NSSecureTextField new];
    field.bezeled = NO;
    field.focusRingType = NSFocusRingTypeNone;
    field.drawsBackground = NO;
    field.usesSingleLineMode = YES;
    field.cell.scrollable = YES;
    field.textColor = NSColor.labelColor;
    field.editable = YES;
    field.selectable = YES;
    field.automaticTextCompletionEnabled = NO;
    [field setAccessibilityLabel:self.label];
    field.delegate = self;
    field.stringValue = text;
    field.frame = old.frame;
    field.font = old.font ?: [NSFont systemFontOfSize:14];
    field.appearance = old.appearance;
    BOOL hidden = !old || old.hidden;
    field.hidden = YES;
    [self.owner addSubview:field positioned:NSWindowAbove relativeTo:nil];
    if (editor) [old abortEditing];
    old.stringValue = @"";
    old.delegate = nil;
    [old removeFromSuperview];
    self.field = field;
    [field layoutSubtreeIfNeeded];
    field.hidden = hidden;
    if (!hidden) [field displayIfNeeded];
    if (selection.location != NSNotFound && !field.hidden && self.owner.window.isKeyWindow) {
        [self.owner.window makeFirstResponder:field];
        [(NSTextView *)field.currentEditor setSelectedRange:NSIntersectionRange(selection, NSMakeRange(0, text.length))];
    }
}
- (BOOL)control:(NSControl *)control textView:(NSTextView *)view doCommandBySelector:(SEL)selector {
    NSString *action = nil;
    if (selector == @selector(insertNewline:)) action = @"submit";
    else if (selector == @selector(cancelOperation:)) action = @"cancel";
    else if (selector == @selector(insertTab:)) action = @"tab";
    else if (selector == @selector(insertBacktab:)) action = @"backtab";
    if (!action) return NO;
    send(self.callback, action);
    return YES;
}
- (void)controlTextDidChange:(NSNotification *)notification {
    NSTextView *editor = (NSTextView *)self.field.currentEditor;
    if (editor.string.length > 4096)
        [editor.textStorage deleteCharactersInRange:NSMakeRange(4096, editor.string.length - 4096)];
}
- (void)controlTextDidBeginEditing:(NSNotification *)notification {
    NSTextView *editor = (NSTextView *)self.field.currentEditor;
    editor.automaticSpellingCorrectionEnabled = NO;
    editor.continuousSpellCheckingEnabled = NO;
    editor.automaticTextReplacementEnabled = NO;
    editor.automaticQuoteSubstitutionEnabled = NO;
    editor.automaticDashSubstitutionEnabled = NO;
    editor.automaticTextCompletionEnabled = NO;
}
@end

static VoxCueKeyField *active;
static void disposeField() {
    active.field.delegate = nil;
    [active.field abortEditing];
    active.field.stringValue = @"";
    [active.field removeFromSuperview];
    if (active.callback) napi_release_threadsafe_function(active.callback, napi_tsfn_abort);
    active = nil;
}
static napi_value begin(napi_env env, napi_callback_info info) {
    size_t count = 3; napi_value args[3];
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    if (count != 3 || active) return fail(env);
    NSView *view = ownerView(env, args[0]);
    NSString *label = stringArg(env, args[1]);
    if (!view || !label.length) return fail(env);
    auto callback = callbackFor(env, args[2]);
    if (!callback) return fail(env);
    active = [VoxCueKeyField new];
    active.owner = view;
    active.label = label;
    active.callback = callback;
    [active install:NO];
    return nullptr;
}
static napi_value layout(napi_env env, napi_callback_info info) {
    size_t count = 6; napi_value args[6];
    double v[5]; bool dark;
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    if (count != 6 || !active.owner.window) return fail(env);
    for (size_t i=0; i<5; ++i)
        if (napi_get_value_double(env, args[i], &v[i]) != napi_ok || !std::isfinite(v[i]) || v[i]<0)
            return fail(env);
    if (napi_get_value_bool(env, args[5], &dark) != napi_ok) return fail(env);
    NSView *owner = active.owner;
    NSTextField *field = active.field;
    field.font = [NSFont systemFontOfSize:v[4]];
    field.appearance = [NSAppearance appearanceNamed:dark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
    NSRect content = owner.bounds;
    NSRect slot = NSMakeRect(NSMinX(content)+v[0], owner.isFlipped ? NSMinY(content)+v[1] : NSMaxY(content)-v[1]-v[3], v[2], v[3]);
    BOOL hidden = !NSContainsRect(NSInsetRect(content, -0.5, -0.5), slot) || NSIsEmptyRect(slot);
    CGFloat lineHeight = MIN(NSHeight(slot), ceil(field.intrinsicContentSize.height));
    field.frame = NSMakeRect(NSMinX(slot), floor(NSMidY(slot)-lineHeight/2), NSWidth(slot), lineHeight);
    [field layoutSubtreeIfNeeded];
    field.hidden = hidden;
    if (!hidden) [field displayIfNeeded];
    return nullptr;
}
static napi_value command(napi_env env, napi_callback_info info) {
    size_t count=1; napi_value arg;
    napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr);
    NSString *action = count == 1 ? stringArg(env, arg) : nil;
    if ([action isEqual:@"close"]) { disposeField(); return nullptr; }
    if (!active.owner.window) return fail(env);
    if ([action isEqual:@"focus"]) {
        if (!active.field.hidden && active.owner.window.isKeyWindow)
            [active.owner.window makeFirstResponder:active.field];
    } else if ([action isEqual:@"reveal"] || [action isEqual:@"mask"]) {
        [active install:[action isEqual:@"reveal"]];
    } else if ([action isEqual:@"submit"]) {
        NSString *value = active.value;
        if (value.length > 4096) return fail(env);
        napi_value result;
        napi_create_string_utf8(env, value.UTF8String, [value lengthOfBytesUsingEncoding:NSUTF8StringEncoding], &result);
        disposeField();
        return result;
    } else return fail(env);
    return nullptr;
}
// A password entered here goes only to the main process importing the selected PFX.
static napi_value certificatePassword(napi_env env, napi_callback_info info) {
    size_t count=3; napi_value args[3];
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    if (count != 3) return fail(env);
    NSWindow *owner = ownerView(env, args[0]).window;
    bool english;
    if (!owner || owner.attachedSheet || napi_get_value_bool(env, args[1], &english) != napi_ok) return fail(env);
    auto callback = callbackFor(env, args[2]);
    if (!callback) return fail(env);
    NSAlert *alert = [NSAlert new];
    alert.messageText = english ? @"Device connection certificate" : @"设备连接证书";
    alert.informativeText = english ? @"Enter the password for the selected PKCS#12 file." : @"请输入所选 PKCS#12 文件的密码。";
    NSSecureTextField *field = [[NSSecureTextField alloc] initWithFrame:NSMakeRect(0, 0, 270, 24)];
    [field setAccessibilityLabel:english ? @"Certificate password" : @"证书密码"];
    alert.accessoryView = field;
    [alert addButtonWithTitle:english ? @"Import" : @"导入"];
    [alert addButtonWithTitle:english ? @"Cancel" : @"取消"];
    alert.window.initialFirstResponder = field;
    [alert beginSheetModalForWindow:owner completionHandler:^(NSModalResponse response) {
        NSString *password = response == NSAlertFirstButtonReturn ? (field.currentEditor.string ?: field.stringValue) : nil;
        send(callback, password);
        [field abortEditing];
        field.stringValue = @"";
        napi_release_threadsafe_function(callback, napi_tsfn_release);
    }];
    return nullptr;
}
static napi_value init(napi_env env, napi_value exports) {
    napi_property_descriptor properties[] = {
        {"begin", nullptr, begin, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"layout", nullptr, layout, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"command", nullptr, command, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"certificatePassword", nullptr, certificatePassword, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, 4, properties);
    napi_add_env_cleanup_hook(env, [](void *) { disposeField(); }, nullptr);
    return exports;
}
NAPI_MODULE(voxcue_secure_input, init)
