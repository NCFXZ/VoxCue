#import <AppKit/AppKit.h>
#import <Sparkle/Sparkle.h>
#include <node_api.h>
#include <string>

@interface VoxCueUpdater : NSObject <SPUUserDriver, SPUUpdaterDelegate>
@property(nonatomic, strong) SPUUpdater *updater;
@property(nonatomic, copy) NSString *feed;
@property(nonatomic, copy) void (^cancellation)(void);
@property(nonatomic, copy) void (^ready)(SPUUserUpdateChoice);
@property(nonatomic) napi_threadsafe_function callback;
@property(nonatomic) BOOL committed;
@property(nonatomic) BOOL failed;
@property(nonatomic) BOOL cancelled;
- (void)emit:(NSString *)type error:(NSError *)error;
- (void)cancel;
@end

@implementation VoxCueUpdater
- (void)emit:(NSString *)type error:(NSError *)error {
  if (!_callback) return;
  NSDictionary *event = error ? @{ @"type": type, @"message": error.localizedDescription } : @{ @"type": type };
  NSData *data = [NSJSONSerialization dataWithJSONObject:event options:0 error:nil];
  auto *json = new std::string((const char *)data.bytes, data.length);
  if (napi_call_threadsafe_function(_callback, json, napi_tsfn_nonblocking) != napi_ok) delete json;
}
- (void)cancel {
  if (_committed) return;
  _cancelled = YES;
  if (_ready) { auto reply = _ready; _ready = nil; reply(SPUUserUpdateChoiceSkip); }
  if (_cancellation) { auto cancel = _cancellation; _cancellation = nil; cancel(); }
}
- (NSString *)feedURLStringForUpdater:(SPUUpdater *)updater { return _feed; }
- (void)showUpdatePermissionRequest:(SPUUpdatePermissionRequest *)request reply:(void (^)(SUUpdatePermissionResponse *))reply {
  reply([[SUUpdatePermissionResponse alloc] initWithAutomaticUpdateChecks:NO sendSystemProfile:NO]);
}
- (void)showUserInitiatedUpdateCheckWithCancellation:(void (^)(void))cancellation { _cancellation = [cancellation copy]; }
- (void)showUpdateFoundWithAppcastItem:(SUAppcastItem *)item state:(SPUUserUpdateState *)state reply:(void (^)(SPUUserUpdateChoice))reply {
  _cancellation = nil;
  reply((_cancelled || item.informationOnlyUpdate) ? SPUUserUpdateChoiceSkip : SPUUserUpdateChoiceInstall);
}
- (void)showUpdateReleaseNotesWithDownloadData:(SPUDownloadData *)data {}
- (void)showUpdateReleaseNotesFailedToDownloadWithError:(NSError *)error {}
- (void)showUpdateNotFoundWithError:(NSError *)error acknowledgement:(void (^)(void))ack { [self emit:@"error" error:error]; _failed = YES; ack(); }
- (void)showUpdaterError:(NSError *)error acknowledgement:(void (^)(void))ack { [self emit:@"error" error:error]; _failed = YES; ack(); }
- (void)showDownloadInitiatedWithCancellation:(void (^)(void))cancellation { _cancellation = [cancellation copy]; }
- (void)showDownloadDidReceiveExpectedContentLength:(uint64_t)length {}
- (void)showDownloadDidReceiveDataOfLength:(uint64_t)length {}
- (void)showDownloadDidStartExtractingUpdate { _cancellation = nil; [self emit:@"extracting" error:nil]; }
- (void)showExtractionReceivedProgress:(double)progress {}
- (void)showReadyToInstallAndRelaunch:(void (^)(SPUUserUpdateChoice))reply { if (_cancelled) { reply(SPUUserUpdateChoiceSkip); return; } _ready = [reply copy]; [self emit:@"ready" error:nil]; }
- (void)showInstallingUpdateWithApplicationTerminated:(BOOL)terminated retryTerminatingApplication:(void (^)(void))retry {}
- (void)updaterWillRelaunchApplication:(SPUUpdater *)updater { [self emit:@"quit" error:nil]; }
- (void)updater:(SPUUpdater *)updater didAbortWithError:(NSError *)error { if (!_failed) { _failed = YES; [self emit:@"error" error:error]; } }
- (void)showUpdateInstalledAndRelaunched:(BOOL)relaunched acknowledgement:(void (^)(void))ack { ack(); }
- (void)dismissUpdateInstallation { _cancellation = nil; _ready = nil; }
@end

static VoxCueUpdater *current;
static napi_value fail(napi_env env, const char *message) { napi_throw_error(env, nullptr, message); return nullptr; }
static void releaseCurrent() {
  [current cancel];
  if (current.callback) { napi_release_threadsafe_function(current.callback, napi_tsfn_abort); current.callback = nullptr; }
  current.updater = nil;
  current = nil;
}
static napi_value begin(napi_env env, napi_callback_info info) {
  if (![NSThread isMainThread]) return fail(env, "Updater must run on main thread");
  size_t count = 2; napi_value args[2]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  size_t length = 0; napi_valuetype callbackType;
  if (count != 2 || napi_get_value_string_utf8(env, args[0], nullptr, 0, &length) != napi_ok || length > 512 || napi_typeof(env, args[1], &callbackType) != napi_ok || callbackType != napi_function) return fail(env, "Invalid updater arguments");
  std::string text(length + 1, '\0'); napi_get_value_string_utf8(env, args[0], text.data(), text.size(), &length);
  NSString *feed = [[NSString alloc] initWithBytes:text.data() length:length encoding:NSUTF8StringEncoding];
  NSURL *url = [NSURL URLWithString:feed];
  NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^/[a-f0-9]{64}/appcast\\.xml$" options:0 error:nil];
  if (![url.scheme isEqual:@"http"] || ![url.host isEqual:@"127.0.0.1"] || !url.port || url.user || url.password || url.query || url.fragment || [pattern numberOfMatchesInString:url.path options:0 range:NSMakeRange(0, url.path.length)] != 1) return fail(env, "Invalid local update feed");
  if (current.updater.sessionInProgress || current.committed) return fail(env, "Update already in progress");
  releaseCurrent();
  current = [VoxCueUpdater new]; current.feed = feed;
  napi_value resource; napi_create_string_utf8(env, "VoxCueUpdater", NAPI_AUTO_LENGTH, &resource);
  napi_threadsafe_function tsfn;
  napi_status status = napi_create_threadsafe_function(env, args[1], nullptr, resource, 0, 1, nullptr, nullptr, nullptr,
    [](napi_env env, napi_value callback, void *, void *raw) {
      auto *json = static_cast<std::string *>(raw);
      if (env && callback) {
        napi_value global, JSON, parse, string, event, result;
        napi_get_global(env, &global); napi_get_named_property(env, global, "JSON", &JSON); napi_get_named_property(env, JSON, "parse", &parse);
        napi_create_string_utf8(env, json->data(), json->size(), &string); napi_call_function(env, JSON, parse, 1, &string, &event);
        napi_call_function(env, global, callback, 1, &event, &result);
      }
      delete json;
    }, &tsfn);
  if (status != napi_ok) { current = nil; return fail(env, "Updater callback unavailable"); }
  current.callback = tsfn; napi_unref_threadsafe_function(env, tsfn);
  NSBundle *bundle = NSBundle.mainBundle;
  current.updater = [[SPUUpdater alloc] initWithHostBundle:bundle applicationBundle:bundle userDriver:current delegate:current];
  NSError *error = nil;
  if (![current.updater startUpdater:&error]) { releaseCurrent(); return fail(env, "Updater initialization failed"); }
  current.updater.automaticallyChecksForUpdates = NO;
  current.updater.automaticallyDownloadsUpdates = NO;
  [current.updater checkForUpdates];
  return nullptr;
}
static napi_value commit(napi_env env, napi_callback_info info) {
  if (![NSThread isMainThread] || !current.ready || current.failed) return fail(env, "Update is not ready");
  auto reply = current.ready; current.ready = nil; current.committed = YES; reply(SPUUserUpdateChoiceInstall); return nullptr;
}
static napi_value cancel(napi_env env, napi_callback_info info) { if ([NSThread isMainThread]) [current cancel]; return nullptr; }
static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    { "begin", nullptr, begin, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "commit", nullptr, commit, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "cancel", nullptr, cancel, nullptr, nullptr, nullptr, napi_default, nullptr }
  };
  napi_define_properties(env, exports, 3, properties);
  napi_add_env_cleanup_hook(env, [](void *) { releaseCurrent(); }, nullptr);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
