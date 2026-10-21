// src/modules/conta/diseno/Dialogo.tsx
//
// S01 · La ventana encima de la pantalla. La de la ficha del proveedor (C01b)
// hecha común: Escape y el fondo la cierran, el foco entra en el primer
// control y vuelve adonde estaba al cerrar, y Tab no se escapa por detrás.
// Las acciones van abajo a la derecha, la principal la última.

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Boton } from './Boton'

const ENFOCABLES = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

export function Dialogo({ titulo, explicacion, acciones, alCerrar, children }: {
  titulo: string
  explicacion?: ReactNode
  acciones?: ReactNode
  alCerrar: () => void
  children?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const cerrar = useRef(alCerrar)
  const idTitulo = useId()
  useEffect(() => { cerrar.current = alCerrar }, [alCerrar])
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null
    const caja = ref.current
    const enfocables = () => Array.from(caja?.querySelectorAll<HTMLElement>(ENFOCABLES) ?? [])
    ;(enfocables().find((e) => !e.classList.contains('s-dialogo-cerrar')) ?? enfocables()[0])?.focus()
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); cerrar.current(); return }
      if (e.key !== 'Tab') return
      const l = enfocables()
      if (l.length === 0) return
      const [primero, ultimo] = [l[0], l[l.length - 1]]
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus() }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus() }
    }
    window.addEventListener('keydown', tecla)
    return () => { window.removeEventListener('keydown', tecla); previo?.focus() }
  }, [])
  return (
    <div className="s-velo cx" onMouseDown={(e) => { if (e.target === e.currentTarget) alCerrar() }}>
      <div className="s-dialogo" role="dialog" aria-modal="true" aria-labelledby={idTitulo} ref={ref}>
        <div className="s-dialogo-cabeza">
          <h2 id={idTitulo} className="s-dialogo-titulo">{titulo}</h2>
          <Boton variante="fantasma" icono="cerrar" className="s-dialogo-cerrar" aria-label="Cerrar" onClick={alCerrar}>{''}</Boton>
        </div>
        {explicacion && <p className="s-dialogo-explicacion">{explicacion}</p>}
        {children}
        {acciones && <div className="s-dialogo-acciones">{acciones}</div>}
      </div>
    </div>
  )
}
