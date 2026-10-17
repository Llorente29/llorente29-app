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
  /** Ámbar si lo que cuenta pide algo («Para revisar 12»); neutro si solo informa («Expedidas 12»). */
  contadorTono?: 'duda' | 'neutro'
}

function Contenido({ icono, tecla, contador, contadorTono = 'duda', children }: Aspecto & { children: ReactNode }) {
  return (
    <>
      {icono && <Icono nombre={icono} />}
      <span className="s-boton-texto">{children}</span>
      {contador !== undefined && <span className="s-boton-contador s-cifra" data-tono={contadorTono}>{contador}</span>}
      {tecla && <Tecla>{tecla}</Tecla>}
    </>
  )
}

export const Boton = forwardRef<HTMLButtonElement, Aspecto & ButtonHTMLAttributes<HTMLButtonElement>>(function Boton(
  { variante, grande, ancho, icono, tecla, atajo, contador, contadorTono, className, type = 'button', children, ...resto }, ref,
) {
  return (
    <button ref={ref} type={type} {...resto} aria-keyshortcuts={atajo ?? resto['aria-keyshortcuts']}
      className={[clasesBoton({ variante, grande, ancho }), className].filter(Boolean).join(' ')}>
      <Contenido icono={icono} tecla={tecla} contador={contador} contadorTono={contadorTono}>{children}</Contenido>
    </button>
  )
})

export function BotonEnlace({ a, actual = false, variante, grande, ancho, icono, tecla, atajo, contador, contadorTono, children, etiqueta, aviso = false, apagado = false, titulo }: Aspecto & {
  /** La dirección, ya entera (rutaConta(...)). */
  a: string
  actual?: boolean
  children: ReactNode
  /** aria-label, si el texto visible no basta. */
  etiqueta?: string
  /** Pide algo: un punto ámbar (y su dato, en `titulo`, lo dice). */
  aviso?: boolean
  /** Lo que la empresa no usa: en gris, pero está (regla 7). */
  apagado?: boolean
  /** Su dato entero («Expedidas: 4.º · 12»), al pasar el ratón; lo que enseña un número va escrito en `contador`. */
  titulo?: string
}) {
  const clases = [clasesBoton({ variante, grande, ancho }), aviso ? 's-boton-aviso' : '', apagado ? 's-boton-apagado' : ''].filter(Boolean).join(' ')
  return (
    <Link to={a} className={clases} aria-current={actual ? 'page' : undefined} title={titulo}
      aria-keyshortcuts={atajo} aria-label={etiqueta} aria-description={aviso && titulo ? titulo : undefined}>
      <Contenido icono={icono} tecla={tecla} contador={contador} contadorTono={contadorTono}>{children}</Contenido>
    </Link>
  )
}

/** Una tecla dibujada. El lector de pantalla la oye por aria-keyshortcuts del botón, no por aquí. */
export function Tecla({ children }: { children: string }) {
  return <kbd className="s-tecla" aria-hidden="true">{children}</kbd>
}
