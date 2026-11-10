// GD · nº96, fase 2 · La muestra de voz: las mismas 6 frases aprobadas (2 del cobro, 2 de la contabilidad y 2 del
// banco) con las dos voces, sin tocar la voz del vídeo (voz-elevenlabs.txt) y sin producción.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { FRASES, GESTOS, MUESTRA } from '../../../../../scripts/video/gd/locucion.mjs'

describe('GD · la muestra de voz', () => {
  it('la locución: cada frase con su gesto, sin fechas ni ferias', () => {
    expect(Object.keys(FRASES)).toEqual(Object.keys(GESTOS))
    for (const t of Object.values(FRASES)) expect(t).not.toMatch(/IFEMA|diciembre|noviembre|\d{1,2}\/\d{1,2}|llega el/i)
    expect(FRASES['01.1']).toContain('las cuotas, de tu tarifa; GoCardless solo pasa el cargo')
    expect(FRASES['07.2']).toBe('La factura sale a nombre de tu gestoría, con la numeración de tu serie.')
  })

  it('las 6 frases: 2 del cobro, 2 de la contabilidad y 2 del banco', () => {
    expect(MUESTRA).toEqual(['06.3', '06.10', '08.3', '08.5', '09.2', '09.4'])
  })

  it('las dos voces en la muestra; la del vídeo, Julio Clon (nº99)', () => {
    const py = readFileSync('scripts/video/gd/muestras_voz.py', 'utf8')
    expect(py).toContain('"julio": "TbcXaMnSerONT83CTICz"')
    expect(py).toContain('"abel": "bsEDAkNZWaEolZ7vEeVJ"')
    expect(py).not.toMatch(/open\([^)]*voz-elevenlabs\.txt[^)]*["']w/)
    expect(readFileSync('scripts/video/voz-elevenlabs.txt', 'utf8')).toMatch(/^TbcXaMnSerONT83CTICz$/m)
  })

  it('el job de la muestra no usa producción', () => {
    const w = readFileSync('.github/workflows/gd-video-qbo.yml', 'utf8')
    const job = w.slice(w.indexOf('  muestras-voz:'), w.indexOf('  grabar:'))
    expect(job).toContain("if: inputs.modo == 'muestras-voz'")
    expect(job).not.toMatch(/SUPABASE|SERVICE|environment:/)
    expect(job).toContain('secrets.VOZ_ELEVENLABS_KEY')
  })
})
