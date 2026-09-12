// tests/unit/modules/kitchen/fixtures/preguntasReales.ts
//
// LAS 65 PREGUNTAS REALES DE FOODINT, tal y como las devuelve
// `modificadores_lista_preguntas('51ad1792-...', 30)` el 12/09/2026 a las
// 13:2x, YA CON LA CORRECCION DE LAS CIFRAS ACTIVAS. No son ejemplos: es la
// poblacion entera de la cuenta (regla 31).
//
// Lo que trae de nuevo respecto a la lectura de las 10:2x:
//   · `opciones` de cada fila son las ACTIVAS, y `opcionesRetiradas` al lado.
//   · Diez preguntas tienen opciones retiradas. Seis se quedan en cero
//     activas, y las seis estan apagadas.
//   · Las 15 sin plato suman 21 opciones activas, no 45: 24 estaban retiradas.
//
// Si esto se vuelve a generar, se genera ENTERO: media poblacion es una
// poblacion inventada.

import type { Pregunta, MarcaConPreguntas } from '@/modules/kitchen/lib/preguntasDeCocina'

// En produccion el id es un uuid. Aqui se numera al vuelo porque hay filas
// IDENTICAS de verdad --«Quieres quitar aguna salsa de tu kebab?» existe cuatro
// veces en The Urban Kebab con los mismos numeros-- y un id repetido haria que
// React pintara una sola. Esas cuatro son justamente el caso de «Juntar».
let n = 0

/** Constructor posicional: el mismo orden de campos que devuelve la RPC. */
function f(
  marca: string, nombre: string, tipo: Pregunta['tipo'], dePago: boolean,
  min: number, max: number, obligatoria: boolean, activa: boolean,
  opciones: number, opcionesCobran: number, opcionesRetiradas: number,
  sinDecidir: number, platos: number,
  copias: number, reglasDistintas: boolean, accion: Pregunta['accion'],
  cedida: boolean, etiquetaVieja: boolean,
): Pregunta {
  return {
    id: `p${++n}`,
    nombre, tipo, dePago, min, max, obligatoria, repetible: false, activa,
    origen: etiquetaVieja || cedida ? 'lastapp' : 'propia',
    cedida, editable: !cedida, etiquetaVieja,
    opciones, opcionesCobran, opcionesRetiradas, sinDecidir, platos,
    copias, reglasDistintas, accion, marca,
  }
}

const M1: Pregunta[] = [
  f('Bendito Burrito', 'Elige los ingredientes para tu Burrito/Bowl', 'elige', true, 2, 4, true, true, 6, 2, 0, 6, 1, 1, false, 'abrir', false, true),
  f('Bendito Burrito', 'Elige la proteína.', 'elige', true, 1, 1, true, true, 3, 1, 0, 3, 1, 1, false, 'abrir', false, true),
  f('Bendito Burrito', 'Elige la salsa de tu Burrito/Bowl.', 'elige', false, 1, 1, true, true, 3, 0, 0, 3, 1, 1, false, 'abrir', false, true),
  f('Bendito Burrito', '¿Quieres añadir un postre?.', 'anade', true, 0, 100, false, true, 2, 2, 0, 0, 30, 1, false, 'abrir', false, true),
  f('Bendito Burrito', 'Y una bebida?', 'cross_sell', true, 0, 10, false, true, 5, 5, 1, 0, 24, 1, false, 'abrir', false, true),
]

const M2: Pregunta[] = [
  f('Dirty Burger', '¿Quieres añadir un entrante?.', 'anade', true, 0, 300, false, true, 3, 3, 0, 1, 8, 1, false, 'abrir', false, true),
]

const M3: Pregunta[] = [
  f('Lovers Burgers', '¿Quieres pepinillos?', 'elige', false, 0, 1, false, true, 2, 0, 0, 1, 9, 1, false, 'abrir', false, false),
  f('Lovers Burgers', '¿Quieres acompañar con unas patatas?', 'elige', true, 0, 1, false, true, 1, 1, 0, 0, 10, 1, false, 'abrir', false, false),
  f('Lovers Burgers', '¿Quieres dos discos de carne o solo uno?', 'elige', true, 1, 1, true, true, 2, 1, 0, 0, 8, 1, false, 'abrir', false, false),
]

const M4: Pregunta[] = [
  f('Meraki Pita', 'Escoge una salsa para tu pita', 'elige', false, 1, 3, true, true, 3, 0, 0, 3, 2, 2, true, 'revisar', false, true),
  f('Meraki Pita', 'Escoge una salsa para tu pita', 'elige', false, 0, 2, false, true, 3, 0, 0, 3, 2, 2, true, 'revisar', false, true),
  f('Meraki Pita', 'Escoge una salsa para tu bowl/plato', 'elige', false, 1, 1, true, true, 3, 0, 0, 3, 7, 1, false, 'abrir', false, true),
  f('Meraki Pita', 'Quieres quitar aguna salsa de tu kebab?', 'quita', false, 0, 2, false, true, 2, 0, 0, 2, 4, 1, false, 'abrir', false, true),
  f('Meraki Pita', 'Te apetece un extra?', 'anade', true, 0, 10, false, true, 4, 2, 0, 2, 1, 1, false, 'abrir', false, true),
  f('Meraki Pita', '¿Le añadimos salsa?', 'elige', true, 0, 5, false, true, 3, 3, 0, 0, 1, 1, false, 'abrir', false, true),
  f('Meraki Pita', 'Algun extra en tu pita?', 'anade', true, 0, 5, false, true, 4, 4, 0, 0, 15, 1, false, 'abrir', false, true),
]

const M5: Pregunta[] = [
  f('Mila\'s Sandwiches', 'Escoge el tipo de milanesa para tu bocadillo', 'elige', true, 1, 1, true, true, 2, 1, 0, 0, 6, 1, false, 'abrir', false, true),
]

const M6: Pregunta[] = [
  f('Milanesa House', 'Escoge la base de tu bocata', 'elige', true, 1, 1, true, true, 2, 1, 1, 0, 6, 1, false, 'abrir', false, true),
  f('Milanesa House', 'Escoge la base de tu milanesa.', 'elige', true, 1, 1, true, true, 2, 1, 1, 0, 7, 1, false, 'abrir', false, true),
]

const M7: Pregunta[] = [
  f('Scandal Burgers', 'Busca la Burger de tu Combo', 'elige', true, 1, 1, true, true, 11, 8, 0, 11, 1, 1, false, 'abrir', false, true),
  f('Scandal Burgers', 'Incluye tus Hamburguesas', 'elige', true, 2, 2, true, true, 11, 7, 0, 11, 1, 1, false, 'abrir', false, true),
  f('Scandal Burgers', 'Escoge tu entrante', 'elige', true, 1, 1, true, true, 2, 1, 0, 2, 2, 1, false, 'abrir', false, true),
  f('Scandal Burgers', 'Te atreves con unas patatas?', 'elige', true, 1, 2, true, true, 2, 1, 0, 1, 11, 1, false, 'abrir', false, true),
]

const M8: Pregunta[] = [
  f('Smash Brothers Burgers', '¿Quieres quitar los pepinillos de tu Burger?', 'quita', false, 0, 1, false, true, 1, 0, 0, 0, 8, 1, false, 'abrir', false, true),
]

const M9: Pregunta[] = [
  f('The Urban Kebab', '2. Escoge tu segundo kebab', 'elige', false, 1, 1, true, true, 6, 0, 0, 6, 1, 1, false, 'abrir', false, true),
  f('The Urban Kebab', '1. Escoge la salsa para tu primer kebab', 'elige', false, 1, 3, true, true, 3, 0, 0, 3, 2, 1, false, 'abrir', false, true),
  f('The Urban Kebab', '1. Escoge tu primer kebab', 'elige', false, 1, 1, true, true, 3, 0, 3, 3, 2, 1, false, 'abrir', false, true),
  f('The Urban Kebab', '2. Escoge la salsa para tu segundo kebab', 'elige', false, 1, 3, true, true, 3, 0, 0, 3, 1, 1, false, 'abrir', false, true),
  f('The Urban Kebab', 'Escoge tu entrante favorito', 'elige', true, 1, 1, true, true, 4, 3, 0, 3, 2, 1, false, 'abrir', false, true),
  f('The Urban Kebab', 'Escoge una salsa para tu bowl/plato', 'elige', false, 1, 1, true, true, 3, 0, 0, 3, 7, 1, false, 'abrir', false, true),
  f('The Urban Kebab', 'Quieres quitar aguna salsa de tu kebab?', 'quita', false, 0, 2, false, true, 2, 0, 0, 2, 1, 4, false, 'juntar', false, false),
  f('The Urban Kebab', 'Quieres quitar aguna salsa de tu kebab?', 'quita', false, 0, 2, false, true, 2, 0, 0, 2, 1, 4, false, 'juntar', false, false),
  f('The Urban Kebab', 'Quieres quitar aguna salsa de tu kebab?', 'quita', false, 0, 2, false, true, 2, 0, 0, 2, 1, 4, false, 'juntar', false, false),
  f('The Urban Kebab', 'Quieres quitar aguna salsa de tu kebab?', 'quita', false, 0, 2, false, true, 2, 0, 0, 2, 1, 4, false, 'juntar', false, false),
  f('The Urban Kebab', '1. Elige el tipo de carne de tu primer Kebab', 'elige', true, 1, 1, true, true, 4, 3, 0, 2, 2, 1, false, 'abrir', false, true),
  f('The Urban Kebab', '2. Elige el tipo de carne de tu 2º Kebab', 'elige', true, 1, 1, true, true, 4, 3, 0, 2, 1, 1, false, 'abrir', false, true),
  f('The Urban Kebab', 'Elige la proteina de tu Keburger', 'elige', true, 1, 1, true, true, 3, 2, 0, 1, 2, 1, false, 'abrir', false, true),
  f('The Urban Kebab', 'Algun extra en tu pita?', 'anade', true, 0, 5, false, true, 4, 4, 0, 0, 1, 4, false, 'juntar', false, false),
  f('The Urban Kebab', 'Algun extra en tu pita?', 'anade', true, 0, 5, false, true, 4, 4, 0, 0, 1, 4, false, 'juntar', false, false),
  f('The Urban Kebab', 'Algun extra en tu pita?', 'anade', true, 0, 5, false, true, 4, 4, 0, 0, 1, 4, false, 'juntar', false, false),
  f('The Urban Kebab', 'Algun extra en tu pita?', 'anade', true, 0, 5, false, true, 4, 4, 0, 0, 1, 4, false, 'juntar', false, false),
]

const M10: Pregunta[] = [
  f('Ay Mamita Bowls', 'Completa Tu Pedido - Ay Mamita', 'elige', true, 0, 10, false, true, 11, 11, 0, 0, 5, 1, false, 'abrir', true, false),
]

const M11: Pregunta[] = [
  f('Big Mike´s Burger Joint', 'Extras (burger)', 'elige', true, 0, 5, false, true, 7, 7, 0, 3, 1, 1, false, 'abrir', true, false),
  f('Big Mike´s Burger Joint', 'Extra salsa T', 'anade', true, 0, 3, false, true, 1, 1, 0, 0, 11, 1, false, 'abrir', true, false),
  f('Big Mike´s Burger Joint', 'Extra Salsas a Escoger ', 'anade', true, 0, 10, false, true, 6, 6, 0, 0, 8, 1, false, 'abrir', true, false),
]

const M12: Pregunta[] = [
  f('Dos Coyotes', 'Dos Coyotes, extra de proteína.**', 'anade', true, 0, 2, false, true, 6, 5, 0, 3, 1, 1, false, 'abrir', true, false),
  f('Dos Coyotes', 'Escoge Tu Proteina Burrito - Dos Coyotes**', 'elige', false, 1, 1, true, true, 3, 0, 0, 3, 1, 1, false, 'abrir', true, false),
]

const M13: Pregunta[] = [
  f('Lobbers', '¿Quieres acompañar con unas patatas?', 'elige', true, 0, 1, false, true, 1, 1, 0, 0, 1, 1, false, 'abrir', true, false),
]

const M14: Pregunta[] = [
  f('Milanesa Haus', 'Milanesa Haus, elige tus 3 Toppings.**', 'elige', false, 1, 3, true, true, 8, 0, 0, 8, 2, 1, false, 'abrir', true, false),
  f('Milanesa Haus', 'Extra Salsa ', 'anade', true, 0, 10, false, true, 8, 8, 0, 1, 1, 1, false, 'abrir', true, false),
]

export const MARCAS_REALES: MarcaConPreguntas[] = [
  { id: 'b1', nombre: 'Bendito Burrito', cedida: false, preguntas: M1 },
  { id: 'b2', nombre: 'Dirty Burger', cedida: false, preguntas: M2 },
  { id: 'b3', nombre: 'Lovers Burgers', cedida: false, preguntas: M3 },
  { id: 'b4', nombre: 'Meraki Pita', cedida: false, preguntas: M4 },
  { id: 'b5', nombre: 'Mila\'s Sandwiches', cedida: false, preguntas: M5 },
  { id: 'b6', nombre: 'Milanesa House', cedida: false, preguntas: M6 },
  { id: 'b7', nombre: 'Scandal Burgers', cedida: false, preguntas: M7 },
  { id: 'b8', nombre: 'Smash Brothers Burgers', cedida: false, preguntas: M8 },
  { id: 'b9', nombre: 'The Urban Kebab', cedida: false, preguntas: M9 },
  { id: 'b10', nombre: 'Ay Mamita Bowls', cedida: true, preguntas: M10 },
  { id: 'b11', nombre: 'Big Mike´s Burger Joint', cedida: true, preguntas: M11 },
  { id: 'b12', nombre: 'Dos Coyotes', cedida: true, preguntas: M12 },
  { id: 'b13', nombre: 'Lobbers', cedida: true, preguntas: M13 },
  { id: 'b14', nombre: 'Milanesa Haus', cedida: true, preguntas: M14 },
]

/** Las 15 que no estan en ningun plato activo. 21 opciones activas, 24 retiradas. */
export const SIN_PLATO_REALES: Pregunta[] = [
  f('Lobbers', '¿Quieres dos discos de carne o solo uno?', 'elige', true, 1, 1, true, true, 2, 1, 0, 0, 0, 1, false, 'abrir', true, false),
  f('Lobbers', '¿Quieres pepinillos?', 'elige', false, 0, 1, false, true, 2, 0, 0, 0, 0, 1, false, 'abrir', true, false),
  f('Smash Brothers Burgers', 'Como quieres tu primera burger', 'elige', false, 1, 1, true, false, 0, 0, 2, 0, 0, 1, false, 'abrir', false, true),
  f('Smash Brothers Burgers', 'Como quieres tu segunda burger', 'elige', false, 1, 1, true, false, 0, 0, 2, 0, 0, 1, false, 'abrir', false, true),
  f('Mila\'s Sandwiches', 'Elige el tipo de milanesa para tu segundo bocadillo', 'elige', true, 1, 1, true, true, 2, 1, 0, 1, 0, 1, false, 'abrir', false, true),
  f('Mila\'s Sandwiches', 'Elige tu bocadillo', 'elige', true, 1, 1, true, true, 6, 3, 0, 0, 0, 1, false, 'abrir', false, true),
  f('Mila\'s Sandwiches', 'Elige tu segundo bocadillo', 'elige', true, 1, 1, true, true, 6, 3, 0, 3, 0, 1, false, 'abrir', false, true),
  f('Mila\'s Sandwiches', 'Escoge la salsa de tu entrante', 'elige', false, 0, 1, false, false, 0, 0, 0, 0, 0, 1, false, 'abrir', false, true),
  f('Smash Brothers Burgers', 'Escoge tu entrante', 'elige', false, 1, 1, true, false, 0, 0, 2, 0, 0, 1, false, 'abrir', false, true),
  f('Mila\'s Sandwiches', 'Escoge tu entrante', 'elige', true, 1, 1, true, true, 3, 1, 0, 3, 0, 1, false, 'abrir', false, true),
  f('Smash Brothers Burgers', 'Escoge tu primera burger', 'elige', false, 1, 1, true, false, 0, 0, 8, 0, 0, 1, false, 'abrir', false, true),
  f('Smash Brothers Burgers', 'Escoge tu segunda burger', 'elige', false, 1, 1, true, false, 0, 0, 8, 0, 0, 1, false, 'abrir', false, true),
  f('Milanesa House', 'Nuevo grupo', 'elige', false, 0, 1, false, false, 0, 0, 0, 0, 0, 2, false, 'juntar', false, false),
  f('Lovers Burgers', 'Nuevo grupo', 'elige', false, 0, 1, false, false, 0, 0, 0, 0, 0, 1, false, 'abrir', false, false),
  f('Milanesa House', 'Nuevo grupo', 'elige', false, 0, 1, false, false, 0, 0, 2, 0, 0, 2, false, 'juntar', false, false),
]

// Las cifras de cabecera, de la misma llamada y de la misma ventana.
// Cada una con SU base: lo que empuja a trabajar cuenta activas.
export const CIFRAS_REALES = {
  preguntas: 65,
  opciones: 241, opcionesActivas: 211,
  platosConPregunta: 137, platosActivos: 593,
  repetidasNombres: 4, repetidasPreguntas: 12,
  extrasDistintos: 46,
  opcionesDecididasActivas: 100,
  opcionesSinDecidir: 131, opcionesSinDecidirActivas: 111,
  opcionesSinDecidirCobran: 39, opcionesSinDecidirCobranActivas: 31,
}
export const FRANJA_REAL = {
  vendidas: 1379, conQueLleva: 872, sinDecidir: 507, desconocidas: 0,
  cedidas: 1088, propias: 291,
}
export const VENTANA_REAL = { dias: 30, desde: '2026-08-13', hasta: '2026-09-12' }
export const SIN_PLATO_CIFRAS = { preguntas: 15, opciones: 21, opcionesRetiradas: 24 }
