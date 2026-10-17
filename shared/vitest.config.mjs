import viteConfig from './vite.config.mjs';
import workspace from './scripts/workspace.mjs';
import path from 'node:path';

const { platformRoot } = workspace;
// Source tests execute CommonJS requires before compilation into the platform app.
// Child test processes receive the active installation's normal Node search path.
process.env.NODE_PATH = path.join(platformRoot, 'node_modules');
export default {
  ...viteConfig,
  root: platformRoot,
  test: {
    cache: false,
    include: [
      'test/{unit,renderer}/**/*.test.{ts,tsx}',
      '../shared/test/{unit,renderer}/**/*.test.{ts,tsx}',
    ],
  },
};
