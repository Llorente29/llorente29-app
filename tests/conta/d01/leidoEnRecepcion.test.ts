// D01 R6 · N23 comprueba lo que leyó la recepción (sin volver a leer con el
// modelo), con la misma regla que el modo factura. La lectura de la recepción
// tiene la forma medida en producción el 14/10 (claves de parsed_result de las
// 73 lecturas «factura» y «albarán-factura» de Foodint: document, lines y
// confidence; sin la clave «factura» del modo factura). Datos inventados.
import { describe, expect, it } from 'vitest'
import { conLoLeidoEnRecepcion, type FacturaRevisar } from '../../../src/modules/conta/services/documentosService'

const base = (o: Partial<FacturaRevisar> = {}): FacturaRevisar => ({
  id: 'i', account_id: 'a', company_id: 'c', estado: 'en_revision', numero: 'RCP-26/80', fecha: '2026-10-11', vence: null, clase: 'invoice',
  base: 36.36, cuota: 3.64, recargo: null, retencion: null, total: 40, canal: null, confianza: null, lectura: null, no_repetida: false,
  tipos: [], lineas: [], proveedor: null, propuesto: null, llegada: null, papel: 'x', recepcion: { fecha: '2026-10-11', local: 'Norte' }, asiento: null, ...o,
})
const modelo = {
  document: {
    supplier_name: 'Recepción Prueba R6', supplier_tax_id: 'B00000081', doc_number: 'RCP-26/80', doc_date: '2026-10-11', doc_type: 'albaran_factura',
    handwritten: false, tax_base_total: 36.36, tax_total: 3.64, grand_total: 40, bill_to_name: 'Taberna de Prueba Norte, S.L.',
  },
  lines: [{ raw_text: 'Género', line_amount: 36.36, vat_pct: 10 }],
  confidence: 0.95,
}

describe('lo leído en la recepción', () => {
  it('sin lectura propia, comprueba la de la recepción y lo dice primero', () => {
    const f = conLoLeidoEnRecepcion(base({ leido_en_recepcion: { modelo, cuando: '2026-10-11T08:00:00Z', recepcion: '2026-10-11' } }), '2026-10-14')
    expect(f.lectura?.porque[0]).toBe('Lo leyó la recepción del 11/10 con su papel; no la he vuelto a leer.')
    expect(f.lectura?.factura.numero).toBe('RCP-26/80')
    expect(f.lectura?.comprobaciones.find((c) => c.id === 'suma')).toMatchObject({ ok: true })
    expect(f.confianza).toBe(f.lectura?.confianza)
  })
  it('si no cuadra, lo dice (la misma regla que el modo factura)', () => {
    const mal = { ...modelo, document: { ...modelo.document, grand_total: 45 } }
    const f = conLoLeidoEnRecepcion(base({ leido_en_recepcion: { modelo: mal, cuando: '', recepcion: '2026-10-11' } }), '2026-10-14')
    expect(f.lectura?.comprobaciones.find((c) => c.id === 'suma')).toMatchObject({ ok: false })
    expect(f.lectura?.confianza).toBe('duda')
  })
  it('con lectura propia, o sin recepción leída, no toca nada', () => {
    const sin = base()
    expect(conLoLeidoEnRecepcion(sin)).toBe(sin)
  })
})
