// src/modules/conta/esqueleto/CintaDePestana.tsx
//
// S01 · La cinta de la pestaña en la que se está (maqueta 1): sus órdenes por
// grupos con su nombre, sacadas del catálogo (ordenes.ts). La que lleva a la
// pantalla en la que se está va marcada (aria-current). Se puede ocultar; la
// persona lo decide y se guarda en la base.

import { useLocation } from 'react-router-dom'
import { rutaConta } from '@/config/navegacion'
import { Boton, BotonEnlace, Cinta, GrupoCinta } from '@/modules/conta/diseno'
import { esLaActual, type Orden } from './ordenes'

export function CintaDePestana({ etiqueta, grupos, oculta, alCambiarOculta, alBuscar }: {
  /** «Acciones de Asientos». */
  etiqueta: string
  grupos: { titulo: string; ordenes: Orden[] }[]
  oculta: boolean
  alCambiarOculta: (oculta: boolean) => void
  alBuscar: () => void
}) {
  const { pathname, search } = useLocation()
  if (grupos.length === 0) return null
  return (
    <Cinta etiqueta={etiqueta} oculta={oculta} alCambiarOculta={alCambiarOculta}>
      {grupos.map((g) => (
        <GrupoCinta key={g.titulo} titulo={g.titulo}>
          {g.ordenes.map((o) => ('ruta' in o.a
            ? <BotonEnlace key={o.id} a={rutaConta(o.a.ruta)} icono={o.icono} actual={esLaActual(o, pathname, search)}>{o.etiqueta}</BotonEnlace>
            : <Boton key={o.id} icono={o.icono} onClick={alBuscar} aria-keyshortcuts="Control+K">{o.etiqueta}</Boton>))}
        </GrupoCinta>
      ))}
    </Cinta>
  )
}
