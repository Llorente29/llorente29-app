// La garantía (b), fijada. Lo que se prueba no es el formato: es que esta
// función se NIEGUE a producir un delta cuando no puede afirmarlo, que es la
// mitad que se perdió en junio y acabó diciendo «−100 % vs ayer».

import { describe, it, expect } from 'vitest'
import {
  inicioDeSemana, espejoDeDia, espejoDeSemana, calculaDelta, nombreDeDia,
} from '@/shell/home/espejo'

// `toLocaleString` en es-ES separa la cifra del € con un espacio DURO (U+00A0 o
// U+202F). Es lo correcto tipográficamente y no se toca; lo que se normaliza es
// la comparación, para que el test no dependa de qué espacio duro use el ICU de
// turno. Sin esto el fallo es de los peores de leer: dos cadenas idénticas en
// pantalla que no son iguales.
const sinEspacioDuro = (t: string) => t.replace(/[\u00a0\u202f]/g, ' ')

// Sábado 29 de agosto de 2026, a media tarde para que se note si algo arrastra
// la hora en vez de trabajar a medianoche.
const SABADO = new Date(2026, 7, 29, 17, 42)
const DOMINGO = new Date(2026, 7, 30, 9, 0)

describe('inicioDeSemana', () => {
  it('el lunes es su propio inicio', () => {
    expect(inicioDeSemana(new Date(2026, 7, 31, 11, 0)).getDate()).toBe(31)
  })
  it('el domingo pertenece a la semana que empezó el lunes ANTERIOR', () => {
    // El fallo clásico: getDay() del domingo es 0 y sin corregir devuelve el
    // propio domingo como inicio de semana.
    const l = inicioDeSemana(DOMINGO)
    expect(l.getDate()).toBe(24)
    expect(l.getMonth()).toBe(7)
  })
  it('deja la hora a medianoche', () => {
    const l = inicioDeSemana(SABADO)
    expect([l.getHours(), l.getMinutes(), l.getSeconds()]).toEqual([0, 0, 0])
  })
})

describe('espejoDeDia', () => {
  it('es el MISMO día de la semana anterior, no el día anterior', () => {
    const e = espejoDeDia(SABADO)
    expect(e.desde.getDate()).toBe(22)
    expect(nombreDeDia(e.desde)).toBe('sábado')
    expect(e.etiqueta).toBe('sábado anterior')
  })
  it('el rango cubre un día exacto', () => {
    const e = espejoDeDia(SABADO)
    expect(e.hasta.getTime() - e.desde.getTime()).toBe(24 * 3600 * 1000)
  })
  it('nunca dice «ayer»', () => {
    expect(espejoDeDia(SABADO).etiqueta).not.toContain('ayer')
  })
})

describe('espejoDeSemana', () => {
  it('es la semana anterior completa, de lunes a lunes', () => {
    const e = espejoDeSemana(new Date(2026, 7, 31, 10, 0))
    expect(e.desde.getDate()).toBe(24)
    expect(e.hasta.getDate()).toBe(31)
    expect(e.etiqueta).toBe('semana anterior')
  })
})

describe('calculaDelta · cuándo SÍ', () => {
  const e = espejoDeDia(SABADO)

  it('sube: signo +, tono positivo, un decimal', () => {
    const d = calculaDelta(2709, 2663, e)
    expect(d?.pct).toBe(1.7)
    expect(d?.tono).toBe('positive')
    expect(d?.texto).toBe('+1,7 % vs sábado anterior')
  })

  it('baja: signo menos tipográfico y tono de atención, no de error', () => {
    const d = calculaDelta(9930, 12577, espejoDeSemana(SABADO), { conCifraDelEspejo: true })
    expect(d?.pct).toBe(-21)
    expect(d?.tono).toBe('attention')
    expect(sinEspacioDuro(d!.texto)).toBe('−21,0 % vs semana anterior (12.577 €)')
    // Y que el espacio duro está donde toca, dicho a propósito.
    expect(d!.texto).toMatch(/12\.577[\u00a0\u202f]€/)
  })

  it('igual: sin signo y neutro', () => {
    expect(calculaDelta(100, 100, e)?.texto).toBe('0,0 % vs sábado anterior')
  })
})

describe('calculaDelta · cuándo NO, que es lo que importa', () => {
  const e = espejoDeDia(SABADO)

  it('sin espejo no hay tendencia: nunca un «+100 %» salido de cero', () => {
    expect(calculaDelta(1200, 0, e)).toBeNull()
    expect(calculaDelta(1200, null, e)).toBeNull()
    expect(calculaDelta(1200, undefined, e)).toBeNull()
  })

  it('un periodo EN CURSO no se compara con uno cerrado', () => {
    // Es el caso literal del «−100 % vs ayer» de las once de la mañana.
    expect(calculaDelta(0, 2663, e, { periodoEnCurso: true })).toBeNull()
    expect(calculaDelta(5000, 2663, e, { periodoEnCurso: true })).toBeNull()
  })

  it('sin valor actual no se inventa un −100 %', () => {
    expect(calculaDelta(null, 2663, e)).toBeNull()
  })

  it('un espejo negativo tampoco vale como base', () => {
    expect(calculaDelta(100, -50, e)).toBeNull()
  })
})
