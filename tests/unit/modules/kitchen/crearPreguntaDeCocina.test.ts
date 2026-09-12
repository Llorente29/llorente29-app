// El tablero 5 (crear una pregunta). Las reglas de qué impide crear y todo el
// castellano, fijados aquí para que se puedan leer y discutir sin abrir React.
//
// LAS FILAS SON REALES: los extras, sus precios y en cuántas preguntas están
// salen de Foodint el 12/09 (regla 31). El caso de «Salsa Harissa» —existe 13
// veces y ninguna dice qué lleva— es el que la maqueta dibuja en ámbar, y es
// el único que bloquea la creación.

import { describe, it, expect } from 'vitest'
import {
  tituloDelTipo, tipoEnLaBase, tituloDelQueLleva, queLlevaEnLaBase,
  laReglaDeLaPantalla, loQueVeraElCliente, porQueNoSePuedeCrear, sePuedeCrear,
  textoDelBotonCrear, laConfirmacion, ayudaDeLaCategoria, cuentaDePlatos,
  avisoDeParecida, lineaDelExtra, precioEnTexto,
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

  it('los cinco «qué lleva», y su impact_type del CHECK', () => {
    expect(queLlevaEnLaBase('lleva')).toBe('add_item')
    expect(queLlevaEnLaBase('quita')).toBe('remove_item')
    expect(queLlevaEnLaBase('cambia')).toBe('replace_item')
    expect(queLlevaEnLaBase('es_un_plato')).toBe('bundle')
    expect(queLlevaEnLaBase('no_lleva_nada')).toBe('none')
    expect(tituloDelQueLleva('es_un_plato')).toBe('Es un plato')
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
