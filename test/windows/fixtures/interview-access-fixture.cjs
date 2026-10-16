// Test-only native permission/device seam. The actual access policy stays real.
module.exports = (modulePath) => {
  const { InterviewAccess } = require(modulePath);
  const check = InterviewAccess.prototype.check;
  InterviewAccess.prototype.check = async function (options) {
    globalThis.accessCalls = [...(globalThis.accessCalls || []), structuredClone(options)];
    if (globalThis.delayAccess)
      await new Promise((resolve) => {
        globalThis.resumeAccess = resolve;
      });
    if (globalThis.accessFailure) throw Error('Synthetic access check failure');
    const instance = new InterviewAccess({
      platform: 'win32',
      microphonePermission: () => (globalThis.microphoneDenied ? 'denied' : 'granted'),
      devices: async () => [
        ...(globalThis.systemMissing
          ? []
          : [{ id: 'fixture-system', name: '测试扬声器', source: 'system', default: true }]),
        ...(globalThis.microphoneMissing
          ? []
          : [{ id: 'fixture-mic', name: '测试麦克风设备', source: 'microphone', default: true }]),
      ],
      probe: async (source) =>
        globalThis.systemDenied && source === 'system'
          ? { ok: false, code: '0x80070005' }
          : { ok: true },
    });
    return check.call(instance, options);
  };
};
