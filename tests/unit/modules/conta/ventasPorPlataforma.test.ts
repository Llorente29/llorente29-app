// tests/unit/modules/conta/ventasPorPlataforma.test.ts
//
// C04b R5 · La regla de ventas definitiva (Julio, 13/10):
//   · un asiento por plataforma, local y día en Uber Eats y Just Eat;
//   · por marca, plataforma, local y día en Glovo;
//   · la venta a la subcuenta de la marca (7000000x) y el reembolso a la suya
//     (7080000x), con la marca escrita en la línea;
//   · el IVA a la 477 del tipo (47700010).
// Lo que no cambia sin unidad (la regla de antes) lo siguen probando
// libroC04.test.ts y la paridad con la base.
import { describe, expect, it } from 'vitest'
import { cuadre } from '@/modules/conta/lib/libro'
import {
  ventasDelDia, unidadesDelDia, claveDeUnidad,
  type PedidoDia, type DevolucionDia, type EntradaVentasDia,
} from '@/modules/conta/lib/asientosPropuestos'

const NORTE = 'loc-norte'
const GLOVO = 'canal-glovo', UBER = 'canal-uber', JE = 'canal-je'
const MERAKI = 'marca-meraki', LOVERS = 'marca-lovers', SCANDAL = 'marca-scandal', CEDIDA = 'marca-cedida'
const IVA10 = { id: 'tipo-10', porcentaje: 10 }
const NOMBRES: Record<string, string> = { [MERAKI]: 'Meraki Pita', [LOVERS]: 'Lovers Burgers', [SCANDAL]: 'Scandal Burgers', [CEDIDA]: 'Milanesa Haus' }

const pedido = (p: Partial<PedidoDia> & Pick<PedidoDia, 'id' | 'total'>): PedidoDia => ({
  codigo: p.id.toUpperCase(), canalId: UBER, marcaId: MERAKI, marcaPropia: true, estado: 'closed', base: null, cuota: null, tiposEnLineas: [], ...p,
})
const reembolso = (d: Partial<DevolucionDia> & Pick<DevolucionDia, 'importe'>): DevolucionDia => ({
  pedidoId: null, codigo: 'R1', canalId: UBER, marcaId: MERAKI, marcaPropia: true, conFactura: false, ...d,
})
// Scandal Burgers no tiene subcuenta de reembolsos en el plan (como en Foodint hasta la 0120).
const cuentas = {
  cobroPorCanal: { [GLOVO]: '43000001', [UBER]: '43000002', [JE]: '43000003' }, ventas: '70000000', devoluciones: '70800000', ivaRepercutido: '47700010',
  ventasPorMarca: { [MERAKI]: '70000002', [LOVERS]: '70000011', [SCANDAL]: '70000003' },
  devolucionesPorMarca: { [MERAKI]: '70800002', [LOVERS]: '70800011' },
}
const porMarca = (c: string | null) => c === GLOVO
const PEDIDOS: PedidoDia[] = [
  pedido({ id: 'u1', total: 15.9 }),
  pedido({ id: 'u2', total: 29.99, marcaId: LOVERS }),
  pedido({ id: 'g1', total: 22.4, canalId: GLOVO }),
  pedido({ id: 'g2', total: 18.95, canalId: GLOVO, marcaId: LOVERS }),
  pedido({ id: 'g3', total: 11, canalId: GLOVO }),
  pedido({ id: 'j1', total: 15.5, canalId: JE, marcaId: SCANDAL }),
  pedido({ id: 'c1', total: 24.2, canalId: UBER, marcaId: CEDIDA, marcaPropia: false }),
  pedido({ id: 'x1', total: 12, canalId: UBER, estado: 'cancelled' }),
]
const entrada = (extra: Partial<EntradaVentasDia> = {}): EntradaVentasDia => ({
  fecha: '2026-10-05', localId: NORTE, tipo: IVA10, pedidos: PEDIDOS, devoluciones: [], cuentas, porMarca: true,
  nombreCanal: (id) => ({ [GLOVO]: 'Glovo', [UBER]: 'Uber Eats', [JE]: 'Just Eat' } as Record<string, string>)[id ?? ''] ?? 'sin canal',
  nombreMarca: (id) => NOMBRES[id ?? ''] ?? 'una marca',
  nombreLocal: 'Local Norte', ...extra,
})

describe('C04b R5 · las unidades del día', () => {
  const us = unidadesDelDia(PEDIDOS, [], porMarca)
  it('Uber y Just Eat, una por plataforma; Glovo, una por marca; en el orden de sus pedidos', () => {
    expect(us.map((u) => u.clave)).toEqual([UBER, `${GLOVO}:${MERAKI}`, `${GLOVO}:${LOVERS}`, JE])
  })
  it('una cedida o un cancelado no abren unidad', () => {
    const solo = unidadesDelDia([pedido({ id: 'c', total: 9, canalId: JE, marcaPropia: false }), pedido({ id: 'x', total: 9, canalId: GLOVO, estado: 'cancelled' })], [], porMarca)
    expect(solo).toEqual([])
  })
  it('un reembolso sin ventas ese día sí abre la suya', () => {
    expect(unidadesDelDia([], [reembolso({ importe: 5, canalId: GLOVO, marcaId: LOVERS })], porMarca).map((u) => u.clave)).toEqual([`${GLOVO}:${LOVERS}`])
  })
  it('la clave: canal, o canal:marca; sin canal, «sin-canal»', () => {
    expect(claveDeUnidad(null, null)).toBe('sin-canal')
    expect(claveDeUnidad(GLOVO, LOVERS)).toBe(`${GLOVO}:${LOVERS}`)
  })
})

describe('C04b R5 · Uber Eats: un asiento por local y día, la venta a la subcuenta de cada marca', () => {
  const u = unidadesDelDia(PEDIDOS, [], porMarca).find((x) => x.canalId === UBER)!
  const r = ventasDelDia(entrada({ unidad: u }))
  const p = r.propuesta!
  it('solo los pedidos de Uber, sin la cedida ni el cancelado, y lo dice', () => {
    expect(r.resumen.pedidoIds).toEqual(['u1', 'u2'])
    expect(r.resumen.total).toBe(45.89)
    expect(r.resumen.cedidasFuera).toEqual({ pedidos: 1, total: 24.2 })
    expect(r.resumen.canceladosFuera).toBe(1)
  })
  it('cuadra: 430 de Uber al debe; 70000002 y 70000011 con su marca; IVA a 47700010', () => {
    expect(cuadre(p.lineas).cuadra).toBe(true)
    expect(p.lineas.map((l) => [l.cuenta, l.debe, l.haber, l.concepto])).toEqual([
      ['43000002', 45.89, 0, 'Cobra Uber Eats'],
      ['70000002', 0, 14.45, 'Ventas Meraki Pita'],
      ['70000011', 0, 27.26, 'Ventas Lovers Burgers'],
      ['47700010', 0, 4.18, 'IVA repercutido 10 %'],
    ])
    expect(p.lineas[1].marcaId).toBe(MERAKI)
  })
  it('el concepto dice la plataforma y el local', () => {
    expect(p.concepto).toBe('Ventas Uber Eats · Local Norte')
    expect(p.porque).toContain('en Uber Eats')
  })
})

describe('C04b R5 · Glovo: un asiento por marca, local y día', () => {
  const us = unidadesDelDia(PEDIDOS, [], porMarca).filter((x) => x.canalId === GLOVO)
  const [meraki, lovers] = us.map((u) => ventasDelDia(entrada({ unidad: u })).propuesta!)
  // La base, pedido a pedido como siempre: 22,40 → 20,36 y 11,00 → 10,00.
  it('cada marca, sus pedidos y su subcuenta; el concepto lleva la marca', () => {
    expect(meraki.concepto).toBe('Ventas Glovo · Meraki Pita · Local Norte')
    expect(meraki.lineas.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['43000001', 33.4, 0], ['70000002', 0, 30.36], ['47700010', 0, 3.04]])
    expect(lovers.lineas.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['43000001', 18.95, 0], ['70000011', 0, 17.23], ['47700010', 0, 1.72]])
  })
  it('las dos juntas son lo que cobra Glovo ese día, al céntimo', () => {
    expect(Math.round((meraki.lineas[0].debe + lovers.lineas[0].debe) * 100)).toBe(Math.round((22.4 + 18.95 + 11) * 100))
  })
})

describe('C04b R5 · el reembolso, separado de la venta, a la 708 de su marca y con su nombre', () => {
  const devs = [reembolso({ importe: 15.9, codigo: 'UB-77' })]
  const u = unidadesDelDia(PEDIDOS, devs, porMarca).find((x) => x.canalId === UBER)!
  const p = ventasDelDia(entrada({ unidad: u, devoluciones: devs })).propuesta!
  it('venta bruta en 7000000x, reembolso en 7080000x con la marca y el pedido', () => {
    expect(cuadre(p.lineas).cuadra).toBe(true)
    const r = p.lineas.filter((l) => l.documento === 'UB-77')
    expect(r.map((l) => [l.cuenta, l.debe, l.haber, l.concepto])).toEqual([
      ['70800002', 14.45, 0, 'Reembolso al cliente · Meraki Pita · pedido UB-77'],
      ['47700010', 1.45, 0, 'IVA del reembolso UB-77'],
      ['43000002', 0, 15.9, 'Devuelve Uber Eats'],
    ])
    // La venta no se toca: sigue siendo la bruta.
    expect(p.lineas.find((l) => l.cuenta === '70000002')!.haber).toBe(14.45)
  })
  it('el reembolso de otra plataforma no entra en el asiento de Uber', () => {
    const otra = [reembolso({ importe: 5, canalId: JE, marcaId: SCANDAL })]
    const pu = ventasDelDia(entrada({ unidad: u, devoluciones: otra })).propuesta!
    expect(pu.lineas.some((l) => l.cuenta.startsWith('708'))).toBe(false)
  })
})

describe('C04b R5 · una marca sin su subcuenta no se esconde', () => {
  const devs = [reembolso({ importe: 5.5, canalId: JE, marcaId: SCANDAL, codigo: 'JE-1' })]
  const u = unidadesDelDia(PEDIDOS, devs, porMarca).find((x) => x.canalId === JE)!
  const p = ventasDelDia(entrada({ unidad: u, devoluciones: devs })).propuesta!
  it('va a la general, lo dice en «Mira esto» y la confianza es Duda', () => {
    expect(p.lineas.find((l) => l.documento === 'JE-1' && l.debe > 0 && !l.cuenta.startsWith('477'))!.cuenta).toBe('70800000')
    expect(p.avisos.join(' ')).toContain('Scandal Burgers no tiene su subcuenta')
    expect(p.confianza).toBe('duda')
  })
})

describe('C04b R5 · sin unidad, la regla de antes, igual', () => {
  it('un asiento con todo el día y 70000000', () => {
    const p = ventasDelDia(entrada()).propuesta!
    expect(p.concepto).toBe('Ventas del día · Local Norte')
    expect(p.lineas.filter((l) => l.cuenta.startsWith('700')).every((l) => l.cuenta === '70000000')).toBe(true)
  })
})

describe('C04b R6 · «Milanesa House» (propia) y «Milanesa Haus» (cedida): se separan por la marca, no por el nombre', () => {
  // Los dos nombres reales de Foodint: casi iguales, de dueños distintos.
  const HOUSE = 'marca-milanesa-house', HAUS = 'marca-milanesa-haus'
  const nombres: Record<string, string> = { [HOUSE]: 'Milanesa House', [HAUS]: 'Milanesa Haus' }
  const ped = [
    pedido({ id: 'h1', total: 19.5, marcaId: HOUSE }),
    pedido({ id: 'z1', total: 21.4, marcaId: HAUS, marcaPropia: false }),
    pedido({ id: 'h2', total: 11, canalId: GLOVO, marcaId: HOUSE }),
    pedido({ id: 'z2', total: 13.2, canalId: GLOVO, marcaId: HAUS, marcaPropia: false }),
  ]
  const cuentasMila = { ...cuentas, ventasPorMarca: { ...cuentas.ventasPorMarca, [HOUSE]: '70000001' } }
  const e = (u: ReturnType<typeof unidadesDelDia>[number]) => ventasDelDia(entrada({ pedidos: ped, unidad: u, cuentas: cuentasMila, nombreMarca: (id) => nombres[id ?? ''] ?? 'una marca' }))
  it('la cedida no abre unidad en Glovo, aunque se llame casi igual', () => {
    expect(unidadesDelDia(ped, [], porMarca).map((u) => u.clave)).toEqual([UBER, `${GLOVO}:${HOUSE}`])
  })
  it('en Uber, solo la propia va a 70000001; la cedida queda fuera, dicha', () => {
    const r = e(unidadesDelDia(ped, [], porMarca)[0])
    expect(r.resumen.pedidoIds).toEqual(['h1'])
    expect(r.propuesta!.lineas.filter((l) => l.cuenta.startsWith('700')).map((l) => [l.cuenta, l.marcaId, l.concepto])).toEqual([['70000001', HOUSE, 'Ventas Milanesa House']])
    expect(r.resumen.cedidasFuera).toEqual({ pedidos: 1, total: 21.4 })
  })
  it('en Glovo, el asiento de Milanesa House no lleva el pedido de Milanesa Haus', () => {
    const r = e(unidadesDelDia(ped, [], porMarca)[1])
    expect(r.propuesta!.concepto).toBe('Ventas Glovo · Milanesa House · Local Norte')
    expect(r.resumen.pedidoIds).toEqual(['h2'])
    expect(r.propuesta!.lineas.some((l) => l.marcaId === HAUS)).toBe(false)
  })
})
