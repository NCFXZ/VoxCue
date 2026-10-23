#include "ContentControls.h"
#include "LiquidGlassControls.h"
#include "ScrollChrome.h"
#include "InterviewMaterials.h"
#include "ChatGPTBrand.h"
#import <objc/runtime.h>
#include <cstring>
#include <cmath>
#include <string>

struct ContentChange { uint32_t id; std::string value; bool toggle=false; bool checked=false; bool range=false; double number=0; };
@class VoxCueContentManager;
API_AVAILABLE(macos(26.0))
@interface VoxCueContentHost : NSView <NSSearchFieldDelegate>
@property(nonatomic,strong) NSControl *control;
@property(nonatomic,strong) NSProgressIndicator *progress;
@property(nonatomic,weak) VoxCueContentManager *manager;
@property(nonatomic) uint32_t identity;
@property(nonatomic) BOOL search;
@property(nonatomic) BOOL toggle;
@property(nonatomic) BOOL slider;
@property(nonatomic) BOOL covered;
@property(nonatomic) BOOL overGlass;
@property(nonatomic) BOOL background;
@property(nonatomic) BOOL scrolling;
@property(nonatomic) BOOL borderEmphasized;
@property(nonatomic) NSRect hostRect;
@property(nonatomic,strong) NSArray *artwork;
@end
API_AVAILABLE(macos(26.0))
@interface VoxCueContentManager : NSObject
@property(nonatomic,strong) NSMutableDictionary<NSNumber *,VoxCueContentHost *> *views;
@property(nonatomic) napi_threadsafe_function changed;
@end
@implementation VoxCueContentManager
- (void)dealloc { if(_changed)napi_release_threadsafe_function(_changed,napi_tsfn_release); }
@end
@implementation VoxCueContentHost
- (NSView *)hitTest:(NSPoint)point {
    // Search and switches use AppKit tracking; switch actions synchronize the
    // shared setting. Other buttons keep Chromium mouse/keyboard semantics.
    return (self.search || self.toggle || self.slider) && !self.covered ? [super hitTest:point] : nil;
}
- (void)controlTextDidChange:(NSNotification *)notification {
    if(self.covered || !self.manager || !self.manager.changed)return;
    NSString *value=((NSSearchField *)self.control).stringValue;
    auto *change=new ContentChange{self.identity,std::string(value.UTF8String)};
    if(napi_call_threadsafe_function(self.manager.changed,change,napi_tsfn_nonblocking)!=napi_ok)delete change;
}
- (void)toggleChanged:(NSSwitch *)sender {
    if(self.covered || !sender.enabled || !self.manager.changed)return;
    auto *change=new ContentChange{self.identity,"",true,sender.state==NSControlStateValueOn};
    if(napi_call_threadsafe_function(self.manager.changed,change,napi_tsfn_nonblocking)!=napi_ok)delete change;
}
- (void)sliderChanged:(NSSlider *)sender {
    if(self.covered || !sender.enabled || !self.manager.changed)return;
    double value=round(sender.doubleValue);sender.doubleValue=value;
    auto *change=new ContentChange{self.identity,"",false,false,true,value};
    if(napi_call_threadsafe_function(self.manager.changed,change,napi_tsfn_nonblocking)!=napi_ok)delete change;
}
@end
bool VoxCueIsContentControl(NSView *view) {
    if(@available(macOS 26.0,*))return [view isKindOfClass:VoxCueContentHost.class];
    return false;
}
static void deliver(napi_env env,napi_value callback,void *,void *data) {
    auto *change=static_cast<ContentChange *>(data);
    if(env && callback) {
        napi_value args[2],receiver;napi_create_uint32(env,change->id,&args[0]);
        if(change->range)napi_create_double(env,change->number,&args[1]);
        else if(change->toggle)napi_get_boolean(env,change->checked,&args[1]);
        else napi_create_string_utf8(env,change->value.c_str(),change->value.size(),&args[1]);
        napi_get_undefined(env,&receiver);napi_call_function(env,receiver,callback,2,args,nullptr);
    } delete change;
}
static napi_value property(napi_env env,napi_value item,const char *name) {
    napi_value result;napi_get_named_property(env,item,name,&result);return result;
}
static double number(napi_env env,napi_value item,const char *name) {
    double result=0;napi_get_value_double(env,property(env,item,name),&result);return result;
}
static bool boolean(napi_env env,napi_value item,const char *name) {
    bool result=false;napi_get_value_bool(env,property(env,item,name),&result);return result;
}
static NSString *string(napi_env env,napi_value item,const char *name) {
    napi_value value=property(env,item,name);size_t length=0;
    if(napi_get_value_string_utf8(env,value,nullptr,0,&length)!=napi_ok)return @"";
    std::string result(length+1,'\0');napi_get_value_string_utf8(env,value,result.data(),result.size(),&length);
    return [NSString stringWithUTF8String:result.c_str()];
}
static char managerKey;
// A material and its controls arrive through separate bounded display ports.
// Reproject from the saved window-space rect after either update, so moving a
// glass contentView cannot move its already positioned controls a second time.
void VoxCueRefreshContentControlPlacement(NSView *host) {
    if(@available(macOS 26.0,*)) {
        VoxCueContentManager *manager=objc_getAssociatedObject(host,&managerKey);
        for(VoxCueContentHost *view in manager.views.allValues) {
            NSRect rect=view.hostRect;
            NSView *backdrop=VoxCueModalBackdropAnchor(host);
            view.hidden=view.covered && backdrop && NSIntersectsRect(rect,VoxCueModalExclusion(host));
            NSView *glassContent=view.overGlass && !view.search && !view.toggle && !view.slider && !view.progress?VoxCueInterviewGlassContent(host,rect):nil;
            if(!glassContent && view.overGlass && !view.covered)glassContent=VoxCueSidebarGlassContent(host,rect);
            if(glassContent) {
                [glassContent addSubview:view];view.frame=[glassContent convertRect:rect fromView:host];
            } else if(view.background && view.overGlass) {
                NSView *parent=VoxCueInterviewControlParent(host);
                view.hidden=!parent;[parent addSubview:view];
                view.frame=[parent convertRect:rect fromView:host];
            } else {
                view.frame=rect;
                if((!view.search && !view.scrolling) || view.covered || !VoxCuePositionScrollingControl(host,view))VoxCuePositionGlassControl(host,view,view.covered);
            }
        }
    }
}
napi_value VoxCueConfigureContentControls(napi_env env,napi_callback_info info) {
    size_t count=3,length=0;napi_value args[3],result;void *bytes=nullptr,*pointer=nullptr;
    napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
    if(count!=3 || !NSThread.isMainThread || napi_get_buffer_info(env,args[0],&bytes,&length)!=napi_ok || length!=sizeof(pointer)) {
        napi_throw_error(env,nullptr,"Invalid content control request");return nullptr;
    }
    std::memcpy(&pointer,bytes,sizeof(pointer));NSView *host=((__bridge NSView *)pointer).window.contentView;
    uint32_t size=0;napi_get_array_length(env,args[1],&size);
    if(!host || size>256){napi_get_boolean(env,false,&result);return result;}
    if(@available(macOS 26.0,*)) {
        VoxCueContentManager *manager=objc_getAssociatedObject(host,&managerKey);
        if(!manager && size) {
            manager=[VoxCueContentManager new];manager.views=[NSMutableDictionary dictionary];
            napi_value name;napi_create_string_utf8(env,"Content search",NAPI_AUTO_LENGTH,&name);
            napi_threadsafe_function callback;
            if(napi_create_threadsafe_function(env,args[2],nullptr,name,0,1,nullptr,nullptr,nullptr,deliver,&callback)!=napi_ok) {
                napi_throw_error(env,nullptr,"Unable to attach content controls");return nullptr;
            }
            manager.changed=callback;
            napi_unref_threadsafe_function(env,manager.changed);
            objc_setAssociatedObject(host,&managerKey,manager,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        }
        NSMutableSet<NSNumber *> *seen=[NSMutableSet set];
        for(uint32_t index=0;index<size;index++) {
            napi_value item;napi_get_element(env,args[1],index,&item);uint32_t identity=(uint32_t)number(env,item,"id");
            NSNumber *key=@(identity);[seen addObject:key];NSString *kind=string(env,item,"kind");
            BOOL indicator=[kind isEqualToString:@"progress"],overGlass=boolean(env,item,"overGlass");
            BOOL slider=[kind isEqualToString:@"font-slider"];
            BOOL search=[kind isEqualToString:@"search"],popup=[kind isEqualToString:@"popup"],toggle=[kind isEqualToString:@"switch"],background=[kind isEqualToString:@"button-background"];
            VoxCueContentHost *view=manager.views[key];
            if(!view) {
                view=[[VoxCueContentHost alloc] initWithFrame:NSZeroRect];view.manager=manager;view.identity=identity;view.search=search;view.toggle=toggle;view.slider=slider;
                if(search) {
                    NSSearchField *field=[[NSSearchField alloc] initWithFrame:NSZeroRect];
                    field.delegate=view;field.sendsSearchStringImmediately=YES;field.maximumRecents=0;field.recentsAutosaveName=nil;
                    field.bezeled=YES;field.bezelStyle=NSTextFieldRoundedBezel;
                    field.borderShape=NSControlBorderShapeCapsule;
                    field.maximumNumberOfLines=1;field.cell.usesSingleLineMode=YES;field.cell.scrollable=YES;
                    field.focusRingType=NSFocusRingTypeNone;
                    [view addSubview:field];view.control=field;
                } else if(slider) {
                    NSSlider *control=[[NSSlider alloc] initWithFrame:NSZeroRect];
                    control.identifier=@"voxcue-content-font-slider";control.sliderType=NSSliderTypeLinear;
                    control.minValue=12;control.maxValue=24;control.continuous=YES;
                    control.target=view;control.action=@selector(sliderChanged:);view.control=control;[view addSubview:control];
                } else if(indicator) {
                    NSProgressIndicator *progress=[[NSProgressIndicator alloc] initWithFrame:NSZeroRect];
                    progress.identifier=@"voxcue-content-progress";
                    progress.style=NSProgressIndicatorStyleSpinning;progress.controlSize=NSControlSizeSmall;
                    progress.minValue=0;progress.maxValue=100;progress.displayedWhenStopped=YES;
                    progress.accessibilityElement=NO;view.progress=progress;[view addSubview:progress];
                } else if(toggle) {
                    NSSwitch *control=[[NSSwitch alloc] initWithFrame:NSZeroRect];
                    control.identifier=@"voxcue-content-switch";control.target=view;control.action=@selector(toggleChanged:);view.control=control;[view addSubview:control];
                } else {
                    // Pull-down presentation preserves the requested single
                    // down arrow. Shared menus still own selection semantics.
                    NSButton *button=popup?(NSButton *)[[NSPopUpButton alloc] initWithFrame:NSZeroRect pullsDown:YES]:[[NSButton alloc] initWithFrame:NSZeroRect];
                    button.bezelColor=nil;button.tintProminence=NSTintProminenceNone;view.control=button;[view addSubview:button];
                    button.refusesFirstResponder=YES;
                }
                view.control.controlSize=NSControlSizeLarge;view.control.font=[NSFont systemFontOfSize:14 weight:NSFontWeightMedium];
                view.control.accessibilityElement=NO;manager.views[key]=view;
                view.control.focusRingType=NSFocusRingTypeNone;
            }
            CGFloat x=number(env,item,"x"),y=number(env,item,"y"),width=number(env,item,"width"),height=number(env,item,"height");
            view.hostRect=NSMakeRect(x,host.isFlipped?y:NSHeight(host.bounds)-y-height,width,height);
            view.overGlass=overGlass;view.background=background;
            view.scrolling=[kind isEqualToString:@"button-hover"];
            view.frame=NSMakeRect(x,host.isFlipped?y:NSHeight(host.bounds)-y-height,width,height);
            view.covered=boolean(env,item,"covered");view.control.enabled=!boolean(env,item,"disabled") && !view.covered;
            view.alphaValue=number(env,item,"opacity");
            NSString *label=background?@"":string(env,item,"label");
            unsigned int rgb=0;sscanf(string(env,item,"color").UTF8String,"#%x",&rgb);
            NSColor *color=[NSColor colorWithSRGBRed:((rgb>>16)&255)/255.0 green:((rgb>>8)&255)/255.0 blue:(rgb&255)/255.0 alpha:1];
            if(search) {
                NSSearchField *field=(NSSearchField *)view.control;NSString *value=string(env,item,"value");
                field.controlSize=NSControlSizeExtraLarge;
                if(![field.stringValue isEqualToString:value])field.stringValue=value;
                field.placeholderString=label;field.textColor=color;
                // Keep the complete system search field. Removing its bezel
                // changes the field editor's insets and overlaps the search
                // icon/placeholder on focus; AppKit owns all three together.
                field.frame=view.bounds;
            } else if(slider) {
                NSSlider *control=(NSSlider *)view.control;control.controlSize=NSControlSizeRegular;
                control.doubleValue=string(env,item,"value").doubleValue;
                CGFloat natural=MIN(height,MAX(20,control.fittingSize.height));
                control.frame=NSMakeRect(0,round((height-natural)/2),width,natural);
            } else if(indicator) {
                NSProgressIndicator *progress=view.progress;NSString *value=string(env,item,"value");
                BOOL indeterminate=!value.length;
                if(progress.indeterminate!=indeterminate) {
                    [progress stopAnimation:nil];progress.indeterminate=indeterminate;
                }
                if(indeterminate)[progress startAnimation:nil];else progress.doubleValue=value.doubleValue;
                [progress sizeToFit];
                progress.frame=NSMakeRect(round((width-NSWidth(progress.frame))/2),round((height-NSHeight(progress.frame))/2),NSWidth(progress.frame),NSHeight(progress.frame));
            } else if(toggle) {
                NSSwitch *control=(NSSwitch *)view.control;
                control.controlSize=NSControlSizeRegular;[control sizeToFit];
                control.frame=NSMakeRect(round((width-NSWidth(control.frame))/2),round((height-NSHeight(control.frame))/2),NSWidth(control.frame),NSHeight(control.frame));
                NSControlStateValue checked=boolean(env,item,"checked")?NSControlStateValueOn:NSControlStateValueOff;
                if(control.state!=checked)control.animator.state=checked;
            } else {
                NSButton *button=(NSButton *)view.control;NSString *symbol=background?@"":string(env,item,"symbol");
                BOOL brand=[symbol isEqualToString:@"brand.chatgpt"];
                button.appearance=background && overGlass?[NSAppearance appearanceNamed:NSAppearanceNameDarkAqua]:nil;
                BOOL trailing=boolean(env,item,"trailing");
                NSArray *artwork=@[kind,label,symbol,string(env,item,"color"),string(env,item,"symbolColor"),@(overGlass),@(trailing),@(height<=36),@(height<32),@(background && fabs(width-height)<1)];
                if(![view.artwork isEqual:artwork]) {
                view.artwork=artwork;
                button.font=[NSFont systemFontOfSize:height<32?12:14 weight:NSFontWeightMedium];
                NSImage *image=!brand && symbol.length?[NSImage imageWithSystemSymbolName:symbol accessibilityDescription:nil]:nil;
                if(brand) {
                    image=[[NSImage alloc] initWithData:[NSData dataWithBytes:VoxCueChatGPTBrand length:sizeof(VoxCueChatGPTBrand)]];
                    image.size=NSMakeSize(22,22);[image setTemplate:YES];
                } else {
                    image=[image imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPointSize:label.length?(height<32?13:14):17 weight:NSFontWeightRegular]];
                    image=[image imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPaletteColors:@[color]]];
                }
                NSString *symbolColor=string(env,item,"symbolColor");
                if(symbolColor.length) {
                    unsigned int tint=0;sscanf(symbolColor.UTF8String,"#%x",&tint);
                    NSColor *palette=[NSColor colorWithSRGBRed:((tint>>16)&255)/255.0 green:((tint>>8)&255)/255.0 blue:(tint&255)/255.0 alpha:1];
                    image=[image imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPaletteColors:@[palette]]];
                }
                // Over-glass is the standard push control inside glass, not
                // another NSBezelStyleGlass material layered over that glass.
                button.bezelStyle=[kind isEqualToString:@"button-glass"]?NSBezelStyleGlass:NSBezelStylePush;
                if(overGlass) { button.tintProminence=NSTintProminenceNone;button.bezelColor=nil; }
                button.controlSize=overGlass || height<=36?NSControlSizeRegular:NSControlSizeLarge;
                button.contentTintColor=color;
                if(popup) {
                    NSPopUpButton *choice=(NSPopUpButton *)button;[choice removeAllItems];[choice addItemWithTitle:label];
                    NSMenuItem *display=[choice itemAtIndex:0];display.image=image;
                    display.attributedTitle=[[NSAttributedString alloc] initWithString:label attributes:@{NSForegroundColorAttributeName:color,NSFontAttributeName:button.font}];
                    if(@available(macOS 27.0,*))if(image)display.preferredImageVisibility=NSMenuItemImageVisibilityVisible;
                } else {
                    button.imageHugsTitle=YES;button.alignment=[kind isEqualToString:@"button-hover"]?NSTextAlignmentLeft:NSTextAlignmentCenter;
                    button.title=label;button.image=image;button.imagePosition=background?NSNoImage:label.length?(trailing?NSImageTrailing:NSImageLeading):NSImageOnly;
                    button.attributedTitle=[[NSAttributedString alloc] initWithString:label attributes:@{NSForegroundColorAttributeName:color,NSFontAttributeName:button.font}];
                }
                }
                // Shape follows geometry while shared hover/confirmation widths
                // animate, even when their title disappears before shrinking.
                button.borderShape=fabs(width-height)<1?NSControlBorderShapeCircle:NSControlBorderShapeCapsule;
                BOOL highlighted=button.enabled && (boolean(env,item,"pressed") || boolean(env,item,"hovered"));
                button.bordered=YES;
                button.showsBorderOnlyWhileMouseInside=[kind isEqualToString:@"button-hover"];
                if(button.showsBorderOnlyWhileMouseInside) {
                    BOOL emphasized=highlighted || boolean(env,item,"focused");
                    if(view.borderEmphasized!=emphasized) {
                        view.borderEmphasized=emphasized;
                        NSEvent *event=[NSEvent enterExitEventWithType:emphasized?NSEventTypeMouseEntered:NSEventTypeMouseExited location:NSZeroPoint modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:host.window.windowNumber context:nil eventNumber:0 trackingNumber:0 userData:nullptr];
                        if(emphasized)[button.cell mouseEntered:event];else [button.cell mouseExited:event];
                    }
                }
                if(button.cell.highlighted!=highlighted)[button highlight:highlighted];
                button.cell.showsFirstResponder=NO;
                button.frame=view.bounds;
            }
        }
        for(NSNumber *key in [manager.views.allKeys copy])if(![seen containsObject:key]) {
            VoxCueContentHost *view=manager.views[key];if(view.search)[view.window endEditingFor:view.control];
            [view removeFromSuperview];[manager.views removeObjectForKey:key];
        }
        VoxCueRefreshContentControlPlacement(host);
        napi_get_boolean(env,true,&result);return result;
    }napi_get_boolean(env,false,&result);return result;
}
