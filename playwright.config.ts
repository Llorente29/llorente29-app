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
  // scripts/e2e/por-fichero.sh corre cada fichero aparte: cada uno con su
  // carpeta de trazas (Playwright vacía la suya al empezar).
  outputDir: process.env.E2E_SALIDA || 'test-results',
  // En Actions, también «github»: cada fallo sale como anotación de la
  // ejecución (el informe y los registros no siempre se pueden descargar).
  reporter: process.env.CI
    ? [['list'], ['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    // S01e: `locale` no llega al selector nativo de fecha de Chromium, que
    // pintaba «10/18/2026»: ese lo decide el idioma del navegador.
    launchOptions: { args: ['--lang=es-ES'], env: { ...process.env, LANG: 'es_ES.UTF-8', LANGUAGE: 'es_ES:es' } },
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
    // por-fichero.sh arranca el servidor una vez para todos los ficheros.
    reuseExistingServer: !!process.env.E2E_SERVIDOR_FUERA,
    timeout: 60_000,
  },
})
