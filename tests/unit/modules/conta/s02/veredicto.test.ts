// tests/unit/modules/conta/s02/veredicto.test.ts
//
// S02 · El veredicto de la IA con su motivo (regla 3 del patrón; tablero 3):
// «Lista para contabilizar», «Revisa esto» o «No encaja», con una frase que
// dice POR QUÉ, y el motivo de cada campo. Sin migración: de lo que ya se
// guarda. Regla 31: las comprobaciones son las DE VERDAD, las que escribe la
// lectura del PDF (supabase/functions/_shared/lecturaFactura.ts), leyendo un
// modelo de factura que cuadra y uno que no.

import { describe, expect, it } from 'vitest'
import { leerFactura as comprobarLectura } from '../../../../../supabase/functions/_shared/lecturaFactura'
import { motivoDelGasto, motivoGasto, motivoImportes, motivoProveedor, nifCoincide, veredictoFactura, type DatosVeredicto } from '@/modules/conta/documentos/veredicto'

const modelo = (total: number) => ({
  confidence: 0.97,
  document: { doc_type: 'factura', doc_number: '24048027', doc_date: '2026-10-13', supplier_name: 'EUROPASTRY, S.A.', supplier_tax_id: 'A08183311', grand_total: total, tax_total: 10.08 },
  factura: { tax_breakdown: [{ vat_pct: 10, base: 100.79, vat_amount: 10.08 }] },
})
const lectura = (total: number) => comprobarLectura(modelo(total) as never, { hoy: '2026-10-22' })

const base = (o: Partial<DatosVeredicto> = {}): DatosVeredicto => ({
  validada: false, numeroAsiento: null, descartada: false, motivoDescarte: null,
  proveedor: { nombre: 'EUROPASTRY, S.A.', nif: 'A08183311' }, nifFactura: 'A08183311', fecha: '2026-10-13',
  comprobaciones: lectura(110.87).comprobaciones,
  propuesta: { confianza: 'seguro', avisos: [], razones: [{ decision: 'Gasto', porque: 'la cuenta de su ficha' }] },
  porqueSinPropuesta: null, origenGasto: 'de su ficha', pagada: { fecha: '2026-10-13' }, ...o,
})

describe('el veredicto', () => {
  it('la lectura de verdad cuadra y no cuadra (la población de la prueba)', () => {
    expect(lectura(110.87).comprobaciones.find((c) => c.id === 'suma')?.ok).toBe(true)
    expect(lectura(120).comprobaciones.find((c) => c.id === 'suma')?.ok).toBe(false)
  })
  it('todo cuadra, con su ficha y su pago: «Lista para contabilizar», diciendo por qué', () => {
    const v = veredictoFactura(base())
    expect(v.tipo).toBe('lista')
    expect(v.titulo).toBe('Lista para contabilizar')
    expect(v.porque).toBe('El proveedor, el IVA y la cuenta coinciden con su ficha y sus facturas anteriores, y los importes del PDF cuadran. Ya está pagada en el banco (13/10).')
    expect(v.detalle.some((d) => d.ok === null && /Gasto: la cuenta de su ficha/.test(d.texto))).toBe(true)
  })
  it('el total no cuadra con sus bases: «No encaja», con el texto de la comprobación', () => {
    const v = veredictoFactura(base({ comprobaciones: lectura(120).comprobaciones }))
    expect(v.tipo).toBe('no_encaja')
    expect(v.porque).toMatch(/^No cuadra: bases \+ IVA dan 110,87 € y el total es 120,00 €/)
  })
  it('el NIF de la factura no es el de su ficha: «No encaja»', () => {
    expect(veredictoFactura(base({ nifFactura: 'B12345678' })).porque).toMatch(/no es el de la ficha de EUROPASTRY/)
  })
  it('sin proveedor, sin propuesta o sin fecha: «No encaja», con su porqué', () => {
    expect(veredictoFactura(base({ proveedor: null })).porque).toBe('No reconozco quién la emite: dime de quién es y la contabilizo.')
    expect(veredictoFactura(base({ propuesta: null, porqueSinPropuesta: 'El mes está cerrado' })).porque).toBe('El mes está cerrado.')
    expect(veredictoFactura(base({ fecha: null })).tipo).toBe('no_encaja')
  })
  it('la cuenta probable o un aviso: «Revisa esto», con el primero que pesa', () => {
    expect(veredictoFactura(base({ propuesta: { confianza: 'probable', avisos: [], razones: [] } })).tipo).toBe('revisa')
    expect(veredictoFactura(base({ propuesta: { confianza: 'seguro', avisos: ['Trae retención y su ficha no'], razones: [] } })).porque).toBe('Trae retención y su ficha no.')
  })
  it('ya validada o descartada', () => {
    expect(veredictoFactura(base({ validada: true, numeroAsiento: 812 })).porque).toBe('Tiene su asiento validado (el 812): no hay nada que hacer.')
    expect(veredictoFactura(base({ descartada: true, motivoDescarte: 'Es un albarán' })).titulo).toBe('No es una factura')
  })
  it('nunca un porcentaje', () => {
    for (const v of [veredictoFactura(base()), veredictoFactura(base({ propuesta: { confianza: 'duda', avisos: [], razones: [] } }))]) expect(`${v.titulo} ${v.porque}`).not.toMatch(/%/)
  })
})

describe('el motivo de cada campo: PROPUESTO, Por revisar o bien', () => {
  it('el proveedor: ✓ «NIF de su ficha», o en ámbar lo que no casa', () => {
    expect(motivoProveedor({ proveedor: { nombre: 'X', nif: 'A08183311' }, nifFactura: 'ESA08183311' })).toEqual({ tono: 'ok', marca: 'NIF de su ficha' })
    expect(motivoProveedor({ proveedor: null, nifFactura: 'B1' }).tono).toBe('revisar')
    expect(motivoProveedor({ proveedor: { nombre: 'X', nif: null }, nifFactura: null }).motivo).toMatch(/Sin NIF/)
    expect(nifCoincide('A08183311', null)).toBeNull()
  })
  it('el gasto: PROPUESTO con su motivo; confirmado, sin etiqueta; sin cuenta, en ámbar', () => {
    expect(motivoGasto({ cuenta: '60000001', origen: 'aprendido de sus facturas anteriores', confirmada: false })).toEqual({ tono: 'propuesto', motivo: 'Lo usaste en sus facturas anteriores.' })
    expect(motivoGasto({ cuenta: '60000001', origen: 'de su ficha', confirmada: true }).tono).toBe('normal')
    expect(motivoGasto({ cuenta: null, origen: null, confirmada: false }).tono).toBe('revisar')
    expect(motivoDelGasto('de su ficha')).toBe('Es la cuenta de su ficha.')
  })
  it('los importes: cuadran con el PDF, o en ámbar con lo que no cuadra', () => {
    expect(motivoImportes(lectura(110.87).comprobaciones)).toEqual({ tono: 'ok', motivo: 'Cuadran con el PDF, al céntimo.' })
    expect(motivoImportes(lectura(120).comprobaciones).tono).toBe('revisar')
    expect(motivoImportes([]).motivo).toMatch(/No viene de leer un fichero/)
  })
})
