#include <node_api.h>
#import <AppKit/AppKit.h>
#include <cstring>

@interface VoxCueMenuSelection : NSObject
@property NSInteger selected;
- (void)choose:(NSMenuItem *)item;
@end
@implementation VoxCueMenuSelection
- (void)choose:(NSMenuItem *)item { self.selected = item.tag; }
@end

// NSMenu owns its material, focus, keyboard navigation and inactive appearance.
// AppKit has no public Regular/Clear selector for menu materials.
napi_value VoxCuePopUpMenu(napi_env env, napi_callback_info info) {
    size_t count=2,length=0; napi_value args[2],value,result;
    void *bytes=nullptr,*pointer=nullptr;
    napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
    if(count!=2 || !NSThread.isMainThread || napi_get_buffer_info(env,args[0],&bytes,&length)!=napi_ok || length!=sizeof(pointer)) {
        napi_throw_error(env,nullptr,"Invalid native menu request"); return nullptr;
    }
    std::memcpy(&pointer,bytes,sizeof(pointer)); NSView *host=((__bridge NSView *)pointer).window.contentView;
    double x=0,y=0,width=0,anchorWidth=0,anchorHeight=0;
    napi_value anchor;napi_get_named_property(env,args[1],"anchor",&anchor);
    napi_get_named_property(env,anchor,"x",&value); napi_get_value_double(env,value,&x);
    napi_get_named_property(env,anchor,"y",&value); napi_get_value_double(env,value,&y);
    napi_get_named_property(env,args[1],"width",&value); napi_get_value_double(env,value,&width);
    napi_get_named_property(env,anchor,"width",&value);napi_get_value_double(env,value,&anchorWidth);
    napi_get_named_property(env,anchor,"height",&value);napi_get_value_double(env,value,&anchorHeight);
    char side[8]={},align[8]={};size_t textLength=0;
    napi_get_named_property(env,args[1],"side",&value);napi_get_value_string_utf8(env,value,side,sizeof(side),&textLength);
    napi_get_named_property(env,args[1],"align",&value);napi_get_value_string_utf8(env,value,align,sizeof(align),&textLength);
    napi_value items; uint32_t size=0; napi_get_named_property(env,args[1],"items",&items); napi_get_array_length(env,items,&size);
    if(!host || size==0 || size>128) { napi_get_null(env,&result); return result; }
    NSMenu *menu=[[NSMenu alloc] initWithTitle:@""]; menu.autoenablesItems=NO; menu.minimumWidth=width;
    VoxCueMenuSelection *selection=[[VoxCueMenuSelection alloc] init]; selection.selected=-1;
    for(uint32_t i=0;i<size;i++) {
        napi_value row; bool separator=false,disabled=false,checked=false;
        napi_get_element(env,items,i,&row);
        napi_get_named_property(env,row,"separator",&value); napi_get_value_bool(env,value,&separator);
        if(separator) { [menu addItem:NSMenuItem.separatorItem]; continue; }
        char label[2048]={}; size_t used=0;
        napi_get_named_property(env,row,"label",&value); napi_get_value_string_utf8(env,value,label,sizeof(label),&used);
        napi_get_named_property(env,row,"disabled",&value); napi_get_value_bool(env,value,&disabled);
        napi_get_named_property(env,row,"checked",&value); napi_get_value_bool(env,value,&checked);
        NSMenuItem *item=[[NSMenuItem alloc] initWithTitle:[NSString stringWithUTF8String:label] action:@selector(choose:) keyEquivalent:@""];
        item.tag=i; item.target=selection; item.enabled=!disabled; item.state=checked?NSControlStateValueOn:NSControlStateValueOff;
        char symbol[101]={};
        napi_get_named_property(env,row,"symbol",&value);
        if(napi_get_value_string_utf8(env,value,symbol,sizeof(symbol),&used)==napi_ok && used>0)
            item.image=[NSImage imageWithSystemSymbolName:[NSString stringWithUTF8String:symbol] accessibilityDescription:nil];
        char tint[8]={};unsigned int rgb=0;
        napi_get_named_property(env,row,"symbolColor",&value);
        if(item.image && napi_get_value_string_utf8(env,value,tint,sizeof(tint),&used)==napi_ok && used==7 && sscanf(tint,"#%x",&rgb)==1) {
            NSColor *color=[NSColor colorWithSRGBRed:((rgb>>16)&255)/255.0 green:((rgb>>8)&255)/255.0 blue:(rgb&255)/255.0 alpha:1];
            item.image=[item.image imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPaletteColors:@[color]]];
        }
        // macOS 27 hides menu icons by default, including non-nil images.
        // Preserve every leading icon that the shared menu already provides.
        if(@available(macOS 27.0,*))if(item.image)item.preferredImageVisibility=NSMenuItemImageVisibilityVisible;
        [menu addItem:item];
    }
    // AppKit's intrinsic menu size differs from Radix's web layout. Anchor the
    // actual native menu edge to the actual trigger, never to the web popup.
    [menu update];
    NSSize menuSize=menu.size;
    if(std::strcmp(align,"end")==0) x+=anchorWidth-menuSize.width;
    y=std::strcmp(side,"top")==0 ? y-4-menuSize.height : y+anchorHeight+4;
    NSPoint position=NSMakePoint(x,host.isFlipped?y:NSHeight(host.bounds)-y);
    [menu popUpMenuPositioningItem:nil atLocation:position inView:host];
    if(selection.selected<0) napi_get_null(env,&result); else napi_create_int32(env,(int32_t)selection.selected,&result);
    return result;
}
