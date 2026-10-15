// src/modules/conta/ui/marco/AccionesPantalla.tsx
//
// M01 · La barra de acciones de una pantalla (maqueta N30 §3): debajo de la
// barra de arriba, fondo suave, botones de 32 px con su tecla al lado y el
// principal en azul. La pantalla la declara donde quiera; el marco la pinta en
// su sitio. Fuera del marco (una página de ejemplo, una prueba) sale donde se
// declara. Una pantalla vieja no declara ninguna y la barra no se pinta.

import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMarco } from '@/modules/conta/marco/nuevo/contexto'
import { Tecla } from '@/modules/conta/ui/marco/Tecla'

export function AccionesPantalla({ children, etiqueta = 'Acciones de la pantalla' }: { children: ReactNode; etiqueta?: string }) {
  const marco = useMarco()
  const barra = <div className="cxm-acciones-barra" role="toolbar" aria-label={etiqueta}>{children}</div>
  if (!marco?.huecoAcciones) return <div className="cxm-acciones cxm-acciones-suelta">{barra}</div>
  return createPortal(barra, marco.huecoAcciones)
}

/**
 * Un botón de la barra. `tecla` es lo que se dibuja («Ctrl S») y
 * `atajo` lo que oye el lector («Control+S»); la tecla la escucha la pantalla.
 */
export function BotonAccion({ children, tecla, atajo, principal = false, onClick, disabled = false, tipo = 'button' }: {
  children: ReactNode
  tecla?: string
  atajo?: string
  principal?: boolean
  onClick?: () => void
  disabled?: boolean
  tipo?: 'button' | 'submit'
}) {
  return (
    <button type={tipo} className={principal ? 'cxm-boton cxm-boton-principal' : 'cxm-boton'} onClick={onClick} disabled={disabled}
      aria-keyshortcuts={atajo}>
      <span>{children}</span>
      {tecla && <Tecla>{tecla}</Tecla>}
    </button>
  )
}

/** Una separación entre grupos de botones. */
export function SeparadorAcciones() {
  return <span className="cxm-acciones-separador" aria-hidden="true" />
}
