// La sección «Extras» (07/09/2026). Todo el castellano de la pantalla vive en
// `lib/`, y esto lo fija.
//
// LOS DATOS SON LOS REALES de Foodint, medidos contra producción el 07/09 con
// el cuerpo de la RPC ejecutado como consulta suelta (regla 31). No son
// ejemplos escritos de memoria: con ejemplos inventados una frase que cuenta
// mal —«7 copias en 3 marcas» cuando son 2— pasa en verde. De hecho ese error
// exacto estaba en el flujo de la maqueta y lo cazó el dato, no la lectura.

import { describe, it, expect } from 'vitest'
import {
  cuantasCopias, cuantasCopiasEnElTitulo, soloCopias, platoDelMismoNombre,
  marcasDeLaFila, dondeApareceLaCopia, fichasSinPrecio, avisoDeSinPrecio,
  loQueCobra, queLleva, botonDeLaFila, hayQueArreglarlo,
  ordena, parteEnDos, pieDeLaBarra, tituloDelPliegue, confirmacion,
  type ExtraPorNombre, type CopiaDelExtra,
} from '@/modules/kitchen/lib/extrasDeCocina'

const copia = (o: Partial<CopiaDelExtra> = {}): CopiaDelExtra => ({
  opcion: 'o', marca: 'Meraki Pita', marcaId: 'm', grupo: 'g',
  precio: 1.5, vendidas: 0, coste: 0, tieneCoste: false, platos: [], ...o,
})
const E = (o: Partial<ExtraPorNombre> = {}): ExtraPorNombre => ({
  clave: 'x', nombre: 'X', copias: 1, marcas: 1, vendidas: 0, cobrado: 0,
  precioMin: 1, precioMax: 1, preciosDistintos: false, estado: 'nada_puesto',
  costeYaPuesto: null, marcaQueYaLoTiene: null, donde: [copia()], ...o,
})

// ── Las filas REALES del 07/09, tal y como las devuelve la RPC ──────────────
const BASE_TERNERA = E({
  clave: 'base ternera (premium selection)', nombre: 'Base Ternera (Premium Selection)',
  copias: 2, marcas: 1, vendidas: 55, cobrado: 126.5,
  precioMin: 1.5, precioMax: 2.5, preciosDistintos: true, estado: 'puesto_pero_cero',
  donde: [copia({ marca: 'Milanesa House', precio: 2.5, vendidas: 44 }),
          copia({ marca: 'Milanesa House', precio: 1.5, vendidas: 11 })],
})
const SALSA_YOGUR = E({
  clave: 'salsa yogur', nombre: 'Salsa Yogur',
  copias: 7, marcas: 2, vendidas: 24, cobrado: 36,
  precioMin: 1.5, precioMax: 1.5, estado: 'nada_puesto',
  donde: [
    ...Array.from({ length: 4 }, () => copia({ marca: 'The Urban Kebab' })),
    ...Array.from({ length: 3 }, () => copia({ marca: 'Meraki Pita' })),
  ],
})
const TZATZIKI = E({
  clave: 'salsa tzatziki (recomendada)', nombre: 'Salsa Tzatziki (Recomendada)',
  copias: 6, marcas: 2, vendidas: 42, cobrado: 84, precioMin: 2, precioMax: 2,
})
const SWEET_CHILI_T = E({
  clave: 'sweet chili t', nombre: 'Sweet Chili T',
  copias: 1, marcas: 1, vendidas: 35, cobrado: 21,
  precioMin: 0.6, precioMax: 0.6, estado: 'puesto_pero_cero',
})
const REALES = [BASE_TERNERA, TZATZIKI, SWEET_CHILI_T, SALSA_YOGUR]

describe('cómo se cuenta una fila', () => {
  it('«1 copia» cuando sólo hay una', () => {
    expect(cuantasCopias(SWEET_CHILI_T)).toBe('1 copia')
  })
  it('singular de marca cuando las copias están en una sola', () => {
    expect(cuantasCopias(BASE_TERNERA)).toBe('2 en 1 marca')
  })
  it('plural cuando cruzan marcas', () => {
    expect(cuantasCopias(SALSA_YOGUR)).toBe('7 en 2 marcas')
  })
  // El fallo de la maqueta, fijado: Salsa Yogur está en DOS marcas, no en tres.
  it('Salsa Yogur son 2 marcas, no 3', () => {
    expect(cuantasCopias(SALSA_YOGUR)).not.toContain('3 marcas')
  })
})

describe('lo que cobra', () => {
  it('un precio se pinta solo', () => {
    expect(loQueCobra(TZATZIKI)).toEqual({ texto: '2,00 €', esRango: false })
  })
  it('precios distintos se pintan como rango y se marcan', () => {
    const r = loQueCobra(BASE_TERNERA)
    expect(r.esRango).toBe(true)
    expect(r.texto).toBe('1,50 – 2,50 €')
  })
})

describe('qué lleva, y qué botón sale', () => {
  it('sin nada puesto', () => {
    expect(queLleva(TZATZIKI)).toEqual({ texto: 'nada puesto', tono: 'rojo' })
    expect(botonDeLaFila(TZATZIKI)).toBe('Decir qué lleva')
  })
  it('puesto pero a cero es un caso distinto de «nada puesto»', () => {
    expect(queLleva(SWEET_CHILI_T).texto).toBe('puesto, pero vale 0 €')
  })
  // Decisión 2 del §5: el precio distinto es una PUERTA, no una nota.
  it('con precios distintos manda la puerta y el botón cambia', () => {
    expect(queLleva(BASE_TERNERA).texto).toBe('precios distintos')
    expect(botonDeLaFila(BASE_TERNERA)).toBe('Elegir copias')
  })
  it('un mixto no se da por resuelto', () => {
    const mixto = E({ estado: 'mixto', copias: 2 })
    expect(queLleva(mixto).tono).toBe('ambar')
    expect(hayQueArreglarlo(mixto)).toBe(true)
  })
  it('lo ya hecho sale del rojo', () => {
    const hecho = E({ estado: 'con_coste' })
    expect(queLleva(hecho).tono).toBe('verde')
    expect(hayQueArreglarlo(hecho)).toBe(false)
  })
})

describe('el orden y el pliegue', () => {
  it('por defecto manda lo vendido', () => {
    expect(ordena(REALES, 'vendido').map((e) => e.nombre)[0]).toBe('Base Ternera (Premium Selection)')
  })
  it('por copias manda el que está más veces', () => {
    expect(ordena(REALES, 'copias').map((e) => e.nombre)[0]).toBe('Salsa Yogur')
  })
  it('por cobrado manda el dinero', () => {
    expect(ordena(REALES, 'cobrado').map((e) => e.nombre)[0]).toBe('Base Ternera (Premium Selection)')
  })
  // Regla 7: lo que no se vende NO desaparece, baja y se cuenta.
  it('lo que no se vende se aparta, se cuenta y se puede abrir', () => {
    const sin = E({ clave: 'z', nombre: 'Z', vendidas: 0 })
    const { conVentas, sinVentas } = parteEnDos([...REALES, sin])
    expect(conVentas).toHaveLength(4)
    expect(sinVentas).toHaveLength(1)
    expect(tituloDelPliegue(sinVentas)).toBe('y 1 extra más sin coste')
  })
  it('el pie cuenta nombres, copias y cuántos se venden', () => {
    expect(pieDeLaBarra(REALES)).toBe('4 nombres · 16 copias · los 4 que se venden, primero')
  })
})

describe('la confirmación dice qué ha pasado, no «hecho»', () => {
  it('lleva el coste, las copias y las marcas con su reparto', () => {
    const t = confirmacion({
      nombre: 'Salsa Yogur', queLleva: '40 g de yogur griego', coste: 0.18,
      copias: SALSA_YOGUR.donde, sinCosteDespues: 91,
    })
    expect(t).toContain('Salsa Yogur lleva 40 g de yogur griego: 0,18 €.')
    expect(t).toContain('7 copias en 2 marcas')
    expect(t).toContain('The Urban Kebab (4)')
    expect(t).toContain('Meraki Pita (3)')
    expect(t).toContain('Sin coste quedan 91.')
  })
  it('no dice «y Lovers»: esa marca no tiene Salsa Yogur', () => {
    const t = confirmacion({
      nombre: 'Salsa Yogur', queLleva: '40 g de yogur griego', coste: 0.18,
      copias: SALSA_YOGUR.donde, sinCosteDespues: 91,
    })
    expect(t).not.toContain('Lovers')
  })
  it('singular cuando es una sola copia', () => {
    const t = confirmacion({
      nombre: 'Mayo Spicy', queLleva: '15 g de mayonesa', coste: 0.05,
      copias: [copia({ marca: 'Big Mike´s Burger Joint' })], sinCosteDespues: 97,
    })
    expect(t).toContain('1 copia en 1 marca')
  })
})

// ── Nada de jerga en lo que se pinta (B83) ─────────────────────────────────
describe('ni un identificador en lo que se pinta', () => {
  const PROHIBIDO = [
    /\b(impact_type|modifier_option|price_impact|recipe_item|bundle|confirmed|proposed|add_item)\b/,
    /\b(SELECT|WHERE|NULL|IS NULL)\b/,
    /[a-z]+_[a-z]+/,
  ]
  for (const e of REALES) {
    it(`«${e.nombre}» no pinta jerga`, () => {
      const texto = [
        e.nombre, cuantasCopias(e), loQueCobra(e).texto,
        queLleva(e).texto, botonDeLaFila(e),
      ].join(' ')
      for (const re of PROHIBIDO) expect(re.test(texto), texto).toBe(false)
    })
  }
  // Que la barrida sirva: las claves de la RPC SÍ tienen que dispararla.
  it('la barrida salta con las claves que devuelve la base', () => {
    for (const clave of ['nada_puesto', 'puesto_pero_cero', 'add_item', 'price_impact']) {
      expect(PROHIBIDO.some((re) => re.test(clave)), clave).toBe(true)
    }
  })
})

// ── La puerta de las copias ────────────────────────────────────────────────
// El caso REAL que la obliga: «Tiras de Pollo Kentucky (4 uds)», tres copias en
// tres marcas, a 1,90 € dos y a 6,50 € la tercera. Medido en producción el
// 07/09. La de 6,50 € es una ración entera, no un añadido.
import {
  copiasPreseleccionadas, porQueSeQuedaFuera, textoDeGuardar, frasedeLoQueLleva,
} from '@/modules/kitchen/lib/extrasDeCocina'

const TIRAS = E({
  clave: 'tiras de pollo kentucky (4 uds)', nombre: 'Tiras de Pollo Kentucky (4 uds)',
  copias: 3, marcas: 3, vendidas: 5, cobrado: 9.5,
  precioMin: 1.9, precioMax: 6.5, preciosDistintos: true, estado: 'nada_puesto',
  donde: [
    copia({ opcion: 'a', marca: 'Smash Brothers Burgers', precio: 1.9, vendidas: 5 }),
    copia({ opcion: 'b', marca: "Mila's Sandwiches",      precio: 1.9, vendidas: 0 }),
    copia({ opcion: 'c', marca: 'Dirty Burger',           precio: 6.5, vendidas: 0 }),
  ],
})

describe('cuando las copias no cobran lo mismo', () => {
  it('marca las que cobran como la que MÁS SE VENDE, no las más baratas', () => {
    expect(copiasPreseleccionadas(TIRAS)).toEqual(['a', 'b'])
  })

  // Si el patrón fuera «el precio más bajo» coincidiría aquí por casualidad.
  // Con la más vendida cara, el resultado tiene que cambiar: así se comprueba
  // que la regla es la que digo y no otra que da lo mismo en este ejemplo.
  it('si la que más vende es la cara, se marcan las caras', () => {
    const alReves = { ...TIRAS, donde: [
      copia({ opcion: 'a', marca: 'Smash Brothers Burgers', precio: 1.9, vendidas: 0 }),
      copia({ opcion: 'b', marca: "Mila's Sandwiches",      precio: 1.9, vendidas: 0 }),
      copia({ opcion: 'c', marca: 'Dirty Burger',           precio: 6.5, vendidas: 9 }),
    ] }
    expect(copiasPreseleccionadas(alReves)).toEqual(['c'])
  })

  it('la que se queda fuera lleva escrito por qué', () => {
    const fuera = TIRAS.donde.find((c) => c.opcion === 'c')!
    expect(porQueSeQuedaFuera(TIRAS, fuera)).toContain('Dirty Burger a 6,50 €')
    expect(porQueSeQuedaFuera(TIRAS, TIRAS.donde[0])).toBeNull()
  })

  it('el botón dice a cuántas copias va', () => {
    expect(textoDeGuardar(7)).toBe('Guardar en las 7 copias')
    expect(textoDeGuardar(1)).toBe('Guardar en la copia')
  })
})

describe('la frase de lo que lleva, sin jerga', () => {
  const yogur = { ficha: 'f1', nombreFicha: 'yogur griego', tipo: 'ingrediente' as const,
                  cantidad: 40, unidad: 'u1', nombreUnidad: 'g' }
  it('un ingrediente con su cantidad y unidad', () => {
    expect(frasedeLoQueLleva([yogur])).toBe('40 g de yogur griego')
  })
  it('un plato entero se dice en raciones, no en gramos', () => {
    expect(frasedeLoQueLleva([{ ficha: 'f2', nombreFicha: 'Salsa Yogur (ración)',
      tipo: 'plato', cantidad: 1, unidad: null, nombreUnidad: 'ud' }]))
      .toBe('una ración de Salsa Yogur (ración)')
  })
  it('varias cosas se enumeran en castellano', () => {
    const t = frasedeLoQueLleva([
      { ...yogur, nombreFicha: 'pan', cantidad: 1, nombreUnidad: 'ud' },
      { ...yogur, nombreFicha: 'carne', cantidad: 120 },
      { ...yogur, nombreFicha: 'salsa', cantidad: 20 },
    ])
    expect(t).toBe('1 ud de pan, 120 g de carne y 20 g de salsa')
  })
  it('nunca dice add_item ni bundle', () => {
    const t = frasedeLoQueLleva([yogur])
    expect(t).not.toMatch(/add_item|bundle|impact/)
  })
})


// ── Las tres formas de contar las copias ───────────────────────────────────
// Son tres sitios distintos y cada uno enseña algo distinto al lado, así que la
// frase cambia. En la TABLA la columna se titula COPIAS: el número basta. En el
// TÍTULO del paso 1 no hay columna que lo diga y sin la palabra queda «7 en 2
// marcas», que deja preguntándose 7 qué. En la PUERTA cada fila lleva su marca
// escrita: repetir «en 3 marcas» arriba es decir dos veces lo que ya se ve.
describe('cómo se cuentan las copias en cada sitio', () => {
  it('en la tabla, sin la palabra', () => {
    expect(cuantasCopias(SALSA_YOGUR)).toBe('7 en 2 marcas')
  })
  it('en el título del paso, con la palabra', () => {
    expect(cuantasCopiasEnElTitulo(SALSA_YOGUR)).toBe('7 copias en 2 marcas')
  })
  it('en la puerta, sin las marcas', () => {
    expect(soloCopias(SALSA_YOGUR)).toBe('7 copias')
  })
  it('una sola copia se dice igual en los tres', () => {
    expect(cuantasCopias(SWEET_CHILI_T)).toBe('1 copia')
    expect(cuantasCopiasEnElTitulo(SWEET_CHILI_T)).toBe('1 copia')
    expect(soloCopias(SWEET_CHILI_T)).toBe('1 copia')
  })
})

// ── ¿Ya existe como plato? ─────────────────────────────────────────────────
// Los OCHO casos reales del 07/09 en Foodint: extras que se cobran aparte y que
// además existen como plato con su escandallo hecho. Decírselo al que va a
// teclear el coste ahorra el escandallo y evita costear a mano lo que la cocina
// ya tiene medido.
describe('cuando el extra ya existe como plato', () => {
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
  const CATALOGO = [
    { name: 'La Triple', kind: 'plato' as const },
    { name: 'Bocadillo César', kind: 'plato' as const },
    { name: 'Yogur griego', kind: 'ingrediente' as const },
    { name: 'SALSA Yogur', kind: 'ingrediente' as const },
  ]

  it('lo encuentra por nombre', () => {
    expect(platoDelMismoNombre('La Triple', CATALOGO, norm)?.name).toBe('La Triple')
  })
  it('no le importan los acentos ni las mayúsculas', () => {
    expect(platoDelMismoNombre('BOCADILLO CESAR', CATALOGO, norm)?.name).toBe('Bocadillo César')
  })
  // Lo importante: un INGREDIENTE que se llama igual NO es «usar el plato».
  // «Salsa Yogur» existe como ficha de ingrediente y no debe ofrecer el atajo.
  it('un ingrediente del mismo nombre no cuenta', () => {
    expect(platoDelMismoNombre('Salsa Yogur', CATALOGO, norm)).toBeNull()
  })
  it('sin coincidencia devuelve null, no la primera que pilla', () => {
    expect(platoDelMismoNombre('Mayo trufa', CATALOGO, norm)).toBeNull()
  })
})


// ── B84 · lo que Julio vio en producción el 07/09 ──────────────────────────

// B84.5. Las CUATRO copias de «Salsa Yogur» en The Urban Kebab comparten el
// nombre de grupo «Algun extra en tu pita?» y son cuatro PLATOS distintos. La
// pantalla pintaba cuatro líneas idénticas y escondía justo lo que las separa.
// Los datos son los de producción, medidos el 07/09 como consulta suelta.
describe('dónde aparece una copia', () => {
  it('con un plato, manda el plato y el grupo queda de apellido', () => {
    const c = copia({ marca: 'The Urban Kebab', grupo: 'Algun extra en tu pita?',
      platos: [{ id: 'de9c174c', nombre: 'Kebab de Falafel 🌿' }] })
    expect(dondeApareceLaCopia(c)).toEqual({
      principal: 'Kebab de Falafel 🌿',
      secundario: 'The Urban Kebab · «Algun extra en tu pita?»',
    })
  })

  // La copia de Meraki con ese mismo nombre de grupo son QUINCE platos.
  it('con varios, dice cuántos', () => {
    const c = copia({ marca: 'Meraki Pita', grupo: 'Algun extra en tu pita?',
      platos: Array.from({ length: 15 }, (_, i) => ({ id: `p${i}`, nombre: `Plato ${i}` })) })
    expect(dondeApareceLaCopia(c).principal).toBe('15 platos')
  })

  // Lo importante: dos copias con el MISMO grupo ya no se leen igual.
  it('dos copias del mismo grupo dejan de ser indistinguibles', () => {
    const a = copia({ marca: 'The Urban Kebab', grupo: 'Algun extra en tu pita?',
      platos: [{ id: '1', nombre: 'Kebab de Pollo Gyros 🌯' }] })
    const b = copia({ marca: 'The Urban Kebab', grupo: 'Algun extra en tu pita?',
      platos: [{ id: '2', nombre: 'Kebab de Ternera Gyros 🌯' }] })
    expect(dondeApareceLaCopia(a).principal).not.toBe(dondeApareceLaCopia(b).principal)
  })

  // Mientras la consulta no mande platos se pinta el grupo, no una lista vacía.
  it('sin platos, se dice el grupo y no se inventa nada', () => {
    const c = copia({ marca: 'Meraki Pita', grupo: '¿Le añadimos salsa?', platos: [] })
    expect(dondeApareceLaCopia(c)).toEqual({
      principal: '«¿Le añadimos salsa?»', secundario: 'Meraki Pita',
    })
  })
})

// B84.6. El mismo reparto no puede salir en dos órdenes según quién lo pinte.
describe('el orden de las marcas', () => {
  it('la fila las ordena como la frase del panel: alfabético', () => {
    expect(marcasDeLaFila(SALSA_YOGUR)).toBe('Meraki Pita · The Urban Kebab')
  })
  it('no repite una marca que está en varias copias', () => {
    expect(marcasDeLaFila(SALSA_YOGUR).split(' · ')).toHaveLength(2)
  })
})

// B84.3. Las DOS fichas de yogur griego que hay de verdad en Foodint: la buena
// archivada el 24/08 y la viva a 0 €. Elegir la viva daba «0,00 €» y Guardar
// activo, y las siete copias quedaban «puestas, pero a 0 €» — peor que no
// tocarlas, porque ya parecen hechas.
describe('una ficha sin precio se dice, no se traga', () => {
  const CATALOGO = [
    { id: 'viva', name: 'Yogurt Griego', costeUnitario: 0 },
    { id: 'salsa', name: 'SALSA Yogur', costeUnitario: 0.0068 },
    { id: 'nula', name: 'Pan de pita', costeUnitario: null },
  ]
  it('caza el cero', () => {
    expect(fichasSinPrecio([{ ficha: 'viva' }], CATALOGO).map((f) => f.name)).toEqual(['Yogurt Griego'])
  })
  it('caza también el sin poner, que no es lo mismo pero pinta igual', () => {
    expect(fichasSinPrecio([{ ficha: 'nula' }], CATALOGO).map((f) => f.name)).toEqual(['Pan de pita'])
  })
  it('una ficha con precio no salta', () => {
    expect(fichasSinPrecio([{ ficha: 'salsa' }], CATALOGO)).toEqual([])
  })
  it('el aviso nombra la ficha, no «un ingrediente»', () => {
    expect(avisoDeSinPrecio([{ name: 'Yogurt Griego' }])).toBe('Yogurt Griego no tiene precio puesto')
  })
  it('con varias, las nombra todas y concuerda', () => {
    expect(avisoDeSinPrecio([{ name: 'Yogurt Griego' }, { name: 'Pan de pita' }]))
      .toBe('Yogurt Griego y Pan de pita no tienen precio puesto')
  })
  it('sin ninguna no hay aviso', () => {
    expect(avisoDeSinPrecio([])).toBeNull()
  })
})

// ── Qué días se está viendo ────────────────────────────────────────────────
// La maqueta pone las fechas («vendido del 9 de agosto al 7 de septiembre») y
// no «los últimos 30 días», que obliga a echar la cuenta de cabeza.
//
// UN RELOJ. Las dos fechas ya no se calculan aquí: llegan de la consulta, que
// las devuelve porque son exactamente los días que ha contado, en el calendario
// de Madrid. Antes la frase decía «del 8 de agosto» —hoy menos 30— y la consulta
// contaba desde ayer a las 15:00: la frase prometía días enteros que la consulta
// no contaba. Los ejemplos de abajo son los de la ventana real de producción:
// 30 días enteros cerrados el 07/09/2026 son del 9 de agosto al 7 de septiembre,
// 2.948 ventas (la ventana móvil daba 3.003 y arrancaba a media tarde).
//
// Lo que estas pruebas NO pueden ver: el entorno corre en UTC, así que leer las
// fechas a mano en vez de con `new Date('2026-08-09')` no cambia el resultado
// aquí. Lo que sí se prueba es que una fecha imposible no rueda al mes
// siguiente, que es la otra mitad de la misma lectura manual.
import { ventanaEnCastellano } from '@/modules/kitchen/lib/extrasDeCocina'
import { intervaloDeFechas } from '@/modules/ventas/services/textoInforme'

describe('las fechas de la ventana', () => {
  it('escribe los dos días que dice la consulta, sin tocarlos', () => {
    expect(ventanaEnCastellano('2026-08-09', '2026-09-07', intervaloDeFechas))
      .toBe('vendido del 9 de agosto al 7 de septiembre')
  })

  // El límite de arriba es EXCLUSIVO en `intervaloDeFechas`: sin pasarle la
  // medianoche siguiente diría «al 6» y se comería el último día, que sí está
  // contado.
  it('el último día contado entra en la frase', () => {
    expect(ventanaEnCastellano('2026-08-09', '2026-09-07', intervaloDeFechas))
      .toContain('al 7 de septiembre')
  })

  // La coletilla de la hora es el dato en Informes; aquí es ruido, y además
  // sería el segundo reloj entrando por la puerta de atrás.
  it('no arrastra la hora', () => {
    expect(ventanaEnCastellano('2026-08-09', '2026-09-07', intervaloDeFechas))
      .not.toContain('hasta las')
  })

  it('cruza el cambio de año sin romperse', () => {
    expect(ventanaEnCastellano('2026-12-12', '2027-01-10', intervaloDeFechas))
      .toBe('vendido del 12 de diciembre al 10 de enero')
  })

  // Un solo día contado se lee como un solo día.
  it('una ventana de un día se lee entera', () => {
    expect(ventanaEnCastellano('2026-09-07', '2026-09-07', intervaloDeFechas))
      .toContain('7 de septiembre')
  })

  // B82: la cabecera se pinta aunque las fechas no se puedan leer.
  it('una fecha ilegible devuelve null, no un error', () => {
    expect(ventanaEnCastellano('no es una fecha', '2026-09-07', intervaloDeFechas)).toBeNull()
    expect(ventanaEnCastellano(null, '2026-09-07', intervaloDeFechas)).toBeNull()
    expect(ventanaEnCastellano('2026-08-09', null, intervaloDeFechas)).toBeNull()
  })

  // `new Date(2026, 12, 1)` no falla: rueda a enero de 2027 y la cabecera
  // pintaría una ventana que nadie ha contado. Mejor sin fechas que con fechas
  // inventadas.
  it('una fecha que no existe devuelve null, no rueda al mes siguiente', () => {
    expect(ventanaEnCastellano('2026-13-01', '2026-09-07', intervaloDeFechas)).toBeNull()
    expect(ventanaEnCastellano('2026-02-30', '2026-09-07', intervaloDeFechas)).toBeNull()
  })
})
