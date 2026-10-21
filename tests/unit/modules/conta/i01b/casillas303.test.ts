// tests/unit/modules/conta/i01b/casillas303.test.ts
//
// I01b · Las etiquetas de las casillas del 303 salen del diseño de registro de
// la AEAT (docs/conta/referencia/dr303e26v101.json), no de la cabeza de nadie
// (regla 31): el fichero generado es el que sale hoy del guion.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CASILLAS_303 } from '@/modules/conta/impuestos/casillas303'

describe('las casillas del 303', () => {
  it('casillas303.ts es exactamente lo que genera el guion desde el diseño de registro', () => {
    const otraVez = execFileSync('node', ['scripts/conta/impuestos/casillas303.mjs', '--salida'], { encoding: 'utf8' })
    expect(readFileSync('src/modules/conta/impuestos/casillas303.ts', 'utf8')).toBe(otraVez)
  })
  it('están las que calcula Sumied, y las fórmulas no se parten', () => {
    for (const k of ['01', '03', '04', '06', '07', '09', '27', '28', '29', '45', '46', '64', '65', '66', '69', '71', '78', '87', '110']) {
      expect(CASILLAS_303[k], k).toBeDefined()
    }
    expect(CASILLAS_303['71'].texto).toBe('Resultado ( [69] - [70] + [109] - [112] )')
    expect(CASILLAS_303['01']).toEqual({ grupo: 'Liquidación', texto: 'IVA Devengado · Régimen general · Base imponible' })
  })
})
