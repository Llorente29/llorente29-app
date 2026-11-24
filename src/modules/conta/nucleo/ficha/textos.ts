// src/modules/conta/nucleo/ficha/textos.ts
//
// K04 · Lo que dicen las piezas de una ficha del núcleo: las cifras («1.240,00»)
// y la ayuda de teclas del pie, como la maqueta.

const euros = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })
export const cifra = (n: number | null | undefined): string => (n === null || n === undefined ? '' : euros.format(n))

/** La ayuda de teclas del pie, como la maqueta (decisiones 11 y 12). */
export const TECLAS_DE_LA_FICHA: readonly { tecla: string; texto: string }[] = [
  { tecla: 'Intro', texto: 'guarda y pasa a la siguiente' },
  { tecla: 'Tab', texto: 'casilla siguiente' },
  { tecla: 'F4', texto: 'busca la cuenta o el proveedor' },
  { tecla: 'F5', texto: 'abre el mayor de la cuenta en otra pestaña' },
  { tecla: 'F8', texto: 'cambia a emitida o a asiento' },
  { tecla: 'Esc', texto: 'la deja sin guardar' },
]

/** K05 · La de la emitida: F4 busca el cliente, y F8 cambia a la recibida o al asiento (la maqueta repite la de la recibida). */
export const TECLAS_DE_LA_EMITIDA: readonly { tecla: string; texto: string }[] = TECLAS_DE_LA_FICHA.map((t) =>
  t.tecla === 'F4' ? { ...t, texto: 'busca la cuenta o el cliente' } : t.tecla === 'F8' ? { ...t, texto: 'cambia a recibida o a asiento' } : t)
