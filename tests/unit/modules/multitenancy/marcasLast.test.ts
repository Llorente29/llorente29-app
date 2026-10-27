// tests/unit/modules/multitenancy/marcasLast.test.ts
//
// F01 · Las frases de las marcas de Last (tableros 1 y 2), con lo que devuelve
// la base para El Delicioso y Van Van (regla 31: los nombres y las cifras de
// la medición del 27/10, no inventados).

import { describe, expect, it } from 'vitest'
import {
  avisoMarca, claveMarca, deClave, enumerar, fraseHecho, fraseNoLaUso, fraseOculta, iniciales, leerAlta, leerMarcas, lineasCarta,
  localCorto, ocultas, pendientes,
} from '@/modules/multitenancy/lib/marcasLast'

const deLaBase = [
  {
    org: 'b7bc4753-575c-42e1-bf97-ed61443f639b', cuenta_last: 'Cloudtown', nombre: 'El Delicioso Latin Food', estado: 'sin_vincular',
    brand_id: '167357f0-1783-4508-bdb6-054476014ccf', marca_folvy: 'El Delicioso Latin Food',
    locales: [{ id: 'c', nombre: 'Foodint Carabanchel' }, { id: 'a', nombre: 'Foodint Alcalá' }],
    canales: ['glovo', 'uber'], platos: 18, ventas: 0,
    propuesta: { propia: false, socio: 'CLOUDTOWN BRANDS SL', socio_marcas: 8 },
  },
  {
    org: 'b7bc4753-575c-42e1-bf97-ed61443f639b', cuenta_last: 'Cloudtown', nombre: 'Van Van', estado: 'nueva', brand_id: null, marca_folvy: null,
    locales: [{ id: 'a', nombre: 'Foodint Alcalá' }], canales: ['uber', 'glovo'], platos: 18, ventas: 0,
    propuesta: { propia: false, socio: 'CLOUDTOWN BRANDS SL', socio_marcas: 8 },
  },
  {
    org: 'b7bc4753-575c-42e1-bf97-ed61443f639b', cuenta_last: 'Cloudtown', nombre: 'Big Mike´s Burger Joint', estado: 'vinculada',
    brand_id: 'x', marca_folvy: 'Big Mike´s Burger Joint', locales: [], canales: [], platos: 60, ventas: 1200,
    propuesta: { propia: false, socio: null, socio_marcas: 0 },
  },
]

describe('las marcas de Last que piden alta', () => {
  const m = leerMarcas(deLaBase)
  it('pendientes: las nuevas y las sin vincular, nunca las vinculadas', () => {
    expect(pendientes(m).map((x) => x.nombre)).toEqual(['El Delicioso Latin Food', 'Van Van'])
  })
  it('el aviso de Inicio dice dónde, con qué plataformas, cuántos platos y si ha vendido (tablero 1)', () => {
    expect(avisoMarca(m[0])).toEqual({
      titulo: 'Marca nueva: El Delicioso Latin Food',
      detalle: 'Ha aparecido en Last, en Alcalá y Carabanchel, con Uber Eats y Glovo. 18 platos. Todavía no ha vendido.',
      chip: 'Sin dar de alta',
      chipTono: 'aviso',
    })
    expect(avisoMarca({ ...m[1], ventas: 1, platos: 1 }).detalle)
      .toBe('Ha aparecido en Last, en Alcalá, con Uber Eats y Glovo. 1 plato. Ya lleva 1 venta.')
  })
  it('las iniciales del icono', () => {
    expect(iniciales('El Delicioso Latin Food')).toBe('ED')
    expect(iniciales('Van Van')).toBe('VV')
    expect(iniciales('Big Mike´s Burger Joint')).toBe('BM')
    expect(iniciales('Koreans do it better - Fried Chicken')).toBe('KF')
  })
  it('los locales sin el nombre de la cuenta delante, y en buena lista', () => {
    expect(localCorto('Foodint Plaza Castilla')).toBe('Plaza Castilla')
    expect(localCorto('Norte Centro')).toBe('Norte Centro')
    expect(enumerar(['Alcalá', 'Carabanchel', 'Plaza Castilla'])).toBe('Alcalá, Carabanchel y Plaza Castilla')
  })
  it('la clave del aviso a la pantalla, ida y vuelta (con «:» en el nombre)', () => {
    expect(deClave(claveMarca({ org: 'o-1', nombre: 'Pizza: la buena' }))).toEqual({ org: 'o-1', nombre: 'Pizza: la buena' })
    expect(deClave(null)).toBeNull()
  })
})

// Lo que devuelve f01_alta_marca para El Delicioso en la unitaria de la base.
const alta = leerAlta({
  brand_id: '167357f0-1783-4508-bdb6-054476014ccf', nombre: 'El Delicioso Latin Food', nueva: false, propia: false,
  socio: 'CLOUDTOWN BRANDS SL', ensayo: false,
  locales: [{ id: 'a', nombre: 'Foodint Alcalá' }, { id: 'c', nombre: 'Foodint Carabanchel' }],
  canales: [{ id: 'g', slug: 'glovo', nombre: 'Glovo' }, { id: 'u', slug: 'uber', nombre: 'Uber' }],
  vinculos_nuevos: 0,
  carta: {
    matriculas: 19, platos: 18, ya_estaban: 9, creados: 10, enlazados: 9,
    juntados: [{ plato: 'CACHAPA QUESUDA DL', con: 'CACHAPA QUESUDA (DL)' }],
    del_almacen: ['Agua pet.', 'Cheesecake De Nutella', 'Coca Cola', 'Coca Cola Zero.', 'Fanta Limón.', 'Fanta Naranja.',
      'Marquesa de Choco-Avellanas', 'Marquesa de Dulce de Leche', 'Nestea Limón', 'Tres Leches'],
    con_receta: 0, sin_receta: 8, precios_por_plataforma: 0, archivadas: [],
  },
  ventas: { colocadas: 0, fallidas: 0, antes_del_recuento: 0, corte: '2026-10-27T11:20:57Z' },
})

describe('«No la uso», las ocultas y las que tienen pinta de cancelada (Respuesta 1)', () => {
  const vieja = { ...deLaBase[1], nombre: 'Van Van', apagada: true, ultima_venta: '2026-08-12T21:40:00Z' }
  const nunca = { ...deLaBase[1], nombre: 'Marca Vieja', apagada: true, ultima_venta: null }
  const oculta = { ...deLaBase[1], nombre: 'Van Van', estado: 'oculta', oculta_el: '2026-10-27T16:40:00Z', oculta_por: 'Julio' }
  it('las de pinta de cancelada van abajo, con «Sin ventas desde …» sin destacar', () => {
    const m = leerMarcas([vieja, deLaBase[0]])
    expect(pendientes(m).map((x) => x.nombre)).toEqual(['El Delicioso Latin Food', 'Van Van'])
    expect(avisoMarca(m[0])).toEqual(expect.objectContaining({ chip: 'Sin ventas desde 12/08/2026', chipTono: 'suave' }))
    expect(avisoMarca(leerMarcas([nunca])[0]).chip).toBe('Sin ventas registradas')
    expect(avisoMarca(m[1])).toEqual(expect.objectContaining({ chip: 'Sin dar de alta', chipTono: 'aviso' }))
  })
  it('una oculta no está pendiente: está en Ocultas, con quién y cuándo', () => {
    const m = leerMarcas([oculta, deLaBase[0]])
    expect(pendientes(m).map((x) => x.nombre)).toEqual(['El Delicioso Latin Food'])
    expect(ocultas(m).map((x) => x.nombre)).toEqual(['Van Van'])
    expect(fraseOculta(ocultas(m)[0])).toBe('Oculta por Julio el 27/10/2026')
  })
  it('la confirmación, en una línea', () => {
    expect(fraseNoLaUso('Van Van')).toBe('Van Van no volverá a avisar. Puedes recuperarla en Marcas › Ocultas.')
  })
})

describe('el panel del alta (tablero 2) y su confirmación', () => {
  it('la carta, en líneas de cocina', () => {
    const l = lineasCarta(alta.carta!, ['uber', 'glovo'])
    expect(l[0]).toEqual({ tono: 'ok', fuerte: '18 platos.', resto: ' Uber Eats y Glovo tienen la misma carta: queda una sola, con el precio de cada plataforma.' })
    expect(l[1]).toEqual({ tono: 'ok', fuerte: '«CACHAPA QUESUDA (DL)» y «CACHAPA QUESUDA DL»', resto: ' son el mismo plato con dos nombres: se juntan en uno.' })
    expect(l[2].fuerte).toBe('10 productos que ya tienes en el almacén')
    expect(l[3]).toEqual({ tono: 'aviso', fuerte: '8 platos sin receta.', resto: ' Se venden igual; lo vendido descuenta almacén cuando pongas la receta.' })
    expect(l).toHaveLength(4)
  })
  it('las plataformas en su orden: Uber Eats antes que Glovo', () => {
    expect(alta.canales.map((c) => c.nombre)).toEqual(['Uber Eats', 'Glovo'])
  })
  it('la confirmación dice lo que ha hecho (regla 8)', () => {
    expect(fraseHecho(alta)).toBe('Dada de alta El Delicioso Latin Food: 2 locales, 18 platos. Faltan 8 recetas.')
    const conVentas = { ...alta, ventas: { colocadas: 3, fallidas: 0, antesDelRecuento: 1, corte: null } }
    expect(fraseHecho(conVentas)).toBe('Dada de alta El Delicioso Latin Food: 2 locales, 18 platos. Faltan 8 recetas. 3 ventas colocadas. 1 venta es de antes del último recuento cerrado y no se toca.')
  })
})
