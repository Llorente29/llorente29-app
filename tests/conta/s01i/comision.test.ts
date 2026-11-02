// tests/conta/s01i/comision.test.ts
//
// S01i · Lo que la ficha de una factura de comisión dice de su liquidación, y
// la lista de liquidaciones con sus facturas. Lo que elige la liquidación y el
// local lo prueba la base (supabase/staging/sql/20261101_s01i_comisiones_prueba.sql,
// pasos 1 a 6b); aquí, cómo se cuenta. Todo inventado (T11).
import { describe, expect, it } from 'vitest'
import { chipComision, cuadreLiquidacion, estadoComision, estadoPagoComision, lineaCandidata, tituloComision } from '@/modules/conta/documentos/comision'
import { estadoPlataforma, type LiquidacionPlataforma } from '@/modules/conta/compras/liquidaciones'
import { leerFactura } from '../../../supabase/functions/_shared/lecturaFactura'

const ligada = {
  estado: 'ligada', plataforma: 'Plataforma de Prueba',
  liq: { id: 'l1', desde: '2026-10-12', hasta: '2026-10-18', tienda: 'Marca Uno', marca: 'Marca Uno', local: 'Local Norte', a_facturar: 53.79, te_pago: 66.78, fecha: '2026-10-20',
    facturas: [{ id: 'f1', codigo: 'FAC-00001', numero: 'PRUEBA-1', total: 53.79 }] },
}

describe('S01i · la ficha de la factura de comisión', () => {
  it('ligada y pagada: el chip dice con qué liquidación se compensó, y «Estado» que no se paga por banco', () => {
    const e = estadoComision(ligada)
    expect(e.estado).toBe('ligada')
    expect(chipComision(e, true)).toBe('Pagada · compensada con la liquidación del 20/10')
    expect(chipComision(e, false)).toBeNull()
    expect(estadoPagoComision(e, true)).toBe('Compensada con la liquidación del 20/10/2026, no se paga por banco.')
    expect(estadoPagoComision(e, false)).toMatch(/al validarla: no se paga por banco/)
    expect(tituloComision(e)).toEqual({ titulo: 'Liquidación de Plataforma de Prueba del 12/10 al 18/10/2026', tono: 'ok' })
  })
  it('varias facturas en una liquidación: la suma contra lo que factura, y la diferencia se ve (regla 7)', () => {
    const e = estadoComision({ ...ligada, liq: { ...ligada.liq, facturas: [{ id: 'a', total: 40 }, { id: 'b', total: 13.78 }] } })
    if (e.estado !== 'ligada') throw new Error('no ligada')
    expect(cuadreLiquidacion(e.liq)).toEqual({ suma: 53.78, diferencia: -0.01, texto: 'Sus 2 facturas de comisión suman 53,78 € y la liquidación factura 53,79 €: diferencia de −0,01 €.' })
    expect(cuadreLiquidacion({ ...e.liq, facturas: [{ id: 'a', codigo: null, numero: null, total: 53.79 }] }).diferencia).toBe(0)
  })
  it('sin ligar: el porqué, las candidatas y la sugerida solo si coincide una al céntimo', () => {
    const c = (id: string, coincide: boolean) => ({ id, desde: '2026-10-12', hasta: '2026-10-18', tienda: 'Marca Dos (Calle Inventada 12)', marca: 'Marca Dos', local: null, a_facturar: 82.72, ya_facturado: 0, te_pago: 1, coincide })
    const dos = estadoComision({ estado: 'varias', plataforma: 'P', porque: 'Hay 2 liquidaciones…', candidatas: [c('x', false), c('y', false)] })
    expect(dos.estado === 'varias' && dos.sugerida).toBe(null)
    expect(tituloComision(dos)).toEqual({ titulo: 'No sé con qué liquidación va', tono: 'duda' })
    const una = estadoComision({ estado: 'varias', plataforma: 'P', porque: '…', candidatas: [c('x', true), c('y', false)] })
    expect(una.estado === 'varias' && una.sugerida).toBe('x')
    expect(lineaCandidata((una as { candidatas: ReturnType<typeof c>[] }).candidatas[0] as never)).toBe('Marca Dos · del 12/10 al 18/10 · factura 82,72 €')
    const falta = estadoComision({ estado: 'falta', plataforma: 'P', porque: 'Falta la liquidación…', candidatas: [] })
    expect(tituloComision(falta).titulo).toBe('Falta la liquidación')
    expect(estadoPagoComision(falta, false)).toMatch(/cuando esté ligada: no se paga por banco/)
  })
  it('de antes de la primera liquidación de su plataforma: compensada fuera de Sumied', () => {
    const e = estadoComision({ estado: 'fuera', plataforma: 'P', porque: 'Es de antes…' })
    expect(chipComision(e, true)).toBe('Pagada · compensada fuera de Sumied')
    expect(estadoPagoComision(e, true)).toBe('Compensada fuera de Sumied, no se paga por banco.')
  })
  it('una factura que no es de una plataforma no lleva nada', () => {
    const e = estadoComision({ estado: 'no' })
    expect(chipComision(e, true)).toBeNull()
    expect(estadoPagoComision(e, true)).toBeUndefined()
  })
})

describe('S01i · la liquidación y sus facturas de comisión', () => {
  const l = (o: Partial<LiquidacionPlataforma>): LiquidacionPlataforma => ({
    id: 'x', canal: 'Plataforma', tienda: 'Marca', desde: '2026-10-12', hasta: '2026-10-18', ventas: 100, comision: 40, neto: 60,
    cobrado: null, aFacturar: 53.79, facturas: [], deReferencia: false, porAclarar: null, ...o,
  })
  it('sin factura: «Falta la factura de comisión»; con las suyas, «recibida» y la diferencia si no cuadra', () => {
    expect(estadoPlataforma(l({})).texto).toBe('Falta la factura de comisión')
    const bien = estadoPlataforma(l({ facturas: [{ id: 'a', numero: 'P-1', total: 53.79 }] }))
    expect(bien).toMatchObject({ texto: 'Factura de comisión · recibida', tono: 'seguro' })
    const mal = estadoPlataforma(l({ facturas: [{ id: 'a', numero: 'P-1', total: 40 }, { id: 'b', numero: 'P-2', total: 13 }] }))
    expect(mal).toMatchObject({ texto: 'Factura de comisión · recibida', tono: 'duda' })
    expect(mal.detalle).toBe('Sus 2 facturas de comisión (P-1, P-2): 53,00 €; la liquidación factura 53,79 €: diferencia de −0,79 €.')
  })
})

describe('S01i · el lector saca la tienda y el periodo', () => {
  it('con tienda y periodo en el papel, van en la lectura; sin ellos, null', () => {
    const base = { document: { supplier_name: 'Plataforma de Prueba', doc_number: 'P-1', doc_date: '2026-10-20', grand_total: 12.1 } }
    const con = leerFactura({ ...base, factura: { store_name: 'Marca Uno', store_address: 'Calle Inventada 12, Madrid', period_from: '2026-10-12', period_to: '2026-10-18' } } as never, { hoy: '2026-11-01' })
    expect(con.factura.tienda).toEqual({ nombre: 'Marca Uno', direccion: 'Calle Inventada 12, Madrid' })
    expect(con.factura.periodo).toEqual({ desde: '2026-10-12', hasta: '2026-10-18' })
    const sin = leerFactura({ ...base, factura: {} } as never, { hoy: '2026-11-01' })
    expect(sin.factura.tienda).toBeNull()
    expect(sin.factura.periodo).toBeNull()
  })
})
