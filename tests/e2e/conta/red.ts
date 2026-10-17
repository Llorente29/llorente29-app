// tests/e2e/conta/red.ts
//
// «networkidle» CON TOPE. Playwright no le pone ninguno: si la página no deja
// de pedir, espera hasta que muere la prueba (120 s). Pasó tres veces en
// c06/recorrido.spec.ts (15/10, e2e 38627304998 y 38792955068: dentro de la
// cuenta y dos minutos esperando a la red) y lo arregló C ahí con este mismo
// patrón, que ya estaba en solapes.ts (06/10). W02 (16/10): las cuatro esperas
// que quedaban sin tope (c06/sola ×2, c06/recorrido, m01/marco) usan esto.
//
// Diez segundos, y si no se calla la red, el log dice QUÉ sigue pidiendo: un
// bucle de peticiones es un fallo de la app, no algo que esperar.

import type { Page } from '@playwright/test'

export async function redQuieta(page: Page, tope = 10_000): Promise<void> {
  const abiertas = new Map<object, string>()
  const alPedir = (r: { url: () => string }) => abiertas.set(r, r.url())
  const alAcabar = (r: object) => abiertas.delete(r)
  page.on('request', alPedir); page.on('requestfinished', alAcabar); page.on('requestfailed', alAcabar)
  await page.waitForLoadState('networkidle', { timeout: tope }).catch(() => {
    console.log(`[red sin parar] ${page.url()} · ${abiertas.size} abiertas: ${[...new Set(abiertas.values())].slice(0, 10).join(' · ')}`)
  })
  page.off('request', alPedir); page.off('requestfinished', alAcabar); page.off('requestfailed', alAcabar)
}
