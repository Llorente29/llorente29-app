// tests/unit/modules/conta/k05/emitida.test.ts
//
// K05 · Lo que decide la ficha de la factura emitida del núcleo, sin React ni
// red (src/modules/conta/nucleo/emitida/asiento.ts): el asiento que sale (el
// de conta_venta_emitir), lo que se manda a la base, qué hace el cobro, las
// comprobaciones y la franja. Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import {
  asientoDeLaEmitida, borradorDesdeAsiento, borradorVacio, comprobacionesEmitida, estadoDeLaEmitida, fechaDelCobro, lineasParaLaBase, nombreDePestanaEmitida,
  queHaceElCobro, textoOperacionCliente, vaciasEmitida, ventasConImporte, type BorradorEmitida, type CuentasEmitida,
} from '@/modules/conta/nucleo/emitida/asiento'
import { dudaDelGasto } from '@/modules/conta/nucleo/recibida/estado'
import { VUELTA_F8 } from '@/modules/conta/nucleo/teclado'
import { claveDe } from '@/modules/conta/nucleo/pestanas'

const cuentas: CuentasEmitida = {
  cliente: { codigo: '43000012', nombre: 'Cliente de Prueba, S.L.' },
  tipos: new Map([[21, { tipoId: 't21', codigo: '47700021', nombre: 'IVA repercutido 21 %' }], [10, { tipoId: 't10', codigo: '47700010', nombre: 'IVA repercutido 10 %' }], [4, { tipoId: 't4', codigo: null, nombre: 'IVA repercutido 4 %' }]]),
  retencion: { codigo: '47300000', nombre: 'Retenciones que te hacen tus clientes' },
  nombre: (c) => ({ '70000000': 'Ventas de mercaderías', '70500000': 'Prestaciones de servicios' } as Record<string, string>)[c] ?? null,
}
const hoy = '2026-11-19'
const conDos: BorradorEmitida = {
  ...borradorVacio(hoy), clienteId: 'p1', numero: 'A-2026/0158', fecha: '2026-07-01',
  iva: [{ base: '147,61', tipo: '21', cuota: '31,00' }, { base: '185,39', tipo: '10', cuota: '18,54' }],
  ventas: [{ cuenta: '70000000', local: '', importe: '' }],
}

describe('K05 · el asiento que sale, el de conta_venta_emitir', () => {
  it('430 por el total al debe; la 70x por la base y la 477 de cada tipo al haber; cuadra', () => {
    const a = asientoDeLaEmitida(conDos, cuentas, 'Cliente de Prueba, S.L.')
    expect(a.vista.map((l) => [l.codigo, l.debe, l.haber])).toEqual([
      ['43000012', 382.54, null], ['70000000', null, 333], ['47700021', null, 31], ['47700010', null, 18.54],
    ])
    expect(a).toMatchObject({ cuadra: true, total: 382.54, base: 333, iva: 49.54, retencion: 0, faltan: [] })
  })
  it('con retención: la 473 al debe y la 430 por el total menos la retención (lo que cobra)', () => {
    const a = asientoDeLaEmitida({ ...conDos, iva: [{ base: '1.000,00', tipo: '21', cuota: '210,00' }], retencion: { tipo: '15', importe: '150,00' } }, cuentas, null)
    expect(a.vista.map((l) => [l.codigo, l.debe, l.haber])).toEqual([['43000012', 1060, null], ['47300000', 150, null], ['70000000', null, 1000], ['47700021', null, 210]])
    expect(a.cuadra).toBe(true)
  })
  it('un cliente sin su 430 y una 477 que no está en el plan: el asiento lo dice', () => {
    const a = asientoDeLaEmitida({ ...conDos, iva: [{ base: '100,00', tipo: '4', cuota: '4,00' }] }, { ...cuentas, cliente: null }, 'Cliente Nuevo de Prueba')
    expect(a.vista[0]).toMatchObject({ codigo: '430', nombre: 'Cliente Nuevo de Prueba · se crea al guardar' })
    expect(a.faltan).toEqual(['la 477 del 4 %'])
  })
  it('lo que se manda a la base: el orden y la forma de conta_venta_emitir (430, 70x, 477 con su IVA, 473), con el cliente y el número', () => {
    const l = lineasParaLaBase({ ...conDos, retencion: { tipo: '1', importe: '3,33' } }, { ...cuentas, cuenta430: '43000012', cuenta473: '47300000' }, 'p1', null)
    expect(l.map((x) => [x.cuenta, x.debe, x.haber])).toEqual([
      ['43000012', 379.21, 0], ['70000000', 0, 333], ['47700021', 0, 31], ['47700010', 0, 18.54], ['47300000', 3.33, 0],
    ])
    expect(l[0]).toMatchObject({ concepto: 'Factura A-2026/0158', documento: 'A-2026/0158', tercero_id: 'p1', comun: true })
    expect(l[2].iva).toEqual({ tipo_id: 't21', base: 147.61, libro: 'issued', facturas: 1 })
    expect(l[1].iva).toBeUndefined()
    expect(l[4].concepto).toBe('Retención factura A-2026/0158')
  })
  it('con varias cuentas de venta, la última se lleva lo que falta hasta la base', () => {
    expect(ventasConImporte([{ cuenta: '70000000', local: '', importe: '200,00' }, { cuenta: '70500000', local: '', importe: '' }], 333))
      .toEqual([{ cuenta: '70000000', local: '', importe: 200 }, { cuenta: '70500000', local: '', importe: 133 }])
  })
  it('de su asiento a la ficha y vuelta: el mismo asiento', () => {
    const a = asientoDeLaEmitida(conDos, cuentas, null)
    const apuntes = a.vista.map((l) => ({
      cuenta: l.codigo, debe: l.debe ?? 0, haber: l.haber ?? 0, localId: null,
      iva: /^477/.test(l.codigo) ? { base: l.codigo === '47700021' ? 147.61 : 185.39, libro: 'issued', tipo: l.codigo === '47700021' ? 21 : 10 } : null,
    }))
    const b = borradorDesdeAsiento({ terceroId: 'p1', documento: 'A-2026/0158', fechaDocumento: '2026-07-01', fecha: '2026-07-02', apuntes })
    expect(asientoDeLaEmitida(b, cuentas, null).vista).toEqual(a.vista)
    expect(b).toMatchObject({ clienteId: 'p1', numero: 'A-2026/0158', fecha: '2026-07-01', cobroCuenta: null })
  })
})

describe('K05 · «Cómo se cobra»: como hoy, sin tanda', () => {
  const bancos = new Map([['57200001', 'banco-1']])
  it('a un banco de Cuentas y extractos: el de conta_banco_a_mano', () => {
    expect(queHaceElCobro({ cuenta: '57200001', fecha: '2026-07-31', hoy, importe: 357.44, bancos })).toEqual({ que: 'banco', bancoId: 'banco-1', cuenta: '57200001', fecha: '2026-07-31', importe: 357.44 })
  })
  it('a la caja o a otra cuenta: el del cobro en efectivo', () => {
    expect(queHaceElCobro({ cuenta: '57000000', fecha: '2026-07-31', hoy, importe: 10, bancos })).toMatchObject({ que: 'otra', cuenta: '57000000' })
  })
  it('vacía, sin fecha o con fecha posterior a hoy: pendiente de cobrar, y dice por qué', () => {
    expect(queHaceElCobro({ cuenta: '', fecha: '2026-07-31', hoy, importe: 10, bancos })).toEqual({ que: 'pendiente', porque: 'sin cuenta de cobro' })
    expect(queHaceElCobro({ cuenta: '57200001', fecha: '', hoy, importe: 10, bancos })).toEqual({ que: 'pendiente', porque: 'sin la fecha del cobro' })
    expect(queHaceElCobro({ cuenta: '57200001', fecha: '2026-12-01', hoy, importe: 10, bancos })).toEqual({ que: 'pendiente', porque: 'se cobra el 01/12/2026, después de hoy' })
  })
  it('la fecha que se propone: la de la factura más los días de su ficha', () => {
    expect(fechaDelCobro('2026-07-01', 30)).toBe('2026-07-31')
    expect(fechaDelCobro('2026-07-01', null)).toBe('2026-07-01')
    expect(fechaDelCobro('', 30)).toBe('')
  })
})

describe('K05 · las comprobaciones y la franja dicen la verdad', () => {
  const calendario = { mesesCerrados: [], ejercicios: [{ inicio: '2026-01-01', fin: '2026-12-31', abierto: true }] }
  const base = { numero: 'A-1', fecha: '2026-07-01', calendario, repetida: null, hayCliente: true, nif: 'B00000000', iva: conDos.iva, total: 382.54 }
  it('las cuatro, con su visto', () => {
    expect(comprobacionesEmitida(base).map((c) => [c.tono, c.texto])).toEqual([
      ['bien', 'No está repetida'], ['bien', 'El 3T está abierto'], ['bien', 'NIF correcto'], ['bien', 'Bases y cuotas suman el total'],
    ])
  })
  it('sin número o sin cliente no dice «No está repetida»; sin importe, no dice que suma', () => {
    const l = comprobacionesEmitida({ ...base, numero: '', hayCliente: false, total: 0, iva: [] })
    expect(l.map((c) => c.id)).toEqual(['periodo'])
  })
  it('repetida, NIF que no vale y una cuota que no es la de su base', () => {
    const l = comprobacionesEmitida({ ...base, repetida: 'Puede estar repetida: la A-1 ya está en el libro de expedidas', nif: 'B00000001', iva: [{ base: '100,00', tipo: '21', cuota: '20,00' }] })
    expect(l.map((c) => [c.id, c.tono])).toEqual([['repetida', 'ambar'], ['periodo', 'bien'], ['nif', 'rojo'], ['suma', 'ambar']])
    expect(l[3].texto).toBe('La cuota del 21 % no es la base × 21 % (21,00)')
  })
  it('la franja: a mano, hecha sola, con lo que falta y rellenada (con y sin dudas)', () => {
    expect(estadoDeLaEmitida({ modo: 'a_mano', comprobaciones: [], hayDuda: false, vacias: ['el cliente'] }).fuerte).toBe('La escribes tú.')
    expect(estadoDeLaEmitida({ modo: 'hecha_sola', comprobaciones: [], hayDuda: false, vacias: [], asiento: 158 })).toEqual({ tono: 'verde', fuerte: 'Hecha por Sumied.', resto: 'Su asiento, el 1 / 158, está validado.' })
    expect(estadoDeLaEmitida({ modo: 'rellenada', comprobaciones: comprobacionesEmitida(base), hayDuda: true, vacias: vaciasEmitida({ clienteId: 'p1', numero: '', fecha: '2026-07-01', ventas: [{ cuenta: '70000000', local: '', importe: '' }] }, 10) }))
      .toEqual({ tono: 'ambar', fuerte: 'Mira esto ·', resto: 'Falta el número de factura' })
    expect(estadoDeLaEmitida({ modo: 'rellenada', comprobaciones: comprobacionesEmitida(base), hayDuda: true, vacias: [] }))
      .toEqual({ tono: 'ambar', fuerte: 'Rellenada por Sumied, con 1 duda.', resto: '4 comprobaciones bien · mira lo ámbar y pulsa Intro.' })
    expect(estadoDeLaEmitida({ modo: 'rellenada', comprobaciones: comprobacionesEmitida(base), hayDuda: false, vacias: [] }).tono).toBe('verde')
  })
  it('la duda de la cuenta de venta: la misma de la recibida, con sus facturas anteriores', () => {
    const d = dudaDelGasto({ reparto: [{ cuenta: '70000000', nombre: '', facturas: 4 }, { cuenta: '70400000', nombre: '', facturas: 1 }], confianza: 'probable', cuentaAhora: '70000000', decidida: false })
    expect(d?.texto).toBe('Sus 5 facturas anteriores fueron 4 a la 70000000 (la última) y 1 a la 70400000.')
    expect(d?.dejar.cuenta).toBe('70000000')
  })
})

describe('K05 · de su ficha, el nombre y dónde se abre', () => {
  it('el tipo de operación, de la ficha del cliente', () => {
    expect(textoOperacionCliente('domestic', false)).toBe('Operaciones interiores')
    expect(textoOperacionCliente('eu', false)).toBe('Entregas intracomunitarias')
    expect(textoOperacionCliente('export', false)).toBe('Exportaciones')
    expect(textoOperacionCliente('domestic', true)).toBe('Recargo de equivalencia')
    expect(textoOperacionCliente(null, false)).toBeNull()
  })
  it('la pestaña: «Factura emitida · cliente»; una que existe nunca se llama «nueva»', () => {
    expect(nombreDePestanaEmitida('Cliente de Prueba, S.L.', true)).toBe('Factura emitida · Cliente de Prueba, S.L.')
    expect(nombreDePestanaEmitida(null, false)).toBe('Factura emitida · nueva')
    expect(nombreDePestanaEmitida(null, true)).toBe('Factura emitida · sin cliente')
  })
  it('F8 lleva a la emitida a mano (la contable), y sus direcciones son de la pestaña de la emitida', () => {
    expect(VUELTA_F8[1]).toBe('ventas/facturas/a-mano')
    for (const u of ['/conta/ventas/facturas/a-mano', '/conta/ventas/facturas/asiento/abc', '/conta/ventas/facturas/revisar', '/conta/ventas/facturas/f1']) expect(claveDe(u)).toBe('ficha:emitida')
    expect(claveDe('/conta/ventas/facturas')).toBe('boton:emitidas')
  })
})
