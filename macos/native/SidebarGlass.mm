#include <node_api.h>
#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#import <QuartzCore/QuartzCore.h>
#include <cmath>
#include <cstring>
#include "LiquidGlassControls.h"
#include "ScrollChrome.h"
#include "ContentControls.h"
#include "InterviewMaterials.h"


// An opaque in-window chat plane stops the header/composer from sampling the
// desktop. Only the sidebar is allowed to expose content behind the NSWindow.
@interface VoxCueChatBackground : NSView
@property(nonatomic, strong) NSColor *surfaceColor;
@end
@implementation VoxCueChatBackground
- (BOOL)isOpaque { return YES; }
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (void)drawRect:(NSRect)dirty { [self.surfaceColor setFill]; NSRectFill(NSIntersectionRect(dirty, self.bounds)); }
@end

CGPathRef VoxCueContinuousContour(NSSize size, CGFloat requestedRadius) {
    CGFloat width = size.width, height = size.height, radius = MIN(requestedRadius, MIN(width / 2, height / 2));
    CGMutablePathRef path = CGPathCreateMutable();
    CGPathMoveToPoint(path, nullptr, radius, 0);
    for (int corner = 0; corner < 4; corner++) {
        for (int step = 0; step <= 64; step++) {
            double angle = step / 64.0 * M_PI_2;
            CGFloat sine = sqrt(sin(angle)), cosine = sqrt(cos(angle)), x, y;
            if (corner == 0) { x = width - radius + radius * sine; y = radius - radius * cosine; }
            else if (corner == 1) { x = width - radius + radius * cosine; y = height - radius + radius * sine; }
            else if (corner == 2) { x = radius - radius * sine; y = height - radius + radius * cosine; }
            else { x = radius - radius * cosine; y = radius - radius * sine; }
            CGPathAddLineToPoint(path, nullptr, x, y);
        }
    }
    CGPathCloseSubpath(path);
    return path;
}

// Preserve Electron's coordinate system while its actual native content views
// are hosted by NSGlassEffectView.contentView. The NSWindow root stays intact.
@interface VoxCueGlassContent : NSView
@property(nonatomic) BOOL flippedCoordinates;
@property(nonatomic) NSRect rendererBounds;
@property(nonatomic, strong) NSView *renderer;
@end
@implementation VoxCueGlassContent
- (BOOL)isFlipped { return self.flippedCoordinates; }
- (void)resizeSubviewsWithOldSize:(NSSize)oldSize {
    // Preserve the exact shared viewport and native input coordinates.
    self.renderer.frame = self.rendererBounds;
    self.renderer.bounds = self.rendererBounds;
    for (NSView *view in self.renderer.subviews)
        if (![view isKindOfClass:VoxCueChatBackground.class] && !VoxCueIsGlassControl(view) && !VoxCueIsScrollChrome(view) && !VoxCueIsContentControl(view)) view.frame = self.rendererBounds;
}
@end

@interface VoxCueSidebarBackground : NSView
@property(nonatomic) CGFloat sidebarWidth;
@property(nonatomic) CGFloat toolbarHeight;
@property(nonatomic, strong) NSView *glass;
@property(nonatomic, weak) NSView *mainWeb;
@property(nonatomic, weak) NSView *mainPaint;
@property(nonatomic, strong) VoxCueGlassContent *foreground;
@property(nonatomic, strong) VoxCueChatBackground *chatBackground;
@property(nonatomic, strong) NSColor *originalWindowBackground;
@property(nonatomic) BOOL originalWindowOpaque;
@property(nonatomic,strong) NSAppearance *originalWindowAppearance;
- (void)layoutMaterials;
- (void)restoreContentTo:(NSView *)host;
@end
@implementation VoxCueSidebarBackground
- (void)layoutMaterials {
    NSRect bounds = self.bounds;
    CGFloat width = MIN(self.sidebarWidth, NSWidth(bounds));
    // A single Electron view renders the shared sidebar and content. Host that
    // view inside glass rather than as its sibling. The existing opaque web
    // content covers the right-hand material; only the sidebar exposes glass.
    self.foreground.rendererBounds = bounds;
    self.glass.frame = bounds;
    [self.foreground resizeSubviewsWithOldSize:NSZeroSize];
    NSRect chat = NSMakeRect(width, 0, NSWidth(bounds) - width, NSHeight(bounds));
    self.chatBackground.frame = chat;
    self.chatBackground.hidden = self.toolbarHeight == 0;

}
- (void)resizeSubviewsWithOldSize:(NSSize)oldSize {
    [super resizeSubviewsWithOldSize:oldSize];
    [self layoutMaterials];
}
- (void)restoreContentTo:(NSView *)host {
    for (NSView *view in [self.foreground.renderer.subviews copy]) {
        if (view != self.chatBackground)
            [host addSubview:view positioned:NSWindowAbove relativeTo:nil];
    }
}


@end

static char sidebarKey;
NSView *VoxCueSharedRendererHost(NSView *host) {
    VoxCueSidebarBackground *background=objc_getAssociatedObject(host,&sidebarKey);
    return background ? background.foreground.renderer : host;
}
NSView *VoxCueSharedPaintView(NSView *host) {
    VoxCueSidebarBackground *background=objc_getAssociatedObject(host,&sidebarKey);
    return background.mainPaint;
}
NSView *VoxCueSharedWebView(NSView *host) {
    VoxCueSidebarBackground *background=objc_getAssociatedObject(host,&sidebarKey);
    return background.mainWeb;
}

NSView *VoxCueSidebarGlassContent(NSView *host, NSRect control) {
    VoxCueSidebarBackground *background=objc_getAssociatedObject(host,&sidebarKey);
    if(background && NSMinX(control)>=0 && NSMaxX(control)<=background.sidebarWidth)
        return background.foreground;
    return nil;
}

void VoxCuePositionGlassControl(NSView *host, NSView *control, bool behindContent) {
    VoxCueSidebarBackground *background = objc_getAssociatedObject(host, &sidebarKey);
    NSView *blur=VoxCueModalBackdropAnchor(host);
    NSView *parent = behindContent && background && !blur ? background.foreground.renderer : host;
    NSView *web = behindContent ? (blur ?: background.mainPaint) : blur;
    [parent addSubview:control positioned:(behindContent || blur) ? NSWindowBelow : NSWindowAbove relativeTo:web];
}

static void restoreFirstResponder(NSWindow *window, NSResponder *responder) {
    if (responder != window.firstResponder && [responder isKindOfClass:NSView.class] &&
        ((NSView *)responder).window == window) [window makeFirstResponder:responder];
}

static napi_value apply(napi_env env, napi_callback_info info) {
    size_t count = 5;
    napi_value args[5], result;
    void *bytes = nullptr;
    size_t length = 0;
    double width = 0;
    double toolbarHeight = 0;
    bool dark = false;
    bool buffer = false;
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    char surfaceText[8] = {}; size_t colorLength = 0;
    if (count != 5 || napi_is_buffer(env, args[0], &buffer) != napi_ok || !buffer ||
        napi_get_buffer_info(env, args[0], &bytes, &length) != napi_ok ||
        length != sizeof(void *) || napi_get_value_double(env, args[1], &width) != napi_ok ||
        napi_get_value_double(env, args[2], &toolbarHeight) != napi_ok ||
        napi_get_value_string_utf8(env, args[3], surfaceText, sizeof(surfaceText), &colorLength) != napi_ok || colorLength != 7 || surfaceText[0] != '#' ||
        napi_get_value_bool(env, args[4], &dark) != napi_ok ||
        !std::isfinite(toolbarHeight) || toolbarHeight < 0 || toolbarHeight > 96 ||
        !std::isfinite(width) || width < 0 || width > 320 || !NSThread.isMainThread) {
        napi_throw_error(env, nullptr, "Invalid sidebar presentation request");
        return nullptr;
    }
    bool active = false;
    @autoreleasepool {
        {
            void *pointer = nullptr;
            std::memcpy(&pointer, bytes, sizeof(pointer));
            NSView *nativeView = (__bridge NSView *)pointer;
            NSView *host = nativeView.window.contentView;
            if (host) {
                NSWindow *window = host.window;
                NSResponder *responder = window.firstResponder;
                VoxCueSidebarBackground *background = objc_getAssociatedObject(host, &sidebarKey);
                if (width == 0) {
                    VoxCueRemoveScrollChrome(host);
                    [background restoreContentTo:host];
                    if (background) {
                        window.backgroundColor = background.originalWindowBackground;
                        window.opaque = background.originalWindowOpaque;
                        window.appearance = background.originalWindowAppearance;
                    }
                    [background removeFromSuperview];
                    objc_setAssociatedObject(host, &sidebarKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
                    restoreFirstResponder(window, responder);
                } else {
                    if (!background) {
                        background = [[VoxCueSidebarBackground alloc] initWithFrame:host.bounds];
                        background.originalWindowBackground = window.backgroundColor;
                        background.originalWindowOpaque = window.isOpaque;
                        background.originalWindowAppearance = window.appearance;
                        background.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
                        window.appearance = [NSAppearance appearanceNamed:dark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
                        // Crop system edge highlights outside the viewport so
                        // they cannot look like rounded corners at an inner seam.
                        background.clipsToBounds = YES;
                        NSGlassEffectView *glass = [[NSGlassEffectView alloc] initWithFrame:background.bounds];
                        glass.style = NSGlassEffectViewStyleRegular;
                        glass.tintColor = nil;
                        glass.cornerRadius = 0;
                        VoxCueGlassContent *foreground = [[VoxCueGlassContent alloc] initWithFrame:host.bounds];
                        foreground.flippedCoordinates = host.isFlipped;
                        foreground.rendererBounds = host.bounds;
                        VoxCueGlassContent *renderer = [[VoxCueGlassContent alloc] initWithFrame:host.bounds];
                        renderer.flippedCoordinates = host.isFlipped;
                        foreground.renderer = renderer;
                        [foreground addSubview:renderer];
                        background.foreground = foreground;
                        glass.contentView = foreground;
                        background.glass = glass;
                        background.chatBackground = [[VoxCueChatBackground alloc] initWithFrame:NSZeroRect];
                        background.chatBackground.clipsToBounds = YES;
                        background.chatBackground.wantsLayer = YES;
                        [renderer addSubview:background.chatBackground];
                        [background addSubview:glass];
                        [host addSubview:background positioned:NSWindowAbove relativeTo:nil];
                        objc_setAssociatedObject(host, &sidebarKey, background,
                                                 OBJC_ASSOCIATION_RETAIN_NONATOMIC);
                    }
                    // Reconcile Electron's native children into glass.contentView,
                    // leaving only the other bounded native presentation layers.
                    for (NSView *view in [host.subviews copy]) {
                        if (view != background && !VoxCueIsGlassControl(view) && !VoxCueIsScrollChrome(view) && !VoxCueIsContentControl(view)) {
                            [background.foreground.renderer addSubview:view];
                            if(!background.mainPaint) background.mainPaint=view;
                            if(view.subviews.count) background.mainWeb=view;
                        }
                    }
                    if (background.foreground.renderer.subviews.count == 0) {
                        [background removeFromSuperview];
                        objc_setAssociatedObject(host, &sidebarKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
                        napi_throw_error(env, nullptr, "Electron content view is unavailable");
                        return nullptr;
                    }
                    background.sidebarWidth = width;
                    background.toolbarHeight = toolbarHeight;
                    window.appearance = [NSAppearance appearanceNamed:dark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
                    unsigned int rgb = 0; sscanf(surfaceText, "#%x", &rgb);
                    background.chatBackground.surfaceColor = [NSColor colorWithSRGBRed:((rgb >> 16) & 255) / 255.0 green:((rgb >> 8) & 255) / 255.0 blue:(rgb & 255) / 255.0 alpha:1];
                    background.chatBackground.layer.backgroundColor = background.chatBackground.surfaceColor.CGColor;
                    [background.chatBackground setNeedsDisplay:YES];
                    background.frame = host.bounds;
                    [background layoutMaterials];
                    // Electron's transparent web layer does not clear NSWindow's
                    // separate opaque system background. Glass otherwise samples
                    // that flat gray backing instead of the content behind it.
                    window.opaque = NO;
                    window.backgroundColor = NSColor.clearColor;
                    restoreFirstResponder(window, responder);
                    active = true;
                }
                VoxCueRaiseGlassControls(host);
            }
        }
    }
    napi_get_boolean(env, active, &result);
    return result;
}

static napi_value initialize(napi_env env, napi_value exports) {
    napi_property_descriptor properties[] = {
        {"apply", nullptr, apply, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"configureButton", nullptr, VoxCueConfigureGlassButton, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"popUpMenu", nullptr, VoxCuePopUpMenu, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"configureScrollChrome", nullptr, VoxCueConfigureScrollChrome, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"detachSurface", nullptr, VoxCueDetachSurface, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"attachSurface", nullptr, VoxCueAttachSurface, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"configureContentControls", nullptr, VoxCueConfigureContentControls, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"configureInterviewMaterials", nullptr, VoxCueConfigureInterviewMaterials, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"configureInterviewAppearance", nullptr, VoxCueConfigureInterviewAppearance, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
    napi_value available;
    napi_get_boolean(env, true, &available);
    napi_set_named_property(env, exports, "available", available);
    return exports;
}
NAPI_MODULE(voxcue_sidebar_glass, initialize)
