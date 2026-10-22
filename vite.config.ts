/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { brand } from './src/app/configuration/brand';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
    include: ['src/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      exclude: ['**/*.test.ts', 'src/core/testing/**'],
      reporter: ['text-summary', 'text'],
      thresholds: { 'src/core/timer/**': { branches: 95 } },
    },
  },
});
