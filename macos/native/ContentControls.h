#include <node_api.h>
#import <AppKit/AppKit.h>

bool VoxCueIsContentControl(NSView *view);
void VoxCueRefreshContentControlPlacement(NSView *host);
napi_value VoxCueConfigureContentControls(napi_env env, napi_callback_info info);
