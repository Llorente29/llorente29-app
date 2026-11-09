// G05 · T4 · Los datos del modelo «Sumied» de una factura de recibo, a partir de lo leído
// (_shared/cobro/facturaSumiedDatos.ts): lo mismo en la ficha y en el servidor. Datos inventados (T11).
import { jsPDF } from 'jspdf'
import { describe, expect, it } from 'vitest'
import { montarDatosSumied, porTipoGuardado, type EntradaSumied } from '../../../../../../supabase/functions/_shared/cobro/facturaSumiedDatos'
import { facturaSumiedPdf } from '../../../../../../supabase/functions/_shared/facturaSumiedPdf'

const entrada = (extra: Partial<EntradaSumied> = {}): EntradaSumied => ({
  factura: { numero: '2026/1/141', fecha: '2026-12-04', base: 130, iva: 27.3, retencion: 0, total: 157.3,
    cliente: { nombre: 'Talleres Ejemplo, S.L.', nif: 'B00000034', calle: 'Polígono de Prueba, nave 7', cp: '28320', ciudad: 'Pinto', provincia: 'Madrid' },
    lineas: [{ tipo: 21, importe: 50, cuota: 10.5 }, { tipo: 21, importe: 80, cuota: 16.8 }] },
  recibo: { mes: '2026-12', confirmado_el: '2026-12-04', factura: { lineas: [
    { concepto: 'Gestoría Estándar', cantidad: 1, precioCent: 5000, baseCent: 5000, asignacionId: 'a1' },
    { concepto: 'Gestión laboral · 2 trabajadores', cantidad: 2, precioCent: 4000, baseCent: 8000, asignacionId: 'a2', trabajadoresEn: 'linea',
      trabajadores: [{ nombre: 'Persona Prueba Uno', desde: '2019-03-03' }, { nombre: 'Persona Prueba Dos', desde: '2026-12-12' }] },
  ] } },
  empresa: { legal_name: 'Gestoría Demo, S.L.', trade_name: null, tax_id: 'B00000026', fiscal_street_type: 'C/', fiscal_street: 'del Ejemplo', fiscal_number: '12',
    fiscal_postal_code: '28001', fiscal_city: 'Madrid', email: 'hola@gestoriademo.example', phone: null },
  codigoCliente: 52,
  asignaciones: [{ id: 'a1', servicio_id: 's1', nivel_id: 'n1', paquete_id: null }, { id: 'a2', servicio_id: 's2', nivel_id: null, paquete_id: null }],
  niveles: [{ id: 'n1', incluye: ['Contabilidad', 'Impuestos trimestrales', 'Cuentas anuales'] }],
  servicios: [{ id: 's1', clave: 'gestoria_mensual', incluye: null }, { id: 's2', clave: 'gestion_laboral', incluye: null }],
  paquetes: [], cuenta: { pais: 'ES', final: '21' }, logo: null, demo: true, verifactu: null,
  ...extra,
})

describe('G05 · T4 · los datos del modelo «Sumied», los mismos en la ficha y en el servidor', () => {
  it('emisor, cliente con su código, pago con la cuenta enmascarada y el periodo del recibo', () => {
    const d = montarDatosSumied(entrada())
    expect(d.emisor).toEqual({ nombre: 'Gestoría Demo, S.L.', nif: 'B00000026', lineas: ['C/ del Ejemplo 12 · 28001 Madrid', 'hola@gestoriademo.example'], logo: null })
    expect(d.cliente).toEqual({ nombre: 'Talleres Ejemplo, S.L.', nif: 'B00000034', codigo: 52, direccion: 'Polígono de Prueba, nave 7 · 28320 Pinto (Madrid)' })
    expect(d.pago).toEqual({ forma: 'Domiciliación SEPA', cuenta: 'Cuenta ES•• •••• •••• •••• •••• ••21', texto: 'Cargada el 4 de diciembre · pagada' })
    expect([d.periodo, d.pagadaEl, d.demo]).toEqual(['Servicios de diciembre de 2026', '2026-12-04', true])
  })

  it('«Qué incluye»: el del nivel; si no, el de siempre del catálogo; los trabajadores con su alta del mes', () => {
    const d = montarDatosSumied(entrada())
    expect(d.lineas.map((l) => [l.concepto, l.explicacion])).toEqual([
      ['Gestoría Estándar', 'Contabilidad, Impuestos trimestrales y cuentas anuales'],
      ['Gestión laboral', 'Nóminas y seguros sociales · 2 trabajadores'],
    ])
    expect(d.lineas[1].trabajadores).toEqual([{ nombre: 'Persona Prueba Uno', desde: 'Desde el 3 de marzo de 2019' }, { nombre: 'Persona Prueba Dos', desde: 'Alta el 12 de diciembre de 2026' }])
  })

  it('el IVA por tipo, el guardado; y la factura cuadra: tiene PDF', () => {
    expect(porTipoGuardado(entrada().factura.lineas)).toEqual([{ tipo: 21, baseCent: 13000, ivaCent: 2730 }])
    expect(() => facturaSumiedPdf(jsPDF, montarDatosSumied(entrada()))).not.toThrow()
  })
})
