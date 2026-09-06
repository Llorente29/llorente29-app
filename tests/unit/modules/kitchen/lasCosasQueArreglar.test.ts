import { describe, it, expect } from 'vitest'
import {
  pintaCosa, estaPendiente, cuantasResueltas, rutaDe, RUTAS_DE_KITCHEN,
  type CosaMedida, type ClaveDeCosa,
} from '@/modules/kitchen/lib/lasCosasQueArreglar'

// B79 · lote 4. LAS CINCO COSAS DEL RESUMEN: que cada botón tenga destino, y que
// ninguna frase afirme algo que el contador no haya medido.
//
// Los números de abajo son los REALES de Foodint del 06/09/2026, medidos contra
// producción antes de escribir la pantalla — no inventados. Si se escribieran de
// la cabeza, la prueba sería un espejo de lo que ya creo (regla 31).

const C = (clave: ClaveDeCosa, o: Partial<CosaMedida> = {}): CosaMedida => ({
  clave, orden: 1, n: 1, de: 10,
  definicion: 'definición que da la base',
  porQueAqui: 'por qué está aquí',
  accion: 'Hacer algo',
  peores: [],
  ...o,
})

/** La población real del día que se construyó la pantalla. */
const REALES: CosaMedida[] = [
  C('extras_que_cobran_sin_coste', { orden: 1, n: 100, de: 120, venden: 35, accion: 'Ponerles coste',
    peores: [
      { brandId: 'a', marca: 'The Urban Kebab', n: 27, de: 27 },
      { brandId: 'b', marca: 'Scandal Burgers', n: 16, de: 17 },
      { brandId: 'c', marca: 'Big Mike´s Burger Joint', n: 14, de: 14 },
      { brandId: 'd', marca: 'Meraki Pita', n: 9, de: 9 },
    ] }),
  C('platos_en_carta_sin_coste', { orden: 2, n: 129, de: 558, sinFicha: 128, conFichaSinCoste: 1,
    accion: 'Casar o crear la ficha' }),
  C('platos_en_carta_sin_envase', { orden: 3, n: 314, de: 558, accion: 'Poner envase' }),
  C('sin_objetivo_de_comida', { orden: 4, n: 1, de: 1, platosConObjetivoPropio: 8,
    hayFilaDeAjustes: true, accion: 'Poner objetivo' }),
  C('ingredientes_sin_precio', { orden: 5, n: 23, de: 133, usadosEnLineasDeReceta: 0,
    accion: 'Poner precios' }),
]

describe('ningún botón sin destino que exista hoy', () => {
  it('los cinco destinos son rutas reales del módulo', () => {
    for (const c of REALES) {
      const p = pintaCosa(c, 2707)
      expect(RUTAS_DE_KITCHEN, `destino de ${c.clave}`).toContain(rutaDe(p.destino))
    }
  })

  it('cada cosa manda a la pantalla que hace ESO, no a una lista cualquiera', () => {
    const destino = (k: ClaveDeCosa) =>
      pintaCosa(REALES.find((c) => c.clave === k)!, 2707).destino
    // Casado es la pantalla que enlaza un producto de carta con su ficha: es el
    // sitio de los 128 sin ficha, no «Completar» en una lista de platos.
    expect(destino('platos_en_carta_sin_coste')).toBe('casado')
    expect(destino('platos_en_carta_sin_envase')).toBe('recetas')
    expect(destino('extras_que_cobran_sin_coste')).toBe('menu')
    expect(destino('ingredientes_sin_precio')).toBe('')
    // El ancla lleva al campo, no al principio de una pantalla con tres secciones.
    expect(destino('sin_objetivo_de_comida')).toBe('ajustes#objetivo-de-comida')
  })

  it('ningún botón se queda sin texto', () => {
    for (const c of REALES) expect(pintaCosa(c, null).boton.length).toBeGreaterThan(0)
  })
})

describe('las frases dicen lo que se ha medido, y ni una palabra más', () => {
  // El caso que costó una corrección: la maqueta decía «por ellos, 16 recetas no
  // cierran su coste» y esas 16 no existen — los 23 no están en ninguna receta.
  it('si los ingredientes no están en ninguna receta, se dice que hoy no bloquean nada', () => {
    const p = pintaCosa(REALES.find((c) => c.clave === 'ingredientes_sin_precio')!, null)
    expect(p.motivo).toContain('no bloquean ningún coste')
    expect(p.motivo).not.toMatch(/\d+ recetas no cierran/)
  })

  it('si SÍ están en recetas, se dice en cuántas líneas y no se dice que no bloquean', () => {
    const p = pintaCosa(C('ingredientes_sin_precio', { n: 23, de: 133, usadosEnLineasDeReceta: 7 }), null)
    expect(p.motivo).toContain('7 líneas de receta')
    expect(p.motivo).not.toContain('no bloquean')
  })

  // 128 de los 129 no tienen ficha: la acción es enlazarla, no «poner coste».
  it('los platos sin coste se cuentan desglosados, porque la acción depende de eso', () => {
    const p = pintaCosa(REALES.find((c) => c.clave === 'platos_en_carta_sin_coste')!, null)
    expect(p.titulo).toBe('129 platos sin ficha de coste')
    expect(p.motivo).toContain('128 sin ficha enlazada')
    expect(p.motivo).toContain('1 con ficha sin cerrar')
  })

  it('cuando todos tienen ficha enlazada, no se inventa la frase de los que no', () => {
    const p = pintaCosa(C('platos_en_carta_sin_coste', { n: 3, de: 558, sinFicha: 0, conFichaSinCoste: 3 }), null)
    expect(p.motivo).toContain('3 con ficha sin cerrar')
    expect(p.motivo).not.toContain('sin ficha enlazada')
  })

  // El envase NO se resta de la cifra grande: son dos varas distintas.
  it('el envase se dice en euros de lo vendido, nunca como puntos del food cost', () => {
    const p = pintaCosa(REALES.find((c) => c.clave === 'platos_en_carta_sin_envase')!, 2707)
    // El separador de millar NO se puede afirmar aquí: este Node no trae ICU
    // completo (`(2707).toLocaleString('es-ES')` da «2707» y resuelve a en-US),
    // así que en la prueba sale sin punto y en el navegador con él. Se afirma lo
    // que es cierto en los dos sitios: el número, y que va en euros.
    expect(p.motivo).toMatch(/2\.?707 €/)
    expect(p.motivo).toContain('los 244 que sí lo tienen')
    expect(p.motivo).not.toContain('puntos')
  })

  it('sin dato de envase no se inventa un euro: se cuenta cuántos lo tienen', () => {
    const p = pintaCosa(REALES.find((c) => c.clave === 'platos_en_carta_sin_envase')!, null)
    expect(p.motivo).toContain('244 de 558')
    expect(p.motivo).not.toContain('€')
  })

  it('el objetivo dice cuántos platos tienen el suyo, para no dar a entender que manda el de la cuenta', () => {
    const p = pintaCosa(REALES.find((c) => c.clave === 'sin_objetivo_de_comida')!, null)
    expect(p.motivo).toContain('8 platos tienen su objetivo')
    expect(p.motivo).toContain('el de la cuenta, que no está puesto')
  })

  it('sin ningún objetivo propio, la frase no menciona platos que no existen', () => {
    const p = pintaCosa(C('sin_objetivo_de_comida', { platosConObjetivoPropio: 0 }), null)
    expect(p.motivo).toContain('La cuenta no tiene objetivo puesto')
    expect(p.motivo).not.toMatch(/\d+ platos tienen/)
  })

  it('los extras dicen cuántos VENDEN, que es lo que sale por caja hoy', () => {
    const p = pintaCosa(REALES.find((c) => c.clave === 'extras_que_cobran_sin_coste')!, null)
    expect(p.titulo).toBe('100 extras que cobran sin coste')
    expect(p.motivo).toContain('35 se han vendido')
    expect(p.motivo).toContain('De 120 opciones que cobran')
  })
})

describe('el filtro ordena y etiqueta, nunca decide qué existe (regla 7)', () => {
  it('una cosa está pendiente sólo si su contador es mayor que cero', () => {
    expect(estaPendiente(C('platos_en_carta_sin_envase', { n: 0 }))).toBe(false)
    expect(estaPendiente(C('platos_en_carta_sin_envase', { n: 1 }))).toBe(true)
  })

  // La pantalla necesita este número para poder decir «y además hay N resueltas»
  // en vez de esconderlas sin más.
  it('se puede saber cuántas quedan fuera del filtro', () => {
    const mezcla = [...REALES, C('platos_en_carta_sin_envase', { n: 0 })]
    expect(cuantasResueltas(mezcla)).toBe(1)
    expect(cuantasResueltas(REALES)).toBe(0)
  })
})

describe('el singular y el plural se cuidan, que es lo que separa una pantalla de un volcado', () => {
  it('uno solo no dice «1 platos»', () => {
    expect(pintaCosa(C('platos_en_carta_sin_coste', { n: 1, de: 558, sinFicha: 1, conFichaSinCoste: 0 }), null).titulo)
      .toBe('1 plato sin ficha de coste')
    expect(pintaCosa(C('ingredientes_sin_precio', { n: 1, usadosEnLineasDeReceta: 0 }), null).titulo)
      .toBe('1 ingrediente sin precio')
    expect(pintaCosa(C('extras_que_cobran_sin_coste', { n: 1, de: 5, venden: 1 }), null).titulo)
      .toBe('1 extra que cobra sin coste')
  })

  it('un solo extra vendido dice «se ha vendido», no «se han vendido»', () => {
    expect(pintaCosa(C('extras_que_cobran_sin_coste', { n: 1, de: 5, venden: 1 }), null).motivo)
      .toContain('1 se ha vendido')
  })
})
