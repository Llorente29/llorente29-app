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
  tituloSinPlato,
  type Pregunta,
} from '@/modules/kitchen/lib/preguntasDeCocina'

const P = (o: Partial<Pregunta> = {}): Pregunta => ({
  id: 'x', nombre: 'X', tipo: 'elige', dePago: false, min: 0, max: 1,
  obligatoria: false, repetible: false, activa: true, origen: 'propia',
  cedida: false, editable: true, etiquetaVieja: false,
  opciones: 0, opcionesCobran: 0, sinDecidir: 0, platos: 0,
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
  it('«Ninguno» cuando no está en ningún plato, y preocupa', () => {
    expect(platosEnTexto(DOS_DISCOS)).toBe('Ninguno')
    expect(platosPreocupa(DOS_DISCOS)).toBe(true)
    expect(platosEnTexto(POSTRE)).toBe('30 platos')
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
  const franja = { vendidas: 1378, conQueLleva: 859, sinDecidir: 519, desconocidas: 0, cedidas: 1087, propias: 291 }
  const ventana = { dias: 30, desde: '2026-08-13', hasta: '2026-09-12' }
  it('el titular dice el periodo y el volumen', () => {
    expect(tituloDeLaFranja(franja, ventana)).toBe('De los extras vendidos en 30 días, 1378 líneas')
  })
  it('NO pinta un porcentaje que el tablero 7 todavía no puede explicar', () => {
    expect(tituloDeLaFranja(franja, ventana)).not.toContain('%')
    expect(detalleDeLaFranja(franja)).not.toContain('%')
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
