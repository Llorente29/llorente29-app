// S02 · Los diseños de registro de la AEAT guardados en el repositorio son los
// que dice su huella: si alguien los cambia, esta prueba falla.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const DIR = 'docs/conta/fuentes/aeat'
const huellas = JSON.parse(readFileSync(`${DIR}/huellas.json`, 'utf8')).ficheros as Record<string, { sha256: string; bytes: number }>

describe('diseños de registro de la AEAT', () => {
  for (const [f, h] of Object.entries(huellas)) {
    it(`${f}: su sha256 y su tamaño`, () => {
      const b = readFileSync(`${DIR}/${f}`)
      expect(b.length).toBe(h.bytes)
      expect(createHash('sha256').update(b).digest('hex')).toBe(h.sha256)
    })
  }
})
