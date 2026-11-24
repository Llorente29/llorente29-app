// tests/unit/modules/conta/k13/tramos.test.ts
//
// K13 · El reparto analítico en la propuesta: una línea de gasto con dos o más tramos (20261124T0001) sale en el asiento
// como una línea por tramo, cada una con su local, marca y plataforma. Si los tramos no suman la línea, la línea se queda
// entera y la propuesta, en duda, lo dice.
import { describe, expect, it } from 'vitest'
import { facturaProveedor, type CuentasFactura, type EntradaFactura } from '@/modules/conta/lib/asientosPropuestos'
import { aplicarTramos, type LineaConCanal } from '@/modules/conta/lib/recibidaGuardada'

const cuentas: CuentasFactura = {
  proveedor: '41000099',
  ivaSoportado: (p) => ({ cuenta: `472000${p}`, tipoId: `t${p}` }),
  retencion: '47510000',
  autoliquidada: (t) => ({ tipoId: t, porcentaje: 21, soportado: '47200021', repercutido: '47700021' }),
}
const entrada = (o: Partial<EntradaFactura> = {}): EntradaFactura => ({
  id: 'f1', numero: 'K13-1', fecha: '2026-11-05', proveedor: 'Proveedor de Prueba K13', terceroId: 'p1', esSocio: false, tieneNif: true, localId: 'l1',
  lineas: [{ base: 100, tipo: { id: 't21', porcentaje: 21 }, cuentaGasto: '60000000' }], total: 121, retencion: null, autoliquidacion: null, ...o,
})
const vista = (ls: readonly LineaConCanal[]) => ls.map((l) => [l.cuenta, l.debe, l.haber, l.localId ?? null, l.marcaId ?? null, l.canalId ?? null])

describe('K13 · los tramos del reparto en la propuesta', () => {
  it('dos tramos que suman la línea: dos líneas de gasto, cada una con su analítica; el resto, igual', () => {
    const p = facturaProveedor(entrada(), cuentas).propuesta!
    const q = aplicarTramos(p, [
      { posicion: 0, tramo: 0, localId: 'l1', marcaId: 'm1', canalId: null, importe: 60 },
      { posicion: 0, tramo: 1, localId: 'l2', marcaId: null, canalId: 'c1', importe: 40 },
    ])
    expect(vista((q.lineas as LineaConCanal[]).slice(0, 2))).toEqual([
      ['60000000', 60, 0, 'l1', 'm1', null],
      ['60000000', 40, 0, 'l2', null, 'c1'],
    ])
    // El IVA y el proveedor, como estaban.
    expect(q.lineas.slice(2)).toEqual(p.lineas.slice(1))
    const debe = q.lineas.reduce((t, l) => t + l.debe, 0)
    const haber = q.lineas.reduce((t, l) => t + l.haber, 0)
    expect(Math.round(debe * 100)).toBe(Math.round(haber * 100))
    expect(q.confianza).toBe(p.confianza)
  })
  it('si no suman: la línea entera, la propuesta en duda y el aviso de cuánto suma', () => {
    const p = facturaProveedor(entrada(), cuentas).propuesta!
    const q = aplicarTramos(p, [
      { posicion: 0, tramo: 0, localId: 'l1', marcaId: null, canalId: null, importe: 60 },
      { posicion: 0, tramo: 1, localId: 'l2', marcaId: null, canalId: null, importe: 30 },
    ])
    expect(q.lineas.length).toBe(p.lineas.length)
    expect(q.confianza).toBe('duda')
    expect(q.avisos.at(-1)).toMatch(/^El reparto de la línea 1 suma 90,00 .* y la línea es 100,00 .*: corrígelo en la ficha\.$/)
  })
  it('sin tramos, o con uno solo: la propuesta como estaba', () => {
    const p = facturaProveedor(entrada(), cuentas).propuesta!
    expect(aplicarTramos(p, [])).toBe(p)
    expect(aplicarTramos(p, [{ posicion: 0, tramo: 0, localId: 'l1', marcaId: null, canalId: null, importe: 100 }])).toBe(p)
  })
})
