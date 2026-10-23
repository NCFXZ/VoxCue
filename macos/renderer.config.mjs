import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './scripts/build-symbols.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const shared = path.resolve(root, '../shared');
const adapters = new Map([
  ['components/icons', 'icons'],
  ['components/ui/material-button', 'MaterialButton'],
  ['components/ui/material-surface', 'MaterialSurface'],
  ['platform/materials', 'NativeMaterials'],
]);

// Layout and state stay in shared. These are the complete Mac rendering ports.
export default {
  build: { assetsInlineLimit: 0 },
  plugins: [
    {
      name: 'macos-ui-adapters',
      enforce: 'pre',
      resolveId(source, importer) {
        if (!importer || !source.startsWith('.')) return null;
        const target = path
          .resolve(path.dirname(importer.split('?')[0]), source)
          .replace(/\.tsx?$/, '');
        for (const [port, implementation] of adapters)
          if (target === path.join(shared, 'src', port))
            return path.join(root, 'src', implementation + '.tsx');
        return null;
      },
      generateBundle() {
        for (const module of this.getModuleIds()) {
          if (module.includes('/@fluentui/'))
            this.error('Mac UI must use SF Symbols; Fluent UI entered the renderer build.');
          if (
            [...adapters.keys()].some((port) =>
              ['.ts', '.tsx'].some(
                (extension) => module === path.join(shared, 'src', port + extension),
              ),
            ) ||
            module === path.join(shared, 'src/platform/webMaterials.ts') ||
            module === path.join(shared, 'src/platform/webMaterials.css')
          )
            this.error('A fallback renderer entered the Mac bundle: ' + module);
          if (module.startsWith(path.resolve(root, '../windows') + path.sep))
            this.error('Windows implementation entered the Mac renderer bundle.');
        }
      },
    },
  ],
};
