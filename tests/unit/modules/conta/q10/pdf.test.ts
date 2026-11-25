// tests/unit/modules/conta/q10/pdf.test.ts
//
// Q10 · El PDF de una factura de la cuota del mes, con el modelo «Sumied»: cuadra
// (si no, el modelo no pinta), «Borrador» sin número, sin Verifactu y con el
// día real del cobro. Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'
import { comprobarFacturaSumied, facturaSumiedPdf } from '../../../../../supabase/functions/_shared/facturaSumiedPdf'
import { datosPdfQ10, emisorQ10 } from '@/modules/conta/gestoria/q10/pdf'
import type { BorradorQ10 } from '@/modules/conta/gestoria/q10/facturasDelMes'

const b = (o: Partial<BorradorQ10> = {}): BorradorQ10 => ({
  cobro: { gcId: 'PM1', estado: 'paid_out', fecha: '2026-11-04', importe: 53, suscripcionId: 'SB1', mandatoId: 'MD1', motivo: null },
  ficha: { partyId: 'p1', nombre: 'Talleres de Prueba, S.L.', nif: 'B00000000', direccion: 'Calle Inventada 1 · 28000 Madrid' },
  concepto: 'GESTORIA MENSUAL', texto: 'Cuota de noviembre de 2026 · cobrada el 04/11/2026',
  baseCent: 5000, ivaCent: 1050, retencion: { pct: 15, cent: 750 }, totalCent: 5300, ...o,
})
const emisor = emisorQ10({ legal_name: 'Gestoría de Prueba, S.L.', tax_id: 'B00000001', fiscal_street: 'Calle Ejemplo', fiscal_number: '1', fiscal_postal_code: '28000', fiscal_city: 'Madrid' })

describe('Q10 · el PDF de la cuota', () => {
  it('cuadra con la retención y lleva lo que decidió Julio', () => {
    const d = datosPdfQ10(b(), '2026-11', { emisor, numero: null, fecha: '2026-11-26', cuenta: { pais: 'ES', final: '53' } })
    expect(comprobarFacturaSumied(d)).toEqual([])
    expect(d).toMatchObject({ numero: 'Borrador', fecha: '2026-11-26', pagadaEl: '2026-11-04', periodo: 'Cuota de noviembre de 2026', verifactu: 'no',
      retencion: { pct: 15, cent: 750 }, totalCent: 5300 })
    expect(d.lineas).toEqual([expect.objectContaining({ concepto: 'GESTORIA MENSUAL', explicacion: 'Cuota de noviembre de 2026 · cobrada el 04/11/2026', importeCent: 5000 })])
    expect(d.pago).toEqual({ forma: 'Domiciliación SEPA', cuenta: 'Cuenta ES•• •••• •••• •••• •••• ••53', texto: 'Cargada el 4 de noviembre · pagada' })
    expect(emisor).toEqual({ nombre: 'Gestoría de Prueba, S.L.', nif: 'B00000001', lineas: ['Calle Ejemplo 1 · 28000 Madrid'], logo: null })
  })
  it('sin retención, también, y el PDF se pinta', () => {
    const d = datosPdfQ10(b({ baseCent: 10000, ivaCent: 2100, retencion: null, totalCent: 12100 }), '2026-11', { emisor, numero: '2026/1/2745', fecha: '2026-11-26', cuenta: null })
    expect(comprobarFacturaSumied(d)).toEqual([])
    const bytes = facturaSumiedPdf(jsPDF, d)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
  })
})
