#include <node_api.h>
#import <AppKit/AppKit.h>

bool VoxCueIsGlassControl(NSView *view);
void VoxCueRaiseGlassControls(NSView *host);
void VoxCuePositionGlassControl(NSView *host, NSView *control, bool behindContent);
NSView *VoxCueSidebarGlassContent(NSView *host, NSRect control);
napi_value VoxCueConfigureGlassButton(napi_env env, napi_callback_info info);

napi_value VoxCuePopUpMenu(napi_env env, napi_callback_info info);
