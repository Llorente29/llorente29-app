// V01 · Entrega 3 · Ventas › Liquidaciones: lo que se decide sin React.
// Regla 31: las cifras salen de producción (solo lectura, 24/10, Foodint):
//   · las liquidaciones de Uber del 12 al 18/10, por tienda, sin local
//     (así están hoy, antes de la 2031, que se lo pone por su dirección);
//   · las líneas de los albaranes que pagó CTB en Foodint Carabanchel en
//     octubre, por artículo, contra su «Relación Compras y Ventas».
import { describe, expect, it } from 'vitest'
import {
  asientoDeGasto, cifras, claveGrupo, deClave, diferencias, direccionDe, estado, filtrar, fraseEstado, grupoDeFila, pendientes, periodo, pestanas, type GrupoPlataforma,
} from '@/modules/conta/lib/liquidacionesPlataforma'
import { cruzarConRelacion, nombreNorm, unidadRelacion, type CasadoAMano, type LineaAlbaran, type ProductoRelacion } from '@/modules/conta/lib/socioDelMes'

const UBER = '0e6a2c1e-0000-4000-8000-000000000001'
const ALCALA = '1a1ca1a0-0000-4000-8000-000000000002'

// Las 6 de Uber del 12–18/10 (ventas, comisión, neto, cobrado), tal como están.
const UBER_12_18 = [
  { tienda: 'Milanesa House (Calle de Camichi 4) (Calle de Camichi 4, Madrid, ES, 28025)', ventas: 239.9, comision: 39.55, neto: 66.94, cobrado: 66.94 },
  { tienda: "Mila's Sandwiches (Calle de Florencio Llorente 29, Madrid, ES, 28027)", ventas: 98.2, comision: 37.6, neto: 49.3, cobrado: null },
  { tienda: 'The Urban Kebab (Calle de Florencio Llorente 29, Madrid, ES, 28027)', ventas: 86, comision: 19.01, neto: 29.07, cobrado: null },
  { tienda: 'Milanesa House (Calle de Florencio Llorente 29, Madrid, ES, 28027)', ventas: 416.6, comision: 46.52, neto: 216.92, cobrado: null },
  { tienda: 'Bendito Burrito (Calle de Florencio Llorente 29, Madrid, ES, 28027)', ventas: 199.6, comision: 27.33, neto: 66.78, cobrado: null },
  { tienda: 'Meraki Pita (Calle de Florencio Llorente 29, Madrid, ES, 28027)', ventas: 1614, comision: 153.17, neto: 782.16, cobrado: null },
]

function fila(extra: Record<string, unknown> = {}, ls = UBER_12_18): Record<string, unknown> {
  return {
    canal_id: UBER, canal: 'Uber', local_id: null, local: null, desde: '2026-10-12', hasta: '2026-10-18',
    liquidaciones: ls.map((l, i) => ({ id: `l${i}`, tienda: l.tienda, ref: null, fecha: '2026-10-20', ventas: l.ventas, comision: l.comision, neto: l.neto,
      cobrado: l.cobrado, cobrado_el: l.cobrado ? '2026-10-21' : null, casada_en_banco: !!l.cobrado, referencia: false, por_aclarar: null, a_facturar: null, factura: null, asiento: null })),
    cierres: { total: 0, dias: 0, validados: 0, por_validar: 0 }, cedidas: { total: 0, pedidos: 0 }, sin_confirmar: [], resoluciones: [],
    ...extra,
  }
}

describe('Plataformas · una fila por periodo, plataforma y local', () => {
  const g = grupoDeFila(fila())
  it('suma sus tiendas: ventas 2.654,30, pagan 1.211,17; Otros = Ventas − Comisión − Pagan', () => {
    const c = cifras(g)
    expect([c.ventas, c.comision, c.pagan]).toEqual([2654.3, 323.18, 1211.17])
    expect(c.otros).toBe(1119.95)
    expect(c.banco).toBe(66.94)
    expect(c.porCobrar).toBe(5)
  })
  it('el nombre de la tienda, sin la dirección entre paréntesis', () => {
    expect(g.liquidaciones.map((l) => l.tienda)).toContain('Meraki Pita')
  })
  it('sin local no se compara con los cierres: es una diferencia que dice qué hacer, y no se resuelve como gasto', () => {
    const d = diferencias(g)
    expect(d.map((x) => x.tipo)).toEqual(['local'])
    expect(estado(g)).toBe('diferencia')
    expect(fraseEstado(g)).toMatch(/no es la de ningún local tuyo/)
    expect(d[0].texto).toBe('La dirección de sus tiendas («Calle de Camichi 4», «Calle de Florencio Llorente 29») no es la de ningún local tuyo: sin local no se comparan con tus cierres. Revisa la dirección del local.')
  })
  it('la calle de cada tienda, la de los últimos paréntesis (las 9 tiendas de Uber de Foodint, 24/10)', () => {
    expect(g.liquidaciones.map((l) => l.direccion)).toEqual(['Calle de Camichi 4', 'Calle de Florencio Llorente 29', 'Calle de Florencio Llorente 29', 'Calle de Florencio Llorente 29', 'Calle de Florencio Llorente 29', 'Calle de Florencio Llorente 29'])
    expect(direccionDe('Meraki Pita (Calle de Camichi 4) (Calle de Camichi 4, Madrid, ES, 28025)')).toBe('Calle de Camichi 4')
    expect(direccionDe('Scandal Burgers (Calle de Florencio Llorente 29, Madrid, ES, 28027)')).toBe('Calle de Florencio Llorente 29')
    expect(direccionDe('Glovo sin tienda')).toBeNull()
    expect(direccionDe(null)).toBeNull()
  })
  it('sin tienda ni local (las de junio por CSV): lo dice', () => {
    const sin = grupoDeFila(fila({}, [{ tienda: null as unknown as string, ventas: 10, comision: 3, neto: 7, cobrado: null }]))
    expect(diferencias(sin)[0].texto).toBe('Estas liquidaciones no traen su tienda ni su local: sin local no se comparan con tus cierres.')
  })
  it('la clave va y vuelve (también sin local)', () => {
    expect(deClave(g.clave)).toEqual({ canalId: UBER, localId: null, desde: '2026-10-12', hasta: '2026-10-18' })
    expect(deClave(claveGrupo(UBER, ALCALA, '2026-10-12', '2026-10-18'))?.localId).toBe(ALCALA)
    expect(deClave('cualquier cosa')).toBeNull()
  })
})

describe('Plataformas · el estado, en su orden', () => {
  // Con su local, y los cierres (más las cedidas) igual que lo que liquida.
  const conLocal = (extra: Record<string, unknown> = {}, ls = UBER_12_18) => grupoDeFila(fila({ local_id: ALCALA, local: 'Foodint Alcalá',
    cierres: { total: 2400, dias: 7, validados: 7, por_validar: 0 }, cedidas: { total: 254.3, pedidos: 9 }, ...extra }, ls))
  it('falta cobrar 5 de 6: Por cobrar (nada más falla)', () => {
    const g = conLocal()
    expect(diferencias(g)).toEqual([])
    expect(estado(g)).toBe('por-cobrar')
    expect(fraseEstado(g)).toBe('5 liquidaciones aún no han llegado al banco.')
  })
  it('todo cobrado y al céntimo: Cuadra', () => {
    const g = conLocal({}, UBER_12_18.map((l) => ({ ...l, cobrado: l.neto })))
    expect(estado(g)).toBe('cuadra')
  })
  it('una liquidación con comisión que facturar y sin su factura: Falta su factura (antes que Por cobrar)', () => {
    const f = fila({ local_id: ALCALA, local: 'Foodint Alcalá', cierres: { total: 2400, dias: 7, validados: 7, por_validar: 0 }, cedidas: { total: 254.3, pedidos: 9 } })
    ;(f.liquidaciones as Record<string, unknown>[])[0].a_facturar = 47.86
    expect(estado(grupoDeFila(f))).toBe('falta-factura')
  })
  it('las cedidas cuentan: sin ellas, los cierres se quedan 254,30 por debajo y es una diferencia de ventas', () => {
    const g = conLocal({ cedidas: { total: 0, pedidos: 0 } })
    const d = pendientes(g)
    expect(d.map((x) => [x.tipo, x.importe])).toEqual([['ventas', -254.3]])
    expect(d[0].texto).toBe('La liquidación suma 2.654,30 € y tus cierres 2.400,00 €: liquida 254,30 € de más.')
  })
  it('llega al banco menos de lo que dice: diferencia de cobro; resuelta como gasto, deja de ser pendiente', () => {
    const ls = UBER_12_18.map((l) => ({ ...l, cobrado: l.neto }))
    ls[5] = { ...ls[5], cobrado: 780 }
    const g = conLocal({}, ls)
    expect(pendientes(g).map((x) => [x.tipo, x.importe])).toEqual([['cobro', 2.16]])
    const r = conLocal({ resoluciones: [{ id: 'r', sale_id: null, tipo: 'gasto', importe: 2.16, frase: 'Uber se queda 2,16 por un pedido devuelto', asiento_id: 'e' }] }, ls)
    expect(pendientes(r)).toEqual([])
    expect(estado(r)).toBe('cuadra')
    expect(fraseEstado(r)).toBe('Cuadra, con una diferencia resuelta.')
  })
  it('un cerrado sin confirmar que no cobra (C11b) es una diferencia; reclamado, sigue a la vista resuelto (regla 7)', () => {
    const ls = UBER_12_18.map((l) => ({ ...l, cobrado: l.neto }))
    const g = conLocal({ sin_confirmar: [{ sale_id: 's1', codigo: '8E3F1', dia: '2026-10-14', total: 23.4 }] }, ls)
    expect(pendientes(g).map((x) => [x.tipo, x.saleId, x.importe])).toEqual([['pedido', 's1', 23.4]])
    const r = conLocal({ resoluciones: [{ id: 'r', sale_id: 's1', tipo: 'reclamacion', importe: 23.4, frase: 'Reclamado por el portal', codigo: '8E3F1', dia: '2026-10-14', total: 23.4 }] }, ls)
    expect(diferencias(r).map((x) => [x.tipo, !!x.resuelta])).toEqual([['pedido', true]])
    expect(estado(r)).toBe('cuadra')
  })
  it('las pestañas suman «Todas» y el filtro busca por tienda', () => {
    const gs: GrupoPlataforma[] = [conLocal(), grupoDeFila(fila())]
    const ps = pestanas(gs)
    expect(ps.filter((p) => p.id !== 'todas').reduce((t, p) => t + p.n, 0)).toBe(ps.find((p) => p.id === 'todas')!.n)
    expect(filtrar(gs, 'todas', 'meraki')).toHaveLength(2)
    expect(filtrar(gs, 'diferencia', '')).toHaveLength(1)
  })
})

describe('Plataformas · el asiento de un gasto y el periodo', () => {
  it('629 contra la 430 de la plataforma, por lo que paga de menos; lo que paga de más no es un gasto', () => {
    const ls = asientoDeGasto(2.16, { gasto: '62900000', cliente430: '43000002' }, { localId: ALCALA, terceroId: 'p', concepto: 'Diferencia' })!
    expect(ls.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['62900000', 2.16, 0], ['43000002', 0, 2.16]])
    expect(ls[1].tercero_id).toBe('p')
    expect(asientoDeGasto(-3, { gasto: '62900000', cliente430: '43000002' }, { localId: null, terceroId: null, concepto: 'x' })).toBeNull()
  })
  it('el periodo en palabras', () => {
    expect(periodo('2026-10-12', '2026-10-18')).toBe('12–18/10/2026')
    expect(periodo('2026-09-07', '2026-10-18')).toBe('07/09–18/10/2026')
    expect(periodo('2026-10-20', '2026-10-20')).toBe('20/10/2026')
  })
})

// Las líneas reales de los albaranes de CTB en Foodint Carabanchel, octubre
// (producción, solo lectura, 24/10): por artículo, su unidad base, cuánto y por
// cuánto. La Relación de octubre aún no está subida: la de estas pruebas es la
// que casaría con ellos, tocada producto a producto donde se quiere ver que no casa.
const L = (articulo: string, dimension: 'weight' | 'volume' | 'unit', cantidadBase: number | null, importe: number, producto: string, albaran = 'ALB-C1'): LineaAlbaran =>
  ({ albaran, articulo: `art-${nombreNorm(articulo)}`, articuloNombre: articulo, producto, dimension, cantidadBase, importe })
const LINEAS: LineaAlbaran[] = [
  L('Aceite Alto Oleico', 'volume', 75000, 145.5, 'ACEITE GIRASOL 25 LT'),
  L('Cebolla Morada', 'weight', 25000, 57.83, 'CEBOLLA ROJA'),
  L('Pulled Pork', 'weight', 36000, 433.62, 'PULLED PORK CAJA 3 UD DE 2 KG CONG'),
  L('Bacon Ahumado', 'weight', 9600, 105.32, 'BACON CRISPY 1/2 LONCHAS 70% CAJA 4,8 KG CONG.'),
  L('Milanesa de Pollo Rebozado', 'unit', 340, 851.94, 'MILANESA POLLO CJ 5 KG CONG'),
  L('Sweet Potato Fries', 'weight', 10000, 48.21, 'BONIATO BASTON CAJA 5 BOLSAS DE 2 KG CONG', 'ALB-C1'),
  L('Sweet Potato Fries', 'weight', null, 48.21, 'BONIATO BASTON CAJA 5 BOLSAS DE 2 KG CONG', 'ALB-C2'),
  L('Tomate Pera', 'weight', 20000, 73.04, 'TOMATE BOC EXTRA'),
  L('Tortilla Trigo 30 cm', 'unit', 432, 99.04, 'TORTILLA TRIGO 30 CM CAJA 6 PAQ DE 18 UD'),
]
const REL = (nombre: string, compras: number, precio: number, unidad: string): ProductoRelacion => ({ nombre, compras, precio, unidad })

describe('Socio de marca · los albaranes del mes contra su «Relación Compras y Ventas» (Julio, 24/10, opción A)', () => {
  const relacion = [
    REL('Aceite Alto Oleico', 75, 1.94, 'Lt'), // 145,50 / 75 = 1,94: coincide
    REL('CEBOLLA ROJA', 25, 2.31, 'Kg'), // por el nombre del producto en el albarán: 57,83 / 25 = 2,3132
    REL('Pulled Pork', 30, 12.05, 'Kg'), // los albaranes traen 36 Kg
    REL('Bacon Ahumado', 9.6, 11.5, 'Kg'), // 105,32 / 9,6 = 10,97
    REL('Milanesa de Pollo Rebozado', 68, 12.53, 'Kg'), // el artículo cuenta unidades
    REL('Sweet Potato Fries', 20, 4.82, 'Kg'), // una línea sin cantidad
    REL('Tortilla Trigo 30 cm', 432, 0.23, 'Uni'), // 99,04 / 432 = 0,2293
    REL('Salsa Brava', 3, 5.1, 'Kg'), // ningún artículo se llama así
    REL('Queso de Prueba', 4, 7, 'Kg'), // casado a mano con un artículo que no ha llegado este mes
    REL('Servilletas', 2, 1, 'Uni'), // marcado como que no es nuestro
    REL('Sal Fina', 0, 0.4, 'Kg'), // solo consumo: no es una compra del mes
  ]
  const casados: CasadoAMano[] = [
    { nombre: 'Queso de Prueba', articulo: 'art-quesogouda', noEsNuestro: false },
    { nombre: 'Servilletas', articulo: null, noEsNuestro: true },
  ]
  const c = cruzarConRelacion(relacion, casados, LINEAS)
  const de = (n: string) => c.filas.find((f) => f.nombre === n)!

  it('coincide en cantidad y en precio, también casado por el nombre del producto en el albarán', () => {
    expect(de('Aceite Alto Oleico').estado).toBe('coincide')
    expect(de('Aceite Alto Oleico').albaranes).toMatchObject({ cantidad: 75, precio: 1.94, importe: 145.5 })
    expect(de('CEBOLLA ROJA').estado).toBe('coincide')
    expect(de('Tortilla Trigo 30 cm').estado).toBe('coincide')
  })
  it('la cantidad no casa: lo dice con su diferencia', () => {
    expect(de('Pulled Pork').estado).toBe('cantidad')
    expect(de('Pulled Pork').difCantidad).toBe(6)
    expect(de('Pulled Pork').texto).toBe('No casa en cantidad: los albaranes traen 36 Kg y la Relación 30 (+6).')
  })
  it('el precio no casa: lo dice con su diferencia', () => {
    expect(de('Bacon Ahumado').estado).toBe('precio')
    expect(de('Bacon Ahumado').difPrecio).toBe(-0.53)
    expect(de('Bacon Ahumado').texto).toBe('No casa en precio: 10,97 €/Kg en los albaranes y 11,50 €/Kg en la Relación (-0,53 €).')
  })
  it('lo que no se puede comparar, dice por qué: otra unidad, una línea sin cantidad', () => {
    expect(de('Milanesa de Pollo Rebozado').estado).toBe('unidad-distinta')
    expect(de('Milanesa de Pollo Rebozado').texto).toContain('La Relación lo cuenta en Kg y el artículo «Milanesa de Pollo Rebozado» en Uni')
    expect(de('Sweet Potato Fries').estado).toBe('incompleto')
    expect(de('Sweet Potato Fries').texto).toBe('Una línea de sus albaranes no dice la cantidad: no se puede comparar. Complétala en el albarán.')
  })
  it('lo que falta y lo que sobra', () => {
    expect(de('Salsa Brava').estado).toBe('sin-casar')
    expect(de('Queso de Prueba').estado).toBe('sin-albaran')
    expect(de('Queso de Prueba').texto).toBe('La Relación dice 4 Kg comprados y ningún albarán del mes lo trae.')
    expect(de('Tomate Pera').estado).toBe('sobra')
    expect(de('Tomate Pera').texto).toBe('Los albaranes traen 20 Kg (73,04 €) y la Relación no lo compra (TOMATE BOC EXTRA).')
  })
  it('lo que no es nuestro sale, pero no cuenta; lo que solo se consume no es una compra del mes', () => {
    expect(de('Servilletas').estado).toBe('no-es-nuestro')
    expect(c.filas.some((f) => f.nombre === 'Sal Fina')).toBe(false)
  })
  it('el resumen: algo está mal, cuántos no casan; y lo que no casa, primero', () => {
    expect(c.estado).toBe('no-coincide')
    expect([c.coinciden, c.noCasan]).toEqual([3, 7])
    expect(c.texto).toBe('Algo está mal: 7 productos no casan entre los albaranes del mes y la Relación Compras y Ventas (3 sí).')
    expect(c.filas.map((f) => f.estado).indexOf('coincide')).toBeGreaterThan(c.filas.map((f) => f.estado).lastIndexOf('incompleto'))
  })
  it('si todo casa, lo dice', () => {
    const r = cruzarConRelacion([REL('Aceite Alto Oleico', 75, 1.94, 'Lt')], [], LINEAS.slice(0, 1))
    expect(r.estado).toBe('coincide')
    expect(r.texto).toBe('Los albaranes del mes coinciden con la Relación Compras y Ventas: 1 producto, en cantidad y en precio.')
  })
  it('sin la Relación todavía, no compara y lo dice', () => {
    const r = cruzarConRelacion(null, [], LINEAS)
    expect(r.estado).toBe('sin-relacion')
    expect(r.texto).toBe('Aún no está su «Relación Compras y Ventas»: sin ella no se pueden comparar los albaranes (9 líneas en 2 albaranes).')
  })
  it('albaranes sin líneas (como los de la semilla de staging): lo de la Relación sale, y no casa', () => {
    const r = cruzarConRelacion([REL('Patata Prueba kg', 100, 1, 'kg'), REL('Aceite Prueba lt', 50, 7, 'lt'), REL('Salsa Prueba Rara', 0, 2, 'ud')], [], [])
    expect(r.estado).toBe('sin-albaranes')
    expect(r.filas.map((f) => [f.nombre, f.estado])).toEqual([['Aceite Prueba lt', 'sin-casar'], ['Patata Prueba kg', 'sin-casar']])
    expect(r.texto).toBe('Ningún albarán del mes trae líneas de producto, y la Relación dice que compraste 2 productos: no casan.')
  })
  it('las unidades de la Relación', () => {
    expect(unidadRelacion('Kg')).toEqual({ dimension: 'weight', factor: 1000 })
    expect(unidadRelacion('Lt')).toEqual({ dimension: 'volume', factor: 1000 })
    expect(unidadRelacion('Uni')).toEqual({ dimension: 'unit', factor: 1 })
  })
})
