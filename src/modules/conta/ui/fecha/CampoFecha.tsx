// src/modules/conta/ui/fecha/CampoFecha.tsx
//
// M01 · El campo de fecha de las piezas: se escribe y se lee en dd/mm/aaaa,
// en español, sea cual sea el idioma del navegador. Por dentro, ISO. El botón
// de al lado abre el calendario del navegador para quien prefiera elegir.
// El valor solo cambia cuando la fecha está entera y existe; a medias, el
// campo guarda lo escrito, y una fecha imposible («31/02/2026») lo dice.
// S01p·18 · 2: al salir, una sin año («04/10») se completa con el año en curso
// (o el que se dé) y vale; si sigue a medias, lo dice: no se queda callada.

import { useRef, useState, type InputHTMLAttributes } from 'react'
import { aTexto, completarAnio, deTexto, enmascarar, fechaAMedias, fechaMal } from './fecha'

type Propias = 'type' | 'value' | 'onChange' | 'placeholder' | 'inputMode'

export function CampoFecha({ valor, alCambiar, className, etiquetaCalendario = 'Elegir en el calendario', anio, ...resto }: {
  /** ISO («2026-10-16») o '' sin fecha. */
  valor: string
  alCambiar: (iso: string) => void
  className?: string
  etiquetaCalendario?: string
  /** El año con el que se completa una fecha escrita sin él. Sin darlo, el en curso. */
  anio?: number
} & Omit<InputHTMLAttributes<HTMLInputElement>, Propias | 'className'>) {
  // Lo escrito y el valor con el que se escribió: si el valor cambia por fuera
  // («Quitar filtros», otra vista), manda el de fuera.
  const [b, setB] = useState({ texto: aTexto(valor), de: valor })
  const texto = b.de === valor ? b.texto : aTexto(valor)
  const nativo = useRef<HTMLInputElement | null>(null)
  const [salio, setSalio] = useState(false)
  const aMedias = salio && fechaAMedias(texto)
  const mal = fechaMal(texto) || aMedias
  const queMal = aMedias ? 'Escribe la fecha entera: dd/mm/aaaa' : 'Esa fecha no existe'

  function salir() {
    const iso = completarAnio(texto, anio ?? new Date().getFullYear())
    if (iso) { setB({ texto: aTexto(iso), de: iso }); if (iso !== valor) alCambiar(iso) }
    setSalio(true)
  }

  function escribir(crudo: string) {
    setSalio(false)
    const t = enmascarar(crudo)
    const iso = deTexto(t)
    if (iso === null) { setB({ texto: t, de: valor }); return }
    setB({ texto: t, de: iso })
    if (iso !== valor) alCambiar(iso)
  }

  function abrirCalendario() {
    const n = nativo.current
    if (!n) return
    try { n.showPicker() } catch { n.focus() }
  }

  return (
    <span className="cx-fecha">
      <input {...resto} className={className} type="text" inputMode="numeric" autoComplete="off" placeholder="dd/mm/aaaa"
        value={texto} aria-invalid={mal || undefined} title={mal ? queMal : undefined}
        // Dicho en la descripción y no en un texto dentro de la etiqueta: el nombre del campo sigue siendo el suyo.
        {...(mal ? { 'aria-description': queMal } : {})}
        onChange={(e) => escribir(e.target.value)}
        onBlur={(e) => { salir(); resto.onBlur?.(e) }} />
      {/* Fuera del Tab: Tab e Intro van de campo en campo; el campo se escribe entero sin él. */}
      <button type="button" className="cx-fecha-calendario" tabIndex={-1} aria-label={etiquetaCalendario} title={etiquetaCalendario}
        disabled={resto.readOnly || resto.disabled} onClick={abrirCalendario}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M2 6.5h12M5 1.5v3M11 1.5v3" stroke="currentColor" strokeWidth="1.4" /></svg>
      </button>
      <input ref={nativo} type="date" className="cx-fecha-nativo" tabIndex={-1} aria-hidden="true" value={valor}
        onChange={(e) => { setB({ texto: aTexto(e.target.value), de: e.target.value }); alCambiar(e.target.value) }} />
    </span>
  )
}
