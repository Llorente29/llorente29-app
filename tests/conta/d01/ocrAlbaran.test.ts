// D01 · R1 (Julio): «lo que devuelve hoy a Cocina no cambia: lo fija una
// prueba con los mismos ejemplos de antes y después».
//
// ANTES: tests/conta/d01/fixtures/ocr-albaran-antes.json se sacó el 13/10 del
// index.ts de ocr-albaran de main (9f9f5791), copiando sus funciones tal cual
// y pasándoles los ejemplos de fixtures/ocr-albaran-ejemplos.json.
// DESPUÉS: el mismo código, ya en _shared/ocrAlbaranNucleo.ts, con los mismos
// ejemplos. Tienen que dar exactamente lo mismo.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildPrompt, extractJson, validate, type ParsedDoc } from '../../../supabase/functions/_shared/ocrAlbaranNucleo'

const md5 = (s: string) => createHash('md5').update(s).digest('hex')
const antes = JSON.parse(readFileSync('tests/conta/d01/fixtures/ocr-albaran-antes.json', 'utf8'))
const ejemplos = JSON.parse(readFileSync('tests/conta/d01/fixtures/ocr-albaran-ejemplos.json', 'utf8')) as ParsedDoc[]

describe('ocr-albaran sin modo: lo mismo que antes del D01', () => {
  it('el prompt de Cocina es byte a byte el de antes (y el de MEDIR, también)', () => {
    expect(md5(buildPrompt())).toBe(antes.prompt)
    expect(md5(buildPrompt(false))).toBe(antes.promptAntes)
  })
  it('la validación da lo mismo con los mismos ejemplos', () => {
    expect(ejemplos.map((e) => validate(e))).toEqual(antes.validate)
  })
  it('la extracción del JSON, igual', () => {
    expect(['```json {"a":1}```', 'no', '{"document":{}}'].map((t) => extractJson(t))).toEqual(antes.extract)
  })
})
