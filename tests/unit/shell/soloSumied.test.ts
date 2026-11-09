// G05 (08/11/2026). El Shell en modo Sumied para una fila de despacho: la
// gestoría que entra en un cliente de Folvy ve solo Sumied.
import { describe, it, expect } from 'vitest'
import { soloSumiedEnElShell } from '../../../src/shell/soloSumied'

describe('G05 · el Shell, solo Sumied', () => {
  it('una fila de despacho en un cliente de Folvy (sin product_brand): solo Sumied', () => {
    expect(soloSumiedEnElShell({ marcaSolo: false, productBrand: null, enClienteDelDespacho: true })).toBe(true)
  })
  it('la misma cuenta de Folvy, para su equipo: Folvy entero, como siempre', () => {
    expect(soloSumiedEnElShell({ marcaSolo: false, productBrand: null, enClienteDelDespacho: false })).toBe(false)
  })
  it('una cuenta solo de contabilidad o una marca sola: solo Sumied, como antes', () => {
    expect(soloSumiedEnElShell({ marcaSolo: false, productBrand: 'sumied', enClienteDelDespacho: false })).toBe(true)
    expect(soloSumiedEnElShell({ marcaSolo: true, productBrand: null, enClienteDelDespacho: false })).toBe(true)
  })
})
