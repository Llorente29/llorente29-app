// src/modules/conta/nucleo/ficha/Buscador.tsx
//
// K05 · La casilla que busca en una lista (el proveedor, el cliente, la
// cuenta), de la ficha del núcleo: escribe, F4 o ↓ abre, Intro elige. Es la
// del K04 (FichaRecibida), con lo del K04b (abrir: el foco con la lista
// abierta, para «Es uno que ya tengo»), sacada aquí para que la usen la
// recibida y la emitida. Mientras el K04b (#733) no esté en main, la recibida
// sigue con la suya: se pasa a ésta al traer main.

import { useEffect, useState, type KeyboardEvent as KE } from 'react'

/** Una casilla que busca en una lista (el proveedor, la cuenta): escribe, F4 o ↓ abre, Intro elige. */
export function Buscador<T>({ id, valor, ponerTexto, lista, texto, elegir, etiqueta, cuenta, duda, placeholder, cargando, abrir = 0 }: {
  id: string; valor: string; ponerTexto: (t: string) => void; lista: (t: string) => T[]; texto: (x: T) => string; elegir: (x: T) => void
  etiqueta: string; cuenta?: string | null; duda?: boolean; placeholder?: string
  /** La lista aún no ha llegado: Intro no se escapa a la casilla siguiente con la búsqueda sin resolver (e2e 1510). */
  cargando?: boolean
  /** K04b · Cada vez que cambia (y no es 0), el foco a la casilla con su lista abierta, como F4. */
  abrir?: number
}) {
  const [abierta, setAbierta] = useState(false)
  const [sel, setSel] = useState(0)
  const [abiertaCon, setAbiertaCon] = useState(0)
  if (abrir !== abiertaCon) { setAbiertaCon(abrir); if (abrir) { setAbierta(true); setSel(0) } }
  useEffect(() => { if (abrir) document.getElementById(id)?.focus() }, [abrir, id])
  const opciones = abierta ? lista(valor).slice(0, 12) : []
  const teclas = (e: KE<HTMLInputElement>) => {
    if (e.key === 'F4' || (e.key === 'ArrowDown' && !abierta)) { e.preventDefault(); setAbierta(true); setSel(0); return }
    if (!abierta) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, opciones.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAbierta(false) }
    else if (e.key === 'Enter' && opciones[sel]) { e.preventDefault(); e.stopPropagation(); elegir(opciones[sel]); setAbierta(false) }
    // Escrito y sin nada que elegir (la lista aún no ha llegado, o no encaja nada): Intro se queda aquí y lo dice.
    else if (e.key === 'Enter' && valor.trim()) { e.preventDefault(); e.stopPropagation() }
  }
  return (
    <div className="kf-con-sugerencias">
      <input id={id} data-casilla value={valor} aria-label={etiqueta} data-cuenta={cuenta ?? undefined} data-duda={duda ? 'si' : undefined} placeholder={placeholder}
        autoComplete="off" role="combobox" aria-expanded={abierta} aria-controls={`${id}-lista`}
        onChange={(e) => { ponerTexto(e.target.value); setAbierta(true); setSel(0) }} onKeyDown={teclas} onBlur={() => setTimeout(() => setAbierta(false), 150)} />
      {abierta && opciones.length > 0 && (
        <ul className="kf-sugerencias" id={`${id}-lista`} role="listbox">
          {opciones.map((o, i) => <li key={i} role="option" aria-selected={i === sel} onMouseDown={(e) => { e.preventDefault(); elegir(o); setAbierta(false) }}>{texto(o)}</li>)}
        </ul>
      )}
      {abierta && opciones.length === 0 && valor.trim() !== '' && (
        <ul className="kf-sugerencias" id={`${id}-lista`} role="listbox">
          <li aria-disabled="true" data-prueba="buscador-vacio">{cargando ? 'Buscando…' : `Ninguno encaja con «${valor.trim()}»`}</li>
        </ul>
      )}
    </div>
  )
}
