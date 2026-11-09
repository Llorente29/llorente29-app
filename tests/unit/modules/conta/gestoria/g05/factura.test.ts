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
    expect([f.baseCent, f.ivaCent, f.totalCent, f.cuotaAjustada]).toEqual([12000, 2520, 14520, null])
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
  it('nº 62 · para cualquier total de 0,01 € a 1.000,00 €, base + IVA es justo el total, y el IVA se aparta de base × tipo como mucho un céntimo', () => {
    let exactos = 0
    for (let t = 1; t <= 100000; t++) {
      const b = baseParaElTotal(t, CON_IVA)
      expect(b.baseCent + b.ivaCent).toBe(t)
      const redondeado = Math.round(b.baseCent * 0.21 + 1e-9)
      if (b.exacta) { exactos++; expect(b.ivaCent).toBe(redondeado) } else expect(Math.abs(b.ivaCent - redondeado)).toBe(1)
      // Dentro de lo que acepta Verifactu en la cuota (±10 €), con muchísimo margen.
      expect(Math.abs(b.ivaCent - (b.baseCent * 21) / 100)).toBeLessThan(1)
    }
    // Con el 21 %, cada céntimo de base sube el total 1,21: unos 17 de cada 100 totales no salen con ninguna base
    // (82.645 de 100.000 sí).
    expect(exactos).toBe(82645)
  })
  it('nº 62 · los importes que dio Julio: 145,00 € (la demo) = 119,83 + 25,17 y 74,20 € (QBO) = 61,32 + 12,88; y otros que no salen', () => {
    const de = (t: number) => { const r = { ...reciboDe(), totalCent: t, lineas: [{ ...reciboDe().lineas[0], importeCent: t }] }; return facturaDelRecibo(r, CON_IVA) }
    const f = de(14500)
    expect([f.baseCent, f.ivaCent, f.totalCent]).toEqual([11983, 2517, 14500])
    expect(f.cuotaAjustada?.cent).toBe(1)
    expect(f.cuotaAjustada?.porque).toBe('145,00 € no sale con ninguna base y su IVA redondeado: base 119,83 € e IVA 25,17 € (un céntimo más que 25,16 €, dentro del margen de Verifactu). Se cobra y se factura 145,00 €')
    expect(f.lineas.map((l) => [l.baseCent, l.ivaCent])).toEqual([[11983, 2517]])
    const g = de(7420)
    expect([g.baseCent, g.ivaCent, g.totalCent, g.cuotaAjustada]).toEqual([6132, 1288, 7420, null])
    // Otros totales que no salen con ninguna base (los primeros por encima de 100, 200 y 500 €, sacados del cálculo).
    const sinBase = [10000, 20000, 50000].map((d) => { let t = d; while (baseParaElTotal(t, CON_IVA).exacta) t++; return t })
    for (const t of sinBase) {
      const x = de(t)
      expect(x.totalCent).toBe(t)
      expect(x.baseCent + x.ivaCent).toBe(t)
      expect(Math.abs(x.cuotaAjustada!.cent)).toBe(1)
    }
  })
  it('nº 62 · con el IVA ajustado, las cuotas de las líneas suman justo el IVA y el céntimo va a la línea que no es por trabajador', () => {
    const base = reciboDe()
    const r = { ...base, totalCent: 14500, lineas: [{ ...base.lineas[0], importeCent: 10500 }, base.lineas[1]] }
    const f = facturaDelRecibo(r, CON_IVA)
    expect(f.totalCent).toBe(14500)
    expect(f.lineas.reduce((s, l) => s + l.ivaCent, 0)).toBe(f.ivaCent)
    expect(f.lineas.reduce((s, l) => s + l.baseCent, 0) + f.ivaCent).toBe(14500)
    expect(f.lineas[1].ivaCent).toBe(Math.round(f.lineas[1].baseCent * 0.21))
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
      { concepto: 'Gestoría mensual', cantidad: 1, precio: 80, descuento: 0, iva_pct: 21, cuota: 16.8 },
      { concepto: 'Gestión laboral · 2 trabajadores', cantidad: 2, precio: 20, descuento: 0, iva_pct: 21, cuota: 8.4 },
    ])
  })
  it('la retención: sin retención, 15 % o 7 %; cualquier otra, no', () => {
    expect(facturaDelRecibo(reciboDe(), { ivaPct: 21, retencionPct: 7, preciosConIva: true }).totalCent).toBe(14520)
    expect(() => facturaDelRecibo(reciboDe(), { ivaPct: 21, retencionPct: 19, preciosConIva: true })).toThrow('sin retención, 15 % o 7 %')
  })
  it('un recibo parado no se factura', () => {
    expect(() => facturaDelRecibo({ ...reciboDe(), parado: ['Una línea sin precio: X'] }, CON_IVA)).toThrow('Un recibo parado no se factura')
  })
})
