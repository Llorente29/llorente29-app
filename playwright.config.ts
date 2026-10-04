// playwright.config.ts
//
// Pruebas de extremo a extremo del módulo de contabilidad (C01), contra
// staging-conta. Corren en GitHub Actions (.github/workflows/e2e-staging-conta.yml):
// desde el contenedor de desarrollo no se llega a *.supabase.co.
//
// Dos tamaños, los de las maquetas aprobadas: ordenador 1440 × 900 y móvil
// 390 × 844. La app se sirve con `vite preview` sobre el build hecho con las
// variables de staging-conta.

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'ordenador', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'movil', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
