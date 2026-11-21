// R15b · El día del TPV en el libro de IVA: por serie, cada factura con NIF y cada devolución (R5). Lo que dice la
// pantalla y cómo entra en «Facturas emitidas», sin pantalla (lib/diaTpv.ts y lib/facturasVenta.ts). Datos inventados.
import { describe, expect, it } from 'vitest'
import { claseFilaLibro, ordenarLibro, textoFilaLibro, type FilaLibroDia } from '../../../../../src/modules/conta/lib/diaTpv'
import { conDiasTpv, conLibroTpv, rangoLibro, totalDelFiltro, type FacturaVenta, type FilaLibroTpv } from '../../../../../src/modules/conta/lib/facturasVenta'

const fila = (x: Partial<FilaLibroDia> & Pick<FilaLibroDia, 'tipo_factura'>): FilaLibroDia =>
  ({ serie: null, numero: null, hasta: null, documentos: 1, nif: null, nombre: null, tipo: 10, base: 0, cuota: 0, total: 0, ...x })

// El día del ejemplo con dos series (como la prueba de staging): Facturas 5001–5030 y Barra 5031–5048, con dos
// facturas con NIF (5007 y 5020) y una devolución (5047). Las cifras salen de sumar sus documentos.
const DIA: FilaLibroDia[] = [
  fila({ tipo_factura: 'R5', serie: 'Barra', numero: '5047', base: -10, cuota: -1, total: -11 }),
  fila({ tipo_factura: 'F1', serie: 'Facturas', numero: '5020', nif: '00000000T', nombre: 'Cliente de ejemplo 20', base: 15.57, cuota: 1.56, total: 17.13 }),
  fila({ tipo_factura: 'F4', serie: 'Facturas', numero: '5001', hasta: '5030', documentos: 28, base: 612.32, cuota: 61.23, total: 673.55 }),
  fila({ tipo_factura: 'F1', serie: 'Facturas', numero: '5007', nif: '00000000T', nombre: 'Cliente de ejemplo 7', base: 36.44, cuota: 3.64, total: 40.08 }),
  fila({ tipo_factura: 'F4', serie: 'Barra', numero: '5031', hasta: '5048', documentos: 17, base: 345.66, cuota: 34.58, total: 380.24 }),
]

describe('lo que dice cada fila del libro de un día', () => {
  it('una serie, con su primer y su último ticket y su nombre', () => {
    expect(textoFilaLibro(fila({ tipo_factura: 'F4', serie: 'Barra', numero: '5097', hasta: '5144' }))).toBe('Tickets 5097 a 5144 · Barra')
    expect(textoFilaLibro(fila({ tipo_factura: 'F2', numero: '5097' }))).toBe('Ticket 5097')
  })
  it('la factura con NIF, con su número y su cliente, fuera del rango', () => {
    expect(textoFilaLibro(DIA[1])).toBe('Factura 5020 · Cliente de ejemplo 20')
    expect(claseFilaLibro(DIA[1])).toBe('nif')
  })
  it('la devolución, como R5, con su número', () => {
    expect(textoFilaLibro(DIA[0])).toBe('Devolución 5047')
    expect(claseFilaLibro(DIA[0])).toBe('r5')
  })
  it('un día con dos series: primero las series (por su primer número), luego las facturas con NIF y al final las devoluciones', () => {
    expect(ordenarLibro(DIA).map(textoFilaLibro)).toEqual([
      'Tickets 5001 a 5030 · Facturas', 'Tickets 5031 a 5048 · Barra',
      'Factura 5007 · Cliente de ejemplo 7', 'Factura 5020 · Cliente de ejemplo 20', 'Devolución 5047',
    ])
  })
  it('regla 31: las filas suman lo que el día (999,99 de base y 100,01 de IVA, 1.100,00 €)', () => {
    const c = (x: number) => Math.round(x * 100)
    expect([DIA.reduce((t, f) => t + c(f.base), 0), DIA.reduce((t, f) => t + c(f.cuota), 0), DIA.reduce((t, f) => t + c(f.total), 0)]).toEqual([99999, 10001, 110000])
  })
})

describe('los días del TPV en «Facturas emitidas», como van en el libro', () => {
  const a = (x: Partial<FilaLibroTpv> & Pick<FilaLibroTpv, 'clase' | 'tipo_factura' | 'total'>): FilaLibroTpv => ({
    dia_id: 'd1', dia: '2026-11-09', programa_nombre: 'Revo', serie: null, numero: null, hasta: null, documentos: 1, nif: null, nombre: null,
    base: x.total, cuota: 0, asiento_id: 'e1', pdf: null, ...x,
  })
  const filas: FilaLibroTpv[] = [
    a({ clase: 'serie', tipo_factura: 'F4', serie: 'Barra', numero: '5031', hasta: '5048', documentos: 17, total: 380.24, nombre: 'VENTAS A CONSUMIDOR FINAL', pdf: 'cuenta/e1/x.pdf' }),
    a({ clase: 'serie', tipo_factura: 'F4', serie: 'Facturas', numero: '5001', hasta: '5030', documentos: 28, total: 673.55, nombre: 'VENTAS A CONSUMIDOR FINAL', pdf: 'cuenta/e1/x.pdf' }),
    a({ clase: 'nif', tipo_factura: 'F1', serie: 'Facturas', numero: '5007', nif: '00000000T', nombre: 'Cliente de ejemplo 7', total: 40.08 }),
    a({ clase: 'nif', tipo_factura: 'F1', serie: 'Facturas', numero: '5020', nif: '00000000T', nombre: 'Cliente de ejemplo 20', total: 17.13 }),
    a({ clase: 'r5', tipo_factura: 'R5', serie: 'Barra', numero: '5047', total: -11 }),
  ]
  const libroDeAntes = { id: 'libro:1', fuente: 'libro' as const, entryId: 'e1', numero: '5001', serie: null, fecha: '2026-11-09', vence: null,
    cliente: 'VENTAS A CONSUMIDOR FINAL', nif: null, origen: 'a_mano' as const, base: 999.99, iva: 100.01, total: 1100, cobrado: 0,
    guardado: 'emitida' as const, enviada: false, rectificativa: false, localId: null, estadoCobro: null }
  const xs = conLibroTpv([libroDeAntes], filas)

  it('cada serie en su fila con su rango y su PDF; la de antes (una por tipo) sale', () => {
    expect(xs.map((x) => [x.numero, x.cliente, x.tpv?.clase, x.tpv?.serie])).toEqual([
      ['5031 a 5048', 'Día del TPV · Revo', 'dia', 'Barra'],
      ['5001 a 5030', 'Día del TPV · Revo', 'dia', 'Facturas'],
      ['5007', 'Cliente de ejemplo 7', 'nif', 'Facturas'],
      ['5020', 'Cliente de ejemplo 20', 'nif', 'Facturas'],
      ['5047', 'Devolución del TPV', 'r5', 'Barra'],
    ])
    expect(xs[0].tpv?.pdf).toBe('cuenta/e1/x.pdf')
  })
  it('la factura con NIF lleva el NIF de su cliente; la devolución es rectificativa', () => {
    expect(xs[2].nif).toBe('00000000T')
    expect(xs.filter((x) => x.rectificativa).map((x) => x.numero)).toEqual(['5047'])
  })
  it('las filas de un día suman lo que el día: nada va «dentro», nada se cuenta dos veces', () => {
    expect(totalDelFiltro(xs.map((x) => ({ ...x, diez: null }) as FacturaVenta))).toBe(1100)
  })
  it('lo del R15 (antes del libro por serie) sigue sin contar dos veces la factura con NIF', () => {
    const r15 = conDiasTpv([], [
      { clase: 'dia', dia_id: 'd1', dia: '2026-11-09', programa_nombre: 'Revo', primero: 5001, ultimo: 5048, facturas: 48, base: 999.99, cuota: 100.01, total: 1100, asiento_id: 'e1', pdf: null },
      { clase: 'nif', dia_id: 'd1', dia: '2026-11-09', numero: '5007', contador: 'Facturas', nif: '00000000T', cliente: 'Cliente de ejemplo 7', base: 36.44, cuota: 3.64, total: 40.08, asiento_id: 'e1' },
    ])
    expect(totalDelFiltro(r15.map((x) => ({ ...x, diez: null }) as FacturaVenta))).toBe(1100)
  })
  it('el rango: «5097 a 5144», o el número solo', () => {
    expect([rangoLibro('5097', '5144'), rangoLibro('5097', null), rangoLibro('5097', '5097'), rangoLibro(null, null)]).toEqual(['5097 a 5144', '5097', '5097', null])
  })
})
