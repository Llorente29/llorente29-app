// tests/unit/e2e/area.test.ts — qué corre la e2e de un push (W02, 17/10).
// Contra las ramas que existen de verdad (git branch -r, 17/10) y las carpetas
// que hay hoy en tests/e2e/conta: ninguna puede dar la suite entera.

import { describe, it, expect } from 'vitest'
import { suiteFolvy, SUITE_SUMIED, LO_COMUN_AMBOS, LO_COMUN_SUMIED, productosTocados } from '../../../scripts/e2e/area.mjs'
import { existsSync, readdirSync } from 'node:fs'
import { pruebasDelPush, pruebasDeLaZona, COMUN, CORTA, PEDIDOS, dePedidos, carpetasConta } from '../../../scripts/e2e/area.mjs'

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

  // W04 (Julio, 22/10): la corta ya no va en cada push; un push sin saber qué toca, solo su zona.
  it('un push corre su zona y nada más: la corta no va si no toca pedidos', () => {
    for (const [rama, esperado] of Object.entries(RAMAS)) expect(pruebasDelPush(rama), rama).toEqual(esperado)
    for (const rama of Object.keys(RAMAS).filter((r) => !r.startsWith('reparto-'))) {
      for (const f of CORTA) expect(pruebasDelPush(rama), `${rama}: ${f}`).not.toContain(f)
    }
  })

  it('la corta existe y está medida en tests/e2e/tiempos/ (91 s en los dos tamaños)', async () => {
    const t = (await import('../../../scripts/e2e/trozos.mjs')).tiemposDelRepo() as Record<string, number>
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
import { queCorre, deLoComun, LO_COMUN, ETIQUETA_ENTERA, ZONAS_POR_FICHERO, zonasTocadas, HUMO } from '../../../scripts/e2e/area.mjs'

const PRS = JSON.parse(readFileSync(join(__dirname, 'fixtures/prs-reales.json'), 'utf8')).prs as { commit: string; titulo: string; ficheros: string[]; comun: boolean }[]

describe('la entera, solo si el PR toca lo común (los 40 últimos PR de main)', () => {
  it('cada PR, como se revisó a mano', () => {
    for (const p of PRS) expect(deLoComun(p.ficheros).length > 0, `${p.commit} ${p.titulo}`).toBe(p.comun)
  })
  it('de los dos lados: 13 de 40 con lo común', () => {
    expect(PRS).toHaveLength(40)
    expect(PRS.filter((p) => p.comun)).toHaveLength(13)
  })
  // Julio, 26/10: la entera ya no corre en ningún PR. Lo común lleva su zona y la rápida de pantallas.
  it('la cabecera de pestañas (#258) y el ancho (#263), su zona y la rápida; el recuadro del plazo (#265), solo su zona', () => {
    const de = (t: string) => PRS.find((p) => p.titulo.includes(t))!
    const pestanas = queCorre('conta/s01f-pestanas', { cambiados: de('(#258)').ficheros })
    expect(pestanas).toMatchObject({ entera: false })
    expect(pestanas.pruebas).toContain(HUMO)
    expect(pestanas.pruebas).toContain('tests/e2e/conta/s01f')
    expect(queCorre('conta/s01g-ancho', { cambiados: de('(#263)').ficheros }).porque).toMatch(/la rápida de pantallas, porque toca lo común: src\/modules\/conta\/diseno\//)
    const plazo = queCorre('conta/i01b-plazo', { cambiados: de('(#265)').ficheros })
    expect(plazo.entera).toBe(false)
    expect(plazo.pruebas).toEqual(pruebasDelPush('conta/i01b-plazo'))
    for (const c of CORTA) expect(plazo.pruebas).not.toContain(c)
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
  it('tocar inventario o la tablet de contar añade tests/e2e/inventario, sin la corta', () => {
    for (const f of ['src/modules/supply/components/ResumenAutoconteo.tsx', 'src/pages/trabajador/MiAutoinventario.tsx',
                     'tests/e2e/inventario/autoconteo.spec.ts', 'supabase/seeds/conta/seed_autoconteo_e2e_staging.sql']) {
      const r = queCorre('conta/w02-herramientas', { cambiados: [f] })
      expect(r.entera, f).toBe(false)
      expect(r.pruebas, f).toContain('tests/e2e/inventario')
      for (const c of CORTA) expect(r.pruebas, f).not.toContain(c)
      expect(r.porque, f).toMatch(/la de lo que toca \(inventario\)/)
    }
  })
  it('sin tocar inventario no la añade, y una rama de frente sigue con su carpeta delante', () => {
    expect(queCorre('conta/d01-x', { cambiados: ['src/modules/conta/recibidas/a.ts'] }).pruebas).not.toContain('tests/e2e/inventario')
    // C10: un cambio solo de Folvy (inventario) no lanza las de Sumied, aunque la rama sea de contabilidad.
    expect(queCorre('conta/d01-x', { cambiados: ['src/modules/supply/pages/InventoryPage.tsx'] }).pruebas).toEqual(['tests/e2e/inventario'])
    const r = queCorre('conta/d01-x', { cambiados: ['src/modules/supply/pages/InventoryPage.tsx', 'src/modules/conta/recibidas/a.ts'] })
    expect(r.pruebas[0]).toBe('tests/e2e/conta/d01')
    expect(r.pruebas).toContain('tests/e2e/inventario')
    expect(new Set(r.pruebas).size).toBe(r.pruebas.length)
  })
  it('lo común no pide la entera: añade la rápida a la zona', () => {
    const r = queCorre('conta/x', { cambiados: ['src/modules/supply/a.ts', 'src/App.tsx'] })
    expect(r.entera).toBe(false)
    expect(r.pruebas).toContain(HUMO)
    expect(r.pruebas).toContain('tests/e2e/inventario')
  })
  it('cada zona nombra una carpeta de pruebas que existe', () => {
    for (const z of ZONAS_POR_FICHERO) expect(existsSync(z.pruebas), z.pruebas).toBe(true)
    expect(zonasTocadas(['README.md'])).toEqual([])
  })
})


// W04 (Julio, 22/10): pedidos, cocina o reparto → todo; desde el 26/10, la corta
// (la entera ya no corre en ningún PR). Contra los 40 últimos PR de main.
describe('pedidos, cocina o reparto: la corta', () => {
  it('de los 40 PR reales, solo uno toca pedidos (el relevo del secreto del W02), y ese corre la corta', () => {
    const tocan = PRS.filter((p) => dePedidos(p.ficheros).length > 0)
    expect(tocan.map((p) => p.titulo.slice(0, 40))).toEqual(['W02 · Secretos fuera del código antes de'])
    const r = queCorre('conta/w02-secretos', { cambiados: tocan[0].ficheros })
    expect(r.entera).toBe(false)
    for (const f of CORTA) expect(r.pruebas).toContain(f)
    expect(r.porque).toMatch(/la corta, porque toca pedidos, cocina o reparto: /)
  })
  it('una pantalla de pedidos, la cocina, una función de HubRise y las e2e de reparto llevan la corta, no la entera', () => {
    for (const f of ['src/modules/orders/pages/OrdersPage.tsx', 'src/modules/kitchen/x.tsx', 'supabase/functions/hubrise-webhook/index.ts', 'tests/e2e/reparto/quien-reparte.spec.ts']) {
      const r = queCorre('conta/c06c-x', { cambiados: [f] })
      expect(r.entera, f).toBe(false)
      for (const c of CORTA) expect(r.propias, f).toContain(c)
    }
    expect(queCorre('conta/c06c-x', { cambiados: ['src/modules/conta/libro/DetalleDiez.tsx'] }).entera).toBe(false)
  })
  it('todo lo que nombra PEDIDOS existe hoy (una carpeta, un fichero o el principio de varias funciones)', () => {
    for (const p of PEDIDOS) {
      const ok = existsSync(p.replace(/\/$/, '')) || (p.endsWith('-') && readdirSync('supabase/functions').some((d) => `supabase/functions/${d}`.startsWith(p)))
      expect(ok, p).toBe(true)
    }
  })
})

describe('Sumied y Folvy, separados (C10, 23/10)', () => {
  it('Folvy son las carpetas de tests/e2e que no son la de la contabilidad', () => {
    expect(suiteFolvy()).toEqual(['tests/e2e/inventario', 'tests/e2e/laboral', 'tests/e2e/marcas', 'tests/e2e/reparto'])
    expect(SUITE_SUMIED).toEqual(['tests/e2e/conta'])
  })
  it('un cambio solo de Sumied no lanza las de Folvy', () => {
    const r = queCorre('conta/d09-x', { cambiados: ['src/modules/conta/recibidas/a.ts', 'supabase/functions/conta-diez-enviar/index.ts'] })
    expect(r.entera).toBe(false)
    for (const p of r.pruebas) expect(p.startsWith('tests/e2e/conta')).toBe(true)
    const c = queCorre('conta/s09-x', { cambiados: ['src/modules/conta/diseno/Boton.tsx'] })
    expect(c.entera).toBe(false)
    expect(c.pruebas).toEqual([...COMUN, HUMO])
  })
  it('un cambio solo de Folvy no lanza las de Sumied', () => {
    const k = queCorre('conta/c08b-catalogo-perdido', { cambiados: ['src/modules/kitchen/pages/KitchenMenuPage.tsx', 'supabase/functions/hubrise-brand-connect/index.ts'] })
    expect(k.entera).toBe(false)
    expect(k.pruebas).toEqual(CORTA)
    const sinZona = queCorre('reparto-x', { cambiados: ['src/pages/AlgoDeFolvy.tsx'] })
    expect(sinZona.pruebas).toEqual(suiteFolvy())
  })
  it('lo común: la zona, la rápida de pantallas y nada de la entera (Julio, 26/10)', () => {
    for (const f of ['src/App.tsx', 'package.json', 'playwright.config.ts', '.github/workflows/e2e-staging-conta.yml', 'src/modules/conta/module.tsx']) {
      const r = queCorre('conta/x', { cambiados: [f] })
      expect(r.entera, f).toBe(false)
      expect(r.pruebas, f).toEqual([...COMUN, HUMO])
      // La rápida y el juego común no son de la zona: un fallo por tiempo en ellas no bloquea.
      expect(r.propias, f).toEqual([])
    }
    const ambos = queCorre('conta/x', { cambiados: ['src/modules/conta/diseno/a.tsx', 'src/modules/orders/b.tsx'] })
    expect(ambos.entera).toBe(false)
    expect(ambos.pruebas).toEqual([...CORTA, ...COMUN, HUMO])
  })
  it('la rápida existe y la etiqueta sigue siendo la única forma de pedir la entera en un PR', () => {
    expect(existsSync(HUMO)).toBe(true)
    for (const p of PRS) expect(queCorre('conta/x', { cambiados: p.ficheros }).entera, p.titulo).toBe(false)
    expect(queCorre('conta/x', { cambiados: ['src/App.tsx'], etiquetas: [ETIQUETA_ENTERA] }).entera).toBe(true)
  })
  it('lo común de Sumied y el de los dos no se pisan, y qué es de cada producto', () => {
    for (const p of LO_COMUN_SUMIED) expect(LO_COMUN_AMBOS).not.toContain(p)
    expect(productosTocados(['src/modules/conta/a.ts'])).toEqual({ sumied: true, folvy: false })
    expect(productosTocados(['src/modules/orders/a.ts'])).toEqual({ sumied: false, folvy: true })
    expect(productosTocados(['docs/algo.md'])).toEqual({ sumied: false, folvy: false })
  })
})
