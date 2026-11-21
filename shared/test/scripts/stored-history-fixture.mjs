import path from 'node:path';
import workspace from '../../scripts/workspace.mjs';
import { waitForAsync } from './wait-for-async.mjs';

let bundle;

/** Provide the production storage primitives only to the requesting test-owned renderer. */
async function installHistoryFixture(page) {
  bundle ??= workspace.platformRequire('esbuild').build({
    entryPoints: [path.join(workspace.sharedRoot, 'test/scripts/stored-history-browser.ts')],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: 'fixtureHistory',
    footer: { js: 'globalThis.fixtureHistory = fixtureHistory;' },
    nodePaths: [path.join(workspace.platformRoot, 'node_modules')],
  }).then(({ outputFiles }) => outputFiles[0].text);
  const content = await bundle;
  if (!await page.evaluate(() => !!globalThis.fixtureHistory)) await page.evaluate(content);
}

export async function evaluateHistory(page, fn, arg) {
  await installHistoryFixture(page);
  return page.evaluate(fn, arg);
}

export async function waitForHistory(page, fn, arg) {
  await installHistoryFixture(page);
  return waitForAsync(page, fn, arg);
}
