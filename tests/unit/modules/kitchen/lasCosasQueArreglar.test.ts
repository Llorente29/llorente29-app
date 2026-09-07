import { describe, it, expect } from 'vitest'
import {
  pintaCosa, estaPendiente, cuantasResueltas, rutaDe, RUTAS_DE_KITCHEN,
  type CosaMedida, type ClaveDeCosa,
  loQueNoCambiaConElLocal, eurDeCocina, pctEnteroDeCocina, lasQueMasPesan,
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
    accion: 'Casar o crear la ficha',
    // Las de verdad, medidas el 06/09: Chivuos es la que más tiene, y es la que
    // el botón debe abrir.
    peores: [
      { brandId: 'chivuos', marca: 'Chivuos', n: 17, de: 45 },
      { brandId: 'bigmike', marca: 'Big Mike´s Burger Joint', n: 14, de: 49 },
      { brandId: 'urban', marca: 'The Urban Kebab', n: 12, de: 29 },
    ] }),
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
    // B83: lleva la marca que la propia fila nombra la primera.
    expect(destino('platos_en_carta_sin_coste')).toBe('casado?marca=chivuos')
    expect(rutaDe(destino('platos_en_carta_sin_coste'))).toBe('casado')
    expect(destino('platos_en_carta_sin_envase')).toBe('recetas')
    expect(destino('extras_que_cobran_sin_coste')).toBe('menu')
    expect(destino('ingredientes_sin_precio')).toBe('')
    // El ancla lleva al campo, no al principio de una pantalla con tres secciones.
    expect(destino('sin_objetivo_de_comida')).toBe('ajustes#objetivo-de-comida')
  })

  it('sin marcas en «peores», el botón abre Casado a secas y no «casado?marca=»', () => {
    const p = pintaCosa(C('platos_en_carta_sin_coste', { n: 3, de: 558, sinFicha: 3, peores: [] }), null)
    expect(p.destino).toBe('casado')
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


// ── B83 ─────────────────────────────────────────────────────────────────────
// En pantalla de cliente no se enseña un identificador interno, ni un nombre de
// columna, ni un trozo de SQL. El 06/09 el Resumen pintaba «price_impact > 0» y
// «menu_item.recipe_item_id IS NULL» en cursiva debajo de cada fila.

// Cada patrón, con el caso real que lo delató. Fuera del `describe` porque lo
// usan dos barridas: la de los casos de arriba y la de la población real.
const PROHIBIDO: Array<[RegExp, string]> = [
  [/\b(IS NULL|IS NOT NULL|IS NOT FALSE)\b/i, 'SQL suelto'],
  [/\b\w+\.\w+_(id|pct|cost|at)\b/, 'tabla.columna (menu_item.recipe_item_id)'],
  [/\b(price_impact|packaging_cost|computed_cost|fixed_cost|target_food_cost_pct|recipe_item_id|order_status|archived_at|is_active)\b/, 'nombre de columna'],
  [/\b(SELECT|WHERE|JOIN|COALESCE|NULL)\b/, 'palabra de SQL'],
]

describe('ni un identificador en lo que se pinta', () => {
  // Lo que se pinta de cada fila: título, motivo y botón. La `definicion` viene
  // de la base ya en castellano; `reglaTecnica` viaja pero no se pinta.
  // Todo lo que la fila enseña: título, motivo, «las que más», la definición en
  // cursiva y el botón. La `definicion` ENTRA aquí a propósito: era justo el
  // trozo que se coló en producción, y una barrida que no mire el campo que se
  // rompió no protege de nada.
  const LOQUESEPINTA = (c: CosaMedida) => {
    const p = pintaCosa(c, 2707)
    const lasQueMas = c.peores.slice(0, 3).map((x) => `${x.marca} ${x.n} de ${x.de}`).join(' · ')
    return `${p.titulo} ${p.motivo} ${lasQueMas} ${c.definicion} ${p.boton}`
  }

  for (const c of REALES) {
    it(`«${c.clave}» no pinta identificadores`, () => {
      const texto = LOQUESEPINTA(c)
      for (const [re, que] of PROHIBIDO) {
        expect(re.test(texto), `${c.clave} pinta ${que}: «${texto}»`).toBe(false)
      }
    })
  }

  it('la regla técnica no se cuela en el texto pintado ni cuando existe', () => {
    const conTecnica: CosaMedida = {
      ...REALES[0],
      reglaTecnica: 'modifier_option activa con price_impact > 0 y sus impactos confirmed a 0.',
    }
    expect(LOQUESEPINTA(conTecnica)).not.toContain('price_impact')
    expect(LOQUESEPINTA(conTecnica)).not.toContain('modifier_option')
  })
})

// ── B83 · la barrida contra la POBLACIÓN REAL ───────────────────────────────
// Las seis de arriba usan la `definicion` de mentira del ayudante `C`, que la
// escribí yo: contra eso la barrida es un espejo (regla 31). Estas seis son las
// que devuelve producción hoy, copiadas literales de `prosrc` de
// `kitchen_catalog_gaps` después de aplicar `20260906220851`.

/** Lo que SE PINTA. Castellano de persona. */
const DEFINICIONES_DE_PRODUCCION: string[] = [
  'Un plato está «en carta» si está activo y no se ha retirado del catálogo.',
  'Un extra que el cliente paga aparte y que, sumado lo que lleva, no añade ni un céntimo de coste. Cuenta también el que no tiene nada puesto.',
  'Un plato de la carta del que Folvy no sabe lo que cuesta: o no tiene ficha de escandallo enlazada, o la tiene sin terminar.',
  'Un plato cuya ficha tiene el envase a cero, así que su coste no incluye lo que cuesta servirlo.',
  'Un ingrediente en uso al que no se le ha puesto ningún precio, ni a mano ni por compras.',
  'La cuenta no tiene un objetivo de comida sobre ventas al que apuntar, así que ninguna cifra puede llamarse buena ni mala.',
]

/** Lo que VIAJA y no se pinta. Es la que llevaba las columnas. */
const REGLAS_TECNICAS_DE_PRODUCCION: string[] = [
  'menu_item de la cuenta con is_active IS NOT FALSE y archived_at IS NULL.',
  'modifier_option activa con price_impact > 0 cuyos modifier_recipe_impact en estado confirmed suman 0, incluidas las que no tienen ninguno. Misma consulta que el vigía modifier_zero_cost_watchdog.',
  'menu_item en carta con recipe_item_id IS NULL, o con ficha cuyo recipe_item.computed_cost IS NULL. Con coste = computed_cost IS NOT NULL.',
  'menu_item en carta cuya recipe_item.packaging_cost es NULL o 0.',
  'recipe_item de tipo raw, activo y sin archivar, con fixed_cost y computed_cost ambos nulos o cero.',
  'kitchen_settings.target_food_cost_pct inexistente o NULL para la cuenta.',
]

describe('las definiciones que hoy devuelve producción', () => {
  for (const d of DEFINICIONES_DE_PRODUCCION) {
    it(`«${d.slice(0, 44)}…» está limpia`, () => {
      for (const [re, que] of PROHIBIDO) {
        expect(re.test(d), `pinta ${que}: «${d}»`).toBe(false)
      }
    })
  }

  // Una barrida que nunca salta no demuestra nada. Estas seis SÍ tienen que
  // saltar: son las que se pintaban el 06/09. Si dejaran de saltar, es la
  // barrida la que se ha roto, no el texto el que ha mejorado.
  it('la barrida SÍ salta con las reglas técnicas de producción', () => {
    for (const r of REGLAS_TECNICAS_DE_PRODUCCION) {
      expect(PROHIBIDO.some(([re]) => re.test(r)), `no salta con: «${r}»`).toBe(true)
    }
  })

  // El fallo del 06/09, reconstruido: la `definicion` traía la regla técnica.
  // Si la barrida no salta con esto, no habría cazado el incidente que existe.
  it('con la definición VIEJA (la técnica) la barrida salta en la fila entera', () => {
    const comoEstaba: CosaMedida = {
      ...REALES[1],
      definicion: REGLAS_TECNICAS_DE_PRODUCCION[2],
    }
    const p = pintaCosa(comoEstaba, 2707)
    const lasQueMas = comoEstaba.peores.slice(0, 3).map((x) => `${x.marca} ${x.n} de ${x.de}`).join(' · ')
    const fila = `${p.titulo} ${p.motivo} ${lasQueMas} ${comoEstaba.definicion} ${p.boton}`
    expect(PROHIBIDO.some(([re]) => re.test(fila))).toBe(true)
  })

  it('cada definición trae su regla técnica: son seis y seis', () => {
    expect(DEFINICIONES_DE_PRODUCCION).toHaveLength(6)
    expect(REGLAS_TECNICAS_DE_PRODUCCION).toHaveLength(6)
  })
})

// ── B83 · un filtro que no afecta a una cifra lo dice ──────────────────────
// Condición de Julio al aprobar el selector de local: lo que no depende del
// local no cambia al elegirlo Y LO DICE. Sin eso, elegir Alcalá y ver el mismo
// «422 de 551» parece un filtro roto — y quien lo crea roto dejará de fiarse
// también de las cifras que sí han cambiado. Medido antes de construirlo:
// Alcalá 46.192 € y Carabanchel 26.629 € sobre 72.821 € (suman exacto), así que
// las de VENTAS sí se mueven y sólo las de CATÁLOGO se quedan igual.
describe('lo que no cambia al elegir un local', () => {
  it('con un local elegido, lo dice', () => {
    expect(loQueNoCambiaConElLocal('38158159-cd71-4056-950b-53425afac1ce')).toBe(' · toda la cuenta')
  })
  it('sin local no dice nada: en «Todos» la coletilla sería ruido', () => {
    expect(loQueNoCambiaConElLocal('')).toBe('')
    expect(loQueNoCambiaConElLocal(null)).toBe('')
    expect(loQueNoCambiaConElLocal(undefined)).toBe('')
  })
})

// ── B83 · los euros de Kitchen agrupan siempre ────────────────────────────
// `toLocaleString('es-ES')` NO agrupa los números de cuatro cifras, así que en
// la misma columna salía «7181 €» junto a «14.473 €». Medido, no supuesto.
describe('los euros del módulo', () => {
  it('agrupa también las cuatro cifras, que es donde falla el formato común', () => {
    expect(eurDeCocina(7181)).toBe('7.181 €')
    expect(eurDeCocina(14473)).toBe('14.473 €')
    expect(eurDeCocina(699)).toBe('699 €')
  })
  it('sin dato, una raya: no un cero que parezca una medida', () => {
    expect(eurDeCocina(null)).toBe('—')
    expect(eurDeCocina(undefined)).toBe('—')
  })
  // La cobertura va entera: un decimal ahí no dice nada que el entero no diga.
  it('la cobertura se redondea a entero, como el tablero', () => {
    expect(pctEnteroDeCocina(96.2)).toBe('96 %')
    expect(pctEnteroDeCocina(59.4)).toBe('59 %')
    expect(pctEnteroDeCocina(null)).toBe('—')
  })
})

// ── B83 · «y 1 marcas más» ────────────────────────────────────────────────
// La frase estaba escrita dos veces —pantalla y captura— y las dos concordaban
// mal. Es lo que pasa con el texto duplicado: se arregla en un sitio y sigue mal
// en el otro. Los datos son los de hoy: 11 marcas con extras sin coste.
describe('las marcas que más pesan', () => {
  const ONCE = [
    { marca: 'The Urban Kebab', n: 18, de: 27 },
    { marca: 'Scandal Burgers', n: 16, de: 17 },
    { marca: 'Big Mike´s Burger Joint', n: 12, de: 14 },
    { marca: 'Milanesa Haus', n: 8, de: 8 },
  ]
  it('con más de tres, dice cuántas quedan y CONCUERDA', () => {
    expect(lasQueMasPesan(ONCE)).toBe(
      'The Urban Kebab 18 de 27 · Scandal Burgers 16 de 17 · Big Mike´s Burger Joint 12 de 14 · y 1 marca más',
    )
  })
  it('con cuatro que sobran, plural', () => {
    expect(lasQueMasPesan([...ONCE, ...ONCE])).toContain('y 5 marcas más')
  })
  it('con tres o menos, no añade coletilla', () => {
    expect(lasQueMasPesan(ONCE.slice(0, 3))).not.toContain('más')
  })
  it('sin ninguna, no hay frase que pintar', () => {
    expect(lasQueMasPesan([])).toBeNull()
  })
})
