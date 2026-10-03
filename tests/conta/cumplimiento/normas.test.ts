// Cada referencia que citan las reglas del núcleo (src/modules/conta/lib/normas.ts)
// tiene que estar, literal, en la versión VIGENTE de su artículo del texto
// oficial descargado. Si la norma cambia, esto falla: se revisa y se dice.
import { describe, expect, it } from 'vitest'
import { NORMAS } from '@/modules/conta/lib/normas'
import { textoVigente } from './textoVigente'

describe('las normas citadas están en el texto vigente', () => {
  for (const [clave, n] of Object.entries(NORMAS)) {
    it(`${clave}: ${n.cita}`, () => {
      expect(textoVigente(n.fuente, n.bloque)).toContain(n.literal)
    })
  }
})
