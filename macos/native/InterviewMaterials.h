#include <node_api.h>
#import <AppKit/AppKit.h>
NSView *VoxCueInterviewControlParent(NSView *host);
NSView *VoxCueInterviewGlassContent(NSView *host, NSRect control);
napi_value VoxCueConfigureInterviewMaterials(napi_env env, napi_callback_info info);
napi_value VoxCueConfigureInterviewAppearance(napi_env env, napi_callback_info info);
