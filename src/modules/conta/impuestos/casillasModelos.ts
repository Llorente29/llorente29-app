// src/modules/conta/impuestos/casillasModelos.ts
//
// I01c (20/10, revisión de Julio, punto 4) · «Qué es» cada casilla del 111, el
// 115 y el 202, en palabras. Transcritas de los impresos oficiales EN BLANCO de
// la AEAT (Modelo 111 «Retenciones e ingresos a cuenta del IRPF», Modelo 115
// «Retenciones e ingresos a cuenta · arrendamiento de inmuebles urbanos» y
// Modelo 202 «Pago fraccionado · Impuesto sobre Sociedades», página de la
// liquidación), no escritas de memoria. El 202 es el impreso con la numeración
// de 2025 (Orden HAC/262/2025): la modalidad 40.2 son la [01], la [02] y la [03].
// Los rótulos van en palabras de oficina; el número de la casilla, el oficial.
// Las del 303 salen de su diseño de registro (casillas303.ts, generado).

import { CASILLAS_303 } from './casillas303'

const C111: Readonly<Record<string, string>> = {
  '01': 'Nóminas en dinero · número de perceptores',
  '02': 'Nóminas en dinero · importe de las percepciones',
  '03': 'Nóminas en dinero · retenciones',
  '04': 'Nóminas en especie · número de perceptores',
  '05': 'Nóminas en especie · valor de las percepciones',
  '06': 'Nóminas en especie · ingresos a cuenta',
  '07': 'Profesionales y actividades en dinero · número de perceptores',
  '08': 'Profesionales y actividades en dinero · importe de las percepciones',
  '09': 'Profesionales y actividades en dinero · retenciones',
  '10': 'Profesionales y actividades en especie · número de perceptores',
  '11': 'Profesionales y actividades en especie · valor de las percepciones',
  '12': 'Profesionales y actividades en especie · ingresos a cuenta',
  '13': 'Premios en metálico · número de perceptores',
  '14': 'Premios en metálico · importe de los premios',
  '15': 'Premios en metálico · retenciones',
  '16': 'Premios en especie · número de perceptores',
  '17': 'Premios en especie · valor de los premios',
  '18': 'Premios en especie · ingresos a cuenta',
  '19': 'Aprovechamientos forestales en dinero · número de perceptores',
  '20': 'Aprovechamientos forestales en dinero · importe de las percepciones',
  '21': 'Aprovechamientos forestales en dinero · retenciones',
  '22': 'Aprovechamientos forestales en especie · número de perceptores',
  '23': 'Aprovechamientos forestales en especie · valor de las percepciones',
  '24': 'Aprovechamientos forestales en especie · ingresos a cuenta',
  '25': 'Derechos de imagen · número de perceptores',
  '26': 'Derechos de imagen · contraprestaciones pagadas',
  '27': 'Derechos de imagen · ingresos a cuenta',
  '28': 'Suma de retenciones e ingresos a cuenta',
  '29': 'A deducir: lo ingresado en la declaración anterior (solo complementarias)',
  '30': 'Resultado a ingresar',
}

const C115: Readonly<Record<string, string>> = {
  '01': 'Número de arrendadores',
  '02': 'Base de las retenciones (alquileres pagados)',
  '03': 'Retenciones practicadas',
  '04': 'A deducir: lo ingresado en la declaración anterior (solo complementarias)',
  '05': 'Resultado a ingresar',
}

// S02 · El 190: no hay impreso con casillas; son los tres totales del registro
// de declarante del diseño (anexo de la Orden EHA/3127/2009, posiciones
// 136-175), con su nombre en palabras.
const C190: Readonly<Record<string, string>> = {
  '01': 'Número de percepciones (un registro por perceptor y clave)',
  '02': 'Importe total de las percepciones',
  '03': 'Total de las retenciones e ingresos a cuenta',
}

// S02 · El 180: igual, los tres totales del registro de declarante del anexo VI
// de la Orden de 21/11/2000 (posiciones 136-175).
const C180: Readonly<Record<string, string>> = {
  '01': 'Número total de perceptores (cada arrendador una vez)',
  '02': 'Base de las retenciones: lo pagado por los alquileres, sin IVA',
  '03': 'Total de las retenciones e ingresos a cuenta',
}

const C202: Readonly<Record<string, string>> = {
  '01': 'Base del pago fraccionado (modalidad del artículo 40.2)',
  '02': 'Resultado de la declaración anterior (solo complementarias)',
  '03': 'A ingresar (modalidad del artículo 40.2)',
  '04': 'Resultado contable (modalidad del artículo 40.3)',
  '13': 'Base imponible previa',
  '14': 'Compensación de bases imponibles negativas de periodos anteriores',
  '16': 'Base del pago fraccionado (un solo porcentaje)',
  '17': 'Porcentaje',
  '18': 'Resultado previo (un solo porcentaje)',
  '19': 'Base del pago fraccionado (varios porcentajes)',
  '26': 'Resultado previo',
  '27': 'Bonificaciones del periodo',
  '28': 'Retenciones e ingresos a cuenta del periodo',
  '29': 'Volumen de operaciones en territorio común (%)',
  '30': 'Pagos fraccionados anteriores del periodo',
  '31': 'Resultado de la declaración anterior (solo complementarias)',
  '32': 'Resultado',
  '33': 'Mínimo a ingresar (cifra de negocios de 10 millones o más)',
  '34': 'Cantidad a ingresar',
}

const POR_MODELO: Readonly<Record<string, Readonly<Record<string, string>>>> = { '111': C111, '115': C115, '180': C180, '190': C190, '202': C202 }

/**
 * El texto del diseño de registro del 303, en palabras: sin la fórmula entre
 * paréntesis («( [152] + [167] + … )», «([110] - [78])») ni el «· Cuota» del
 * final, que ya dice la columna Importe (Julio, 20/10: «qué es», en palabras).
 */
export function enPalabras303(texto: string): string {
  return texto
    .replace(/\s*\(\s*\[[^)]*\)\s*/g, ' ')
    .replace(/\s*·\s*Cuota\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * «Qué es» la casilla, en palabras. Si no está en el impreso que conocemos,
 * null: la fila sale igual (regla 7), con la casilla y su importe, sin inventar
 * un rótulo.
 */
export function queEsLaCasilla(modelo: string, casilla: string): string | null {
  const c = casilla.padStart(2, '0')
  if (modelo === '303') { const t = CASILLAS_303[c]?.texto; return t ? enPalabras303(t) : null }
  return POR_MODELO[modelo]?.[c] ?? null
}

/**
 * ¿La casilla es un porcentaje? (I01c, 20/10: los tipos [02], [05] y [08] del
 * 303 salían como «4,00 €».) Del diseño de registro, no de una lista a mano:
 * en el 303, las que el diseño llama «Tipo %» y la [65] («% Atribuible…»); en
 * el 202, la [17] (el porcentaje del pago fraccionado).
 */
export function esCasillaDePorcentaje(modelo: string, casilla: string): boolean {
  const c = casilla.padStart(2, '0')
  if (modelo === '303') { const t = CASILLAS_303[c]?.texto ?? ''; return /Tipo %$/.test(t) || t.startsWith('%') }
  return modelo === '202' && c === '17'
}
