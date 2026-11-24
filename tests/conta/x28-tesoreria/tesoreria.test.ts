// tests/conta/x28-tesoreria/tesoreria.test.ts
//
// X28 · Tesorería como ERP10: la subcuenta de cada fila (la propuesta de una regla y la de la factura que casa, en
// ámbar; sin propuesta, en blanco; lo contabilizado, la de su asiento), los totales y el pie, a cuál baja Intro y qué
// hace (contabilizar lo propuesto, a otra subcuenta, o modificar con el mismo número), lo pendiente de una factura
// antes de este movimiento, y lo que pide a la base «⊕ otro movimiento». Datos inventados.
import { describe, expect, it, vi } from 'vitest'

const bd = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/modules/conta/services/bd', () => ({ rpc: bd.rpc, tabla: vi.fn(), mensaje: (p: string) => p }))
vi.mock('@/modules/conta/services/bancosService', () => ({ bancos: {}, abrirExtracto: vi.fn(), emparejar: vi.fn(), leerYCuadrar: vi.fn() }))
vi.mock('@/modules/conta/services/bancosPantallas', () => ({ pasarAgente: vi.fn() }))

import { MOTOR_BANCOS } from '@/modules/conta/lib/conciliacion'
import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import {
  analiticaDelDestino, facturaDeLaPropuesta, pendienteAntes, queHaceIntro, siguienteSinContabilizar, subcuentaDeFila, textoDelPie, totalesDe, type LineaEd,
} from '@/modules/conta/nucleo/tesoreria/tesoreria'
import { otroMovimiento } from '@/modules/conta/nucleo/tesoreria/servicio'

const BANCO = '57200001'
const LOCAL = '00000000-0000-4000-8000-0000000000a1'
const MARCA = '00000000-0000-4000-8000-0000000000b1'
const PLATAFORMA = '00000000-0000-4000-8000-0000000000c1'
const FACTURA = '00000000-0000-4000-8000-0000000000f1'

const mov = (x: Partial<MovimientoBanco> & { id: string; importe: number }): MovimientoBanco => ({
  cuentaId: 'b', fecha: '2026-11-13', importeCent: Math.round(x.importe * 100), conceptoBanco: 'RECIBO EJEMPLO', conceptoLimpio: 'Recibo Ejemplo',
  estado: 'por_aclarar', confianza: null, porque: null, propuesta: null, casado: null, tarjeta: null, ticket: null, motivoIgnorado: null, ...x,
})
const deRegla = mov({ id: 'r', importe: -54.45, estado: 'propuesto', confianza: 'probable', porque: 'La regla «SECURITAS»',
  propuesta: { que: 'Seguridad y alarmas', motor: MOTOR_BANCOS, reglaId: 'regla1', destino: { tipo: 'cuenta', concepto: 'Recibo seguridad', lineas: [{ cuenta: '62900005', importe: 54.45 }] } } })
const deFactura = mov({ id: 'f', importe: -63.6, estado: 'propuesto', confianza: 'probable', porque: 'Mismo importe que la factura YI-0001',
  propuesta: { que: 'Pago de la factura YI-0001', motor: MOTOR_BANCOS, destino: { tipo: 'factura_recibida', facturas: [{ id: FACTURA, importe: 63.6 }], cuenta_tercero: '41000013', tercero_id: null, concepto: 'Pago de la factura YI-0001' } } })
const sinNada = mov({ id: 'n', importe: -25 })
const contabilizado = mov({ id: 'c', importe: 2311.4, estado: 'casado', casado: { id: 'cas', tipo: 'liquidacion', porque: '', porQuien: 'persona', asientoId: 'as1', asientoConcepto: 'Liquidación', asientoEstado: 'validado' } })
const apartado = mov({ id: 'a', importe: -31.5, estado: 'ignorado', motivoIgnorado: 'Anulado por el banco' })

describe('la subcuenta de cada fila', () => {
  it('la de una regla y la de la factura que casa: propuestas de Sumied (ámbar)', () => {
    expect(subcuentaDeFila(deRegla, BANCO, null)).toEqual({ codigo: '62900005', propuesta: true })
    expect(subcuentaDeFila(deFactura, BANCO, null)).toEqual({ codigo: '41000013', propuesta: true })
  })
  it('si Sumied no sabe, en blanco; lo apartado, tampoco lleva', () => {
    expect(subcuentaDeFila(sinNada, BANCO, null)).toEqual({ codigo: null, propuesta: false })
    expect(subcuentaDeFila(apartado, BANCO, null)).toEqual({ codigo: null, propuesta: false })
  })
  it('lo contabilizado, la de su asiento, sin ámbar', () => {
    expect(subcuentaDeFila(contabilizado, BANCO, '43000002')).toEqual({ codigo: '43000002', propuesta: false })
  })
  it('la factura de la propuesta, para el documento de la derecha', () => {
    expect(facturaDeLaPropuesta(deFactura)).toEqual({ tipo: 'recibida', id: FACTURA })
    expect(facturaDeLaPropuesta(deRegla)).toBeNull()
  })
})

describe('los totales y el pie', () => {
  const movs = [contabilizado, deRegla, deFactura, sinNada, apartado]
  it('ingresos y pagos sin signo; lo apartado se ve y no suma', () => {
    expect(totalesDe(movs)).toEqual({ ingresosCent: 231140, pagosCent: 5445 + 6360 + 2500, movimientos: 5, sinContabilizar: 3 })
  })
  it('«5 movimientos · 3 sin contabilizar»; uno, en singular', () => {
    expect(textoDelPie(totalesDe(movs))).toBe('5 movimientos · 3 sin contabilizar')
    expect(textoDelPie(totalesDe([contabilizado]))).toBe('1 movimiento · 0 sin contabilizar')
  })
  it('Intro baja al siguiente sin contabilizar; al final, vuelve al primero que quede; si no queda ninguno, -1', () => {
    expect(siguienteSinContabilizar(movs, 0)).toBe(1)
    expect(siguienteSinContabilizar(movs, 3)).toBe(1)
    expect(siguienteSinContabilizar([contabilizado, apartado], 0)).toBe(-1)
  })
})

describe('qué hace Intro', () => {
  const linea = (x: Partial<LineaEd>): LineaEd => ({ cuenta: null, concepto: '', local: null, marca: null, plataforma: null, ...x })
  it('con la subcuenta que propone Sumied: contabiliza lo propuesto (paga la factura), con la analítica de la línea', () => {
    const o = linea({ cuenta: '41000013', concepto: 'Pago de la factura YI-0001' })
    const i = queHaceIntro(deFactura, { ...o, local: LOCAL, marca: MARCA, plataforma: PLATAFORMA }, o, BANCO)
    expect(i).toEqual({ que: 'propuesta', destino: { tipo: 'factura_recibida', facturas: [{ id: FACTURA, importe: 63.6 }], cuenta_tercero: '41000013', tercero_id: null,
      concepto: 'Pago de la factura YI-0001', local_id: LOCAL, marca_id: MARCA, canal_id: PLATAFORMA } })
  })
  it('a otra subcuenta: a esa, por el importe del movimiento, con su concepto', () => {
    const o = linea({ cuenta: '62900005', concepto: 'Recibo seguridad' })
    expect(queHaceIntro(deRegla, { ...o, cuenta: '62800000', concepto: 'Alarma noviembre' }, o, BANCO))
      .toEqual({ que: 'cuenta', destino: { tipo: 'cuenta', concepto: 'Alarma noviembre', lineas: [{ cuenta: '62800000', importe: 54.45 }] } })
  })
  it('sin subcuenta, no contabiliza y dice qué falta', () => {
    expect(queHaceIntro(sinNada, linea({}), linea({}), BANCO)).toEqual({ que: 'nada', porque: 'Falta la subcuenta: escríbela o búscala con F4.' })
  })
  it('una propuesta de otro motor no se contabiliza: se vuelve a calcular', () => {
    const viejo = { ...deRegla, propuesta: { ...deRegla.propuesta!, motor: '2026-01-01.0' } }
    const o = linea({ cuenta: '62900005' })
    expect(queHaceIntro(viejo, o, o, BANCO)).toEqual({ que: 'recalcular' })
  })
  it('lo contabilizado: si algo cambió, modificar (el mismo número); si no, nada y baja', () => {
    const o = linea({ cuenta: '43000002', concepto: 'Liquidación', local: 'comun' })
    expect(queHaceIntro(contabilizado, { ...o, concepto: 'Liquidación Glovo', marca: MARCA }, o, BANCO))
      .toEqual({ que: 'modificar', cambios: { concepto: 'Liquidación Glovo', marca: MARCA } })
    expect(queHaceIntro(contabilizado, o, o, BANCO)).toEqual({ que: 'nada', porque: null })
  })
  it('lo apartado no se contabiliza aquí, y se dice', () => {
    expect(queHaceIntro(apartado, linea({ cuenta: '62600000' }), linea({}), BANCO).que).toBe('nada')
  })
  it('la analítica: solo los ids («común» no viaja: es lo de siempre)', () => {
    expect(analiticaDelDestino({ local: 'comun', marca: null, plataforma: PLATAFORMA })).toEqual({ canal_id: PLATAFORMA })
  })
})

describe('lo pendiente de una factura antes de este movimiento', () => {
  it('el total menos lo pagado por otros movimientos hasta su fecha (ni este ni los de después)', () => {
    const pagos = [{ movimiento: 'x', fecha: '2026-11-01', cent: 2000 }, { movimiento: 'f', fecha: '2026-11-13', cent: 6360 }, { movimiento: 'y', fecha: '2026-11-20', cent: 1000 }]
    expect(pendienteAntes(10000, pagos, { id: 'f', fecha: '2026-11-13' })).toBe(8000)
  })
})

describe('⊕ otro movimiento llama a la base con su analítica', () => {
  it('conta_tesoreria_a_mano: el importe con signo, y solo ids en la analítica', async () => {
    bd.rpc.mockResolvedValue({ texto: 'Apuntado y validado: asiento 7, pago de 12,50 € en 62600000 (Comisión).' })
    const r = await otroMovimiento({ bancoId: 'b1', fecha: '2026-11-21', cuenta: '62600000', concepto: 'Comisión', importeCent: -1250, quien: 'Prueba', local: 'comun', marca: MARCA, plataforma: null })
    expect(bd.rpc).toHaveBeenLastCalledWith('conta_tesoreria_a_mano', { p_banco: 'b1', p_fecha: '2026-11-21', p_cuenta: '62600000', p_concepto: 'Comisión', p_importe: -12.5,
      p_quien_nombre: 'Prueba', p_local: null, p_marca: MARCA, p_plataforma: null })
    expect(r).toMatch(/^Apuntado y validado: asiento 7/)
  })
})
