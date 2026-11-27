/// <reference lib="dom" />
// tests/e2e/conta/r21/facturar-mes.spec.ts
//
// R21 · «Facturar el mes», a 1366 y a 1920, fiel a la maqueta aprobada (versión 1795798209-d437):
//   1. noviembre como hoy (ya mandado a Cegid): abre en el paso 4 con los pasos 1 a 3 en verde y la cifra que Cegid
//      tiene que dar; «Pendientes: N» arriba con su lista; «No coincide» enseña lo mandado cliente a cliente;
//      «Coincide» lo apunta; el paso 5 comprueba contra las facturas de Cegid y dice que están todas;
//   2. un mes sin mandar: abre en el paso 2 con una tarjeta por caso; «Dejar los N para después y seguir» los pasa a
//      Pendientes, «Deshacer» devuelve uno, el cuadre da 0,00 € y entonces «Mandar» se activa (con 1 céntimo, no:
//      eso lo prueba la unitaria).
//
// La sesión, el marco y la cuenta de prueba son staging y el código de verdad. Lo que la pantalla LEE se simula (como
// en ../q10/facturas-noviembre.spec.ts), con datos inventados (T11). Nada se escribe: ni en Sumied ni en Cegid; lo que
// se «manda» lo contesta la simulación.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'

const DIR = 'docs/conta/capturas/r21'
const MES = '2026-11'

async function empresa(s: Sesion): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${CUENTA_A.id}&order=created_at.asc`)
  const id = (r.datos ?? [])[0]?.id
  if (!id) throw new Error(`La cuenta de prueba A no tiene empresas (HTTP ${r.status}).`)
  return id
}

type Fila = Record<string, unknown>
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/*' }, body: JSON.stringify(cuerpo) })
const objeto = (r: Route, x: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })

/**
 * Una gestoría con cuatro cobros de GoCardless (dos con su cliente de Cegid, uno sin unir a Cegid y uno sin NIF) y una
 * transferencia que el banco no dice de quién es. Con `mandado`, los dos con cliente ya están en Cegid (como noviembre).
 */
async function simular(page: Page, Q: string, mandado: boolean) {
  await page.route(/\/rest\/v1\/company\?/, async (r) => {
    if (r.request().method() !== 'GET') return r.continue()
    const resp = await r.fetch().catch(() => null)
    if (!resp) return
    let cuerpo: unknown = await resp.json().catch(() => null)
    const cambiar = (x: Fila) => {
      if (String(x.id) !== Q) return x
      const y: Fila = { ...x, sector: 'gestoria', is_hospitality: false, tax_id: 'B00000000', fiscal_street: 'Calle Inventada 1', fiscal_postal_code: '28000', fiscal_city: 'Madrid', email: 'gestoria@ejemplo.test' }
      for (const k of ['legal_name', 'trade_name', 'name', 'nombre', 'commercial_name']) if (k in y) y[k] = 'Gestoría de Prueba Norte, S.L.'
      return y
    }
    cuerpo = Array.isArray(cuerpo) ? cuerpo.map((x) => cambiar(x as Fila)) : cuerpo && typeof cuerpo === 'object' ? cambiar(cuerpo as Fila) : cuerpo
    return r.fulfill({ response: resp, body: JSON.stringify(cuerpo) })
  })
  const cobro = (gc: string, importe: number, fecha: string) => ({ gc_id: `PM${gc}`, estado: 'paid_out', fecha, importe, suscripcion_gc_id: `SB${gc}`, mandato_gc_id: `MD${gc}`, motivo_es: null })
  const cobros = [cobro('1', 121, `${MES}-03`), cobro('2', 60.5, `${MES}-04`), cobro('5', 121, `${MES}-04`), cobro('6', 36.3, `${MES}-05`)]
  const suscripciones = ['1', '2', '5', '6'].map((g) => ({ gc_id: `SB${g}`, nombre: 'GESTORIA MENSUAL', gc_cliente_id: `CU${g}` }))
  const mandatos = ['1', '2', '5', '6'].map((g) => ({ gc_id: `MD${g}`, gc_cliente_id: `CU${g}`, cuenta_final: `1${g}` }))
  const enlaces = ['1', '2', '5', '6'].map((g) => ({ gc_cliente_id: `CU${g}`, party_id: `p${g}`, estado: 'atado' }))
  const fichas = [['p1', 'Construcciones Ficticias, S.A.', 'A00000000'], ['p2', 'Talleres de Prueba, S.L.', 'B00000000'],
    ['p5', 'Sin Atar de Prueba, S.L.', 'B00000002'], ['p6', 'Sin NIF de Prueba, S.L.', null]].map(([id, name, tax_id]) => ({ id, name, tax_id }))
  const enlaces430 = [['p1', '43000101'], ['p2', '43000102']].map(([entity_id, code]) => ({ entity_id, company_account: { code } }))
  const clientesCegid = [[101, 'Construcciones Ficticias, S.A.', 'A00000000'], [102, 'Talleres de Prueba, S.L.', 'B00000000'], [105, 'Sin Atar de Prueba, S.L.', null]]
    .map(([codigo, nombre, nif]) => ({ codigo, nombre_comercial: null, nombre_fiscal: nombre, nif, conceptos: [] as Fila[], leido_at: '2026-11-27T02:00:00Z' }))
  const conceptosCegid = [['00001', 'GESTORÍA MENSUAL']].map(([codigo, descripcion]) => ({ codigo, descripcion, por_iva: 21, con_retencion: false, iva_incluido: false }))
  // Las facturas de Cegid: una de octubre; con «generado», las dos de noviembre que tiene que haber.
  const generado = { si: false }
  const factura = (codigo: number, cliente: number, total: number, fecha: number) => ({ ejercicio: 2026, serie: '1', codigo, cliente, nif: null, fecha_cegid: fecha, total, retencion: 0, porcentaje_retencion: null, lineas: [] })
  const facturas = () => [factura(2700, 101, 121, 20261005), ...(generado.si ? [factura(2750, 101, 121, 20261130), factura(2751, 102, 60.5, 20261130)] : [])]
  await page.route(/\/rest\/v1\/(conta_cegid_cliente|conta_cegid_concepto|conta_cegid_factura|conta_cegid_cuota_revisada)\?/, (r) => {
    const t = /\/rest\/v1\/([a-z_]+)\?/.exec(r.request().url())![1]
    return json(r, t === 'conta_cegid_cliente' ? clientesCegid : t === 'conta_cegid_concepto' ? conceptosCegid : t === 'conta_cegid_factura' ? facturas() : [])
  })
  await page.route(/\/functions\/v1\/conta-cegid-leer/, (r) => {
    const b = (r.request().postDataJSON() ?? {}) as Fila
    if (b.accion === 'leer') return objeto(r, { ok: true, que: b.que, pagina: b.pagina, leidas: 3, total: 3, ultima: true })
    return objeto(r, { ok: true, que: b.que, desde: b.desde, hechos: 3, ultima: true })
  })
  const TABLAS: Record<string, unknown[]> = { conta_gc_cobro: cobros, conta_gc_suscripcion: suscripciones, conta_gc_mandato: mandatos, conta_gc_enlace: enlaces, party: fichas, customer_fiscal: [],
    company_account_link: enlaces430, conta_cobro_cliente: [], conta_gc_cliente: [], conta_cegid_concepto_elegido: [] }
  await page.route(/\/rest\/v1\/(conta_gc_cobro|conta_gc_suscripcion|conta_gc_mandato|conta_gc_enlace|party|customer_fiscal|company_account_link|conta_cobro_cliente|conta_gc_cliente|conta_cegid_concepto_elegido)\?/, (r) => {
    if (r.request().method() !== 'GET') return r.fallback()
    const t = /\/rest\/v1\/([a-z_]+)\?/.exec(r.request().url())![1]
    if (/offset=1000|range=1000/.test(r.request().url()) || (r.request().headers()['range'] ?? '').startsWith('1000')) return json(r, [])
    return json(r, TABLAS[t])
  })
  const mandadas: Fila[] = mandado ? [{ gc_cobro_id: 'PM1', cliente: 101, incidencia: 1, estado: 'mandada', total: 121, serie: '1', serie_factura: null, origen_clave: null },
    { gc_cobro_id: 'PM2', cliente: 102, incidencia: 2, estado: 'mandada', total: 60.5, serie: '1', serie_factura: null, origen_clave: null }] : []
  await page.route(/\/rest\/v1\/conta_cegid_incidencia\?/, (r) => json(r, mandadas))
  const BANCO = [{ clave: 'mov:00000000-0000-4000-8000-0000000000c1', tipo: 'banco', movementId: '00000000-0000-4000-8000-0000000000c1', fecha: `${MES}-10`, importe: 140, via: 'traspaso',
    estado: 'sin_cliente', texto: '2DO PAGO GESTORIA DE PRUEBA', codigo: null, recibos: [], decision: null }]
  const pedidas: Fila[] = []
  await page.route(/\/functions\/v1\/conta-cegid-mandar/, (r) => {
    const b = (r.request().postDataJSON() ?? {}) as Fila
    pedidas.push(b)
    if (b.accion === 'banco_leer') return objeto(r, { ok: true, cobros: BANCO, facturados: {}, frase: 'Leído.' })
    if (b.accion === 'mandar') {
      for (const gc of b.cobros as string[]) mandadas.push({ gc_cobro_id: gc, cliente: b.cliente, incidencia: mandadas.length + 1, estado: 'mandada', total: Number(cobros.find((c) => c.gc_id === gc)?.importe ?? 0), serie: b.serie, serie_factura: null, origen_clave: null })
      return objeto(r, { ok: true, hechas: (b.cobros as string[]).length, frase: `Mandado a Cegid el cliente ${b.cliente}.` })
    }
    return objeto(r, { ok: false, error: 'La prueba no simula esto.' })
  })
  // R21 · la 1826, simulada: lo dejado para después y el visto bueno, con sus funciones (cada una apunta quién y cuándo).
  const pendientes: Fila[] = []
  let vistoBueno: Fila | null = null
  await page.route(/\/rest\/v1\/conta_factura_pendiente\?/, (r) => {
    if (/resuelto_mes=/.test(r.request().url())) return json(r, [])
    return json(r, pendientes.filter((x) => !x.deshecho_at && !x.resuelto_at))
  })
  await page.route(/\/rest\/v1\/conta_factura_visto_bueno\?/, (r) => {
    const objeto1 = (r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object')
    return objeto1 ? (vistoBueno ? objeto(r, vistoBueno) : r.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', message: 'Sin filas' }) }))
      : json(r, vistoBueno ? [vistoBueno] : [])
  })
  await page.route(/\/rest\/v1\/rpc\/conta_factura_(dejar|deshacer_pendiente|resolver_pendiente|visto_bueno_dar)/, (r) => {
    const que = /conta_factura_([a-z_]+)/.exec(r.request().url())![1]
    const b = (r.request().postDataJSON() ?? {}) as Fila
    pedidas.push({ accion: que, ...b })
    if (que === 'dejar') {
      const id = `pend-${pendientes.length + 1}`
      pendientes.push({ id, clave: b.p_clave, tipo: b.p_tipo, mes: b.p_mes, cliente: b.p_cliente, importe: Number(b.p_importe), motivo: b.p_motivo, dejado_por: 'Persona de prueba', dejado_at: '2026-11-27T20:00:00Z' })
      return objeto(r, { id, frase: `Dejado para después: ${String(b.p_importe).replace('.', ',')} € quedan en Pendientes, fuera de esta factura.` })
    }
    const x = pendientes.find((p) => p.id === b.p_id)
    if (que === 'deshacer_pendiente' && x) { x.deshecho_at = '2026-11-27T20:01:00Z'; return objeto(r, { id: x.id, frase: 'Deshecho: el caso vuelve a estar por resolver.' }) }
    if (que === 'resolver_pendiente' && x) { x.resuelto_at = '2026-11-27T20:02:00Z'; return objeto(r, { id: x.id, frase: 'Resuelto: sale de Pendientes.' }) }
    vistoBueno = { serie: b.p_serie, total: Number(b.p_total), facturas: b.p_facturas, quien: 'Persona de prueba', at: '2026-11-27T20:03:00Z' }
    return objeto(r, { id: 'vb-1', frase: `Apuntado: Cegid da ${String(b.p_total).replace('.', ',')} € en ${b.p_facturas} facturas de la serie ${b.p_serie}.` })
  })
  return { pedidas, generado }
}

const foto = async (page: Page, nombre: string) => {
  mkdirSync(DIR, { recursive: true })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}.png`, fullPage: true })
}

for (const [ancho, alto] of [[1366, 768], [1920, 1080]] as const) {
  test(`«Facturar el mes» a ${ancho}: noviembre ya mandado abre en el paso 4, «Coincide» y el paso 5 comprueba las facturas`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'Facturar el mes, en el ordenador')
    test.setTimeout(150_000)
    await page.setViewportSize({ width: ancho, height: alto })
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(e.message))
    const s = await entrarComo(page, CUENTA_A.email)
    const Q = await empresa(s)
    const { pedidas, generado } = await simular(page, Q, true)
    await page.goto(`/conta/ventas/clientes-y-cuotas/facturar?empresa=${Q}&mes=${MES}`, { timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Facturar noviembre de 2026' })).toBeVisible({ timeout: 30_000 })
    // Los pasos 1 a 3, en verde con su resultado; abre en el 4.
    await expect(page.locator('[data-prueba="paso-visible"]')).toHaveText('Paso 4 de 5')
    for (const n of [1, 2, 3]) await expect(page.locator(`[data-prueba="paso-${n}"]`)).toHaveAttribute('data-hecho', 'si')
    await expect(page.locator('[data-prueba="paso-1"] [data-prueba="resultado"]')).toHaveText('✓ Cobrado a clientes: 478,80 €. Listo para mandar: 2 cobros. Pendiente de decidir: 3 casos.')
    await expect(page.locator('[data-prueba="paso-3"] [data-prueba="resultado"]')).toHaveText('✓ Mandados 2 cobros (181,50 €). El cuadre da 0,00 €.')
    await expect(page.locator('[data-prueba="paso-5"]')).toHaveAttribute('data-falta', 'si')
    await expect(page.locator('[data-prueba="cifra-cegid"]')).toHaveText('181,50 € · 2 facturas')
    // R21d · «Empezar desde el paso 1»: se recorren los pasos hechos, uno a uno, y se vuelve al 4 sin deshacer nada.
    await page.getByRole('button', { name: 'Empezar desde el paso 1' }).click()
    await expect(page.locator('[data-prueba="paso-visible"]')).toHaveText('Paso 1 de 5')
    await expect(page.locator('[data-prueba="paso-1"]')).toHaveAttribute('data-activo', 'si')
    await page.getByRole('button', { name: 'Siguiente: paso 2' }).click()
    await expect(page.locator('[data-prueba="paso-visible"]')).toHaveText('Paso 2 de 5')
    await expect(page.locator('[data-prueba="paso-2"] [data-prueba="casos"]')).toBeVisible()
    await page.getByRole('button', { name: 'Siguiente: paso 3' }).click()
    await expect(page.locator('[data-prueba="paso-3"] [data-prueba="diferencia"]')).toHaveText('Diferencia0,00 €')
    await expect(page.locator('[data-prueba="mandar"]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Seguir en el paso 4' }).click()
    await expect(page.locator('[data-prueba="paso-visible"]')).toHaveText('Paso 4 de 5')
    await expect(page.locator('[data-prueba="cifra-cegid"]')).toHaveText('181,50 € · 2 facturas')
    // Lo que quedó fuera de lo mandado, arriba en «Pendientes», con su lista.
    await expect(page.locator('[data-prueba="pendientes"]')).toHaveText('Pendientes: 3')
    await foto(page, `noviembre-paso4-${ancho}`)
    await page.locator('[data-prueba="pendientes"]').click()
    const lista = page.locator('[data-prueba="lista-pendientes"] tbody tr')
    await expect(lista).toHaveCount(3)
    await expect(lista.filter({ hasText: 'Sin NIF de Prueba, S.L.' })).toContainText('36,30 €')
    await page.locator('[data-prueba="pendientes"]').click()
    // «No coincide»: lo mandado, cliente a cliente.
    await page.getByRole('button', { name: 'No coincide' }).click()
    await expect(page.getByRole('table', { name: 'Lo mandado a Cegid, cliente a cliente' }).locator('tbody tr')).toHaveCount(2)
    // «Coincide»: lo apunta, con su cifra, y dice que aún no se guarda.
    await page.getByRole('button', { name: 'Coincide: mandar el listado a QBO' }).click()
    await expect(page.locator('[data-prueba="paso-4"] [data-prueba="resultado"]')).toHaveText('✓ 2 facturas, 181,50 €. Listado mandado a QBO.')
    await expect(page.locator('[data-prueba="paso-visible"]')).toHaveText('Paso 5 de 5')
    await expect(page.getByText('Solo con el visto bueno de QBO.')).toBeVisible()
    await foto(page, `noviembre-paso5-${ancho}`)
    // El paso 5: «Hecho» vuelve a leer de Cegid (solo lee) y comprueba que están todas.
    generado.si = true
    await page.getByRole('button', { name: 'Hecho: facturas generadas' }).click()
    await expect(page.locator('[data-prueba="fin"]')).toContainText('Noviembre facturado', { timeout: 30_000 })
    await expect(page.locator('[data-prueba="paso-5"] [data-prueba="resultado"]')).toHaveText('✓ 2 facturas emitidas y comprobadas.')
    await foto(page, `noviembre-fin-${ancho}`)
    // Nada se ha mandado a Cegid: solo se ha leído. El visto bueno se ha guardado, con su total y sus facturas.
    expect(pedidas.filter((p) => !['banco_leer', 'visto_bueno_dar'].includes(String(p.accion)))).toEqual([])
    expect(pedidas.find((p) => p.accion === 'visto_bueno_dar')).toMatchObject({ p_serie: '1', p_total: '181.50', p_facturas: 2, p_mes: `${MES}-01` })
    expect(errores).toEqual([])
  })
}

test('«Facturar el mes» sin mandar: las tarjetas del paso 2, dejar para después, deshacer, y el cuadre a 0,00 € abre «Mandar»', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Facturar el mes, en el ordenador')
  test.setTimeout(150_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  const s = await entrarComo(page, CUENTA_A.email)
  const Q = await empresa(s)
  const { pedidas } = await simular(page, Q, false)
  await page.goto(`/conta/ventas/clientes-y-cuotas/facturar?empresa=${Q}&mes=${MES}`, { timeout: 30_000 })
  await expect(page.locator('[data-prueba="paso-visible"]')).toHaveText('Paso 2 de 5', { timeout: 30_000 })
  const casos = page.locator('[data-prueba="caso"]')
  await expect(casos).toHaveCount(3)
  await expect(casos.filter({ hasText: 'Cliente sin unir a Cegid' }).locator('[data-prueba="propuesta"]')).toContainText('unirlo al cliente 105 de Cegid')
  await expect(casos.filter({ hasText: 'No se sabe quién paga' }).locator('[data-prueba="falta"]')).toContainText('El banco no dice quién lo manda.')
  await expect(casos.filter({ hasText: 'Cliente sin datos' })).toContainText('su ficha no tiene NIF')
  await expect(page.locator('[data-prueba="paso-3"]')).toHaveAttribute('data-falta', 'si')
  await foto(page, 'mes-paso2-1366')
  await page.getByRole('button', { name: 'Dejar los 3 para después y seguir' }).click()
  await expect(page.locator('[data-prueba="pendientes"]')).toHaveText('Pendientes: 3')
  await expect(page.locator('[data-prueba="paso-visible"]')).toHaveText('Paso 3 de 5')
  // «Deshacer» devuelve uno: vuelve el paso 2.
  await page.getByRole('button', { name: /^Ver los 3 casos$/ }).click()
  await casos.filter({ hasText: 'No se sabe quién paga' }).getByRole('button', { name: 'Deshacer' }).click()
  await expect(page.locator('[data-prueba="paso-visible"]')).toHaveText('Paso 2 de 5')
  await expect(page.locator('[data-prueba="pendientes"]')).toHaveText('Pendientes: 2')
  await page.getByRole('button', { name: 'Dejar el 1 para después y seguir' }).click()
  // El cuadre: 478,80 − 181,50 que se manda − 0 − 297,30 en Pendientes = 0,00 €: «Mandar 2 cobros» se abre.
  await expect(page.locator('[data-prueba="paso-visible"]')).toHaveText('Paso 3 de 5')
  await expect(page.locator('[data-prueba="diferencia"]')).toHaveText('Diferencia0,00 €')
  const mandar = page.locator('[data-prueba="mandar"]')
  await expect(mandar).toHaveText('Mandar 2 cobros a Cegid')
  await expect(mandar).toBeEnabled()
  await foto(page, 'mes-paso3-1366')
  expect(pedidas.filter((p) => p.accion === 'mandar')).toEqual([])
  // Lo dejado para después se ha guardado (4 veces: 3 y, tras «Deshacer», 1), y «Deshacer» lo ha apuntado.
  expect(pedidas.filter((p) => p.accion === 'dejar').map((p) => p.p_clave)).toHaveLength(4)
  expect(pedidas.filter((p) => p.accion === 'deshacer_pendiente')).toHaveLength(1)
  expect(errores).toEqual([])
})
