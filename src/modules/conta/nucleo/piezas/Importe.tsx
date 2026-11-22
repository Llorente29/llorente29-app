// src/modules/conta/nucleo/piezas/Importe.tsx
//
// K12b · La casilla de un importe de las piezas comunes: se escribe con punto o con coma decimal (el punto del
// teclado numérico, como en ERP10) y, al salir de ella o con Intro, se enseña en formato español: 1.849,56
// (leerImporte e importeVisto, en logica.ts).
//
// Un importe dudoso (más de dos cifras tras el decimal: «1.234», «12.345») se queda tal cual, con la casilla en ámbar
// y el motivo al pasar el ratón; la pantalla no lo guarda hasta corregirlo (leerImporte da NaN).
//
// Con Intro el importe se fija ANTES de las teclas de la pantalla; si Intro mueve el foco (la línea sube y se pasa a
// la siguiente), la salida que provoca no lo vuelve a fijar: lo haría con el importe de antes sobre la línea nueva.

import { useRef, type KeyboardEvent } from 'react'
import { MOTIVO_IMPORTE_DUDOSO, importeDudoso, importeVisto } from './logica'

export function CasillaImporte({ id, valor, poner, teclas, etiqueta }: {
  id: string; valor: string; poner: (texto: string) => void
  /** Las teclas de la pantalla, después de dejar el importe en su formato (Intro pasa a la siguiente, etc.). */
  teclas?: (e: KeyboardEvent<HTMLInputElement>) => void
  etiqueta?: string
}) {
  const porIntro = useRef(false)
  const fijar = () => { const v = importeVisto(valor); if (v !== valor) poner(v) }
  const dudoso = importeDudoso(valor)
  return (
    <input id={id} className="kp-num" inputMode="decimal" aria-label={etiqueta} value={valor}
      data-ambar={dudoso ? 'si' : undefined} aria-invalid={dudoso || undefined} title={dudoso ? MOTIVO_IMPORTE_DUDOSO : undefined}
      onChange={(e) => poner(e.target.value)}
      onBlur={() => { if (porIntro.current) { porIntro.current = false; return } fijar() }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { fijar(); porIntro.current = true; teclas?.(e); window.setTimeout(() => { porIntro.current = false }, 0); return }
        teclas?.(e)
      }} />
  )
}
