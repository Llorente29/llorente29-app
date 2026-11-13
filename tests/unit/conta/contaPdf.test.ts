// tests/unit/conta/contaPdf.test.ts · B01r26 · lo que contesta conta-pdf sin el PDF.
import { describe, expect, it } from 'vitest'
import { decidir, LLAVE } from '../../../supabase/functions/_shared/contaPdf.ts'

const buena = '0123456789abcdef0123456789abcdef'

describe('conta-pdf · decidir', () => {
  it('solo GET y HEAD', async () => {
    expect(decidir({ metodo: 'POST', llave: buena })!.status).toBe(405)
    expect(decidir({ metodo: 'GET', llave: buena })).toBeNull()
    expect(decidir({ metodo: 'HEAD', llave: buena })).toBeNull()
  })
  it('una llave mal formada da 404 sin llegar a la base', () => {
    for (const l of ['', 'abc', buena.toUpperCase(), `${buena}0`, `../${buena}`, buena.replace('a', 'g')]) {
      expect(LLAVE.test(l)).toBe(false)
      expect(decidir({ metodo: 'GET', llave: l })!.status).toBe(404)
    }
  })
  it('retirada, anulado y no_existe contestan lo mismo (no se dice cuál)', async () => {
    const r = await Promise.all(['retirada', 'anulado', 'no_existe'].map(async (x) => {
      const res = decidir({ metodo: 'GET', llave: buena, resultado: x })!
      return `${res.status} ${await res.text()}`
    }))
    expect(new Set(r).size).toBe(1)
    expect(r[0]).toBe('404 No existe.')
  })
  it('el tope da 429 con Retry-After; servido deja pasar; un fallo propio, 500', () => {
    const t = decidir({ metodo: 'GET', llave: buena, resultado: 'tope' })!
    expect(t.status).toBe(429)
    expect(t.headers.get('Retry-After')).toBe('3600')
    expect(decidir({ metodo: 'GET', llave: buena, resultado: 'servido' })).toBeNull()
    expect(decidir({ metodo: 'GET', llave: buena, fallo: true })!.status).toBe(500)
  })
  it('nada de lo que contesta se indexa ni se guarda en caché', () => {
    for (const x of ['tope', 'no_existe']) {
      const r = decidir({ metodo: 'GET', llave: buena, resultado: x })!
      expect(r.headers.get('X-Robots-Tag')).toContain('noindex')
      expect(r.headers.get('Cache-Control')).toBe('no-store')
    }
  })
})
