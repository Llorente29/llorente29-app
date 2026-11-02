// S01h · 2 (apuntado del S01h, encargo S01j) · En un abono, «A qué gasto va»
// enseñaba la 60000000 aunque el asiento la llevara a la 60800000. La casilla
// tiene que decir lo mismo que el asiento: la cuenta de devoluciones de la
// compra, si la propuesta la trae. Una factura normal, igual que antes.
// Plan de Foodint (60000000 y 60800000 de plantilla); el proveedor es inventado.
import { describe, expect, it } from 'vitest'
import { comoAbono, facturaProveedor, plantillaDevolucion } from '@/modules/conta/lib/asientosPropuestos'
import { cuentaDelGastoEnAsiento, cuentasDeLaPropuesta } from '@/modules/conta/documentos/fichaRecibida'

const PLAN: Record<string, string> = {
  '40000006': 'Proveedores · Obrador de prueba', '47200004': 'IVA soportado 4 %', '47200010': 'IVA soportado 10 %',
  '60000000': 'Compras de mercaderías', '60800000': 'Devoluciones de compras de mercaderías', '62900000': 'Otros servicios',
}
const nombre = (c: string) => PLAN[c] ?? 'Cuenta'
const factura = (cuentaGasto: string) => facturaProveedor({
  id: 'a1', numero: 'PRUEBA-1', fecha: '2026-10-13', proveedor: 'Obrador de prueba', terceroId: 't', esSocio: false, tieneNif: true, localId: 'l1',
  lineas: [{ base: 26.58, tipo: { id: 't4', porcentaje: 4 }, cuentaGasto }, { base: 134.38, tipo: { id: 't10', porcentaje: 10 }, cuentaGasto }],
  total: 175.46, retencion: null,
  cuotas: [{ porcentaje: 4, base: 26.58, cuota: 1.06 }, { porcentaje: 10, base: 134.38, cuota: 13.44 }],
}, {
  proveedor: '40000006', retencion: '47510000',
  ivaSoportado: (p: number) => ({ 4: { cuenta: '47200004', tipoId: 't4' }, 10: { cuenta: '47200010', tipoId: 't10' } } as Record<number, { cuenta: string; tipoId: string }>)[p] ?? null,
}).propuesta!

describe('S01h · 2 · «A qué gasto va» en un abono', () => {
  it('un abono de una compra enseña la 60800000, la del asiento, no la 60000000', () => {
    const p = comoAbono(factura('60000000'), (c) => (plantillaDevolucion(c) ? '60800000' : null), 'la PRUEBA-0')
    const c = cuentasDeLaPropuesta(p.lineas, nombre)
    expect(cuentaDelGastoEnAsiento('60000000', c)).toEqual({ codigo: '60800000', nombre: 'Devoluciones de compras de mercaderías' })
  })
  it('un abono de un servicio (sin devolución propia) y una factura normal: la misma cuenta (nada que cambiar)', () => {
    const servicio = comoAbono(factura('62900000'), (c) => (plantillaDevolucion(c) ? '60800000' : null), 'la PRUEBA-0')
    expect(cuentaDelGastoEnAsiento('62900000', cuentasDeLaPropuesta(servicio.lineas, nombre))).toBeNull()
    expect(cuentaDelGastoEnAsiento('60000000', cuentasDeLaPropuesta(factura('60000000').lineas, nombre))).toBeNull()
    expect(cuentaDelGastoEnAsiento('60000000', null)).toBeNull()
    expect(cuentaDelGastoEnAsiento('', null)).toBeNull()
  })
})
