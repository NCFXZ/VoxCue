import { expect, it } from 'vitest';
import { executionBatches, needsModels, parallelSuites } from '../scripts/suite-policy.mjs';

it('only batches isolated Node protocols and keeps every requested test exactly once', () => {
  const names = [
    'login',
    'cloud-protocol',
    'speech-soak',
    'server-connection',
    'free-service',
    'telemetry-v2-http',
    'rag-core',
  ];
  for (const jobs of [1, 2, 3]) {
    const batches = executionBatches(names, jobs);
    expect(batches.flat().toSorted()).toEqual(names.toSorted());
    expect(batches.every((batch) => batch.length <= jobs)).toBe(true);
    for (const batch of batches)
      if (batch.length > 1) expect(batch.every((name) => parallelSuites.has(name))).toBe(true);
    expect(batches.flat().filter((name) => !parallelSuites.has(name))).toEqual([
      'login',
      'speech-soak',
      'free-service',
      'rag-core',
    ]);
  }
  expect(executionBatches(names, 1).flat()).toEqual(names);
});

it('keeps repeated explicit requests, while rejecting unsafe or unbounded concurrency', () => {
  expect(
    executionBatches(['login', 'login', 'cloud-protocol'])
      .flat()
      .filter((name) => name === 'login'),
  ).toHaveLength(2);
  for (const jobs of [0, 4, -1, 1.5, NaN]) expect(() => executionBatches([], jobs)).toThrow();
});

it('skips models only for audited synthetic cases and retains them for unknown/native/inference checks', () => {
  expect(needsModels(['free-service', 'account-usage-overview', 'language'])).toBe(false);
  expect(needsModels(['cloud-protocol', 'server-connection', 'telemetry-v2-http'])).toBe(false);
  for (const name of [
    'rag-core',
    'rag-ui',
    'audio-pipeline',
    'speech-soak',
    'echo-cancellation',
    'new-suite',
  ])
    expect(needsModels(['free-service', name])).toBe(true);
});
