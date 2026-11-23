// tests/conta/x29-conciliar/conciliar.test.ts
//
// X29 · Conciliar (Gestión de extractos bancarios): los filtros, los recuentos (antes del inicio, apartado,
// contabilizado, pendiente), el pie, el saldo línea a línea, el «Por qué», los avisos y la franja de lo hecho hoy, y
// contabilizar en bloque (qué hace Intro con cada marcada). Datos inventados.
import { describe, expect, it } from 'vitest'
import { MOTOR_BANCOS } from '@/modules/conta/lib/conciliacion'
import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import {
  avisos, colorDe, filtrar, pendiente, porQueDe, recuento, saldos, siguientePendiente, textoDelPie, textoHechoHoy, textoMarcados, textosDeAvisos,
  type Filtros, type Linea,
} from '@/modules/conta/nucleo/conciliar/conciliar'
import { queHaceIntro, type LineaEd } from '@/modules/conta/nucleo/tesoreria/tesoreria'

const mov = (id: string, fecha: string, importe: number, x: Partial<MovimientoBanco> = {}): MovimientoBanco => ({
  id, cuentaId: 'b', fecha, importeCent: Math.round(importe * 100), conceptoBanco: `CONCEPTO ${id}`, conceptoLimpio: `Concepto ${id}`,
  estado: 'por_aclarar', confianza: null, porque: null, propuesta: null, casado: null, tarjeta: null, ticket: null, motivoIgnorado: null, ...x,
})
const linea = (m: MovimientoBanco, x: Partial<Linea> = {}): Linea => ({ m, antes: false, validado: false, subcuenta: null, ...x })
const casado = (tipo = 'cuenta', porQuien: 'folvy' | 'persona' = 'persona') => ({ estado: 'casado' as const, casado: { id: 'c', tipo, porque: 'Regla: comisiones', porQuien, asientoId: 'a', asientoConcepto: 'Comisión', asientoEstado: 'validado' as const } })

const L = [
  linea(mov('antes', '2026-09-28', -40), { antes: true }),
  linea(mov('hecho', '2026-10-04', -12, casado()), { subcuenta: '62600000', validado: true }),
  linea(mov('regla', '2026-10-09', -315, { estado: 'propuesto', confianza: 'probable', porque: 'Regla: TGSS', propuesta: { motor: MOTOR_BANCOS, origen: 'regla', destino: { tipo: 'cuenta', concepto: 'Cuota', lineas: [{ cuenta: '64200000', importe: 315 }] } } }), { subcuenta: '64200000' }),
  linea(mov('memoria', '2026-10-20', 94.54, { estado: 'propuesto', confianza: 'probable', porque: 'Como las 6 anteriores', propuesta: { motor: MOTOR_BANCOS, origen: 'historial', destino: { tipo: 'cuenta', concepto: 'Uber', lineas: [{ cuenta: '43000002', importe: 94.54 }] } } }), { subcuenta: '43000002' }),
  linea(mov('falta', '2026-11-08', -187.40)),
  linea(mov('apartado', '2026-11-12', -31.5, { estado: 'ignorado', motivoIgnorado: 'Anulado por el banco' })),
  linea(mov('cobro', '2026-11-20', 1231.62, { estado: 'propuesto', confianza: 'probable', porque: 'Tres facturas', propuesta: { motor: MOTOR_BANCOS, origen: 'factura', destino: { tipo: 'factura_emitida', concepto: 'Glovo', facturas: [{ id: 'x', importe: 1 }, { id: 'y', importe: 1 }, { id: 'z', importe: 1 }], lineas: [{ cuenta: '43000001', importe: 1231.62 }] } } }), { subcuenta: '43000001' }),
]
const todo: Filtros = { desde: '2026-10-01', hasta: '2026-12-31', subcuenta: 'todos', validados: 'todos', contabilizados: 'todos', buscar: '' }
const ids = (ls: Linea[]) => ls.map((l) => l.m.id)

describe('los filtros', () => {
  it('por defecto, desde el día de inicio: lo de antes no se ve', () => {
    expect(ids(filtrar(L, todo))).toEqual(['hecho', 'regla', 'memoria', 'falta', 'apartado', 'cobro'])
  })
  it('pedido, lo de antes sale (en gris)', () => {
    const v = filtrar(L, { ...todo, desde: '2026-09-01' })
    expect(ids(v)[0]).toBe('antes')
    expect(colorDe(v[0])).toBe('gris')
  })
  it('subcuenta, validados y contabilizados: sí, no y todos', () => {
    expect(ids(filtrar(L, { ...todo, subcuenta: 'no' }))).toEqual(['falta', 'apartado'])
    expect(ids(filtrar(L, { ...todo, validados: 'si' }))).toEqual(['hecho'])
    expect(ids(filtrar(L, { ...todo, contabilizados: 'no' }))).toEqual(['regla', 'memoria', 'falta', 'apartado', 'cobro'])
  })
  it('buscar por concepto (sin acentos ni mayúsculas) o por importe, con o sin signo', () => {
    expect(ids(filtrar(L, { ...todo, buscar: 'concepto falta' }))).toEqual(['falta'])
    expect(ids(filtrar(L, { ...todo, buscar: '1.231,62' }))).toEqual(['cobro'])
    expect(ids(filtrar(L, { ...todo, buscar: '-187,40' }))).toEqual(['falta'])
  })
})

describe('los recuentos y el pie', () => {
  it('antes del inicio, apartado, contabilizado y pendiente, cada uno en su sitio', () => {
    expect(recuento(L, 318)).toEqual({ desdeInicio: 6, sinContabilizar: 4, propuestos: 3, sinFactura: 2, antes: 319 })
    expect(pendiente(L[0])).toBe(false)
    expect(pendiente(L[5])).toBe(false)
  })
  it('«6 desde el inicio (01/10) · 4 sin contabilizar · 3 propuestos · 2 sin factura · 319 de antes del inicio»', () => {
    expect(textoDelPie(recuento(L, 318), '2026-10-01')).toEqual(['6 desde el inicio (01/10)', '4 sin contabilizar', '3 propuestos', '2 sin factura', '319 de antes del inicio'])
  })
  it('lo marcado: «3 marcados · 1.641,16 €», sin signo', () => {
    expect(textoMarcados([L[2], L[3], L[6]])).toBe('3 marcados · 1.641,16 €')
    expect(textoMarcados([])).toBeNull()
  })
  it('Intro se salta lo de antes del inicio, lo contabilizado y lo apartado', () => {
    expect(siguientePendiente(L, 0)).toBe(2)
    expect(siguientePendiente(L, 4)).toBe(6)
    expect(siguientePendiente(L, 6)).toBe(2)
  })
})

describe('el saldo línea a línea', () => {
  it('del saldo del extracto a su fecha, hacia atrás y hacia delante', () => {
    const ms = [mov('a', '2026-11-01', -10), mov('b', '2026-11-02', 20), mov('c', '2026-11-03', -5), mov('d', '2026-11-05', 100)]
    expect(saldos(ms, { cent: 100_000, fecha: '2026-11-03' })).toEqual([98_500, 100_500, 100_000, 110_000])
  })
  it('sin saldo del banco, en blanco', () => {
    expect(saldos([mov('a', '2026-11-01', -10)], null)).toEqual([null])
  })
})

describe('el «Por qué»', () => {
  it('regla, memoria («Como 6 ant.») y facturas, con su seguridad; el porqué entero, en el title', () => {
    expect(porQueDe(L[2])).toEqual({ texto: 'Regla · probable', tono: 'regla', title: 'Regla: TGSS' })
    expect(porQueDe(L[3])).toMatchObject({ texto: 'Como 6 ant. · probable', tono: 'memoria' })
    expect(porQueDe(L[6])).toMatchObject({ texto: '3 facturas · probable', tono: 'factura' })
  })
  it('un pago sin propuesta: «Falta»; lo contabilizado, por qué se concilió; lo de antes y lo apartado, nada', () => {
    expect(porQueDe(L[4])).toMatchObject({ texto: 'Falta', tono: 'falta' })
    expect(porQueDe(L[1])).toMatchObject({ texto: 'A mano', tono: 'hecho', title: 'Regla: comisiones' })
    expect(porQueDe(L[0])).toBeNull()
    expect(porQueDe(L[5])).toBeNull()
  })
  it('los colores: verde, ámbar, amarillo y gris', () => {
    expect(L.map(colorDe)).toEqual(['gris', 'verde', 'ambar', 'ambar', 'amarillo', 'gris', 'ambar'])
  })
})

describe('los avisos y lo hecho hoy', () => {
  it('más de 10 días sin conciliar, un banco sin leer desde hace más de un día y los pagos sin factura', () => {
    const a = avisos(L, [{ nombre: 'Cuenta principal', leido: '2026-11-20T09:00:00Z' }, { nombre: 'Banco Uno', leido: '2026-11-23T07:00:00Z' }], '2026-11-23')
    expect(textosDeAvisos(a)).toEqual(['3 movimientos llevan más de 10 días sin conciliar', 'Cuenta principal: el extracto no se lee desde el 20/11', '2 pagos sin factura'])
  })
  it('«Hoy Sumied ha conciliado solo 41 movimientos de los 4 bancos (32 por regla, 7 con su factura, 2 como los anteriores).»', () => {
    expect(textoHechoHoy({ n: 41, bancos: 4, regla: 32, factura: 7, memoria: 2, otros: 0 }))
      .toBe('Hoy Sumied ha conciliado solo 41 movimientos de los 4 bancos (32 por regla, 7 con su factura, 2 como los anteriores).')
    expect(textoHechoHoy({ n: 0, bancos: 0, regla: 0, factura: 0, memoria: 0, otros: 0 })).toBeNull()
  })
})

describe('contabilizar en bloque', () => {
  const vacia = (x: Partial<LineaEd> = {}): LineaEd => ({ cuenta: null, concepto: '', local: null, marca: null, plataforma: null, ...x })
  it('cada marcada, con lo que propone Sumied; la que no tiene subcuenta, no, y dice qué falta', () => {
    const r = [L[2], L[6], L[4]].map((l) => queHaceIntro(l.m, vacia({ cuenta: l.subcuenta }), vacia({ cuenta: l.subcuenta }), '57200002'))
    expect(r.map((x) => x.que)).toEqual(['propuesta', 'propuesta', 'nada'])
    expect(r[2]).toEqual({ que: 'nada', porque: 'Falta la subcuenta: escríbela o búscala con F4.' })
  })
})
