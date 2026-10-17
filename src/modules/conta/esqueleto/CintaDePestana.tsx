// src/modules/conta/esqueleto/CintaDePestana.tsx
//
// S01 · La cinta de la pestaña en la que se está (maqueta 1): sus órdenes por
// grupos con su nombre, sacadas del catálogo (ordenes.ts). La que lleva a la
// pantalla en la que se está va marcada (aria-current). Se puede ocultar; la
// persona lo decide y se guarda en la base.

import { useLocation } from 'react-router-dom'
import { rutaConta } from '@/config/navegacion'
import { Boton, BotonEnlace, Cinta, GrupoCinta } from '@/modules/conta/diseno'
import type { DatosCinta } from '@/modules/conta/marco/nuevo/contexto'
import { esLaActual, type Orden } from './ordenes'

/** El ejercicio elegido viaja de una acción a otra (lo leen Libros y el diario). */
const conservar = (search: string) => { const e = new URLSearchParams(search).get('ejercicio'); return e ? `?ejercicio=${encodeURIComponent(e)}` : '' }

export function CintaDePestana({ etiqueta, grupos, datos, oculta, alCambiarOculta, alBuscar }: {
  /** «Acciones de Asientos». */
  etiqueta: string
  grupos: { titulo: string; ordenes: Orden[] }[]
  /** Lo que la pantalla sabe de cada orden (useDatosEnCinta): su número escrito, su punto ámbar, su dato. */
  datos?: DatosCinta | null
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
            ? (
              <BotonEnlace key={o.id} a={`${rutaConta(o.a.ruta)}${conservar(search)}`} icono={o.icono} actual={esLaActual(o, pathname, search)}
                contador={datos?.[o.id]?.numero} contadorTono={datos?.[o.id]?.aviso ? 'duda' : 'neutro'} aviso={datos?.[o.id]?.aviso} apagado={datos?.[o.id]?.gris} titulo={datos?.[o.id]?.dato}>
                {o.etiqueta}
              </BotonEnlace>
            )
            : <Boton key={o.id} icono={o.icono} onClick={alBuscar} aria-keyshortcuts="Control+K">{o.etiqueta}</Boton>))}
        </GrupoCinta>
      ))}
    </Cinta>
  )
}
