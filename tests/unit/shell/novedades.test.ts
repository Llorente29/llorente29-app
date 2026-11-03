// NV1 (03/11) · Qué novedades enseña el cartel y la página: las que trae la
// versión publicada y no la que se ejecuta, las de su producto y las comunes,
// las 3 primeras y «y N más»; «Nuevo para ti» lo posterior a lo visto. Y el
// plugin del build, que las junta de novedades/pr-*.json.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { deMiProducto, fechaCorta, masNueva, nuevaParaTi, nuevasDeLaVersion, paraElCartel, porDia, productoDeMarca, type Novedad } from '@/shell/version/novedades'
import { leerNovedades } from '../../../build/novedadesPlugin'

const n = (id: string, fecha: string, producto: Novedad['producto'], apartado = 'Algo'): Novedad =>
  ({ id, pr: Number(id.split('-')[0]), fecha, producto, apartado, frase: `${apartado} nuevo.`, ruta: null })

// Como llegarían: el #461 (Sumied) y el #464 sin novedades, uno de Folvy, uno común y este mismo.
const PUBLICADAS = [
  n('470-1', '2026-11-03T20:00:00Z', 'comun', 'Novedades'),
  n('469-1', '2026-11-03T19:00:00Z', 'folvy', 'Cocina'),
  n('461-1', '2026-11-03T16:45:03Z', 'sumied', 'Liquidaciones'),
  n('455-1', '2026-11-02T10:00:00Z', 'sumied', 'Pagos'),
  n('455-2', '2026-11-02T10:00:00Z', 'sumied', 'Bancos'),
]

describe('qué trae la versión publicada', () => {
  it('lo que no conoce la build que se ejecuta, de su producto y lo común', () => {
    expect(nuevasDeLaVersion(PUBLICADAS, ['455-1', '455-2'], 'sumied').map((x) => x.id)).toEqual(['470-1', '461-1'])
    expect(nuevasDeLaVersion(PUBLICADAS, ['455-1', '455-2'], 'folvy').map((x) => x.id)).toEqual(['470-1', '469-1'])
  })
  it('lo de Sumied no sale en Folvy, ni al revés', () => {
    expect(deMiProducto(PUBLICADAS, 'folvy').some((x) => x.producto === 'sumied')).toBe(false)
    expect(deMiProducto(PUBLICADAS, 'sumied').some((x) => x.producto === 'folvy')).toBe(false)
  })
  it('una build sin sellar (dev) lo enseña todo', () => {
    expect(nuevasDeLaVersion(PUBLICADAS, null, 'sumied')).toHaveLength(4)
  })
  it('nada nuevo: lista vacía (el cartel dice «Arreglos pequeños»)', () => {
    expect(nuevasDeLaVersion(PUBLICADAS, PUBLICADAS.map((x) => x.id), 'sumied')).toEqual([])
  })
  it('las 3 primeras y cuántas más', () => {
    const r = paraElCartel(nuevasDeLaVersion(PUBLICADAS, [], 'sumied'))
    expect(r.vistas.map((x) => x.id)).toEqual(['470-1', '461-1', '455-1'])
    expect(r.mas).toBe(1)
    expect(paraElCartel([]).mas).toBe(0)
  })
  it('la marca genérica de contabilidad es de Sumied', () => {
    expect(productoDeMarca('sumied')).toBe('sumied')
    expect(productoDeMarca('contabilidad')).toBe('sumied')
    expect(productoDeMarca('folvy')).toBe('folvy')
  })
})

describe('Ayuda › Novedades', () => {
  it('por día de Madrid, de lo más nuevo a lo más antiguo', () => {
    const d = porDia(deMiProducto(PUBLICADAS, 'sumied'))
    expect(d.map((x) => x.dia)).toEqual(['2026-11-03', '2026-11-02'])
    expect(d[1].novedades.map((x) => x.apartado)).toEqual(['Pagos', 'Bancos'])
    expect(fechaCorta('2026-11-03T16:45:03Z')).toBe('3 nov 2026')
  })
  it('«Nuevo para ti»: lo posterior a lo último visto; sin nada visto, todo', () => {
    expect(nuevaParaTi(PUBLICADAS[2], '2026-11-02T10:00:00Z')).toBe(true)
    expect(nuevaParaTi(PUBLICADAS[3], '2026-11-02T10:00:00Z')).toBe(false)
    expect(nuevaParaTi(PUBLICADAS[3], null)).toBe(true)
    expect(masNueva(PUBLICADAS)).toBe('2026-11-03T20:00:00Z')
    expect(masNueva([])).toBeNull()
  })
})

describe('el plugin del build', () => {
  it('junta los ficheros de los PR, de lo más nuevo a lo más antiguo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'novedades-'))
    writeFileSync(join(dir, 'pr-455.json'), JSON.stringify([PUBLICADAS[3], PUBLICADAS[4]]))
    writeFileSync(join(dir, 'pr-461.json'), JSON.stringify([PUBLICADAS[2]]))
    writeFileSync(join(dir, 'LEEME.md'), 'no es un PR')
    expect(leerNovedades(dir).map((x) => x.id)).toEqual(['461-1', '455-1', '455-2'])
  })
  it('una novedad rota para el build', () => {
    const dir = mkdtempSync(join(tmpdir(), 'novedades-'))
    writeFileSync(join(dir, 'pr-1.json'), JSON.stringify([{ id: '1-1', fecha: 'x', producto: 'otro', apartado: 'A', frase: 'B' }]))
    expect(() => leerNovedades(dir)).toThrow(/no tiene id, fecha, producto, apartado y frase/)
  })
  it('la carpeta del repositorio se lee', () => {
    expect(Array.isArray(leerNovedades('novedades'))).toBe(true)
  })
})
