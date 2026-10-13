// C04b · R14 · El «Resumen de ventas»: sin cuadrar con su factura, no hay PDF.
// Importes INVENTADOS.
import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'
import { comprobarResumen, resumenVentasPdf, type DatosResumenVentas } from '../../../supabase/functions/_shared/resumenVentasPdf'

const datos = (): DatosResumenVentas => ({
  empresa: { nombre: 'Empresa de Prueba, S.L.', nif: 'B00000000' }, local: 'Local Centro', plataforma: 'Uber Eats', fecha: '2026-10-01',
  numeroFactura: 'UBR-CEN-20261001', generado: new Date('2026-10-13T09:42:00Z'), tipoIva: 10,
  pedidos: [{ hora: '13:05', codigo: 'A1', marca: 'Marca Uno', base: 20, cuota: 2, total: 22 }, { hora: '21:10', codigo: 'A2', marca: 'Marca Dos', base: 10, cuota: 1, total: 11 }],
  reembolsos: [{ hora: '22:00', codigo: 'A3', marca: 'Marca Dos', base: 5, cuota: 0.5, total: 5.5 }],
  lineasFactura: [{ marca: 'Marca Uno', cuenta: '70000001', importe: 20 }, { marca: 'Marca Dos', cuenta: '70000002', importe: 10 }, { marca: 'Marca Dos', cuenta: '70800002', importe: -5 }],
  factura: { base: 25, cuota: 2.5, total: 27.5 }, cobro: 27.5,
})

describe('resumenVentasPdf (R14)', () => {
  it('cuadra: genera un PDF', () => {
    expect(comprobarResumen(datos())).toEqual([])
    const pdf = resumenVentasPdf(jsPDF, datos())
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-')
  })
  it('una marca cuyos pedidos no suman su línea de la factura: no hay PDF, y dice cuál', () => {
    const d = datos(); d.lineasFactura[0].importe = 19.99
    expect(comprobarResumen(d)).toEqual(expect.arrayContaining([expect.stringContaining('la marca Marca Uno')]))
    expect(() => resumenVentasPdf(jsPDF, d)).toThrow(/no cuadra con su factura/)
  })
  it('el total del día distinto del cobro de la plataforma o de la factura: no hay PDF', () => {
    expect(comprobarResumen({ ...datos(), cobro: 27.49 })).toEqual([expect.stringContaining('lo que cobra la plataforma')])
    expect(comprobarResumen({ ...datos(), factura: { base: 25, cuota: 2.5, total: 27.51 } })).toEqual([expect.stringContaining('el total del día')])
  })
  it('un pedido cuya base más IVA no es su total: no hay PDF', () => {
    const d = datos(); d.pedidos[0].cuota = 2.01; d.factura.cuota = 2.51; d.factura.total = 27.51; d.cobro = 27.51; d.pedidos[0].total = 22
    expect(comprobarResumen(d)).toEqual(expect.arrayContaining([expect.stringContaining('el pedido A1')]))
  })
})
