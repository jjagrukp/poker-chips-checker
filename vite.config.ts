/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { devApi } from './api/dev-server';
import { headersFile, SECURITY_HEADERS } from './api/security-headers';
import { brand } from './src/app/configuration/brand';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // Server-side env (no VITE_ prefix): never exposed to the client bundle.
    ...(process.env.VITEST ? [] : [devApi(loadEnv(mode, process.cwd(), ''))]),
    // Offline shell (D31): precache the build, never cache /api/*. Updates wait for the host.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: brand.appName,
        short_name: brand.shortName,
        description: brand.tagline,
        lang: 'en-AU',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: brand.themeColour,
        theme_color: brand.themeColour,
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Latin font files only (D43): other subsets load on demand and aren't needed offline.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}', '**/*-latin-*.woff2'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
    {
      name: 'security-headers',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile() });
      },
    },
    {
      name: 'brand-html',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) =>
          html
          .replaceAll('%APP_NAME%', brand.appName)
          .replaceAll('%APP_LOGO%', brand.logo)
          .replaceAll('%APP_TAGLINE%', brand.tagline)
          .replaceAll('%THEME_COLOUR%', brand.themeColour),
      },
    },
  ],
  preview: { headers: { ...SECURITY_HEADERS } },
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
