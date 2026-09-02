import { describe, it, expect } from 'vitest'
import { agrupadoPorGrupo, novedades, enumeraHastaTres } from '@/shell/home/homeCatalog'
import type { CatalogEntry } from '@/shell/home/homeCatalog'

/** Una P2: declarada y sin componente. */
function cardP2(key: string, grupo?: string, title = key): CatalogEntry {
  return { key, title, size: 'sm', grupo, moduleId: 'x', moduleName: 'Módulo X' } as CatalogEntry
}

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
  // Con componente = ya da dato. Sin componente = P2, prometida y sin cablear.
  const CATALOGO = [card('a', 'Ventas'), card('b', 'Team'), cardP2('p1', 'Cocina'), cardP2('p2', 'Canales')]

  it('separa lo que YA da dato de lo prometido', () => {
    const n = novedades(['a'], CATALOGO)
    expect(n.cableadas.map(c => c.key)).toEqual(['b'])
    expect(n.p2.map(c => c.key)).toEqual(['p1', 'p2'])
  })

  // Lo que Julio prohíbe expresamente: un «Añadirlas» que llene el Inicio de
  // huecos punteados. Las P2 se mencionan, nunca se ofrecen con botón.
  it('las P2 NUNCA salen entre las ofrecibles', () => {
    const n = novedades([], CATALOGO)
    expect(n.cableadas.every(c => c.component != null)).toBe(true)
    expect(n.cableadas.map(c => c.key)).toEqual(['a', 'b'])
  })

  it('con todas puestas, ninguna novedad de ninguna clase', () => {
    const n = novedades(['a', 'b', 'p1', 'p2'], CATALOGO)
    expect(n.cableadas).toEqual([])
    expect(n.p2).toEqual([])
  })

  // Sin recordar el «no, gracias», el aviso reaparece en cada carga y a la
  // tercera se ignora — y con él se ignora el de huérfanas, que sí importa.
  it('una descartada NO se vuelve a ofrecer, sea cableada o P2', () => {
    const n = novedades(['a'], CATALOGO, ['b', 'p1'])
    expect(n.cableadas).toEqual([])
    expect(n.p2.map(c => c.key)).toEqual(['p2'])
  })

  it('una clave guardada que ya no existe no genera novedad', () => {
    expect(novedades(['a', 'borrada'], CATALOGO).cableadas.map(c => c.key)).toEqual(['b'])
  })
})

describe('enumeraHastaTres · tres nombres y un recuento', () => {
  // Quince nombres seguidos no son una lista: son un párrafo que nadie lee, y
  // el aviso deja de avisar.
  it('hasta tres, los nombra; a partir de ahí, cuenta', () => {
    expect(enumeraHastaTres(['A'])).toBe('A')
    expect(enumeraHastaTres(['A', 'B'])).toBe('A y B')
    expect(enumeraHastaTres(['A', 'B', 'C'])).toBe('A, B y C')
    expect(enumeraHastaTres(['A', 'B', 'C', 'D'])).toBe('A, B, C y 1 más')
    expect(enumeraHastaTres(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('A, B, C y 3 más')
  })
  it('sin nombres, cadena vacía y no «y 0 más»', () => {
    expect(enumeraHastaTres([])).toBe('')
  })
})


// ── LAS 21 DEL CATÁLOGO APROBADO ───────────────────────────────────────────
// Estas pruebas leen el catálogo DE VERDAD, no un fixture: son las que se
// enteran de que alguien ha añadido una tarjeta y ha olvidado su grupo, su
// orden, o las dos cosas.
import { getHomeCatalog } from '@/shell/home/homeCatalog'
import { ORDEN_DEL_CAJON } from '@/shell/home/cards/p2Cards'
import { LAYOUT_POR_DEFECTO } from '@/shell/home/cards/shellCards'

describe('el catálogo aprobado', () => {
  const catalogo = getHomeCatalog()

  it('tiene las 21 tarjetas, ni una más ni una menos', () => {
    expect(catalogo).toHaveLength(21)
  })

  // 02/09, segundo lote: «Stock negativo» y «Resumen de agentes» dejan de ser
  // P2 y pasan a cableadas. El total no se mueve: una tarjeta que se cablea no
  // aparece ni desaparece, cambia de lado.
  it('ocho cableadas y trece P2', () => {
    expect(catalogo.filter(c => c.component != null)).toHaveLength(8)
    expect(catalogo.filter(c => c.component == null)).toHaveLength(13)
  })

  // Si alguien añade una tarjeta y olvida el grupo, cae en «Otras» y esto la
  // caza antes de que llegue a la pantalla de nadie.
  it('todas declaran su grupo de negocio', () => {
    expect(catalogo.filter(c => !c.grupo).map(c => c.key)).toEqual([])
  })

  it('todas están en el orden aprobado, y el orden no nombra fantasmas', () => {
    const enCatalogo = new Set(catalogo.map(c => c.key))
    expect(catalogo.filter(c => !ORDEN_DEL_CAJON.includes(c.key)).map(c => c.key)).toEqual([])
    expect(ORDEN_DEL_CAJON.filter(k => !enCatalogo.has(k))).toEqual([])
  })

  it('el reparto por grupo es el aprobado', () => {
    const porGrupo = agrupadoPorGrupo(catalogo)
    expect(porGrupo.map(g => [g.grupo, g.tarjetas.length])).toEqual([
      ['Ventas', 5], ['Team', 5], ['Cocina', 3], ['Almacen', 3], ['Canales', 4], ['Agentes', 1],
    ])
  })

  it('dentro de Ventas, el orden es el de la tabla aprobada', () => {
    const ventas = agrupadoPorGrupo(catalogo).find(g => g.grupo === 'Ventas')!
    expect(ventas.tarjetas.map(c => c.title)).toEqual([
      'Ventas de ayer', 'Ventas · esta semana', 'Ventas por día · últimas dos semanas',
      'Ticket medio', 'Ventas por canal',
    ])
  })

  // El defecto de fábrica son las seis que YA dan dato. Colar una P2 aquí
  // pondría un hueco punteado en el Inicio de quien no ha tocado nada.
  it('el defecto de fábrica son las seis cableadas, y ninguna P2', () => {
    const porKey = new Map(catalogo.map(c => [c.key, c]))
    expect(LAYOUT_POR_DEFECTO).toHaveLength(6)
    expect(LAYOUT_POR_DEFECTO.filter(k => porKey.get(k)?.component == null)).toEqual([])
  })
})
