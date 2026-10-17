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
//   R03B · sin calle, con punto, ha salido      → línea informativa; la oficina la completa (una línea)
//   R03C · sin calle ni punto, no ha salido     → aviso rojo con el motivo y el teléfono; ticket «SIN DIRECCIÓN»
//   R03D · sin calle, con punto, ha salido      → en la tablet, solo la línea, sin botón; el aviso no tapa «Listo»
//   R03E · sin calle, con punto, ha salido      → en la lista de Despacho, en gris, sin completar
//   R03K · sin calle, con punto, ha salido      → la completa la tablet, con el teclado abierto
//   R03U · Uber con dirección y código          → tarjeta y ticket con «Tel. … · código …»
//   R03V · Uber sin calle, punto ni cargo       → la reparte Uber, fuera de zona: ni aviso ni Catcher
//   7B000 · Uber sin calle, punto ni cargo (R02) → lo mismo, por la regla
//   R03T · Uber con las tres, tabla en «Plataforma» → propio (la regla por pedido manda)
//   R03M · Uber mezclado                        → aviso «Decide quién reparte»; se decide «Uber»
// Sin espera: un pedido sin dirección completa sale a Catcher al momento. Los
// locales, en automático, que es el caso real (Julio, 17/10): la semilla los
// pasa a «auto» al final y deja R03B, R03D y R03E como los deja catcher-dispatch
// al salir (con un pedido de Catcher inventado). Que un pedido sin calle con
// punto pueda salir ya lo prueba
// supabase/staging/sql/20261118_r03_ticket_codigo_quien_reparte_prueba.sql.
// Capturas y fotos de los tickets en docs/reparto/capturas/r03/.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, STAGING_URL, anonKey, entrarComo } from '../conta/sesion'

const DIR = 'docs/reparto/capturas/r03'
const NORTE_CENTRO = 'c01a0000-0000-4000-8000-0000000000a2'
const TOKEN_CENTRO = 'r03-e2e-norte-centro'
const TOKEN_MERCADO = 'r03-e2e-norte-mercado'
const R03B = 'e0300000-0000-4000-8000-0000000000a2'
const MOTIVO_R03C = 'La dirección no ha llegado y tampoco el punto del mapa: no se puede despachar'
const HA_SALIDO = 'Ha salido a Catcher con el punto del mapa · el repartidor llamará al cliente'
const NO_HA_SALIDO = 'No ha salido a Catcher · llama al cliente y completa la dirección'

/** ¿Lo que hay en el centro del elemento es él mismo (o algo suyo)? Si no, algo lo tapa. */
async function seVeEntero(page: Page, sel: ReturnType<Page['locator']>) {
  await sel.scrollIntoViewIfNeeded()
  const caja = await sel.boundingBox()
  if (!caja) return false
  const handle = await sel.elementHandle()
  return page.evaluate(([el, x, y]) => {
    const arriba = document.elementFromPoint(x as number, y as number)
    return !!arriba && (el as Element).contains(arriba)
  }, [handle, caja.x + caja.width / 2, caja.y + caja.height / 2] as const)
}

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
  R03K: 'e0300000-0000-4000-8000-0000000000b2',
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

test('ordenador: sin dirección completa, ha salido a Catcher: una línea que informa y «Completar dirección» (R03B)', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  await abrirPedidos(page)
  // El móvil corre después del ordenador, con el R03B ya completado: mira el R03E (igual, sin completar).
  const b = tarjeta(page, movil ? 'R03E' : 'R03B')
  // Una línea informativa, en automático: ha salido con el punto del mapa.
  await expect(b.getByTestId('aviso-sin-direccion-texto')).toHaveText(HA_SALIDO)
  await expect(b.getByTestId('aviso-sin-direccion')).toHaveAttribute('data-salido', 'si')
  await expect(b.getByTestId('aviso-sin-direccion-llamar')).toHaveCount(0)
  await expect(b.getByRole('link', { name: 'Ver el punto del mapa' })).toBeVisible()
  await expect(noHaSalido(page, movil ? 'R03E' : 'R03B')).toHaveCount(0)
  await expect(page.getByTestId('aviso-direccion-casilla')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Mandar a Catcher' })).toHaveCount(0)
  await expect(page.getByText(/no la ha mandado|Falta la dirección de este pedido|despacha a mano/)).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  await b.screenshot({ path: `${DIR}/tarjeta-sin-direccion${movil ? '-movil' : ''}.png` })
  if (movil) return // escribe una vez

  await b.getByRole('button', { name: 'Completar dirección' }).click()
  await b.getByTestId('completar-direccion-casilla').fill('Calle Pegada de Prueba, 2, Piso 3, Puerta A, Portal B')
  await b.getByRole('button', { name: 'Guardar' }).click()
  // UNA línea: quién y el ticket reimpreso (hay impresora de bolsa en Norte
  // Centro) y «Reimprimir». Sin bloque que repita la dirección y sin el
  // repartidor: su «Llamar» sigue en su fila de reparto de siempre.
  const hecho = b.getByTestId('completar-direccion-resultado')
  await expect(hecho).toContainText(/Dirección completada por .+ · ticket reimpreso/)
  await expect(hecho.getByRole('button', { name: 'Reimprimir' })).toBeVisible()
  await expect(hecho).not.toContainText('Repartidor de Prueba')
  await expect(b.getByRole('link', { name: /Llamar/ }).first()).toBeVisible()
  await expect(b.getByTestId('completar-direccion-nota')).toHaveCount(0)
  await expect(b.getByTestId('aviso-sin-direccion')).not.toContainText('Calle Pegada de Prueba')
  await expect(b.getByTestId('aviso-sin-direccion-texto')).toHaveCount(0)
  await b.screenshot({ path: `${DIR}/tarjeta-completada.png` })

  // Al volver a cargar, la misma línea (sin «ticket reimpreso»: eso fue al guardar).
  await page.reload()
  await expect(tarjeta(page, 'R03B').getByTestId('completar-direccion-resultado')).toContainText(/Dirección completada por \S/)
  // El ticket de la bolsa, con ella, con el piso, la puerta y el portal aparte.
  const t = await fotoDelTicket(page, 'R03B', 'ticket-sin-calle-completada.png')
  await expect(t).toContainText('ENTREGA')
  await expect(t).toContainText('Calle Pegada de Prueba, 2')
  await expect(t).toContainText('Piso 3, Puerta A, Portal B')
})

test('ordenador: si no ha podido salir a Catcher (R03C), aviso rojo con el motivo y el teléfono del cliente', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  await abrirPedidos(page)
  const c = noHaSalido(page, 'R03C')
  await expect(c.getByRole('heading', { name: 'Este pedido no ha salido a Catcher' })).toBeVisible()
  await expect(c.getByTestId('aviso-motivo')).toHaveText(MOTIVO_R03C)
  await expect(c).toContainText('Llama al cliente y completa la dirección.')
  await expect(c.getByTestId('aviso-llamar-cliente')).toHaveText('Tel. +34600000003 · Llamar')
  await expect(c.getByTestId('aviso-llamar-cliente')).toHaveAttribute('href', 'tel:+34600000003')
  await expect(c.getByRole('button', { name: 'Completar dirección' })).toBeVisible()
  await expect(c).not.toContainText(/a mano|Despach/)
  const fondo = await page.getByTestId('aviso-direccion-falta').locator('> div').evaluate(el => getComputedStyle(el).backgroundColor)
  expect(fondo).toBe('rgb(198, 40, 40)')
  // En la tarjeta: en rojo, qué hacer, y el teléfono con «Llamar».
  const tc = tarjeta(page, 'R03C')
  await expect(tc.getByTestId('aviso-sin-direccion-texto')).toHaveText(NO_HA_SALIDO)
  await expect(tc.getByTestId('aviso-sin-direccion')).toHaveAttribute('data-salido', 'no')
  await expect(tc.getByTestId('aviso-sin-direccion-llamar')).toHaveText('Tel. +34600000003 · Llamar')
  // Los que sí han salido no avisan en rojo.
  for (const codigo of ['R03A', 'R03B', 'R03E', 'R03U', 'R03V', 'R03T']) await expect(noHaSalido(page, codigo)).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  await c.screenshot({ path: `${DIR}/aviso-no-ha-salido${movil ? '-movil' : ''}.png` })
  if (!movil) await tc.screenshot({ path: `${DIR}/tarjeta-no-ha-salido.png` })
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
  await expect(t).toContainText('Piso/Puerta: 3C')
  await expect(t).not.toContainText('Unit')
  await expect(t).not.toContainText('Spain')
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
  await expect(t).toContainText('Piso/Puerta: 1A')
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

test('tablet: la misma línea y «Completar dirección» grande; el aviso rojo, encima de los pedidos y sin tapar «Listo»', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  if (!movil) await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/estacion?token=${TOKEN_CENTRO}`)
  const d = tarjeta(page, 'R03D')
  await expect(d.getByTestId('aviso-sin-direccion-texto')).toHaveText(HA_SALIDO)
  await expect(d.getByRole('link', { name: 'Ver el punto del mapa' })).toBeVisible()
  // También desde la cocina (Julio, 17/10), y para el dedo: 48 px de alto como mínimo.
  const boton = d.getByRole('button', { name: 'Completar dirección' })
  await expect(boton).toBeVisible()
  expect((await boton.boundingBox())!.height).toBeGreaterThanOrEqual(48)
  await expect(page.getByTestId('aviso-direccion-casilla')).toHaveCount(0)
  const c = noHaSalido(page, 'R03C')
  await expect(c.getByTestId('aviso-motivo')).toHaveText(MOTIVO_R03C)
  await expect(c.getByTestId('aviso-llamar-cliente')).toHaveText('Tel. +34600000003 · Llamar')
  await expect(c.getByRole('button', { name: 'Completar dirección' })).toBeVisible()
  // El aviso va dentro de la página de Pedidos, debajo de la barra (Pedidos,
  // Cocina, Disponibilidad, Impresoras), no flotando ni encima de ella; y el
  // «Listo» de las tarjetas se ve y se puede pulsar.
  const aviso = page.getByTestId('aviso-direccion-falta')
  await expect(aviso).toHaveAttribute('data-en-pagina', 'si')
  expect(await aviso.evaluate(el => getComputedStyle(el).position)).not.toBe('fixed')
  const barra = (await page.locator('header').first().boundingBox())!
  expect((await aviso.boundingBox())!.y).toBeGreaterThanOrEqual(barra.y + barra.height)
  // R03U (Uber de reparto nuestro, con calle): ha salido a Catcher, como en automático.
  await expect(tarjeta(page, 'R03U')).not.toContainText('aún sin rider')
  const listo = d.getByRole('button', { name: 'Listo' })
  await expect(listo).toBeVisible()
  expect(await seVeEntero(page, listo)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.evaluate(() => document.fonts.ready)
  await d.screenshot({ path: `${DIR}/tarjeta-tablet${movil ? '-movil' : ''}.png` })
  await page.screenshot({ path: `${DIR}/tablet${movil ? '-movil' : ''}.png`, fullPage: false })
  if (movil) return // la completa una vez

  // Completar desde la tablet (R03K). Con el teclado abierto la pantalla de la
  // tablet se queda en algo menos de la mitad de alto: se simula así (un
  // navegador sin pantalla no saca teclado) y el campo tiene que verse entero.
  const k = tarjeta(page, 'R03K')
  await k.getByRole('button', { name: 'Completar dirección' }).click()
  await page.setViewportSize({ width: 1280, height: 380 })
  const casilla = k.getByTestId('completar-direccion-casilla')
  await expect(casilla).toBeFocused()
  await casilla.fill('Calle Tablet de Prueba, 7, Piso 1, Puerta B')
  await page.waitForTimeout(600) // el campo se coloca al centro tras abrirse el teclado
  const caja = (await casilla.boundingBox())!
  expect(caja.height).toBeGreaterThanOrEqual(50)
  expect(caja.y).toBeGreaterThanOrEqual(0)
  expect(caja.y + caja.height).toBeLessThanOrEqual(380)
  expect(await seVeEntero(page, casilla)).toBe(true)
  await page.screenshot({ path: `${DIR}/tablet-completar-teclado.png`, fullPage: false })
  await k.getByRole('button', { name: 'Guardar' }).click()
  // Igual que en el ordenador: la marca de quién (la tablet) y el ticket reimpreso.
  await expect(k.getByTestId('completar-direccion-resultado'))
    .toContainText('Dirección completada por tablet · R03 e2e Norte Centro · ticket reimpreso')
  await expect(k.getByTestId('completar-direccion-resultado').getByRole('button', { name: 'Reimprimir' })).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })
  await k.scrollIntoViewIfNeeded()
  await k.screenshot({ path: `${DIR}/tarjeta-tablet-completada.png` })
})

test('Despacho: la lista «Sin dirección completa» de hoy, una frase por pedido y un botón', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  await entrarComo(page, CUENTA_A.email)
  await page.addInitScript((id) => { window.localStorage.setItem('andy-app-active-location', id) }, NORTE_CENTRO)
  await page.goto('/orders/despacho')
  const lista = page.getByTestId('lista-sin-direccion')
  await expect(lista).toBeVisible()
  const fila = (codigo: string) => lista.getByTestId('lista-sin-direccion-pedido').filter({ hasText: `${codigo} ·` })
  // Primero, en rojo y con el teléfono, lo que no ha salido; después, en gris,
  // lo que ha salido y lo completado (con quién y qué). La lista no esconde filas.
  await expect(fila('R03C')).toContainText(`R03C · Burger Norte · Glovo — ${NO_HA_SALIDO}`)
  await expect(fila('R03C')).toHaveAttribute('data-rojo', 'si')
  await expect(fila('R03C').getByTestId('lista-sin-direccion-llamar')).toHaveText('Tel. +34600000003 · Llamar')
  await expect(fila('R03C').getByRole('button', { name: 'Completar dirección' })).toBeVisible()
  await expect(fila('R03B')).toContainText(/Dirección completada por .+: Calle Pegada de Prueba, 2, Piso 3, Puerta A, Portal B/)
  await expect(fila('R03B')).toHaveAttribute('data-rojo', 'no')
  await expect(fila('R03B').getByRole('button', { name: 'Completar dirección' })).toHaveCount(0)
  await expect(fila('R03E')).toContainText(`R03E · Burger Norte · Glovo — ${HA_SALIDO}`)
  await expect(fila('R03E')).toHaveAttribute('data-rojo', 'no')
  await expect(fila('R03E').getByTestId('lista-sin-direccion-llamar')).toHaveCount(0)
  await expect(fila('R03E').getByRole('button', { name: 'Completar dirección' })).toBeVisible()
  // E2E01 (Just Eat, sin calle, sin punto y sin Catcher): igual que su tarjeta, no ha salido, en rojo.
  await expect(fila('E2E01')).toContainText(NO_HA_SALIDO)
  await expect(fila('E2E01')).toHaveAttribute('data-rojo', 'si')
  const rojos = await lista.getByTestId('lista-sin-direccion-pedido').evaluateAll(els => els.map(e => e.getAttribute('data-rojo')))
  expect(rojos.indexOf('no')).toBeGreaterThan(rojos.lastIndexOf('si'))
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
