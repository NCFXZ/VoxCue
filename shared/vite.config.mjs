import path from 'node:path';
import { pathToFileURL } from 'node:url';
import workspace from './scripts/workspace.mjs';

const { platformRequire, platformRoot, sharedRoot, repositoryRoot, platformName } = workspace;
if (platformName === 'macos')
  await import(pathToFileURL(path.join(platformRoot, 'scripts/build-symbols.mjs')).href);
const load = async (name) => import(pathToFileURL(platformRequire.resolve(name)).href);
const { default: react } = await load('@vitejs/plugin-react');
const { default: tailwindcss } = await load('@tailwindcss/vite');
const manifest = platformRequire('./package.json');
const packages = new Set([
  ...Object.keys(manifest.dependencies),
  ...Object.keys(manifest.devDependencies).filter((name) => name !== 'vite'),
]);

export default {
  root: sharedRoot,
  base: './',
  publicDir: path.join(sharedRoot, 'public'),
  cacheDir: path.join(platformRoot, 'node_modules/.vite'),
  server: { fs: { allow: [repositoryRoot] } },
  build: {
    outDir: path.join(platformRoot, 'dist'),
    emptyOutDir: true,
    ...(platformName === 'macos' ? { assetsInlineLimit: 0 } : {}),
  },
  plugins: [
    {
      name: 'platform-ui-icons',
      enforce: 'pre',
      resolveId(source, importer) {
        if (platformName !== 'macos' || !importer || !source.startsWith('.')) return null;
        const target = path.resolve(path.dirname(importer.split('?')[0]), source);
        const sharedIcons = path.join(sharedRoot, 'src/components/icons');
        if (target === sharedIcons || target === sharedIcons + '.tsx')
          return path.join(platformRoot, 'src/icons.tsx');
        return null;
      },
      generateBundle() {
        if (platformName === 'macos')
          for (const module of this.getModuleIds())
            if (module.includes('/@fluentui/'))
              this.error('Mac UI must use SF Symbols; Fluent UI entered the renderer build.');
      },
    },
    {
      name: 'platform-dependencies',
      enforce: 'pre',
      configResolved(config) {
        // This resolver already selects one platform installation. Root-based React
        // deduplication would otherwise look for node_modules inside shared/.
        config.resolve.dedupe = [];
        for (const environment of Object.values(config.environments))
          environment.resolve.dedupe = [];
      },
      async resolveId(source, importer, options) {
        if (
          !importer ||
          source.startsWith('.') ||
          source.startsWith('/') ||
          source.startsWith('\0')
        )
          return null;
        const name = source.startsWith('@')
          ? source.split('/').slice(0, 2).join('/')
          : source.split('/')[0];
        if (!packages.has(name)) return null;
        // Resolve from this installation while retaining package export/browser conditions.
        return this.resolve(source, path.join(platformRoot, 'package.json'), {
          ...options,
          skipSelf: true,
        });
      },
    },
    react(),
    tailwindcss(),
    {
      name: 'development-csp',
      apply: 'serve',
      transformIndexHtml: (html) =>
        html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';"),
    },
  ],
  resolve: {
    alias: {
      '@': path.join(sharedRoot, 'src'),
      tailwindcss: path.join(platformRoot, 'node_modules/tailwindcss'),
    },
  },
};
