import { describe, it, expect } from 'vitest'
import { agrupadoPorGrupo, novedades } from '@/shell/home/homeCatalog'
import type { CatalogEntry } from '@/shell/home/homeCatalog'

function card(key: string, grupo?: string, title = key): CatalogEntry {
  return {
    key, title, size: 'sm', grupo,
    component: (() => null) as unknown as CatalogEntry['component'],
    moduleId: 'x', moduleName: 'Módulo X',
  } as CatalogEntry
}

describe('agrupadoPorGrupo · el idioma del negocio, no el de los módulos', () => {
  it('respeta el orden aprobado de los seis grupos', () => {
    const g = agrupadoPorGrupo([
      card('a', 'Agentes'), card('b', 'Ventas'), card('c', 'Cocina'), card('d', 'Team'),
    ])
    expect(g.map(x => x.grupo)).toEqual(['Ventas', 'Team', 'Cocina', 'Agentes'])
  })

  it('un grupo sin tarjetas no se pinta vacío', () => {
    const g = agrupadoPorGrupo([card('a', 'Ventas')])
    expect(g.map(x => x.grupo)).toEqual(['Ventas'])
  })

  // Si aparece «Otras» es que a alguien se le olvidó declarar el grupo, y se
  // ve a la primera en vez de quedar escondido bajo el nombre de un módulo.
  it('sin grupo declarado cae en «Otras», al final', () => {
    const g = agrupadoPorGrupo([card('a'), card('b', 'Ventas')])
    expect(g.map(x => x.grupo)).toEqual(['Ventas', 'Otras'])
  })

  // La tarjeta del 86 vive en el código de Kitchen y pertenece a «Canales».
  it('el grupo NO es el módulo: una tarjeta de Kitchen puede ir en Canales', () => {
    const g = agrupadoPorGrupo([card('kitchen.productos_86', 'Canales')])
    expect(g[0].grupo).toBe('Canales')
    expect(g[0].tarjetas[0].moduleName).toBe('Módulo X')
  })
})

describe('novedades · lo que ha llegado y no tienes', () => {
  const CATALOGO = [card('a', 'Ventas'), card('b', 'Team'), card('c', 'Cocina')]

  it('son las disponibles que no están en tu mosaico', () => {
    expect(novedades(['a'], CATALOGO).map(c => c.key)).toEqual(['b', 'c'])
  })

  it('con todas puestas, ninguna novedad', () => {
    expect(novedades(['a', 'b', 'c'], CATALOGO)).toEqual([])
  })

  // Sin recordar el «no, gracias», el aviso reaparece en cada carga y a la
  // tercera se ignora — y con él se ignora el de huérfanas, que sí importa.
  it('una descartada NO se vuelve a ofrecer', () => {
    expect(novedades(['a'], CATALOGO, ['b']).map(c => c.key)).toEqual(['c'])
  })

  it('descartar todas deja el aviso callado del todo', () => {
    expect(novedades(['a'], CATALOGO, ['b', 'c'])).toEqual([])
  })

  // Una clave huérfana en el layout no convierte su tarjeta en novedad: no
  // está en el catálogo, así que no puede ofrecerse.
  it('una clave guardada que ya no existe no genera novedad', () => {
    expect(novedades(['a', 'borrada'], CATALOGO).map(c => c.key)).toEqual(['b', 'c'])
  })
})
