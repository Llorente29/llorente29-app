// tests/unit/modules/conta/q10/equivalencias.test.ts
//
// Q10 · respuesta 1 · El código de cliente de Cegid de cada ficha y la tabla de equivalencias, con datos inventados
// (T11). Los importes, los de verdad de noviembre (121, 24,20, 36,30; 20 € de base por trabajador).

import { describe, expect, it } from 'vitest'
import { codigosCegid, familia, resumenCodigos, tablaEquivalencias, type ClienteCegidQ, type FacturaCegidQ } from '@/modules/conta/gestoria/q10/equivalencias'

const cli = (codigo: number, nif: string | null, conceptos: ClienteCegidQ['conceptos'] = null): ClienteCegidQ => ({ codigo, nombre: `Cliente ${codigo}`, nif, conceptos })
const linea = (codigoConcepto: string, importe: number, o: Record<string, unknown> = {}) => ({ codigoConcepto, importe, total: importe, cantidad: 1, porcentajeIva: 21, llevaRetencion: false, ...o })
const fact = (cliente: number, serie: string, lineas: Record<string, unknown>[], codigo = 1): FacturaCegidQ => ({ serie, codigo, cliente, total: null, retencion: 0, lineas })

describe('Q10 · el código de cliente de Cegid de cada ficha', () => {
  const clientes = [cli(167, 'B00000167'), cli(200, 'B00000200'), cli(300, '00000000T'), cli(301, 'B00000999'), cli(302, 'B00000999')]
  it('por su 430 (43000167 → 167), por su NIF, o sin código; nunca por nombre', () => {
    const r = codigosCegid([
      { partyId: 'p1', nif: 'B00000167', cuenta430: '43000167' },
      { partyId: 'p2', nif: 'B00000201', cuenta430: '43000200' },
      { partyId: 'p3', nif: '00000000-T', cuenta430: null },
      { partyId: 'p4', nif: 'B00000999', cuenta430: null },
      { partyId: 'p5', nif: 'B00000555', cuenta430: '43009999' },
    ], clientes)
    expect(r.get('p1')).toMatchObject({ codigo: 167, como: '430' })
    expect(r.get('p2')).toMatchObject({ codigo: 200, como: '430_nif_distinto' })
    expect(r.get('p3')).toMatchObject({ codigo: 300, como: 'nif' })
    expect(r.get('p4')).toMatchObject({ codigo: null, como: 'sin', porque: 'Su NIF está en 2 clientes de Cegid (301, 302): no se adivina.' })
    expect(r.get('p5')).toMatchObject({ codigo: null, como: 'sin' })
    expect(resumenCodigos(r).frase).toBe('De 5 fichas atadas: 1 con su 430 igual al código de Cegid (y el mismo NIF), 1 con el código pero otro NIF en Cegid, 1 por su NIF y 2 sin código de Cegid.')
  })
})

describe('Q10 · las familias de los conceptos de GoCardless', () => {
  it('cada nombre a su familia; lo que no es de ninguna, su nombre', () => {
    expect(familia('GESTORIA MENSUAL')).toBe('GESTORIA MENSUAL')
    expect(familia('GESTORIAL MENSUAL EMPRESA DE PRUEBA SL')).toBe('GESTORIA MENSUAL')
    expect(familia('GESTION LABORAL  PERSONA INVENTADA')).toBe('GESTION LABORAL')
    expect(familia('Vigilancia de Notificaciones')).toBe('VIGILANCIA DE NOTIFICACIONES')
    expect(familia('EMPRESA DE PRUEBA SL CONTA SIMPLE')).toBe('CONTASIMPLE SOFTWARE')
    expect(familia('SERVICIO DE GESTORIA')).toBe('SERVICIOS GESTORIA')
    expect(familia('OFICINA VIRTUAL MENSUAL')).toBe('OFICINA VIRTUAL MENSUAL')
    expect(familia(null)).toBe('(sin suscripción)')
  })
})

describe('Q10 · la tabla de equivalencias, por lo que ya pasó', () => {
  const clientes = [cli(1, 'B00000001', [{ codigoConcepto: '0008', descripcion: 'GESTIÓN LABORAL', importe: 20, cantidad: 5, totalLinea: 100 }]), cli(2, 'B00000002'), cli(3, '00000000T')]
  const codigos = codigosCegid([
    { partyId: 'p1', nif: 'B00000001', cuenta430: '43000001' }, { partyId: 'p2', nif: 'B00000002', cuenta430: '43000002' }, { partyId: 'p3', nif: '00000000T', cuenta430: null },
  ], clientes)
  const facturas = [
    fact(1, '1', [linea('0001', 100), linea('0008', 100, { cantidad: 5, importe: 20 })], 10),
    fact(2, '1', [linea('0001', 100)], 11),
    fact(3, '3', [linea('0040', 30), linea('0001', 100, { llevaRetencion: true })], 12),
  ]
  const conceptos = [{ codigo: '0001', descripcion: 'HONORARIOS MENSUALES', porIva: 21, conRetencion: false }, { codigo: '0008', descripcion: 'GESTIÓN LABORAL', porIva: 21, conRetencion: false },
    { codigo: '0040', descripcion: 'SOFTWARE CONTASIMPLE', porIva: 21, conRetencion: false }]
  const t = tablaEquivalencias([
    { partyId: 'p1', importe: 121, concepto: 'GESTORIA MENSUAL' }, { partyId: 'p2', importe: 121, concepto: 'GESTORIA MENSUAL' },
    { partyId: 'p3', importe: 121, concepto: 'GESTORIA MENSUAL' },
    { partyId: 'p1', importe: 24.2, concepto: 'GESTION LABORAL TRABAJADOR UNO' }, { partyId: 'p1', importe: 24.2, concepto: 'GESTION LABORAL TRABAJADOR DOS' },
    { partyId: 'p3', importe: 36.3, concepto: 'CONTASIMPLE SOFTWARE' },
    { partyId: null, importe: 99, concepto: null },
  ], codigos, clientes, conceptos, facturas)
  it('GESTORIA MENSUAL → 0001, con la prueba de sus tres clientes, serie 1 y una de tres con retención', () => {
    const g = t.find((x) => x.familia === 'GESTORIA MENSUAL')!
    expect(g).toMatchObject({ cobros: 3, importeCent: 36300, clientes: 3, clientesConPrueba: 3, propuesta: { codigo: '0001', descripcion: 'HONORARIOS MENSUALES', votos: 3 } })
    expect(g.serie).toEqual({ serie: '1', veces: 2, de: 3 })
    expect(g.retencion).toEqual({ si: 1, de: 3 })
  })
  it('GESTION LABORAL → 0008: dos trabajadores del mismo cliente son un voto (un cliente, no dos cobros)', () => {
    expect(t.find((x) => x.familia === 'GESTION LABORAL')).toMatchObject({ cobros: 2, clientes: 1, propuesta: { codigo: '0008', votos: 1 }, retencion: { si: 0, de: 1 } })
  })
  it('CONTASIMPLE → 0040, en la serie 3', () => {
    expect(t.find((x) => x.familia === 'CONTASIMPLE SOFTWARE')).toMatchObject({ propuesta: { codigo: '0040' }, serie: { serie: '3', veces: 1, de: 1 } })
  })
  it('un cobro suelto sin cliente: sale, sin propuesta (no se adivina)', () => {
    expect(t.find((x) => x.familia === '(sin suscripción)')).toMatchObject({ cobros: 1, propuesta: null, clientes: 0, serie: null, retencion: null })
  })
  it('de más a menos euros', () => {
    expect(t.map((x) => x.familia)).toEqual(['GESTORIA MENSUAL', '(sin suscripción)', 'GESTION LABORAL', 'CONTASIMPLE SOFTWARE'])
  })
})

describe('Q10 · la retención de cada cliente, de su última factura en Cegid', async () => {
  const { retencionesDeCegid } = await import('@/modules/conta/gestoria/q10/equivalencias')
  it('la última manda; sin facturas o sin código, no se sabe', () => {
    const codigos = codigosCegid([{ partyId: 'p1', nif: 'B00000001', cuenta430: '43000001' }, { partyId: 'p2', nif: 'B00000002', cuenta430: '43000002' },
      { partyId: 'p3', nif: 'B00000003', cuenta430: null }], [cli(1, 'B00000001'), cli(2, 'B00000002')])
    const r = retencionesDeCegid(codigos, [
      { ...fact(1, '1', [], 500), retencion: 15, porcentajeRetencion: 15, fecha: 20260905 },
      { ...fact(1, '1', [], 560), retencion: 0, porcentajeRetencion: 0, fecha: 20261006 },
    ])
    expect([...r.entries()]).toEqual([['p1', 0]])
  })
})

describe('Q10 · la tabla de equivalencias con retención', () => {
  it('53 € cobrados a un cliente con el 15 %: la línea de 50 € con retención vota', () => {
    const codigos = codigosCegid([{ partyId: 'p1', nif: 'B00000001', cuenta430: '43000001' }], [cli(1, 'B00000001')])
    const t = tablaEquivalencias([{ partyId: 'p1', importe: 53, concepto: 'SERVICIOS GESTORIA' }], codigos, [cli(1, 'B00000001')], [],
      [{ ...fact(1, '1', [linea('0002', 50, { llevaRetencion: true })]), retencion: 7.5, porcentajeRetencion: 15 }])
    expect(t[0]).toMatchObject({ familia: 'SERVICIOS GESTORIA', propuesta: { codigo: '0002', votos: 1 }, retencion: { si: 1, de: 1 } })
  })
})
