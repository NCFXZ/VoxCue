#include <node_api.h>
#import <AppKit/AppKit.h>
bool VoxCueIsScrollChrome(NSView *view);
void VoxCueRemoveScrollChrome(NSView *host);
napi_value VoxCueConfigureScrollChrome(napi_env env, napi_callback_info info);
napi_value VoxCueDetachSurface(napi_env env, napi_callback_info info);
napi_value VoxCueAttachSurface(napi_env env, napi_callback_info info);
void VoxCueUpdateInterviewFollow(NSView *host, NSRect frame, BOOL visible, NSRect modal, CGFloat modalRadius, BOOL emphasized);

NSView *VoxCueSharedRendererHost(NSView *host);
NSView *VoxCueSharedWebView(NSView *host);
NSView *VoxCueSharedPaintView(NSView *host);
NSView *VoxCueModalBackdropAnchor(NSView *host);
NSView *VoxCueScrollHeaderContent(NSView *host, NSRect control);
NSRect VoxCueModalExclusion(NSView *host);
CGPathRef VoxCueContinuousContour(NSSize size, CGFloat radius);
bool VoxCuePositionScrollingControl(NSView *host, NSView *control);
