#include "InterviewMaterials.h"
#include "ScrollChrome.h"
#include "ContentControls.h"
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>
#include <cstring>

// The one Chromium renderer retains all text, input and event handling. Native
// backgrounds sit beneath its transparent paint, with a separate glass surface
// for each shared panel/bubble and the same scroll clipping as its foreground.
@interface VoxCueInterviewPlane : NSView
@end
@implementation VoxCueInterviewPlane
- (BOOL)isFlipped { return YES; }
- (NSView *)hitTest:(NSPoint)point { return nil; }
@end
@interface VoxCuePreviewBackdrop : NSView
@end
@implementation VoxCuePreviewBackdrop
- (void)drawRect:(NSRect)dirty {
    // A stable illustrative scene lets the settings preview show the same
    // real Clear/Regular materials without exposing the page beneath it.
    NSGradient *gradient=[[NSGradient alloc] initWithColors:@[
        [NSColor colorWithSRGBRed:.16 green:.24 blue:.38 alpha:1],
        [NSColor colorWithSRGBRed:.32 green:.27 blue:.45 alpha:1],
        [NSColor colorWithSRGBRed:.12 green:.29 blue:.36 alpha:1]]];
    [gradient drawInRect:self.bounds angle:35];
}
@end
@interface VoxCueInterviewDialogHalo : NSView
@property(nonatomic) CGFloat radius;
@end
@implementation VoxCueInterviewDialogHalo
- (void)drawRect:(NSRect)dirty { VoxCueDrawDialogHalo(self.bounds,NSInsetRect(self.bounds,32,32),self.radius,YES); }
@end
API_AVAILABLE(macos(26.0))
@interface VoxCueInterviewMaterial : VoxCueInterviewPlane
@property(nonatomic,strong) NSGlassEffectView *glass;
@property(nonatomic,strong) NSView *scene;
@property(nonatomic,strong) NSView *dimming;
@end
@implementation VoxCueInterviewMaterial
@end
API_AVAILABLE(macos(26.0))
@interface VoxCueInterviewMaterials : NSObject
@property(nonatomic,strong) VoxCueInterviewPlane *plane;
@property(nonatomic,strong) NSView *controls;
@property(nonatomic,strong) NSMutableDictionary<NSNumber *,VoxCueInterviewMaterial *> *views;
@property(nonatomic,strong) NSColor *background;
@property(nonatomic) BOOL opaque;
@property(nonatomic) BOOL ownsWindowBackground;
@end
@implementation VoxCueInterviewMaterials
@end
static char managerKey;
napi_value VoxCueConfigureInterviewAppearance(napi_env env,napi_callback_info info) {
    size_t count=1,length=0;napi_value argument,result;void *bytes=nullptr,*pointer=nullptr;
    napi_get_cb_info(env,info,&count,&argument,nullptr,nullptr);
    if(count!=1 || !NSThread.isMainThread || napi_get_buffer_info(env,argument,&bytes,&length)!=napi_ok || length!=sizeof(pointer)) {
        napi_throw_error(env,nullptr,"Invalid interview appearance request");return nullptr;
    }
    std::memcpy(&pointer,bytes,sizeof(pointer));NSView *host=(__bridge NSView *)pointer;
    NSAppearance *dark=[NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    host.appearance=dark;host.window.appearance=dark;
    napi_get_undefined(env,&result);return result;
}
NSView *VoxCueInterviewControlParent(NSView *host) {
    if(@available(macOS 26.0,*))return ((VoxCueInterviewMaterials *)objc_getAssociatedObject(host,&managerKey)).controls;
    return nil;
}
// Standard controls must actually descend from the glass contentView to
// receive AppKit's over-glass treatment; a glass bezel is a separate material.
NSView *VoxCueInterviewGlassContent(NSView *host, NSRect control) {
    if(@available(macOS 26.0,*)) {
        VoxCueInterviewMaterials *manager=objc_getAssociatedObject(host,&managerKey);
        NSRect rect=[manager.plane convertRect:control fromView:host];
        VoxCueInterviewMaterial *match=nil;CGFloat area=CGFLOAT_MAX;
        for(VoxCueInterviewMaterial *view in manager.views.allValues) {
            CGFloat size=NSWidth(view.frame)*NSHeight(view.frame);
            if(view.glass && !view.hidden && NSContainsRect(view.frame,rect) && size<area) { match=view;area=size; }
        }
        return match.glass.contentView;
    }
    return nil;
}
static napi_value property(napi_env env,napi_value object,const char *key) {
    napi_value value;napi_get_named_property(env,object,key,&value);return value;
}
static double number(napi_env env,napi_value object,const char *key) {
    double value=0;napi_get_value_double(env,property(env,object,key),&value);return value;
}
static NSRect rectangle(napi_env env,napi_value object) {
    return NSMakeRect(number(env,object,"x"),number(env,object,"y"),number(env,object,"width"),number(env,object,"height"));
}
napi_value VoxCueConfigureInterviewMaterials(napi_env env,napi_callback_info info) {
    size_t count=2,length=0;napi_value args[2],result;void *bytes=nullptr,*pointer=nullptr;
    napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
    if(count!=2 || !NSThread.isMainThread || napi_get_buffer_info(env,args[0],&bytes,&length)!=napi_ok || length!=sizeof(pointer)) {
        napi_throw_error(env,nullptr,"Invalid interview material request");return nullptr;
    }
    std::memcpy(&pointer,bytes,sizeof(pointer));NSView *host=((__bridge NSView *)pointer).window.contentView;
    uint32_t size=0;napi_get_array_length(env,args[1],&size);
    if(!host || size>256){napi_get_boolean(env,false,&result);return result;}
    if(@available(macOS 26.0,*)) {
        VoxCueInterviewMaterials *manager=objc_getAssociatedObject(host,&managerKey);
        if(!size) {
            VoxCueUpdateInterviewFollow(host,NSZeroRect,NO,NSZeroRect,0,NO);
            if(manager) {
                [manager.plane removeFromSuperview];
                if(manager.ownsWindowBackground) { host.window.backgroundColor=manager.background;host.window.opaque=manager.opaque; }
                objc_setAssociatedObject(host,&managerKey,nil,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
            }
            napi_get_boolean(env,false,&result);return result;
        }
        if(!manager) {
            manager=[VoxCueInterviewMaterials new];manager.views=[NSMutableDictionary dictionary];
            manager.background=host.window.backgroundColor;manager.opaque=host.window.opaque;
            manager.ownsWindowBackground=VoxCueSharedRendererHost(host)==host;
            manager.plane=[[VoxCueInterviewPlane alloc] initWithFrame:host.bounds];
            manager.plane.identifier=@"voxcue-interview-materials";
            manager.plane.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;
            manager.controls=[[NSView alloc] initWithFrame:host.bounds];
            manager.controls.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;
            [manager.plane addSubview:manager.controls];
            objc_setAssociatedObject(host,&managerKey,manager,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        }
        // Keep Chromium's native input/paint views and their original viewport.
        // Only the material plane is beneath them; empty canvas stays clear.
        NSView *parent=VoxCueSharedRendererHost(host),*paint=VoxCueSharedPaintView(host);
        [parent addSubview:manager.plane positioned:NSWindowBelow relativeTo:paint];
        manager.plane.frame=parent.bounds;manager.controls.frame=manager.plane.bounds;
        if(manager.ownsWindowBackground) { host.window.opaque=NO;host.window.backgroundColor=NSColor.clearColor; }
        NSMutableSet<NSNumber *> *seen=[NSMutableSet set];
        NSRect followFrame=NSZeroRect,modalFrame=NSZeroRect;CGFloat modalRadius=0;
        BOOL followEmphasized=NO;
        [CATransaction begin];[CATransaction setDisableActions:YES];
        for(uint32_t index=0;index<size;index++) {
            napi_value item;napi_get_element(env,args[1],index,&item);
            NSNumber *key=@((uint32_t)number(env,item,"id"));[seen addObject:key];
            char style[24]={};size_t styleLength=0;
            napi_get_value_string_utf8(env,property(env,item,"style"),style,sizeof(style),&styleLength);
            BOOL preview=std::strcmp(style,"preview-scene")==0,halo=std::strcmp(style,"dialog-halo")==0,darkNotice=std::strcmp(style,"regular-dark")==0;
            if(std::strcmp(style,"regular-interactive")==0 || std::strcmp(style,"regular-follow-hover")==0) {
                followFrame=[manager.plane convertRect:rectangle(env,item) toView:host];
                followEmphasized=std::strcmp(style,"regular-follow-hover")==0;
                [seen removeObject:key];continue;
            }
            if(halo) {
                modalFrame=[manager.plane convertRect:NSInsetRect(rectangle(env,item),32,32) toView:host];
                modalRadius=number(env,item,"radius");
            }
            VoxCueInterviewMaterial *view=manager.views[key];
            if(!view) {
                view=[[VoxCueInterviewMaterial alloc] initWithFrame:NSZeroRect];view.clipsToBounds=YES;view.wantsLayer=YES;
                if(preview || halo) { view.scene=halo?[[VoxCueInterviewDialogHalo alloc] initWithFrame:NSZeroRect]:[[VoxCuePreviewBackdrop alloc] initWithFrame:NSZeroRect];[view addSubview:view.scene]; }
                else {
                view.glass=[[NSGlassEffectView alloc] initWithFrame:NSZeroRect];
                view.glass.tintColor=nil;view.glass.contentView=[[NSView alloc] initWithFrame:NSZeroRect];
                view.glass.contentView.identifier=@"voxcue-over-glass-content";
                view.dimming=[[NSView alloc] initWithFrame:NSZeroRect];view.dimming.wantsLayer=YES;
                view.dimming.identifier=@"voxcue-interview-dimming";
                view.dimming.layer.backgroundColor=[NSColor colorWithWhite:0 alpha:.78].CGColor;
                [view addSubview:view.dimming];[view addSubview:view.glass];
                }
                manager.views[key]=view;
            }
            BOOL clear=std::strcmp(style,"clear")==0;
            view.glass.style=clear?NSGlassEffectViewStyleClear:NSGlassEffectViewStyleRegular;
            view.glass.tintColor=darkNotice?[NSColor colorWithWhite:0 alpha:.55]:nil;
            if(@available(macOS 27.0,*))view.glass.effectIsInteractive=std::strcmp(style,"regular-interactive")==0;
            view.dimming.hidden=!clear;
            // Interview and preview surfaces stay dark. Main-window cards
            // inherit their own window appearance.
            bool dark=false;napi_get_value_bool(env,property(env,item,"dark"),&dark);
            view.glass.appearance=clear || dark?[NSAppearance appearanceNamed:NSAppearanceNameDarkAqua]:nil;
            view.identifier=halo?@"voxcue-dialog-halo":preview?@"voxcue-interview-preview-scene":clear?@"voxcue-interview-clear":darkNotice?@"voxcue-interview-dark-notice":@"voxcue-interview-regular";
            CGFloat radius=number(env,item,"radius");bool rounded=false;
            napi_get_value_bool(env,property(env,item,"round"),&rounded);
            view.glass.cornerRadius=rounded?radius:0;
            view.alphaValue=number(env,item,"opacity");
            NSRect area=rectangle(env,item),clip=rectangle(env,property(env,item,"clip"));
            view.clipsToBounds=!NSEqualRects(area,clip);
            view.frame=clip;view.glass.frame=NSOffsetRect(area,-clip.origin.x,-clip.origin.y);
            view.dimming.frame=view.glass.frame;
            NSView *surface=preview || halo?view.scene:view.glass;
            if(preview || halo)view.scene.frame=NSOffsetRect(area,-clip.origin.x,-clip.origin.y);
            if(halo) { ((VoxCueInterviewDialogHalo *)view.scene).radius=radius;[view.scene setNeedsDisplay:YES]; }
            surface.wantsLayer=YES;
            if(!halo && (!rounded || preview)) {
                CAShapeLayer *contour=[CAShapeLayer layer];
                CGPathRef path=rounded?CGPathCreateWithRoundedRect(surface.bounds,radius,radius,nullptr):VoxCueContinuousContour(surface.bounds.size,radius);
                contour.path=path;CGPathRelease(path);surface.layer.mask=contour;
            } else surface.layer.mask=nil;
            // A separate black AppKit backing attenuates bright windows behind
            // Clear glass. Match the exact shared continuous contour on both.
            if(clear) {
                CAShapeLayer *dimmingContour=[CAShapeLayer layer];
                CGPathRef dimmingPath=rounded?CGPathCreateWithRoundedRect(view.dimming.bounds,radius,radius,nullptr):VoxCueContinuousContour(view.dimming.bounds.size,radius);
                dimmingContour.path=dimmingPath;CGPathRelease(dimmingPath);view.dimming.layer.mask=dimmingContour;
            }
            CGFloat fade=MIN(NSHeight(clip),number(env,item,"fadeBottom"));
            if(fade>0) {
                CAGradientLayer *mask=[CAGradientLayer layer];mask.frame=view.bounds;
                mask.startPoint=CGPointMake(.5,0);mask.endPoint=CGPointMake(.5,1);
                mask.colors=@[(__bridge id)NSColor.blackColor.CGColor,(__bridge id)NSColor.blackColor.CGColor,(__bridge id)NSColor.clearColor.CGColor];
                mask.locations=@[@0,@(MAX(0,1-fade/NSHeight(clip))),@1];view.layer.mask=mask;
            } else view.layer.mask=nil;
            [manager.plane addSubview:view positioned:NSWindowBelow relativeTo:manager.controls];
        }
        for(NSNumber *key in [manager.views.allKeys copy])if(![seen containsObject:key]) {
            [manager.views[key] removeFromSuperview];[manager.views removeObjectForKey:key];
        }
        VoxCueRefreshContentControlPlacement(host);
        VoxCueUpdateInterviewFollow(host,followFrame,!NSIsEmptyRect(followFrame),modalFrame,modalRadius,followEmphasized);
        [CATransaction commit];napi_get_boolean(env,true,&result);return result;
    }
    napi_get_boolean(env,false,&result);return result;
}
