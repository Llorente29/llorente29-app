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

// Julio, 21/10: la entera solo si el PR toca lo común o lleva la etiqueta.
// Contra los 40 últimos PR fusionados en main (fixtures/prs-reales.json).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { queCorre, deLoComun, LO_COMUN, ETIQUETA_ENTERA, ZONAS_POR_FICHERO, zonasTocadas } from '../../../scripts/e2e/area.mjs'

const PRS = JSON.parse(readFileSync(join(__dirname, 'fixtures/prs-reales.json'), 'utf8')).prs as { commit: string; titulo: string; ficheros: string[]; comun: boolean }[]

describe('la entera, solo si el PR toca lo común (los 40 últimos PR de main)', () => {
  it('cada PR, como se revisó a mano', () => {
    for (const p of PRS) expect(deLoComun(p.ficheros).length > 0, `${p.commit} ${p.titulo}`).toBe(p.comun)
  })
  it('de los dos lados: 13 de 40 con lo común', () => {
    expect(PRS).toHaveLength(40)
    expect(PRS.filter((p) => p.comun)).toHaveLength(13)
  })
  it('la cabecera de pestañas (#258) y el ancho (#263), la entera; el recuadro del plazo (#265), la zona y la corta', () => {
    const de = (t: string) => PRS.find((p) => p.titulo.includes(t))!
    expect(queCorre('conta/s01f-pestanas', { cambiados: de('(#258)').ficheros })).toMatchObject({ entera: true })
    expect(queCorre('conta/s01g-ancho', { cambiados: de('(#263)').ficheros }).porque).toMatch(/^toca lo común: src\/modules\/conta\/diseno\//)
    const plazo = queCorre('conta/i01b-plazo', { cambiados: de('(#265)').ficheros })
    expect(plazo.entera).toBe(false)
    expect(plazo.pruebas).toEqual(pruebasDelPush('conta/i01b-plazo'))
    expect(plazo.pruebas).toEqual(expect.arrayContaining(CORTA))
  })
  it('la etiqueta pide la entera aunque no toque lo común', () => {
    expect(queCorre('conta/i01b-plazo', { cambiados: ['src/modules/conta/impuestos/calendario.ts'], etiquetas: [ETIQUETA_ENTERA] })).toMatchObject({ entera: true, pruebas: [] })
    expect(queCorre('conta/i01b-plazo', { cambiados: ['src/modules/conta/impuestos/calendario.ts'], etiquetas: ['otra'] }).entera).toBe(false)
  })
  it('todo lo que nombra LO_COMUN existe hoy', () => {
    for (const p of LO_COMUN) {
      const ok = existsSync(p.replace(/\/$/, '')) || (p === 'tsconfig' && existsSync('tsconfig.json')) || (p === 'scripts/e2e/carril' && existsSync('scripts/e2e/carril.sh'))
      expect(ok, p).toBe(true)
    }
  })
})

// Autoconteo (Julio, 21/10): la zona de inventario sale de lo que se toca, sea cual sea la rama.
describe('las zonas por fichero', () => {
  it('tocar inventario o la tablet de contar añade tests/e2e/inventario, y la corta sigue', () => {
    for (const f of ['src/modules/supply/components/ResumenAutoconteo.tsx', 'src/pages/trabajador/MiAutoinventario.tsx',
                     'tests/e2e/inventario/autoconteo.spec.ts', 'supabase/seeds/conta/seed_autoconteo_e2e_staging.sql']) {
      const r = queCorre('conta/w02-herramientas', { cambiados: [f] })
      expect(r.entera, f).toBe(false)
      expect(r.pruebas, f).toContain('tests/e2e/inventario')
      for (const c of CORTA) expect(r.pruebas, f).toContain(c)
      expect(r.porque, f).toMatch(/la de lo que toca \(inventario\)/)
    }
  })
  it('sin tocar inventario no la añade, y una rama de frente sigue con su carpeta delante', () => {
    expect(queCorre('conta/d01-x', { cambiados: ['src/modules/conta/recibidas/a.ts'] }).pruebas).not.toContain('tests/e2e/inventario')
    const r = queCorre('conta/d01-x', { cambiados: ['src/modules/supply/pages/InventoryPage.tsx'] })
    expect(r.pruebas[0]).toBe('tests/e2e/conta/d01')
    expect(r.pruebas).toContain('tests/e2e/inventario')
    expect(new Set(r.pruebas).size).toBe(r.pruebas.length)
  })
  it('lo común sigue mandando: la entera', () => {
    expect(queCorre('conta/x', { cambiados: ['src/modules/supply/a.ts', 'src/App.tsx'] }).entera).toBe(true)
  })
  it('cada zona nombra una carpeta de pruebas que existe', () => {
    for (const z of ZONAS_POR_FICHERO) expect(existsSync(z.pruebas), z.pruebas).toBe(true)
    expect(zonasTocadas(['README.md'])).toEqual([])
  })
})

