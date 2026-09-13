// El tablero 5 (crear una pregunta). Las reglas de qué impide crear y todo el
// castellano, fijados aquí para que se puedan leer y discutir sin abrir React.
//
// LAS FILAS SON REALES: los extras, sus precios y en cuántas preguntas están
// salen de Foodint el 12/09 (regla 31). El caso de «Salsa Harissa» —existe 13
// veces y ninguna dice qué lleva— es el que la maqueta dibuja en ámbar, y es
// el único que bloquea la creación.

import { describe, it, expect } from 'vitest'
import {
  tituloDelTipo, tipoEnLaBase, tituloDelQueLleva, queLlevaEnLaBase, loQueLeFaltaAlEfecto,
  laReglaDeLaPantalla, loQueVeraElCliente, porQueNoSePuedeCrear, sePuedeCrear,
  textoDelBotonCrear, laConfirmacion, ayudaDeLaCategoria, cuentaDePlatos,
  avisoDeParecida, lineaDelExtra, precioEnTexto, LOS_QUE_LLEVA,
  porQueNoSePuedeGuardar, cuantasSinDecidir, laDeudaDeEstaPregunta,
  textoDelBotonGuardar, laConfirmacionAlEditar,
  elContadorDePlatos, marcarLaCategoria, elCambioEnPlatos, laConfirmacionDePlatos,
  laOfertaDeLasIguales, lasQueQuedanFuera, dondeViveLaIgual,
  textoDelBotonDeLasIguales, laConfirmacionDeLasIguales,
  type UnaIgual, type UnaQueQuedaFuera,
  type BorradorDePregunta, type OpcionNueva,
} from '@/modules/kitchen/lib/crearPreguntaDeCocina'

const OP = (o: Partial<OpcionNueva> = {}): OpcionNueva => ({
  extraId: 'x', nombre: 'Opción', precio: 0, queLleva: 'lleva',
  yaEstabaDecidido: true, enCuantasPreguntas: 1, queLlevaEnTexto: null, ...o,
})

// Las tres opciones que dibuja la maqueta, con sus cifras reales.
const TZATZIKI = OP({
  nombre: 'Salsa Tzatziki (Recomendada)', precio: 1.5, yaEstabaDecidido: true,
  enCuantasPreguntas: 11, queLlevaEnTexto: '0,2 bote de Salsa Tzatziki 200g',
})
const YOGUR = OP({
  nombre: 'Salsa Yogur', precio: 1.5, yaEstabaDecidido: true,
  enCuantasPreguntas: 13, queLlevaEnTexto: '40 g de SALSA Yogur',
})
/** La de ámbar: existe 13 veces y NINGUNA dice qué lleva. */
const HARISSA = OP({
  nombre: 'Salsa Harissa (Picante)', precio: 1.5, queLleva: null,
  yaEstabaDecidido: false, enCuantasPreguntas: 13, queLlevaEnTexto: null,
})

const B = (o: Partial<BorradorDePregunta> = {}): BorradorDePregunta => ({
  marcaId: 'b9', marcaNombre: 'The Urban Kebab', marcaCedida: false,
  nombre: '¿Quieres una salsa extra?', tipo: 'anade', max: 3,
  obligatoria: false, repetible: false,
  opciones: [TZATZIKI, YOGUR], platosElegidos: ['p1', 'p2', 'p3', 'p4'], ...o,
})

describe('lo que impide crear, con su motivo', () => {
  it('con todo puesto, se puede', () => {
    expect(porQueNoSePuedeCrear(B())).toEqual([])
    expect(sePuedeCrear(B())).toBe(true)
  })

  it('una opción sin decidir qué lleva lo bloquea, y la nombra', () => {
    const faltan = porQueNoSePuedeCrear(B({ opciones: [TZATZIKI, YOGUR, HARISSA] }))
    expect(faltan).toHaveLength(1)
    expect(faltan[0]).toContain('Salsa Harissa (Picante)')
    expect(faltan[0]).toContain('no tiene decidido qué lleva')
  })

  it('dos sin decidir se dicen las dos, no «hay errores»', () => {
    const otra = OP({ nombre: 'Salsa Brava', queLleva: null, yaEstabaDecidido: false })
    const faltan = porQueNoSePuedeCrear(B({ opciones: [HARISSA, otra] }))
    expect(faltan[0]).toContain('Salsa Harissa (Picante)')
    expect(faltan[0]).toContain('Salsa Brava')
  })

  it('lo que YA estaba decidido no bloquea aunque aquí no se toque', () => {
    // `queLleva: null` + `yaEstabaDecidido: true` = viene de antes. No se
    // vuelve a preguntar ni se reescribe: es del extra, no de esta pregunta.
    const deAntes = OP({ nombre: 'Salsa Alioli', queLleva: null, yaEstabaDecidido: true })
    expect(porQueNoSePuedeCrear(B({ opciones: [deAntes] }))).toEqual([])
  })

  it('devuelve TODO lo que falta a la vez, no lo primero', () => {
    const faltan = porQueNoSePuedeCrear(B({ nombre: '  ', opciones: [], platosElegidos: [] }))
    expect(faltan.length).toBeGreaterThanOrEqual(3)
    expect(faltan.some((f) => f.includes('lee el cliente'))).toBe(true)
    expect(faltan.some((f) => f.includes('al menos una opción'))).toBe(true)
    expect(faltan.some((f) => f.includes('en qué platos'))).toBe(true)
  })

  it('sin platos lo dice con el motivo, no con un «obligatorio»', () => {
    const faltan = porQueNoSePuedeCrear(B({ platosElegidos: [] }))
    expect(faltan[0]).toContain('no la ve ningún cliente')
  })

  it('dos opciones con el mismo nombre lo bloquean', () => {
    const faltan = porQueNoSePuedeCrear(B({ opciones: [YOGUR, OP({ nombre: 'Salsa Yogur' })] }))
    expect(faltan.some((f) => f.includes('mismo nombre'))).toBe(true)
  })

  it('una marca CEDIDA lo bloquea todo, y no se molesta en pedir lo demás', () => {
    const faltan = porQueNoSePuedeCrear(B({
      marcaCedida: true, marcaNombre: 'Milanesa Haus',
      nombre: '', opciones: [], platosElegidos: [],
    }))
    expect(faltan).toHaveLength(1)
    expect(faltan[0]).toContain('la manda Last')
  })
})

describe('el botón y la confirmación dicen lo que hacen', () => {
  it('el botón dice a cuántos platos va', () => {
    expect(textoDelBotonCrear(B())).toBe('Crear y poner en 4 platos')
    expect(textoDelBotonCrear(B({ platosElegidos: ['p1'] }))).toBe('Crear y poner en 1 plato')
    expect(textoDelBotonCrear(B({ platosElegidos: [] }))).toBe('Crear')
  })

  it('la confirmación lleva contenido, no un visto (regla 8)', () => {
    const t = laConfirmacion(B(), 0)
    expect(t).toContain('«¿Quieres una salsa extra?»')
    expect(t).toContain('2 opciones')
    expect(t).toContain('4 platos')
  })

  it('y dice lo que TODAVÍA no ha pasado: la carta no sale sola', () => {
    expect(laConfirmacion(B(), 0)).toContain('próxima publicación de la carta')
  })

  it('los extras nuevos se cuentan aparte, porque son trabajo que queda', () => {
    expect(laConfirmacion(B(), 1)).toContain('Se ha creado 1 extra nuevo')
    expect(laConfirmacion(B(), 3)).toContain('Se han creado 3 extras nuevos')
    expect(laConfirmacion(B(), 0)).not.toContain('extra nuevo')
  })
})

describe('las palabras de la pantalla y las claves de la base', () => {
  it('los cuatro tipos, y su group_type', () => {
    expect(tituloDelTipo('anade')).toBe('Añadir varias')
    expect(tipoEnLaBase('elige')).toBe('choice')
    expect(tipoEnLaBase('anade')).toBe('extras')
    expect(tipoEnLaBase('quita')).toBe('removal')
    expect(tipoEnLaBase('sugiere')).toBe('cross_sell')
  })

  it('los SEIS «qué lleva», y su impact_type del CHECK', () => {
    expect(queLlevaEnLaBase('lleva')).toBe('add_item')
    expect(queLlevaEnLaBase('quita')).toBe('remove_item')
    expect(queLlevaEnLaBase('cambia')).toBe('replace_item')
    expect(queLlevaEnLaBase('multiplica')).toBe('multiply')
    expect(queLlevaEnLaBase('es_un_plato')).toBe('bundle')
    expect(queLlevaEnLaBase('no_lleva_nada')).toBe('none')
    expect(tituloDelQueLleva('es_un_plato')).toBe('Es un plato')
  })

  it('🔴 y «no lleva nada» NO se puede quitar de la lista', () => {
    // El encargo nombra cinco y la deja fuera. Sin ella, «Sin bebida» no se
    // podría decidir nunca: se quedaría para siempre en las 110. Y el tablero 1
    // ya cuenta `none` como decidida, así que omitirla aquí dejaría las dos
    // pantallas contando distinto.
    expect(LOS_QUE_LLEVA).toContain('no_lleva_nada')
    expect(LOS_QUE_LLEVA).toHaveLength(6)
    // Los seis del CHECK de modifier_recipe_impact, sin inventar ninguno.
    expect(new Set(LOS_QUE_LLEVA.map(queLlevaEnLaBase))).toEqual(new Set(
      ['add_item','remove_item','replace_item','multiply','bundle','none']))
  })

  it('la regla de la cabecera avisa de que hay que publicar', () => {
    expect(laReglaDeLaPantalla(B())).toContain('marca propia')
    expect(laReglaDeLaPantalla(B())).toContain('próxima publicación')
  })

  it('y en cedida dice por qué no se puede', () => {
    const r = laReglaDeLaPantalla(B({ marcaCedida: true, marcaNombre: 'Lobbers' }))
    expect(r).toContain('Lobbers')
    expect(r).toContain('aquí no se crean preguntas')
  })

  it('el precio: «No cobra» no es «0,00 €»', () => {
    expect(precioEnTexto(0)).toBe('No cobra')
    expect(precioEnTexto(1.5)).toBe('+1,50 €')
  })
})

describe('lo que verá el cliente usa el MISMO umbral que el tablero 1', () => {
  it('por debajo de 20 dice el tope', () => {
    expect(loQueVeraElCliente(B({ tipo: 'anade', max: 3 }))).toBe('Añadir hasta 3')
  })
  it('por encima dice lo que significa, no el número', () => {
    // `¿Quieres añadir un postre?.` tiene max 100 de verdad en Foodint.
    expect(loQueVeraElCliente(B({ tipo: 'anade', max: 100 }))).toBe('Añadir los que quiera')
  })
  it('y la obligatoria se dice obligatoria', () => {
    expect(loQueVeraElCliente(B({ tipo: 'elige', max: 1, obligatoria: true })))
      .toBe('Elegir 1 · obligatoria')
  })
})

describe('la categoría es un atajo, y la ayuda no promete una regla', () => {
  const CATS = [
    { id: 'c1', nombre: 'Kebabs Enrollados', cuantosPlatos: 4, yaTienen: [] },
    { id: 'c2', nombre: 'Kebab', cuantosPlatos: 4, yaTienen: ['Algun extra en tu pita?'] },
    { id: 'c3', nombre: 'Bowls y Platos', cuantosPlatos: 7, yaTienen: [] },
  ]

  it('suma los platos de las categorías marcadas', () => {
    expect(cuentaDePlatos(CATS, ['c1', 'c2'])).toBe(8)
    expect(cuentaDePlatos(CATS, [])).toBe(0)
  })

  it('🔴 y dice EXPLÍCITAMENTE que un plato nuevo NO la hereda', () => {
    // La maqueta promete lo contrario. Medido el 12/09: no hay tabla de regla
    // por categoría, ni disparador en `menu_item`, ni columna de categoría en
    // `modifier_group_assignment`. Prometerlo sería un fallo silencioso que se
    // descubre semanas después.
    const a = ayudaDeLaCategoria()
    expect(a).toContain('NO llevará esta pregunta')
    expect(a).toContain('no es una regla')
    expect(a).not.toContain('se le pone sola')
  })
})

describe('el aviso de que ya existe una parecida', () => {
  it('la nombra, dice dónde está y por qué no duplicarla', () => {
    const a = avisoDeParecida('¿Quieres una salsa extra?', {
      nombre: 'Algun extra en tu pita?', platos: 4,
      opciones: ['Tzatziki', 'Yogur', 'Harissa'],
    })!
    expect(a.titulo).toContain('Algun extra en tu pita?')
    expect(a.detalle).toContain('4 platos ya la tienen')
    expect(a.detalle).toContain('Tzatziki')
    expect(a.detalle).toContain('un solo sitio')
  })

  it('y si no hay parecida, no se inventa un aviso', () => {
    expect(avisoDeParecida('x', null)).toBeNull()
  })
})

describe('la línea de cada extra', () => {
  it('el que ya estaba decidido dice dónde más está', () => {
    expect(lineaDelExtra(YOGUR)).toBe('Extra que ya existe · en 13 preguntas')
  })
  it('el que existe 13 veces sin decidir dice por qué bloquea', () => {
    expect(lineaDelExtra(HARISSA)).toContain('Existe 13 veces')
    expect(lineaDelExtra(HARISSA)).toContain('no se puede crear')
  })
  it('y el nuevo dice que se crea al guardar', () => {
    expect(lineaDelExtra(OP({ extraId: null, queLleva: 'lleva', yaEstabaDecidido: false })))
      .toBe('Extra nuevo · se crea al guardar')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// EDITAR, Y LA DEUDA QUE SE OFRECE EN VEZ DE EXIGIRSE (Julio, 13/09 10:10)
// ═══════════════════════════════════════════════════════════════════════════

describe('editar no obliga, pero ofrece', () => {
  const VIEJA_SIN_DECIDIR = OP({
    extraId: 'e1', nombre: 'Salsa Harissa (Picante)', queLleva: null, yaEstabaDecidido: false,
  })
  const VIEJA_DECIDIDA = OP({ extraId: 'e2', nombre: 'Salsa Yogur', yaEstabaDecidido: true })
  const NUEVA_SIN_EFECTO = OP({ extraId: null, nombre: 'Salsa Brava', queLleva: null, yaEstabaDecidido: false })

  it('🔴 una respuesta VIEJA sin decidir NO impide guardar', () => {
    // Si entrar a corregir un precio obligara a resolver nueve fichas, nadie
    // entraría a corregir el precio. La deuda se quedaría quieta por prudencia.
    expect(porQueNoSePuedeGuardar(B({ opciones: [VIEJA_DECIDIDA, VIEJA_SIN_DECIDIR] }))).toEqual([])
  })

  it('🔴 pero una respuesta NUEVA sin efecto sí: sería la fila 111', () => {
    const faltan = porQueNoSePuedeGuardar(B({ opciones: [VIEJA_DECIDIDA, NUEVA_SIN_EFECTO] }))
    expect(faltan).toHaveLength(1)
    expect(faltan[0]).toContain('Salsa Brava')
    expect(faltan[0]).toContain('nueva')
  })

  it('la deuda se OFRECE, con su número y en forma de pregunta', () => {
    const tres = [VIEJA_SIN_DECIDIR, OP({ extraId: 'e3', nombre: 'B', queLleva: null, yaEstabaDecidido: false }),
                  OP({ extraId: 'e4', nombre: 'C', queLleva: null, yaEstabaDecidido: false })]
    expect(cuantasSinDecidir(tres)).toBe(3)
    expect(laDeudaDeEstaPregunta(tres))
      .toBe('3 de estas respuestas todavía no dicen qué llevan. ¿Las dejamos resueltas ahora?')
    expect(laDeudaDeEstaPregunta([VIEJA_SIN_DECIDIR])).toContain('Una de estas respuestas')
  })

  it('y una pregunta limpia NO enseña el aviso: un aviso que sale siempre deja de leerse', () => {
    expect(laDeudaDeEstaPregunta([VIEJA_DECIDIDA])).toBeNull()
    expect(cuantasSinDecidir([VIEJA_DECIDIDA])).toBe(0)
  })

  it('editar tampoco exige platos: eso se decide en el tablero 3', () => {
    expect(porQueNoSePuedeGuardar(B({ platosElegidos: [], opciones: [VIEJA_DECIDIDA] }))).toEqual([])
    // Pero CREAR sí los exige: una pregunta nueva sin platos no la ve nadie.
    expect(porQueNoSePuedeCrear(B({ platosElegidos: [] })).some((f) => f.includes('ningún cliente')))
      .toBe(true)
  })

  it('y la cedida sigue bloqueando entera, también al editar', () => {
    expect(porQueNoSePuedeGuardar(B({ marcaCedida: true }))).toHaveLength(1)
  })

  it('el botón dice lo que hace en cada caso', () => {
    expect(textoDelBotonGuardar(B(), false)).toBe('Guardar y ponerla en platos')
    expect(textoDelBotonGuardar(B({ opciones: [VIEJA_DECIDIDA] }), true)).toBe('Guardar cambios')
  })

  it('la confirmación de editar cuenta lo resuelto y lo retirado', () => {
    const t = laConfirmacionAlEditar('¿Quieres salsa?', 3, 1)
    expect(t).toContain('3 respuestas que ya dicen qué llevan')
    expect(t).toContain('1 respuesta retirada')
    expect(t).toContain('próxima publicación')
    expect(laConfirmacionAlEditar('x', 0, 0)).not.toContain('respuestas que ya dicen')
  })
})

describe('tablero 3 · el contador y lo que cambia', () => {
  it('el contador está siempre, incluso a cero, y a cero dice la verdad', () => {
    expect(elContadorDePlatos(0)).toBe('No está en ningún plato todavía')
    expect(elContadorDePlatos(1)).toBe('Estará en 1 plato')
    expect(elContadorDePlatos(14)).toBe('Estará en 14 platos')
  })

  it('el atajo de categoría lleva el número por delante', () => {
    expect(marcarLaCategoria('Bebidas', 7)).toBe('Marcar los 7 de Bebidas')
    expect(marcarLaCategoria('Postres', 1)).toBe('Marcar el de Postres')
  })

  it('🔴 y se dice lo que se QUITA, no solo lo que se pone', () => {
    expect(elCambioEnPlatos(['a', 'b'], ['a', 'c'])).toBe('Se añade a 1 plato y se quita de 1 plato')
    expect(elCambioEnPlatos([], ['a', 'b'])).toBe('Se añade a 2 platos')
    expect(elCambioEnPlatos(['a'], [])).toBe('Se quita de 1 plato')
    expect(elCambioEnPlatos(['a'], ['a'])).toBe('Sin cambios')
  })

  it('la confirmación dice dónde queda y que la carta no sale sola', () => {
    const t = laConfirmacionDePlatos('¿Quieres salsa?', 14, 3, 1)
    expect(t).toContain('está en 14 platos')
    expect(t).toContain('3 nuevos')
    expect(t).toContain('1 quitado')
    expect(t).toContain('Pendiente de publicar')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// DECIDIR UNA VEZ PARA TODAS LAS IGUALES
// ═══════════════════════════════════════════════════════════════════════════
// LOS DATOS SON REALES (regla 31), medidos el 13/09: «Salsa Yogur» sin decidir
// sale 6 veces, y sus 5 iguales resolubles viven en DOS marcas propias —
// Meraki Pita ×2 y The Urban Kebab ×3—. Otras 7 quedan fuera por estar ya
// decididas. Ese cruce de marcas es justo por lo que la lista va delante.

describe('las iguales: se ofrecen, no se aplican a ciegas', () => {
  const IGUALES: UnaIgual[] = [
    { id: 'a', nombre: 'Salsa Yogur', marca: 'Meraki Pita', pregunta: 'Escoge una salsa para tu pita' },
    { id: 'b', nombre: 'Salsa Yogur', marca: 'Meraki Pita', pregunta: 'Escoge una salsa para tu pita' },
    { id: 'c', nombre: 'Salsa Yogur', marca: 'The Urban Kebab', pregunta: '1. Escoge la salsa para tu primer kebab' },
    { id: 'd', nombre: 'Salsa Yogur', marca: 'The Urban Kebab', pregunta: '2. Escoge la salsa para tu segundo kebab' },
    { id: 'e', nombre: 'Salsa Yogur', marca: 'The Urban Kebab', pregunta: 'Escoge una salsa para tu bowl/plato' },
  ]

  it('la oferta lleva el número y el reparto por marca, y es una pregunta', () => {
    const t = laOfertaDeLasIguales(IGUALES)!
    expect(t).toContain('estas 5')
    expect(t).toContain('The Urban Kebab ×3')
    expect(t).toContain('Meraki Pita ×2')
    expect(t.endsWith('¿Las resuelvo?')).toBe(true)
  })

  it('con una sola, habla en singular', () => {
    expect(laOfertaDeLasIguales([IGUALES[0]])).toContain('¿La resuelvo?')
  })

  it('y sin ninguna NO se pinta nada: un aviso que sale siempre deja de leerse', () => {
    expect(laOfertaDeLasIguales([])).toBeNull()
  })

  it('🔴 las que quedan fuera se DICEN, con su motivo (regla 7)', () => {
    // Sin esta línea la pantalla diría «son 5» cuando son 12.
    const fuera: UnaQueQuedaFuera[] = [
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `f${i}`, marca: 'Meraki Pita', pregunta: 'x', motivo: 'ya_decidida' as const })),
      { id: 'g', marca: 'Lobbers', pregunta: 'y', motivo: 'cedida' as const },
    ]
    const t = lasQueQuedanFuera(fuera)!
    expect(t).toContain('otras 8')
    expect(t).toContain('7 ya tienen decidido lo suyo')
    expect(t).toContain('1 está en una marca que manda Last')
  })

  it('y si no queda ninguna fuera, tampoco se inventa la línea', () => {
    expect(lasQueQuedanFuera([])).toBeNull()
  })

  it('cada fila dice DÓNDE vive: la marca y la pregunta', () => {
    expect(dondeViveLaIgual(IGUALES[2])).toBe('The Urban Kebab · 1. Escoge la salsa para tu primer kebab')
  })

  it('el botón dice a cuántas va, y «solo esta» si se desmarcan todas', () => {
    expect(textoDelBotonDeLasIguales(0)).toBe('Solo esta')
    expect(textoDelBotonDeLasIguales(1)).toBe('Resolver también la otra')
    expect(textoDelBotonDeLasIguales(5)).toBe('Resolver también las otras 5')
  })

  it('la confirmación nombra las marcas y recuerda que el rastro es por fila', () => {
    const t = laConfirmacionDeLasIguales('Salsa Yogur',
      ['Meraki Pita · Escoge una salsa para tu pita', 'The Urban Kebab · Escoge una salsa para tu bowl/plato'])
    expect(t).toContain('2 sitios')
    expect(t).toContain('Meraki Pita, The Urban Kebab')
    expect(t).toContain('su propio registro de quién y cuándo')
  })
})

// ── 🔴 UNA CANTIDAD QUE FALTA NO DESCUENTA NADA ────────────────────────────
//
// 13/09 13:25. Julio decidió Maíz y Frijoles desde el tablero 5 con su ficha y
// la casilla de cantidad vacía. El contador bajó de 107 a 105 —o sea, la
// pantalla las dio por hechas— y el consumo real es CERO: medido contra
// producción, `explode_recipe_to_raws` con cantidad nula devuelve cero filas,
// cuando con cantidad 1 devolvería 1.
//
// Un número que dice «hecho» sin estarlo es peor que el número alto de antes,
// porque el 105 parece progreso. Esto lo fija.
describe('🔴 loQueLeFaltaAlEfecto · sin cantidad no se guarda', () => {
  const o = (x: Partial<{ nombre: string; queLleva: QueLleva | null; fichaId: string | null; cantidad: string }> = {}) => ({
    nombre: 'Maíz', queLleva: 'lleva' as QueLleva | null, fichaId: 'ficha-maiz', cantidad: '1', ...x,
  })

  it('el caso real del 13/09: ficha puesta y cantidad en blanco → bloquea', () => {
    const faltan = loQueLeFaltaAlEfecto([o({ cantidad: '' }), o({ nombre: 'Frijoles', cantidad: '' })])
    expect(faltan).toHaveLength(2)
    expect(faltan[0]).toContain('Maíz')
    expect(faltan[0]).toContain('no dice CUÁNTO')
    expect(faltan[0]).toContain('no descuenta nada')
    expect(faltan[1]).toContain('Frijoles')
  })

  it('cero y negativo tampoco valen: descuentan nada o al revés', () => {
    expect(loQueLeFaltaAlEfecto([o({ cantidad: '0' })])).toHaveLength(1)
    expect(loQueLeFaltaAlEfecto([o({ cantidad: '-2' })])).toHaveLength(1)
    expect(loQueLeFaltaAlEfecto([o({ cantidad: 'dos' })])).toHaveLength(1)
  })

  it('la coma decimal española sí vale: 0,2 es una cantidad', () => {
    expect(loQueLeFaltaAlEfecto([o({ cantidad: '0,2' })])).toHaveLength(0)
    expect(loQueLeFaltaAlEfecto([o({ cantidad: '0.2' })])).toHaveLength(0)
  })

  it('y falta la ficha: se dice eso, no la cantidad', () => {
    const faltan = loQueLeFaltaAlEfecto([o({ fichaId: null, cantidad: '' })])
    expect(faltan).toHaveLength(1)
    expect(faltan[0]).toContain('no ha elegido el artículo')
  })

  it('«no lleva nada» y «es un plato» no piden ficha ni cantidad', () => {
    expect(loQueLeFaltaAlEfecto([
      o({ queLleva: 'no_lleva_nada', fichaId: null, cantidad: '' }),
      o({ queLleva: 'es_un_plato', fichaId: null, cantidad: '' }),
      o({ queLleva: null, fichaId: null, cantidad: '' }),
    ])).toHaveLength(0)
  })

  it('NO se rellena un 1 por nuestra cuenta: se bloquea y se pide', () => {
    // Inventar la cantidad sería escribir un consumo que nadie ha dicho.
    // Cuánto sale del almacén cada vez lo decide quien lo sabe, no la pantalla.
    const faltan = loQueLeFaltaAlEfecto([o({ cantidad: '' })])
    expect(faltan.length).toBeGreaterThan(0)
  })
})
