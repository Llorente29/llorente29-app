// tests/unit/modules/conta/s02/iva-redondeo.test.ts
//
// S01p·16 · El IVA redondeado línea a línea (Uber) y las celdas que calculan.
// Los números son los de la F1-2081547 de Portier Eats Spain: 3 líneas al 21 %
// (17,22 → 3,62; 103,02 → 21,64; 73,45 → 15,43), IVA 40,69, base × 21 % = 40,67.

import { describe, expect, it } from 'vitest'
import { cuotaDeLaFactura, desdeElTotal, rehacerRetencion, textoRedondeo, toleranciaCuota, totalesDe, type LineaIva } from '@/modules/conta/documentos/fichaRecibida'
import { comprobacionesConRedondeo } from '@/modules/conta/documentos/RevisarFacturaPage.textos'
import { motivoImportes } from '@/modules/conta/documentos/veredicto'

const LINEAS_UBER = [{ iva: 21 }, { iva: 21 }, { iva: 21 }]
const UBER: LineaIva = { base: '193,69', tipo: '21', cuota: '40,69' }

describe('el redondeo de la cuota (la misma regla que validar)', () => {
  it('0,01 € por línea de la factura con ese tipo; 0,02 € si no se sabe', () => {
    expect(toleranciaCuota(LINEAS_UBER, 21)).toBe(3)
    expect(toleranciaCuota([{ iva: 21 }, { iva: 10 }], 21)).toBe(1)
    expect(toleranciaCuota([], 21)).toBe(2)
    expect(toleranciaCuota(null, 21)).toBe(2)
  })
  it('la de Uber: 0,02 € con 3 líneas es redondeo; con 1 línea, no', () => {
    expect(cuotaDeLaFactura(UBER, toleranciaCuota(LINEAS_UBER, 21))).toEqual({ calculada: 40.67, diferencia: 0.02, redondeo: true })
    expect(cuotaDeLaFactura(UBER, toleranciaCuota([{ iva: 21 }], 21))?.redondeo).toBe(false)
    expect(cuotaDeLaFactura({ ...UBER, cuota: '40,71' }, toleranciaCuota(LINEAS_UBER, 21))?.redondeo).toBe(false)
    expect(cuotaDeLaFactura({ ...UBER, cuota: '40,67' }, 3)).toBeNull()
  })
  it('el texto, en palabras', () => {
    expect(textoRedondeo('Uber', 0.02)).toMatch(/^Redondeo de Uber: 0,02\s€, se apunta lo que dice la factura$/)
  })
  it('la comprobación del lector con céntimos de redondeo pasa a redondeo; con más, se queda', () => {
    const com = [{ id: 'cuota_21', ok: false, texto: 'El IVA al 21 % debería ser 40,67 € sobre 193,69 € y la factura dice 40,69 €.' }]
    const r = comprobacionesConRedondeo(com, [UBER], LINEAS_UBER, 'Uber')
    expect(r[0].ok).toBe(true)
    expect(r[0].redondeo).toBe(true)
    expect(r[0].texto).toMatch(/^Redondeo de Uber: 0,02\s€, se apunta lo que dice la factura\.$/)
    expect(motivoImportes(r)).toEqual({ tono: 'normal', motivo: r[0].texto })
    const una = comprobacionesConRedondeo(com, [UBER], [{ iva: 21 }], 'Uber')
    expect(una[0].ok).toBe(false)
  })
})

describe('las celdas calculan', () => {
  it('el total hacia atrás: base = total ÷ (1 + tipo), y de ella la cuota', () => {
    const r = desdeElTotal({ iva: [{ base: '', tipo: '21', cuota: '' }], retencion: null, recargo: null }, 234.38)
    expect(r?.iva[0]).toEqual({ base: '193,70', tipo: '21', cuota: '40,68' })
    expect(totalesDe({ iva: r!.iva, retencion: r!.retencion, recargo: null }).total).toBe(234.38)
  })
  it('con retención, se quita: base = total ÷ (1 + tipo − retención)', () => {
    const r = desdeElTotal({ iva: [{ base: '', tipo: '21', cuota: '' }], retencion: { tipo: '15', importe: '' }, recargo: null }, 127.66)
    expect(r?.iva[0].base).toBe('120,43')
    expect(r?.retencion).toEqual({ tipo: '15', importe: '18,06' })
    expect(totalesDe({ iva: r!.iva, retencion: r!.retencion, recargo: null }).total).toBe(127.66)
  })
  it('con varios tipos de IVA no se adivina el reparto', () => {
    expect(desdeElTotal({ iva: [{ base: '', tipo: '21', cuota: '' }, { base: '', tipo: '10', cuota: '' }], retencion: null, recargo: null }, 100)).toBeNull()
  })
  it('la retención con tipo se rehace sobre la base nueva; sin tipo, se deja', () => {
    expect(rehacerRetencion({ tipo: '19', importe: '1,00' }, 716)).toEqual({ tipo: '19', importe: '136,04' })
    expect(rehacerRetencion({ tipo: '', importe: '5,00' }, 716)).toEqual({ tipo: '', importe: '5,00' })
  })
})
