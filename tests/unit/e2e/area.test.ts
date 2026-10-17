// tests/unit/e2e/area.test.ts — qué corre la e2e de un push (W02, 17/10).
// Contra las ramas que existen de verdad (git branch -r, 17/10) y las carpetas
// que hay hoy en tests/e2e/conta: ninguna puede dar la suite entera.

import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { pruebasDelPush, COMUN, carpetasConta } from '../../../scripts/e2e/area.mjs'

// Ramas reales que disparan la e2e por push (conta/** y reparto-**), una por familia.
const RAMAS = {
  'reparto-r03-direccion': ['tests/e2e/reparto'],
  'reparto-r02-marca-plataforma': ['tests/e2e/reparto'],
  'conta/b02-cuadre': ['tests/e2e/conta/b01', ...COMUN],
  'conta/d01-facturas-recibidas': ['tests/e2e/conta/d01', ...COMUN],
  'conta/c06b-respuesta-6': ['tests/e2e/conta/c06', ...COMUN],
  'conta/m01-marco': ['tests/e2e/conta/m01', ...COMUN],
  'conta/c02c-traer': ['tests/e2e/conta/c02c', ...COMUN],
  'conta/c04-fusionar': ['tests/e2e/conta/c04', ...COMUN],
  'conta/c03-terceros': ['tests/e2e/conta/c03', ...COMUN],
  'conta/cierre-mes': ['tests/e2e/conta/cierre', ...COMUN],
  'conta/w02-staging-al-dia': COMUN,
}

describe('la e2e de un push corre solo su área', () => {
  it('cada familia de rama, a su carpeta', () => {
    for (const [rama, esperado] of Object.entries(RAMAS)) expect(pruebasDelPush(rama), rama).toEqual(esperado)
  })

  it('nunca vacío (vacío sería la suite entera), y todo lo que nombra existe', () => {
    for (const rama of [...Object.keys(RAMAS), 'conta/x', 'conta/', 'otra', '']) {
      const p = pruebasDelPush(rama)
      expect(p.length, rama).toBeGreaterThan(0)
      for (const f of p) expect(existsSync(f), f).toBe(true)
    }
  })

  it('conta/c00: su carpeta ya lleva el marco, no se repite', () => {
    expect(pruebasDelPush('conta/c00-alta')).toEqual(['tests/e2e/conta/c00', 'tests/e2e/conta/rls.spec.ts'])
  })

  it('la carpeta más larga que casa: c02c antes que c02', () => {
    expect(carpetasConta()).toEqual(expect.arrayContaining(['c02', 'c02c']))
    expect(pruebasDelPush('conta/c02c-x')[0]).toBe('tests/e2e/conta/c02c')
    expect(pruebasDelPush('conta/c02-x')[0]).toBe('tests/e2e/conta/c02')
  })
})
