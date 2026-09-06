// B78 §3.bis. La cabecera, en castellano.
//
// Enseñaba `{"locales":["38158159-cd71-4056-950b-53425afac1ce"]}` y
// `account_id = la cuenta · is_active · status <> cancelled` delante de un
// cliente. La banda se queda —protege de medir una cosa creyendo que se mide
// otra— pero se dice con palabras.

import { describe, it, expect } from 'vitest'
import { intervaloEnCastellano } from '../../../../src/modules/ventas/services/textoInforme'

describe('intervaloEnCastellano', () => {
  // EL LIMITE ES EXCLUSIVO: la semana acaba el lunes 00:00, y el ultimo dia
  // que se midio es el domingo. Decir «al 31» seria decir un dia que no entra.
  it('la semana completa se dice «Del 24 al 30 de agosto», no al 31', () => {
    expect(intervaloEnCastellano('2026-08-24 00:00', '2026-08-31 00:00'))
      .toBe('Del 24 al 30 de agosto')
  })

  it('un dia entero se dice «El 5 de septiembre»', () => {
    expect(intervaloEnCastellano('2026-09-05 00:00', '2026-09-06 00:00'))
      .toBe('El 5 de septiembre')
  })

  // Un periodo EN CURSO acaba a una hora cualquiera, y esa hora importa: es la
  // diferencia entre comparar un trozo con un trozo o con una semana entera.
  it('un periodo en curso dice hasta que hora se ha medido', () => {
    expect(intervaloEnCastellano('2026-08-31 00:00', '2026-09-06 00:21'))
      .toBe('Del 31 de agosto al 6 de septiembre, hasta las 00:21')
  })

  it('dentro del mismo mes no lo repite dos veces', () => {
    expect(intervaloEnCastellano('2026-09-01 00:00', '2026-09-06 00:00'))
      .toBe('Del 1 al 5 de septiembre')
  })

  it('cruzando fin de mes nombra los dos', () => {
    expect(intervaloEnCastellano('2026-08-30 00:00', '2026-09-02 00:00'))
      .toBe('Del 30 de agosto al 1 de septiembre')
  })

  it('cruzando fin de año no se descuadra', () => {
    expect(intervaloEnCastellano('2026-12-28 00:00', '2027-01-04 00:00'))
      .toBe('Del 28 de diciembre al 3 de enero')
  })

  it('un mes entero: agosto de punta a punta', () => {
    expect(intervaloEnCastellano('2026-08-01 00:00', '2026-09-01 00:00'))
      .toBe('Del 1 al 31 de agosto')
  })

  // La prueba que da nombre al §3.bis.
  it('NUNCA saca un identificador, un nombre de columna ni SQL', () => {
    const salidas = [
      intervaloEnCastellano('2026-08-24 00:00', '2026-08-31 00:00'),
      intervaloEnCastellano('2026-08-31 00:00', '2026-09-06 00:21'),
      intervaloEnCastellano('2026-09-05 00:00', '2026-09-06 00:00'),
    ].join(' ')
    for (const prohibido of ['account_id', 'is_active', 'status', 'sale.total', 'locales', '{', '}']) {
      expect(salidas).not.toContain(prohibido)
    }
    expect(salidas).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/)
  })
})
