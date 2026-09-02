import { describe, it, expect } from 'vitest'
import { selloDe, hora } from '@/shell/home/sello'

const A_LAS_818 = new Date(2026, 8, 2, 8, 18, 0)

describe('selloDe', () => {
  it('dice la hora de lectura', () => {
    const s = selloDe(A_LAS_818, new Date(2026, 8, 2, 8, 20))
    expect(s.texto).toBe(`datos de las ${hora(A_LAS_818)}`)
    expect(s.caducado).toBe(false)
  })

  // La razón de existir de la garantía (a): una pantalla abierta desde hace
  // horas enseña el número viejo con toda naturalidad.
  it('pasado el umbral deja de presentarlo como actual, pero NO lo esconde', () => {
    const s = selloDe(A_LAS_818, new Date(2026, 8, 2, 8, 40))
    expect(s.caducado).toBe(true)
    expect(s.texto).toContain('pueden haber cambiado')
    expect(s.texto).toContain('08:18')
  })

  it('justo en el umbral todavía no ha caducado', () => {
    expect(selloDe(A_LAS_818, new Date(2026, 8, 2, 8, 28), 10).caducado).toBe(false)
    expect(selloDe(A_LAS_818, new Date(2026, 8, 2, 8, 29), 10).caducado).toBe(true)
  })

  // Un periodo cerrado no «puede haber cambiado»: avisarlo sería ruido, y el
  // ruido es lo que hace que después nadie lea el aviso que sí importa.
  it('umbral 0 desactiva la caducidad, para datos de periodo cerrado', () => {
    const s = selloDe(A_LAS_818, new Date(2026, 8, 3, 20, 0), 0)
    expect(s.caducado).toBe(false)
    expect(s.texto).not.toContain('pueden haber cambiado')
  })

  it('sin lectura no se inventa una hora', () => {
    const s = selloDe(null)
    expect(s.leidoA).toBeNull()
    expect(s.texto).toBe('sin leer todavía')
  })
})
