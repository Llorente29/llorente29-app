// tests/unit/modules/conta/v01/facturasVenta.test.ts
//
// V01 · Entrega 1 · Ventas › Facturas, sin pintar: las cuentas de una factura
// (las mismas que la base: el IVA redondeado por tipo), la diferencia de una
// rectificativa, el estado y las pestañas que suman «Todas» (regla 7), las
// cuatro cifras, el buscador, leer lo que se escribe y el asiento previo.
// Regla 31: los números son los de la prueba de staging de la 0835 (la misma
// factura, con su resultado medido en la base: 1.045 + 214,50 = 1.259,50; la
// rectificativa de 10 a 8 cubiertos, −242).

import { describe, expect, it } from 'vitest'
import { sumanTodas } from '@/modules/conta/diseno/plantillas'
import {
  NOMBRE_ESTADO, asientoPrevio, casaConBusqueda, cifrasDe, cifrasFacturas, diezDeFactura, diferenciaDe, textoTraspaso, estadoDe, faltaParaEmitir, filasFacturas, filtrosFacturas, lineasLeidas,
  numeroDeTexto, origenesQueHay, pestanaDe, pestanasFacturas, quedaPorCobrar, totalDelFiltro, venceCon, type FacturaVenta, type LineaFactura,
} from '@/modules/conta/lib/facturasVenta'

const HOY = '2026-10-24'
const L = (o: Partial<LineaFactura>): LineaFactura => ({ concepto: 'x', cantidad: 1, precio: 0, descuento: 0, tipoId: 't21', tipo: 21, recargo: 5.2, cuentaId: 'c705', ...o })
const F = (o: Partial<FacturaVenta> & { id: string }): FacturaVenta => ({
  fuente: 'sumied', entryId: null, numero: 'F-2026/0001', serie: 'F', fecha: '2026-10-01', vence: '2026-10-31', cliente: 'Colegio', nif: '12345678Z',
  origen: 'a_mano', base: 100, iva: 21, total: 121, cobrado: 0, guardado: 'emitida', enviada: false, rectificativa: false, localId: null, diez: 'en_cola', estadoCobro: null, ...o,
})

describe('las cuentas de una factura, como la base', () => {
  const lineas = [L({ cantidad: 10, precio: 100 }), L({ cantidad: 1, precio: 50, descuento: 10, tipoId: 't10', tipo: 10, recargo: 1.4, cuentaId: 'c700' })]
  it('base 1.045, IVA 214,50 y total 1.259,50 (la de la prueba de staging)', () => {
    const c = cifrasDe(lineas, false, 0)
    expect(c).toMatchObject({ base: 1045, iva: 214.5, recargo: 0, retencion: 0, total: 1259.5 })
    expect(c.porTipo).toEqual([{ tipo: 21, base: 1000, iva: 210, recargo: 0 }, { tipo: 10, base: 45, iva: 4.5, recargo: 0 }])
  })
  it('el IVA se redondea por tipo, no por línea', () => {
    // Tres líneas de 0,05 al 21 %: por línea serían 3 × 0,01 = 0,03; por tipo, 0,15 × 21 % = 0,03 también; con 0,07 se ve.
    const c = cifrasDe([L({ precio: 0.07 }), L({ precio: 0.07 }), L({ precio: 0.07 })], false, 0)
    expect(c.iva).toBe(0.04) // 0,21 × 21 % = 0,0441 → 0,04 (por línea, 3 × 0,01 = 0,03)
  })
  it('la retención se resta del total', () => {
    const c = cifrasDe([L({ precio: 1000 })], false, 15)
    expect(c).toMatchObject({ base: 1000, iva: 210, retencion: 150, total: 1060 })
  })
  it('la rectificativa de importes es la diferencia: de 10 a 8 cubiertos, −242', () => {
    const vieja = cifrasDe([L({ cantidad: 10, precio: 121 })], false, 0)
    const nueva = cifrasDe([L({ cantidad: 8, precio: 121 })], false, 0)
    const d = diferenciaDe(nueva, vieja)
    expect(d.base).toBe(-242)
    expect(d.iva).toBe(-50.82)
    expect(d.total).toBe(-292.82)
    expect(d.porTipo).toEqual([{ tipo: 21, base: -242, iva: -50.82, recargo: 0 }])
  })
  it('anular es la diferencia con nada: todo en negativo', () => {
    const vieja = cifrasDe(lineas, false, 0)
    expect(diferenciaDe(cifrasDe([], false, 0), vieja).total).toBe(-1259.5)
  })
})

describe('estado y pestañas (regla 7: suman «Todas»)', () => {
  const todas = [
    F({ id: 'b', guardado: 'borrador', numero: null }),
    F({ id: 'p', cobrado: 0 }),
    F({ id: 'pp', cobrado: 50 }),
    F({ id: 'v', vence: '2026-10-01' }),
    F({ id: 'c', cobrado: 121 }),
    F({ id: 'a', guardado: 'anulada' }),
    F({ id: 'r', rectificativa: true, total: -24.2, base: -20, iva: -4.2 }),
    F({ id: 'l', fuente: 'libro', origen: 'cierre_dia', vence: null, diez: 'enviada' }),
  ]
  it('cada una en su estado', () => {
    expect(todas.map((f) => estadoDe(f, HOY))).toEqual(['borrador', 'emitida', 'cobrada_parte', 'vencida', 'cobrada', 'anulada', 'emitida', 'emitida'])
    expect(estadoDe(F({ id: 'e', enviada: true }), HOY)).toBe('enviada')
  })
  it('PC01: manda el estado de la base (conta_factura_cobro); aquí solo se traduce', () => {
    // La de una plataforma, sin vencer y sin liquidación: «Esperando liquidación», aunque su fecha sea de hoy.
    expect(estadoDe(F({ id: 'p', estadoCobro: 'esperando_liquidacion', vence: '2026-10-01' }), HOY)).toBe('esperando_liquidacion')
    expect(estadoDe(F({ id: 'v', estadoCobro: 'vencida', vence: '2026-10-30' }), HOY)).toBe('vencida')
    expect(estadoDe(F({ id: 's', estadoCobro: 'vence_semana' }), HOY)).toBe('vence_semana')
    expect(estadoDe(F({ id: 'c', estadoCobro: 'cobrada' }), HOY)).toBe('cobrada')
    expect(estadoDe(F({ id: 'x', estadoCobro: 'por_cobrar', enviada: true }), HOY)).toBe('enviada')
    expect(estadoDe(F({ id: 'y', estadoCobro: 'por_cobrar' }), HOY)).toBe('emitida')
    // Lo guardado sigue mandando en borrador y anulada.
    expect(estadoDe(F({ id: 'b', guardado: 'borrador', estadoCobro: 'por_cobrar' }), HOY)).toBe('borrador')
    // En las cifras: va en «Por cobrar», no en «Vencido», y se cuenta aparte.
    const c = cifrasFacturas([F({ id: 'p', estadoCobro: 'esperando_liquidacion', vence: '2026-10-01' }), F({ id: 'v', estadoCobro: 'vencida' })], [], HOY)
    expect(c.porCobrar).toEqual({ total: 121, n: 1, esperando: 1 })
    expect(c.vencido.n).toBe(1)
    expect(pestanaDe(F({ id: 'p', estadoCobro: 'esperando_liquidacion' }), HOY)).toBe('por-cobrar')
  })
  it('PC01 + V01c: validada en mensual y sin cobrar, enseña las dos cosas, cada una en su columna', () => {
    // Estado (el cobro, de la base) y Diez («En el traspaso de octubre») no se pisan.
    const mensual = { encendido: true, mensual: true }
    const f = F({ id: 'm', estadoCobro: 'falta_liquidacion', fecha: '2026-10-12', vence: '2026-10-20',
      diez: diezDeFactura(undefined, mensual, true) })
    expect(NOMBRE_ESTADO[estadoDe(f, HOY)].texto).toBe('Falta su liquidación')
    expect(f.diez).toBe('traspaso')
    expect(textoTraspaso(f.fecha)).toBe('En el traspaso de octubre')
    const p = F({ id: 'p', estadoCobro: 'por_cobrar', diez: diezDeFactura('pendiente', mensual, true) })
    expect(estadoDe(p, HOY)).toBe('emitida')
    expect(p.diez).toBe('traspaso')
  })
  it('PC01: «Falta su liquidación» (Julio, 25/10): ámbar, su pestaña y su cifra, y no suma en Vencido', () => {
    const falta = F({ id: 'f', estadoCobro: 'falta_liquidacion', vence: '2026-10-10', total: 50, cobrado: 0 })
    expect(estadoDe(falta, HOY)).toBe('falta_liquidacion')
    expect(NOMBRE_ESTADO.falta_liquidacion).toEqual({ texto: 'Falta su liquidación', tono: 'duda' })
    expect(NOMBRE_ESTADO.vencida.tono).toBe('falta')
    expect(pestanaDe(falta, HOY)).toBe('falta-liquidacion')
    const c = cifrasFacturas([falta, F({ id: 'v', estadoCobro: 'vencida' }), F({ id: 'p', estadoCobro: 'esperando_liquidacion' })], [], HOY)
    expect(c.faltaLiquidacion).toEqual({ total: 50, n: 1 })
    expect(c.vencido).toMatchObject({ total: 121, n: 1 })
    expect(c.porCobrar).toEqual({ total: 121, n: 1, esperando: 1 })
    // Su pestaña sale solo si las hay, y todas suman «Todas» (regla 7).
    const p = pestanasFacturas([falta, F({ id: 'v', estadoCobro: 'vencida' })], HOY)
    expect(p.find((x) => x.id === 'falta-liquidacion')?.n).toBe(1)
    expect(sumanTodas(p)).toBe(true)
    expect(pestanasFacturas([F({ id: 'v', estadoCobro: 'vencida' })], HOY).some((x) => x.id === 'falta-liquidacion')).toBe(false)
    expect(filtrosFacturas(new URLSearchParams('ver=falta-liquidacion')).pestana).toBe('falta-liquidacion')
  })
  it('cada una en una pestaña, y suman «Todas»', () => {
    expect(todas.map((f) => pestanaDe(f, HOY))).toEqual(['borradores', 'por-cobrar', 'por-cobrar', 'vencidas', 'cobradas', 'anuladas', 'emitidas', 'del-libro'])
    const p = pestanasFacturas(todas, HOY)
    expect(sumanTodas(p)).toBe(true)
    expect(p.find((x) => x.id === 'todas')?.n).toBe(8)
  })
  it('sin rectificativas ni libro, esas dos pestañas no salen', () => {
    const p = pestanasFacturas(todas.filter((f) => f.id !== 'r' && f.id !== 'l'), HOY)
    expect(p.map((x) => x.id)).not.toContain('del-libro')
    expect(p.map((x) => x.id)).not.toContain('emitidas')
    expect(sumanTodas(p)).toBe(true)
  })
  it('las cuatro cifras', () => {
    const c = cifrasFacturas(todas, [{ fecha: '2026-10-03', importe: 50 }, { fecha: '2026-10-05', importe: 121 }, { fecha: '2026-09-30', importe: 9 }], HOY)
    expect(c.porCobrar).toEqual({ total: 192, n: 2, esperando: 0 }) // 121 + 71
    expect(c.vencido.total).toBe(121)
    expect(c.vencido.masAntigua).toEqual({ cliente: 'Colegio', dias: 23 })
    expect(c.cobradoMes).toEqual({ total: 171, n: 2 })
    expect(c.borradores.n).toBe(1)
  })
  it('lo que queda por cobrar, al céntimo', () => {
    expect(quedaPorCobrar({ total: 1259.5, cobrado: 500 })).toBe(759.5)
    expect(quedaPorCobrar({ total: 0.3, cobrado: 0.1 })).toBe(0.2)
  })
  it('los borradores, arriba', () => {
    const f = filtrosFacturas(new URLSearchParams())
    expect(filasFacturas(todas, f, HOY)[0].id).toBe('b')
  })
  it('el total del filtro no suma las anuladas', () => {
    expect(totalDelFiltro([F({ id: '1' }), F({ id: '2', guardado: 'anulada' })])).toBe(121)
  })
  it('solo los orígenes que hay', () => {
    expect(origenesQueHay(todas)).toEqual(['a_mano', 'cierre_dia'])
  })
})

describe('buscar', () => {
  const f = F({ id: '1', cliente: 'Colegio Ávila', numero: 'F-2026/0087', base: 4224, total: 4646.4 })
  it('por cliente sin acentos, por número y por importe', () => {
    expect(casaConBusqueda(f, 'avila')).toBe(true)
    expect(casaConBusqueda(f, '0087')).toBe(true)
    expect(casaConBusqueda(f, '4.224')).toBe(true)
    expect(casaConBusqueda(f, '4646,40')).toBe(true)
    expect(casaConBusqueda(f, '4646,41')).toBe(false)
  })
})

describe('lo que se escribe', () => {
  it('los números, como los escribe la gente', () => {
    expect(numeroDeTexto('1.234,50')).toBe(1234.5)
    expect(numeroDeTexto('1234.5')).toBe(1234.5)
    expect(numeroDeTexto('1.000')).toBe(1000)
    expect(numeroDeTexto('10 %')).toBe(10)
    expect(numeroDeTexto('')).toBeNull()
    expect(numeroDeTexto('abc')).toBeNull()
  })
  it('las líneas: las vacías no cuentan y las mal escritas se dicen', () => {
    const tipos = [{ id: 't21', tipo: 21 }]
    const r = lineasLeidas([
      { concepto: 'Menú', cantidad: '10', precio: '12,50', descuento: '', tipoId: 't21', cuentaId: 'c' },
      { concepto: '', cantidad: '1', precio: '', descuento: '', tipoId: 't21', cuentaId: 'c' },
      { concepto: 'Bebida', cantidad: '0', precio: '2', descuento: '', tipoId: 't21', cuentaId: 'c' },
      { concepto: 'Postre', cantidad: '1', precio: '3', descuento: '120', tipoId: 't21', cuentaId: 'c' },
    ], tipos)
    expect(r.lineas).toHaveLength(1)
    expect(r.lineas[0]).toMatchObject({ cantidad: 10, precio: 12.5, tipo: 21 })
    expect(r.mal).toEqual(['la cantidad de la línea 3', 'el descuento de la línea 4 (de 0 a 100)'])
  })
  it('lo que falta para emitir, en frases', () => {
    expect(faltaParaEmitir({ clienteId: null, nif: null, lineas: [] })).toEqual(['el cliente', 'al menos una línea con concepto, IVA y cuenta'])
    expect(faltaParaEmitir({ clienteId: 'x', nif: null, lineas: [{ concepto: 'a', tipoId: 't', cuentaId: 'c' }] })).toEqual(['el NIF del cliente (en su ficha de Contactos)'])
  })
  it('vence: la fecha más los días de su ficha', () => {
    expect(venceCon('2026-10-24', 30)).toBe('2026-11-23')
    expect(venceCon('2026-10-24', null)).toBeNull()
  })
})

describe('el asiento que se crea', () => {
  const cuentas = [{ id: 'c705', code: '70500000', nombre: 'Prestaciones de servicios' }, { id: 'c700', code: '70000000', nombre: 'Ventas' }]
  const suma = (xs: { debe: number | null; haber: number | null }[]) => xs.reduce((t, x) => [t[0] + Math.round((x.debe ?? 0) * 100), t[1] + Math.round((x.haber ?? 0) * 100)], [0, 0])
  it('430 por el total, 70x por cuenta, 477 por tipo y la 473: cuadra', () => {
    const ls = [L({ cantidad: 10, precio: 100 }), L({ cantidad: 1, precio: 50, descuento: 10, tipoId: 't10', tipo: 10, cuentaId: 'c700' })]
    const a = asientoPrevio(cifrasDe(ls, false, 15), ls, 'Colegio', cuentas)
    expect(a.map((x) => x.codigo)).toEqual(['430', '70500000', '70000000', '477', '477', '473'])
    const [d, h] = suma(a)
    expect(d).toBe(h)
    expect(a[0].debe).toBe(1102.75) // 1.259,50 − 156,75 de retención
  })
  it('una rectificativa en negativo pone cada importe en el otro lado', () => {
    const vieja = cifrasDe([L({ cantidad: 10, precio: 121 })], false, 0)
    const d = diferenciaDe(cifrasDe([L({ cantidad: 8, precio: 121 })], false, 0), vieja)
    const a = asientoPrevio(d, [], 'Colegio', cuentas)
    expect(a[0]).toMatchObject({ codigo: '430', debe: null, haber: 292.82 })
    expect(a.find((x) => x.codigo === '477')).toMatchObject({ debe: 50.82, haber: null })
  })
})

// V01c (Julio, 25/10) · La columna Diez con la empresa en traspaso mensual. Los
// estados son los de producción el 25/10 (Foodint, mensual desde el 01/10): las
// 5 facturas de los cierres validados el 24/10 (GLV-2026/00001 a UBR-2026/00002)
// sin ningún envío; external_send con enviado, enlazado y pendiente.
describe('diezDeFactura y textoTraspaso', () => {
  const MENSUAL = { encendido: true, mensual: true }
  const AL_MOMENTO = { encendido: true, mensual: false }
  const APAGADO = { encendido: false, mensual: false }
  it('en mensual, lo validado sin envío va en el traspaso, no «En cola» (las 5 del 24/10)', () => {
    expect(diezDeFactura(undefined, MENSUAL, true)).toBe('traspaso')
    expect(diezDeFactura('pendiente', MENSUAL, true)).toBe('traspaso')
  })
  it('lo traspasado sale como siempre: ✓ Diez; y un fallo, como fallo', () => {
    expect(diezDeFactura('enviado', MENSUAL, true)).toBe('enviada')
    expect(diezDeFactura('enlazado', MENSUAL, true)).toBe('enviada')
    expect(diezDeFactura('error', MENSUAL, true)).toBe('error')
  })
  it('al validar y apagado, como antes; un borrador, nada', () => {
    expect(diezDeFactura(undefined, AL_MOMENTO, true)).toBe('en_cola')
    expect(diezDeFactura('pendiente', AL_MOMENTO, true)).toBe('en_cola')
    expect(diezDeFactura(undefined, APAGADO, true)).toBe('sin_envio')
    expect(diezDeFactura(undefined, MENSUAL, false)).toBeNull()
  })
  it('el mes es el de su fecha', () => {
    expect(textoTraspaso('2026-10-24')).toBe('En el traspaso de octubre')
    expect(textoTraspaso('2026-09-30')).toBe('En el traspaso de septiembre')
  })
})
