// S01h · El asiento de un abono de proveedor: el de su factura, al revés, con
// cada importe en positivo en su columna (journal_line_debe_o_haber). Dos
// casos: las cifras del abono 1506416 (10 % y 4 %) con un proveedor inventado,
// y uno inventado con 21 % y 10 %.
import { describe, expect, it } from 'vitest'
import { comoAbono, facturaProveedor, plantillaDevolucion } from '@/modules/conta/lib/asientosPropuestos'
import { cuadre } from '@/modules/conta/lib/libro'

const c = {
  proveedor: '40000099', retencion: '47510000',
  ivaSoportado: (p: number) => ({ 4: { cuenta: '47200004', tipoId: 't4' }, 10: { cuenta: '47200010', tipoId: 't10' }, 21: { cuenta: '47200021', tipoId: 't21' } } as Record<number, { cuenta: string; tipoId: string }>)[p] ?? null,
}
const conPlan = (plan: string[]) => (cuenta: string) => {
  const p = plantillaDevolucion(cuenta)
  return p ? (plan.find((x) => x.startsWith(p)) ?? null) : null
}
const filas = (l: { cuenta: string; debe: number; haber: number }[]) => l.map((x) => [x.cuenta, x.debe, x.haber])

describe('S01h · la cuenta de devoluciones', () => {
  it('600 → 608, 601 → 6081, 602 → 6082; un servicio no tiene', () => {
    expect(plantillaDevolucion('60000000')).toBe('6080')
    expect(plantillaDevolucion('60100000')).toBe('6081')
    expect(plantillaDevolucion('60200000')).toBe('6082')
    expect(plantillaDevolucion('62300000')).toBeNull()
  })
})

describe('S01h · el abono, al revés que su factura', () => {
  const abono = facturaProveedor({
    id: 'a1', numero: '1506416', fecha: '2026-10-13', proveedor: 'Obrador de prueba', terceroId: 't', esSocio: false, tieneNif: true, localId: 'l1',
    lineas: [{ base: 134.38, tipo: { id: 't10', porcentaje: 10 }, cuentaGasto: '60000000' }, { base: 26.58, tipo: { id: 't4', porcentaje: 4 }, cuentaGasto: '60000000' }],
    total: 175.46, retencion: null,
    cuotas: [{ porcentaje: 10, base: 134.38, cuota: 13.44 }, { porcentaje: 4, base: 26.58, cuota: 1.06 }],
  }, c).propuesta!

  it('las cifras del 1506416: Debe el proveedor 175,46; Haber 608 160,96 y el IVA de cada tipo', () => {
    const p = comoAbono(abono, conPlan(['60800000', '60000000']), 'la 24056558')
    expect(filas(p.lineas)).toEqual([['60800000', 0, 160.96], ['47200010', 0, 13.44], ['47200004', 0, 1.06], ['40000099', 175.46, 0]])
    expect(p.lineas.every((l) => l.debe >= 0 && l.haber >= 0 && (l.debe === 0) !== (l.haber === 0))).toBe(true)
    expect(cuadre(p.lineas).cuadra).toBe(true)
    expect(p.concepto.startsWith('Abono')).toBe(true)
    expect(p.razones[0].porque).toContain('Anula la 24056558')
    expect(p.razones[1].decision).toBe('Devolución de compras: 60800000')
  })

  it('el IVA sigue con su tipo y su base, y en el Haber: el libro lo lee restando', () => {
    const p = comoAbono(abono, conPlan(['60800000']), null)
    const iva = p.lineas.filter((l) => l.iva)
    expect(iva.map((l) => [l.cuenta, l.iva!.tipo, l.iva!.base, l.haber])).toEqual([['47200010', 10, 134.38, 13.44], ['47200004', 4, 26.58, 1.06]])
  })

  it('sin cuenta de devoluciones en el plan, al Haber de la misma cuenta de la compra', () => {
    const p = comoAbono(abono, conPlan([]), null)
    expect(filas(p.lineas)[0]).toEqual(['60000000', 0, 160.96])
    expect(p.razones.some((r) => r.decision.startsWith('Devolución de compras'))).toBe(false)
  })

  it('inventado, 21 % y 10 %: 150,00 de base y 26,00 de IVA, 176,00 a tu favor', () => {
    const f = facturaProveedor({
      id: 'a2', numero: 'A-000123', fecha: '2026-11-05', proveedor: 'Proveedor de prueba', terceroId: 't2', esSocio: false, tieneNif: true, localId: 'l1',
      lineas: [{ base: 100, tipo: { id: 't21', porcentaje: 21 }, cuentaGasto: '60000000' }, { base: 50, tipo: { id: 't10', porcentaje: 10 }, cuentaGasto: '60000000' }],
      total: 176, retencion: null,
    }, c).propuesta!
    const p = comoAbono(f, conPlan(['60800000']), null)
    expect(filas(p.lineas)).toEqual([['60800000', 0, 150], ['47200021', 0, 21], ['47200010', 0, 5], ['40000099', 176, 0]])
    expect(cuadre(p.lineas).cuadra).toBe(true)
    expect(p.avisos).toEqual([])
  })
})
