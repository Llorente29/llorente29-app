// tests/unit/modules/conta/v03/codigos.test.ts
//
// V03 · E1 · Cada código de la AEAT que nombra el motor existe en la LISTA
// OFICIAL de errores (docs/conta/v03/aeat/errores.properties, bajada de la AEAT
// por la sonda de staging el 25/10). Los primeros se pusieron de memoria y cinco
// estaban mal: esta prueba es la que lo habría cazado.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const raiz = resolve(__dirname, '../../../../..')
const leer = (f: string) => readFileSync(resolve(raiz, f), 'utf8')

const oficiales = new Map(
  [...leer('docs/conta/v03/aeat/errores.properties').matchAll(/^\s*(\d{4})\s*=\s*(.*)$/gm)].map((m) => [m[1], m[2]]),
)

const delMotor = [
  ...leer('supabase/migrations/20261025T2140_v03_verifactu_motor.sql').matchAll(/'codigo_aeat',\s*(\d+)/g),
].map((m) => m[1])

describe('V03 · los códigos de la AEAT del motor', () => {
  it('la lista oficial está entera (247 códigos)', () => {
    expect(oficiales.size).toBe(247)
  })

  it('el motor nombra códigos (si no, la prueba no mide nada)', () => {
    expect(delMotor.length).toBeGreaterThanOrEqual(8)
  })

  it('cada código del motor está en la lista oficial', () => {
    const noEstan = [...new Set(delMotor)].filter((c) => !oficiales.has(c))
    expect(noEstan).toEqual([])
  })

  // Existir no basta: los de memoria existían, pero decían otra cosa (el 1237
  // es «N1/N2 con tipo impositivo», no «falta la calificación»). Cada código
  // del motor, atado a una palabra de SU texto oficial.
  const significa: Record<string, RegExp> = {
    '1100': /Valor o tipo incorrecto/,
    '1112': /FechaExpedicionFactura es superior a la fecha actual/,
    '1124': /TipoImpositivo/,
    '1189': /Destinatarios tiene que estar cumplimentado/,
    '1195': /OperacionExenta o CalificacionOperacion/,
    '1222': /IDOtro es incorrecto/,
    '4109': /formato del NIF es incorrecto/,
  }

  it('cada código del motor dice lo que el motor cree que dice', () => {
    for (const c of new Set(delMotor)) {
      expect(significa[c], `el código ${c} no tiene su significado atado aquí`).toBeDefined()
      expect(oficiales.get(c)).toMatch(significa[c])
    }
  })

  it('y un código con otro significado no pasa (la prueba puede fallar)', () => {
    expect(oficiales.get('1237')).not.toMatch(significa['1195'])
  })
})
