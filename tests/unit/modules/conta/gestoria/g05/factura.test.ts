// G05 · Tarea 2 · La factura de un recibo, al céntimo de lo cobrado
// (supabase/functions/_shared/cobro/factura.ts). Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { TRABAJADORES_EN_LA_LINEA, baseParaElTotal, facturaDelRecibo, lineasParaGuardar, totalConBase, type Fiscal } from '../../../../../../supabase/functions/_shared/cobro/factura'
import { prepararRecibo } from '../../../../../../supabase/functions/_shared/cobro/recibo'
import { C, E, asignaciones, catalogo, trabajador } from './comun'

const CON_IVA: Fiscal = { ivaPct: 21, retencionPct: 0, preciosConIva: true }
const reciboDe = (as = asignaciones()) => {
  const r = prepararRecibo({ catalogo: catalogo(), asignaciones: as, clienteId: C, empresaId: E, mes: '2026-12', situacionElDia1: 'activo', anterior: null })
  if (!r.hay) throw new Error(r.porque)
  return r.recibo
}

describe('G05 · la factura del recibo', () => {
  it('el ejemplo de QBO: 145,20 € con el IVA dentro = 120,00 € + 25,20 €; la laboral, «2 × 20,00 €», con sus trabajadores debajo', () => {
    const f = facturaDelRecibo(reciboDe(), CON_IVA)
    expect([f.baseCent, f.ivaCent, f.totalCent, f.ajuste]).toEqual([12000, 2520, 14520, null])
    expect(f.lineas.map((l) => [l.concepto, l.cantidad, l.precioCent, l.baseCent, l.trabajadoresEn])).toEqual([
      ['Gestoría mensual', 1, 8000, 8000, null], ['Gestión laboral · 2 trabajadores', 2, 2000, 4000, 'linea'],
    ])
    expect(f.lineas[1].trabajadores).toEqual([{ nombre: 'Persona Prueba 1', desde: null }, { nombre: 'Persona Prueba 2', desde: null }])
    expect(f.hoja).toEqual([])
  })
  it('hasta 10 trabajadores, debajo de su línea; con 11, en la hoja aparte', () => {
    expect(TRABAJADORES_EN_LA_LINEA).toBe(10)
    const diez = facturaDelRecibo(reciboDe(asignaciones(Array.from({ length: 10 }, (_, i) => trabajador(`Persona Prueba ${i + 1}`)))), CON_IVA)
    expect([diez.lineas[1].trabajadoresEn, diez.hoja]).toEqual(['linea', []])
    const once = facturaDelRecibo(reciboDe(asignaciones(Array.from({ length: 11 }, (_, i) => trabajador(`Persona Prueba ${i + 1}`)))), CON_IVA)
    expect([once.lineas[1].trabajadoresEn, once.hoja[0].servicio, once.hoja[0].trabajadores.length]).toEqual(['hoja', 'Gestión laboral', 11])
  })
  it('con un solo trabajador, «1 trabajador», no «1 trabajadores»', () => {
    const f = facturaDelRecibo(reciboDe(asignaciones([trabajador('Persona Prueba 1')])), CON_IVA)
    expect(f.lineas[1].concepto).toBe('Gestión laboral · 1 trabajador')
  })
  it('la factura y el cobro, al céntimo, para cualquier total: lo comprueba con todos de 0,01 € a 300,00 €', () => {
    let exactos = 0
    for (let t = 1; t <= 30000; t++) {
      const b = baseParaElTotal(t, CON_IVA)
      const total = totalConBase(b.baseCent, CON_IVA)
      if (b.exacta) { exactos++; expect(total).toBe(t) } else { expect(total).toBeLessThan(t); expect(t - total).toBeLessThanOrEqual(1) }
    }
    // Con el 21 %, unos pocos totales no salen con ningún céntimo de base (sube de 2 en 2 en algunos puntos).
    expect(exactos).toBeGreaterThan(30000 * 0.8)
  })
  it('un total que no sale: se dice antes de cobrar y se cobra lo que dirá la factura, nunca de más', () => {
    let t = 1; while (baseParaElTotal(t, CON_IVA).exacta) t++
    const r = { ...reciboDe(), totalCent: t, lineas: [{ ...reciboDe().lineas[0], importeCent: t }] }
    const f = facturaDelRecibo(r, CON_IVA)
    expect(f.totalCent).toBe(t - 1)
    expect(f.ajuste?.cent).toBe(1)
    expect(f.ajuste?.porque).toMatch(/no sale con ninguna base: se cobra y se factura/)
  })
  it('las bases de las líneas suman la base de la factura; el céntimo que sobra va a la que no es por trabajador', () => {
    const base = reciboDe()
    const r = { ...base, totalCent: 10001 + 4840, lineas: [{ ...base.lineas[0], importeCent: 10001 }, base.lineas[1]] }
    const f = facturaDelRecibo(r, CON_IVA)
    expect(f.lineas.reduce((s, l) => s + l.baseCent, 0)).toBe(f.baseCent)
    expect(totalConBase(f.baseCent, CON_IVA)).toBe(f.totalCent)
    expect([f.lineas[1].cantidad, f.lineas[1].precioCent]).toEqual([2, 2000])
    expect(f.lineas.every((l) => l.cantidad * l.precioCent === l.baseCent)).toBe(true)
  })
  it('sin el IVA dentro: la tarifa es la base y se cobra base + IVA; con retención, se resta', () => {
    const f = facturaDelRecibo(reciboDe(), { ivaPct: 21, retencionPct: 0, preciosConIva: false })
    expect([f.baseCent, f.ivaCent, f.totalCent]).toEqual([14520, 3049, 17569])
    const g = facturaDelRecibo(reciboDe(), { ivaPct: 21, retencionPct: 15, preciosConIva: true })
    expect([g.baseCent + g.ivaCent - g.retencionCent, g.totalCent]).toEqual([14520, 14520])
  })
  it('lo que recibe conta_venta_guardar: cantidad y precio de cada uno, en euros (sin IVA)', () => {
    expect(lineasParaGuardar(facturaDelRecibo(reciboDe(), CON_IVA))).toEqual([
      { concepto: 'Gestoría mensual', cantidad: 1, precio: 80, descuento: 0, iva_pct: 21 },
      { concepto: 'Gestión laboral · 2 trabajadores', cantidad: 2, precio: 20, descuento: 0, iva_pct: 21 },
    ])
  })
  it('un recibo parado no se factura', () => {
    expect(() => facturaDelRecibo({ ...reciboDe(), parado: ['Una línea sin precio: X'] }, CON_IVA)).toThrow('Un recibo parado no se factura')
  })
})
