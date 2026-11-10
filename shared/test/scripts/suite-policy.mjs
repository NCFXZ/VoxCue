// Only isolated Node/loopback protocol checks may share a batch. GUI, native,
// inference, timing and soak checks keep exclusive execution.
export const parallelSuites = new Set(['cloud-protocol', 'server-connection', 'telemetry-v2-http']);

const modelFree = new Set([
  ...parallelSuites,
  'free-service',
  'account-usage-overview',
  'language',
  'shortcut-settings',
  'interview-badge-layout',
  'interview-shortcuts',
  'mobile-bundle',
  'mobile-ui',
  'preparation-guide',
  'interview-typography',
  'interview-chrome',
  'interview-motion',
  'interview-ux',
  'interview-screenshot',
  'interview-retry',
  'interview-effort',
  'copilot-runtime',
  'chatgpt-usage-runtime',
]);

export function needsModels(names) {
  // Unknown/new suites retain model preparation until explicitly audited.
  return names.some((name) => !modelFree.has(name));
}

export function executionBatches(names, jobs = 2) {
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 3)
    throw Error('Use --jobs=1, --jobs=2 or --jobs=3');
  if (jobs === 1) return names.map((name) => [name]);
  const parallel = names.filter((name) => parallelSuites.has(name));
  const batches = [];
  for (let index = 0; index < parallel.length; index += jobs)
    batches.push(parallel.slice(index, index + jobs));
  return [...batches, ...names.filter((name) => !parallelSuites.has(name)).map((name) => [name])];
}
