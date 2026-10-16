import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Historical snapshots, generated probes and package fixtures are not test roots.
export default mergeConfig(
  viteConfig,
  defineConfig({ test: { include: ['test/{shared,windows,macos}/**/*.test.{ts,tsx}'] } }),
);
