import path from 'node:path';
import { pathToFileURL } from 'node:url';
import workspace from './scripts/workspace.mjs';

const { platformRequire, platformRoot, sharedRoot, repositoryRoot } = workspace;
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
    manifest: true,
    rollupOptions: {
      input: {
        index: path.join(sharedRoot, 'index.html'),
        mobile: path.join(sharedRoot, 'mobile.html'),
      },
    },
  },
  plugins: [
    ...(workspace.platformName === 'macos'
      ? [
          {
            name: 'macos-symbol-icons',
            enforce: 'pre',
            resolveId(source, importer) {
              if (!importer || !source.startsWith('.')) return null;
              const resolved = path.resolve(path.dirname(importer), source);
              const mobile = path.join(sharedRoot, 'src/mobile/MobileIcon');
              if (resolved === mobile || resolved === mobile + '.tsx')
                return path.join(platformRoot, 'src/mobile/MobileIcon.tsx');
              const icons = path.join(sharedRoot, 'src/components/icons');
              // Only artwork differs. Controls, materials and pages stay shared.
              return resolved === icons || resolved === icons + '.tsx'
                ? path.join(platformRoot, 'src/icons.tsx')
                : null;
            },
          },
        ]
      : []),
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
        html
          .replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
          .replace(
            "connect-src 'self';",
            "connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*;",
          ),
    },
  ],
  resolve: {
    alias: {
      '@': path.join(sharedRoot, 'src'),
      tailwindcss: path.join(platformRoot, 'node_modules/tailwindcss'),
    },
  },
};
