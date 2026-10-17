// src/modules/conta/diseno/Boton.tsx
//
// S01 · El botón del sistema de diseño, en cuatro variantes:
//   · principal  — la acción de la pantalla («Validar y siguiente ↵»). Una por pantalla.
//   · secundario — blanco con borde («← Anterior», «No es una factura», los de la cinta).
//   · enlace     — texto azul subrayado («Ver el correo», «Ampliar»).
//   · fantasma   — sin borde, para lo discreto («Ocultar ˄»).
// Con `icono` lleva su dibujo delante; con `tecla`, la tecla dibujada detrás y
// `aria-keyshortcuts` para el lector de pantalla; con `contador`, la cifra en
// su píldora («Para revisar 12»).
//
// `BotonEnlace` pinta igual pero navega (es un <a>): la cinta y los favoritos
// llevan a pantallas. `actual` marca con aria-current la de la pantalla en la
// que se está.

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icono } from './Icono'
import type { NombreIcono } from './iconos'
import { clasesBoton, type VarianteBoton } from './valores'

interface Aspecto {
  variante?: VarianteBoton
  /** Grande: el botón principal de una pantalla de documento (maqueta 3). */
  grande?: boolean
  /** A todo el ancho (los tres niveles, maqueta 5; el móvil). */
  ancho?: boolean
  icono?: NombreIcono
  /** «Ctrl S», «↵». Se dibuja; el atajo de verdad lo dice `atajo`. */
  tecla?: string
  /** Para aria-keyshortcuts: «Control+S», «Enter». */
  atajo?: string
  contador?: number
}

function Contenido({ icono, tecla, contador, children }: Aspecto & { children: ReactNode }) {
  return (
    <>
      {icono && <Icono nombre={icono} />}
      <span className="s-boton-texto">{children}</span>
      {contador !== undefined && <span className="s-boton-contador s-cifra">{contador}</span>}
      {tecla && <Tecla>{tecla}</Tecla>}
    </>
  )
}

export const Boton = forwardRef<HTMLButtonElement, Aspecto & ButtonHTMLAttributes<HTMLButtonElement>>(function Boton(
  { variante, grande, ancho, icono, tecla, atajo, contador, className, type = 'button', children, ...resto }, ref,
) {
  return (
    <button ref={ref} type={type} {...resto} aria-keyshortcuts={atajo ?? resto['aria-keyshortcuts']}
      className={[clasesBoton({ variante, grande, ancho }), className].filter(Boolean).join(' ')}>
      <Contenido icono={icono} tecla={tecla} contador={contador}>{children}</Contenido>
    </button>
  )
})

export function BotonEnlace({ a, actual = false, variante, grande, ancho, icono, tecla, atajo, contador, children, etiqueta }: Aspecto & {
  /** La dirección, ya entera (rutaConta(...)). */
  a: string
  actual?: boolean
  children: ReactNode
  /** aria-label, si el texto visible no basta. */
  etiqueta?: string
}) {
  return (
    <Link to={a} className={clasesBoton({ variante, grande, ancho })} aria-current={actual ? 'page' : undefined}
      aria-keyshortcuts={atajo} aria-label={etiqueta}>
      <Contenido icono={icono} tecla={tecla} contador={contador}>{children}</Contenido>
    </Link>
  )
}

/** Una tecla dibujada. El lector de pantalla la oye por aria-keyshortcuts del botón, no por aquí. */
export function Tecla({ children }: { children: string }) {
  return <kbd className="s-tecla" aria-hidden="true">{children}</kbd>
}
