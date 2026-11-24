// tests/unit/modules/conta/k11a/baseFicha.test.ts
//
// K11a · La base de la ficha de la recibida copiada de ERP10: el % de IVA deducible en la propuesta (lo no
// deducible a la cuenta de gasto de su línea) y los datos de cada línea (concepto, marca y plataforma).
// Proveedores e importes inventados.
import { describe, expect, it } from 'vitest'
import { partirIvaDeducible, repartirPorPeso } from '@/modules/conta/lib/ivaDeducible'
import { facturaProveedor, type CuentasFactura, type EntradaFactura } from '@/modules/conta/lib/asientosPropuestos'
import { aplicarDatosDeLineas, type LineaConCanal } from '@/modules/conta/lib/recibidaGuardada'

const cuentas: CuentasFactura = {
  proveedor: '41000099',
  ivaSoportado: (p) => ({ cuenta: `472000${p}`, tipoId: `t${p}` }),
  retencion: '47510000',
  autoliquidada: (t) => ({ tipoId: t, porcentaje: 21, soportado: '47200021', repercutido: '47700021' }),
}
const entrada = (o: Partial<EntradaFactura> = {}): EntradaFactura => ({
  id: 'f1', numero: 'K11A-1', fecha: '2026-10-05', proveedor: 'Alquiler de Coches de Prueba', terceroId: 'p1', esSocio: false, tieneNif: true, localId: 'l1',
  lineas: [{ base: 100, tipo: { id: 't21', porcentaje: 21 }, cuentaGasto: '62100000' }], total: 121, retencion: null, autoliquidacion: null, ...o,
})
const vista = (p: { lineas: readonly { cuenta: string; debe: number; haber: number; iva?: { base: number; deducible?: string | null } }[] }) =>
  p.lineas.map((l) => [l.cuenta, l.debe, l.haber, l.iva ? `${l.iva.deducible} ${l.iva.base}` : null])

describe('el % de IVA deducible, en céntimos', () => {
  it('sin % o al 100: todo deducible', () => {
    expect(partirIvaDeducible(2100, 10000, null)).toEqual({ cuota: 2100, base: 10000, cuotaNo: 0, baseNo: 0 })
    expect(partirIvaDeducible(2100, 10000, 100)).toEqual({ cuota: 2100, base: 10000, cuotaNo: 0, baseNo: 0 })
  })
  it('al 50: la mitad; con un céntimo impar, el redondeo va a lo deducible y lo demás a lo no deducible (suman la cuota)', () => {
    expect(partirIvaDeducible(2100, 10000, 50)).toEqual({ cuota: 1050, base: 5000, cuotaNo: 1050, baseNo: 5000 })
    const x = partirIvaDeducible(2101, 10005, 50)
    expect(x.cuota + x.cuotaNo).toBe(2101)
    expect(x.base + x.baseNo).toBe(10005)
  })
  it('al 0: nada deducible', () => {
    expect(partirIvaDeducible(2100, 10000, 0)).toEqual({ cuota: 0, base: 0, cuotaNo: 2100, baseNo: 10000 })
  })
  it('repartir por peso: suma lo mismo, y el resto a la última', () => {
    expect(repartirPorPeso(1001, [['a', 1], ['b', 1]])).toEqual([['a', 501], ['b', 500]])
    expect(repartirPorPeso(1000, [['a', 3000], ['b', 1000]])).toEqual([['a', 750], ['b', 250]])
  })
})

describe('la propuesta de la recibida con el % deducible (regla 10: por la propuesta, no por la fórmula)', () => {
  it('al 100 % (o sin decir), como siempre: gasto, 472 y proveedor', () => {
    const a = facturaProveedor(entrada(), cuentas).propuesta!
    const b = facturaProveedor(entrada({ ivaDeduciblePct: 100 }), cuentas).propuesta!
    expect(vista(a)).toEqual([['62100000', 100, 0, null], ['4720002' + '1', 21, 0, 'yes 100'], ['41000099', 0, 121, null]])
    expect(vista(b)).toEqual(vista(a))
  })
  it('al 50 %: la mitad del IVA a la 472, la otra mitad a la cuenta de gasto (IVA no deducible al libro), y el proveedor por el total', () => {
    const p = facturaProveedor(entrada({ ivaDeduciblePct: 50 }), cuentas).propuesta!
    expect(vista(p)).toEqual([
      ['62100000', 100, 0, null], ['47200021', 10.5, 0, 'yes 50'], ['62100000', 10.5, 0, 'no 50'], ['41000099', 0, 121, null],
    ])
    expect(p.lineas[2].concepto).toBe('IVA no deducible 21 %')
    expect(p.razones.some((r) => r.decision === 'IVA deducible al 50 %')).toBe(true)
    const debe = p.lineas.reduce((t, l) => t + Math.round(l.debe * 100), 0); const haber = p.lineas.reduce((t, l) => t + Math.round(l.haber * 100), 0)
    expect(debe).toBe(haber)
  })
  it('con dos cuentas de gasto del mismo tipo, lo no deducible se reparte según su base', () => {
    const p = facturaProveedor(entrada({ ivaDeduciblePct: 50, total: 242,
      lineas: [{ base: 150, tipo: { id: 't21', porcentaje: 21 }, cuentaGasto: '62100000' }, { base: 50, tipo: { id: 't21', porcentaje: 21 }, cuentaGasto: '62800000' }] }), cuentas).propuesta!
    expect(p.lineas.filter((l) => l.iva?.deducible === 'no').map((l) => [l.cuenta, l.debe, l.iva!.base])).toEqual([['62100000', 15.75, 75], ['62800000', 5.25, 25]])
  })
  it('una autoliquidada al 50 %: la 477 por la cuota entera, la 472 por la mitad y la otra mitad al gasto', () => {
    const p = facturaProveedor(entrada({ ivaDeduciblePct: 50, lineas: [{ base: 100, tipo: null, cuentaGasto: '62900005' }], total: 100,
      autoliquidacion: { tipo: 'ue_compra', porque: 'Compra en otro país de la UE.' } }), cuentas).propuesta!
    expect(vista(p)).toEqual([
      ['62900005', 100, 0, null], ['47200021', 10.5, 0, 'yes 50'], ['62900005', 10.5, 0, 'no 50'], ['47700021', 0, 21, null], ['41000099', 0, 100, null],
    ])
  })
  it('el IVA no deducible entero (vat_non_deductible) manda sobre el %', () => {
    const p = facturaProveedor(entrada({ ivaNoDeducible: true, ivaDeduciblePct: 50 }), cuentas).propuesta!
    expect(p.lineas.some((l) => l.iva?.deducible === 'yes')).toBe(false)
  })
})

describe('los datos de cada línea (concepto, marca y plataforma)', () => {
  it('van a las líneas de gasto por su orden, y su IVA no deducible lleva su marca y su plataforma', () => {
    const p = facturaProveedor(entrada({ ivaDeduciblePct: 50, marcaId: 'marca-factura' }), cuentas).propuesta!
    const q = aplicarDatosDeLineas(p, [{ posicion: 0, concepto: 'Renting de prueba', marcaId: 'marca-1', canalId: 'canal-1' }])
    const l = q.lineas as LineaConCanal[]
    expect(l.map((x) => [x.cuenta, x.concepto ?? null, x.marcaId ?? null, x.canalId ?? null])).toEqual([
      ['62100000', 'Renting de prueba', 'marca-1', 'canal-1'],
      ['47200021', null, 'marca-factura', null],
      ['62100000', 'IVA no deducible 21 %', 'marca-1', 'canal-1'],
      ['41000099', null, 'marca-factura', null],
    ])
  })
  it('sin datos, la propuesta como estaba', () => {
    const p = facturaProveedor(entrada(), cuentas).propuesta!
    expect(aplicarDatosDeLineas(p, [])).toBe(p)
  })
})
