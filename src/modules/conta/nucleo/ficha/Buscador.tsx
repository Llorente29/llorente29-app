// src/modules/conta/nucleo/ficha/Buscador.tsx
//
// K04 · La casilla que busca en una lista (el proveedor, la cuenta): escribe, F4
// o ↓ abre, ↑ ↓ eligen, Intro elige, Esc cierra. Nació en la ficha recibida
// (K04); E05 la saca aquí, tal cual, para que Bancos («Escribir uno a mano»,
// la cuenta con F4) use la misma y no una copia.

import { useState, type KeyboardEvent as KE } from 'react'

/** Una casilla que busca en una lista (el proveedor, la cuenta): escribe, F4 o ↓ abre, Intro elige. */
export function Buscador<T>({ id, valor, ponerTexto, lista, texto, elegir, etiqueta, cuenta, duda, placeholder, cargando, abrir = false }: {
  id: string; valor: string; ponerTexto: (t: string) => void; lista: (t: string) => T[]; texto: (x: T) => string; elegir: (x: T) => void
  etiqueta: string; cuenta?: string | null; duda?: boolean; placeholder?: string
  /** La lista aún no ha llegado: Intro no se escapa a la casilla siguiente con la búsqueda sin resolver (e2e 1510). */
  cargando?: boolean
  /** E05b · Nace con la lista abierta (Bancos: «Es otra factura» enseña las facturas sin escribir nada). */
  abrir?: boolean
}) {
  const [abierta, setAbierta] = useState(abrir)
  const [sel, setSel] = useState(0)
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
