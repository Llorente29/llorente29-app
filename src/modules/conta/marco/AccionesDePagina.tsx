// src/modules/conta/marco/AccionesDePagina.tsx
//
// S02 · La fila de acciones de serie de una página que aún no pinta su propio
// encabezado (EncabezadoPagina): lo que antes iba en la cinta, con la regla
// del patrón (marco/acciones.ts): a la izquierda, los selectores («Ver: … ▾»,
// «Tus bancos: … ▾»); a la derecha, el principal, como mucho dos blancos y
// «Más acciones ▾». Si la página pinta su barra (AccionesPantalla), va aquí, en
// su hueco, y lo del catálogo pasa entero a «Más acciones». En el móvil, el
// principal y «Más acciones»; los blancos, dentro del menú.

import type { RefCallback } from 'react'
import { useIsMobile } from '@/shell/useIsMobile'
import { hayAcciones, repartirAcciones, type GrupoDeAcciones } from './acciones'
import { BotonDeAccion, MasAcciones, SelectorDePagina } from './MasAcciones'

export function AccionesDePagina({ grupos, conBarra, hueco, etiqueta }: {
  grupos: readonly GrupoDeAcciones[]
  /** La página pinta su barra de botones en el hueco (AccionesPantalla). */
  conBarra: boolean
  hueco: RefCallback<HTMLDivElement>
  etiqueta: string
}) {
  const movil = useIsMobile()
  const r = repartirAcciones(grupos, conBarra)
  const mas = movil && r.blancos.length > 0
    ? [{ titulo: '', acciones: r.blancos }, ...r.mas]
    : r.mas
  const vacia = !hayAcciones(r) && !conBarra
  return (
    <div className="s-acciones-pagina" role="toolbar" aria-label={etiqueta} hidden={vacia}>
      <div className="s-acciones-izquierda">
        {r.selectores.map((s) => <SelectorDePagina key={s.titulo} s={s} />)}
      </div>
      <div className="s-acciones-derecha">
        {/* La barra de la página (AccionesPantalla) va aquí; vacía, no pinta nada. */}
        <div className="cxm-acciones" ref={hueco} />
        {!movil && r.blancos.map((a) => <BotonDeAccion key={a.id} a={a} />)}
        {mas.length > 0 && <MasAcciones grupos={mas} />}
        {r.principal && <BotonDeAccion a={r.principal} principal />}
      </div>
    </div>
  )
}
