// tests/unit/modules/conta/v01/facturaVentaPdfCorreo.test.ts
//
// V01 · Entrega 1 · El PDF y el correo de una factura de venta, sin red:
//   · el PDF no se pinta si no cuadra con sus líneas (dice qué no cuadra);
//   · cuando cuadra, es un PDF (con una rectificativa también);
//   · el correo sale de sumied.com con el nombre de la empresa, sin poder
//     colar cabeceras, y su HTML escapa lo que escribe la gente;
//   · el freno: «factura_venta» está cerrado salvo lo que Julio abra, y abierto
//     solo a su correo de prueba no sale a otro.

import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'
import { comprobarFactura, facturaVentaPdf, nombreFacturaPdf, type DatosFacturaPdf } from '../../../../../supabase/functions/_shared/facturaVentaPdf'
import { PLANTILLA_FACTURA_VENTA, correoFactura, correoValido, remitenteFactura } from '../../../../../supabase/functions/_shared/facturaVentaCorreo'
import { cerrojoMarca } from '../../../../../supabase/functions/send-email/marca'
import { MARCAS } from '../../../../../supabase/functions/_shared/marcas'

const D: DatosFacturaPdf = {
  empresa: { nombre: 'Taberna de Prueba Norte', nif: 'B12345678', direccion: 'Calle Mayor 1, 28001 Madrid' },
  numero: 'F-2026/0001', fecha: '2026-10-24', vence: '2026-11-23', formaCobro: 'Transferencia',
  cliente: { nombre: 'Colegio Prueba V01', nif: '12345678Z', direccion: null },
  lineas: [
    { concepto: 'Menú del día', cantidad: 10, precio: 100, descuento: 0, tipo: 21, importe: 1000 },
    { concepto: 'Café', cantidad: 1, precio: 50, descuento: 10, tipo: 10, importe: 45 },
  ],
  porTipo: [{ tipo: 21, base: 1000, iva: 210, recargo: 0 }, { tipo: 10, base: 45, iva: 4.5, recargo: 0 }],
  base: 1045, iva: 214.5, recargo: 0, retencion: null, total: 1259.5, notas: 'Gracias', rectifica: null,
}

describe('el PDF', () => {
  it('cuadra y es un PDF', () => {
    expect(comprobarFactura(D)).toEqual([])
    const b = facturaVentaPdf(jsPDF, D)
    expect(new TextDecoder().decode(b.slice(0, 5))).toBe('%PDF-')
    expect(b.length).toBeGreaterThan(1000)
  })
  it('no se pinta si no cuadra, y dice qué', () => {
    const mal = { ...D, total: 1259.51 }
    expect(comprobarFactura(mal)[0]).toMatch(/no es el total/)
    expect(() => facturaVentaPdf(jsPDF, mal)).toThrow(/F-2026\/0001 no cuadra/)
    expect(comprobarFactura({ ...D, base: 1000, porTipo: D.porTipo })[0]).toMatch(/las líneas suman/)
  })
  it('una rectificativa: sus cifras son la diferencia, no la suma de sus líneas', () => {
    const r: DatosFacturaPdf = {
      ...D, numero: 'R-2026/0001', lineas: [{ concepto: 'Menú del día', cantidad: 8, precio: 100, descuento: 0, tipo: 21, importe: 800 }],
      porTipo: [{ tipo: 21, base: -200, iva: -42, recargo: 0 }], base: -200, iva: -42, total: -242,
      rectifica: { numero: 'F-2026/0001', motivo: 'Eran 10 y fueron 8', que: 'corrige los importes' },
    }
    expect(comprobarFactura(r)).toEqual([])
    expect(facturaVentaPdf(jsPDF, r).length).toBeGreaterThan(1000)
  })
  it('su nombre de fichero', () => {
    expect(nombreFacturaPdf('F-2026/0087')).toBe('F-2026-0087.pdf')
  })
})

describe('el correo', () => {
  it('sale de sumied.com con el nombre de la empresa, sin colar cabeceras', () => {
    expect(remitenteFactura('Bar Ejemplo')).toBe('"Bar Ejemplo vía Sumied" <facturas@sumied.com>')
    const malo = remitenteFactura('Malo"\r\nBcc: x@y.z <a>')
    expect(malo).not.toMatch(/[\r\n]/)
    expect(malo.match(/[<>"]/g)).toEqual(['"', '"', '<', '>'])
    expect(malo.endsWith('<facturas@sumied.com>')).toBe(true)
    expect(remitenteFactura('')).toBe('Sumied <facturas@sumied.com>')
  })
  it('un correo que se puede usar, o nada', () => {
    expect(correoValido(' Cliente@Ejemplo.ES ')).toBe('cliente@ejemplo.es')
    expect(correoValido('a@b.c, d@e.f')).toBeNull()
    expect(correoValido('sin arroba')).toBeNull()
    expect(correoValido(null)).toBeNull()
  })
  it('dice qué factura es y escapa lo que escribe la gente', () => {
    const c = correoFactura({ empresa: 'Bar <b>', numero: 'F-2026/0001', rectificativa: false, fecha: '2026-10-24', total: 1259.5, vence: '2026-11-23', cliente: 'Colegio & Co' })
    expect(c.asunto).toBe('Factura F-2026/0001 de Bar b')
    expect(c.texto).toContain('por 1.259,50 €. Vence el 23/11/2026.')
    expect(c.html).toContain('Colegio &amp; Co')
    expect(c.html).not.toContain('<b>')
  })
  it('el freno: cerrado de serie, y abierto solo al correo de prueba', () => {
    expect(cerrojoMarca(MARCAS.sumied, PLANTILLA_FACTURA_VENTA, 'cliente@ejemplo.es', '').abierto).toBe(false)
    const soloPrueba = `${PLANTILLA_FACTURA_VENTA}:prueba@julio.es`
    expect(cerrojoMarca(MARCAS.sumied, PLANTILLA_FACTURA_VENTA, 'prueba@julio.es', soloPrueba).abierto).toBe(true)
    expect(cerrojoMarca(MARCAS.sumied, PLANTILLA_FACTURA_VENTA, 'cliente@ejemplo.es', soloPrueba).abierto).toBe(false)
  })
})
