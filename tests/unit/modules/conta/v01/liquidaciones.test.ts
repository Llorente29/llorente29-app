// V01 · Entrega 3 · Ventas › Liquidaciones: lo que se decide sin React.
// Regla 31: las cifras salen de producción (solo lectura, 24/10, Foodint):
//   · las liquidaciones de Uber del 12 al 18/10, por tienda, sin local
//     asignado (así están hoy: las tiendas no tienen su local en Sus tiendas);
//   · los 20 albaranes que pagó CTB en Foodint Alcalá en octubre (hasta el 22),
//     10.289,89 € de base, y la FV de septiembre de Alcalá, 3.587,15 €
//     (Mercaderías en Stock a 4, 10 y 21 %).
import { describe, expect, it } from 'vitest'
import {
  asientoDeGasto, cifras, claveGrupo, deClave, diferencias, estado, filtrar, fraseEstado, grupoDeFila, pendientes, periodo, pestanas, type GrupoPlataforma,
} from '@/modules/conta/lib/liquidacionesPlataforma'
import { baseFv, contrastarFv, formasDeSumar, type AlbaranDelMes } from '@/modules/conta/lib/socioDelMes'

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
    expect(fraseEstado(g)).toMatch(/asigna su local a cada tienda/)
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

// Los 20 albaranes de CTB en Alcalá, octubre (hasta el 22): sus bases reales.
const BASES = [575.6, 114.79, 1488.18, 117.27, 69.06, 48.21, 437.05, 1417.88, 481.89, 801.66, 394.28, 94.31, 1046.07, 11.95, 281.26, 706.18, 1402.15, 561.8, 145.45, 94.85]
const ALBARANES: AlbaranDelMes[] = BASES.map((b, i) => ({ id: `a${i}`, codigo: `ALB-${String(185 + i).padStart(5, '0')}`, fecha: `2026-10-${String(1 + i).padStart(2, '0')}`, base: b }))

describe('Socio de marca · su FV contra los albaranes del mes (Julio, 24/10)', () => {
  it('los 20 albaranes suman 10.289,89 (lo medido)', () => {
    expect(contrastarFv(10289.89, ALBARANES).estado).toBe('coincide')
  })
  it('la base de la FV es la suma de sus líneas: la de septiembre de Alcalá, 3.587,15', () => {
    expect(baseFv({ lineas: [{ base: 777.69 }, { base: 2003.91 }, { base: 805.55 }] })).toBe(3587.15)
    expect(baseFv(null)).toBeNull()
  })
  it('con la FV real de un mes (3.587,15) contra 10.289,89 de albaranes: no coincide, sobran 6.702,74, y lo dice', () => {
    const c = contrastarFv(3587.15, ALBARANES)
    expect(c.estado).toBe('diferencia')
    expect(c.diferencia).toBe(-6702.74)
    expect(c.texto).toMatch(/^No coincide: su factura \(FV\) es de 3\.587,15 € de base y los 20 albaranes suman 10\.289,89 €: sobran 6\.702,74 €\./)
  })
  it('si sobra justo un albarán, lo señala (y solo si es el único que lo explica)', () => {
    const c = contrastarFv(10289.89 - 1046.07, ALBARANES)
    expect(c.sobran.map((f) => f.map((a) => a.codigo))).toEqual([['ALB-00197']])
    expect(c.texto).toContain('Sobra el ALB-00197 del 13/10 (1.046,07 €)')
  })
  it('si hay varias formas de explicarlo, las dice todas y no elige', () => {
    // 94,31 + 94,85 = 189,16; y no hay otro par ni trío que lo sume.
    const c = contrastarFv(10289.89 - 189.16, ALBARANES)
    expect(c.sobran.length).toBeGreaterThanOrEqual(1)
    expect(formasDeSumar(ALBARANES, 18916).every((f) => Math.round(f.reduce((t, a) => t + a.base! * 100, 0)) === 18916)).toBe(true)
  })
  it('si la FV trae más: faltan albaranes, cuánto', () => {
    const c = contrastarFv(10300, ALBARANES)
    expect(c.texto).toContain('Faltan albaranes por 10,11 €')
  })
  it('un albarán sin importe no suma y se dice, aunque el total coincida', () => {
    const c = contrastarFv(10289.89, [...ALBARANES, { id: 'x', codigo: 'ALB-00230', fecha: '2026-10-23', base: null }])
    expect(c.estado).toBe('diferencia')
    expect(c.texto).toContain('Un albarán no tiene importe y no suma: ALB-00230.')
  })
  it('sin su FV todavía, dice lo que suman los albaranes', () => {
    expect(contrastarFv(null, ALBARANES).texto).toBe('Aún no ha llegado su factura del mes (FV): los albaranes suman 10.289,89 €.')
  })
})
