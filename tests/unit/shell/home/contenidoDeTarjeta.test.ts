// GARANTÍA (d): ninguna tarjeta dice «0» o «sin nada» cuando hay filas que no
// ha podido mirar. Priorizar sí, ocultar jamás.

import { describe, it, expect } from 'vitest'
import { decideContenido, fraseDeLasQueSobran } from '@/shell/home/widgets/contenidoDeTarjeta'

const F = (n: number) => Array.from({ length: n }, (_, i) => ({ etiqueta: `f${i}`, valor: String(i) }))

describe('decideContenido · sin dato NO se pinta un cero', () => {
  // El fallo real del 01/09: la frase tranquilizadora al lado del error rojo.
  // «Cero agotados» y «no he podido mirar si hay agotados» se leen igual y
  // significan lo contrario.
  it('con error y SIN dato, no se enseña ni cifra ni filas', () => {
    const c = decideContenido('la red falló', false, F(3), 5)
    expect(c.sinComprobar).toBe(true)
    expect(c.visibles).toEqual([])
  })

  // Con dato viejo SÍ se enseña: ahí hay dato, solo que de antes, y el sello lo
  // dice. Esconderlo sería peor que enseñarlo con su hora.
  it('con error pero CON dato, se enseña lo último bueno', () => {
    const c = decideContenido('no se pudo refrescar', true, F(2), 5)
    expect(c.sinComprobar).toBe(false)
    expect(c.visibles).toHaveLength(2)
  })

  it('sin error y sin dato todavía (primera carga) no es «sin comprobar»', () => {
    expect(decideContenido(null, false, [], 5).sinComprobar).toBe(false)
  })
})

describe('decideContenido · un tope ordena, nunca esconde', () => {
  it('lo que no cabe se CUENTA, no se corta y calla', () => {
    const c = decideContenido(null, true, F(8), 5)
    expect(c.visibles).toHaveLength(5)
    expect(c.ocultas).toBe(3)
  })

  it('si caben todas, no se anuncia ningún resto', () => {
    expect(decideContenido(null, true, F(4), 5).ocultas).toBe(0)
  })

  // Un tope de cero escondería la lista entera, que es justo lo que la regla 7
  // prohíbe. Así que 0 significa «sin tope», no «ninguna».
  it('un tope de 0 es SIN TOPE, no «no enseñes nada»', () => {
    const c = decideContenido(null, true, F(9), 0)
    expect(c.visibles).toHaveLength(9)
    expect(c.ocultas).toBe(0)
  })

  it('sin filas no inventa ninguna', () => {
    expect(decideContenido(null, true, undefined, 5)).toEqual(
      { sinComprobar: false, visibles: [], ocultas: 0 })
  })
})

describe('fraseDeLasQueSobran', () => {
  it('lo dice en singular y en plural, y calla si no sobra ninguna', () => {
    expect(fraseDeLasQueSobran(0)).toBeNull()
    expect(fraseDeLasQueSobran(1)).toBe('y 1 más, que no cabe aquí')
    expect(fraseDeLasQueSobran(3)).toBe('y 3 más, que no caben aquí')
  })
})
