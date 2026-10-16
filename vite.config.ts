import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'development-csp',
      apply: 'serve',
      // React Fast Refresh injects a preamble script in development only.
      transformIndexHtml: (html) =>
        html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';"),
    },
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./shared/src', import.meta.url)) } },
});
