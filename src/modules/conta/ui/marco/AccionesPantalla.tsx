// src/modules/conta/ui/marco/AccionesPantalla.tsx
//
// M01 · La barra de acciones de una pantalla (maqueta N30 §3): debajo de la
// barra de arriba, fondo suave, botones de 32 px con su tecla al lado y el
// principal en azul. La pantalla la declara donde quiera; el marco la pinta en
// su sitio. Fuera del marco (una página de ejemplo, una prueba) sale donde se
// declara. Una pantalla vieja no declara ninguna y la barra no se pinta.

//
// En el móvil (Julio, 16/10) solo se ve el principal; el resto va en «⋯», con
// el mismo texto y su número escrito. Una separación no viaja al menú.

import { Children, isValidElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useConPropias, useMarco } from '@/modules/conta/marco/nuevo/contexto'
import { useDesplegable } from '@/modules/conta/marco/nuevo/useDesplegable'
import { Tecla } from '@/modules/conta/ui/marco/Tecla'
import { useIsMobile } from '@/shell/useIsMobile'

export function AccionesPantalla({ children, etiqueta = 'Acciones de la pantalla' }: { children: ReactNode; etiqueta?: string }) {
  const marco = useMarco()
  // S02: el marco pinta su fila con esta barra, y lo del catálogo de la página en «Más acciones».
  useConPropias('barra')
  const movil = useIsMobile()
  const barra = (
    <div className="cxm-acciones-barra" role="toolbar" aria-label={etiqueta}>
      {movil ? <SoloElPrincipal etiqueta={etiqueta}>{children}</SoloElPrincipal> : children}
    </div>
  )
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

const esPrincipal = (c: ReactNode) => isValidElement<{ principal?: boolean }>(c) && c.type === BotonAccion && c.props.principal === true
const esSeparador = (c: ReactNode) => isValidElement(c) && c.type === SeparadorAcciones

/** El móvil: el principal a la vista y lo demás detrás de «⋯» (se cierra al elegir, al tocar fuera o con Escape). */
function SoloElPrincipal({ children, etiqueta }: { children: ReactNode; etiqueta: string }) {
  const { abierto, alternar, setAbierto, caja, boton } = useDesplegable()
  const todos = Children.toArray(children)
  const principales = todos.filter(esPrincipal)
  const resto = todos.filter((c) => !esPrincipal(c) && !esSeparador(c))
  return (
    <>
      {principales}
      {resto.length > 0 && (
        <div className="cxm-acciones-mas" ref={caja}>
          <button type="button" ref={boton} className="cxm-boton cxm-acciones-mas-boton" aria-expanded={abierto} aria-haspopup="true"
            aria-label={`Más ${etiqueta.toLowerCase()}`} onClick={alternar}>⋯</button>
          {abierto && <div className="cxm-acciones-menu" onClick={() => setAbierto(false)}>{resto}</div>}
        </div>
      )}
    </>
  )
}
