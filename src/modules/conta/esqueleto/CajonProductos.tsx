// src/modules/conta/esqueleto/CajonProductos.tsx
//
// S01c · En el móvil, la barra de productos va en un CAJÓN que sale por la
// izquierda al pulsar el botón de menú de la cabecera (encargo S01b, 18/10;
// sustituye a la barra de abajo con «Más»): los mismos productos que la barra
// del ordenador, con su icono, su nombre y su chip; Ajustes abajo, separado; y
// «Volver a Folvy» si no es el producto vendido solo. S01d: también Favoritos
// y el usuario (en el móvil no están en la cabecera). Se cierra con «Cerrar»,
// con Escape, tocando fuera o al elegir. El logo no se repite aquí: ya sale en
// la cabecera (una sola vez, Julio).

import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icono } from '@/modules/conta/diseno'
import { ItemBarra } from './BarraProductos'
import type { IdProducto, Producto } from './productos'

export function CajonProductos({ productos, activo, pendientes, solo, cerrar, tuyo }: {
  productos: Producto[]
  activo: string | null
  pendientes: Partial<Record<IdProducto, number | null>>
  solo: boolean
  cerrar: () => void
  /** S01d · Favoritos y el usuario, en su variante de cajón. */
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
  const arriba = productos.filter((p) => !p.abajo)
  const abajo = productos.filter((p) => p.abajo)
  return (
    <div className="s-cajon-velo" onClick={cerrar}>
      <div className="s-cajon" role="dialog" aria-modal="true" aria-label="Menú" ref={caja} onClick={(e) => e.stopPropagation()}>
        <nav aria-label="Menú de contabilidad" className="s-cajon-nav">
          <ul className="s-barra-lista">
            {arriba.map((p) => <ItemBarra key={p.id} p={p} activo={activo === p.id} pendientes={pendientes[p.id]} alPulsar={cerrar} />)}
          </ul>
          {tuyo && <div className="s-cajon-tuyo">{tuyo}</div>}
          <div className="s-barra-pie">
            <ul className="s-barra-lista">
              {abajo.map((p) => <ItemBarra key={p.id} p={p} activo={activo === p.id} pendientes={pendientes[p.id]} alPulsar={cerrar} />)}
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
