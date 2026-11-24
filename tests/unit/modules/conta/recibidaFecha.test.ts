// tests/unit/modules/conta/recibidaFecha.test.ts
//
// S01p·18.2 · punto 2 (Julio, 13/11) · El asiento de una recibida, con la fecha
// de la factura; la frase que lo dice antes de validar (regla 8).
//
// Regla 31: los casos son los de producción (solo lectura, 13/11, sin nombres).
// Las 40 de Foodint con el asiento en otro mes tenían todas el día en que entró
// la factura; por ejemplo, la del 31/10 aprobada el 05/11 y apuntada el 05/11.
// Ninguna tenía el trimestre presentado: ahora van con su fecha.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fraseFechaDelAsiento } from '@/modules/conta/lib/fechaDelAsiento'

describe('la frase de la fecha del asiento', () => {
  it('la de la factura: «Se apunta con fecha 31/10/2026, la de la factura.»', () => {
    expect(fraseFechaDelAsiento('2026-10-31', '2026-10-31')).toBe('Se apunta con fecha 31/10/2026, la de la factura.')
    expect(fraseFechaDelAsiento('2026-10-11', '2026-10-11', null)).toBe('Se apunta con fecha 11/10/2026, la de la factura.')
  })
  it('otra: cuál y por qué (el aviso de la base, sin el punto final duplicado)', () => {
    const aviso = 'El IVA del 3T de 2026 ya está presentado: esta factura del 15/09/2026 se contabiliza el 01/10/2026, el primer día abierto.'
    expect(fraseFechaDelAsiento('2026-09-15', '2026-10-01', aviso))
      .toBe('Se apunta con fecha 01/10/2026, no la de la factura (15/09/2026): El IVA del 3T de 2026 ya está presentado: esta factura del 15/09/2026 se contabiliza el 01/10/2026, el primer día abierto.')
    expect(fraseFechaDelAsiento('2026-09-15', '2026-10-01')).toBe('Se apunta con fecha 01/10/2026, no la de la factura (15/09/2026).')
  })
  it('sin fecha de asiento, nada; sin fecha de factura, solo la del asiento', () => {
    expect(fraseFechaDelAsiento('2026-10-31', null)).toBeNull()
    expect(fraseFechaDelAsiento(null, '2026-10-31')).toBe('Se apunta con fecha 31/10/2026.')
  })
})

describe('la propuesta ya no mueve la fecha al día en que entró', () => {
  const codigo = readFileSync('src/modules/conta/services/propuestasLibroService.ts', 'utf8')
  it('ni fechaDeLaRecibida ni el día de entrada (created_at) deciden la fecha; la decide la base (conta_recibida_fecha)', () => {
    expect(codigo).not.toMatch(/fechaDeLaRecibida|diaDeEntrada/)
    expect(codigo).toMatch(/'conta_recibida_fecha'/)
  })
})
