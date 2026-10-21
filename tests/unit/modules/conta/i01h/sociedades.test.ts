// tests/unit/modules/conta/i01h/sociedades.test.ts
//
// I01h · El Impuesto de sociedades en palabras: en qué punto está cada 202
// (con el 200 del que sale), lo que salió a devolver y el formulario del 200.
// Cifras inventadas: las de Foodint no van al repositorio. La forma es la que
// devuelve conta_impuesto_sociedades (0340).

import { describe, expect, it } from 'vitest'
import { estado202, fraseDevolucion, resultado200, validar200, type Formulario200, type Pago202 } from '@/modules/conta/impuestos/sociedades'

const pago = (o: Partial<Pago202> = {}, d: Partial<NonNullable<Pago202['declaracion']>> | null = null): Pago202 => ({
  ejercicio: 2026, periodo: '2P', ejercicio_base: 2025, plazo: '2026-10-20', cuota_200: 2000, esperado: 360,
  declaracion: d === null ? null : {
    id: 'd1', estado: 'draft', estado_texto: 'Borrador', resultado: 'to_pay', importe: 360, no_hace_falta: null, c01: 2000, c03: 360, origen: 'calculated', ...d,
  },
  ...o,
})

describe('en qué punto está un 202', () => {
  it('a cero: no hay que presentarlo, con el porqué de la base', () => {
    expect(estado202(pago({ cuota_200: 0, esperado: 0 }, { estado: 'not_required', no_hace_falta: 'el impuesto de 2025 salió a cero', resultado: 'zero', importe: 0, c01: 0, c03: 0 })))
      .toEqual({ tono: 'neutro', texto: 'No hay que presentarlo: el impuesto de 2025 salió a cero.' })
  })
  it('a cero y aún sin calcular: lo dice igual, sin esperar al botón', () => {
    expect(estado202(pago({ cuota_200: 0, esperado: 0 })).texto).toBe('No hay que presentarlo: el impuesto del 2025 salió a cero.')
  })
  it('sin el 200 del que sale: lo pide, no inventa la base', () => {
    expect(estado202(pago({ cuota_200: null, esperado: null }))).toEqual({ tono: 'falta', texto: 'Falta el Impuesto de sociedades del 2025: escribe su cuota abajo y Sumied lo calcula.' })
  })
  it('calculado: el importe y de dónde sale', () => {
    expect(estado202(pago({}, {})).texto).toBe('360,00 € a ingresar (el 18 % de 2.000,00 €, la cuota del 2025).')
  })
  it('presentado: casa si es el 18 % de la cuota del 200 del que sale', () => {
    const p = pago({ periodo: '1P', ejercicio_base: 2024 }, { estado: 'filed', origen: 'justificante' })
    expect(estado202(p)).toEqual({ tono: 'ok', texto: 'Presentado: 360,00 €, el 18 % de la cuota del 2024. Casa.' })
  })
  it('presentado y no casa: lo dice con las dos cifras', () => {
    const p = pago({ periodo: '1P', ejercicio_base: 2024 }, { estado: 'filed', c03: 350, importe: 350 })
    expect(estado202(p)).toEqual({ tono: 'falta', texto: 'Presentado: 350,00 €, y el 18 % de la cuota del 2024 da 360,00 €. No casa.' })
  })
})

describe('lo que salió a devolver', () => {
  it('pendiente de cobrar hasta que llega al banco', () => {
    expect(fraseDevolucion(2025, { importe: 300, cobrado: 0, cobrado_el: null, asiento: null, pendiente: 300 }))
      .toEqual({ tono: 'falta', texto: '300,00 € a devolver del 2025, pendientes de cobrar: Sumied lo da por cobrado cuando llegue al banco.' })
  })
  it('cobrado en parte: lo que queda', () => {
    expect(fraseDevolucion(2025, { importe: 300, cobrado: 100, cobrado_el: '2026-10-15', asiento: 'a1', pendiente: 200 }).texto)
      .toBe('Del 2025 quedan 200,00 € por cobrar de 300,00 € a devolver: llegaron 100,00 € al banco.')
  })
  it('cobrado: con la fecha del banco', () => {
    expect(fraseDevolucion(2025, { importe: 300, cobrado: 300, cobrado_el: '2026-10-15', asiento: 'a1', pendiente: 0 }).tono).toBe('ok')
  })
  it('el resultado de un 200 en palabras', () => {
    expect([resultado200({ resultado: 'to_refund', importe: 300 }), resultado200({ resultado: 'to_pay', importe: 2000 }), resultado200({ resultado: 'zero', importe: 0 })])
      .toEqual(['300,00 € a devolver', '2.000,00 € a ingresar', 'Resultado cero'])
  })
})

describe('el formulario del 200', () => {
  const ok: Formulario200 = { ejercicio: '2025', presentado: '2026-07-14', base: '-5.000,00', cuota: '0', resultado: 'to_refund', importe: '300,00', motivo: 'El justificante de la gestoría' }
  it('lo que se manda a la base: la base negativa, la cuota a cero y el importe sin signo', () => {
    expect(validar200(ok, '2026-10-21')).toEqual({ errores: {}, datos: { ejercicio: 2025, motivo: 'El justificante de la gestoría',
      datos: { presentado: '2026-07-14', base_imponible: -5000, cuota: 0, resultado: 'to_refund', importe: 300 } } })
  })
  it('a cero, el importe es 0 aunque no se escriba', () => {
    expect(validar200({ ...ok, resultado: 'zero', importe: '' }, '2026-10-21').datos?.datos.importe).toBe(0)
  })
  it('lo que no vale, campo a campo', () => {
    const e = validar200({ ejercicio: '25', presentado: '', base: 'mucho', cuota: '-1', resultado: '', importe: '', motivo: ' ' }, '2026-10-21').errores
    expect(Object.keys(e).sort()).toEqual(['base', 'cuota', 'ejercicio', 'motivo', 'presentado', 'resultado'])
  })
  it('el 200 de un año se presenta al siguiente, y no después de hoy', () => {
    expect(validar200({ ...ok, presentado: '2025-12-31' }, '2026-10-21').errores.presentado).toBe('El de 2025 se presenta en 2026.')
    expect(validar200({ ...ok, presentado: '2026-10-22' }, '2026-10-21').errores.presentado).toBe('No puede ser de después de hoy.')
  })
  it('a ingresar o a devolver lleva su importe', () => {
    expect(validar200({ ...ok, importe: '0' }, '2026-10-21').errores.importe).toBe('El importe, sin signo.')
  })
})
