// tests/e2e/conta/v02/liquidaciones.spec.ts
//
// V02 · Pantallas · Ventas › Liquidaciones, en el ordenador y en el móvil.
// S01q · PR C (03/11): la pantalla es ya la del mes (su e2e, s01q/liquidaciones-mes.spec.ts);
// aquí quedan «Subir una liquidación» con el informe de Uber y la otra actividad.
//
// La base de la tanda (20261026T0125_v02p_motor_por_tienda) es «cambia»:
// staging la ensaya en ROLLBACK desde la rama y no la tiene hasta que esté en
// producción y se fusione (W04). Por eso lo que la pantalla LEE del motor
// (conta_liquidaciones) y de quién te paga (party_role y party), y lo que
// ESCRIBE (resolver, confirmar la tienda, apuntar a mano, registrar lo leído),
// se simula aquí con la forma del motor de la 0125 y las cifras de Foodint del
// 26/10 (Meraki Pita: Uber paga 46 pedidos y en caja hay 44; la factura de
// comisión que falta; Glovo aún a tiempo), con fechas de este mes para que no
// caduquen. Lo demás (la sesión, el marco, el menú de Ventas, «Más acciones»,
// el lector del informe de Uber con su fichero de verdad) es staging y el
// código de verdad. Las funciones las prueba su prueba de staging.
//
//   1. Cuenta A (hostelería): la banda del mes, «Pedir las N que faltan» (dice
//      que no ha mandado nada), la tienda cambiada («Sí, desde el…»), «Este
//      mes» con sus cuatro píldoras y un botón por tarjeta, «Ver por qué» que
//      se resuelve en una frase (con la marca de la tienda), «Pedírsela»,
//      «Y N cuadradas más · Ver todas», «Cuándo te pagan» y, en la barra,
//      Liquidaciones encima del bloque «Hostelería».
//   2. Cuenta A: «Subir una liquidación» con el informe «Detalles del pago» de
//      Uber (el fichero de las pruebas unitarias): una por tienda, y lo dice.
//   3. Cuenta D (sin hostelería): el datáfono, Amazon y Stripe; nada de
//      plataformas de reparto ni de «Conectar»; «Ver las N pendientes» y
//      «Apuntar a mano» a alguien nuevo, que se da de alta.
// Las capturas, al lado de su tablero (docs/conta/v02/tableros), en el artefacto.

import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, CUENTA_D, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/v02'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const foto = (page: Page, nombre: string) => page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

// ── Lo simulado ──────────────────────────────────────────────────────────────
/** Un día de este mes (Madrid ≈ UTC para un día suelto). */
const delMes = (dia: number) => { const d = new Date(); d.setUTCDate(1); d.setUTCDate(dia); return d.toISOString().slice(0, 10) }
const ROL = { uber: 'r0000000-0000-4000-8000-0000000000u1', glovo: 'r0000000-0000-4000-8000-0000000000g1', je: 'r0000000-0000-4000-8000-0000000000j1',
  datafono: 'r0000000-0000-4000-8000-0000000000d1', amazon: 'r0000000-0000-4000-8000-0000000000a1', stripe: 'r0000000-0000-4000-8000-0000000000s1' }
const NORTE = 'c01a0000-0000-4000-8000-0000000000a2'
const MARCA = { burger: 'e0200000-0000-4000-8000-00000000a0b1', pita: 'e0200000-0000-4000-8000-00000000a0b2' }

/** Una fila del motor (conta_liquidaciones, forma de la 0125). */
function fila(o: {
  rol: string; quien: string; canal?: string | null; local?: string | null; localId?: string | null; marca?: string | null; marcaId?: string | null
  desde: string; hasta: string; estado: string; frase: string; diferencia?: number | null; vendido: number | null; pedidos?: number
  liq?: { ventas: number; pedidosTotal: number; comision: number; pagan: number; tienda?: string } | null; faltan?: number; llegado?: number | null; avisos?: unknown[]
}) {
  const l = o.liq ?? null
  return {
    clave: `${o.rol}:${o.localId ?? 'sin'}:${o.marcaId ?? 'sin'}:${o.desde}:${o.hasta}`, intermediario_id: o.rol, intermediario: o.quien, canal_id: o.canal ?? null, canal: o.quien,
    local_id: o.localId ?? null, local: o.local ?? null, marca_id: o.marcaId ?? null, marca: o.marca ?? null, desde: o.desde, hasta: o.hasta,
    estado: o.estado, cerrada: o.estado === 'cuadra', diferencia: o.diferencia ?? null, frase: o.frase,
    piezas: {
      vendido: { via: o.canal ? 'pedidos' : 'facturas', total: o.vendido, pedidos: o.canal ? { total: o.vendido, pedidos: o.pedidos ?? 0, dias: 7 } : null },
      liquidacion: { n: l ? 1 : 0, ventas: l?.ventas ?? 0, pedidos_total: l?.pedidosTotal ?? 0, comision: l?.comision ?? 0, pagan: l?.pagan ?? null, otros: null, referencia: false },
      factura: { faltan: o.faltan ?? 0 },
      cobro: { esperado: l?.pagan ?? null, llegado: o.llegado ?? null, por_cobrar: l && o.llegado == null && (l.pagan ?? 0) > 0 ? 1 : 0 },
    },
    liquidaciones: l ? [{ id: `liq-${o.rol}-${o.desde}-${o.marcaId ?? ''}`, tienda: l.tienda ?? o.marca, ref: null, origen: 'correo_uber', pedidos: o.pedidos ?? null, ventas: l.ventas, pedidos_total: l.pedidosTotal,
      comision: l.comision, neto: l.pagan, cobrado: o.llegado ?? null, cobrado_el: null, referencia: false, por_aclarar: null, a_facturar: o.faltan ? l.comision : null,
      factura: null, casada_en_banco: false, facturas_cobradas: null, facturas_nota: null }] : [],
    resoluciones: [], reclamado_sin_llegar: 0, avisos: o.avisos ?? [], plazo: o.hasta,
  }
}

function motorHosteleria() {
  const sem = (n: number) => ({ desde: delMes(1 + 7 * n), hasta: delMes(7 + 7 * n) })
  const uber = { rol: ROL.uber, quien: 'Uber Eats', canal: 'e0200000-0000-4000-8000-00000000a0c2', local: 'Norte Centro', localId: NORTE }
  const cuadradas = Array.from({ length: 6 }, (_, i) => fila({ ...uber, ...sem(i % 3), marca: i % 2 ? 'Pita Prueba' : 'Burger Prueba', marcaId: `${i}0200000-0000-4000-8000-00000000a0b9`,
    estado: 'cuadra', frase: 'Cuadra: lo vendido, la liquidación, su factura y el cobro.', vendido: 100 + i, pedidos: 4, liq: { ventas: 130 + i, pedidosTotal: 100 + i, comision: 20, pagan: 75 + i }, llegado: 75 + i }))
  return [
    // Meraki: Uber paga 46 pedidos y en caja hay 44 (las cifras de Foodint del 12 al 18/10).
    fila({ ...uber, ...sem(1), marca: 'Pita Prueba', marcaId: MARCA.pita, estado: 'diferencia', diferencia: -52.59, vendido: 1026.69, pedidos: 44,
      frase: 'La liquidación dice 1.079,28 € y vendiste 1.026,69 €: liquida 52,59 € de más.', liq: { ventas: 1614, pedidosTotal: 1079.28, comision: 153.17, pagan: 782.16 } }),
    // Just Eat: te pagó 2,40 € menos de lo que dice su liquidación.
    fila({ rol: ROL.je, quien: 'Just Eat', canal: 'e0200000-0000-4000-8000-00000000a0c3', local: 'Norte Centro', localId: NORTE, marca: 'Burger Prueba', marcaId: MARCA.burger,
      desde: delMes(1), hasta: delMes(15), estado: 'diferencia', diferencia: 2.4, vendido: 1250, pedidos: 50, llegado: 1118.15,
      frase: 'Dice que paga 1.120,55 € y al banco llegaron 1.118,15 €: faltan 2,40 €.', liq: { ventas: 1250, pedidosTotal: 1250, comision: 129.45, pagan: 1120.55 } }),
    // Glovo: aún a tiempo.
    fila({ rol: ROL.glovo, quien: 'Glovo', canal: 'e0200000-0000-4000-8000-00000000a0c1', local: 'Norte Centro', localId: NORTE, marca: 'Burger Prueba', marcaId: MARCA.burger,
      desde: delMes(1), hasta: delMes(15), estado: 'esperando_liquidacion', vendido: 2310.8, pedidos: 90, frase: 'Aún a tiempo: Glovo suele pagar hacia el 04/11.' }),
    // Uber: falta la factura de comisión; su tienda llega con otro nombre.
    fila({ ...uber, ...sem(1), marca: 'Burger Prueba', marcaId: MARCA.burger, estado: 'falta_factura', vendido: 986.15, pedidos: 30, faltan: 1,
      frase: 'Falta su factura de comisión: cuando llegue a Compras, se engancha.', liq: { ventas: 1200, pedidosTotal: 986.15, comision: 160, pagan: 700 },
      avisos: [{ tipo: 'tienda_cambiada', cambio_id: 'cambio-1', texto: 'La tienda «Burger Prueba (Calle Prueba 1)» llega como «Burger Club (Calle Prueba 1)»: confírmalo con un clic.' }] }),
    ...cuadradas,
  ]
}
type Quien = { id: string; party_id: string; channel_id: string | null; settlement_every: string | null; payout_days_after: number | null; nombre: string }
const quienesHosteleria: Quien[] = [
  { id: ROL.uber, party_id: 'p-uber', channel_id: 'e0200000-0000-4000-8000-00000000a0c2', settlement_every: 'weekly', payout_days_after: 1, nombre: 'Uber Eats' },
  { id: ROL.glovo, party_id: 'p-glovo', channel_id: 'e0200000-0000-4000-8000-00000000a0c1', settlement_every: 'fortnightly', payout_days_after: 20, nombre: 'Glovo' },
  { id: ROL.je, party_id: 'p-je', channel_id: 'e0200000-0000-4000-8000-00000000a0c3', settlement_every: 'fortnightly', payout_days_after: 4, nombre: 'Just Eat' },
]

function motorPapeleria() {
  return [
    fila({ rol: ROL.datafono, quien: 'Datáfono BBVA', desde: delMes(3), hasta: delMes(3), estado: 'cuadra', vendido: 612.4, frase: 'Cuadra.', liq: { ventas: 612.4, pedidosTotal: 612.4, comision: 0, pagan: 612.4 }, llegado: 612.4 }),
    fila({ rol: ROL.amazon, quien: 'Amazon', desde: delMes(1), hasta: delMes(14), estado: 'falta_factura', vendido: 2140.9, faltan: 1,
      frase: 'Falta la factura de comisiones de Amazon: cuando llegue a Compras, se engancha.', liq: { ventas: 2140.9, pedidosTotal: 2140.9, comision: 312.5, pagan: 1828.4 } }),
    fila({ rol: ROL.stripe, quien: 'Stripe', desde: delMes(5), hasta: delMes(11), estado: 'falta_liquidacion', vendido: 1208, frase: 'Falta su liquidación: tenía que haber llegado y vendiste 1.208,00 €.' }),
  ]
}
const quienesPapeleria: Quien[] = [
  { id: ROL.datafono, party_id: 'p-datafono', channel_id: null, settlement_every: null, payout_days_after: null, nombre: 'Datáfono BBVA' },
  { id: ROL.amazon, party_id: 'p-amazon', channel_id: null, settlement_every: 'monthly', payout_days_after: 3, nombre: 'Amazon' },
  { id: ROL.stripe, party_id: 'p-stripe', channel_id: null, settlement_every: 'weekly', payout_days_after: 5, nombre: 'Stripe' },
]

type Llamada = { f: string; cuerpo: Record<string, unknown> }
/** Simula las funciones de Liquidaciones (solo esas). Devuelve lo que se ha llamado. */
async function simular(page: Page, motor: unknown[], quienes: Quien[]): Promise<Llamada[]> {
  const llamadas: Llamada[] = []
  const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })
  const apuntar = (f: string, respuesta: unknown) => (r: Route) => { llamadas.push({ f, cuerpo: r.request().postDataJSON() }); return json(r, respuesta) }
  await page.route(/\/rest\/v1\/rpc\/conta_liquidaciones(\?|$)/, (r) => json(r, motor))
  await page.route(/\/rest\/v1\/party_role\?/, (r) => json(r, quienes.map((q) => ({ id: q.id, party_id: q.party_id, channel_id: q.channel_id, settlement_every: q.settlement_every, payout_days_after: q.payout_days_after }))))
  await page.route(/\/rest\/v1\/party\?/, (r) => json(r, quienes.map((q) => ({ id: q.party_id, name: q.nombre }))))
  await page.route(/\/rest\/v1\/rpc\/conta_liquidacion_resolver_tienda(\?|$)/, apuntar('resolver', { texto: 'Apuntado: reclamas 52,59 € a Uber Eats. Te lo recuerdo hasta que llegue.' }))
  await page.route(/\/rest\/v1\/rpc\/conta_tienda_cambio_decidir(\?|$)/, apuntar('tienda', { texto: 'Confirmado: «Burger Club (Calle Prueba 1)» es la misma tienda.' }))
  await page.route(/\/rest\/v1\/rpc\/conta_intermediario_asegurar(\?|$)/, apuntar('alta', ROL.stripe))
  await page.route(/\/rest\/v1\/rpc\/conta_liquidacion_apuntar(\?|$)/, apuntar('apuntar', { liquidacion_id: 'nueva', texto: 'Apuntada la liquidación de PayPal del 01/10 al 15/10/2026: vendido 318,75 €, comisión 12,40 €, te paga 306,35 €.' }))
  let n = 0
  await page.route(/\/rest\/v1\/rpc\/conta_liquidacion_registrar(\?|$)/, (r) => {
    const cuerpo = r.request().postDataJSON() as Record<string, unknown>
    llamadas.push({ f: 'registrar', cuerpo })
    n += 1
    return json(r, { liquidacion_id: `reg-${n}`, ya_estaba: n === 1, texto: n === 1 ? 'Esta liquidación ya estaba: no se ha creado nada.' : 'Registrada.' })
  })
  return llamadas
}

/** Las palabras de técnico que no salen (encargo, punto 6). */
const TECNICAS = /\b(motor|settlement|canal_id|party|rol|clave|json|null|undefined|NaN)\b/i

test('Hostelería: «Subir una liquidación» con el informe de Uber registra una por tienda y lo dice', async ({ page }) => {
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  const llamadas = await simular(page, motorHosteleria(), quienesHosteleria)
  await page.goto('/conta/ventas/liquidaciones')
  await expect(page.locator('[data-prueba="resumen-liquidaciones"]')).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('Elegir la liquidación').setInputFiles('tests/unit/modules/conta/v02/fixtures/liquidaciones/uber-detalles-pago-20261024.csv')
  const aviso = page.locator('[data-prueba="liquidaciones-aviso"]')
  await expect(aviso).toContainText('nuevas de 8; las demás ya estaban.', { timeout: 30_000 })
  await expect(aviso).toContainText('Esta liquidación ya estaba')
  const registradas = llamadas.filter((x) => x.f === 'registrar')
  expect(registradas).toHaveLength(8)
  // Cada tienda, por su ID de Uber, con lo que suman sus pedidos.
  expect((registradas[0].cuerpo.p as Record<string, unknown>)).toMatchObject({ proveedor: 'uber', origen: 'informe', tienda_id: '04a4a861-2470-5869-86d3-befc33880227', pedidos_total: 22.53 })
  await foto(page, 'subir-informe-uber')
  expect(errores).toEqual([])
})

test('Otra actividad (sin hostelería): el datáfono, Amazon y Stripe, sin plataformas de reparto, y apuntar a mano', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_D.email)
  const llamadas = await simular(page, motorPapeleria(), quienesPapeleria)
  // S01q · PR C: la pantalla lee el mes (conta_liquidaciones_mes); las mismas tres, en sus cuatro estados.
  const deCuatro: Record<string, [string, string | null]> = { cuadra: ['completa', null], falta_factura: ['te_necesita', 'subela'], falta_liquidacion: ['te_necesita', 'pidela'] }
  const filas = motorPapeleria().map((f) => ({ ...f, estado: deCuatro[f.estado][0], estado_motor: f.estado, accion: deCuatro[f.estado][1], sin_local: false, grupo: 'plataforma', tiendas: [], cuando: null, comparado: null }))
  await page.route(/\/rest\/v1\/rpc\/conta_liquidaciones_mes(\?|$)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    mes: `${delMes(1).slice(0, 7)}-01`, desde: `${delMes(1).slice(0, 7)}-01`, hasta: delMes(28), filas, cedidas: [],
    resumen: { total: 3, completa: 1, aun_no_toca: 0, te_necesita: 2, no_cuadra: 0 } }) }))
  await page.goto('/conta/ventas/liquidaciones')
  await expect(page.getByRole('heading', { level: 1, name: 'Liquidaciones' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Lo que te pagan quienes cobran por ti (el datáfono, Amazon, Stripe, PayPal…)', { exact: false })).toBeVisible()
  await expect(page.locator('[data-prueba="resumen-liquidaciones"] .cxlm-frase')).toHaveText(/: 1 de 3 completa · 2 te necesitan$/)
  const grupos = page.locator('[data-prueba="grupo-plataforma"]')
  await expect(grupos.filter({ hasText: 'Stripe' }).getByRole('button', { name: 'Pídela' })).toBeVisible()
  await expect(grupos.filter({ hasText: 'Amazon' }).getByRole('button', { name: 'Súbela' })).toBeVisible()
  // Sin hostelería: ni filtro de local, ni plataformas de reparto, ni socios de marca, ni «Conectar».
  await expect(page.getByLabel('Local', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/Uber|Glovo|Just Eat/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Conectar/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Más acciones', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Socios de marca/ })).toHaveCount(0)
  expect(await page.locator('.cxlm').innerText()).not.toMatch(TECNICAS)

  // «Apuntar a mano» a alguien nuevo (PayPal): se da de alta y se apunta, y lo dice.
  await page.getByRole('button', { name: /^Apuntar a mano/ }).click()
  const d = page.getByRole('dialog', { name: 'Apuntar a mano una liquidación' })
  await d.getByLabel('Quién te paga').selectOption({ label: 'Otro (Amazon, Stripe, PayPal, el datáfono…)' })
  await d.getByLabel('Su nombre').fill('PayPal')
  await expect(d.getByLabel(/^Local/)).toHaveCount(0)
  await d.getByLabel('Lo vendido (€)').fill('318,75')
  await d.getByLabel('Comisión (€)').fill('12,40')
  await d.getByLabel('Te paga (€)').fill('306,35')
  await foto(page, 'apuntar-a-mano')
  await d.getByRole('button', { name: 'Apuntarla' }).click()
  await expect(page.locator('[data-prueba="liquidaciones-aviso"]')).toContainText('PayPal dado de alta en Contactos como quien te paga. Apuntada la liquidación de PayPal')
  expect(llamadas.find((x) => x.f === 'alta')?.cuerpo).toMatchObject({ p_nombre: 'PayPal', p_canal: null })
  expect(llamadas.find((x) => x.f === 'apuntar')?.cuerpo).toMatchObject({ p: { intermediario: ROL.stripe, local: null, vendido: 318.75, comision: 12.4, cobrado: 306.35 } })
  expect(errores).toEqual([])
})
