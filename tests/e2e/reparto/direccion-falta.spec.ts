/// <reference lib="dom" />
// tests/e2e/reparto/direccion-falta.spec.ts
//
// R03 · Los pedidos de reparto propio sin dirección completa, el ticket de la
// bolsa, el código de Uber y quién reparte cada Uber (Julio, 16/10, con los
// cambios de después de ver las capturas), en staging-conta: el ordenador
// (sesión, /orders y /orders/despacho) y la tablet (token, /estacion). El
// escenario, de supabase/seeds/reparto/seed_r02_e2e.sql (parte R03), inventado:
//   R03A · con dirección (piso y puerta)        → ticket con ENTREGA
//   R03N · con dirección, indicaciones y nota   → ticket con el recuadro de notas
//   R03B · sin calle, con punto                 → línea informativa; la oficina la completa
//   R03C · sin calle ni punto, no ha salido     → aviso rojo con el motivo; ticket «SIN DIRECCIÓN»
//   R03D · sin calle, con punto                 → en la tablet, solo la línea, sin botón
//   R03E · sin calle, con punto                 → en la lista de Despacho, sin completar
//   R03U · Uber con dirección y código          → tarjeta y ticket con «Tel. … · código …»
//   R03V · Uber sin calle, punto ni cargo       → la reparte Uber, fuera de zona: ni aviso ni Catcher
//   7B000 · Uber sin calle, punto ni cargo (R02) → lo mismo, por la regla
//   R03T · Uber con las tres, tabla en «Plataforma» → propio (la regla por pedido manda)
//   R03M · Uber mezclado                        → aviso «Decide quién reparte»; se decide «Uber»
// Sin espera: un pedido sin dirección completa sale a Catcher al momento. Los
// locales de prueba despachan a mano (en automático, el disparador llamaría a
// la función de producción), así que aquí la línea dice «despáchalo»; el
// «salió a Catcher» está en la prueba unitaria y que pueda salir ya, en
// supabase/staging/sql/20261118_r03_ticket_codigo_quien_reparte_prueba.sql.
// Capturas y fotos de los tickets en docs/reparto/capturas/r03/.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, STAGING_URL, anonKey, entrarComo } from '../conta/sesion'

const DIR = 'docs/reparto/capturas/r03'
const NORTE_CENTRO = 'c01a0000-0000-4000-8000-0000000000a2'
const TOKEN_CENTRO = 'r03-e2e-norte-centro'
const TOKEN_MERCADO = 'r03-e2e-norte-mercado'
const R03B = 'e0300000-0000-4000-8000-0000000000a2'
const MOTIVO_R03C = 'la dirección no ha llegado y tampoco el punto del mapa: no se puede despachar'

async function rpcAnon(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${STAGING_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${anonKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) }
}

// La tarjeta, por el id del pedido (el código de pase lo decide passCode, no la tarjeta).
const ID: Record<string, string> = {
  R03A: 'e0300000-0000-4000-8000-0000000000a1', R03B: 'e0300000-0000-4000-8000-0000000000a2',
  R03C: 'e0300000-0000-4000-8000-0000000000a3', R03D: 'e0300000-0000-4000-8000-0000000000a4',
  R03E: 'e0300000-0000-4000-8000-0000000000a5', R03U: 'e0300000-0000-4000-8000-0000000000a6',
  R03V: 'e0300000-0000-4000-8000-0000000000a7', R03T: 'e0300000-0000-4000-8000-0000000000a8',
  R03M: 'e0300000-0000-4000-8000-0000000000a9', R03N: 'e0300000-0000-4000-8000-0000000000b1',
  '7B000': 'e0200000-0000-4000-8000-0000000052a1',
}
const tarjeta = (page: Page, codigo: string) => page.locator(`[data-testid="tarjeta-pedido"][data-sale-id="${ID[codigo]}"]`)
const noHaSalido = (page: Page, codigo: string) => page.getByTestId('aviso-no-ha-salido').filter({ hasText: codigo })

async function abrirPedidos(page: Page) {
  await entrarComo(page, CUENTA_A.email)
  await page.addInitScript((id) => { window.localStorage.setItem('andy-app-active-location', id) }, NORTE_CENTRO)
  await page.goto('/orders')
  await expect(tarjeta(page, 'R03B')).toBeVisible()
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

test('ordenador: sin dirección completa, una línea que informa y «Completar dirección» (R03B)', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  await abrirPedidos(page)
  const b = tarjeta(page, 'R03B')
  // Una línea informativa, sin franja roja ni casilla para pegar, y el punto del mapa.
  await expect(b.getByTestId('aviso-sin-direccion-texto'))
    .toHaveText('Sin dirección completa · este local despacha a mano: despáchalo y el repartidor llamará al cliente')
  await expect(b.getByRole('link', { name: 'Ver el punto del mapa' })).toBeVisible()
  await expect(noHaSalido(page, 'R03B')).toHaveCount(0)
  await expect(page.getByTestId('aviso-direccion-casilla')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Mandar a Catcher' })).toHaveCount(0)
  await expect(page.getByText(/no la ha mandado|Falta la dirección de este pedido/)).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  await b.screenshot({ path: `${DIR}/tarjeta-sin-direccion${movil ? '-movil' : ''}.png` })
  if (movil) return // escribe una vez

  await b.getByRole('button', { name: 'Completar dirección' }).click()
  await b.getByTestId('completar-direccion-casilla').fill('Calle Pegada de Prueba, 2, Piso 3, Puerta A, Portal B')
  await b.getByRole('button', { name: 'Guardar' }).click()
  await expect(b.getByTestId('completar-direccion-resultado'))
    .toHaveText('Guardada: «Calle Pegada de Prueba, 2, Piso 3, Puerta A, Portal B». Este local despacha a mano: pulsa «Despachar» en el pedido y sale con ella. Reimprime el ticket de la bolsa para que la lleve.')
  await expect(b.getByTestId('direccion-completada')).toContainText('Calle Pegada de Prueba, 2, Piso 3, Puerta A, Portal B')
  await b.screenshot({ path: `${DIR}/tarjeta-completada.png` })

  // El ticket de la bolsa se reimprime con ella, con el piso, la puerta y el portal aparte.
  await page.reload()
  const t = await fotoDelTicket(page, 'R03B', 'ticket-sin-calle-completada.png')
  await expect(t).toContainText('ENTREGA')
  await expect(t).toContainText('Calle Pegada de Prueba, 2')
  await expect(t).toContainText('Piso 3, Puerta A, Portal B')
})

test('ordenador: si no ha podido salir a Catcher (R03C), aviso rojo con el motivo', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  await abrirPedidos(page)
  const c = noHaSalido(page, 'R03C')
  await expect(c.getByRole('heading', { name: 'Este pedido no ha salido a Catcher' })).toBeVisible()
  await expect(c.getByTestId('aviso-motivo')).toHaveText(MOTIVO_R03C)
  const fondo = await page.getByTestId('aviso-direccion-falta').locator('> div').evaluate(el => getComputedStyle(el).backgroundColor)
  expect(fondo).toBe('rgb(198, 40, 40)')
  await expect(tarjeta(page, 'R03C').getByTestId('aviso-sin-direccion-texto'))
    .toHaveText(`Sin dirección completa · no ha salido a Catcher: ${MOTIVO_R03C}`)
  // Los que sí pueden salir no avisan en rojo.
  for (const codigo of ['R03A', 'R03B', 'R03E', 'R03U', 'R03V', 'R03T']) await expect(noHaSalido(page, codigo)).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  await c.screenshot({ path: `${DIR}/aviso-no-ha-salido${movil ? '-movil' : ''}.png` })
})

test('ordenador: el ticket de la bolsa en cuatro casos (con dirección, con nota, sin dirección y Uber con código)', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Los tickets son los mismos: una vez basta')
  await abrirPedidos(page)

  // Con dirección (R03A): ENTREGA con la calle y, aparte, el piso y la puerta.
  let t = await fotoDelTicket(page, 'R03A', 'ticket-con-direccion.png')
  await expect(t).toContainText('ENTREGA')
  await expect(t).toContainText('Calle Inventada de Prueba, 1, 28000')
  await expect(t).toContainText('Piso: 4, Puerta: A')
  await expect(t).not.toContainText('Indicaciones')
  await cerrarTicket(page)

  // Con nota (R03N): las indicaciones de entrega y la nota del cliente, en su recuadro.
  t = await fotoDelTicket(page, 'R03N', 'ticket-con-nota.png')
  await expect(t).toContainText('ENTREGA')
  await expect(t).toContainText('Piso: 2, Puerta: C')
  await expect(t).toContainText('Indicaciones: Portal azul, timbre 2C')
  await expect(t).toContainText('Nota del cliente: Sin pepinillos, por favor')
  await cerrarTicket(page)

  // Sin dirección (R03C): lo dice, con el teléfono.
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

test('ordenador: Uber con las tres señales (R03T) → lo repartimos nosotros, aunque la tabla diga «Plataforma»', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Una vez basta')
  await abrirPedidos(page)
  const tt = tarjeta(page, 'R03T')
  await expect(tt.getByTestId('etiqueta-reparto')).toContainText('Nosotros')
  await expect(tt.getByTestId('etiqueta-reparto')).not.toContainText('La reparte Uber')
  await tt.screenshot({ path: `${DIR}/tarjeta-uber-tres-senales.png` })
  const t = await fotoDelTicket(page, 'R03T', 'ticket-uber-tres-senales.png')
  await expect(t).toContainText('ENTREGA')
  await expect(t).toContainText('Unit: 1A')
})

test('ordenador: Uber mezclado (R03M) → «Decide quién reparte»; se decide «Lo reparte Uber»', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  await abrirPedidos(page)
  const m = page.getByTestId('aviso-decidir-pedido').filter({ hasText: 'R03M' })
  // El móvil corre después del ordenador, con la decisión ya tomada: comprueba
  // que se ha quedado (ni vuelve a preguntar ni sale a Catcher).
  if (movil) {
    await expect(m).toHaveCount(0)
    await expect(tarjeta(page, 'R03M').getByTestId('etiqueta-reparto')).toContainText('La reparte Uber · fuera de zona')
    return
  }
  await expect(m.getByRole('heading', { name: 'Decide quién reparte este pedido' })).toBeVisible()
  await expect(tarjeta(page, 'R03M').getByTestId('etiqueta-reparto')).toContainText('Nosotros · falta decidir quién reparte')
  await m.screenshot({ path: `${DIR}/aviso-decidir.png` })
  await m.getByRole('button', { name: 'Lo reparte Uber' }).click()
  await expect(page.getByTestId('aviso-direccion-resuelto').filter({ hasText: 'R03M' }))
    .toContainText('Hecho: lo reparte Uber. No sale a Catcher.')
  await expect(page.getByTestId('aviso-decidir-pedido').filter({ hasText: 'R03M' })).toHaveCount(0)
  await page.reload()
  await expect(tarjeta(page, 'R03M').getByTestId('etiqueta-reparto')).toContainText('La reparte Uber · fuera de zona')
})

test('ordenador: Uber sin calle, punto ni cargo (R03V y el 7B000) → la reparte Uber, fuera de zona; nada a Catcher', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Una vez basta')
  await abrirPedidos(page)
  for (const codigo of ['R03V', '7B000']) {
    const v = tarjeta(page, codigo)
    await expect(v.getByTestId('etiqueta-reparto')).toHaveAttribute('data-tono', 'gris')
    await expect(v.getByTestId('etiqueta-reparto')).toContainText('La reparte Uber · fuera de zona')
    await expect(v.getByRole('button', { name: /Despachar|Completar dirección/ })).toHaveCount(0)
    await expect(v.getByTestId('aviso-sin-direccion')).toHaveCount(0)
  }
  await tarjeta(page, 'R03V').screenshot({ path: `${DIR}/tarjeta-uber-fuera-de-zona.png` })
  await tarjeta(page, '7B000').screenshot({ path: `${DIR}/tarjeta-7b000.png` })
  // El ticket, como el de los que reparte la plataforma: sin bloque ENTREGA.
  const t = await fotoDelTicket(page, 'R03V', 'ticket-uber-fuera-de-zona.png')
  await expect(t).not.toContainText('ENTREGA')
  await expect(t).not.toContainText('SIN DIRECCIÓN')
  // Y la base no los cuenta como «sin dirección completa».
  const centro = await rpcAnon('pedidos_sin_direccion', { p_location_id: null, p_token: TOKEN_CENTRO })
  const codigos = ((centro.body?.pedidos ?? []) as { code: string }[]).map(p => p.code)
  expect(codigos).not.toContain('R03V')
  expect(codigos).not.toContain('7B000')
})

test('tablet: la misma línea, sin acciones para la cocina, y el aviso rojo de lo que no ha salido', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  if (!movil) await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/estacion?token=${TOKEN_CENTRO}`)
  const d = tarjeta(page, 'R03D')
  await expect(d.getByTestId('aviso-sin-direccion-texto'))
    .toHaveText('Sin dirección completa · este local despacha a mano: despáchalo y el repartidor llamará al cliente')
  await expect(d.getByRole('link', { name: 'Ver el punto del mapa' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Completar dirección' })).toHaveCount(0)
  await expect(page.getByTestId('aviso-direccion-casilla')).toHaveCount(0)
  await expect(noHaSalido(page, 'R03C').getByTestId('aviso-motivo')).toHaveText(MOTIVO_R03C)
  await page.evaluate(() => document.fonts.ready)
  await d.screenshot({ path: `${DIR}/tarjeta-tablet${movil ? '-movil' : ''}.png` })
  await page.screenshot({ path: `${DIR}/tablet${movil ? '-movil' : ''}.png`, fullPage: false })
})

test('Despacho: la lista «Sin dirección completa» de hoy, una frase por pedido y un botón', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  await entrarComo(page, CUENTA_A.email)
  await page.addInitScript((id) => { window.localStorage.setItem('andy-app-active-location', id) }, NORTE_CENTRO)
  await page.goto('/orders/despacho')
  const lista = page.getByTestId('lista-sin-direccion')
  await expect(lista).toBeVisible()
  const fila = (codigo: string) => lista.getByTestId('lista-sin-direccion-pedido').filter({ hasText: `${codigo} ·` })
  // La completada sigue (con quién y qué); la que no, con su botón; la que no ha salido, con el motivo.
  await expect(fila('R03B')).toContainText(/completada por .+: Calle Pegada de Prueba, 2, Piso 3, Puerta A, Portal B/)
  await expect(fila('R03B').getByRole('button', { name: 'Completar dirección' })).toHaveCount(0)
  await expect(fila('R03E')).toContainText('R03E · Burger Norte · Glovo — este local despacha a mano')
  await expect(fila('R03E').getByRole('button', { name: 'Completar dirección' })).toBeVisible()
  await expect(fila('R03C')).toContainText(`no ha salido a Catcher: ${MOTIVO_R03C}`)
  // Los que reparte Uber no son «sin dirección completa».
  await expect(fila('R03V')).toHaveCount(0)
  await expect(fila('7B000')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  await lista.screenshot({ path: `${DIR}/despacho-sin-direccion${movil ? '-movil' : ''}.png` })
})

test('permiso por local: la tablet de Norte Mercado no ve ni toca los pedidos de Norte Centro', async () => {
  test.skip(test.info().project.name === 'movil', 'Permisos: una vez basta')
  const lista = await rpcAnon('pedidos_sin_direccion', { p_location_id: null, p_token: TOKEN_MERCADO })
  expect(lista.ok).toBe(true)
  const codigos = ((lista.body?.pedidos ?? []) as { code: string }[]).map(p => p.code)
  expect(codigos.filter(c => c.startsWith('R03'))).toEqual([])
  const centro = await rpcAnon('pedidos_sin_direccion', { p_location_id: null, p_token: TOKEN_CENTRO })
  expect(((centro.body?.pedidos ?? []) as { code: string }[]).map(p => p.code)).toContain('R03C')
  const punto = await rpcAnon('sale_coordenadas_de_entrega_by_token', { p_device_token: TOKEN_MERCADO, p_sale_id: R03B })
  expect(punto.ok).toBe(false)
  const puntoSuyo = await rpcAnon('sale_coordenadas_de_entrega_by_token', { p_device_token: TOKEN_CENTRO, p_sale_id: R03B })
  expect(puntoSuyo.ok).toBe(true)
  const completar = await rpcAnon('fijar_direccion_entrega', { p_sale_id: R03B, p_direccion: 'Calle Inventada de Prueba, 9', p_token: TOKEN_MERCADO })
  expect(completar.ok).toBe(false)
  const sesion = await rpcAnon('sale_coordenadas_de_entrega', { p_sale_id: R03B })
  expect(sesion.ok).toBe(false)
  const sinNada = await rpcAnon('pedidos_sin_direccion', { p_location_id: NORTE_CENTRO, p_token: null })
  expect(sinNada.ok).toBe(false)
})
