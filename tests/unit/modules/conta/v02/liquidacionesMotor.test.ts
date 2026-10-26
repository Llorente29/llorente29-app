// tests/unit/modules/conta/v02/liquidacionesMotor.test.ts
//
// V02 · Entrega 2 · Leer las filas del motor (conta_liquidaciones) y nombrar sus
// estados con las palabras de la calle. La fila de ejemplo es la que dio el
// motor en la prueba de la tanda (la semana de Uber de Norte Centro, con su
// liquidación y sin su factura de comisión), con la forma de la 0125: por tienda
// (marca), lo vendido por sus pedidos y lo que suman los pedidos de la liquidación.

import { describe, expect, it } from 'vitest'
import { cifrasMotor, filaMotor, nombreEstado, TONO, type FilaMotor } from '@/modules/conta/lib/liquidacionesMotor'

const FILA = {
  canal: 'Uber Eats', clave: '1e4057a7-8e30-4398-8797-c17b6c6be49c:c01a0000-0000-4000-8000-0000000000a2:2026-09-28:2026-10-04', desde: '2026-09-28',
  frase: 'Falta su factura de comisión: cuando llegue a Compras, se engancha.', hasta: '2026-10-04', local: 'Norte Centro', plazo: '2026-10-10', avisos: [],
  estado: 'falta_factura',
  piezas: {
    cobro: { llegado: null, esperado: 70, por_cobrar: 1 }, factura: { faltan: 1 },
    vendido: { via: 'pedidos', total: 100, pedidos: { dias: 1, total: 100, pedidos: 4 }, facturas: null },
    liquidacion: { n: 1, otros: 0.0, pagan: 70, ventas: 135, pedidos_total: 100, comision: 30, referencia: false },
  },
  cerrada: false, canal_id: 'e0200000-0000-4000-8000-00000000a0c2', local_id: 'c01a0000-0000-4000-8000-0000000000a2', marca_id: 'e0200000-0000-4000-8000-00000000a0b1', marca: 'Burger Prueba', diferencia: null, resoluciones: [],
  intermediario: 'Reparto Rápido Inventado',
  liquidaciones: [{ id: 'b3aeaf71-fc9b-49cf-a4a1-cf4d62742174', ref: null, neto: 70, fecha: '2026-10-05', origen: 'correo_uber',
    tienda: 'Burger Prueba V02L (Calle Prueba Liquidaciones 1, Madrid, ES, 28001)', ventas: 135, pedidos_total: 100, cobrado: null, factura: null, pedidos: 4, comision: 30,
    a_facturar: 30, cobrado_el: null, referencia: false, por_aclarar: null, facturas_nota: null, casada_en_banco: false, facturas_cobradas: null }],
  intermediario_id: '1e4057a7-8e30-4398-8797-c17b6c6be49c', reclamado_sin_llegar: 0,
}

describe('el motor, en el navegador', () => {
  const f = filaMotor(FILA)

  it('lee la fila con sus cuatro piezas', () => {
    expect([f.intermediario, f.local, f.desde, f.hasta, f.estado, f.cerrada]).toEqual(['Reparto Rápido Inventado', 'Norte Centro', '2026-09-28', '2026-10-04', 'falta_factura', false])
    expect([f.marca, f.vendido.via, f.vendido.total, f.vendido.pedidos, f.liquidacion.ventas, f.liquidacion.pedidosTotal, f.liquidacion.comision, f.liquidacion.pagan, f.faltanFacturas, f.cobro.esperado, f.cobro.llegado])
      .toEqual(['Burger Prueba', 'pedidos', 100, 4, 135, 100, 30, 70, 1, 70, null])
    expect(f.liquidaciones[0]).toMatchObject({ origen: 'correo_uber', ventas: 135, pedidosTotal: 100, aFacturar: 30, factura: null, casadaEnBanco: false })
  })

  it('los estados, con las palabras de la calle; la diferencia lleva su importe', () => {
    const nombres = (['cuadra', 'esperando_liquidacion', 'falta_liquidacion', 'falta_factura', 'esperando_cobro'] as const).map((estado) => nombreEstado({ estado, diferencia: null }))
    expect(nombres).toEqual(['Cuadra', 'Esperando liquidación', 'Falta su liquidación', 'Falta su factura', 'Esperando el cobro'])
    expect(nombreEstado({ estado: 'diferencia', diferencia: -5 })).toBe('Diferencia de 5,00 €')
    expect(nombreEstado({ estado: 'diferencia', diferencia: 1234.5 })).toBe('Diferencia de 1234,50 €')
    expect([TONO.cuadra, TONO.diferencia, TONO.esperando_cobro]).toEqual(['seguro', 'falta', 'propuesto'])
  })

  it('un estado que no conoce se trata como diferencia (nunca como «Cuadra»)', () => {
    expect(filaMotor({ ...FILA, estado: 'otro' }).estado).toBe('diferencia')
  })

  it('las cifras de arriba suman todas las filas (regla 7) y lo que suman las diferencias', () => {
    const con = (estado: FilaMotor['estado'], diferencia: number | null = null, reclamado = 0): FilaMotor => ({ ...f, estado, diferencia, reclamadoSinLlegar: reclamado })
    const c = cifrasMotor([con('cuadra', null, 5), con('esperando_liquidacion'), con('esperando_cobro'), con('falta_liquidacion'), con('falta_factura'), con('diferencia', 5), con('diferencia', -2.5)])
    expect(c).toEqual({ total: 7, cuadran: 1, esperando: 2, faltan: 2, diferencias: 2, importeDiferencias: 7.5, reclamado: 5 })
  })
})
