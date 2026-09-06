import { describe, it, expect } from 'vitest'
import { objetivoValido, OBJETIVO_INVALIDO } from '@/modules/kitchen/services/kitchenSettingsService'

// B79 §3.11. La regla con la que se acepta un objetivo de comida, probada aparte
// porque la comparten la pantalla de Ajustes y el servicio que escribe en la base.
// Si un día dejan de compartirla, el campo aceptará algo que la base rechaza.

describe('objetivoValido · la regla del objetivo de comida', () => {
  it('vacío vale: «sin objetivo» es un estado legítimo, no un error', () => {
    expect(objetivoValido(null)).toBe(true)
  })

  // El cero NO es «sin objetivo». Es «que la comida no cueste nada», y pondría en
  // rojo la carta entera sin que nadie lo haya pedido.
  it('cero no vale, y no es lo mismo que vacío', () => {
    expect(objetivoValido(0)).toBe(false)
    expect(objetivoValido(null)).toBe(true)
  })

  it('un negativo no vale', () => {
    expect(objetivoValido(-5)).toBe(false)
  })

  it('más de 100 no vale: no se puede gastar en comida más de lo que se vende', () => {
    expect(objetivoValido(100.01)).toBe(false)
    expect(objetivoValido(250)).toBe(false)
  })

  it('100 sí vale: es el límite, no está fuera', () => {
    expect(objetivoValido(100)).toBe(true)
  })

  // Los objetivos que YA existen en producción tienen que pasar: si la regla los
  // rechazara, la pantalla no dejaría volver a guardar lo que ya está guardado.
  it('los objetivos reales de Foodint pasan (25, 30 y 50)', () => {
    for (const v of [25, 30, 50]) expect(objetivoValido(v)).toBe(true)
  })

  it('un decimal razonable pasa', () => {
    expect(objetivoValido(28.5)).toBe(true)
  })

  it('lo que no es número no vale', () => {
    expect(objetivoValido(Number.NaN)).toBe(false)
    expect(objetivoValido(Number.POSITIVE_INFINITY)).toBe(false)
  })

  // El motivo se enseña tal cual, así que dice qué hacer, no sólo que está mal.
  it('el motivo explica también cómo dejarlo sin objetivo', () => {
    expect(OBJETIVO_INVALIDO).toContain('vacío')
  })
})
