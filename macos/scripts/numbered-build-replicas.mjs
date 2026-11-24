import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import workspace from '../../shared/scripts/workspace.mjs';

const root = workspace.platformRoot;

// A space and a number can belong to a real resource. Only discard a sibling
// copy that neither the build inputs nor the compiler named as an output.
export async function numberedBuildReplicas(entries) {
  const paths = new Set(entries);
  const candidates = entries.filter((entry) => {
    if (!/^\/(?:dist|dist-electron)\//.test(entry)) return false;
    const original = entry.replace(/ (?:[2-9]\d*|1\d+)(?=\.[^/]+$|$)/, '');
    return original !== entry && paths.has(original);
  });
  if (!candidates.length) return [];
  const outputs = new Set();
  if (candidates.some((entry) => entry.startsWith('/dist/'))) {
    const manifest = JSON.parse(await readFile(path.join(root, 'dist/.vite/manifest.json'), 'utf8'));
    for (const chunk of Object.values(manifest)) {
      for (const file of [chunk.file, ...(chunk.assets ?? []), ...(chunk.css ?? [])])
        outputs.add('/dist/' + file);
      if (chunk.isEntry && chunk.src?.endsWith('.html')) outputs.add('/dist/' + chunk.src);
    }
    outputs.add('/dist/.vite/manifest.json');
  }
  if (candidates.some((entry) => entry.startsWith('/dist-electron/'))) {
    const ts = workspace.platformRequire('typescript');
    const config = ts.getParsedCommandLineOfConfigFile(
      path.join(root, 'tsconfig.electron.json'),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic(diagnostic) {
          throw Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
        },
      },
    );
    for (const source of config.fileNames)
      for (const file of ts.getOutputFileNames(config, source, false))
        outputs.add('/' + path.relative(root, file));
  }
  return candidates.filter((entry) => {
    if (
      entry.startsWith('/dist/') &&
      existsSync(path.join(workspace.sharedRoot, 'public', entry.slice('/dist/'.length)))
    )
      return false;
    return !outputs.has(entry);
  });
}
