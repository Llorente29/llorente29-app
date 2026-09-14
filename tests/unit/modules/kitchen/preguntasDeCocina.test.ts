// El tablero 1 de Modificadores (la lista de preguntas). Todo el castellano
// vive en `lib/` y esto lo fija.
//
// LOS DATOS SON LOS REALES de Foodint, sacados el 12/09 de la propia RPC
// `modificadores_lista_preguntas` ejecutada contra producción (regla 31). No
// son ejemplos escritos de memoria, y ya ha servido: «¿Quieres añadir un
// postre?.» tiene `max: 100` de verdad, y con un ejemplo inventado de 5 la
// frase «Añadir hasta 100» habría salido a producción sin que nadie la viera.

import { describe, it, expect } from 'vitest'
import {
  quePuedeHacerElCliente, queHaceEnElPlato, opcionesEnTexto, platosEnTexto,
  platosPreocupa, pastillas, textoDelBoton, porQueNoSeEdita, lineaDeEtiquetaVieja,
  cifraConBase, cuantasActivas, ordena, tituloDeLaFranja, detalleDeLaFranja,
  tituloSinPlato, lineaSinPlato, loQueLastTeHaDeshecho, porQueNoSale, repartoDeLaFranja, loAnuladoDeLaFranja, subtituloDeMarca, chipDeMasMarcas, elPieDeLaLista,
  MARCAS_A_LA_VISTA,
  type Pregunta,
} from '@/modules/kitchen/lib/preguntasDeCocina'
import { MARCAS_REALES, SIN_PLATO_REALES } from './fixtures/preguntasReales'

const P = (o: Partial<Pregunta> = {}): Pregunta => ({
  id: 'x', nombre: 'X', tipo: 'elige', dePago: false, min: 0, max: 1,
  obligatoria: false, repetible: false, activa: true, origen: 'propia',
  cedida: false, editable: true, etiquetaVieja: false,
  opciones: 0, opcionesCobran: 0, opcionesRetiradas: 0, sinDecidir: 0, platos: 0,
  copias: 1, reglasDistintas: false, accion: 'abrir', marca: null, ...o,
})

// ── Las cuatro filas REALES del 12/09 ───────────────────────────────────────

/** Meraki Pita. Dos copias con reglas distintas y las 3 opciones sin decidir. */
const SALSA_PITA = P({
  id: 'f4a609bb-cf48-4223-9da4-f86024ae6093', nombre: 'Escoge una salsa para tu pita',
  tipo: 'elige', min: 1, max: 3, obligatoria: true, dePago: false,
  origen: 'lastapp', cedida: false, editable: true, etiquetaVieja: true,
  opciones: 3, opcionesCobran: 0, sinDecidir: 3, platos: 2,
  copias: 2, reglasDistintas: true, accion: 'revisar',
})

/** Ay Mamita Bowls, marca CEDIDA. Todo decidido, 11 opciones y todas cobran. */
const COMPLETA_TU_PEDIDO = P({
  id: 'e824ddcc-71b1-4a66-a09b-c1a696f6d47b', nombre: 'Completa Tu Pedido - Ay Mamita',
  tipo: 'elige', min: 0, max: 10, obligatoria: false, dePago: true,
  origen: 'lastapp', cedida: true, editable: false, etiquetaVieja: false,
  opciones: 11, opcionesCobran: 11, sinDecidir: 0, platos: 5,
  copias: 1, reglasDistintas: false, accion: 'abrir',
})

/** Marca propia con la etiqueta vieja, y el `max: 100` que enseñó la lección. */
const POSTRE = P({
  id: '52840848-0963-4de9-bf44-9f2c8cc5b58a', nombre: '¿Quieres añadir un postre?.',
  tipo: 'anade', min: 0, max: 100, obligatoria: false, dePago: true,
  origen: 'lastapp', cedida: false, editable: true, etiquetaVieja: true,
  opciones: 2, opcionesCobran: 2, sinDecidir: 0, platos: 30,
  copias: 1, reglasDistintas: false, accion: 'abrir',
})

/** Lobbers, cedida, y en NINGÚN plato activo: su plato se retiró. */
const DOS_DISCOS = P({
  id: '87295714-5201-4967-9513-3d08f3c51326', nombre: '¿Quieres dos discos de carne o solo uno?',
  tipo: 'elige', min: 1, max: 1, obligatoria: true, dePago: true,
  origen: 'lastapp', cedida: true, editable: false, etiquetaVieja: false,
  opciones: 2, opcionesCobran: 1, sinDecidir: 0, platos: 0,
  copias: 1, reglasDistintas: false, accion: 'abrir', marca: 'Lobbers',
})

describe('qué puede hacer el cliente', () => {
  it('obligatoria de una: «Elegir 1 · obligatoria»', () => {
    expect(quePuedeHacerElCliente(DOS_DISCOS)).toBe('Elegir 1 · obligatoria')
  })
  it('obligatoria de rango: dice el rango', () => {
    expect(quePuedeHacerElCliente(SALSA_PITA)).toBe('Elegir de 1 a 3 · obligatoria')
  })
  it('elección libre con tope: «Elegir hasta 10»', () => {
    expect(quePuedeHacerElCliente(COMPLETA_TU_PEDIDO)).toBe('Elegir hasta 10')
  })
  it('LA LECCIÓN DEL DATO REAL: max 100 no se escribe, se dice lo que significa', () => {
    expect(quePuedeHacerElCliente(POSTRE)).toBe('Añadir los que quiera')
    expect(quePuedeHacerElCliente(POSTRE)).not.toContain('100')
  })
  it('quitar se dice quitar', () => {
    expect(quePuedeHacerElCliente(P({ tipo: 'quita', max: 2 }))).toBe('Quitar hasta 2')
  })
  it('cross_sell añade, que es lo que hace', () => {
    expect(quePuedeHacerElCliente(P({ tipo: 'cross_sell', max: 3 }))).toBe('Añadir hasta 3')
  })
})

describe('qué hace en el plato', () => {
  it('de pago se dice', () => {
    expect(queHaceEnElPlato(POSTRE)).toBe('Añade · de pago')
  })
  it('gratis no se adorna', () => {
    expect(queHaceEnElPlato(SALSA_PITA)).toBe('Elige')
  })
  it('quitar siempre es gratis', () => {
    expect(queHaceEnElPlato(P({ tipo: 'quita', dePago: true }))).toBe('Quita · gratis')
  })
})

describe('las columnas', () => {
  it('opciones dice cuántas cobran, y en singular cuando es una', () => {
    expect(opcionesEnTexto(COMPLETA_TU_PEDIDO)).toBe('11 · 11 cobran')
    expect(opcionesEnTexto(DOS_DISCOS)).toBe('2 · 1 cobra')
    expect(opcionesEnTexto(SALSA_PITA)).toBe('3')
  })
  it('«Ninguno» cuando no está en ningún plato — y NO va en rojo', () => {
    expect(platosEnTexto(DOS_DISCOS)).toBe('Ninguno')
    expect(platosEnTexto(POSTRE)).toBe('30 platos')
    // Las únicas filas con «Ninguno» están en la sección que trata
    // precisamente de las que no están en ningún plato. Allí el rojo no dice
    // nada que el rótulo no diga ya, y gastarlo ahí se lo quita a lo que sí
    // pide acción (Julio, 12/09 12:10).
    expect(platosPreocupa(DOS_DISCOS)).toBe(false)
    expect(platosPreocupa(POSTRE)).toBe(false)
  })
})

describe('las pastillas', () => {
  it('copias con reglas distintas NO dice «copiada»: dice que no cuadran', () => {
    const t = pastillas(SALSA_PITA).map((x) => x.texto)
    expect(t).toContain('Mismo nombre, reglas distintas')
    expect(t).not.toContain('Copiada 2 veces')
    expect(t).toContain('3 sin decidir')
  })
  it('copias con las mismas reglas sí se pueden juntar', () => {
    expect(pastillas(P({ copias: 4 })).map((x) => x.texto)).toContain('Copiada 4 veces')
  })
  it('una cedida avisa de que se cambia en Last', () => {
    expect(pastillas(COMPLETA_TU_PEDIDO).map((x) => x.texto)).toContain('Se cambia en Last')
  })
  it('una apagada se etiqueta, no se esconde (regla 7)', () => {
    expect(pastillas(P({ activa: false })).map((x) => x.texto)).toContain('Apagada')
  })
  it('una fila limpia no inventa pastillas', () => {
    expect(pastillas(POSTRE)).toEqual([])
  })
})

describe('el botón, uno solo por fila', () => {
  it('cada acción tiene su palabra', () => {
    expect(textoDelBoton('revisar')).toBe('Revisar')
    expect(textoDelBoton('juntar')).toBe('Juntar')
    expect(textoDelBoton('abrir')).toBe('Abrir')
  })
})

describe('los candados, que es lo que se corrigió el 12/09', () => {
  it('una CEDIDA no se edita, y lo dice', () => {
    expect(porQueNoSeEdita(COMPLETA_TU_PEDIDO)).toMatch(/la manda Last/)
  })
  it('una marca PROPIA con la etiqueta vieja SÍ se edita', () => {
    expect(POSTRE.etiquetaVieja).toBe(true)
    expect(porQueNoSeEdita(POSTRE)).toBeNull()
  })
  it('y la etiqueta vieja se explica en vez de callarse', () => {
    expect(lineaDeEtiquetaVieja(POSTRE)).toMatch(/importación antigua/)
    expect(lineaDeEtiquetaVieja(COMPLETA_TU_PEDIDO)).toBeNull()
  })
})

describe('la base viaja con la cifra (Julio, 11:52)', () => {
  it('65 y 56 se dicen juntas, no sueltas', () => {
    expect(cifraConBase(65, 56, 'pregunta', 'preguntas')).toBe('65 preguntas · 56 activas')
  })
  it('cuenta las activas de toda la salida, lista y sin plato', () => {
    const marcas = [{ id: 'm', nombre: 'M', cedida: false, preguntas: [POSTRE, P({ activa: false })] }]
    expect(cuantasActivas(marcas, [DOS_DISCOS])).toBe(2)
  })
})

describe('el orden', () => {
  it('las apagadas bajan, pero siguen estando', () => {
    const apagada = P({ id: 'off', activa: false })
    const r = ordena([apagada, POSTRE])
    expect(r.map((x) => x.id)).toEqual(['52840848-0963-4de9-bf44-9f2c8cc5b58a', 'off'])
    expect(r).toHaveLength(2)
  })
})

describe('la franja, sin porcentaje a propósito', () => {
  // POBLACIÓN REAL, 13/09 20:15, ya con la regla nueva: un pedido anulado no
  // es demanda, así que las 21 líneas de pedidos anulados salen de las cifras
  // de arriba y se cuentan aparte. Medido con la misma consulta que va a
  // quedar dentro de la RPC, y cuadra por los dos lados: 1171+262 = 1433 y
  // 1095+338 = 1433.
  const franja = {
    vendidas: 1433, conQueLleva: 1171, sinDecidir: 262, desconocidas: 0,
    cedidas: 1095, propias: 338, anuladas: 21,
  }
  const ventana = { dias: 30, desde: '2026-08-14', hasta: '2026-09-13' }
  it('el titular dice el periodo y el volumen', () => {
    expect(tituloDeLaFranja(franja, ventana)).toBe('De los extras vendidos en 30 días, 1433 líneas')
  })
  it('NO pinta un porcentaje que el tablero 7 todavía no puede explicar', () => {
    expect(tituloDeLaFranja(franja, ventana)).not.toContain('%')
    expect(detalleDeLaFranja(franja)).not.toContain('%')
  })
  it('y el reparto cedida/propia sale del detalle: es un reparto, no una alarma', () => {
    expect(detalleDeLaFranja(franja)).not.toContain('cedida')
    expect(detalleDeLaFranja(franja)).toContain('sin decidir')
    expect(repartoDeLaFranja(franja)).toBe('De marca cedida 1095, de marca propia 338.')
  })
  it('🔴 lo anulado se dice SIEMPRE, también cuando es cero', () => {
    // Restar 21 líneas callando deja a quien mira sin saber por qué el número
    // bajó de 1.454 a 1.433, y la vez siguiente ya no se cree ninguno de los
    // dos. La frase no es opcional: es la mitad que explica la resta.
    expect(loAnuladoDeLaFranja(franja)).toContain('21')
    expect(loAnuladoDeLaFranja(franja)).toContain('no es demanda')
    expect(loAnuladoDeLaFranja({ ...franja, anuladas: 0 })).toBe('Ningún pedido anulado en la ventana.')
    expect(loAnuladoDeLaFranja({ ...franja, anuladas: 0 })).not.toBe('')
  })
  it('y cuando no hay desconocidas, no se inventa la frase', () => {
    expect(detalleDeLaFranja(franja)).not.toContain('no conoce')
    expect(detalleDeLaFranja({ ...franja, desconocidas: 14 })).toContain('14 que Folvy no conoce')
  })
})

describe('las que no están en ningún plato', () => {
  it('el titular lleva las dos cifras', () => {
    expect(tituloSinPlato(15, 45)).toBe('15 preguntas en ningún plato · 45 opciones')
    expect(tituloSinPlato(1, 1)).toBe('1 pregunta en ningún plato · 1 opción')
  })
})

// ── Lo que salió al pintar la captura con las 65 ───────────────────────────
// Estas cuatro no las escribí al construir la pantalla: aparecieron al poner
// la población entera delante. Van con las filas reales que las destaparon.

describe('una pregunta sin ninguna opción no sale, y lo dice', () => {
  const TODAS = [...MARCAS_REALES.flatMap((m) => m.preguntas), ...SIN_PLATO_REALES]
  const vacias = TODAS.filter((p) => p.opciones === 0)

  it('contando ACTIVAS son nueve, no tres — y no me las he inventado', () => {
    // Con el total eran tres. Contando sólo lo que se puede vender hoy son
    // nueve: seis más se quedan sin ninguna opción viva.
    expect(vacias).toHaveLength(9)
    expect(TODAS.filter((p) => p.opcionesRetiradas > 0)).toHaveLength(10)
  })

  it('y LAS NUEVE están apagadas: ninguna pregunta viva se queda muda', () => {
    expect(vacias.filter((p) => p.activa)).toHaveLength(0)
  })

  it('por eso hoy la pastilla roja no sale en ninguna fila, y está bien', () => {
    // La pastilla es para lo accionable. Una pregunta apagada ya dice por qué
    // no sale; repetirlo en rojo no añade nada que hacer.
    for (const p of TODAS) {
      const tiene = pastillas(p).some((c) => c.texto === 'Sin opciones: no sale')
      expect(tiene).toBe(p.opciones === 0 && p.activa)
    }
    expect(TODAS.filter((p) => pastillas(p).some((c) => c.texto === 'Sin opciones: no sale'))).toHaveLength(0)
  })

  it('pero en cuanto una viva se quede sin opciones, lo dice', () => {
    const viva = P({ opciones: 0, activa: true })
    expect(pastillas(viva).some((c) => c.texto === 'Sin opciones: no sale')).toBe(true)
    expect(porQueNoSale(viva)).toBe('No sale en las plataformas: no tiene ninguna opción activa.')
    expect(porQueNoSale(P({ opciones: 0, activa: false }))).toBeNull()
    expect(porQueNoSale(P({ opciones: 1, activa: true }))).toBeNull()
  })

  it('las retiradas se cuentan aparte, en gris, nunca en rojo', () => {
    const kebab = MARCAS_REALES.flatMap((m) => m.preguntas)
      .find((p) => p.nombre === '1. Escoge tu primer kebab')!
    expect(kebab.opciones).toBe(3)
    expect(kebab.opcionesRetiradas).toBe(3)
    const chapa = pastillas(kebab).find((c) => c.texto === '3 retiradas')!
    expect(chapa.tono).toBe('apagado')
    expect(pastillas(P({ opciones: 1, opcionesRetiradas: 1 })).some((c) => c.texto === '1 retirada')).toBe(true)
    expect(pastillas(P({ opciones: 1, opcionesRetiradas: 0 })).some((c) => c.texto.includes('retirada'))).toBe(false)
  })
})

describe('la cabecera de la marca dice lo que SÍ se puede hacer', () => {
  it('la cedida no se queda en «aquí no pintas nada»', () => {
    expect(subtituloDeMarca(true)).toContain('la carta la manda Last')
    expect(subtituloDeMarca(true)).toContain('lo que lleva cada opción')
  })
  it('la propia, corta', () => {
    expect(subtituloDeMarca(false)).toBe('Marca propia · se edita aquí')
  })
})

describe('los chips de marca', () => {
  it('con 14 marcas quedan 9 detrás del chip de más', () => {
    expect(MARCAS_REALES).toHaveLength(14)
    expect(chipDeMasMarcas(MARCAS_REALES.length - MARCAS_A_LA_VISTA)).toBe('+ 9 marcas')
  })
  it('y en singular no dice «1 marcas»', () => {
    expect(chipDeMasMarcas(1)).toBe('+ 1 marca')
  })
})

describe('el pie explica la palabra que más se repite', () => {
  it('«Qué lleva», que es la que nadie sabe de dónde sale', () => {
    expect(elPieDeLaLista()).toContain('se descuenta del almacén')
    expect(elPieDeLaLista()).toContain('suma al coste del plato')
  })
})

describe('las cifras de la cabecera cuadran con las filas', () => {
  it('65 en total y 56 activas, contadas de las filas mismas', () => {
    const enMarcas = MARCAS_REALES.reduce((a, m) => a + m.preguntas.length, 0)
    expect(enMarcas + SIN_PLATO_REALES.length).toBe(65)
    expect(cuantasActivas(MARCAS_REALES, SIN_PLATO_REALES)).toBe(56)
  })
  it('y las 15 sin plato suman 21 opciones vivas, no 45: 24 estaban retiradas', () => {
    const opciones = SIN_PLATO_REALES.reduce((a, p) => a + p.opciones, 0)
    const retiradas = SIN_PLATO_REALES.reduce((a, p) => a + p.opcionesRetiradas, 0)
    expect(SIN_PLATO_REALES).toHaveLength(15)
    expect(opciones).toBe(21)
    expect(retiradas).toBe(24)
    expect(tituloSinPlato(SIN_PLATO_REALES.length, opciones))
      .toBe('15 preguntas en ningún plato · 21 opciones')
  })
})

describe('la línea de debajo en la sección sin plato', () => {
  it('dice la marca, que es lo único que la fila no lleva ya', () => {
    const conMarca = SIN_PLATO_REALES.find((p) => p.marca === 'Milanesa House')!
    expect(lineaSinPlato(conMarca)).toBe('Marca: Milanesa House')
  })
  it('y no repite por tercera vez que no está en ningún plato', () => {
    // El rótulo del panel ya lo dice, y la columna «En platos» pone «Ninguno».
    for (const p of SIN_PLATO_REALES) {
      expect(lineaSinPlato(p)).not.toContain('ningún plato')
      expect(platosEnTexto(p)).toBe('Ninguno')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// A2c HABLA CUANDO DESHACE LO DE UNA PERSONA (14/09)
// ═══════════════════════════════════════════════════════════════════════════
// Medido en producción antes de escribir esto: 80 opciones apagadas en
// Foodint, 72 por una persona y 1 por el importador. Las 72 están todas en
// marcas propias y el raíl de A2c sólo entra en cedidas, así que hoy la
// colisión no ocurre — pero `deleteModifierOption` apaga por REST sin mirar
// de quién es la marca, y está en pantalla. Está a un clic.

describe('cuando Last deshace lo que quitó una persona', () => {
  const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-ES')
  const F = (o: Partial<{ activa: boolean; reencendidaSobre: string | null; reencendidaAt: string | null }> = {}) =>
    ({ activa: true, reencendidaSobre: 'persona', reencendidaAt: '2026-09-14T02:11:00Z', ...o })

  it('🔴 lo dice, y dice qué hacer para que no vuelva a pasar', () => {
    const t = loQueLastTeHaDeshecho(F(), fecha)!
    expect(t).toContain('La habías quitado')
    expect(t).toContain('quitarla TAMBIÉN en Last')
    expect(t).toContain('volverá a encenderse cada noche')
  })

  it('🔴 y NO dice una hora: dice «de madrugada»', () => {
    // La hora de la pasada es cosa nuestra y cambia. Lo que le importa a quien
    // lo lee es que pasó mientras no estaba.
    const t = loQueLastTeHaDeshecho(F(), fecha)!
    expect(t).toContain('de madrugada')
    expect(t).not.toMatch(/\d{1,2}:\d{2}/)
  })

  it('lleva la fecha si la hay, y se apaña sin ella', () => {
    expect(loQueLastTeHaDeshecho(F(), fecha)!).toContain('el 14/9/2026')
    expect(loQueLastTeHaDeshecho(F({ reencendidaAt: null }), fecha)!).toContain('a la venta.')
  })

  it('sin marca no se pinta nada: un aviso que sale siempre deja de leerse', () => {
    expect(loQueLastTeHaDeshecho(F({ reencendidaSobre: null }), fecha)).toBeNull()
  })

  it('🔴 y APAGADA tampoco, aunque la marca siga puesta', () => {
    // Si está apagada es que alguien ya la volvió a quitar. En la base la marca
    // se limpia sola al apagarla, pero la pantalla no debe depender de que el
    // disparador no falle nunca.
    expect(loQueLastTeHaDeshecho(F({ activa: false }), fecha)).toBeNull()
  })
})
