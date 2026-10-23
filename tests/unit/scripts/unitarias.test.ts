// tests/unit/scripts/unitarias.test.ts — qué unitarias corre la CI de un PR (N1, 23/10).
// Contra la población real: las pruebas que hay hoy en el repositorio (git
// ls-files) y los ficheros de PR fusionados de verdad en main.

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  deQuien, queUnitarias, suiteDe, suitesDe, pruebasQueCorren, pruebasDelRepositorio, PRUEBAS_SUMIED,
} from '../../../scripts/pruebas/unitarias.mjs'

type Prueba = { fichero: string; texto: string }
let pruebas: Prueba[] = []
beforeAll(async () => { pruebas = await pruebasDelRepositorio() })

// Los ficheros de tres PR fusionados en main (git diff de su fusión).
const C08_CONECTAR = [   // 41e243c8: «Conectar a delivery», solo cocina y su función
  'src/modules/kitchen/pages/KitchenMenuPage.tsx',
  'src/modules/kitchen/services/hubriseBrandConnectService.ts',
  'supabase/functions/hubrise-brand-connect/index.ts',
]
const D04_FICHA = [      // 14ef8880: la ficha de la recibida, solo contabilidad
  'src/modules/conta/diseno/plantillas/Ficha.tsx',
  'src/modules/conta/documentos/RevisarFacturaPage.tsx',
  'src/modules/conta/esqueleto/contadoresPestanas.ts',
  'src/modules/conta/marco/Barra.tsx',
  'tests/e2e/conta/d01/ficha-recibida.spec.ts',
  'tests/unit/modules/conta/d04/reparto-pdf.test.ts',
]
const C11B = [           // 90fdb711 (#306): migraciones, tanda y front de contabilidad
  'src/modules/conta/lib/sinConfirmar.ts',
  'supabase/migrations/20261023T2300_c11b_cierre_cierra_sin_confirmar.sql',
  'supabase/produccion/tandas/sumied/conta-c11b-cerrar-sin-confirmar/aplicar.txt',
]

describe('de quién es cada fichero', () => {
  it('Sumied, Folvy o lo común', () => {
    const casos: Record<string, string> = {
      'src/modules/conta/lib/sinConfirmar.ts': 'sumied',
      'supabase/functions/conta-diez-enviar/index.ts': 'sumied',
      'scripts/conta/antes-de-subir.sh': 'sumied',
      'tests/unit/modules/conta/d04/reparto-pdf.test.ts': 'sumied',
      'docs/conta/i01/I01_paso1.md': 'sumied',
      'src/modules/kitchen/pages/KitchenMenuPage.tsx': 'folvy',
      'src/modules/supply/lib/autoconteoTexto.ts': 'folvy',
      'src/pages/RepartoSettingsPage.tsx': 'folvy',
      'supabase/functions/hubrise-webhook/index.ts': 'folvy',
      'tests/unit/modules/kitchen/capturaGestor.test.tsx': 'folvy',
      // Lo común: el arranque, lo compartido de src, _shared, migraciones y workflows.
      'src/App.tsx': 'ambos',
      'src/context/AppContext.tsx': 'ambos',
      'src/lib/supabase.ts': 'ambos',
      'src/config/navegacion.ts': 'ambos',
      'supabase/functions/_shared/diezCliente.ts': 'ambos',
      'supabase/migrations/20261023T2300_c11b_cierre_cierra_sin_confirmar.sql': 'ambos',
      '.github/workflows/unitarias.yml': 'ambos',
      'package.json': 'ambos',
      'vitest.config.ts': 'ambos',
      'CLAUDE.md': 'ambos',
    }
    for (const [f, q] of Object.entries(casos)) expect(deQuien(f), f).toBe(q)
  })

  it('un fichero que no se sabe de quién es lanza las dos', () => {
    expect(deQuien('carpeta-nueva/algo.ts')).toBe('ambos')
  })
})

describe('las suites de las pruebas que hay hoy', () => {
  it('cada prueba es de Sumied por su carpeta o de Folvy', () => {
    const sumied = pruebas.filter((p) => suiteDe(p.fichero) === 'sumied')
    expect(sumied.length).toBeGreaterThan(100)
    for (const p of sumied) expect(PRUEBAS_SUMIED.some((c) => p.fichero.startsWith(c)), p.fichero).toBe(true)
    expect(pruebas.length - sumied.length).toBeGreaterThan(100)
  })

  it('las que leen el otro producto son de las dos (medido el 23/10)', () => {
    const vigia = pruebas.find((p) => p.fichero === 'tests/inventario/vigia.test.ts')!
    expect([...suitesDe(vigia.fichero, vigia.texto)].sort()).toEqual(['folvy', 'sumied'])   // importa scripts/conta/lib
    const correo = pruebas.find((p) => p.fichero === 'tests/unit/modules/conta/p01/correoMarca.test.ts')!
    expect([...suitesDe(correo.fichero, correo.texto)].sort()).toEqual(['folvy', 'sumied'])  // importa send-email/marca
  })

  it('una prueba sin cruces es solo de su producto', () => {
    const t = 'tests/unit/modules/kitchen/columnasCuadradas.test.ts'
    expect([...suitesDe(t, readFileSync(t, 'utf8'))]).toEqual(['folvy'])
  })
})

describe('qué corre un PR', () => {
  it('solo cocina (C08): las de Folvy, ninguna solo de Sumied', () => {
    const r = pruebasQueCorren(C08_CONECTAR, pruebas)
    expect(r.todas).toBe(false)
    expect(r.sumied).toBe(false)
    expect(r.lista).toContain('tests/unit/modules/kitchen/columnasCuadradas.test.ts')
    expect(r.lista.some((f) => f.startsWith('tests/conta/diez/'))).toBe(false)
  })

  it('solo contabilidad (D04): las de Sumied y las de Folvy que leen Sumied', () => {
    const r = pruebasQueCorren(D04_FICHA, pruebas)
    expect(r.todas).toBe(false)
    expect(r.folvy).toBe(false)
    expect(r.lista).toContain('tests/unit/modules/conta/d04/reparto-pdf.test.ts')
    expect(r.lista).toContain('tests/unit/textos/papel.test.ts')   // lee pantallas de compras de conta
    expect(r.lista).not.toContain('tests/unit/modules/kitchen/columnasCuadradas.test.ts')
  })

  it('con migración (C11b): todas, porque las migraciones las leen los dos', () => {
    const r = pruebasQueCorren(C11B, pruebas)
    expect(r.todas).toBe(true)
    expect(r.lista.length).toBe(pruebas.length)
    expect(r.porque).toMatch(/lo común/)
  })

  it('sin ficheros, ninguna', () => {
    expect(queUnitarias([])).toEqual({ sumied: false, folvy: false, porque: 'no cambia ningún fichero' })
    expect(pruebasQueCorren([], pruebas).lista).toEqual([])
  })
})

describe('el workflow', () => {
  const wf = readFileSync('.github/workflows/unitarias.yml', 'utf8')
  it('corre en cada PR a main con el reparto de unitarias.mjs', () => {
    expect(wf).toMatch(/pull_request:\s*\n\s*branches: \[main\]/)
    expect(wf).toContain('node scripts/pruebas/unitarias.mjs /tmp/cambiados.txt /tmp/pruebas.txt')
    expect(wf).toContain('npx vitest run')
  })
  it('solo lee', () => {
    expect(wf).toMatch(/permissions:\s*\n\s*contents: read\s*\n/)
    expect(wf).not.toMatch(/secrets\./)
  })
})
