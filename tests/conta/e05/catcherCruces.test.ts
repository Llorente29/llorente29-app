// E05 · Tarea 3 · Los cruces de la quincena: pedido a pedido con lo que se
// mandó a Catcher (código + fecha y hora), la tarifa, la comisión y los
// totales. Con la quincena inventada de ejemplo.ts, que trae a propósito el
// caso real: un pedido cancelado con comisión cobrada y ningún rider que lo
// facture (G236 del 23/09 a las 16:29).
import { describe, expect, it } from 'vitest'
import { leerQuincena, type PedidoExcel } from '../../../src/modules/conta/lib/catcherQuincena'
import {
  cabeEnTarifa, cruzar, cuando, precioPorKm, resumenCruce, resumenLote, TARIFA_PORTAL_20261014, tarifaDel, type PedidoApp, type Tarifa,
} from '../../../src/modules/conta/lib/catcherCruces'
import { EMPRESA, quincenaInventada, TIENDA_A, TIENDA_B } from './ejemplo'

const q = leerQuincena(quincenaInventada(), { tiendas: { [TIENDA_A]: 'local-carabanchel', [TIENDA_B]: 'local-alcala' }, empresa: { nif: EMPRESA.nif } })
// La tarifa del ejemplo vale desde el 01/09 (la del portal es del 14/10: la quincena es anterior).
const TARIFA: Tarifa = { ...TARIFA_PORTAL_20261014, desde: '2026-09-01' }
const facturas = q.facturas.map((f) => ({ numero: f.numero, tipo: f.tipo, base: f.base, total: f.total, seguraAlLeer: true }))

/** Lo que la app mandó a Catcher: cada pedido de los riders, con el precio que Catcher dio; G236, cancelado. */
function appDe(pedidos: readonly PedidoExcel[], cambia: (p: PedidoApp) => PedidoApp = (p) => p): PedidoApp[] {
  const vistos = new Map<string, PedidoApp>()
  for (const p of pedidos) {
    const k = `${p.codigo}|${p.momento}`
    if (vistos.has(k)) continue
    const rider = pedidos.find((x) => x.codigo === p.codigo && x.momento === p.momento && !/commission/.test(x.tipo))
    vistos.set(k, cambia({
      id: `venta-${p.codigo}-${p.momento}`, codigo: p.codigo, momento: p.momento!, localId: p.codigo === 'G236' ? 'local-alcala' : 'local-carabanchel',
      marcaId: 'marca-1', canalId: 'canal-glovo', estado: p.estado === 'canceled' ? 'canceled' : 'delivered', precio: rider ? rider.base : 4.2,
    }))
  }
  return [...vistos.values()]
}
const base = { facturas, pedidos: q.pedidos, tarifas: [TARIFA], periodo: { desde: q.desde, hasta: q.hasta }, totalLote: q.totales.total }

describe('cruzar: la quincena de ejemplo, con el caso real', () => {
  const x = cruzar({ ...base, app: appDe(q.pedidos) })
  it('solo sale el G236, en la factura de Catcher, con su pedido y su porqué', () => {
    expect(x.porAclarar).toEqual([{
      motivo: 'comision_sin_entrega', factura: 'CMS_2026_09_2', pedido: { ...q.pedidos.find((p) => p.codigo === 'G236')! }, diferencia: 79,
      texto: 'G236 del 23/09 a las 16:29: cancelado, con comisión cobrada (0,79 €) y ningún rider que lo facture.',
    }])
    expect(x.facturas.CMS_2026_09_2).toEqual({ estado: 'aclarar', aclarar: 1 })
    for (const n of ['ES_I_1001_26_7', 'ES_I_1002_26_7', 'ES_I_1003_26_7', 'ES_F_2001_26_7']) expect(x.facturas[n], n).toEqual({ estado: 'seguro', aclarar: 0 })
    expect(resumenCruce(x)).toBe('5 facturas: 4 cuadran y 1 por aclarar (1 cosa que mirar)')
  })
  it('la comisión: 0,79 € por pedido entregado (9) frente a lo cobrado (10)', () => {
    expect(x.totales).toMatchObject({ comisionEsperada: 7.11, comisionCobrada: 7.9, excel: q.totales.total, lote: q.totales.total, pedidosExcel: q.pedidos.length })
  })
  it('el código se repite: el G901 del 16/09 y el del 27/09 casan cada uno con el suyo', () => {
    const g901 = q.pedidos.filter((p) => p.codigo === 'G901' && !/commission/.test(p.tipo))
    expect(g901.map((p) => x.casados[`${p.factura}|${p.codigo}|${p.momento}`])).toEqual([`venta-G901-${g901[0].momento}`, `venta-G901-${g901[1].momento}`])
  })
  it('el coste por local, marca y plataforma suma lo que se paga (riders, flota y comisión)', () => {
    const total = x.coste.reduce((t, k) => t + Math.round(k.base * 100), 0) / 100
    expect(total).toBeCloseTo(q.totales.base, 2)
    expect(x.coste.find((k) => k.localId === 'local-alcala')).toMatchObject({ pedidos: 1, base: 0.79 })
  })
})

describe('cruzar: cada cosa que no cuadra, con su pedido', () => {
  it('Catcher cobra otro precio del que dio al mandarlo', () => {
    const x = cruzar({ ...base, app: appDe(q.pedidos, (p) => (p.codigo === 'G906' ? { ...p, precio: 4.0 } : p)) })
    expect(x.porAclarar.find((a) => a.motivo === 'precio_distinto')).toMatchObject({ factura: 'ES_I_1002_26_7', diferencia: 20, texto: 'G906 del 28/09 a las 21:45: Catcher cobra 4,20 € y al mandarlo dijo 4,00 €.' })
    expect(x.facturas.ES_I_1002_26_7.estado).toBe('aclarar')
  })
  it('un pedido que Catcher factura y no se le mandó', () => {
    const x = cruzar({ ...base, app: appDe(q.pedidos).filter((p) => p.codigo !== 'G907') })
    expect(x.porAclarar.map((a) => a.motivo)).toEqual(expect.arrayContaining(['no_se_mando', 'comision_sin_entrega']))
    expect(x.porAclarar.find((a) => a.motivo === 'no_se_mando')!.texto).toBe('G907 del 29/09 a las 13:30: Catcher lo cobra (4,00 €) y no está entre los pedidos que se le mandaron.')
  })
  it('uno cancelado que el rider factura', () => {
    const x = cruzar({ ...base, app: appDe(q.pedidos, (p) => (p.codigo === 'G908' ? { ...p, estado: 'canceled' } : p)) })
    expect(x.porAclarar.find((a) => a.motivo === 'cancelado_facturado')).toMatchObject({ factura: 'ES_F_2001_26_7', texto: 'G908 del 30/09 a las 22:50: está cancelado y el rider lo factura (4,70 €).' })
  })
  it('uno entregado en la quincena que nadie factura (y uno de fuera de la quincena, no)', () => {
    const extra: PedidoApp[] = [
      { id: 'venta-G999', codigo: 'G999', momento: '2026-09-25T10:00:00.000Z', localId: 'local-alcala', marcaId: 'm', canalId: 'c', estado: 'delivered', precio: 4.2 },
      { id: 'venta-G998', codigo: 'G998', momento: '2026-10-02T10:00:00.000Z', localId: 'local-alcala', marcaId: 'm', canalId: 'c', estado: 'delivered', precio: 4.2 },
    ]
    const x = cruzar({ ...base, app: [...appDe(q.pedidos), ...extra] })
    expect(x.porAclarar.filter((a) => a.motivo === 'entregado_sin_factura').map((a) => a.texto)).toEqual(['G999 del 25/09 a las 12:00: se mandó a Catcher, se entregó y no está en ninguna factura de la quincena.'])
  })
  it('sin precio de Catcher: la tarifa decide; fuera de ella, por aclarar; sin tarifa ese día, tampoco se da por buena', () => {
    const sinPrecio = appDe(q.pedidos, (p) => ({ ...p, precio: null }))
    expect(cruzar({ ...base, app: sinPrecio }).porAclarar.map((a) => a.motivo)).toEqual(['comision_sin_entrega'])
    const caro = cruzar({ ...base, pedidos: q.pedidos.map((p) => (p.codigo === 'G903' && !/commission/.test(p.tipo) ? { ...p, base: 20 } : p)), app: sinPrecio })
    expect(caro.porAclarar.map((a) => a.motivo)).toEqual(expect.arrayContaining(['fuera_de_tarifa', 'suma_pedidos']))
    const sinTarifa = cruzar({ ...base, tarifas: [TARIFA_PORTAL_20261014], app: sinPrecio })
    expect(sinTarifa.porAclarar.filter((a) => a.motivo === 'sin_tarifa')).toHaveLength(9 + 9)
    expect(Object.values(sinTarifa.facturas).every((f) => f.estado === 'aclarar')).toBe(true)
  })
  it('lo que suman las facturas del lote no es el Excel', () => {
    const x = cruzar({ ...base, app: appDe(q.pedidos), totalLote: q.totales.total - 1 })
    expect(x.porAclarar.find((a) => a.motivo === 'suma_lote')).toMatchObject({ diferencia: 100 })
  })
  it('la hora de la app y la del Excel pueden no ser la misma: dentro de la ventana casa; fuera, no', () => {
    const corre = (min: number) => appDe(q.pedidos, (p) => ({ ...p, momento: new Date(Date.parse(p.momento) + min * 60000).toISOString() }))
    expect(cruzar({ ...base, app: corre(20) }).porAclarar.map((a) => a.motivo)).toEqual(['comision_sin_entrega'])
    expect(cruzar({ ...base, app: corre(200) }).porAclarar.filter((a) => a.motivo === 'no_se_mando')).toHaveLength(9)
  })
  it('una que ya no era segura al leerla no se vuelve segura por cruzar bien', () => {
    const x = cruzar({ ...base, facturas: facturas.map((f) => (f.numero === 'ES_I_1003_26_7' ? { ...f, seguraAlLeer: false } : f)), app: appDe(q.pedidos) })
    expect(x.facturas.ES_I_1003_26_7.estado).toBe('aclarar')
  })
})

describe('la tarifa: fechada y con sus reglas', () => {
  it('la que vale un día es la última con «desde» anterior; antes de la primera, ninguna', () => {
    const t2 = { ...TARIFA_PORTAL_20261014, desde: '2026-11-01', comisionPedido: 0.85 }
    expect(tarifaDel('2026-10-20', [TARIFA_PORTAL_20261014, t2])?.comisionPedido).toBe(0.79)
    expect(tarifaDel('2026-11-02', [TARIFA_PORTAL_20261014, t2])?.comisionPedido).toBe(0.85)
    expect(tarifaDel('2026-09-30', [TARIFA_PORTAL_20261014, t2])).toBeNull()
  })
  it('por km: los tramos, 0,50 €/km de más y el máximo de 12 €', () => {
    expect([0.5, 1, 1.5, 2.9, 3.5, 5, 40].map((k) => precioPorKm(k, TARIFA_PORTAL_20261014))).toEqual([4, 4, 4.2, 4.7, 5.2, 5.7, 12])
  })
  it('lo que cabe: de 4,00 € a 12 € + 15 %, y el pedido extra de 2,50 €', () => {
    expect([2.5, 4, 4.62, 13.8].map((p) => cabeEnTarifa(p, TARIFA_PORTAL_20261014))).toEqual([true, true, true, true])
    expect([2.49, 3.99, 13.81].map((p) => cabeEnTarifa(p, TARIFA_PORTAL_20261014))).toEqual([false, false, false])
  })
  it('la hora, en Madrid', () => {
    expect(cuando('2026-09-23T14:29:00.000Z')).toBe('23/09 a las 16:29')
  })
})

describe('resumenLote: la línea de cada quincena', () => {
  it('cuadra, salvo N, o sin cruzar', () => {
    const l = { etiqueta: '2.ª quincena de septiembre de 2026', facturas: 58, total: 1062.25 }
    expect(resumenLote({ ...l, cruzado: true, abiertas: 1 })).toBe('2.ª quincena de septiembre de 2026 · 58 facturas · 1.062,25 € · cuadra con los pedidos salvo 1')
    expect(resumenLote({ ...l, cruzado: true, abiertas: 0 })).toBe('2.ª quincena de septiembre de 2026 · 58 facturas · 1.062,25 € · cuadra con los pedidos')
    expect(resumenLote({ ...l, facturas: 1, cruzado: false, abiertas: 0 })).toBe('2.ª quincena de septiembre de 2026 · 1 factura · 1.062,25 € · sin cruzar con los pedidos todavía')
  })
})
