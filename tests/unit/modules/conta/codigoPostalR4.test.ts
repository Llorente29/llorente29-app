// La población que sale del código postal (respuesta 4 del C00, arreglo 3).
// Contra la población real (regla 31): el fichero de GeoNames que bajó GitHub
// Actions y la migración generada de él, no ejemplos inventados. Y la frase de
// Julio tal cual la escribió.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { entenderDireccion, nombrePoblacion, proponerPoblacion, type LugarCp } from '@/modules/conta/lib/codigoPostal'
import { provinciaPorCp } from '@/modules/conta/lib/direccion'

const filas = readFileSync('docs/conta/fuentes/textos/geonames-cp-es.tsv', 'utf8').split('\n').filter((l) => l.trim() !== '')
  .map((l) => l.split('\t'))
const porCp = new Map<string, LugarCp[]>()
for (const c of filas) {
  const l = porCp.get(c[1]) ?? []
  l.push({ poblacion: c[2], municipio: c[7] || null, provincia: c[5] || null })
  porCp.set(c[1], l)
}
const proponer = (cp: string) => proponerPoblacion(cp, porCp.get(cp) ?? [])

describe('la tabla de serie código postal → población', () => {
  it('la migración 0210 es exactamente la que sale del fichero descargado', () => {
    expect(() => execFileSync('node', ['scripts/conta/codigos-postales.mjs', 'comprobar'], { stdio: 'pipe' })).not.toThrow()
  })

  it('el fichero es el de España entero: todas las filas son ES con código de cinco cifras', () => {
    expect(filas.length).toBeGreaterThan(30000)
    expect(filas.every((c) => c[0] === 'ES' && /^\d{5}$/.test(c[1]))).toBe(true)
    expect(porCp.size).toBeGreaterThan(10000)
  })
})

describe('la población propuesta', () => {
  it('la dirección de Julio: 28051 → Madrid', () => {
    const p = proponer('28051')
    expect(p?.valor).toBe('Madrid')
    expect(p?.otras).toEqual([])
    expect(p?.porque).toContain('28051')
    expect(p?.porque).toContain('GeoNames')
  })

  it('otras provincias, con el nombre bien escrito aunque GeoNames lo traiga sin tildes', () => {
    expect(proponer('08001')?.valor).toBe('Barcelona')
    // El municipio de Sevilla viene en inglés («Seville»): manda la población.
    expect(proponer('41001')?.valor).toBe('Sevilla')
    // «Las Palmas De Gran Canaria» → el del municipio, con su «de».
    expect(proponer('35001')?.valor).toBe('Las Palmas de Gran Canaria')
  })

  it('un código de varias poblaciones de un municipio propone la cabecera y deja las demás a mano', () => {
    const p = proponer('04002')
    expect(p?.valor).toBe('Almería')
    expect(p?.otras.length).toBeGreaterThan(0)
    expect(p?.porque).toContain('varias poblaciones')
  })

  it('en TODO el fichero: ningún código postal se queda sin población propuesta, y la propuesta es una de las suyas', () => {
    let sinPropuesta = 0
    let ajena = 0
    for (const [cp, lugares] of porCp) {
      const p = proponerPoblacion(cp, lugares)
      if (!p) { sinPropuesta++; continue }
      if (!lugares.map(nombrePoblacion).includes(p.valor)) ajena++
    }
    expect({ codigos: porCp.size, sinPropuesta, ajena }).toEqual({ codigos: porCp.size, sinPropuesta: 0, ajena: 0 })
  })

  it('en TODO el fichero: la provincia también sale del código (nada en blanco)', () => {
    const sinProvincia = [...porCp.keys()].filter((cp) => provinciaPorCp(cp) === null)
    expect(sinProvincia).toEqual([])
  })

  it('un código que no es de cinco cifras no propone nada', () => {
    expect(proponerPoblacion('2805', porCp.get('28051') ?? [])).toBeNull()
  })
})

describe('la dirección dicha en una frase', () => {
  it('la de Julio: calle, número y código postal; la población, de la tabla', () => {
    const d = entenderDireccion('Avda Ensanche de Vallecas 106, 28051')
    expect(d).toEqual({ calle: 'Avda Ensanche de Vallecas', numero: '106', codigoPostal: '28051', poblacion: null })
    expect(proponer(d!.codigoPostal)?.valor).toBe('Madrid')
  })

  it('si dice la ciudad, manda la ciudad, detrás o delante del código postal', () => {
    expect(entenderDireccion('Calle Mayor 5, 08001 Barcelona')?.poblacion).toBe('Barcelona')
    expect(entenderDireccion('Calle Mayor 5, Sant Adrià de Besòs, 08930')?.poblacion).toBe('Sant Adrià de Besòs')
    expect(entenderDireccion('Plaza Nueva s/n, 41001 Sevilla (Sevilla), España')?.poblacion).toBe('Sevilla')
  })

  it('un número al principio del nombre de la calle no es el portal', () => {
    expect(entenderDireccion('C/ 8 de Marzo, 3, 28013')).toMatchObject({ calle: 'C/ 8 de Marzo', numero: '3', codigoPostal: '28013' })
  })

  it('sin código postal: calle y número, y nada inventado', () => {
    expect(entenderDireccion('Calle Gran Vía 12')).toEqual({ calle: 'Calle Gran Vía', numero: '12', codigoPostal: '', poblacion: null })
    expect(entenderDireccion('28051')).toBeNull()
  })
})
