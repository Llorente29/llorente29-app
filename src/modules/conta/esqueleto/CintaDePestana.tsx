// src/modules/conta/esqueleto/CintaDePestana.tsx
//
// S01 · La cinta de la pestaña en la que se está (maqueta 1): sus órdenes por
// grupos con su nombre, sacadas del catálogo (ordenes.ts). La que lleva a la
// pantalla en la que se está va marcada (aria-current). Se puede ocultar; la
// persona lo decide y se guarda en la base.
// S01e · En el móvil se desliza: un degradado dice que hay más, entra
// deslizada hasta la orden actual y «Ocultar» se queda pegado a la derecha.

import { useLocation } from 'react-router-dom'
import { rutaConta } from '@/config/navegacion'
import { Boton, BotonEnlace, Cinta, GrupoCinta } from '@/modules/conta/diseno'
import type { DatosCinta, EntradasCinta } from '@/modules/conta/marco/nuevo/contexto'
import { conConsulta, esLaActual, type GrupoDeCinta } from './ordenes'
import { useDeslizable } from './deslizable'

export function CintaDePestana({ etiqueta, grupos, datos, entradas, oculta, alCambiarOculta, alBuscar }: {
  /** «Acciones de Asientos». */
  etiqueta: string
  grupos: GrupoDeCinta[]
  /** Lo que la pantalla sabe de cada orden (useDatosEnCinta): su número escrito, su punto ámbar, su dato. */
  datos?: DatosCinta | null
  /** Lo que pone la pantalla en los grupos que son suyos (useEntradasEnCinta): los bancos. */
  entradas?: EntradasCinta | null
  oculta: boolean
  alCambiarOculta: (oculta: boolean) => void
  alBuscar: () => void
}) {
  const { pathname, search } = useLocation()
  // Un grupo de la pantalla sin nada que poner (aún no ha leído, o no hay) no sale.
  const conAlgo = grupos.filter((g) => g.ordenes.length > 0 || (g.dePantalla && (entradas?.[g.dePantalla]?.length ?? 0) > 0))
  // La fila que se desliza la pinta el sistema de diseño (.s-cinta-grupos): se busca dentro.
  const enPantalla = conAlgo.reduce((s, g) => s + (g.dePantalla ? entradas?.[g.dePantalla]?.length ?? 0 : 0), 0)
  const fila = useDeslizable<HTMLDivElement>(`${pathname}${search}:${oculta}:${conAlgo.length}:${enPantalla}`, '.s-cinta-grupos')
  if (conAlgo.length === 0) return null
  return (
    <div className="s-cinta-marco" ref={fila}>
      <Cinta etiqueta={etiqueta} oculta={oculta} alCambiarOculta={alCambiarOculta}>
        {conAlgo.map((g) => (
          <GrupoCinta key={g.titulo} titulo={g.titulo}>
            {g.dePantalla && (entradas?.[g.dePantalla] ?? []).map((e) => (e.a
              ? (
                <BotonEnlace key={e.id} a={e.a} actual={e.actual} aviso={e.aviso} contador={e.numero} contadorTono={e.aviso ? 'duda' : 'neutro'} titulo={e.titulo ?? e.dato}>{e.etiqueta}</BotonEnlace>
              )
              : e.alPulsar
                ? <Boton key={e.id} onClick={e.alPulsar} title={e.titulo ?? e.dato}>{e.etiqueta}</Boton>
                // Solo dice algo («Por correo» y su dirección): no es un botón que no hace nada.
                : <span key={e.id} className="s-cinta-dato" title={e.titulo ?? e.dato}>{e.etiqueta}{e.titulo || e.dato ? ` · ${e.titulo ?? e.dato}` : ''}</span>))}
            {g.ordenes.map((o) => ('ruta' in o.a
              ? (
                <BotonEnlace key={o.id} a={conConsulta(rutaConta(o.a.ruta), search)} icono={o.icono} actual={esLaActual(o, pathname, search)}
                  contador={datos?.[o.id]?.numero} contadorTono={datos?.[o.id]?.aviso ? 'duda' : 'neutro'} aviso={datos?.[o.id]?.aviso} apagado={datos?.[o.id]?.gris} titulo={datos?.[o.id]?.dato}>
                  {o.etiqueta}
                </BotonEnlace>
              )
              : <Boton key={o.id} icono={o.icono} onClick={alBuscar} aria-keyshortcuts="Control+K">{o.etiqueta}</Boton>))}
          </GrupoCinta>
        ))}
      </Cinta>
    </div>
  )
}
