// S01h · La lectura de un abono de proveedor. Las cifras son las del abono
// 1506416 del 13/10 (−175,46 €: 10 % sobre 134,38 y 4 % sobre 26,58) tal
// como las devolvió el modelo: las bases en negativo y las cuotas en positivo.
// El proveedor y su NIF son inventados: el repositorio es público.
import { describe, expect, it } from 'vitest'
import { leerFactura, type LecturaModelo } from '../../../supabase/functions/_shared/lecturaFactura'

const HOY = '2026-10-31'
const abono = (o: Partial<LecturaModelo> = {}): LecturaModelo => ({
  document: { supplier_name: 'Panadería Inventada, S.A.', supplier_tax_id: 'A00000001', doc_number: '1506416', doc_date: '2026-10-13', doc_type: 'factura', handwritten: false, grand_total: -175.46 },
  factura: {
    invoice_kind: 'rectificativa', corrects_number: '24056558',
    tax_breakdown: [{ vat_pct: 10, base: -134.38, vat_amount: 13.44 }, { vat_pct: 4, base: -26.58, vat_amount: 1.06 }],
  },
  confidence: 0.95,
  ...o,
})
const fallos = (l: ReturnType<typeof leerFactura>) => l.comprobaciones.filter((x) => !x.ok).map((x) => x.id)

describe('S01h · un abono se lee con todo en negativo, y cuadra', () => {
  it('las cuotas en positivo del modelo pasan a negativo: bases + IVA = total, sin «sobran 29,00 €»', () => {
    const l = leerFactura(abono(), { hoy: HOY })
    expect(l.factura.clase).toBe('rectificativa')
    expect(l.factura.rectificaA).toBe('24056558')
    expect(l.factura.tipos.map((t) => [t.tipo, t.base, t.cuota])).toEqual([[10, -134.38, -13.44], [4, -26.58, -1.06]])
    expect(l.factura).toMatchObject({ base: -160.96, cuota: -14.5, total: -175.46 })
    expect(fallos(l)).toEqual([])
    expect(l.confianza).toBe('seguro')
  })
  it('sin que el modelo diga «rectificativa», los importes en negativo bastan para tratarlo como abono', () => {
    const l = leerFactura(abono({ factura: { invoice_kind: 'completa', tax_breakdown: [{ vat_pct: 10, base: -134.38, vat_amount: 13.44 }, { vat_pct: 4, base: -26.58, vat_amount: 1.06 }] } }), { hoy: HOY })
    expect(l.factura.clase).toBe('rectificativa')
    expect(l.factura.total).toBe(-175.46)
  })
  it('el total en positivo de un abono también pasa a negativo', () => {
    const l = leerFactura(abono({ document: { ...abono().document, grand_total: 175.46 } }), { hoy: HOY })
    expect(l.factura.total).toBe(-175.46)
    expect(fallos(l)).toEqual([])
  })
  it('una factura de siempre no cambia de signo', () => {
    const l = leerFactura(abono({
      document: { ...abono().document, grand_total: 175.46 },
      factura: { invoice_kind: 'completa', tax_breakdown: [{ vat_pct: 10, base: 134.38, vat_amount: 13.44 }, { vat_pct: 4, base: 26.58, vat_amount: 1.06 }] },
    }), { hoy: HOY })
    expect(l.factura.clase).toBe('completa')
    expect(l.factura).toMatchObject({ base: 160.96, cuota: 14.5, total: 175.46 })
  })
})
