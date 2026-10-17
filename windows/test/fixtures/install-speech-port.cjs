// Windows-only native port fixture. Shared UI tests choose this explicitly on
// Windows; no other platform is treated as having implemented native audio.
module.exports = function installSpeechPort(root) {
  const requireApp = require('node:module').createRequire(root + '/package.json');
  const { InterviewAccess } = requireApp(root + '/dist-electron/windows/electron/speech/access.js');
  InterviewAccess.prototype.check = async (options) => ({
    ready: true,
    devices: [],
    checks: options.sources.map((source) => ({
      source,
      status: 'granted',
      message: 'Synthetic device check',
    })),
  });
  const { SpeechHost } = requireApp(root + '/dist-electron/shared/electron/backend/speech/host.js');
  SpeechHost.prototype.call = async function (call) {
    if (call.op === 'start')
      setTimeout(
        () =>
          this.emit({
            type: 'segment',
            segment: {
              id: 'synthetic-system',
              source: 'system',
              text: 'Synthetic interviewer question',
              final: true,
              startMs: 0,
              endMs: 1000,
              reason: 'silence',
            },
          }),
        50,
      );
    return {
      state: call.op === 'start' ? 'running' : 'idle',
      model: 'Synthetic speech port',
      devices: [],
    };
  };
  SpeechHost.prototype.stop = () => {};
};
