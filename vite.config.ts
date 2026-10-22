/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { devApi } from './api/dev-server';
import { brand } from './src/app/configuration/brand';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // Server-side env (no VITE_ prefix): never exposed to the client bundle.
    ...(process.env.VITEST ? [] : [devApi(loadEnv(mode, process.cwd(), ''))]),
    {
      name: 'brand-html',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) =>
          html.replaceAll('%APP_NAME%', brand.appName).replaceAll('%APP_LOGO%', brand.logo),
      },
    },
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.ts', 'api/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      exclude: ['**/*.test.ts', 'src/core/testing/**'],
      reporter: ['text-summary', 'text'],
      thresholds: { 'src/core/timer/**': { branches: 95 } },
    },
  },
}));
