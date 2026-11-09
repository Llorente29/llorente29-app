// src/modules/conta/portal/comun.tsx
//
// GP · Tarea 3 · Las piezas que comparten las pantallas del portal del
// cliente: el chip de un estado, el aviso con contenido (regla 8: lo que pasa
// al pulsar se dice, con lo que ha pasado), el diálogo y lo que se ve mientras
// carga o si falla la lectura.

import { useEffect, useRef, type ReactNode } from 'react'
import { TONOS, tonoDe, type Tono } from './formato'

export function Chip({ texto, tono }: { texto: string; tono?: Tono }) {
  const t = TONOS[tono ?? tonoDe(texto)]
  return <span className="pt-chip" style={{ background: t.fondo, color: t.tinta }}>{texto}</span>
}

export interface Aviso { tipo: 'ok' | 'mal' | 'info'; texto: string }

export function CajaAviso({ aviso, cerrar }: { aviso: Aviso | null; cerrar: () => void }) {
  if (!aviso) return null
  return (
    <div className={`pt-aviso ${aviso.tipo}`} role={aviso.tipo === 'mal' ? 'alert' : 'status'}>
      <span>{aviso.texto}</span>
      <button type="button" onClick={cerrar} aria-label="Cerrar el aviso">×</button>
    </div>
  )
}

export function Cargando({ que }: { que: string }) {
  return <div className="pt-cargando" role="status">Cargando {que}…</div>
}

export function Fallo({ texto, otraVez }: { texto: string; otraVez: () => void }) {
  return (
    <div className="pt-aviso mal" role="alert">
      <span>{texto}</span>
      <button type="button" onClick={otraVez}>Otra vez</button>
    </div>
  )
}

export function Dialogo({ titulo, cerrar, children }: { titulo: string; cerrar: () => void; children: ReactNode }) {
  const caja = useRef<HTMLDivElement>(null)
  useEffect(() => {
    caja.current?.querySelector<HTMLElement>('input, textarea, button')?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }
    caja.current?.addEventListener('keydown', esc)
    const c = caja.current
    return () => c?.removeEventListener('keydown', esc)
  }, [cerrar])
  return (
    <div className="pt-velo" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="pt-dialogo" role="dialog" aria-modal="true" aria-label={titulo} ref={caja}>
        <div className="pt-cabeza"><h2 className="pt-h2">{titulo}</h2><button type="button" className="pt-boton enlace" onClick={cerrar}>Cerrar</button></div>
        {children}
      </div>
    </div>
  )
}
