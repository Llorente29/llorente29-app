// tests/e2e/conta/barra.ts
//
// N5 · La regla de anchos (Julio, 23/10): en Compras y gastos, entre 1280 y
// 1599 px la barra se pliega sola, y el ordenador de las pruebas es de 1440.
// Las pruebas que miran las páginas de la barra la abren a mano, como haría
// la persona; en el móvil no hace nada (la barra va en el cajón).

import { expect, type Page } from '@playwright/test'

export async function barraAbiertaSiPlegada(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) < 768) return
  const barra = page.getByRole('navigation', { name: 'Menú de contabilidad' })
  await expect(barra).toHaveAttribute('data-desplegada', /^(si|no)$/, { timeout: 30_000 })
  if (await barra.getAttribute('data-desplegada') === 'no') {
    await barra.getByRole('button', { name: 'Desplegar el menú' }).click()
    await expect(barra).toHaveAttribute('data-desplegada', 'si')
  }
}
