// tests/unit/modules/conta/portal/firma.test.ts
//
// GP · nº 19.1 · La prueba de una firma del portal, como la ve la gestoría.
// Datos inventados (T11): IP de documentación (192.0.2.x), correos .invalid.

import { describe, expect, it } from 'vitest'
import { navegadorEnPalabras, pruebaDeFirma } from '@/modules/conta/gestoria/portal/firma'

const base = { peticion_id: 'q1', destino: 't•••@ejemplo.invalid', pdf_ruta: 'c/p/firmas/f1.pdf', pdf_sha256: null }

describe('la prueba de una firma del portal', () => {
  it('quién, cuándo (hora de Madrid), desde dónde y a dónde fue el código', () => {
    expect(pruebaDeFirma({ ...base, firmada_at: '2026-11-09T09:14:00Z', ip: '192.0.2.1', quien: 'Tomás Ruiz',
      navegador: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' }))
      .toBe('Firmado por Tomás Ruiz el 9 de noviembre de 2026 a las 10:14 desde 192.0.2.1 (Chrome en Android). Código enviado a t•••@ejemplo.invalid.')
  })
  it('sin firmar, nada; sin IP ni navegador conocido, sin «desde»; sin nombre, «la persona del portal»', () => {
    expect(pruebaDeFirma({ ...base, firmada_at: null, ip: null, navegador: null, quien: 'Tomás Ruiz' })).toBeNull()
    expect(pruebaDeFirma({ ...base, firmada_at: '2026-11-09T09:14:00Z', ip: null, navegador: 'algo raro', quien: null }))
      .toBe('Firmado por la persona del portal el 9 de noviembre de 2026 a las 10:14. Código enviado a t•••@ejemplo.invalid.')
  })
  it('el navegador, en palabras; si no se reconoce, no se inventa', () => {
    expect(navegadorEnPalabras('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari en iPhone')
    expect(navegadorEnPalabras('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Edge en Windows')
    expect(navegadorEnPalabras('')).toBeNull()
    expect(navegadorEnPalabras('curl/8.0')).toBeNull()
  })
})
