// PC01 · E2b · La forma de pago y el IBAN que el lector guarda de cada factura
// nueva (respuestas de Julio, 26/10, punto 3).
//
// Sin población real: el 26/10 ninguna lectura de producción guardaba el texto
// de la forma de pago (0 sesiones de Foodint con payment_terms_text), así que
// los textos de aquí son ejemplos de cómo lo escriben las facturas españolas.
// El camino principal es la clave estructurada del modelo (payment_method); el
// texto es el respaldo. Ningún nombre ni IBAN es de nadie.
import { describe, expect, it } from 'vitest'
import { formaDePago, leerFactura, type LecturaModelo } from '../../../supabase/functions/_shared/lecturaFactura'

const lectura = (factura: LecturaModelo['factura']): LecturaModelo => ({
  document: { supplier_name: 'Mayorista Alfa, S.A.', supplier_tax_id: 'A00000001', doc_number: 'F-1', doc_date: '2026-10-20', grand_total: 121 },
  lines: [], factura: { tax_breakdown: [{ vat_pct: 21, base: 100, vat_amount: 21 }], ...factura }, confidence: 0.95,
})

describe('formaDePago', () => {
  it('la clave del modelo manda si es una de las cuatro', () => {
    expect(formaDePago('direct_debit', 'Transferencia')).toBe('direct_debit')
    expect(formaDePago(' Card ', null)).toBe('card')
    expect(formaDePago('bizum', 'Transferencia bancaria')).toBe('transfer')
  })
  it.each([
    ['Domiciliación bancaria', 'direct_debit'],
    ['Recibo domiciliado a 30 días', 'direct_debit'],
    ['Adeudo SEPA', 'direct_debit'],
    ['Cargo en su cuenta ES12 ···· 3456', 'direct_debit'],
    ['SEPA CORE 30 días fecha factura', 'direct_debit'],
    ['Pago con tarjeta', 'card'],
    ['TPV', 'card'],
    ['VISA ****1234', 'card'],
    ['Efectivo', 'cash'],
    ['En metálico', 'cash'],
    ['Transferencia bancaria a 30 días', 'transfer'],
    ['Ingreso en cuenta: ES79 2100 0813 6101 2345 6789', 'transfer'],
    ['IBAN ES79 2100 0813 6101 2345 6789', 'transfer'],
  ] as const)('«%s» → %s', (texto, forma) => {
    expect(formaDePago(null, texto)).toBe(forma)
  })
  it('lo que solo dice CUÁNDO, o nada, no es forma de pago', () => {
    expect(formaDePago(null, 'Al contado')).toBeNull()
    expect(formaDePago(null, '30 días fecha factura')).toBeNull()
    expect(formaDePago(null, '')).toBeNull()
    expect(formaDePago(null, null)).toBeNull()
  })
  it('una domiciliación que menciona la cuenta del cliente sigue siendo domiciliación, no transferencia', () => {
    expect(formaDePago(null, 'Domiciliación en la cuenta IBAN ES79 2100 0813 6101 2345 6789')).toBe('direct_debit')
  })
})

describe('leerFactura: el IBAN y la forma de pago', () => {
  it('guarda la forma y el IBAN sin espacios y en mayúsculas', () => {
    const l = leerFactura(lectura({ iban: 'es79 2100 0813 6101 2345 6789', payment_terms_text: 'Transferencia a 30 días' }), { hoy: '2026-10-26' })
    expect(l.factura.iban).toBe('ES7921000813610123456789')
    expect(l.factura.forma).toBe('transfer')
  })
  it('sin nada en el papel: null en los dos', () => {
    const l = leerFactura(lectura({}), { hoy: '2026-10-26' })
    expect(l.factura.iban).toBeNull()
    expect(l.factura.forma).toBeNull()
  })
  it('la clave del modelo antes que el texto', () => {
    expect(leerFactura(lectura({ payment_method: 'direct_debit', payment_terms_text: 'Transferencia' }), { hoy: '2026-10-26' }).factura.forma).toBe('direct_debit')
  })
})
