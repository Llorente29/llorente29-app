import { describe, expect, it } from 'vitest'
import { noConfirmadoPagado, ventasDelDia, diaYMes, type PedidoDia, type EntradaVentasDia } from '@/modules/conta/lib/asientosPropuestos'
import { cuadre } from '@/modules/conta/lib/libro'

// Cierre del día · T4. La población es la de producción (PR #171): el pedido
// 234 de Glovo, 20,40 €, del 06/10 en Carabanchel, esperando recogida, que el
// cierre dejaría como no confirmado; y los tres del 02/10 en Alcalá.
const GLOVO = 'canal-glovo', UBER = 'canal-uber'
const CARABANCHEL = 'loc-carabanchel'
const IVA10 = { id: 'tipo-10', porcentaje: 10 }
const ctx: Omit<EntradaVentasDia, 'pedidos' | 'devoluciones' | 'fecha'> = {
  localId: CARABANCHEL, tipo: IVA10, porMarca: true, nombreLocal: 'Carabanchel',
  cuentas: { cobroPorCanal: { [GLOVO]: '43000001', [UBER]: '43000002' }, ventas: '70000000', devoluciones: '70800000', ivaRepercutido: '47700010' },
  nombreCanal: (id) => ({ [GLOVO]: 'Glovo', [UBER]: 'Uber Eats' } as Record<string, string>)[id ?? ''] ?? 'sin canal',
}
const p234: PedidoDia = { id: 'venta-234', codigo: '234', canalId: GLOVO, marcaId: 'marca-smash', marcaPropia: true, estado: 'unconfirmed', total: 20.4, base: null, cuota: null, tiposEnLineas: [] }
const liq = { ref: 'G-2026-10-B', fecha: '2026-10-14' }

describe('la liquidación manda: un no confirmado que la plataforma paga es venta de su día', () => {
  it('el porqué es la frase del encargo, con su pedido y su día', () => {
    const r = noConfirmadoPagado({ pedido: p234, dia: '2026-10-06', liquidacion: liq, diaValidado: false }, ctx)
    expect(r.propuesta!.porque).toBe('Glovo ha pagado el pedido 234, que se cerró sin confirmar el 6 de octubre')
    expect(r.propuesta!.origen).toEqual({ tipo: 'sales_adjustment', id: 'venta-234' })
    expect(r.propuesta!.fecha).toBe('2026-10-06')
    expect(r.propuesta!.documento).toBe('234')
  })

  it('sus líneas son las que tendría en el asiento del día: cobra Glovo 20,40; venta 18,55; IVA 1,85', () => {
    const r = noConfirmadoPagado({ pedido: p234, dia: '2026-10-06', liquidacion: liq, diaValidado: false }, ctx)
    const comoVentaDelDia = ventasDelDia({ ...ctx, fecha: '2026-10-06', pedidos: [{ ...p234, estado: 'closed' }], devoluciones: [] })
    expect(r.propuesta!.lineas).toEqual(comoVentaDelDia.propuesta!.lineas)
    expect(r.propuesta!.lineas.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([
      ['43000001', 20.4, 0], ['70000000', 0, 18.55], ['47700010', 0, 1.85],
    ])
    expect(cuadre(r.propuesta!.lineas).cuadra).toBe(true)
  })

  it('con el día ya validado, lo dice: va aparte y el validado no se toca', () => {
    const v = noConfirmadoPagado({ pedido: p234, dia: '2026-10-06', liquidacion: liq, diaValidado: true }, ctx)
    expect(v.propuesta!.razones[1].decision).toBe('Va aparte del asiento del día, que está validado y no se toca')
    const nv = noConfirmadoPagado({ pedido: p234, dia: '2026-10-06', liquidacion: liq, diaValidado: false }, ctx)
    expect(nv.propuesta!.razones[1].decision).toBe('Va aparte del asiento del día')
  })

  it('sin la 430 de la plataforma no se propone, y dice por qué', () => {
    const sin = noConfirmadoPagado({ pedido: { ...p234, canalId: 'canal-just-eat' }, dia: '2026-10-06', liquidacion: liq, diaValidado: false }, ctx)
    expect(sin.propuesta).toBeNull()
    expect(sin.sinPropuesta).toContain('No sé a qué cuenta va lo que cobra')
  })

  it('los tres del 02/10 de Alcalá, cada uno su propuesta y entre los tres 71,70 €', () => {
    const tres = [21.9, 22.4, 27.4].map((total, i) =>
      noConfirmadoPagado({ pedido: { ...p234, id: `v${i}`, codigo: ['854', '153', 'D6B55'][i], total }, dia: '2026-10-02', liquidacion: liq, diaValidado: true }, ctx))
    expect(tres.map((t) => t.propuesta!.origen.id)).toEqual(['v0', 'v1', 'v2'])
    const cobrado = tres.reduce((s, t) => s + Math.round(t.propuesta!.lineas[0].debe * 100), 0)
    expect(cobrado).toBe(7170)
    expect(tres[2].propuesta!.porque).toBe('Glovo ha pagado el pedido D6B55, que se cerró sin confirmar el 2 de octubre')
  })

  it('las fechas en palabras: 1 de enero, 31 de diciembre', () => {
    expect(diaYMes('2026-01-01')).toBe('1 de enero')
    expect(diaYMes('2026-12-31')).toBe('31 de diciembre')
  })
})
