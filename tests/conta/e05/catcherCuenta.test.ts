// tests/conta/e05/catcherCuenta.test.ts
//
// E05 · Retoque 1 (Julio, 15/10): lo reclamado sale como «Reclamada», nunca como
// «por aclarar», y la tarjeta de arriba, el bloque de Catcher, su fila y la
// lista de Documentos dicen lo mismo porque salen de una sola cuenta.
// Las cosas por aclarar son las que da el cruce de la quincena de ejemplo (el
// caso real del G236), no inventadas aquí.

import { describe, expect, it } from 'vitest'
import { leerQuincena } from '../../../src/modules/conta/lib/catcherQuincena'
import { cruzar, resumenLote, TARIFA_PORTAL_20261014, type PedidoApp } from '../../../src/modules/conta/lib/catcherCruces'
import {
  apoyoDeLaTarjeta, contar, cuadraConLosPedidos, facturasPorGrupo, cuentaDeGrupo, cuentaDelLote, diferenciaDeComision, estadoDeFactura, etiquetasDe, type EstadoCosa,
} from '../../../src/modules/conta/lib/catcherCuenta'
import { EMPRESA, quincenaInventada, TIENDA_A, TIENDA_B } from './ejemplo'

const q = leerQuincena(quincenaInventada(), { tiendas: { [TIENDA_A]: 'local-carabanchel', [TIENDA_B]: 'local-alcala' }, empresa: { nif: EMPRESA.nif } })
const app: PedidoApp[] = [...new Map(q.pedidos.map((p) => [`${p.codigo}|${p.momento}`, p])).values()].map((p) => ({
  id: `venta-${p.codigo}-${p.momento}`, codigo: p.codigo, momento: p.momento!, localId: 'local-carabanchel', marcaId: null, canalId: null,
  estado: p.estado === 'canceled' ? 'canceled' : 'delivered',
  precio: q.pedidos.find((x) => x.codigo === p.codigo && x.momento === p.momento && !/commission/.test(x.tipo))?.base ?? 4.2,
}))
const cruce = cruzar({
  facturas: q.facturas.map((f) => ({ numero: f.numero, tipo: f.tipo, base: f.base, total: f.total, seguraAlLeer: true })),
  pedidos: q.pedidos, app, tarifas: [{ ...TARIFA_PORTAL_20261014, desde: '2026-09-01' }], periodo: { desde: q.desde, hasta: q.hasta }, totalLote: q.totales.total,
})
const catcher = q.facturas.filter((f) => f.tipo === 'catcher').map((f) => f.numero)

/** Lo que enseñan las cuatro: la tarjeta de arriba, el bloque de Catcher, su fila y la línea de la lista. */
function pantallas(estado: EstadoCosa) {
  const cosas = cruce.porAclarar.map((c) => ({ facturaId: c.factura, estado }))
  const { total, porFactura } = cuentaDelLote(cosas)
  return {
    tarjeta: { numero: total.abiertas, apoyo: apoyoDeLaTarjeta(true, total) },
    bloque: etiquetasDe(cuentaDeGrupo(catcher, porFactura)).map((e) => e.texto),
    fila: estadoDeFactura(porFactura.get(catcher[0]), { sinProveedor: false, confianza: 'seguro' }).texto,
    bajoElTitulo: cuadraConLosPedidos(true, total),
    lista: resumenLote({ etiqueta: q.etiqueta, facturas: q.facturas.length, total: q.totales.total, cruzado: true, cuenta: total }),
  }
}

describe('una sola cuenta: la tarjeta, el bloque, la fila y la lista dicen lo mismo', () => {
  it('el cruce de ejemplo deja una cosa (el G236) en la factura de Catcher', () => {
    expect(cruce.porAclarar.map((c) => [c.factura, c.motivo])).toEqual([[catcher[0], 'comision_sin_entrega']])
  })
  it('abierta: por aclarar en las cuatro', () => {
    expect(pantallas('abierta')).toEqual({
      tarjeta: { numero: 1, apoyo: '0 reclamadas · 0 dadas por buenas' },
      bloque: ['1 por aclarar'], fila: 'Por aclarar (1)', bajoElTitulo: 'Cuadra con los pedidos salvo 1',
      lista: '2.ª quincena de septiembre de 2026 · 5 facturas · 54,69 € · cuadra con los pedidos salvo 1',
    })
  })
  it('reclamada: «Reclamada» en las cuatro, y en ninguna «por aclarar»', () => {
    const p = pantallas('reclamada')
    expect(p).toEqual({
      tarjeta: { numero: 0, apoyo: '1 reclamada · 0 dadas por buenas' },
      bloque: ['1 reclamada'], fila: 'Reclamada', bajoElTitulo: 'Cuadra con los pedidos salvo 1 (1 reclamada)',
      lista: '2.ª quincena de septiembre de 2026 · 5 facturas · 54,69 € · cuadra con los pedidos salvo 1 (1 reclamada)',
    })
    expect(JSON.stringify(p)).not.toMatch(/por aclarar/i)
  })
  it('dada por buena: cuadra en las cuatro', () => {
    expect(pantallas('aceptada')).toEqual({
      tarjeta: { numero: 0, apoyo: '0 reclamadas · 1 dada por buena' },
      bloque: [], fila: 'Cuadra', bajoElTitulo: 'Cuadra con los pedidos',
      lista: '2.ª quincena de septiembre de 2026 · 5 facturas · 54,69 € · cuadra con los pedidos',
    })
  })
  it('en una factura con una abierta y una reclamada, lo abierto manda en la fila y el bloque nombra las dos', () => {
    const { total, porFactura } = cuentaDelLote([{ facturaId: 'F', estado: 'abierta' }, { facturaId: 'F', estado: 'reclamada' }, { facturaId: null, estado: 'abierta' }])
    expect(estadoDeFactura(porFactura.get('F'), { sinProveedor: false, confianza: 'seguro' }).texto).toBe('Por aclarar (1)')
    expect(etiquetasDe(cuentaDeGrupo(['F'], porFactura)).map((e) => e.texto)).toEqual(['1 por aclarar', '1 reclamada'])
    // Lo de toda la quincena (sin factura) cuenta en la tarjeta y bajo el título, no en ningún bloque.
    expect(total).toEqual({ abiertas: 2, reclamadas: 1, aceptadas: 0 })
    expect(cuadraConLosPedidos(true, total)).toBe('Cuadra con los pedidos salvo 3 (1 reclamada)')
  })
})

describe('la comisión que no cuadra (retoque 3)', () => {
  it('la del ejemplo: 0,79 € de más (la del G236, cancelado)', () => {
    const d = diferenciaDeComision({ esperada: cruce.totales.comisionEsperada, cobrada: cruce.totales.comisionCobrada })
    expect(d).toEqual({ centimos: 79, sentido: 'de más' })
  })
  it('si cuadra, nada; si falta, de menos', () => {
    expect(diferenciaDeComision({ esperada: 7.11, cobrada: 7.11 })).toBeNull()
    expect(diferenciaDeComision({ esperada: 7.9, cobrada: 7.11 })).toEqual({ centimos: 79, sentido: 'de menos' })
    expect(diferenciaDeComision(null)).toBeNull()
  })
})

describe('singular y plural en los contadores (15/10)', () => {
  it('la quincena de ejemplo: «3 riders · 1 flota · 1 de Catcher»', () => {
    const n = (t: string) => q.facturas.filter((f) => f.tipo === t).length
    expect(facturasPorGrupo({ rider: n('rider'), flota: n('flota'), catcher: n('catcher') })).toBe('3 riders · 1 flota · 1 de Catcher')
  })
  it('uno en singular; cero y varios, en plural', () => {
    expect(facturasPorGrupo({ rider: 1, flota: 2, catcher: 0 })).toBe('1 rider · 2 flotas · 0 de Catcher')
    expect(facturasPorGrupo({ rider: 0, flota: 0, catcher: 2 })).toBe('0 riders · 0 flotas · 2 de Catcher')
    expect(contar(1, 'pedido', 'pedidos')).toBe('1 pedido')
    expect(contar(19, 'pedido', 'pedidos')).toBe('19 pedidos')
    expect(contar(0, 'factura', 'facturas')).toBe('0 facturas')
  })
})
