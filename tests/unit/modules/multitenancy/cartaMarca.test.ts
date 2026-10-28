// tests/unit/modules/multitenancy/cartaMarca.test.ts
//
// F01 · PR 3 · Lo que dicen la pestaña Carta (tablero 3) y Marcas › Revisar
// (tablero 4), con los datos como los devuelve la base (f01_carta_marca y
// f01_marcas_por_revisar) y los nombres de El Delicioso de producción.

import { describe, expect, it } from 'vitest'
import {
  chipPregunta, fraseColocadas, fraseRecetaGuardada, fraseUnida, leerCarta, leerColocar, leerPorRevisar, pistaPregunta,
  pistaProgreso, platoParaLectura, porcentaje, progreso, resumenFolvy, subtituloMarca, sumarColocar, textoPregunta,
  textoReconocida, textoSinMarca, tituloPregunta,
} from '@/modules/multitenancy/lib/cartaMarca'

const carta = leerCarta({
  marca: { id: 'b', nombre: 'El Delicioso Latin Food', propia: false, socio: 'Cloudtown Brands',
    locales: [{ id: '2', nombre: 'Foodint Carabanchel' }, { id: '1', nombre: 'Foodint Alcalá' }],
    canales: [{ slug: 'glovo', nombre: 'Glovo' }, { slug: 'uber', nombre: 'Uber' }] },
  platos: [
    { id: 'p1', nombre: 'POLLO SABROSÓN (DL)', estado: 'sin_receta', recipe_item_id: 'r1', precios: { uber: 12.9, glovo: 12.9 }, ventas_esperando: 2, ventas_antes_del_recuento: 1 },
    { id: 'p2', nombre: 'CACHAPA QUESUDA (DL)', estado: 'sin_receta', recipe_item_id: null, precios: { uber: 9.9, glovo: 9.9 }, ventas_esperando: 0, ventas_antes_del_recuento: 0 },
    { id: 'p3', nombre: 'Coca Cola', estado: 'almacen', recipe_item_id: 'r3', precios: { uber: 2.5, glovo: 2.5 }, ventas_esperando: 0, ventas_antes_del_recuento: 0 },
  ],
  resumen: { platos: 12, con_receta: 0, sin_receta: 12, almacen: 6 },
  ventas_esperando: 2, ventas_antes_del_recuento: 1, corte: '2026-10-27T11:20:57+00:00', por_colocar: 0, colocadas: [],
})

describe('F01 · PR 3 · la carta de una marca (tablero 3)', () => {
  it('la cabecera, el progreso y la barra, como la maqueta', () => {
    expect(subtituloMarca(carta)).toBe('Cedida por Cloudtown Brands · Alcalá y Carabanchel · Uber Eats y Glovo')
    expect(progreso(carta)).toBe('0 de 12 platos con receta')
    expect(porcentaje(carta)).toBe(0)
    expect(carta.marca.canales.map((c) => c.slug)).toEqual(['uber', 'glovo'])
  })

  it('la pista dice lo del almacén, lo que espera y lo que se queda debajo del recuento', () => {
    expect(pistaProgreso(carta)).toBe('Los 6 artículos del almacén (bebidas y postres) ya están enlazados con tu almacén. '
      + '2 ventas esperan a su receta: descontarán almacén en cuanto la pongas. '
      + '1 venta es de antes del último recuento (27/10/2026): se queda como está.')
  })

  it('la lectura de un fichero va al plato sin receta que se llama igual (o se pregunta)', () => {
    expect(platoParaLectura('Pollo Sabrosón (DL)', carta.platos)?.id).toBe('p1')
    expect(platoParaLectura('Cachapa quesuda', carta.platos)?.id).toBe('p2')
    // Del almacén no se ofrece: no lleva receta.
    expect(platoParaLectura('Coca Cola', carta.platos)).toBeNull()
    expect(platoParaLectura('Arepa reina', carta.platos)).toBeNull()
  })

  it('al guardar una receta, lo colocado se dice (y lo de antes del recuento, y lo que falla)', () => {
    const r = leerColocar({ colocadas: 3, fallidas: 0, antes_del_recuento: 2, corte: '2026-10-27T11:20:57+00:00', quedan: 0 })
    expect(fraseRecetaGuardada('POLLO SABROSÓN (DL)', 5, r)).toBe('Receta de POLLO SABROSÓN (DL) guardada (5 ingredientes). '
      + '3 ventas colocadas y descontadas del almacén. 2 ventas de antes del último recuento (27/10/2026) se quedan como estaban.')
    expect(fraseColocadas(leerColocar({ colocadas: 0, fallidas: 0, antes_del_recuento: 0, quedan: 0 }))).toBe('No había ventas esperando.')
    expect(fraseColocadas(leerColocar({ colocadas: 1, fallidas: 1, antes_del_recuento: 0, quedan: 0 })))
      .toBe('1 venta colocada y descontada del almacén. 1 venta no se ha podido colocar: la pasada de cada hora lo vuelve a decir.')
    // Por tandas: se suman.
    const a = leerColocar({ colocadas: 150, quedan: 1 })
    expect(sumarColocar(a, leerColocar({ colocadas: 20, quedan: 0 }))).toEqual(expect.objectContaining({ colocadas: 170, quedan: 0 }))
  })
})

const revisar = leerPorRevisar({
  preguntas: [{
    org: 'o', nombre: 'Dirty Burgers', cuenta_last: 'Foodint', estado: 'sin_vincular',
    locales: [{ id: '1', nombre: 'Foodint Alcalá' }],
    comparacion: { brand_id: 'db', marca: 'Dirty Burger', platos_last: 31, platos_folvy: 31, con_receta: 31, coinciden: 29, identica: false, parecida: true,
      locales_folvy: [{ id: '1', nombre: 'Foodint Alcalá' }, { id: '2', nombre: 'Foodint Carabanchel' }],
      cartas: { last: [{ nombre: 'Patatas Clásicas', coincide: true }, { nombre: 'Dirty Burger Trufada de Pollo', coincide: true },
        { nombre: 'Dirty Burger Clásica de Pollo', coincide: true }, { nombre: 'The Sticky K-Fingers', coincide: false }, { nombre: 'Otra', coincide: true }],
      folvy: [] } },
    ventas: { despues: 6, antes: 0, corte: '2026-10-27T11:20:57+00:00' },
  }],
  reconocidas: [
    { id: 'r1', como: 'sola', nombre_last: 'Dirty Burgers', brand_id: 'db', marca: 'Dirty Burger', locales: [{ id: '1', nombre: 'Foodint Alcalá' }], ventas: { colocadas: 6, antes_del_recuento: 0, fallidas: 0 } },
    { id: 'r2', como: 'codigo_nuevo', nombre_last: 'El Delicioso Latin Food', brand_id: 'ed', marca: 'El Delicioso Latin Food', locales: [{ id: '2', nombre: 'Foodint Carabanchel' }], ventas: { colocadas: 0 } },
  ],
  sin_marca: [{ codigo: '27d105de-ff99-4723-abfc-9cf5bf2271ce', local: 'Foodint Alcalá', marca_last: null, ventas: 1, primera: '2026-06-14T20:00:00Z', ultima: '2026-06-14T20:00:00Z' }],
})

describe('F01 · PR 3 · Marcas › Revisar (tablero 4)', () => {
  const q = revisar.preguntas[0]
  it('la pregunta, con las dos cartas, como la maqueta', () => {
    expect(chipPregunta(q)).toBe('6 ventas esperando')
    expect(tituloPregunta(q)).toBe('¿Es tu Dirty Burger?')
    expect(textoPregunta(q)).toBe('Llegan pedidos de Alcalá con una marca «Dirty Burgers» que Folvy no conocía. Su carta se parece a la de tu Dirty Burger.')
    expect(resumenFolvy(q.comparacion)).toBe('31 platos, 31 con receta. 29 de 31 coinciden.')
    expect(pistaPregunta(q)).toBe('Al confirmar, las 6 ventas pasan a Dirty Burger y descuentan almacén con sus recetas.')
  })

  it('«Sí, es…» confirma con lo hecho: el toast de la maqueta, y lo que falta si falta', () => {
    const r = leerColocar({ colocadas: 6, fallidas: 0, antes_del_recuento: 0, quedan: 0 })
    expect(fraseUnida('Dirty Burgers', 'Dirty Burger', q.locales, r))
      .toBe('Hecho: Dirty Burgers de Alcalá es tu Dirty Burger. 6 ventas colocadas y descontadas del almacén.')
    expect(fraseUnida('Pollos Nuevos', 'Pollería de Prueba', [{ id: 'x', nombre: 'Norte Mercado' }], leerColocar({ colocadas: 2 }), ['Wrap de Pollo']))
      .toBe('Hecho: Pollos Nuevos de Norte Mercado es tu Pollería de Prueba. 2 ventas colocadas. Falta la receta de Wrap de Pollo: descontará en cuanto la pongas.')
  })

  it('lo que Folvy hizo solo se avisa con lo que hizo', () => {
    expect(textoReconocida(revisar.reconocidas[0]).titulo).toBe('Dirty Burgers en Alcalá: reconocida, 6 ventas colocadas')
    expect(textoReconocida(revisar.reconocidas[1]).titulo).toBe('El Delicioso Latin Food llega a Carabanchel con otro código de Last')
  })

  it('las ventas sin marca no se callan', () => {
    expect(textoSinMarca(revisar.sinMarca[0])).toBe('1 venta sin marca en Alcalá, de un código que Last no tiene en su carta (27d105de…), la última del 14/06/2026.')
  })
})
