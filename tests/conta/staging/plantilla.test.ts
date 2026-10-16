// tests/conta/staging/plantilla.test.ts
//
// La regla de la plantilla (W02, aprobada el 16/10), contra los ficheros REALES
// del repositorio: las semillas y los staging/sql que existen y las pruebas
// e2e que existen (regla 31). Nada inventado salvo la cabecera que se le pone.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { cabecera, pruebasE2e, quienLee, revisar, tocaPlantilla } from '../../../scripts/conta/plantilla.mjs'

const PRUEBAS = pruebasE2e()
const leer = (f: string) => readFileSync(f, 'utf8')

describe('la regla de la plantilla', () => {
  it('la semilla del C01 toca la plantilla, y la leen las pruebas del C01b (las de las 7 rojas del 16/10)', () => {
    const s = leer('supabase/seeds/conta/seed_c01_staging.sql')
    expect(tocaPlantilla(s)).toBe(true)
    expect(quienLee(s, PRUEBAS)).toContain('conta/c01b/flujos.spec.ts')
  })

  it('sin la cabecera, falla y dice qué falta; con ella y con quien la lee, cumple', () => {
    const s = leer('supabase/seeds/conta/seed_c01_staging.sql')
    expect(revisar(s, PRUEBAS)[0]).toMatch(/no lleva «-- plantilla:/)
    const leen = quienLee(s, PRUEBAS)
    expect(revisar(`-- plantilla: proveedores de A · lo leen: ${leen.join(', ')}\n${s}`, PRUEBAS)).toEqual([])
    // Si le falta una, la nombra.
    const corta = revisar(`-- plantilla: proveedores de A · lo leen: ${leen.slice(1).join(', ')}\n${s}`, PRUEBAS)
    expect(corta).toEqual([`falta en «lo leen»: ${leen[0]} (usa ids de este fichero)`])
  })

  it('una prueba que no existe en «lo leen» también falla', () => {
    const s = leer('supabase/seeds/conta/seed_c01_staging.sql')
    const leen = quienLee(s, PRUEBAS)
    expect(revisar(`-- plantilla: x · lo leen: ${[...leen, 'conta/no/existe.spec.ts'].join(', ')}\n${s}`, PRUEBAS))
      .toEqual(['«lo leen» nombra conta/no/existe.spec.ts, que no está en tests/e2e'])
  })

  it('«ninguna» vale cuando nadie usa sus ids, y lo que no toca la plantilla no pide nada', () => {
    expect(cabecera('-- plantilla: nada · lo leen: ninguna\nselect 1;')).toEqual({ que: 'nada', leen: [] })
    expect(revisar('-- plantilla: cuenta A · lo leen: ninguna\nupdate accounts set name = name where id = \'c01a0000-0000-4000-8000-00000000000a\';', PRUEBAS)).toEqual([])
    expect(revisar('select 1;', PRUEBAS)).toEqual([])
  })

  it('las cuentas y los usuarios son los del carril (comun.sql), los once', () => {
    const comun = leer('scripts/e2e/carril/comun.sql')
    const ids = [
      'c01a0000-0000-4000-8000-00000000000a', 'c01b0000-0000-4000-8000-00000000000b', 'c01c0000-0000-4000-8000-00000000000c', 'c0600000-0000-4000-8000-0000000000d0',
      'c01a0000-0000-4000-8000-0000000000a1', 'c01a0000-0000-4000-8000-0000000000a6', 'c01b0000-0000-4000-8000-0000000000b1', 'c01c0000-0000-4000-8000-0000000000c1',
      'c0600000-0000-4000-8000-0000000000a1', 'c0600000-0000-4000-8000-0000000000b1', 'c0600000-0000-4000-8000-0000000000f0',
    ]
    for (const id of ids) {
      expect(comun).toContain(id)
      expect(tocaPlantilla(`select '${id}';`)).toBe(true)
    }
  })

  it('antes-de-subir lo comprueba', () => {
    expect(leer('scripts/conta/antes-de-subir.sh')).toContain('node scripts/conta/plantilla.mjs')
  })
})

import { cambios, leer as leerHuella, salida as salidaHuella, veredicto } from '../../../scripts/conta/staging/huella-plantilla.mjs'
import { filtrar } from '../../../scripts/conta/lib/salidaSegura.mjs'

describe('la huella nocturna de la plantilla', () => {
  const H = (c: string) => c.repeat(32)
  const foto = (filas: [string, string][]) => leerHuella(filas.map((f) => f.join('\t')).join('\n'))
  const ANTES = foto([['cuentas', H('1')], ['supplier', H('2')], ['bank_match', H('3')], ['#registro', H('9')]])

  it('la primera vez no hay con qué comparar: verde', () => {
    expect(veredicto(new Map(), ANTES).estado).toBe('primera')
  })

  it('cambia una tabla y el historial NO: alguien la cambió sin fichero, rojo, y dice cuál', () => {
    const ahora = foto([['cuentas', H('1')], ['supplier', H('4')], ['bank_match', H('3')], ['#registro', H('9')]])
    expect(veredicto(ANTES, ahora)).toEqual({ estado: 'sin_fichero', tablas: ['supplier'] })
    const pasa = filtrar(salidaHuella(ANTES, ahora).texto)
    expect(pasa.retenidas).toBe(0)
    expect(pasa.filas).toContainEqual({ clave: 'sin_fichero', valor: '1' })
    expect(pasa.filas).toContainEqual({ clave: 'p.supplier', valor: '4444444444444444' })
  })

  it('cambia una tabla y el historial también: entró un fichero, verde', () => {
    const ahora = foto([['cuentas', H('1')], ['supplier', H('4')], ['bank_match', H('3')], ['#registro', H('8')]])
    expect(veredicto(ANTES, ahora).estado).toBe('con_fichero')
  })

  it('una tabla nueva o que desaparece también es un cambio', () => {
    const ahora = foto([['cuentas', H('1')], ['supplier', H('2')], ['nueva', H('5')], ['#registro', H('9')]])
    expect(cambios(ANTES, ahora)).toEqual(['bank_match', 'nueva'])
  })

  it('el workflow la toma cada noche, solo de staging y sin tocar la tanda', () => {
    const wf = readFileSync('.github/workflows/comparar-staging-produccion.yml', 'utf8')
    const job = wf.slice(wf.indexOf('  plantilla:'))
    expect(job).toMatch(/if: inputs\.momento == ''/)
    expect(job).toContain('scripts/conta/staging/plantilla_huella.sql')
    expect(job).not.toContain('PROD_CONTA')
    expect(job).toMatch(/default_transaction_read_only=on/)
  })
})
