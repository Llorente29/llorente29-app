// tests/conta/e02/porqueDeLlegada.test.ts
//
// E02 · La ventana de una llegada sin leer de antes del E02 (sin clase) no dice
// «albarán» ni «Edge Function returned a non-2xx status code». Los porqués son
// los que guardaba la entrada por correo («No se ha podido leer: <error>») y el
// de «Leerla» («no se ha podido leer (<mensaje>)»).

import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase', () => ({ supabase: null }))
import { porqueSinTecnicismos } from '@/modules/conta/services/documentosService'
import { FRASE_DOCUMENTO } from '../../../supabase/functions/_shared/lecturaFallo'

describe('porqueSinTecnicismos', () => {
  it('los textos técnicos de la lectura pasan a la frase de «este documento»', () => {
    for (const p of [
      'No se ha podido leer: La IA no devolvió un albarán legible',
      'No se ha podido leer: Error del servicio de IA',
      'No se ha podido leer: Fallo llamando a la IA',
      'no se ha podido leer (Edge Function returned a non-2xx status code)',
    ]) expect(porqueSinTecnicismos(p)).toBe(FRASE_DOCUMENTO)
  })
  it('los demás porqués se quedan como están', () => {
    expect(porqueSinTecnicismos('Llegó sin PDF: el correo traía un enlace.')).toBe('Llegó sin PDF: el correo traía un enlace.')
    expect(porqueSinTecnicismos(null)).toBeNull()
  })
})
