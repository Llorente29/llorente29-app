// G05 · Tarea 4 · El PDF de la factura de un recibo (supabase/functions/_shared/facturaVentaPdf.ts, `recibo`),
// fiel a la maqueta aprobada (Factura.dc.html): la marca de demostración, el código del cliente, la forma de
// pago, los trabajadores debajo de su línea (hasta 10) o en la hoja aparte, Verifactu pendiente, la nota al pie
// y «Hoja N de M». Sin `recibo`, la factura sale como siempre. Datos inventados (T11).
import { jsPDF } from 'jspdf'
import { describe, expect, it } from 'vitest'
import { facturaVentaPdf, RECIBO_PDF, type DatosFacturaPdf, type ExtrasDelRecibo } from '../../../../../../supabase/functions/_shared/facturaVentaPdf'

const texto = (b: Uint8Array) => new TextDecoder('latin1').decode(b)
const paginas = (b: Uint8Array) => (texto(b).match(/\/Type \/Page\b/g) ?? []).length

const D: DatosFacturaPdf = {
  empresa: { nombre: 'Gestoria Demo, S.L.', nif: 'B00000026', direccion: 'C/ del Ejemplo, 12 · 28001 Madrid' },
  numero: '2026/1/141', fecha: '2026-12-04', vence: null, formaCobro: null,
  cliente: { nombre: 'Talleres Ejemplo, S.L.', nif: 'B00000034', direccion: null },
  lineas: [
    { concepto: 'Gestoria Estandar', cantidad: 1, precio: 50, descuento: 0, tipo: 21, importe: 50 },
    { concepto: 'Gestion laboral · 4 trabajadores', cantidad: 4, precio: 20, descuento: 0, tipo: 21, importe: 80 },
  ],
  porTipo: [{ tipo: 21, base: 130, iva: 27.3, recargo: 0 }], base: 130, iva: 27.3, recargo: 0, retencion: null, total: 157.3,
  notas: null, rectifica: null,
}
const personas = (n: number) => Array.from({ length: n }, (_, i) => ({ nombre: `Persona Prueba ${i + 1}`, desde: 'Desde el 3 de marzo de 2019' }))
const extras = (trabajadores: number): ExtrasDelRecibo => ({
  demo: true, codigoCliente: 52,
  pago: { forma: 'Domiciliacion SEPA', cuenta: null, texto: 'Cargada el 4 de diciembre · pagada' },
  lineas: [{ trabajadores: null, trabajadoresEn: null }, { trabajadores: personas(trabajadores), trabajadoresEn: trabajadores > 10 ? 'hoja' : 'linea' }],
  verifactuPendiente: true,
  pie: ['Pagada el 4 de diciembre por domiciliacion. No tienes que hacer nada.'],
})

describe('G05 · T4 · el PDF de la factura de un recibo', () => {
  it('con 4 trabajadores: debajo de su línea, en una sola hoja, con todo lo de la maqueta', () => {
    const pdf = facturaVentaPdf(jsPDF, { ...D, recibo: extras(4) })
    const t = texto(pdf)
    for (const x of ['Código cliente 52', 'Domiciliacion SEPA', 'Cargada el 4 de diciembre', 'Persona Prueba 4', RECIBO_PDF.verifactuPendiente, 'No tienes que hacer nada', 'Hoja 1 de 1']) {
      expect(t, x).toContain(x)
    }
    expect(t).toContain('DEMOSTRACI')
    expect(paginas(pdf)).toBe(1)
  })

  it('con 12 trabajadores: la línea lo dice y van todos en la hoja aparte', () => {
    const pdf = facturaVentaPdf(jsPDF, { ...D, recibo: extras(12) })
    const t = texto(pdf)
    expect(t).toContain('El detalle de los 12 trabajadores va en la hoja aparte.')
    expect(t).toContain('Persona Prueba 12')
    expect(paginas(pdf)).toBe(2)
    expect(t).toContain('Hoja 2 de 2')
  })

  it('sin `recibo`, la factura de siempre: ni marca, ni código, ni hoja', () => {
    const t = texto(facturaVentaPdf(jsPDF, D))
    for (const x of ['DEMOSTRACI', 'Código cliente', 'Hoja 1 de 1', RECIBO_PDF.verifactuPendiente]) expect(t, x).not.toContain(x)
  })
})
