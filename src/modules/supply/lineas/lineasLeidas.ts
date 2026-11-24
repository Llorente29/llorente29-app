// src/modules/supply/lineas/lineasLeidas.ts
//
// E10b (23/11) · Las líneas de artículo son de FOLVY, no de Sumied (Julio: «la versión larga no la veo
// útil en Sumied»): esta fila va en el detalle de la factura de Folvy, no en la ficha de Sumied.
//
// E10 · Las líneas de la factura: lo que dice la fila de las líneas, de lo que
// guarda la lectura (goods_receipt_ai_session.validation.lineas, solo en las que se leyeron
// por partes) y de las líneas de la factura. Para quien la mira, una factura larga es una
// más: sin «IA», ni «tokens», ni «cortada». Regla 7: si faltan, se dice cuántas de cuántas.

import { estadoVisto, type EstadoLineas } from '../../../../supabase/functions/_shared/lecturaPorPartes'
import { importeEs } from '@/modules/conta/documentos/fichaRecibida'

export type FilaLineas =
  | { tono: 'nada' }
  | { tono: 'leyendo'; texto: string }
  | { tono: 'bien'; texto: string; ver: boolean }
  | { tono: 'ambar'; texto: string; ver: boolean; leerFaltan: boolean }

const lineasDe = (n: number) => (n === 1 ? '1 línea' : `${n} líneas`)

/**
 * Lo que dice la fila. `lineas`: las que tiene la factura; `estado`: el de su lectura por partes
 * (null si se leyó entera de una vez, como casi todas).
 */
export function filaDeLineas(lineas: number, estado: EstadoLineas | null | undefined, ahora = Date.now()): FilaLineas {
  const e = estadoVisto(estado, ahora)
  if (e?.estado === 'leyendo') return { tono: 'leyendo', texto: 'Leyendo las líneas de la factura…' }
  // E10b · No se leyeron porque la empresa aún no recibía la mercancía con Folvy: se pueden leer ahora.
  if (e?.estado === 'faltan' && e.sin_folvy && e.leidas === 0) {
    const cuantas = e.esperadas !== null && e.esperadas > 0 ? `Sus ${e.esperadas} líneas` : 'Sus líneas'
    return { tono: 'ambar', texto: `${cuantas} aún no se han leído.`, ver: false, leerFaltan: true }
  }
  if (e?.estado === 'faltan') {
    const de = e.esperadas !== null && e.esperadas > e.leidas ? ` de ${e.esperadas}` : ''
    const paginas = e.sin_leer.length ? ` Falta${e.sin_leer.length === 1 ? ' la página' : 'n las páginas'} ${e.sin_leer.join(', ')}.` : ''
    return { tono: 'ambar', texto: `Leídas ${e.leidas}${de} líneas.${paginas}`, ver: lineas > 0, leerFaltan: true }
  }
  if (e?.cuadre && !e.cuadre.cuadra) {
    return { tono: 'ambar', texto: `${lineasDe(lineas)}: suman ${importeEs(e.cuadre.suman)} € y las bases ${importeEs(e.cuadre.base)} €.`, ver: lineas > 0, leerFaltan: false }
  }
  if (lineas === 0) return { tono: 'nada' }
  return { tono: 'bien', texto: lineasDe(lineas), ver: true }
}

/** Lo que dice al terminar «Leer las que faltan» (regla 8: con contenido). */
export function textoAlLeerFaltan(e: EstadoLineas | null): string {
  if (!e) return 'No le faltaba ninguna línea.'
  if (e.estado === 'completas') return `Leídas todas: ${lineasDe(e.leidas)}.`
  return `Siguen faltando: leídas ${e.leidas}${e.esperadas !== null && e.esperadas > e.leidas ? ` de ${e.esperadas}` : ''}. Escríbelas mirando el PDF, o vuelve a probar.`
}
