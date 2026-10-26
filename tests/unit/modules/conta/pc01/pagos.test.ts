// tests/unit/modules/conta/pc01/pagos.test.ts
//
// PC01 · Entrega 2 · Compras › Pagos (tablero 15), sin React: el estado de cada
// fila, las pestañas, las cifras, qué entra en una remesa y por qué no, y los
// pasos de la ficha de la remesa (tablero 16).
//
// Las filas son las de la forma que da conta_pagos_lista. Los casos salen de lo
// medido en Foodint el 26/10 (95 recibidas: 87 pagadas, 6 sin vencimiento y 2
// vencidas; de 71 proveedores, 1 con IBAN y 65 con su 400) y de los del tablero:
// la transferencia vencida de Distribuciones Cárnicas, la domiciliada del
// alquiler, la pagada en parte, la que ya está en la remesa R-014.

import { describe, expect, it } from 'vitest'
import {
  chipEstado, cifrasPagos, cumpleBuscar, enPestana, estadoPago, filaPago, filtrar, libre, ordenarPagos, pasosRemesa, porQueNoEnRemesa, proximoLaborable, remesaQueSePropone, VALIDADO_SOLO,
  type FilaPago,
} from '@/modules/conta/lib/pagos'
import { sufijoParaLaBase } from '@/modules/conta/tablas/registro'

const f = (x: Record<string, unknown>): FilaPago => filaPago({
  id: x.id ?? 'x', supplier_id: 's', proveedor: 'Proveedor', numero: 'N-1', fecha: '2026-10-01', vence: '2026-11-04', total: 100, pagado: 0, pendiente: 100,
  estado: 'por_pagar', dias_vencida: null, forma: 'transfer', location_id: null, local: null, iban4: '0418', con_iban: true, con_cuenta: true, remesa: null, ...x,
})

const CARNICAS = f({ id: 'carnicas', proveedor: 'Distribuciones Cárnicas Vallecas SL', numero: 'DCV-2026/1184', vence: '2026-10-20', total: 1105.30, pendiente: 1105.30, estado: 'vencida', dias_vencida: 5 })
const ALQUILER = f({ id: 'alquiler', proveedor: 'Inmuebles Retiro SL', numero: '2026-10', vence: '2026-10-31', total: 1815, pendiente: 1815, estado: 'vence_semana', forma: 'direct_debit' })
const ENVASES = f({ id: 'envases', proveedor: 'Envases Sostenibles Iberia SL', vence: '2026-11-05', total: 1204.15, pagado: 600, pendiente: 604.15, estado: 'pagada_parte' })
const FRUTAS = f({ id: 'frutas', proveedor: 'Frutas y Verduras Mercamadrid SL', vence: null, total: 418.62, pendiente: 418.62, estado: 'sin_vencimiento' })
const GESTORIA = f({ id: 'gestoria', proveedor: 'Gestoría Martín Asesores', vence: '2026-11-12', total: 290.40, pendiente: 290.40, remesa: { id: 'r14', codigo: 'R-2026/014', importe: 290.40 } })
const SIN_IBAN = f({ id: 'siniban', proveedor: 'Limpiezas Brillo SL', iban4: null, con_iban: false })
const PAGADA = f({ id: 'pagada', proveedor: 'Catcher', total: 23.10, pagado: 23.10, pendiente: 0, estado: 'pagada', forma: 'prepaid' })

describe('el estado de cada fila (tablero 15)', () => {
  it('vencida, con sus días, en rojo', () => {
    expect(estadoPago(CARNICAS)).toBe('vencida')
    expect(chipEstado(CARNICAS)).toEqual({ texto: 'Vencida · 5 días', tono: 'falta' })
  })
  it('la domiciliada «la paga el banco solo», y no entra en una remesa', () => {
    expect(chipEstado(ALQUILER)).toEqual({ texto: 'La paga el banco solo', tono: 'neutro' })
    expect(porQueNoEnRemesa(ALQUILER)).toBe('la paga el banco solo (domiciliada)')
  })
  it('pagada en parte: lo que queda, y entra en la remesa por lo que queda', () => {
    expect(chipEstado(ENVASES)).toEqual({ texto: 'Pagada en parte', tono: 'duda' })
    expect(libre(ENVASES)).toBe(604.15)
    expect(porQueNoEnRemesa(ENVASES)).toBeNull()
  })
  it('en la remesa: su código, y ya no entra en otra', () => {
    expect(estadoPago(GESTORIA)).toBe('en_remesa')
    expect(chipEstado(GESTORIA)).toEqual({ texto: 'En la remesa R-2026/014', tono: 'seguro' })
    expect(porQueNoEnRemesa(GESTORIA)).toBe('ya está en la remesa R-2026/014')
  })
  it('sin IBAN en su ficha no entra (Foodint: 1 proveedor de 71 lo tiene)', () => {
    expect(porQueNoEnRemesa(SIN_IBAN)).toBe('Limpiezas Brillo SL no tiene IBAN en su ficha')
    expect(porQueNoEnRemesa(f({ con_cuenta: false, proveedor: 'Sin 400' }))).toBe('Sin 400 no tiene su cuenta de proveedor (400)')
  })
  it('pagada: no entra y sale en «Pagadas»', () => {
    expect(porQueNoEnRemesa(PAGADA)).toBe('ya está pagada')
    expect(enPestana(PAGADA, 'pagadas')).toBe(true)
    expect(enPestana(PAGADA, 'por_pagar')).toBe(false)
  })
})

describe('las pestañas, los filtros y las cifras', () => {
  const todas = [CARNICAS, ALQUILER, ENVASES, FRUTAS, GESTORIA, SIN_IBAN, PAGADA]
  it('«Por pagar» son todas las que quedan (regla 7); las demás, trozos', () => {
    expect(filtrar(todas, 'por_pagar', { buscar: '', hasta: null, forma: 'todas', local: null }).map((x) => x.id)).toEqual(['carnicas', 'alquiler', 'envases', 'frutas', 'gestoria', 'siniban'])
    expect(filtrar(todas, 'vencidas', { buscar: '', hasta: null, forma: 'todas', local: null }).map((x) => x.id)).toEqual(['carnicas'])
    expect(filtrar(todas, 'sin_vencimiento', { buscar: '', hasta: null, forma: 'todas', local: null }).map((x) => x.id)).toEqual(['frutas'])
    expect(filtrar(todas, 'en_remesa', { buscar: '', hasta: null, forma: 'todas', local: null }).map((x) => x.id)).toEqual(['gestoria'])
  })
  it('«Vence: hasta el…» deja lo que vence antes y lo que no tiene fecha', () => {
    expect(filtrar(todas, 'por_pagar', { buscar: '', hasta: '2026-10-31', forma: 'todas', local: null }).map((x) => x.id)).toEqual(['carnicas', 'alquiler', 'frutas'])
  })
  it('buscar por proveedor, número o importe (con coma o con punto)', () => {
    expect(cumpleBuscar(CARNICAS, 'cárnicas')).toBe(true)
    expect(cumpleBuscar(CARNICAS, 'DCV-2026')).toBe(true)
    expect(cumpleBuscar(CARNICAS, '1.105,30')).toBe(true)
    expect(cumpleBuscar(CARNICAS, '1105.30')).toBe(true)
    expect(cumpleBuscar(ENVASES, '604,15')).toBe(true)
    expect(cumpleBuscar(CARNICAS, 'brillo')).toBe(false)
  })
  it('las cifras: por pagar, esta semana, vencido (con los días del más viejo) y pagado en el mes', () => {
    const c = cifrasPagos(todas, 22107.88, 41)
    expect(c.porPagar).toEqual({ importe: 4333.47, n: 6 })
    expect(c.semana).toEqual({ importe: 1815, n: 1 })
    expect(c.vencido).toEqual({ importe: 1105.30, n: 1, dias: 5 })
    expect(c.pagadoMes).toEqual({ importe: 22107.88, n: 41 })
    expect(c.sinVencimiento).toBe(1)
  })
  it('primero lo que vence antes; sin vencimiento al final', () => {
    expect(ordenarPagos([FRUTAS, GESTORIA, CARNICAS, ALQUILER]).map((x) => x.id)).toEqual(['carnicas', 'alquiler', 'gestoria', 'frutas'])
  })
})

describe('la remesa (tablero 16)', () => {
  const pasos = (e: Parameters<typeof pasosRemesa>[0], aMano = false) => pasosRemesa(e, aMano).map((p) => `${p.hecho ? '✓' : p.actual ? '●' : '·'} ${p.etiqueta}`)
  it('preparada con un IBAN por confirmar: el paso 2, «Fichero para el banco», es el que toca', () => {
    expect(pasos('preparada')).toEqual(['✓ Preparada', '● Fichero para el banco', '· En el banco: esperando el cargo', '· Pagada'])
  })
  it('descargada: esperando el cargo; casada: pagada entera', () => {
    expect(pasos('en_banco')).toEqual(['✓ Preparada', '✓ Fichero para el banco', '● En el banco: esperando el cargo', '· Pagada'])
    expect(pasos('pagada')).toEqual(['✓ Preparada', '✓ Fichero para el banco', '✓ En el banco: esperando el cargo', '✓ Pagada'])
  })
  it('a mano no hay fichero: Preparada → En el banco → Pagada', () => {
    expect(pasos('en_banco', true)).toEqual(['✓ Preparada', '● En el banco: esperando el cargo', '· Pagada'])
  })
  it('la fecha de pago por defecto: el siguiente día laborable', () => {
    expect([proximoLaborable('2026-10-26'), proximoLaborable('2026-10-30'), proximoLaborable('2026-10-31')]).toEqual(['2026-10-27', '2026-11-02', '2026-11-02'])
  })
})

describe('respuesta 7: Bancos propone la remesa, el asiento validado solo y el sufijo del banco', () => {
  const entera = (codigo: string) => ({ codigo, lineas: null })
  const suelto = (codigo: string, id: string) => ({ codigo, lineas: [id] })
  it('una sola remesa entera cuadra con el cargo: se propone sola (lo demás, debajo)', () => {
    const r = remesaQueSePropone([entera('R-2026/015'), suelto('R-2026/014', 'l9')])
    expect(r.propuesta?.codigo).toBe('R-2026/015')
    expect(r.resto.map((x) => x.codigo)).toEqual(['R-2026/014'])
  })
  it('dos o más cuadran: no se propone ninguna, se elige', () => {
    const r = remesaQueSePropone([entera('R-2026/015'), entera('R-2026/016')])
    expect(r.propuesta).toBeNull()
    expect(r.resto).toHaveLength(2)
  })
  it('solo un pago suelto cuadra: no es la remesa entera, se elige', () => {
    expect(remesaQueSePropone([suelto('R-2026/014', 'l9')]).propuesta).toBeNull()
  })
  it('el paso «Pagada» lo dice solo si se validó solo, y solo pagada', () => {
    const pagada = pasosRemesa('pagada', false, true)
    expect(pagada[3]).toMatchObject({ etiqueta: 'Pagada', hecho: true, detalle: 'Asiento validado solo: el cargo cuadra con la remesa' })
    expect(VALIDADO_SOLO).toBe('Asiento validado solo: el cargo cuadra con la remesa')
    expect(pasosRemesa('pagada', false, false)[3].detalle).toBeUndefined()
    expect(pasosRemesa('en_banco', false, true)[3].detalle).toBeUndefined()
  })
  it('el sufijo del banco: «000» de serie no se manda; otro, sí; volver a «000» lo deja vacío', () => {
    expect(sufijoParaLaBase({ sepa_suffix: '000' })).toEqual({})
    expect(sufijoParaLaBase({ sepa_suffix: '' })).toEqual({})
    expect(sufijoParaLaBase({ sepa_suffix: '123' })).toEqual({ sepa_suffix: '123' })
    expect(sufijoParaLaBase({ sepa_suffix: '000', _sufijo_antes: '123' })).toEqual({ sepa_suffix: null })
  })
})

