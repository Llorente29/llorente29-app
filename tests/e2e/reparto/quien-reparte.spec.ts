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

test('la pantalla: marcas × plataformas, herencia, avisos y la sugerencia de Folvy', async ({ page }, info) => {
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
  // Pita del Sur en Uber: «propios» sin dirección → punto ámbar.
  await expect(page.getByRole('group', { name: 'Pita del Sur en Uber Eats' }).locator('.cx-rp-aviso')).toBeVisible()
  // La sugerencia de Folvy (3 seguidos sin dirección en Uber). En ordenador va
  // la primera; en móvil ya la ha respondido la prueba de la sugerencia.
  if (!movil) await expect(page.getByText('En Uber, Pita del Sur lleva 3 pedidos seguidos sin dirección.')).toBeVisible()
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

test('la cocina: ámbar sin dirección, gris si reparte la plataforma, nada en rojo; y cambiar desde la etiqueta', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  const s = await entrarComo(page, CUENTA_A.email)
  await page.addInitScript((id) => { window.localStorage.setItem('andy-app-active-location', id) }, NORTE_CENTRO)
  await page.goto('/orders')

  // E2E01 (Burger Norte · Just Eat). Hay otro ámbar en el local (7B000, Uber):
  // se elige por la plataforma, no por el orden.
  const ambar = page.getByTestId('etiqueta-reparto')
    .filter({ hasText: 'Nosotros · falta la dirección' }).filter({ hasText: 'Just Eat no la ha mandado' }).first()
  await expect(ambar).toBeVisible()
  await expect(ambar).toHaveAttribute('data-tono', 'ambar')
  await expect(page.getByTestId('etiqueta-reparto').filter({ hasText: 'Uber no la ha mandado' }).first())
    .toHaveAttribute('data-tono', 'ambar')
  const gris = page.getByTestId('etiqueta-reparto').filter({ hasText: 'La reparte Glovo' }).first()
  await expect(gris).toHaveAttribute('data-tono', 'gris')
  await expect(page.getByText('No se pudo despachar')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Reintentar despacho/ })).toHaveCount(0)
  await page.screenshot({ path: `${DIR}/cocina-${movil ? 'movil' : 'ordenador'}.png`, fullPage: false })

  if (movil) return
  // «Cambiar a “la reparte Just Eat”»: escribe la celda y recoloca ESTE pedido.
  // Y se deja como estaba AUNQUE falle a medias: si no, la prueba del móvil,
  // en la misma ejecución, ya no encuentra el ámbar (e2e 37216044758).
  try {
    await ambar.getByRole('button', { name: 'Cambiar a «la reparte Just Eat»' }).click()
    await expect(page.getByText('Hecho: a partir de ahora esta marca en Just Eat la reparte Just Eat.')).toBeVisible()
    await expect(page.getByTestId('etiqueta-reparto').filter({ hasText: 'La reparte Just Eat' }).first()).toBeVisible()
  } finally {
    await rpc(s, 'reparto_cambiar_desde_pedido', { p_sale_id: 'e0200000-0000-4000-8000-0000000053a1', p_delivery_by: 'own' })
  }
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

test('la sugerencia de Folvy: «No, lo arreglo en Uber» queda escrito y no se vuelve a proponer', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: una vez basta')
  await entrarComo(page, CUENTA_A.email)
  await abrirQuienReparte(page)
  await page.getByRole('button', { name: 'No, lo arreglo en Uber' }).click()
  await expect(page.getByText('Anotado: Pita del Sur en Uber Eats sigue en «Nosotros».')).toBeVisible()
  await expect(page.getByText('En Uber, Pita del Sur lleva 3 pedidos seguidos sin dirección.')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Lo que ha hecho Folvy' })).toContainText('No aceptado')
})
