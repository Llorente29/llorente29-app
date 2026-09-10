// src/modules/supply/lib/conteoMovilTexto.ts
//
// Las palabras del móvil de quien cuenta. Van en `lib/` y no junto a los
// componentes por la lección del 05/09 (regla 31b): exportar funciones desde un
// fichero de componentes añade cinco avisos de `react-refresh`, y se midió el
// lint a los dos lados para verlo.
//
// Y van SUELTAS porque son lo que se prueba: «2 bolsas (5 kg) + 750 g» es la
// frase que lee alguien de pie delante de una cámara, y se prueba contra los
// formatos REALES del catálogo, no contra ejemplos inventados.

import { fmtQty, type CountFormat } from '@/modules/supply/services/countFormatService'

/** Lo abierto: o se pesa, o se calcula a ojo. Nunca las dos a la vez. */
export type Abierto =
  | { modo: 'peso'; gramos: string }
  | { modo: 'ojo'; formatId: string | null; fraccion: number | null; otros: string }

export const FRACCIONES: { v: number; label: string; pie: string }[] = [
  { v: 0.25, label: '¼', pie: 'poco' },
  { v: 0.5,  label: '½', pie: 'la mitad' },
  { v: 0.75, label: '¾', pie: 'casi llena' },
]

const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 })

/**
 * «2 bolsas», «2 × Bolsa cerrada».
 *
 * Sólo se pluraliza un nombre de UNA palabra. Con dos, el castellano hace
 * concordar las dos —«bolsa cerrada» → «bolsas cerradas»— y una regla que
 * añade una ese al final escribe «2 bolsa cerradas», que es exactamente lo que
 * salió en la primera captura a 390 px. Con «×» delante el nombre se queda
 * intacto y nunca hay una concordancia mal hecha en la pantalla de alguien.
 */
export function plural(n: number, nombre: string): string {
  const num = nf.format(n)
  if (n === 1) return `1 ${nombre.toLowerCase()}`
  if (nombre.trim().includes(' ')) return `${num} × ${nombre}`
  const b = nombre.toLowerCase()
  return `${num} ${/[aeiouáéíóú]$/.test(b) ? `${b}s` : `${b}es`}`
}

export function unidadLarga(abbr: string | null | undefined): string {
  switch ((abbr ?? '').toLowerCase()) {
    case 'g': return 'gramos'
    case 'kg': return 'kilos'
    case 'ml': return 'mililitros'
    case 'l': return 'litros'
    default: return 'unidades'
  }
}

/** «2 bolsas (5 kg) + 750 g». La frase de debajo del total. */
export function desglose(
  formats: CountFormat[],
  cuenta: Record<string, number>,
  abierto: Abierto,
  formatoRef: CountFormat | null,
  baseUnit: string | null,
): string {
  const trozos: string[] = []
  for (const f of formats) {
    const n = cuenta[f.id] ?? 0
    if (n <= 0) continue
    trozos.push(`${plural(n, f.name)} (${fmtQty(n * f.qtyInBase, baseUnit)})`)
  }
  if (abierto.modo === 'peso') {
    const g = Number(abierto.gramos.replace(',', '.'))
    if (Number.isFinite(g) && g > 0) trozos.push(fmtQty(g, baseUnit))
  } else {
    const ref = formats.find(f => f.id === abierto.formatId) ?? formatoRef
    if (abierto.fraccion != null && ref) {
      const etiqueta = FRACCIONES.find(f => f.v === abierto.fraccion)?.label ?? `${abierto.fraccion}`
      trozos.push(`${etiqueta} ${ref.name.toLowerCase()} a ojo`)
    } else {
      const g = Number(abierto.otros.replace(',', '.'))
      if (Number.isFinite(g) && g > 0) trozos.push(`${fmtQty(g, baseUnit)} a ojo`)
    }
  }
  return trozos.join(' + ')
}
