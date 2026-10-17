/// <reference lib="dom" />
// tests/e2e/reparto/quien-reparte.spec.ts
//
// R02 · «Quién reparte» y la etiqueta de reparto de la cocina, en staging-conta
// (cuentas A y B de las semillas; escenario de supabase/seeds/reparto/
// seed_r02_e2e.sql, que el workflow deja igual antes de cada ejecución).
// Capturas junto a la maqueta en docs/reparto/capturas/r02/.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, STAGING_URL, anonKey, entrarComo, type Sesion } from '../conta/sesion'

const DIR = 'docs/reparto/capturas/r02'
const NORTE_CENTRO = 'c01a0000-0000-4000-8000-0000000000a2'

async function rpc(s: Sesion, fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${STAGING_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!r.ok) throw new Error(`${fn}: HTTP ${r.status} ${await r.text()}`)
  return await r.json()
}

async function abrirQuienReparte(page: Page) {
  await page.goto('/configuracion/quien-reparte')
  await expect(page.getByRole('heading', { level: 1, name: 'Quién reparte' })).toBeVisible()
  await expect(page.getByTestId('fila-Smash de Prueba')).toBeVisible()
}

test('la pantalla: marcas × plataformas y herencia; sin sugerencias de pasar a «Plataforma»', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  await entrarComo(page, CUENTA_A.email)
  await abrirQuienReparte(page)

  // Smash: interruptor apagado → migrada a «Plataforma» en las tres, decidida (azul).
  const smashGlovo = page.getByRole('group', { name: 'Smash de Prueba en Glovo' })
  await expect(smashGlovo).toHaveAttribute('data-valor', 'platform')
  await expect(smashGlovo).toHaveAttribute('data-decidida', 'true')
  // Burger Norte: «Nosotros» en Glovo. Las dos filas de «Si no dices nada».
  await expect(page.getByRole('group', { name: 'Burger Norte en Glovo' })).toHaveAttribute('data-valor', 'own')
  await expect(page.getByTestId('herencia-own')).toBeVisible()
  await expect(page.getByTestId('herencia-licensed')).toBeVisible()
  // R03 (Julio, 16/10): la sugerencia «lleva 3 pedidos seguidos sin dirección,
  // ¿la paso a Plataforma?» no puede existir; tampoco el aviso de las celdas ni
  // «Lo que ha hecho Folvy». Pita del Sur en Uber tiene pedidos «propios» sin
  // dirección en la semilla (los 7A1F*): si volviera, saldría aquí.
  await expect(page.getByText(/pedidos seguidos sin dirección|¿La paso a «Plataforma»/)).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Lo que ha hecho Folvy' })).toHaveCount(0)
  await expect(page.locator('.cx-rp-aviso')).toHaveCount(0)
  // Nada en rojo en la página.
  expect(await page.locator('.cx-rp').evaluate(el =>
    [...el.querySelectorAll('*')].some(n => getComputedStyle(n).color === 'rgb(163, 32, 26)' && (n.textContent ?? '').trim() !== ''))).toBe(false)

  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/quien-reparte-${movil ? 'movil' : 'ordenador'}.png`, fullPage: true })
})

test('guardar al tocar, lo que dice y «Deshacer»', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Se guarda igual en móvil; la prueba de escritura va una vez')
  const s = await entrarComo(page, CUENTA_A.email)
  await abrirQuienReparte(page)
  const celda = page.getByRole('group', { name: 'Smash de Prueba en Uber Eats' })
  await expect(celda).toHaveAttribute('data-valor', 'platform')

  await celda.getByRole('button', { name: 'Nosotros' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Guardado: Smash de Prueba en Uber Eats → Nosotros.' })).toBeVisible()
  await expect(page.getByText('los que ya están abiertos no cambian')).toBeVisible()
  await expect(celda).toHaveAttribute('data-valor', 'own')
  // La base dice lo mismo: el siguiente pedido de Smash en Uber entra como «propio».
  const r = await rpc(s, 'resolve_delivery_by', {
    p_account_id: CUENTA_A.id, p_brand_id: 'e0200000-0000-4000-8000-00000000a0b3', p_channel_slug: 'uber', p_location_id: null,
  }) as { delivery_by: string; source: string }[]
  expect(r[0]).toMatchObject({ delivery_by: 'own', source: 'manual' })

  await page.getByRole('button', { name: 'Deshacer' }).click()
  await expect(page.getByText('Deshecho: Smash de Prueba en Uber Eats vuelve a «Plataforma».')).toBeVisible()
  await expect(celda).toHaveAttribute('data-valor', 'platform')
})

test('la cocina: gris si reparte la plataforma, nada en rojo y ningún «Cambiar a “la reparte X”»', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  await entrarComo(page, CUENTA_A.email)
  await page.addInitScript((id) => { window.localStorage.setItem('andy-app-active-location', id) }, NORTE_CENTRO)
  await page.goto('/orders')

  // E2E01 (Burger Norte · Just Eat, «propio» sin dirección): R03, ya no es un
  // estado aparte. Sale como cualquier otro; este no trae ni calle ni punto del
  // mapa, así que la línea dice que no ha salido y que hay que llamar al
  // cliente (Julio, 17/10). Sin «Pedirla al cliente» ni
  // «Cambiar a “la reparte Just Eat”»: pasar la marca a «Plataforma» por
  // pedidos sin dirección no puede existir.
  const e2e01 = page.locator('[data-testid="tarjeta-pedido"][data-sale-id="e0200000-0000-4000-8000-0000000053a1"]')
  await expect(e2e01.getByTestId('etiqueta-reparto')).toContainText('Nosotros · aún sin rider')
  await expect(e2e01.getByTestId('aviso-sin-direccion-texto')).toHaveText('No ha salido a Catcher · llama al cliente y completa la dirección')
  await expect(page.getByRole('button', { name: /Cambiar a «la reparte/ })).toHaveCount(0)
  await expect(page.getByText('Pedirla al cliente')).toHaveCount(0)
  await expect(page.getByText(/no la ha mandado/)).toHaveCount(0)
  const gris = page.getByTestId('etiqueta-reparto').filter({ hasText: 'La reparte Glovo' }).first()
  await expect(gris).toHaveAttribute('data-tono', 'gris')
  await expect(page.getByText('No se pudo despachar')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Reintentar despacho/ })).toHaveCount(0)
  await page.screenshot({ path: `${DIR}/cocina-${movil ? 'movil' : 'ordenador'}.png`, fullPage: false })
})

test('la cuenta B no ve las marcas de A ni puede cambiar sus celdas', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'RLS: una vez basta')
  const s = await entrarComo(page, CUENTA_B.email)
  await page.goto('/configuracion/quien-reparte')
  await expect(page.getByRole('heading', { level: 1, name: 'Quién reparte' })).toBeVisible()
  await expect(page.getByTestId('fila-Kebab de Prueba')).toBeVisible()
  await expect(page.getByTestId('fila-Smash de Prueba')).toHaveCount(0)
  await expect(rpc(s, 'reparto_guardar_celda', {
    p_account_id: CUENTA_A.id, p_brand_id: 'e0200000-0000-4000-8000-00000000a0b3', p_channel_slug: 'uber',
    p_location_id: null, p_delivery_by: 'own', p_source: 'manual',
  })).rejects.toThrow(/HTTP 403|42501|permiso/)
})
