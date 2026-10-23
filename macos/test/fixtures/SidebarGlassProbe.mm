#include <node_api.h>
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <objc/runtime.h>
#include <cstring>

// Test-only probe. Reads view geometry/style and draws a known opaque backdrop
// owned by this isolated process. Captures use current-process-only SC content,
// never a display or another app, and never request TCC access.
@interface VoxCueGlassTestBackdrop : NSView
@property(nonatomic) NSInteger variant;
@end
@implementation VoxCueGlassTestBackdrop
- (void)drawRect:(NSRect)dirty {
    if(self.variant==3) {
        [NSColor.whiteColor setFill];NSRectFill(self.bounds);
        NSDictionary *attributes=@{NSFontAttributeName:[NSFont systemFontOfSize:20],NSForegroundColorAttributeName:NSColor.blackColor};
        for(CGFloat y=12;y<NSHeight(self.bounds);y+=48)
            [@"Synthetic bright document — readable glass contrast 0123456789" drawAtPoint:NSMakePoint(12,y) withAttributes:attributes];
        return;
    }
    if(self.variant==2) {
        NSColor *start=[NSColor colorWithSRGBRed:.16 green:.20 blue:.30 alpha:1];
        NSColor *end=[NSColor colorWithSRGBRed:.055 green:.07 blue:.11 alpha:1];
        [[[NSGradient alloc] initWithStartingColor:start endingColor:end] drawInRect:self.bounds angle:35];
        [[NSColor colorWithWhite:.75 alpha:.15] setStroke];
        NSBezierPath *line=[NSBezierPath bezierPath];line.lineWidth=2;
        [line moveToPoint:NSMakePoint(0,NSHeight(self.bounds)*.2)];
        [line curveToPoint:NSMakePoint(NSWidth(self.bounds),NSHeight(self.bounds)*.8) controlPoint1:NSMakePoint(NSWidth(self.bounds)*.4,NSHeight(self.bounds)*.7) controlPoint2:NSMakePoint(NSWidth(self.bounds)*.7,0)];
        [line stroke];return;
    }
    NSArray<NSColor *> *colors = self.variant == 0
        ? @[[NSColor colorWithRed:1 green:0.1 blue:0.1 alpha:1], [NSColor colorWithRed:0.1 green:0.2 blue:1 alpha:1]]
        : @[[NSColor colorWithRed:0.1 green:1 blue:0.2 alpha:1], [NSColor colorWithRed:1 green:0.8 blue:0.1 alpha:1]];
    for (NSInteger index = 0; index * 80 < NSWidth(self.bounds); index++) {
        [colors[index % 2] setFill];
        NSRectFill(NSMakeRect(index * 80, 0, 80, NSHeight(self.bounds)));
    }
}
@end

static NSView *host(napi_env env, napi_value arg) {
    void *data = nullptr, *pointer = nullptr;
    size_t length = 0;
    if (napi_get_buffer_info(env, arg, &data, &length) != napi_ok || length != sizeof(pointer)) return nil;
    std::memcpy(&pointer, data, sizeof(pointer));
    return ((__bridge NSView *)pointer).window.contentView;
}
static NSArray *color(NSColor *source) {
    NSColor *rgb = [source colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
    return rgb ? @[@(rgb.redComponent), @(rgb.greenComponent), @(rgb.blueComponent), @(rgb.alphaComponent)] : @[];
}
static char lastMenuFrameKey;
static void interviewTreatment(NSView *view, bool tintOnly) {
    if(@available(macOS 26.0,*))if([view.identifier isEqualToString:@"voxcue-interview-clear"]) {
        // These are our own material-holder properties, never private AppKit keys.
        NSGlassEffectView *glass=[view valueForKey:@"glass"];
        NSView *dimming=[view valueForKey:@"dimming"];
        dimming.hidden=tintOnly;glass.tintColor=tintOnly?[NSColor colorWithWhite:0 alpha:.6]:nil;
    }
    for(NSView *child in view.subviews)interviewTreatment(child,tintOnly);
}
static napi_value tintComparison(napi_env env,napi_callback_info info) {
    size_t count=2;napi_value args[2],result;bool tintOnly=false;
    napi_get_cb_info(env,info,&count,args,nullptr,nullptr);napi_get_value_bool(env,args[1],&tintOnly);
    interviewTreatment(host(env,args[0]),tintOnly);napi_get_undefined(env,&result);return result;
}
static char lastMenuItemsKey;
static __weak NSView *menuOwner;
static NSString *menuSelection;
static __weak NSMenu *trackingMenu;
static NSUInteger menuGeneration=0;
static NSDictionary *tree(NSView *view, NSInteger depth) {
    NSMutableDictionary *node = [@{
        @"appearance": view.effectiveAppearance.name, @"class": NSStringFromClass(view.class), @"frame": NSStringFromRect(view.frame),
        @"bounds": NSStringFromRect(view.bounds), @"opaque": @(view.isOpaque),
        @"hidden": @(view.isHidden), @"alpha": @(view.alphaValue), @"identifier": view.identifier ?: @"",
        @"layerOpaque": @(view.layer.opaque), @"layerMasked": @(view.layer.mask!=nil),
        @"layerBackground": view.layer.backgroundColor ? color([NSColor colorWithCGColor:view.layer.backgroundColor]) : @[],
    } mutableCopy];
    if([view.identifier isEqualToString:@"voxcue-header-title"] || [view isKindOfClass:NSButton.class]) {
        NSView *root=view.window.contentView;NSRect frame=[view convertRect:view.bounds toView:root];
        node[@"centerY"]=@(root.isFlipped?NSMidY(frame):NSHeight(root.bounds)-NSMidY(frame));
        node[@"centerX"]=@(NSMidX(frame));
    }
    if([view.identifier isEqualToString:@"voxcue-header-title"]) {
        node[@"text"]=((NSTextField *)view).stringValue;
        node[@"frameHeight"]=@(NSHeight(view.frame));node[@"fittingHeight"]=@(view.fittingSize.height);
    }
    if([NSStringFromClass(view.class) isEqualToString:@"VoxCueModalBackground"]) node[@"exclusion"]=NSStringFromRect([[view valueForKey:@"exclusion"] rectValue]);
    if ([view isKindOfClass:NSProgressIndicator.class]) {
        NSProgressIndicator *progress=(NSProgressIndicator *)view;
        node[@"progressStyle"]=@(progress.style);node[@"indeterminate"]=@(progress.indeterminate);
        node[@"value"]=@(progress.doubleValue);node[@"controlSize"]=@(progress.controlSize);
        node[@"frameWidth"]=@(NSWidth(progress.frame));node[@"frameHeight"]=@(NSHeight(progress.frame));
    }
    if ([view isKindOfClass:NSSwitch.class]) node[@"state"] = @(((NSSwitch *)view).state);
    if ([view isKindOfClass:NSSlider.class]) {
        NSSlider *slider=(NSSlider *)view;node[@"value"]=@(slider.doubleValue);
        node[@"minimum"]=@(slider.minValue);node[@"maximum"]=@(slider.maxValue);
        node[@"continuous"]=@(slider.isContinuous);node[@"enabled"]=@(slider.enabled);
    }
    if ([view isKindOfClass:NSSearchField.class]) {
        NSSearchField *field=(NSSearchField *)view;
        node[@"value"]=field.stringValue;node[@"textBounds"]=NSStringFromRect(field.searchTextBounds);
        node[@"bezeled"]=@(field.bezeled);
        if(@available(macOS 26.0,*))node[@"borderShape"]=@(field.borderShape);
        node[@"textLeft"]=@(NSMinX(field.searchTextBounds));
        if(field.currentEditor)node[@"editorLeft"]=@(NSMinX([field convertRect:field.currentEditor.bounds fromView:field.currentEditor]));
        node[@"focusRingType"]=@(field.focusRingType);
        NSView *container=field.superview;
        while(container && ![NSStringFromClass(container.class) isEqualToString:@"VoxCueContentHost"])container=container.superview;
        for(NSView *sibling in container.superview.subviews)
            if([NSStringFromClass(sibling.class) isEqualToString:@"VoxCueScrollChrome"])
                node[@"underScrollChrome"]=@([container.superview.subviews indexOfObject:container]<[container.superview.subviews indexOfObject:sibling]);
        node[@"editing"]=@(field.currentEditor != nil);
        NSView *root=field.window.contentView;
        NSRect cancel=[field convertRect:field.cancelButtonBounds toView:root];
        node[@"cancelPoint"]=@{@"x":@(NSMidX(cancel)),@"y":@(root.isFlipped?NSMidY(cancel):NSHeight(root.bounds)-NSMidY(cancel))};
    }
    if ([view isKindOfClass:NSButton.class]) node[@"image"] = @(((NSButton *)view).image != nil);
    if ([NSStringFromClass(view.class) isEqualToString:@"VoxCueContentHost"]) node[@"contentId"] = [view valueForKey:@"identity"];
    if ([NSStringFromClass(view.class) isEqualToString:@"VoxCueLoginBackdrop"]) {
        node[@"dark"] = [view valueForKey:@"dark"];
        CAGradientLayer *base=[view valueForKey:@"base"];
        node[@"baseAttached"]=@(base.superlayer==view.layer);
        node[@"baseColor"]=base.colors.count?color([NSColor colorWithCGColor:(__bridge CGColorRef)base.colors[0]]):@[];
    }
    if ([NSStringFromClass(view.class) isEqualToString:@"VoxCueForegroundSurface"] && [view.layer.mask isKindOfClass:CAShapeLayer.class]) {
        CGPathRef mask=((CAShapeLayer *)view.layer.mask).path;
        node[@"maskEmpty"]=@(CGPathIsEmpty(mask));
        node[@"maskCorner"]=@(CGPathContainsPoint(mask,nullptr,CGPointMake(1,1),false));
    }
    if ([NSStringFromClass(view.class) isEqualToString:@"VoxCueGlassControlHost"])
        node[@"behindContent"] = [view valueForKey:@"behindContent"];
    if (@available(macOS 26.0, *)) if ([view isKindOfClass:NSButton.class]) {
        NSButton *button = (NSButton *)view;
        BOOL inGlassContent=NO,inSystemGlassContent=NO;
        for(NSView *ancestor=view.superview;ancestor;ancestor=ancestor.superview) {
            if([ancestor.identifier isEqualToString:@"voxcue-over-glass-content"])inGlassContent=YES;
            if([ancestor isKindOfClass:NSGlassEffectView.class] &&
               [view isDescendantOf:((NSGlassEffectView *)ancestor).contentView])inSystemGlassContent=YES;
        }
        node[@"inGlassContent"]=@(inGlassContent);
        node[@"inSystemGlassContent"]=@(inSystemGlassContent);
        node[@"windowKey"]=@(view.window.isKeyWindow);
        node[@"bezelStyle"] = @(button.bezelStyle); node[@"borderShape"] = @(button.borderShape);
        node[@"title"] = button.title; node[@"enabled"] = @(button.enabled);
        node[@"highlighted"]=@(button.cell.highlighted);
        node[@"bordered"]=@(button.bordered);
        node[@"hoverBorderOnly"]=@(button.showsBorderOnlyWhileMouseInside);
        node[@"imagePosition"]=@(button.imagePosition);
        node[@"focusRingType"]=@(button.focusRingType);
        node[@"showsFirstResponder"]=@(button.cell.showsFirstResponder);
        node[@"contentCentered"]=@(button.imageHugsTitle && button.alignment==NSTextAlignmentCenter);
        node[@"fittingWidth"]=@(button.fittingSize.width);node[@"frameWidth"]=@(NSWidth(button.frame));
        node[@"frameHeight"]=@(NSHeight(button.frame));node[@"controlSize"]=@(button.controlSize);
        NSRect imageFrame=[button convertRect:[button.cell imageRectForBounds:button.bounds] toView:view.window.contentView];
        node[@"imageLeft"]=@(NSMinX(imageFrame));
        NSView *contentHost=button.superview;
        if([NSStringFromClass(contentHost.class) isEqualToString:@"VoxCueContentHost"])
            for(NSView *sibling in contentHost.superview.subviews)
                if([NSStringFromClass(sibling.class) isEqualToString:@"VoxCueScrollChrome"])
                    node[@"underScrollChrome"]=@([contentHost.superview.subviews indexOfObject:contentHost]<[contentHost.superview.subviews indexOfObject:sibling]);
        node[@"tintProminence"] = @(button.tintProminence);
        node[@"bezelColor"] = color(button.bezelColor);
        node[@"foregroundColor"] = color(button.contentTintColor);
        if(button.attributedTitle.length)node[@"titleColor"]=color([button.attributedTitle attribute:NSForegroundColorAttributeName atIndex:0 effectiveRange:nil]);
    }
    if (@available(macOS 26.0, *)) {
        if ([view isKindOfClass:NSGlassEffectView.class]) {
            NSGlassEffectView *glass = (NSGlassEffectView *)view;
            node[@"style"] = @(glass.style);
            if (@available(macOS 27.0, *)) node[@"interactive"] = @(glass.effectIsInteractive);
            node[@"radius"] = @(glass.cornerRadius);
            node[@"tint"] = color(glass.tintColor);
            node[@"contentClass"] = NSStringFromClass(glass.contentView.class);
            if([NSStringFromClass(view.class) isEqualToString:@"VoxCueForegroundSurface"]) {
                NSView *web=[view valueForKey:@"web"];
                node[@"foregroundAttached"]=@(web && [web isDescendantOf:glass.contentView]);
            }
        }
    }
    if (depth < 28) {
        NSMutableArray *children = [NSMutableArray array];
        for (NSView *child in view.subviews) [children addObject:tree(child, depth + 1)];
        node[@"children"] = children;
    }
    return node;
}
static NSView *glassIn(NSView *view) {
    if (@available(macOS 26.0, *)) {
        if ([view isKindOfClass:NSGlassEffectView.class]) return view;
    }
    for (NSView *child in view.subviews) if (NSView *match = glassIn(child)) return match;
    return nil;
}
static napi_value inspect(napi_env env, napi_callback_info info) {
    size_t count = 1; napi_value arg, result; napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr);
    NSView *view = host(env, arg);
    NSMutableArray *controls = [NSMutableArray array];
    const NSWindowButton kinds[] = { NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton };
    for (NSWindowButton kind : kinds) {
        NSButton *button = [view.window standardWindowButton:kind];
        NSRect rect = [view convertRect:button.bounds fromView:button];
        [controls addObject:@{ @"x": @(NSMinX(rect)), @"right": @(NSMaxX(rect)),
            @"centerY": @(view.isFlipped ? NSMidY(rect) : NSHeight(view.bounds) - NSMidY(rect)) }];
    }
    NSDictionary *lastMenu=objc_getAssociatedObject(view,&lastMenuFrameKey) ?: @{};
    NSDictionary *state = @{
        @"menuFrame": lastMenu,
        @"menuItems": objc_getAssociatedObject(view,&lastMenuItemsKey) ?: @[],
        @"menuGeneration": @(menuGeneration), @"menuTracking": @(trackingMenu != nil),
        @"trafficLights": controls,
        @"windowKey": @(view.window.isKeyWindow),
        @"windowAppearance": view.window.effectiveAppearance.name,
        @"windowOpaque": @(view.window.isOpaque), @"windowBackground": color(view.window.backgroundColor),
        @"windowFrame": NSStringFromRect(view.window.frame),
        @"reduceTransparency": @(NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency),
        @"increaseContrast": @(NSWorkspace.sharedWorkspace.accessibilityDisplayShouldIncreaseContrast),
        @"tree": tree(view, 0),
    };
    NSData *json = [NSJSONSerialization dataWithJSONObject:state options:0 error:nil];
    napi_create_string_utf8(env, (const char *)json.bytes, json.length, &result); return result;
}
static NSSwitch *switchIn(NSView *view) {
    if ([view isKindOfClass:NSSwitch.class]) return (NSSwitch *)view;
    for (NSView *child in view.subviews) if (NSSwitch *match = switchIn(child)) return match;
    return nil;
}
static napi_value clickSwitch(napi_env env, napi_callback_info info) {
    size_t count = 1; napi_value arg, result;
    napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr);
    NSSwitch *control = switchIn(host(env, arg));
    if (!control) { napi_throw_error(env, nullptr, "Native switch is unavailable"); return nullptr; }
    [control performClick:nil];
    napi_get_boolean(env, control.state == NSControlStateValueOn, &result); return result;
}
static napi_value clickAt(napi_env env, napi_callback_info info) {
    size_t count = 2; napi_value args[2], value, result;
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    NSView *view = host(env, args[0]); double x = 0, y = 0;
    // A preview pause can leave Codex in front. Activate only this isolated
    // application's owned window before exercising its real event route.
    [NSApp activate];[view.window makeKeyWindow];
    napi_get_named_property(env, args[1], "x", &value); napi_get_value_double(env, value, &x);
    napi_get_named_property(env, args[1], "y", &value); napi_get_value_double(env, value, &y);
    NSPoint point = [view convertPoint:NSMakePoint(x, view.isFlipped ? y : NSHeight(view.bounds) - y) toView:nil];
    // Post only to this isolated application's own window. These are synthetic
    // AppKit events, not global mouse injection or hardware input/capture.
    NSTimeInterval time = NSProcessInfo.processInfo.systemUptime;
    NSEvent *down = [NSEvent mouseEventWithType:NSEventTypeLeftMouseDown location:point
        modifierFlags:0 timestamp:time windowNumber:view.window.windowNumber context:nil
        eventNumber:0 clickCount:1 pressure:1];
    NSEvent *up = [NSEvent mouseEventWithType:NSEventTypeLeftMouseUp location:point
        modifierFlags:0 timestamp:time + 0.01 windowNumber:view.window.windowNumber context:nil
        eventNumber:1 clickCount:1 pressure:0];
    [NSApp postEvent:down atStart:NO]; [NSApp postEvent:up atStart:NO];
    NSPoint local = NSMakePoint(x, view.isFlipped ? y : NSHeight(view.bounds) - y);
    NSView *hit = [view hitTest:[view convertPoint:local toView:view.superview]];
    BOOL nativeSwitch=NO,nativeSlider=NO;for(NSView *node=hit;node;node=node.superview) { if([node isKindOfClass:NSSwitch.class])nativeSwitch=YES;if([node isKindOfClass:NSSlider.class])nativeSlider=YES; }
    NSDictionary *details = @{ @"nativeSwitch":@(nativeSwitch),@"nativeSlider":@(nativeSlider), @"hit": hit ? NSStringFromClass(hit.class) : @"nil", @"point": NSStringFromPoint([hit convertPoint:local fromView:view]), @"frame": hit ? NSStringFromRect(hit.frame) : @"nil" };
    NSData *json = [NSJSONSerialization dataWithJSONObject:details options:0 error:nil];
    napi_create_string_utf8(env, (const char *)json.bytes, json.length, &result); return result;
}
static napi_value moveAt(napi_env env,napi_callback_info info) {
    size_t count=2;napi_value args[2],value,result;double x=0,y=0;
    napi_get_cb_info(env,info,&count,args,nullptr,nullptr);NSView *view=host(env,args[0]);
    napi_get_named_property(env,args[1],"x",&value);napi_get_value_double(env,value,&x);
    napi_get_named_property(env,args[1],"y",&value);napi_get_value_double(env,value,&y);
    if(x<0 || y<0 || x>=NSWidth(view.bounds) || y>=NSHeight(view.bounds)) {
        napi_throw_error(env,nullptr,"Mouse movement must stay inside the owned window");return nullptr;
    }
    NSPoint point=[view convertPoint:NSMakePoint(x,view.isFlipped?y:NSHeight(view.bounds)-y) toView:nil];
    NSEvent *event=[NSEvent mouseEventWithType:NSEventTypeMouseMoved location:point modifierFlags:0
        timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:view.window.windowNumber context:nil
        eventNumber:0 clickCount:0 pressure:0];
    [view.window sendEvent:event];
    napi_get_undefined(env,&result);return result;
}
static char backdropKey;
static napi_value backdrop(napi_env env, napi_callback_info info) {
    size_t count = 2; napi_value args[2], result; int32_t variant = 0;
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr); napi_get_value_int32(env, args[1], &variant);
    NSView *view = host(env, args[0]); NSView *glass = glassIn(view);
    NSWindow *backdropWindow = objc_getAssociatedObject(view, &backdropKey);
    if (variant < 0) {
        if (backdropWindow) {
            [view.window removeChildWindow:backdropWindow];
            [backdropWindow close];
        }
        objc_setAssociatedObject(view, &backdropKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        napi_get_boolean(env, true, &result); return result;
    }
    if (!backdropWindow) {
        backdropWindow = [[NSWindow alloc] initWithContentRect:NSInsetRect(view.window.frame, -128, -128)
            styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
        backdropWindow.releasedWhenClosed = NO;
        backdropWindow.opaque = YES;
        backdropWindow.hasShadow = NO;
        backdropWindow.ignoresMouseEvents = YES;
        backdropWindow.backgroundColor = NSColor.whiteColor;
        backdropWindow.contentView = [[VoxCueGlassTestBackdrop alloc] initWithFrame:backdropWindow.contentView.bounds];
        [view.window addChildWindow:backdropWindow ordered:NSWindowBelow];
        objc_setAssociatedObject(view, &backdropKey, backdropWindow, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
    [backdropWindow setFrame:NSInsetRect(view.window.frame, -128, -128) display:YES];
    VoxCueGlassTestBackdrop *backdrop = (VoxCueGlassTestBackdrop *)backdropWindow.contentView;
    backdrop.variant = variant; [backdrop setNeedsDisplay:YES]; [backdropWindow displayIfNeeded];
    napi_get_boolean(env, glass != nil, &result); return result;
}
struct Screenshot {
    napi_deferred deferred;
    napi_threadsafe_function finish;
    NSData *png;
    NSString *error;
    CGRect crop;
};
static void deliver(napi_env env, napi_value, void *, void *data) {
    auto *pending = static_cast<Screenshot *>(data);
    napi_value value;
    if (pending->error) {
        napi_value message;
        napi_create_string_utf8(env, pending->error.UTF8String, NAPI_AUTO_LENGTH, &message);
        napi_create_error(env, nullptr, message, &value);
        napi_reject_deferred(env, pending->deferred, value);
    } else {
        napi_create_object(env, &value);
        napi_value png, crop;
        napi_create_buffer_copy(env, pending->png.length, pending->png.bytes, nullptr, &png);
        napi_set_named_property(env, value, "png", png);
        napi_create_object(env, &crop);
        const char *names[] = {"x", "y", "width", "height"};
        double numbers[] = {pending->crop.origin.x, pending->crop.origin.y, pending->crop.size.width, pending->crop.size.height};
        for (int index = 0; index < 4; index++) {
            napi_value number; napi_create_double(env, numbers[index], &number);
            napi_set_named_property(env, crop, names[index], number);
        }
        napi_set_named_property(env, value, "crop", crop);
        napi_resolve_deferred(env, pending->deferred, value);
    }
    delete pending;
}
static void finish(Screenshot *pending) {
    napi_threadsafe_function callback = pending->finish;
    napi_call_threadsafe_function(callback, pending, napi_tsfn_nonblocking);
    napi_release_threadsafe_function(callback, napi_tsfn_release);
}
static napi_value snapshot(napi_env env, napi_callback_info info) {
    size_t count = 1; napi_value arg, promise, name;
    napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr);
    NSView *view = host(env, arg);
    if (!objc_getAssociatedObject(view, &backdropKey)) {
        napi_throw_error(env, nullptr, "Native preview requires the owned opaque synthetic backdrop"); return nullptr;
    }
    auto *pending = new Screenshot{};
    napi_create_promise(env, &pending->deferred, &promise);
    napi_create_string_utf8(env, "Own-process synthetic glass preview", NAPI_AUTO_LENGTH, &name);
    napi_create_threadsafe_function(env, nullptr, nullptr, name, 0, 1, nullptr, nullptr, nullptr, deliver, &pending->finish);
    CGWindowID target = (CGWindowID)view.window.windowNumber;
    CGWindowID backdrop = (CGWindowID)((NSWindow *)objc_getAssociatedObject(view, &backdropKey)).windowNumber;
    [SCShareableContent getCurrentProcessShareableContentWithCompletionHandler:^(SCShareableContent *content, NSError *error) {
        SCWindow *window = nil;
        SCWindow *child = nil;
        for (SCWindow *candidate in content.windows) if (candidate.windowID == target) window = candidate;
        for (SCWindow *candidate in content.windows) if (candidate.windowID == backdrop) child = candidate;
        if (error || !window || !child) {
            pending->error = error.localizedDescription ?: @"Owned synthetic window is not available";
            finish(pending); return;
        }
        SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:window];
        SCStreamConfiguration *configuration = [[SCStreamConfiguration alloc] init];
        // Use compositor metadata, not an assumed margin: AppKit may constrain
        // the first window position while its owned backdrop is being ordered.
        CGRect extent = CGRectUnion(window.frame, child.frame);
        pending->crop = CGRectMake(window.frame.origin.x - extent.origin.x, window.frame.origin.y - extent.origin.y, window.frame.size.width, window.frame.size.height);
        configuration.width = extent.size.width; configuration.height = extent.size.height;
        configuration.showsCursor = NO; configuration.ignoreShadowsSingleWindow = YES;
        configuration.ignoreGlobalClipSingleWindow = YES;
        configuration.scalesToFit = YES;
        configuration.includeChildWindows = YES;
        [SCScreenshotManager captureImageWithFilter:filter configuration:configuration completionHandler:^(CGImageRef image, NSError *captureError) {
            if (captureError || !image) pending->error = captureError.localizedDescription ?: @"Own-window capture failed";
            else pending->png = [[[NSBitmapImageRep alloc] initWithCGImage:image] representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
            finish(pending);
        }];
    }];
    return promise;
}
// Own-window synthetic keyboard events let NSMenu run its normal native
// tracking loop without injecting input into any other application.
static napi_value menuKeys(napi_env env,napi_callback_info info) {
    size_t count=2;napi_value args[2],result;uint32_t size=0;napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
    NSWindow *window=host(env,args[0]).window;napi_get_array_length(env,args[1],&size);
    menuOwner=window.contentView;
    NSUInteger generation=menuGeneration+1;
    for(uint32_t i=0;i<size && i<20;i++) {
        napi_value value;int32_t key=0;napi_get_element(env,args[1],i,&value);napi_get_value_int32(env,value,&key);
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW,(int64_t)((.5+i*.12)*NSEC_PER_SEC)),dispatch_get_main_queue(),^{
            if(!window.isVisible || !trackingMenu || menuGeneration!=generation) return;
            NSView *root=window.contentView;
            for(NSWindow *candidate in NSApp.orderedWindows) if(candidate!=window && candidate.isVisible && candidate.level>=NSPopUpMenuWindowLevel) {
                NSRect frame=[root convertRect:[window convertRectFromScreen:candidate.frame] fromView:nil];
                NSDictionary *geometry=@{@"x":@(frame.origin.x),@"y":@(root.isFlipped?frame.origin.y:NSHeight(root.bounds)-NSMaxY(frame)),@"width":@(frame.size.width),@"height":@(frame.size.height)};
                objc_setAssociatedObject(root,&lastMenuFrameKey,geometry,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
            }
            unichar character=key==125?NSDownArrowFunctionKey:key==126?NSUpArrowFunctionKey:key==53?0x1b:0x0d;
            NSString *text=[NSString stringWithCharacters:&character length:1];
            for(NSNumber *kind in @[@(NSEventTypeKeyDown),@(NSEventTypeKeyUp)]) {
                NSEvent *event=[NSEvent keyEventWithType:(NSEventType)kind.integerValue location:NSZeroPoint modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:window.windowNumber context:nil characters:text charactersIgnoringModifiers:text isARepeat:NO keyCode:(unsigned short)key];
                [NSApp postEvent:event atStart:NO];
            }
        });
    }
    napi_get_undefined(env,&result);return result;
}
static napi_value selectMenuItem(napi_env env,napi_callback_info info) {
    size_t count=2,length=0;napi_value args[2],result;char title[512]={};
    napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
    menuOwner=host(env,args[0]);napi_get_value_string_utf8(env,args[1],title,sizeof(title),&length);
    menuSelection=[NSString stringWithUTF8String:title];napi_get_undefined(env,&result);return result;
}
static napi_value typeOwnText(napi_env env,napi_callback_info info) {
    size_t count=2,length=0;napi_value args[2],result;char text[512]={};
    napi_get_cb_info(env,info,&count,args,nullptr,nullptr);NSWindow *window=host(env,args[0]).window;
    napi_get_value_string_utf8(env,args[1],text,sizeof(text),&length);
    NSString *characters=[NSString stringWithUTF8String:text];
    // Commit synthetic IME text through the owned native field editor. A
    // made-up physical key code cannot represent arbitrary Chinese text.
    id<NSTextInputClient> client=(id)window.firstResponder;
    if(![client respondsToSelector:@selector(insertText:replacementRange:)]) {
        napi_throw_error(env,nullptr,"Owned window has no text input client");return nullptr;
    }
    [client insertText:characters replacementRange:NSMakeRange(NSNotFound,0)];
    napi_get_undefined(env,&result);return result;
}
static void setHeaderHidden(NSView *view,BOOL hidden) {
    if([view.identifier isEqualToString:@"voxcue-header-material"])view.hidden=hidden;
    for(NSView *child in view.subviews)setHeaderHidden(child,hidden);
}
static napi_value headerHidden(napi_env env,napi_callback_info info) {
    size_t count=2;napi_value args[2],result;bool hidden=false;
    napi_get_cb_info(env,info,&count,args,nullptr,nullptr);napi_get_value_bool(env,args[1],&hidden);
    setHeaderHidden(host(env,args[0]),hidden);napi_get_undefined(env,&result);return result;
}
static napi_value initialize(napi_env env, napi_value exports) {
    [NSNotificationCenter.defaultCenter addObserverForName:NSMenuDidBeginTrackingNotification object:nil queue:nil usingBlock:^(NSNotification *notification) {
        if(!menuOwner || ![notification.object isKindOfClass:NSMenu.class]) return;
        trackingMenu=notification.object;menuGeneration++;
        NSMutableArray *items=[NSMutableArray array];
        for(NSMenuItem *item in ((NSMenu *)notification.object).itemArray) {
            BOOL visible=item.image!=nil;
            if(@available(macOS 27.0,*))visible=visible && item.preferredImageVisibility==NSMenuItemImageVisibilityVisible;
            [items addObject:@{@"title":item.title,@"image":@(item.image!=nil),@"imageVisible":@(visible),@"separator":@(item.isSeparatorItem)}];
        }
        objc_setAssociatedObject(menuOwner,&lastMenuItemsKey,items,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        if(menuSelection) {
            NSMenu *menu=notification.object;NSString *title=menuSelection;menuSelection=nil;
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW,300*NSEC_PER_MSEC),dispatch_get_main_queue(),^{
                if(trackingMenu!=menu)return;
                NSInteger index=[menu indexOfItemWithTitle:title];
                if(index>=0) [menu performActionForItemAtIndex:index];
                [menu cancelTracking];
            });
        }
    }];
    [NSNotificationCenter.defaultCenter addObserverForName:NSMenuDidEndTrackingNotification object:nil queue:nil usingBlock:^(NSNotification *notification) {
        if(trackingMenu==notification.object)trackingMenu=nil;
    }];
    napi_property_descriptor properties[] = {
        {"inspect", nullptr, inspect, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"tintComparison", nullptr, tintComparison, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"backdrop", nullptr, backdrop, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"snapshot", nullptr, snapshot, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"clickSwitch", nullptr, clickSwitch, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"clickAt", nullptr, clickAt, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"moveAt", nullptr, moveAt, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"menuKeys", nullptr, menuKeys, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"selectMenuItem", nullptr, selectMenuItem, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"typeText", nullptr, typeOwnText, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"headerHidden", nullptr, headerHidden, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, 11, properties); return exports;
}
NAPI_MODULE(voxcue_sidebar_glass_probe, initialize)
