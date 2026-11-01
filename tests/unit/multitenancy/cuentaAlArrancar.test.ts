// tests/unit/multitenancy/cuentaAlArrancar.test.ts
//
// DM1 · PR 1c (31/10/2026). La empresa con la que arranca la aplicación: la de
// la base, o la que pide la URL o el navegador, abierta antes en la base.

import { describe, it, expect } from 'vitest'
import { cuentaAlArrancar } from '@/modules/multitenancy/lib/cuentaAlArrancar'

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
const AJENA = '00000000-0000-0000-0000-0000000000ff'

describe('cuentaAlArrancar', () => {
  it('con un navegador limpio, la que dice la base, sin cambiar nada', () => {
    expect(cuentaAlArrancar({ mias: [B, A], deLaBase: A, deLaUrl: null, delNavegador: null }))
      .toEqual({ abrir: null, activa: A, siFalla: A })
  })
  it('no elige la primera por nombre si la base tiene abierta otra', () => {
    expect(cuentaAlArrancar({ mias: [B, A], deLaBase: A, deLaUrl: null, delNavegador: null }).activa).toBe(A)
  })
  it('si el navegador recuerda otra suya, la abre en la base antes de pintar', () => {
    expect(cuentaAlArrancar({ mias: [A, B], deLaBase: A, deLaUrl: null, delNavegador: B }))
      .toEqual({ abrir: B, activa: B, siFalla: A })
  })
  it('la URL manda sobre el navegador', () => {
    expect(cuentaAlArrancar({ mias: [A, B], deLaBase: A, deLaUrl: B, delNavegador: A }))
      .toEqual({ abrir: B, activa: B, siFalla: A })
  })
  it('si el navegador recuerda la misma que la base, no cambia nada', () => {
    expect(cuentaAlArrancar({ mias: [A, B], deLaBase: B, deLaUrl: null, delNavegador: B }))
      .toEqual({ abrir: null, activa: B, siFalla: B })
  })
  it('una cuenta que no es suya en la URL o el navegador no cuenta', () => {
    expect(cuentaAlArrancar({ mias: [A, B], deLaBase: A, deLaUrl: AJENA, delNavegador: AJENA }))
      .toEqual({ abrir: null, activa: A, siFalla: A })
  })
  it('con una sola cuenta, esa, como siempre', () => {
    expect(cuentaAlArrancar({ mias: [A], deLaBase: A, deLaUrl: null, delNavegador: null }))
      .toEqual({ abrir: null, activa: A, siFalla: A })
  })
  it('si la base no dice ninguna suya, abre la primera para que las dos digan lo mismo', () => {
    expect(cuentaAlArrancar({ mias: [A, B], deLaBase: null, deLaUrl: null, delNavegador: null }))
      .toEqual({ abrir: A, activa: A, siFalla: null })
  })
  it('sin cuentas, ninguna', () => {
    expect(cuentaAlArrancar({ mias: [], deLaBase: null, deLaUrl: null, delNavegador: null }))
      .toEqual({ abrir: null, activa: null, siFalla: null })
  })
})
