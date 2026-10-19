// tests/unit/e2e/area.test.ts — qué corre la e2e de un push (W02, 17/10).
// Contra las ramas que existen de verdad (git branch -r, 17/10) y las carpetas
// que hay hoy en tests/e2e/conta: ninguna puede dar la suite entera.

import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { pruebasDelPush, pruebasDeLaZona, COMUN, CORTA, carpetasConta } from '../../../scripts/e2e/area.mjs'

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
    for (const [rama, esperado] of Object.entries(RAMAS)) expect(pruebasDeLaZona(rama), rama).toEqual(esperado)
  })

  // Julio, 19/10: en cada PR, la zona Y la corta de pedidos, cocina y reparto.
  it('cada push lleva además la corta de pedidos, cocina y reparto, sin repetir', () => {
    for (const [rama, esperado] of Object.entries(RAMAS)) {
      const p = pruebasDelPush(rama)
      expect(p.slice(0, esperado.length), rama).toEqual(esperado)
      for (const f of CORTA) expect(p.some((x) => x === f || f.startsWith(`${x}/`)), `${rama}: ${f}`).toBe(true)
      expect(new Set(p).size, rama).toBe(p.length)
    }
    // reparto-** ya corre su carpeta entera: la corta no se repite.
    expect(pruebasDelPush('reparto-r04-x')).toEqual(['tests/e2e/reparto'])
  })

  it('la corta existe y está medida en tiempos.json (91 s en los dos tamaños)', async () => {
    const t = (await import('../../e2e/tiempos.json')).default as Record<string, number>
    let s = 0
    for (const f of CORTA) {
      expect(existsSync(f), f).toBe(true)
      const k = f.replace('tests/e2e/', '')
      expect(t[k], k).toBeGreaterThan(0)
      s += t[k]
    }
    expect(Math.round(s)).toBe(91)
  })

  it('nunca vacío (vacío sería la suite entera), y todo lo que nombra existe', () => {
    for (const rama of [...Object.keys(RAMAS), 'conta/x', 'conta/', 'otra', '']) {
      const p = pruebasDelPush(rama)
      expect(p.length, rama).toBeGreaterThan(0)
      for (const f of p) expect(existsSync(f), f).toBe(true)
    }
  })

  it('conta/c00: su carpeta ya lleva el marco, no se repite', () => {
    expect(pruebasDeLaZona('conta/c00-alta')).toEqual(['tests/e2e/conta/c00', 'tests/e2e/conta/rls.spec.ts'])
  })

  it('la carpeta más larga que casa: c02c antes que c02', () => {
    expect(carpetasConta()).toEqual(expect.arrayContaining(['c02', 'c02c']))
    expect(pruebasDelPush('conta/c02c-x')[0]).toBe('tests/e2e/conta/c02c')
    expect(pruebasDelPush('conta/c02-x')[0]).toBe('tests/e2e/conta/c02')
  })
})
