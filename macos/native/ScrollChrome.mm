#include "ScrollChrome.h"
#include "ContentControls.h"
#import <objc/runtime.h>
#import <QuartzCore/QuartzCore.h>
#include <cstring>

// The header and interactive surfaces share AppKit's Regular glass material.
// Shared content geometry controls header visibility; AppKit renders the blur.
API_AVAILABLE(macos(26.0))
@interface VoxCueForegroundSurface : NSGlassEffectView
@property(nonatomic,strong) NSView *web;
@property(nonatomic,strong) NSWindow *owner;
@property(nonatomic,strong) NSView *projection;
@property(nonatomic,weak) NSView *host;
@property(nonatomic) BOOL blocked;
- (void)place;
- (void)detach;
@end
@implementation VoxCueForegroundSurface
- (NSView *)hitTest:(NSPoint)point {
    return self.blocked || [self.identifier isEqualToString:@"voxcue-follow-material"] ? nil : [super hitTest:point];
}
- (void)place {
    if(!self.web || self.hidden)return;
    self.projection.frame=self.bounds;
    NSRect frame=[self.projection convertRect:self.host.bounds fromView:self.host];
    if(!NSEqualRects(self.web.frame,frame))self.web.frame=frame;
    if(!NSEqualRects(self.web.bounds,self.host.bounds))self.web.bounds=self.host.bounds;
}
- (void)detach {
    if(self.web)self.owner.contentView=self.web;
    self.web=nil;self.owner=nil;[self removeFromSuperview];
}
@end
@class VoxCueModalBackground;
API_AVAILABLE(macos(26.0))
@interface VoxCueScrollChrome : NSView
@property(nonatomic,strong) NSGlassEffectView *header;
@property(nonatomic,strong) VoxCueModalBackground *modalBackdrop;
@property(nonatomic,strong) NSTextField *title;
@property(nonatomic,strong) VoxCueForegroundSurface *composer;
@property(nonatomic,strong) VoxCueForegroundSurface *follow;
@property(nonatomic,weak) NSView *host;
@property(nonatomic) BOOL blocked;
@end
@implementation VoxCueScrollChrome
- (NSView *)hitTest:(NSPoint)point {
    if(self.blocked)return nil;
    for(VoxCueForegroundSurface *surface in @[self.follow ?: (id)NSNull.null,self.composer ?: (id)NSNull.null]) {
        if((id)surface==NSNull.null || surface.hidden || !surface.web)continue;
        // The projected web view spans the viewport, but its glass surface
        // only owns this contour. Do not let the composer's event view catch
        // clicks on the original follow button or other message controls.
        NSPoint within=[surface convertPoint:point fromView:self.superview];
        if(!NSPointInRect(within,surface.bounds))continue;
        if([surface.layer.mask isKindOfClass:CAShapeLayer.class] && !CGPathContainsPoint(((CAShapeLayer *)surface.layer.mask).path,nullptr,within,false))continue;
        NSPoint local=[surface.superview convertPoint:point fromView:self.superview];
        NSView *hit=[surface hitTest:local];if(hit)return hit;
    }
    return nil;
}
@end
static CGPathRef dialogPath(NSRect frame,CGFloat radius) {
    CGPathRef local=VoxCueContinuousContour(frame.size,radius);
    CGAffineTransform translation=CGAffineTransformMakeTranslation(frame.origin.x,frame.origin.y);
    CGPathRef result=CGPathCreateCopyByTransformingPath(local,&translation);CGPathRelease(local);return result;
}
@interface VoxCueModalBackground : NSView
@property(nonatomic) NSRect exclusion;
@property(nonatomic) CGFloat radius;
@end
@implementation VoxCueModalBackground
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (void)drawRect:(NSRect)dirty {
    CGContextRef context=NSGraphicsContext.currentContext.CGContext;
    CGContextSaveGState(context);CGContextAddRect(context,self.bounds);
    CGPathRef hole=dialogPath(self.exclusion,self.radius);
    CGContextAddPath(context,hole);CGContextEOClip(context);
    [[NSColor colorWithWhite:0 alpha:.4] setFill];NSRectFill(self.bounds);
    CGPathRelease(hole);CGContextRestoreGState(context);
}
@end
static char chromeKey;
API_AVAILABLE(macos(26.0))
@interface VoxCueInterviewFollow : NSObject
@property(nonatomic,strong) VoxCueForegroundSurface *surface;
@property(nonatomic) NSRect frame;
@property(nonatomic) NSRect modal;
@property(nonatomic) CGFloat modalRadius;
@property(nonatomic) BOOL visible;
@property(nonatomic) BOOL emphasized;
@end
@implementation VoxCueInterviewFollow
@end
static char interviewFollowKey;
static NSColor *followHoverTint(NSView *surface,BOOL emphasized) {
    if(!emphasized)return nil;
    BOOL dark=[[surface.effectiveAppearance bestMatchFromAppearancesWithNames:@[NSAppearanceNameAqua,NSAppearanceNameDarkAqua]] isEqualToString:NSAppearanceNameDarkAqua];
    return [NSColor colorWithWhite:dark?1:0 alpha:.12];
}
void VoxCueUpdateInterviewFollow(NSView *host, NSRect frame, BOOL visible, NSRect modal, CGFloat modalRadius, BOOL emphasized) {
    {
        VoxCueInterviewFollow *follow=objc_getAssociatedObject(host,&interviewFollowKey);
        if(!follow && visible) {
            follow=[VoxCueInterviewFollow new];
            objc_setAssociatedObject(host,&interviewFollowKey,follow,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        }
        follow.frame=frame;follow.visible=visible;follow.modal=modal;follow.modalRadius=modalRadius;
        follow.emphasized=emphasized;
        VoxCueForegroundSurface *surface=follow.surface;
        if(!surface)return;
        // This surface must sample the actual interview text. A backplate
        // beneath Chromium leaves sharp message text painted over the arrow.
        [host addSubview:surface positioned:NSWindowAbove relativeTo:nil];
        surface.hidden=!visible || !surface.web;
        surface.blocked=!NSIsEmptyRect(modal);
        surface.tintColor=followHoverTint(surface,emphasized && !surface.blocked);
        surface.frame=frame;
        CAShapeLayer *mask=[CAShapeLayer layer];CGPathRef path=CGPathCreateWithEllipseInRect(surface.bounds,nullptr);
        if(!NSIsEmptyRect(modal)) {
            CGPathRef hole=dialogPath([surface convertRect:modal fromView:host],modalRadius);
            CGPathRef cut=CGPathCreateCopyBySubtractingPath(path,hole,false);
            CGPathRelease(path);CGPathRelease(hole);path=cut;
        }
        mask.path=path;CGPathRelease(path);surface.wantsLayer=YES;surface.layer.mask=mask;
        [surface place];
    }
}
bool VoxCuePositionScrollingControl(NSView *host, NSView *control) {
    {
        VoxCueScrollChrome *chrome=objc_getAssociatedObject(host,&chromeKey);
        if(!chrome)return false;
        NSRect frame=control.frame;NSView *parent=VoxCueSharedRendererHost(host);
        [parent addSubview:control positioned:NSWindowBelow relativeTo:chrome];
        control.frame=[parent convertRect:frame fromView:host];return true;
    }
}
bool VoxCueIsScrollChrome(NSView *view) {
    return [view isKindOfClass:VoxCueScrollChrome.class] || [view isKindOfClass:VoxCueModalBackground.class];
}
NSView *VoxCueScrollHeaderContent(NSView *host, NSRect control) {
    VoxCueScrollChrome *chrome=objc_getAssociatedObject(host,&chromeKey);
    // Only the material fades. Controls must not inherit its empty/partial
    // opacity, so they join the actual contentView once the glass is opaque.
    if(!chrome || chrome.blocked || chrome.header.hidden || chrome.header.alphaValue<1)return nil;
    NSRect frame=[chrome convertRect:control fromView:host];
    return NSContainsRect(chrome.header.frame,frame)?chrome.header.contentView:nil;
}
NSView *VoxCueModalBackdropAnchor(NSView *host) {
    {
        VoxCueScrollChrome *chrome=objc_getAssociatedObject(host,&chromeKey);
        return chrome.blocked?chrome.modalBackdrop:nil;
    }
}
NSRect VoxCueModalExclusion(NSView *host) {
    {
        VoxCueScrollChrome *chrome=objc_getAssociatedObject(host,&chromeKey);
        if(chrome.blocked)return chrome.modalBackdrop.exclusion;
    }return NSZeroRect;
}
void VoxCueRemoveScrollChrome(NSView *host) {
    {
        VoxCueScrollChrome *chrome=objc_getAssociatedObject(host,&chromeKey);
        objc_setAssociatedObject(host,&chromeKey,nil,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        // Move controls out before retiring their old header, even when the
        // renderer's control snapshot has not changed between routes.
        VoxCueRefreshContentControlPlacement(host);
        [chrome.composer detach];[chrome.follow detach];[chrome.modalBackdrop removeFromSuperview];[chrome removeFromSuperview];
    }
}
static NSView *getHost(napi_env env,napi_value value) {
    void *bytes=nullptr,*pointer=nullptr;size_t length=0;
    if(napi_get_buffer_info(env,value,&bytes,&length)!=napi_ok || length!=sizeof(pointer)) return nil;
    std::memcpy(&pointer,bytes,sizeof(pointer));return ((__bridge NSView *)pointer).window.contentView;
}
static double number(napi_env env,napi_value object,const char *key) {
    napi_value value;double result=0;napi_get_named_property(env,object,key,&value);napi_get_value_double(env,value,&result);return result;
}
static NSRect rect(napi_env env,napi_value object,NSView *host) {
    double x=number(env,object,"x"),y=number(env,object,"y"),width=number(env,object,"width"),height=number(env,object,"height");
    return NSMakeRect(x,host.isFlipped?y:NSHeight(host.bounds)-y-height,width,height);
}
static NSColor *color(napi_env env,napi_value object) {
    napi_value value;char text[8]={};size_t length=0;unsigned int rgb=0;
    napi_get_named_property(env,object,"foregroundColor",&value);napi_get_value_string_utf8(env,value,text,sizeof(text),&length);sscanf(text,"#%x",&rgb);
    return [NSColor colorWithSRGBRed:((rgb>>16)&255)/255.0 green:((rgb>>8)&255)/255.0 blue:(rgb&255)/255.0 alpha:1];
}
napi_value VoxCueConfigureScrollChrome(napi_env env,napi_callback_info info) {
    size_t count=2;napi_value args[2],result,nullValue;bool remove=false;napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
    NSView *host=count==2?getHost(env,args[0]):nil;
    if(!host || !NSThread.isMainThread) {napi_get_boolean(env,false,&result);return result;}
    napi_get_null(env,&nullValue);napi_strict_equals(env,args[1],nullValue,&remove);
    if(remove) {VoxCueRemoveScrollChrome(host);napi_get_boolean(env,false,&result);return result;}
    {
        VoxCueScrollChrome *chrome=objc_getAssociatedObject(host,&chromeKey);
        if(!chrome) {
            chrome=[[VoxCueScrollChrome alloc] initWithFrame:host.bounds];chrome.host=host;
            chrome.header=[[NSGlassEffectView alloc] initWithFrame:NSZeroRect];
            chrome.header.style=NSGlassEffectViewStyleRegular;
            chrome.header.identifier=@"voxcue-header-material";
            chrome.header.tintColor=nil;chrome.header.cornerRadius=0;
            chrome.header.contentView=[[NSView alloc] initWithFrame:NSZeroRect];
            [chrome addSubview:chrome.header];
            chrome.title=[NSTextField labelWithString:@"面试准备"];chrome.title.font=[NSFont boldSystemFontOfSize:18];chrome.title.accessibilityElement=NO;
            chrome.title.identifier=@"voxcue-header-title";
            [chrome addSubview:chrome.title];
            chrome.modalBackdrop=[[VoxCueModalBackground alloc] initWithFrame:host.bounds];
            objc_setAssociatedObject(host,&chromeKey,chrome,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        }
        napi_value area,title,composer,modal;bool absentModal=false,absentTitle=false;
        napi_get_named_property(env,args[1],"area",&area);napi_get_named_property(env,args[1],"title",&title);
        napi_strict_equals(env,title,nullValue,&absentTitle);
        napi_get_named_property(env,args[1],"composer",&composer);napi_get_named_property(env,args[1],"modal",&modal);napi_strict_equals(env,modal,nullValue,&absentModal);
        bool blocked=!absentModal;NSRect excluded=blocked?rect(env,modal,host):NSZeroRect;CGFloat modalRadius=number(env,args[1],"modalRadius");
        NSView *main=VoxCueSharedRendererHost(host);chrome.blocked=blocked;
        // Keep glass backgrounds present under a dialog. Only the intersecting
        // parts of native surfaces are clipped to the shared dialog contour.
        // Chromium can reorder its compositor sibling after resize or route
        // changes. Glass must remain above the actual paint as well as its
        // event view, otherwise sharp content paints over the blur.
        [main addSubview:chrome positioned:NSWindowAbove relativeTo:nil];
        chrome.frame=main.bounds;
        NSRect headerRect=rect(env,area,host);headerRect.origin.y=host.isFlipped?number(env,area,"y"):NSMaxY(headerRect)-number(env,args[1],"topHeight");headerRect.size.height=number(env,args[1],"topHeight");
        chrome.header.frame=[chrome convertRect:headerRect fromView:host];
        chrome.header.wantsLayer=YES;
        CGFloat headerRadius=number(env,args[1],"headerRadius");
        if(headerRadius>0) {
            CAShapeLayer *mask=[CAShapeLayer layer];
            CGPathRef path=dialogPath([chrome.header convertRect:rect(env,area,host) fromView:host],headerRadius);
            mask.path=path;CGPathRelease(path);chrome.header.layer.mask=mask;
        } else chrome.header.layer.mask=nil;
        chrome.header.alphaValue=number(env,args[1],"headerOpacity");
        napi_value titleValue;char titleText[512]={};size_t titleLength=0;
        napi_get_named_property(env,args[1],"titleText",&titleValue);
        napi_get_value_string_utf8(env,titleValue,titleText,sizeof(titleText),&titleLength);
        chrome.title.stringValue=[NSString stringWithUTF8String:titleText];
        chrome.title.hidden=absentTitle;
        NSRect titleFrame=absentTitle?NSZeroRect:[chrome convertRect:rect(env,title,host) fromView:host];
        CGFloat titleCenter=NSMidY(titleFrame),scale=host.window.backingScaleFactor ?: 1;
        // The shared line box includes CSS leading. Center AppKit's natural
        // label height in that box rather than drawing at its upper edge.
        titleFrame.size.height=chrome.title.fittingSize.height;
        titleFrame.origin.y=round((titleCenter-titleFrame.size.height/2)*scale)/scale;
        chrome.title.frame=titleFrame;chrome.title.textColor=color(env,args[1]);
        chrome.title.alphaValue=number(env,args[1],"titleOpacity");
        chrome.header.hidden=blocked && NSIntersectsRect(headerRect,excluded);
        if(blocked) {
            [host addSubview:chrome.modalBackdrop positioned:NSWindowAbove relativeTo:nil];chrome.modalBackdrop.frame=host.bounds;
            chrome.modalBackdrop.exclusion=excluded;chrome.modalBackdrop.radius=modalRadius;
            [chrome.modalBackdrop setNeedsDisplay:YES];
        } else [chrome.modalBackdrop removeFromSuperview];
        const char *keys[]={"composer","follow"};
        for(int index=0;index<2;index++) {
            VoxCueForegroundSurface *surface=index==0?chrome.composer:chrome.follow;
            if(!surface)continue;
            napi_value geometry;napi_get_named_property(env,args[1],keys[index],&geometry);
            bool absent=false;napi_strict_equals(env,geometry,nullValue,&absent);
            surface.hidden=absent || !surface.web;if(surface.hidden)continue;
            if(index==1) {
                napi_value hovered;bool emphasis=false;napi_get_named_property(env,args[1],"followHovered",&hovered);napi_get_value_bool(env,hovered,&emphasis);
                surface.tintColor=followHoverTint(surface,emphasis && !blocked);
            }
            surface.frame=[chrome convertRect:rect(env,geometry,host) fromView:host];
            surface.wantsLayer=YES;CAShapeLayer *mask=[CAShapeLayer layer];
            CGPathRef path=index==0?VoxCueContinuousContour(surface.bounds.size,40):CGPathCreateWithEllipseInRect(surface.bounds,nullptr);
            if(blocked) {
                NSRect inSurface=[surface convertRect:excluded fromView:host];CGPathRef hole=dialogPath(inSurface,modalRadius);
                // Subtract rather than XOR: a dialog larger than this surface
                // must not turn the outside of its rounded contour visible.
                CGPathRef cut=CGPathCreateCopyBySubtractingPath(path,hole,false);
                CGPathRelease(path);CGPathRelease(hole);path=cut;
            }
            mask.path=path;CGPathRelease(path);surface.layer.mask=mask;[surface place];
        }
        // The two presentation ports can update independently. Reparent after
        // every material/opacity/modal update using saved window coordinates.
        VoxCueRefreshContentControlPlacement(host);
        napi_get_boolean(env,true,&result);
    }
    return result;
}
static bool isFollow(napi_env env,napi_value value) {
    char kind[16]={};size_t length=0;napi_get_value_string_utf8(env,value,kind,sizeof(kind),&length);
    return std::strcmp(kind,"follow")==0;
}
napi_value VoxCueDetachSurface(napi_env env,napi_callback_info info) {
    size_t count=2;napi_value args[2],result;napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
    NSView *host=count==2?getHost(env,args[0]):nil;
    {
        VoxCueScrollChrome *chrome=objc_getAssociatedObject(host,&chromeKey);
        if(isFollow(env,args[1])){[chrome.follow detach];chrome.follow=nil;}
        else{[chrome.composer detach];chrome.composer=nil;}
        if(isFollow(env,args[1])) {
            VoxCueInterviewFollow *follow=objc_getAssociatedObject(host,&interviewFollowKey);
            [follow.surface detach];follow.surface=nil;
        }
    }
    napi_get_undefined(env,&result);return result;
}
napi_value VoxCueAttachSurface(napi_env env,napi_callback_info info) {
    size_t count=3;napi_value args[3],result;napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
    NSView *host=count==3?getHost(env,args[0]):nil,*web=count==3?getHost(env,args[1]):nil;
    {
        VoxCueScrollChrome *chrome=objc_getAssociatedObject(host,&chromeKey);
        VoxCueInterviewFollow *interview=objc_getAssociatedObject(host,&interviewFollowKey);
        if((chrome || (isFollow(env,args[2]) && interview)) && web && web.window!=host.window) {
            VoxCueForegroundSurface *surface=[[VoxCueForegroundSurface alloc] initWithFrame:NSZeroRect];
            surface.style=NSGlassEffectViewStyleRegular;surface.tintColor=nil;
            surface.identifier=isFollow(env,args[2])?@"voxcue-follow-material":@"voxcue-composer-material";
            // Preserve the shared composer's original continuous contour.
            // Its material and foreground use the same 40px contour mask.
            // Both surfaces use the composer's same unmodified Regular plane.
            // Their shared contour masks provide the 40px continuous input
            // shape or the circle, without adding a second native lens edge.
            surface.cornerRadius=0;surface.clipsToBounds=YES;
            if(@available(macOS 27.0,*))surface.effectIsInteractive=isFollow(env,args[2]);
            surface.owner=web.window;web.window.contentView=[[NSView alloc] initWithFrame:web.bounds];surface.web=web;
            surface.host=host;surface.projection=[[NSView alloc] initWithFrame:NSZeroRect];surface.contentView=surface.projection;[surface.projection addSubview:web];
            if(interview && !chrome) {
                surface.appearance=[NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
                interview.surface=surface;
                VoxCueUpdateInterviewFollow(host,interview.frame,interview.visible,interview.modal,interview.modalRadius,interview.emphasized);
            } else {
                [chrome addSubview:surface];
                if(isFollow(env,args[2]))chrome.follow=surface;else chrome.composer=surface;
            }
            napi_get_boolean(env,true,&result);return result;
        }
    }napi_get_boolean(env,false,&result);return result;
}
