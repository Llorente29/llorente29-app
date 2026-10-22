// src/modules/conta/marco/Cajon.tsx
//
// S02 · En el móvil, la barra va en un CAJÓN que sale por la izquierda al
// pulsar el botón de menú de la cabecera (tablero 4, «la barra en un cajón»):
// los mismos apartados que la barra del ordenador, con el activo abierto y sus
// páginas; abajo, Favoritos, el usuario, Ajustes y, si no es el producto
// vendido solo, «Volver a Folvy». Se cierra con «Cerrar el menú», con Escape,
// tocando fuera o al elegir. El logo no se repite: ya sale en la cabecera.

import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icono } from '@/modules/conta/diseno'
import { Apartado, type DatosBarra } from './Barra'

export function Cajon({ d, solo, cerrar, tuyo }: {
  d: DatosBarra
  solo: boolean
  cerrar: () => void
  /** Favoritos y el usuario, en su variante de cajón. */
  tuyo?: ReactNode
}) {
  const caja = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null
    caja.current?.querySelector<HTMLElement>('a, button')?.focus()
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }
    window.addEventListener('keydown', tecla)
    return () => { window.removeEventListener('keydown', tecla); antes?.focus?.() }
  }, [cerrar])
  const arriba = d.productos.filter((p) => !p.abajo)
  const abajo = d.productos.filter((p) => p.abajo)
  return (
    <div className="s-cajon-velo" onClick={cerrar}>
      <div className="s-cajon" role="dialog" aria-modal="true" aria-label="Menú" ref={caja} onClick={(e) => e.stopPropagation()}>
        <nav aria-label="Menú de contabilidad" className="s-cajon-nav">
          <ul className="s-barra-lista">
            {arriba.map((p) => <Apartado key={p.id} p={p} d={d} alPulsar={cerrar} />)}
          </ul>
          <div className="s-barra-pie">
            {tuyo && <div className="s-cajon-tuyo">{tuyo}</div>}
            <ul className="s-barra-lista">
              {abajo.map((p) => <Apartado key={p.id} p={p} d={d} alPulsar={cerrar} />)}
              {!solo && (
                <li><Link to="/" className="s-barra-item" onClick={cerrar}><Icono nombre="anterior" grande /><span className="s-barra-nombre">Volver a Folvy</span></Link></li>
              )}
            </ul>
            <button type="button" className="s-barra-plegar" onClick={cerrar}>
              <Icono nombre="cerrar" grande /><span className="s-barra-nombre">Cerrar el menú</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  )
}
