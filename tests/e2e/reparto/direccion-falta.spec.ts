/// <reference lib="dom" />
// tests/e2e/reparto/direccion-falta.spec.ts
//
// R03 · La dirección que no llega, la espera de 5 minutos, el ticket de la
// bolsa y el código de Uber (Julio, 16/10), en staging-conta, en el ordenador
// (sesión, /orders) y en la tablet (token, /estacion). El escenario, de
// supabase/seeds/reparto/seed_r02_e2e.sql (parte R03), todo inventado:
//   R03A · con dirección (piso y puerta)  → sin aviso; ticket con ENTREGA
//   R03B · sin calle, con punto           → aviso; la pega el ordenador a tiempo
//   R03C · sin nada                       → aviso; ticket «SIN DIRECCIÓN · LLAMAR AL CLIENTE»
//   R03D · sin calle, con punto           → aviso; la pega la tablet
//   R03E · sin calle, con punto, sin pegar → aviso en las dos vistas
//   R03U · Uber con dirección y código    → sin aviso; tarjeta y ticket con «Tel. … · código …»
// Los locales de prueba despachan a mano (en automático, el disparador llamaría
// a la función de producción): el aviso dice «Este local despacha a mano» en
// vez de la cuenta atrás, y pegar no llama a Catcher. La cuenta atrás está
// probada en tests/unit/modules/reparto/direccionFalta.test.ts y la espera en
// supabase/staging/sql/20261118_r03_espera_ticket_codigo_prueba.sql.
// Capturas y fotos de los tickets en docs/reparto/capturas/r03/.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, STAGING_URL, anonKey, entrarComo } from '../conta/sesion'

const DIR = 'docs/reparto/capturas/r03'
const NORTE_CENTRO = 'c01a0000-0000-4000-8000-0000000000a2'
const TOKEN_CENTRO = 'r03-e2e-norte-centro'
const TOKEN_MERCADO = 'r03-e2e-norte-mercado'
const R03B = 'e0300000-0000-4000-8000-0000000000a2'

async function rpcAnon(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${STAGING_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${anonKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) }
}

const avisoDe = (page: Page, codigo: string) => page.getByTestId('aviso-direccion-pedido').filter({ hasText: codigo })
// La tarjeta, por el id del pedido (el código de pase lo decide passCode, no la tarjeta).
const ID: Record<string, string> = {
  R03A: 'e0300000-0000-4000-8000-0000000000a1', R03B: 'e0300000-0000-4000-8000-0000000000a2',
  R03C: 'e0300000-0000-4000-8000-0000000000a3', R03U: 'e0300000-0000-4000-8000-0000000000a6',
}
const tarjeta = (page: Page, codigo: string) => page.locator(`[data-testid="tarjeta-pedido"][data-sale-id="${ID[codigo]}"]`)

async function abrirPedidos(page: Page) {
  await entrarComo(page, CUENTA_A.email)
  await page.addInitScript((id) => { window.localStorage.setItem('andy-app-active-location', id) }, NORTE_CENTRO)
  await page.goto('/orders')
  await expect(page.getByTestId('aviso-direccion-falta')).toBeVisible()
}

async function lasDeLaCocina(page: Page) {
  const aviso = page.getByTestId('aviso-direccion-falta')
  await expect(aviso).toBeVisible()
  // Con dirección (R03A, R03U): no salen. Sin dirección (R03C sin nada, R03E con punto): sí.
  await expect(avisoDe(page, 'R03A')).toHaveCount(0)
  await expect(avisoDe(page, 'R03U')).toHaveCount(0)
  await expect(avisoDe(page, 'R03C').getByRole('heading', { name: 'Falta la dirección de este pedido' })).toBeVisible()
  await expect(avisoDe(page, 'R03C').getByTestId('aviso-direccion-numero')).toHaveText('100000000033')
  await expect(avisoDe(page, 'R03C').getByRole('link', { name: 'Ver el punto del mapa' })).toHaveCount(0)
  await expect(avisoDe(page, 'R03E').getByRole('link', { name: 'Ver el punto del mapa' })).toBeVisible()
  // Cuándo sale: en un local a mano, no sale solo, y lo dice.
  await expect(avisoDe(page, 'R03E').getByTestId('aviso-direccion-salida')).toHaveText('Este local despacha a mano: no sale solo.')
  const fondo = await aviso.locator('> div').evaluate(el => getComputedStyle(el).backgroundColor)
  expect(fondo).toBe('rgb(198, 40, 40)')
  await expect(page.getByText(/no la ha mandado/)).toHaveCount(0)
}

/** Abre los tickets del pedido, deja la foto de la bolsa como sale en la impresora y devuelve la vista. */
async function fotoDelTicket(page: Page, codigo: string, archivo: string) {
  await tarjeta(page, codigo).getByTitle('Tickets · reimprimir').click()
  const img = page.getByTestId('ticket-bolsa-impreso')
  await expect(img).toBeVisible()
  await img.screenshot({ path: `${DIR}/${archivo}` })
  return page.getByTestId('ticket-preview')
}

async function cerrarTicket(page: Page) {
  await page.mouse.click(5, 5)
  await expect(page.getByTestId('ticket-bolsa-impreso')).toHaveCount(0)
}

test('ordenador: el aviso rojo, y pegar la dirección a tiempo (R03B)', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  await abrirPedidos(page)
  await lasDeLaCocina(page)
  await page.evaluate(() => document.fonts.ready)
  await page.getByTestId('aviso-direccion-falta').screenshot({ path: `${DIR}/aviso-ordenador${movil ? '-movil' : ''}.png` })
  if (movil) return // escribe una vez

  const b = avisoDe(page, 'R03B')
  await expect(b.getByRole('button', { name: 'Mandar a Catcher' })).toBeDisabled()
  await b.getByTestId('aviso-direccion-casilla').fill('Calle Pegada de Prueba, 2, Piso 3, Puerta A, Portal B')
  await b.getByRole('button', { name: 'Mandar a Catcher' }).click()
  await expect(page.getByTestId('aviso-direccion-resuelto').filter({ hasText: 'R03B' }))
    .toContainText('Guardada: «Calle Pegada de Prueba, 2, Piso 3, Puerta A, Portal B». Este local despacha a mano: pulsa «Despachar» en el pedido.')
  await expect(avisoDe(page, 'R03B')).toHaveCount(0)
  await page.getByTestId('aviso-direccion-falta').screenshot({ path: `${DIR}/aviso-ordenador-pegada.png` })

  // El ticket de la bolsa lleva la dirección pegada, con el piso, la puerta y el portal aparte.
  await page.reload()
  const t = await fotoDelTicket(page, 'R03B', 'ticket-sin-calle-pegada.png')
  await expect(t).toContainText('ENTREGA')
  await expect(t).toContainText('Calle Pegada de Prueba, 2')
  await expect(t).toContainText('Piso 3, Puerta A, Portal B')
})

test('ordenador: el ticket con dirección, sin dirección y de Uber con código', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Los tickets son los mismos: una vez basta')
  await abrirPedidos(page)

  // Con dirección (R03A): ENTREGA con la calle y, aparte, el piso y la puerta.
  let t = await fotoDelTicket(page, 'R03A', 'ticket-con-direccion.png')
  await expect(t).toContainText('ENTREGA')
  await expect(t).toContainText('Calle Inventada de Prueba, 1, 28000')
  await expect(t).toContainText('Piso: 4, Puerta: A')
  await expect(t).toContainText('Indicaciones: Timbre 4A')
  await cerrarTicket(page)

  // Sin nada (R03C): lo dice, con el teléfono.
  t = await fotoDelTicket(page, 'R03C', 'ticket-sin-direccion.png')
  await expect(t).toContainText('SIN DIRECCIÓN · LLAMAR AL CLIENTE')
  await expect(t).toContainText('Tel. +34600000003')
  await cerrarTicket(page)

  // Uber con código (R03U): en la tarjeta y en el ticket.
  await expect(tarjeta(page, 'R03U').getByTestId('telefono-cliente')).toHaveText('Tel. +34900000000 · código 12345678')
  await tarjeta(page, 'R03U').screenshot({ path: `${DIR}/tarjeta-uber-codigo.png` })
  t = await fotoDelTicket(page, 'R03U', 'ticket-uber-codigo.png')
  await expect(t).toContainText('Tel. +34900000000 · código 12345678')
  await expect(t).toContainText('Unit: 3C')
  await expect(t).toContainText('Indicaciones: Timbre 3C')
  await expect(t).toContainText('Nota del cliente: Sin cebolla')
})

test('tablet: el mismo aviso por el token del dispositivo, y pegar la dirección (R03D)', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  if (!movil) await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/estacion?token=${TOKEN_CENTRO}`)
  await lasDeLaCocina(page)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/aviso-tablet${movil ? '-movil' : ''}.png`, fullPage: false })
  if (movil) return

  const d = avisoDe(page, 'R03D')
  await d.getByTestId('aviso-direccion-casilla').fill('Calle Pegada de Prueba, 4, Piso 1, Puerta C')
  await d.getByRole('button', { name: 'Mandar a Catcher' }).click()
  await expect(page.getByTestId('aviso-direccion-resuelto').filter({ hasText: 'R03D' }))
    .toContainText('Guardada: «Calle Pegada de Prueba, 4, Piso 1, Puerta C».')
  await expect(avisoDe(page, 'R03D')).toHaveCount(0)
  await page.screenshot({ path: `${DIR}/aviso-tablet-pegada.png`, fullPage: false })
})

test('permiso por local: la tablet de Norte Mercado no ve ni toca los pedidos de Norte Centro', async () => {
  test.skip(test.info().project.name === 'movil', 'Permisos: una vez basta')
  const aviso = await rpcAnon('pedidos_sin_direccion', { p_location_id: null, p_token: TOKEN_MERCADO })
  expect(aviso.ok).toBe(true)
  const codigos = ((aviso.body?.pedidos ?? []) as { code: string }[]).map(p => p.code)
  expect(codigos.filter(c => c.startsWith('R03'))).toEqual([])
  const centro = await rpcAnon('pedidos_sin_direccion', { p_location_id: null, p_token: TOKEN_CENTRO })
  expect(((centro.body?.pedidos ?? []) as { code: string }[]).map(p => p.code)).toContain('R03C')
  const punto = await rpcAnon('sale_coordenadas_de_entrega_by_token', { p_device_token: TOKEN_MERCADO, p_sale_id: R03B })
  expect(punto.ok).toBe(false)
  const puntoSuyo = await rpcAnon('sale_coordenadas_de_entrega_by_token', { p_device_token: TOKEN_CENTRO, p_sale_id: R03B })
  expect(puntoSuyo.ok).toBe(true)
  const pegar = await rpcAnon('fijar_direccion_entrega', { p_sale_id: R03B, p_direccion: 'Calle Inventada de Prueba, 9', p_token: TOKEN_MERCADO })
  expect(pegar.ok).toBe(false)
  const sesion = await rpcAnon('sale_coordenadas_de_entrega', { p_sale_id: R03B })
  expect(sesion.ok).toBe(false)
  const sinNada = await rpcAnon('pedidos_sin_direccion', { p_location_id: NORTE_CENTRO, p_token: null })
  expect(sinNada.ok).toBe(false)
})
