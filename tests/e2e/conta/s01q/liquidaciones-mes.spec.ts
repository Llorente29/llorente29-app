/// <reference lib="dom" />
// tests/e2e/conta/s01q/liquidaciones-mes.spec.ts
//
// S01q · PR C · Ventas › Liquidaciones, un mes en una pantalla, contra las
// maquetas aprobadas por Julio (S01q·1, docs/conta/s01q/maquetas.html), en el
// ordenador (1440) y en el móvil (390).
//
// Lo que la pantalla LEE del mes (conta_liquidaciones_mes, de la 1216, ya en
// producción) se contesta aquí con los cuatro casos de la maqueta, con nombres
// inventados (T11) y en octubre de 2026, para que la comparación sea la misma
// cada vez. Lo que ESCRIBE (dar el local a una tienda, resolver una diferencia)
// también se contesta aquí y se mira con qué se ha llamado: la base la prueban
// sus pruebas de staging. Lo demás (la sesión, el marco, el menú, los locales
// de la cuenta A) es staging y el código de verdad.
//
//   1. Mes completo: la frase y la barra verde; las tiendas plegadas.
//   2. Mes con huecos: los cuatro estados, «Solo lo que te necesita», «Ver el
//      recorrido» (abre la primera que te necesita) y «Pídela».
//   3. Tienda sin local: la pregunta, «Guardar» y lo que dice.
//   4. «No cuadra» abierta: la causa, la liquidación desglosada, lo vendido, la
//      factura y el cobro; «Lo reclamo» en una frase; las marcas cedidas aparte;
//      «Exportar a Excel» baja todas las del mes; y lo que no se pudo apuntar
//      solo, en su fila con sus palabras.
// Cada caso, con su captura AL LADO de la maqueta (docs/conta/capturas/s01q).

import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/s01q'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

/** La maqueta del caso y la pantalla de verdad, una al lado de la otra. */
async function alLado(page: Page, caso: 'completo' | 'huecos' | 'sinlocal' | 'nocuadra') {
  const l = lado(page)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${caso}-${l}.png`, fullPage: true })
  const pantalla = await page.screenshot({ fullPage: true })
  const ancho = l === 'movil' ? 390 : 1440
  const maqueta = await page.context().newPage()
  await maqueta.setViewportSize({ width: ancho, height: 900 })
  await maqueta.goto(`file://${process.cwd()}/docs/conta/s01q/maquetas.html`)
  await maqueta.locator(`[data-caso="${caso}"]`).click()
  if (l === 'movil') await maqueta.locator('[data-vista="movil"]').click()
  const dibujo = await maqueta.locator('#pant').screenshot()
  await maqueta.close()
  const otra = await page.context().newPage()
  await otra.setViewportSize({ width: ancho * 2 + 48, height: 900 })
  await otra.setContent(`<body style="margin:0;padding:16px;background:#E9EEF5;font:600 14px system-ui;color:#172443">
    <div style="display:flex;gap:16px;align-items:flex-start">
      <figure style="margin:0;width:${ancho}px"><figcaption style="margin:0 0 8px">Maqueta aprobada · ${caso}</figcaption><img style="width:100%" src="data:image/png;base64,${dibujo.toString('base64')}"></figure>
      <figure style="margin:0;width:${ancho}px"><figcaption style="margin:0 0 8px">La pantalla (staging)</figcaption><img style="width:100%" src="data:image/png;base64,${pantalla.toString('base64')}"></figure>
    </div></body>`)
  await otra.screenshot({ path: `${DIR}/al-lado-${caso}-${l}.png`, fullPage: true })
  await otra.close()
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

// ── Lo que contesta la base ─────────────────────────────────────────────────
const CANAL = { glovo: 'e0200000-0000-4000-8000-00000000a0c1', uber: 'e0200000-0000-4000-8000-00000000a0c2', je: 'e0200000-0000-4000-8000-00000000a0c3' }
const ROL = { glovo: 'r0000000-0000-4000-8000-0000000000g1', uber: 'r0000000-0000-4000-8000-0000000000u1', je: 'r0000000-0000-4000-8000-0000000000j1' }
const LOCAL = { norte: 'c01a0000-0000-4000-8000-0000000000a2', sur: 'c01a0000-0000-4000-8000-0000000000a3', oeste: 'c01a0000-0000-4000-8000-0000000000a4' }
const TIENDA_SIN_LOCAL = 'f0000000-0000-4000-8000-0000000000f1'
const LIQ_ESPERA = 'f0000000-0000-4000-8000-00000000e0e1'
type Estado = 'completa' | 'aun_no_toca' | 'te_necesita' | 'no_cuadra'
let n = 0

/** Una fila del mes (conta_liquidaciones_mes): la del motor con su estado de cuatro, su frase y su botón. */
function fila(o: {
  canal: keyof typeof CANAL; tienda: string; marca: string; local: keyof typeof LOCAL | null; desde: string; hasta: string; estado: Estado
  motor: string; frase?: string; accion?: string | null; cuando?: string | null; vendido?: number | null; pedidos?: number
  liq?: { ventas: number; comision: number; pagan: number; pedidos: number; factura?: { numero: string; total: number } | null; id?: string } | null
  faltan?: number; llegado?: number | null; diferencia?: number | null
}) {
  n += 1
  const nombre = { glovo: 'Glovo', uber: 'Uber Eats', je: 'Just Eat' }[o.canal]
  const l = o.liq ?? null
  const localNombre = o.local ? { norte: 'Norte Centro', sur: 'Sur Prueba', oeste: 'Oeste Prueba' }[o.local] : null
  const tiendaId = o.local ? `f0000000-0000-4000-8000-${String(1000 + n).padStart(12, '0')}` : TIENDA_SIN_LOCAL
  return {
    clave: `${o.canal}:${o.tienda}:${o.desde}`, canal: nombre, intermediario: nombre, intermediario_id: ROL[o.canal], canal_id: CANAL[o.canal],
    local_id: o.local ? LOCAL[o.local] : null, local: localNombre, marca_id: `e0200000-0000-4000-8000-0000000${String(10000 + n)}`, marca: o.marca,
    desde: o.desde, hasta: o.hasta, estado: o.estado, estado_motor: o.motor, frase: o.frase ?? 'Cuadra: lo vendido, la liquidación, su factura y el cobro.',
    accion: o.accion ?? null, cuando: o.cuando ?? null, sin_local: o.local === null, grupo: 'plataforma', diferencia: o.diferencia ?? null, comparado: null,
    tiendas: [{ id: tiendaId, nombre: o.tienda, local_id: o.local ? LOCAL[o.local] : null }],
    piezas: {
      vendido: { via: 'pedidos', total: o.vendido ?? null, pedidos: { total: o.vendido ?? null, pedidos: o.pedidos ?? 0, dias: 15 } },
      liquidacion: { n: l ? 1 : 0, ventas: l?.ventas ?? 0, pedidos_total: l?.ventas ?? 0, comision: l?.comision ?? 0, pagan: l?.pagan ?? null, otros: l ? Math.round((l.pagan - l.ventas + l.comision) * 100) / 100 : null, referencia: false },
      factura: { faltan: o.faltan ?? 0 },
      cobro: { esperado: l?.pagan ?? null, llegado: o.llegado ?? null, por_cobrar: l && o.llegado == null ? 1 : 0 },
    },
    liquidaciones: l ? [{ id: l.id ?? `f0000000-0000-4000-8000-${String(2000 + n).padStart(12, '0')}`, tienda: o.tienda, ref: null, origen: 'correo', pedidos: l.pedidos, ventas: l.ventas,
      pedidos_total: l.ventas, comision: l.comision, neto: l.pagan, cobrado: o.llegado ?? null, cobrado_el: o.llegado != null ? '2026-10-21' : null, referencia: false, por_aclarar: null,
      a_facturar: null, factura: l.factura ? { id: `f0000000-0000-4000-8000-${String(3000 + n).padStart(12, '0')}`, numero: l.factura.numero, total: l.factura.total } : null,
      casada_en_banco: o.llegado != null, facturas_cobradas: null, facturas_nota: null }] : [],
    resoluciones: [], reclamado_sin_llegar: 0, avisos: [], plazo: o.cuando ?? o.hasta,
  }
}
const completa = (canal: keyof typeof CANAL, tienda: string, marca: string, local: keyof typeof LOCAL, desde: string, hasta: string, pagan: number) =>
  fila({ canal, tienda, marca, local, desde, hasta, estado: 'completa', motor: 'cuadra', vendido: pagan * 1.3, pedidos: 40,
    liq: { ventas: pagan * 1.3, comision: pagan * 0.3, pagan, pedidos: 40, factura: { numero: 'FC-PRUEBA-1', total: pagan * 0.36 } }, llegado: pagan })

function mes(filas: ReturnType<typeof fila>[], cedidas: unknown[] = []) {
  const c = (e: Estado) => filas.filter((f) => f.estado === e).length
  return { mes: '2026-10-01', desde: '2026-10-01', hasta: '2026-10-31', filas, cedidas,
    resumen: { total: filas.length, completa: c('completa'), aun_no_toca: c('aun_no_toca'), te_necesita: c('te_necesita'), no_cuadra: c('no_cuadra') } }
}

const CASOS = {
  completo: () => mes([
    completa('glovo', 'Pita Prueba - MAD - Prueba Sur 4', 'Pita Prueba', 'sur', '2026-10-01', '2026-10-15', 1204.3),
    completa('glovo', 'Pita Prueba - MAD - Prueba Sur 4', 'Pita Prueba', 'sur', '2026-10-16', '2026-10-31', 1388.12),
    completa('glovo', 'Milanesa Prueba - MAD - C. Prueba Norte', 'Milanesa Prueba', 'norte', '2026-10-01', '2026-10-15', 842.55),
    completa('glovo', 'Milanesa Prueba - MAD - C. Prueba Norte', 'Milanesa Prueba', 'norte', '2026-10-16', '2026-10-31', 901.1),
    completa('je', 'Pita Prueba (Calle Prueba Oeste 75)', 'Pita Prueba', 'oeste', '2026-10-01', '2026-10-15', 312.4),
    completa('je', 'Pita Prueba (Calle Prueba Oeste 75)', 'Pita Prueba', 'oeste', '2026-10-16', '2026-10-31', 298.75),
    completa('uber', 'Burrito Prueba (Calle Prueba Norte 29)', 'Burrito Prueba', 'norte', '2026-10-05', '2026-10-11', 96.2),
    completa('uber', 'Burrito Prueba (Calle Prueba Norte 29)', 'Burrito Prueba', 'norte', '2026-10-12', '2026-10-18', 74.8),
  ]),
  huecos: () => mes([
    completa('glovo', 'Pita Prueba - MAD - Prueba Sur 4', 'Pita Prueba', 'sur', '2026-10-01', '2026-10-15', 1204.3),
    fila({ canal: 'glovo', tienda: 'Pita Prueba - MAD - Prueba Sur 4', marca: 'Pita Prueba', local: 'sur', desde: '2026-10-16', hasta: '2026-10-31', estado: 'aun_no_toca', motor: 'esperando_liquidacion',
      cuando: '2026-11-04', frase: 'Aún no toca: hacia el 04/11. No tienes que hacer nada.', vendido: 1500, pedidos: 52 }),
    fila({ canal: 'uber', tienda: 'Coyotes Prueba (Calle Prueba Sur 4)', marca: 'Coyotes Prueba', local: 'sur', desde: '2026-09-28', hasta: '2026-10-04', estado: 'te_necesita', motor: 'falta_liquidacion',
      accion: 'pidela', vendido: 612.4, pedidos: 27, frase: 'No ha llegado su liquidación, y vendiste 612,40 € en 27 pedidos. La plataforma la manda al correo de esta tienda: pide que la reenvíen a tu buzón de Sumied.' }),
    fila({ canal: 'uber', tienda: 'Coyotes Prueba (Calle Prueba Sur 4)', marca: 'Coyotes Prueba', local: 'sur', desde: '2026-10-05', hasta: '2026-10-11', estado: 'te_necesita', motor: 'falta_liquidacion',
      accion: 'pidela', vendido: 684.1, pedidos: 30, frase: 'No ha llegado su liquidación, y vendiste 684,10 € en 30 pedidos. La plataforma la manda al correo de esta tienda: pide que la reenvíen a tu buzón de Sumied.' }),
    fila({ canal: 'uber', tienda: 'Sandwiches Prueba (Calle Prueba Norte 29)', marca: 'Sandwiches Prueba', local: 'norte', desde: '2026-10-19', hasta: '2026-10-25', estado: 'te_necesita', motor: 'falta_factura',
      accion: 'subela', vendido: 80, pedidos: 6, faltan: 1, liq: { ventas: 80, comision: 21.7, pagan: 58.3, pedidos: 6 }, llegado: 58.3,
      frase: 'Falta su factura de comisión, y ya tendría que haber llegado: súbela o pídesela a la plataforma.' }),
  ]),
  sinlocal: () => mes([
    fila({ canal: 'glovo', tienda: 'Tacos Prueba - MAD - C. Prueba Este', marca: 'Tacos Prueba', local: null, desde: '2026-10-01', hasta: '2026-10-15', estado: 'te_necesita', motor: 'cuadra',
      accion: 'elige_local', vendido: null, liq: { ventas: 560, comision: 141.8, pagan: 418.2, pedidos: 21, factura: { numero: 'FC-PRUEBA-2', total: 171.58 } }, llegado: 418.2,
      frase: 'No sé de qué local es esta tienda: dímelo una vez y vale para todas sus liquidaciones. Mientras, se cuadra por tienda.' }),
    fila({ canal: 'glovo', tienda: 'Tacos Prueba - MAD - C. Prueba Este', marca: 'Tacos Prueba', local: null, desde: '2026-10-16', hasta: '2026-10-31', estado: 'te_necesita', motor: 'esperando_liquidacion',
      accion: 'elige_local', frase: 'No sé de qué local es esta tienda: dímelo una vez y vale para todas sus liquidaciones. Mientras, se cuadra por tienda.' }),
  ]),
  nocuadra: () => mes([
    fila({ canal: 'uber', tienda: 'Pita Prueba (Calle Prueba Norte 29)', marca: 'Pita Prueba', local: 'norte', desde: '2026-10-12', hasta: '2026-10-18', estado: 'no_cuadra', motor: 'diferencia',
      accion: 'ver_por_que', diferencia: -52.59, vendido: 1026.69, pedidos: 38, llegado: 694.3,
      liq: { ventas: 1079.28, comision: 323.78, pagan: 694.3, pedidos: 41, factura: { numero: 'UBER-PRUEBA-104512', total: 391.77 } },
      frase: 'La liquidación dice 1.079,28 € y vendiste 1.026,69 €: liquida 52,59 € de más.' }),
    fila({ canal: 'glovo', tienda: 'Burrito Prueba - MAD - C. Prueba Norte', marca: 'Burrito Prueba', local: 'norte', desde: '2026-10-16', hasta: '2026-10-31', estado: 'aun_no_toca', motor: 'falta_factura',
      cuando: '2026-11-05', liq: { ventas: 218, comision: 65.4, pagan: 152.6, pedidos: 9, id: LIQ_ESPERA }, faltan: 1,
      frase: 'Aún no toca: hacia el 05/11. No tienes que hacer nada.' }),
  ], [{ socio: 'Socio Prueba', socio_id: 'p0000000-0000-4000-8000-0000000000c1', local: 'Norte Centro', local_id: LOCAL.norte, desde: '2026-10-01', hasta: '2026-10-31',
    marcas: ['Marca Cedida Prueba'], vendido: { pedidos: 120, total: 2410.5 }, liquidacion: null, estado: 'aun_no_toca', cuando: '2026-11-15', grupo: 'cedida',
    frase: 'Socio Prueba liquida una vez al mes, por local: hacia el 15/11. No tienes que hacer nada.' }]),
}
const ESPERA = 'Sin propuesta hasta que se aclare su factura de comisión FC-PRUEBA-3: el total no cuadra con su liquidación.'

type Llamada = { f: string; cuerpo: Record<string, unknown> }
async function simular(page: Page, caso: keyof typeof CASOS): Promise<Llamada[]> {
  const llamadas: Llamada[] = []
  const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })
  await page.route(/\/rest\/v1\/rpc\/conta_liquidaciones_mes(\?|$)/, (r) => { llamadas.push({ f: 'mes', cuerpo: r.request().postDataJSON() }); return json(r, CASOS[caso]()) })
  await page.route(/\/rest\/v1\/party_role\?/, (r) => json(r, [
    { id: ROL.uber, party_id: 'p-uber', channel_id: CANAL.uber, settlement_every: 'weekly', payout_days_after: 1 },
    { id: ROL.glovo, party_id: 'p-glovo', channel_id: CANAL.glovo, settlement_every: 'fortnightly', payout_days_after: 20 },
    { id: ROL.je, party_id: 'p-je', channel_id: CANAL.je, settlement_every: 'fortnightly', payout_days_after: 4 }]))
  await page.route(/\/rest\/v1\/party\?/, (r) => json(r, [{ id: 'p-uber', name: 'Uber Eats' }, { id: 'p-glovo', name: 'Glovo' }, { id: 'p-je', name: 'Just Eat' }]))
  await page.route(/\/rest\/v1\/conta_propuesta_pendiente\?/, (r) => json(r, caso === 'nocuadra' ? [{ origen_id: LIQ_ESPERA, porque: ESPERA }] : []))
  await page.route(/\/rest\/v1\/rpc\/conta_correo_facturas(\?|$)/, (r) => json(r, { direccion: 'facturas-prueba@buzon.example', llegadas: [] }))
  await page.route(/\/rest\/v1\/platform_store\?/, (r) => json(r, { id: TIENDA_SIN_LOCAL, brand_id: 'e0200000-0000-4000-8000-00000000b0b0', treasury_account_id: null, external_text: 'Tacos Prueba - MAD - C. Prueba Este' }))
  await page.route(/\/rest\/v1\/rpc\/conta_tienda_plataforma_asignar(\?|$)/, (r) => { llamadas.push({ f: 'asignar', cuerpo: r.request().postDataJSON() }); return json(r, { id: TIENDA_SIN_LOCAL }) })
  await page.route(/\/rest\/v1\/rpc\/conta_liquidacion_resolver_tienda(\?|$)/, (r) => {
    llamadas.push({ f: 'resolver', cuerpo: r.request().postDataJSON() })
    return json(r, { texto: 'Apuntado: reclamas 52,59 € a Uber Eats. Te lo recuerdo hasta que llegue.' })
  })
  return llamadas
}

async function abrir(page: Page, caso: keyof typeof CASOS) {
  await entrarComo(page, CUENTA_A.email)
  const llamadas = await simular(page, caso)
  await page.goto('/conta/ventas/liquidaciones?mes=2026-10')
  await expect(page.getByRole('heading', { level: 1, name: 'Liquidaciones' })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-prueba="resumen-liquidaciones"]')).toBeVisible({ timeout: 30_000 })
  return llamadas
}
const frase = (page: Page) => page.locator('[data-prueba="resumen-liquidaciones"] .cxlm-frase')
const TECNICAS = /\b(motor|settlement|canal_id|party|clave|json|null|undefined|NaN|estado_motor|elige_local|ver_por_que)\b/i

test('1 · Mes completo: la frase, la barra verde y las tiendas plegadas', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  const llamadas = await abrir(page, 'completo')
  expect(llamadas.find((x) => x.f === 'mes')?.cuerpo).toMatchObject({ p_mes: '2026-10-01' })
  await expect(page.locator('[data-prueba="mes-liquidaciones"] strong')).toHaveText('Octubre 2026')
  await expect(frase(page)).toHaveText('Octubre: completo · 8 de 8 periodos con sus cuatro piezas')
  await expect(page.locator('.cxlm-barra i')).toHaveCount(1)
  await expect(page.locator('.cxlm-leyenda li')).toHaveText([/^Completas/, /^Aún no toca/, /^Te necesitan/, /^No cuadran/])
  const grupos = page.locator('[data-prueba="grupo-plataforma"]')
  await expect(grupos.locator('> summary')).toHaveText([/Glovo\s*4 de 4 completas/, /Just Eat\s*2 de 2 completas/, /Uber Eats\s*2 de 2 completas/])
  // Todo completo: las tiendas, plegadas; el resumen de cada una, «2 de 2».
  await expect(page.locator('[data-prueba="tienda"][open]')).toHaveCount(0)
  await expect(page.locator('[data-prueba="tienda"] > summary').first()).toContainText('2 de 2')
  // La ayuda, plegada y con sus cuatro estados.
  const ayuda = page.locator('[data-prueba="ayuda-liquidaciones"]')
  await ayuda.locator('> summary').click()
  await expect(ayuda).toContainText('Completa: están las cuatro y cuadran.')
  await ayuda.locator('> summary').click()
  // «Ver el recorrido» con nada que te necesite lo dice.
  await page.getByRole('button', { name: 'Ver el recorrido' }).click()
  await expect(page.locator('[data-prueba="liquidaciones-aviso"]')).toHaveText('No hay nada que te necesite este mes: no hay recorrido.')
  await page.reload()
  await expect(frase(page)).toBeVisible({ timeout: 30_000 })
  expect(await page.locator('.cxlm').innerText()).not.toMatch(TECNICAS)
  await alLado(page, 'completo')
  expect(errores).toEqual([])
})

test('2 · Mes con huecos: los estados, «Solo lo que te necesita», el recorrido y «Pídela»', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  await abrir(page, 'huecos')
  await expect(frase(page)).toHaveText('Octubre: 1 de 5 completa · 1 aún no toca · 3 te necesitan')
  // Primero lo que te necesita: Uber antes que Glovo.
  await expect(page.locator('[data-prueba="grupo-plataforma"] > summary')).toHaveText([/Uber Eats\s*3 te necesitan/, /Glovo\s*1 completa · 1 aún no toca/])
  const filas = page.locator('[data-prueba="fila-liquidacion"]')
  const coyote = filas.filter({ hasText: '28 sep–4 oct' })
  await expect(coyote.locator('.cxlm-pz')).toHaveText(['Vendido ✓', 'Liquidación falta', 'Factura falta', 'Cobro —'].map((t) => new RegExp(`^${t}`)))
  await expect(coyote.locator('.cxlm-chip')).toHaveText('Te necesita')
  await expect(coyote.getByRole('button', { name: 'Pídela' })).toBeVisible()
  await expect(filas.filter({ hasText: '19–25 oct' }).getByRole('button', { name: 'Súbela' })).toBeVisible()
  const espera = filas.filter({ hasText: '16–31 oct' })
  await expect(espera.locator('.cxlm-chip')).toHaveText('Aún no toca')
  await expect(espera).toContainText('Aún no toca: hacia el 04/11. No tienes que hacer nada.')
  await alLado(page, 'huecos')

  // «Solo lo que te necesita»: quedan las 3; la frase sigue contando el mes entero (regla 7).
  await page.getByLabel('Solo lo que te necesita').check()
  await expect(filas).toHaveCount(3)
  await expect(frase(page)).toHaveText('Octubre: 1 de 5 completa · 1 aún no toca · 3 te necesitan')
  await page.getByLabel('Solo lo que te necesita').uncheck()

  // «Ver el recorrido»: abre la primera que te necesita, y «Siguiente» la siguiente.
  await page.getByRole('button', { name: 'Ver el recorrido' }).click()
  await expect(coyote.locator('[data-prueba="fila-abierta"]')).toBeVisible()
  await coyote.getByRole('button', { name: 'Siguiente que te necesita ›' }).click()
  await expect(filas.filter({ hasText: '5–11 oct' }).locator('[data-prueba="fila-abierta"]')).toBeVisible()

  // «Pídela»: el correo escrito, con el buzón de Sumied.
  await coyote.getByRole('button', { name: 'Pídela' }).click()
  const d = page.getByRole('dialog', { name: 'Pídela · Uber Eats' })
  await expect(d.getByLabel('Texto')).toHaveValue(/No nos ha llegado la liquidación del 28\/09 al 04\/10 de la tienda «Coyotes Prueba \(Calle Prueba Sur 4\)»\. ¿Podéis mandarla, y las siguientes, también a facturas-prueba@buzon\.example\?/)
  await d.getByRole('button', { name: 'Cancelar' }).click()
  expect(errores).toEqual([])
})

test('3 · Tienda sin local: la pregunta, «Guardar» y lo que dice', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  const llamadas = await abrir(page, 'sinlocal')
  const tienda = page.locator('[data-prueba="tienda"]')
  await expect(tienda.locator('> summary')).toContainText('Tienda sin local')
  const filas = page.locator('[data-prueba="fila-liquidacion"]')
  await expect(filas.first().locator('.cxlm-pz').first()).toHaveText(/^Vendido \?/)
  const pregunta = page.locator('[data-prueba="pregunta-local"]')
  await expect(pregunta).toHaveCount(1)
  await expect(pregunta).toContainText('¿De qué local es esta tienda? Glovo la llama «Tacos Prueba - MAD - C. Prueba Este».')
  await expect(pregunta).toContainText('Vale para todas sus liquidaciones, las de antes y las que vengan.')
  // El filtro de local tiene «Tienda sin local».
  await expect(page.getByLabel('Local', { exact: true }).locator('option', { hasText: 'Tienda sin local' })).toHaveCount(1)
  await alLado(page, 'sinlocal')
  const local = pregunta.getByLabel('Local de la tienda')
  const opcion = await local.locator('option').nth(1).getAttribute('value')
  test.skip(!opcion, 'La cuenta A de staging no tiene ningún local.')
  await local.selectOption(opcion!)
  await pregunta.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.locator('[data-prueba="liquidaciones-aviso"]')).toContainText('Guardado: «Tacos Prueba - MAD - C. Prueba Este» es de ')
  // Le da el local y le deja su marca (no la borra).
  expect(llamadas.find((x) => x.f === 'asignar')?.cuerpo).toMatchObject({ p_store: TIENDA_SIN_LOCAL, p_local: opcion, p_marca: 'e0200000-0000-4000-8000-00000000b0b0', p_banco: null })
  expect(errores).toEqual([])
})

test('4 · «No cuadra» abierta, las marcas cedidas, lo que espera a su factura y el Excel', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  const llamadas = await abrir(page, 'nocuadra')
  await expect(frase(page)).toHaveText('Octubre: 0 de 2 completas · 1 aún no toca · 1 no cuadra')
  const fila = page.locator('[data-prueba="fila-liquidacion"]').filter({ hasText: '12–18 oct' })
  await expect(fila.locator('.cxlm-chip')).toHaveText('No cuadra')
  await expect(fila.locator('.cxlm-pz[data-tono="mal"]')).toHaveText(/^Liquidación/)
  await fila.getByRole('button', { name: 'Ver por qué' }).click()
  const abierta = fila.locator('[data-prueba="fila-abierta"]')
  await expect(abierta).toContainText('Por qué no cuadra: La liquidación dice 1.079,28 € y vendiste 1.026,69 €: liquida 52,59 € de más.')
  await expect(abierta.locator('.cxlm-tabla tr')).toHaveText([/^Pedidos.*41$/, /^Ventas.*1\.079,28 €$/, /^Comisión.*−?-?323,78 €$/, /^Otros.*/, /^Lo que te pagan.*694,30 €$/])
  await expect(abierta).toContainText('38 pedidos · 1.026,69 €')
  await expect(abierta).toContainText('UBER-PRUEBA-104512 · 391,77 €')
  await expect(abierta).toContainText('Llegaron 694,30 € al banco el 21/10 ✓')
  // Liquida de más: no es un gasto; se reclama.
  await expect(abierta.getByRole('button', { name: 'Es un gasto' })).toHaveCount(0)
  await abierta.getByRole('button', { name: 'Lo reclamo a Uber Eats' }).click()
  await abierta.getByLabel(/^En una frase, por qué/).fill('Tres pedidos del 18/10 que en caja están en el día siguiente')
  await alLado(page, 'nocuadra')
  await abierta.getByRole('button', { name: 'Apuntar la reclamación' }).click()
  await expect(page.locator('[data-prueba="liquidaciones-aviso"]')).toHaveText('Apuntado: reclamas 52,59 € a Uber Eats. Te lo recuerdo hasta que llegue.')
  expect(llamadas.find((x) => x.f === 'resolver')?.cuerpo).toMatchObject({ p_intermediario: ROL.uber, p_local: LOCAL.norte, p_tipo: 'reclamacion', p_importe: 52.59 })

  // Lo que espera a su factura de comisión, en su fila y con sus palabras (S01q·10).
  await expect(page.locator('[data-prueba="sin-propuesta"]')).toHaveText(ESPERA)
  // Las marcas cedidas, aparte.
  const cedidas = page.locator('[data-prueba="grupo-cedidas"]')
  await expect(cedidas.locator('> summary')).toContainText('Marcas cedidas · se cuadran con Socio Prueba')
  await expect(cedidas).toContainText('Socio Prueba liquida una vez al mes, por local: hacia el 15/11.')

  // «Exportar a Excel»: todas las del mes, y lo dice.
  const bajada = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar a Excel' }).click()
  expect((await bajada).suggestedFilename()).toBe('liquidaciones-octubre-2026.xlsx')
  await expect(page.locator('[data-prueba="liquidaciones-aviso"]')).toContainText('3 filas, todas las del mes')
  expect(await page.locator('.cxlm').innerText()).not.toMatch(TECNICAS)
  expect(errores).toEqual([])
})
