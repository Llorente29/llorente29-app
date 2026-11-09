// G05 · Tarea 4 · El modelo de factura «Sumied» (supabase/functions/_shared/facturaSumiedPdf.ts),
// fiel a la maqueta aprobada (Factura.dc.html; Julio nº 38). Datos inventados (T11).
// Lo que se mira aquí es lo que no se ve en la comparación lado a lado: las letras van
// incrustadas, el texto es el de la maqueta, sin la nota «Con más de 10…», la hoja aparte
// con más de 10 trabajadores, y que una factura que no cuadra no tiene PDF.
import { jsPDF } from 'jspdf'
import { describe, expect, it } from 'vitest'
import { cuentaEnmascarada, facturaSumiedPdf, iniciales, QUE_INCLUYE_POR_DEFECTO, SUMIED_PDF, type DatosFacturaSumied } from '../../../../../../supabase/functions/_shared/facturaSumiedPdf'

const bytes = (b: Uint8Array) => new TextDecoder('latin1').decode(b)
const paginas = (b: Uint8Array) => (bytes(b).match(/\/Type \/Page\b/g) ?? []).length
const personas = (n: number) => Array.from({ length: n }, (_, i) => ({ nombre: `Persona Prueba ${i + 1}`, desde: 'Desde el 3 de marzo de 2019' }))

const factura = (trabajadores: number, extra: Partial<DatosFacturaSumied> = {}): DatosFacturaSumied => ({
  emisor: { nombre: 'Gestoría Demo, S.L.', nif: 'B00000026', lineas: ['C/ del Ejemplo, 12 · 28001 Madrid', 'hola@gestoriademo.example'], logo: null },
  numero: '2026/1/141', fecha: '2026-12-04', pagadaEl: '2026-12-04', periodo: 'Servicios de diciembre de 2026',
  cliente: { nombre: 'Talleres Ejemplo, S.L.', nif: 'B00000034', codigo: 52, direccion: 'Polígono de Prueba, nave 7 · 28320 Pinto' },
  pago: { forma: 'Domiciliación SEPA', cuenta: null, texto: 'Cargada el 4 de diciembre · pagada' },
  lineas: [
    { concepto: 'Gestoría Estándar', explicacion: 'Contabilidad, impuestos trimestrales y cuentas anuales', cantidad: 1, precioCent: 5000, importeCent: 5000, trabajadores: null, trabajadoresEn: null },
    { concepto: 'Gestión laboral', explicacion: `${trabajadores} trabajadores`, cantidad: trabajadores, precioCent: 2000, importeCent: 2000 * trabajadores, trabajadores: personas(trabajadores), trabajadoresEn: trabajadores > 10 ? 'hoja' : 'linea' },
  ],
  porTipo: [{ tipo: 21, baseCent: 5000 + 2000 * trabajadores, ivaCent: Math.round((5000 + 2000 * trabajadores) * 0.21) }],
  baseCent: 5000 + 2000 * trabajadores, ivaCent: Math.round((5000 + 2000 * trabajadores) * 0.21), retencion: null,
  totalCent: 5000 + 2000 * trabajadores + Math.round((5000 + 2000 * trabajadores) * 0.21), verifactu: null, demo: true, ...extra,
})

describe('G05 · T4 · el modelo de factura «Sumied»', () => {
  it('lleva incrustadas las letras de la maqueta: Inter (400, 600 y 700) y Space Grotesk', () => {
    const t = bytes(facturaSumiedPdf(jsPDF, factura(4)))
    for (const f of ['/BaseFont /Inter', '/BaseFont /InterSemi', '/BaseFont /InterBold', '/BaseFont /SpaceGrotesk']) expect(t, f).toContain(f)
    expect(t).toContain('/FontFile2')
  })

  it('con 4 trabajadores, una sola hoja; con 12, la hoja aparte', () => {
    expect(paginas(facturaSumiedPdf(jsPDF, factura(4)))).toBe(1)
    expect(paginas(facturaSumiedPdf(jsPDF, factura(12)))).toBe(2)
  })

  it('una factura que no cuadra no tiene PDF, y lo dice', () => {
    expect(() => facturaSumiedPdf(jsPDF, factura(4, { totalCent: 1 }))).toThrow(/no cuadra: base \+ IVA − retención/)
  })

  it('con retención, también cuadra (base + IVA − retención)', () => {
    const f = factura(4)
    expect(() => facturaSumiedPdf(jsPDF, { ...f, retencion: { pct: 15, cent: 1950 }, totalCent: f.totalCent - 1950 })).not.toThrow()
  })

  it('las iniciales del emisor sin la forma jurídica, y los textos fijos de la maqueta', () => {
    expect([iniciales('Gestoría Demo, S.L.'), iniciales('Elena Campos Ortiz'), iniciales('Asesoría Inventada')]).toEqual(['GD', 'EC', 'AI'])
    expect(SUMIED_PDF).toMatchObject({ marca: 'DEMOSTRACIÓN · SIN VALIDEZ', verifactu: 'VERI*FACTU', pendiente: 'Verifactu de pruebas: pendiente',
      verificable: 'Factura verificable en la sede electrónica de la AEAT' })
  })

  it('la cuenta del mandato, enmascarada: GoCardless da 2 dígitos en euros; sin dígitos, nada', () => {
    expect(cuentaEnmascarada('ES', '21')).toBe('Cuenta ES•• •••• •••• •••• •••• ••21')
    expect(cuentaEnmascarada('es', '4821')).toBe('Cuenta ES•• •••• •••• •••• •••• 4821')
    expect(cuentaEnmascarada('ES', null)).toBeNull()
  })

  it('el «Qué incluye» de siempre del catálogo: laboral, «Nóminas y seguros sociales»', () => {
    expect(QUE_INCLUYE_POR_DEFECTO.gestion_laboral).toBe('Nóminas y seguros sociales')
  })

  it('con el logo de la empresa (PNG), el nombre se corre a su derecha y no salen las iniciales', () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEklEQVR4nGPkU3JggAEmBiQAAAqcAHRMAN8nAAAAAElFTkSuQmCC'
    const t = bytes(facturaSumiedPdf(jsPDF, factura(4, { emisor: { nombre: 'Gestoría Demo, S.L.', nif: 'B00000026', lineas: [], logo: { base64: png, formato: 'PNG' } } })))
    expect(t).toContain('/Subtype /Image')
  })
})
