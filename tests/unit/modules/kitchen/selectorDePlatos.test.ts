// B72 (05/09/2026). El selector de «Definir» tiene que dejar llegar a los platos,
// y tiene que dejar claro cuál es cuál.
//
// POR QUE ESTA PRUEBA EXISTE. Durante meses el selector filtraba el catálogo a
// `raw`/`recipe` (una linea: `ModifierImpactsTab.tsx`, el `.filter` del cargador)
// y dejaba fuera los 158 `dish` de la cuenta. Julio escribio «Patatas Clasicas»
// en «Si, con patatas» y el desplegable salio VACIO, con una unica salida a mano:
// «Crear como nuevo» -- un clic a fabricar un duplicado vacio y sin coste de una
// ficha que existe, esta activa y vale 0,876 €.
//
// Los datos de aqui no son inventados. Son fichas reales de Foodint
// (51ad1792-6629-4ef7-833a-b57b09a86710), medidas el 05/09/2026, y los nombres de
// grupo son de los 107 grupos reales de la cuenta.

import { describe, it, expect } from 'vitest'
import {
  kindOf, normName, grupoPidePlato, ordenaCandidatas, razonNoElegible,
  type CatalogPick,
} from '../../../../src/modules/kitchen/lib/catalogPick'

const ficha = (
  name: string,
  type: CatalogPick['type'],
  selectable = true,
): CatalogPick => ({ id: name, name, type, kind: kindOf(type), selectable })

// LA TRAMPA, con sus cifras de verdad: la patata cruda a granel (0,0022 € el
// gramo) y la racion terminada (0,876 € de escandallo). Buscando «patatas» salen
// las dos, y elegir la primera con cantidad 1 da un coste absurdo.
const PATATAS_BASTON = ficha('Patatas Bastón', 'raw')
const PATATAS_MERAKI = ficha('Patatas Clásicas Meraki', 'dish')
const CATALOGO: CatalogPick[] = [
  PATATAS_BASTON,
  PATATAS_MERAKI,
  ficha('Patatas Fritas Ración Grande', 'dish'),
  ficha('Salsa Sweet Chilli', 'raw'),
  ficha('Caja Burger Kraft', 'packaging', false),
  ficha('Termómetro de sonda', 'tool', false),
  ficha('Salsa Brava Retirada', 'raw', false),
]

describe('kindOf — en lenguaje de cocina, sin jerga', () => {
  it('un dish es un plato', () => {
    expect(kindOf('dish')).toBe('plato')
  })
  it('todo lo demas es ingrediente', () => {
    for (const t of ['raw', 'recipe', 'packaging', 'tool'] as const) {
      expect(kindOf(t)).toBe('ingrediente')
    }
  })
})

describe('normName — la regla con la que se decide «esto ya existe»', () => {
  it('ignora mayusculas, acentos y espacios de sobra', () => {
    expect(normName('  Patatas   CLÁSICAS meraki ')).toBe(normName('Patatas Clásicas Meraki'))
  })
  it('no confunde dos nombres distintos', () => {
    expect(normName('Patatas Bastón')).not.toBe(normName('Patatas Clásicas Meraki'))
  })
})

describe('grupoPidePlato — solo decide el ORDEN, nunca que filas existen', () => {
  // Nombres REALES de grupos de la cuenta que piden un plato entero.
  it.each([
    '¿Quieres acompañar con unas patatas?',
    'Te atreves con unas patatas?',
    'Escoge tu entrante',
    '¿Quieres añadir un postre?.',
    'Y una bebida?',
    'Escoge tu primer kebab',
    'Busca la Burger de tu Combo',
    'Elige tu bocadillo',
    'Incluye tus Hamburguesas',
  ])('«%s» pide un plato', (g) => {
    expect(grupoPidePlato(g)).toBe(true)
  })

  // Nombres REALES de grupos que piden un ajuste sobre la receta. Los cinco
  // ultimos son los que obligaron al veto: nombran el plato solo para decir que
  // PARTE de el se elige. Sin veto se leian como «trae un plato entero».
  it.each([
    'Extra Salsa ',
    '¿Quieres pepinillos?',
    'Milanesa Haus, elige tus 3 Toppings.**',
    'Elige la proteína.',
    'Elige los ingredientes para tu Burrito/Bowl',
    'Escoge la base de tu bocata',
    '1. Escoge la salsa para tu primer kebab',
    '1. Elige el tipo de carne de tu primer Kebab',
    'Escoge el tipo de milanesa para tu bocadillo',
    'Escoge la salsa de tu entrante',
    'Extras (burger)',
    '¿Quieres quitar los pepinillos de tu Burger?',
    'Como quieres tu primera burger',
    'Escoge Tu Proteina Burrito - Dos Coyotes**',
    '¿Quieres dos discos de carne o solo uno?',
  ])('«%s» no pide un plato', (g) => {
    expect(grupoPidePlato(g)).toBe(false)
  })

  it('sin nombre de grupo, no asume nada', () => {
    expect(grupoPidePlato(null)).toBe(false)
    expect(grupoPidePlato('')).toBe(false)
  })
})

describe('ordenaCandidatas — el caso exacto de Julio', () => {
  it('«Patatas Clásicas» encuentra la ficha que existe, y es un plato', () => {
    const r = ordenaCandidatas(CATALOGO, 'Patatas Clásicas', true)
    expect(r.map((x) => x.name)).toEqual(['Patatas Clásicas Meraki'])
    expect(r[0].kind).toBe('plato')
  })

  it('sin acentos tambien la encuentra', () => {
    expect(ordenaCandidatas(CATALOGO, 'patatas clasicas', true)[0]).toBe(PATATAS_MERAKI)
  })

  it('«patatas» saca las dos, y NINGUNA desaparece', () => {
    const r = ordenaCandidatas(CATALOGO, 'patatas', true)
    expect(r).toContain(PATATAS_BASTON)
    expect(r).toContain(PATATAS_MERAKI)
  })

  it('si el grupo pide un acompanamiento, los platos van primero', () => {
    const r = ordenaCandidatas(CATALOGO, 'patatas', true)
    expect(r[0].kind).toBe('plato')
    expect(r[r.length - 1]).toBe(PATATAS_BASTON)
  })

  // La correccion no puede estrechar lo que ya iba bien: en un grupo de ajuste
  // («Extra Salsa») el ingrediente sigue saliendo el primero, como hasta hoy.
  it('si el grupo pide un ajuste, los ingredientes van primero', () => {
    const r = ordenaCandidatas(CATALOGO, 'patatas', false)
    expect(r[0]).toBe(PATATAS_BASTON)
    expect(r).toContain(PATATAS_MERAKI)
  })

  it('no ofrece lo que no se puede elegir: eso se filtra antes de llegar aqui', () => {
    const elegibles = CATALOGO.filter((c) => c.selectable)
    const r = ordenaCandidatas(elegibles, '', true)
    expect(r.map((x) => x.name)).not.toContain('Caja Burger Kraft')
    expect(r.map((x) => x.name)).not.toContain('Termómetro de sonda')
    expect(r.map((x) => x.name)).not.toContain('Salsa Brava Retirada')
  })
})

describe('razonNoElegible — un «no se crea» sin motivo es un boton que calla', () => {
  it('dice que es un envase', () => {
    expect(razonNoElegible(ficha('Caja Burger Kraft', 'packaging', false))).toContain('envase')
  })
  it('dice que es un utensilio', () => {
    expect(razonNoElegible(ficha('Termómetro de sonda', 'tool', false))).toContain('utensilio')
  })
  it('dice que esta retirada cuando el tipo si valdria', () => {
    expect(razonNoElegible(ficha('Salsa Brava Retirada', 'raw', false))).toContain('retirada')
  })
})

// LA GUARDA DEL «CREAR COMO NUEVO». Se compara contra el catalogo ENTERO, no
// contra lo que el desplegable enseña: esa es justo la trampa que se cierra.
describe('la guarda anti-duplicado mira el catalogo entero', () => {
  const yaExiste = (search: string) =>
    search.trim() === '' ? undefined : CATALOGO.find((i) => normName(i.name) === normName(search))

  it('«Patatas Clásicas Meraki» NO se crea: ya existe y se puede elegir', () => {
    const e = yaExiste('Patatas Clásicas Meraki')
    expect(e).toBe(PATATAS_MERAKI)
    expect(e!.selectable).toBe(true)
  })

  it('tampoco escrita de otra forma', () => {
    expect(yaExiste('  patatas   clasicas MERAKI ')).toBe(PATATAS_MERAKI)
  })

  it('un envase existente tambien frena el crear, aunque no se pueda elegir', () => {
    const e = yaExiste('Caja Burger Kraft')
    expect(e).toBeDefined()
    expect(e!.selectable).toBe(false)
  })

  it('un nombre que de verdad no existe si deja crear', () => {
    expect(yaExiste('Salsa Que No Existe')).toBeUndefined()
  })
})
