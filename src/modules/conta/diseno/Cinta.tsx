// src/modules/conta/diseno/Cinta.tsx
//
// S01 · La cinta: una fila fina debajo de la cabecera con las acciones de la
// pestaña en grupos con su nombre (maqueta 1: NUEVO · REVISAR · UTILIDADES).
// El usuario la puede ocultar («Ocultar ˄»); oculta, queda un botón para
// volver a sacarla, nunca desaparece sin decir dónde está (regla 7). Lo que
// se recuerda (oculta o no) lo guarda quien la monta.
//
// En el móvil la fila se desliza de lado: los grupos no se parten.

import { useId, type ReactNode } from 'react'
import { Boton } from './Boton'

export function Cinta({ etiqueta, oculta, alCambiarOculta, children }: {
  /** «Acciones de Asientos». */
  etiqueta: string
  oculta: boolean
  alCambiarOculta: (oculta: boolean) => void
  children: ReactNode
}) {
  if (oculta) {
    return (
      <div className="s-cinta s-cinta-oculta">
        <Boton variante="fantasma" icono="desplegar" aria-expanded="false" onClick={() => alCambiarOculta(false)}>Mostrar la cinta</Boton>
      </div>
    )
  }
  return (
    <div className="s-cinta" role="toolbar" aria-label={etiqueta}>
      <div className="s-cinta-grupos">{children}</div>
      <Boton variante="fantasma" icono="plegar" aria-expanded="true" className="s-cinta-ocultar" onClick={() => alCambiarOculta(true)}>Ocultar</Boton>
    </div>
  )
}

export function GrupoCinta({ titulo, children }: { titulo: string; children: ReactNode }) {
  const id = useId()
  return (
    // El título, debajo de sus botones (Julio, 17/10: así Bancos cabe en una fila a
    // 1440 px, como las barras de la N17 y la N22). El grupo se llama por él.
    <div className="s-cinta-grupo" role="group" aria-labelledby={id}>
      <div className="s-cinta-grupo-botones">{children}</div>
      <span id={id} className="s-cinta-grupo-titulo">{titulo}</span>
    </div>
  )
}
