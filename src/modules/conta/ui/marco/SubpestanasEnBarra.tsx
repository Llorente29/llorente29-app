// src/modules/conta/ui/marco/SubpestanasEnBarra.tsx
//
// M01 · La segunda fila de la barra de arriba: las acciones de una pestaña
// (en Libros, las de un área: Balance de situación, Pérdidas y ganancias…).
// Julio, 16/10: que se lea como parte de la barra de arriba y no como otro
// bloque: unos 36 px, 13 px en gris, la activa en azul sin subrayado grueso,
// el punto ámbar si piden algo, y «Más ▾» con las que no caben. Lo que enseña
// un número lo lleva escrito («Pendientes de adjuntar en Diez · 3», en mono),
// también dentro de «Más ▾». La pantalla
// la declara; el marco la pinta debajo de su barra (fija al bajar). Fuera del
// marco sale donde se declara. En el móvil no se usa: las acciones van dentro
// del menú del área.

import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useMarco } from '@/modules/conta/marco/nuevo/contexto'
import { cuantasCaben } from '@/modules/conta/marco/nuevo/modulos'
import { useDesplegable } from '@/modules/conta/marco/nuevo/useDesplegable'
import { miles } from '@/modules/conta/ui/tabla/tablaDensa'

export interface Subpestana {
  id: string
  etiqueta: string
  ruta: string
  activa: boolean
  /** Su dato entero, en el title («Expedidas: 4.º · 12»). */
  dato?: string
  /** El número que enseña, escrito al lado del nombre («· 3», en mono): nunca solo en el title. */
  numero?: number
  /** Pide algo: punto ámbar (y el lector oye el dato). */
  aviso?: boolean
  /** Lo que la empresa no usa: en gris, pero está (regla 7). */
  gris?: boolean
}

/** El nombre y, si lo tiene, su número escrito; el punto ámbar si pide algo. */
function Texto({ p }: { p: Subpestana }) {
  return (
    <>
      {p.etiqueta}
      {p.numero !== undefined && <span className="cxm-sub-numero"> · <span className="cxm-cifra">{miles(p.numero)}</span></span>}
      {p.aviso && <span className="cxm-sub-punto" role="img" aria-label={p.dato ? `, ${p.dato}` : ', pide algo'} />}
    </>
  )
}

const ANCHO_MAS = 72
const HUECO = 2

export function SubpestanasEnBarra({ etiqueta, pestanas }: { etiqueta: string; pestanas: readonly Subpestana[] }) {
  const marco = useMarco()
  const fila = <Fila etiqueta={etiqueta} pestanas={pestanas} />
  if (!marco?.huecoSubpestanas) return fila
  return createPortal(fila, marco.huecoSubpestanas)
}

function Fila({ etiqueta, pestanas }: { etiqueta: string; pestanas: readonly Subpestana[] }) {
  const caja = useRef<HTMLDivElement | null>(null)
  const medida = useRef<HTMLDivElement | null>(null)
  const [caben, setCaben] = useState(pestanas.length)
  const { abierto, alternar, caja: cajaMas, boton } = useDesplegable()
  const claves = pestanas.map((p) => `${p.id}:${p.numero ?? ''}:${p.aviso ? 1 : 0}`).join('|')

  useLayoutEffect(() => {
    const c = caja.current, me = medida.current
    if (!c || !me) return
    const medir = () => setCaben(cuantasCaben(Array.from(me.children).map((x) => (x as HTMLElement).offsetWidth), c.clientWidth, ANCHO_MAS, HUECO))
    medir()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(medir)
    ro?.observe(c)
    return () => ro?.disconnect()
  }, [claves])

  const vistas = pestanas.slice(0, caben)
  const resto = pestanas.slice(caben)
  const activaEnResto = resto.find((p) => p.activa)
  const enlace = (p: Subpestana, clase: string) => (
    <Link key={p.id} to={p.ruta} className={`${clase}${p.gris ? ' cxm-sub-gris' : ''}`} aria-current={p.activa ? 'page' : undefined}
      title={p.dato ? `${p.etiqueta}: ${p.dato}` : undefined}>
      <Texto p={p} />
    </Link>
  )
  return (
    <div className="cxm-sub-caja" ref={caja}>
      <div className="cxm-sub-medida" ref={medida} aria-hidden="true">
        {pestanas.map((p) => <span key={p.id} className="cxm-sub"><Texto p={p} /></span>)}
      </div>
      <nav className="cxm-sub-fila" aria-label={etiqueta}>
        {vistas.map((p) => enlace(p, 'cxm-sub'))}
        {resto.length > 0 && (
          <div className="cxm-desplegable" ref={cajaMas}>
            <button type="button" ref={boton} className={activaEnResto ? 'cxm-sub cxm-sub-activa' : 'cxm-sub'} aria-expanded={abierto} aria-haspopup="true" onClick={alternar}>
              {activaEnResto ? <><Texto p={activaEnResto} /> ▾</> : 'Más ▾'}
            </button>
            {abierto && <div className="cxm-menu">{resto.map((p) => enlace(p, 'cxm-menu-item cxm-menu-item-enlace'))}</div>}
          </div>
        )}
      </nav>
    </div>
  )
}
