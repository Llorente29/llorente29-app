// src/modules/conta/diseno/plantillas/Lista.tsx
//
// S02 · La plantilla LISTA (tableros 2, 4 y 7): facturas, movimientos,
// asientos, contactos, declaraciones. Encima de la tabla, como mucho: el
// encabezado de la página, las pestañas de estado con su número y una fila de
// filtros. Debajo, la tabla, con su total abajo. En el móvil, la misma página
// con la tabla en tarjetas.
//
// Al volver de una ficha, la lista está como la dejaste: los filtros y el orden
// en la dirección, y la fila donde ibas (`filaActual`) se lleva a la vista y se
// marca. Si con esos filtros ya no sale, la página lo dice (no se calla).

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { PestanaEstado, Sentido } from './lista'
import { columnasQueCaben, textoColumnasOcultas } from './anchos'

/** Las pestañas de estado, con su número. La primera es «Todas» (la suma). */
export function PestanasEstado({ pestanas, actual, alCambiar, etiqueta, derecha, sinNumeros = false }: {
  pestanas: readonly PestanaEstado[]
  actual: string
  alCambiar: (id: string) => void
  etiqueta: string
  /** Lo que va a la derecha de las pestañas («Revisarlas de una en una →»). */
  derecha?: ReactNode
  /** S01n · Sin la lista (cargando, o la carga falló), «—» y no un 0: un 0 diría que no hay ninguna (reglas 7 y 8). */
  sinNumeros?: boolean
}) {
  const fila = useRef<HTMLDivElement | null>(null)
  const mover = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
    if (n === null) return
    e.preventDefault()
    const j = (n + pestanas.length) % pestanas.length
    alCambiar(pestanas[j].id)
    fila.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[j]?.focus()
  }
  return (
    <div className="s-pestanas-estado-fila">
      <div className="s-pestanas-estado" role="tablist" aria-label={etiqueta} ref={fila}>
        {pestanas.map((p, i) => (
          <button key={p.id} type="button" role="tab" aria-selected={p.id === actual} tabIndex={p.id === actual ? 0 : -1}
            className="s-pestana-estado" onClick={() => alCambiar(p.id)} onKeyDown={(e) => mover(e, i)}>
            <span>{p.etiqueta}</span>{sinNumeros
              ? <span className="s-pestana-estado-n s-cifra" data-prueba="pestana-sin-numero" title="Sin contar: no se ha podido leer la lista">—</span>
              : <span className="s-pestana-estado-n s-cifra">{p.n.toLocaleString('es-ES')}</span>}
          </button>
        ))}
      </div>
      {derecha && <div className="s-pestanas-estado-derecha">{derecha}</div>}
    </div>
  )
}

/** La fila de filtros, una sola. */
export function FiltrosLista({ children, etiqueta = 'Filtros' }: { children: ReactNode; etiqueta?: string }) {
  return <div className="s-filtros" role="group" aria-label={etiqueta}>{children}</div>
}

/** Un filtro de la fila: «Proveedor: Todos ▾». Un <select> de verdad. */
export function FiltroSelector({ etiqueta, valor, opciones, alCambiar }: {
  etiqueta: string; valor: string; opciones: readonly { valor: string; texto: string }[]; alCambiar: (v: string) => void
}) {
  const actual = opciones.find((o) => o.valor === valor)?.texto ?? opciones[0]?.texto ?? ''
  return (
    <label className="s-filtro">
      <span className="s-filtro-texto" aria-hidden="true"><span className="s-filtro-etiqueta">{etiqueta}:</span> {actual}</span>
      <select aria-label={etiqueta} value={valor} onChange={(e) => alCambiar(e.target.value)}>
        {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
      </select>
    </label>
  )
}

/** El buscador de la lista. */
export function FiltroBuscar({ valor, alCambiar, placeholder, etiqueta = 'Buscar en la lista' }: { valor: string; alCambiar: (v: string) => void; placeholder: string; etiqueta?: string }) {
  return (
    <label className="s-filtro-buscar">
      <span className="s-oculto">{etiqueta}</span>
      <input type="search" value={valor} placeholder={placeholder} onChange={(e) => alCambiar(e.target.value)} />
    </label>
  )
}

export interface ColumnaLista<T> {
  id: string
  titulo: string
  celda: (f: T) => ReactNode
  /** Cifras: a la derecha, con cifras tabulares. */
  cifra?: boolean
  /** Se puede ordenar por ella. */
  ordenable?: boolean
  ancho?: string
  /**
   * N5 · La regla de anchos: 1 = siempre se ve; cuanto más alta, antes se
   * oculta cuando no cabe (sin desplazarse de lado). Sin ella, 1.
   */
  prioridad?: number
  /** N5 · Lo que ocupa como mínimo, en px (sin él, 96). */
  minimo?: number
}

/** N5 · Lo que ocupan la casilla de marcar y la flecha de abrir, fuera de las columnas. */
const FUERA_DE_COLUMNAS = { casilla: 40, abrir: 40 }

/** D06 · Marcar filas (validar en bloque): una casilla en cada fila y otra en la cabecera para todas. */
export interface SeleccionLista {
  marcadas: ReadonlySet<string>
  alMarcar: (id: string, marcada: boolean) => void
  alMarcarTodas: (marcadas: boolean) => void
}

export function TablaLista<T>({ etiqueta, columnas, filas, clave, nombre, alAbrir, filaActual, orden, alOrdenar, vacio, pie, movil, tarjeta, seleccion }: {
  etiqueta: string
  columnas: readonly ColumnaLista<T>[]
  filas: readonly T[]
  clave: (f: T) => string
  /** Lo que dice el botón de abrir de la fila al lector («Abrir EUROPASTRY 24048027»). */
  nombre: (f: T) => string
  /** Abrir la fila (su ficha). Con el ratón, toda la fila; con el teclado, Intro. */
  alAbrir: (f: T) => void
  /** La fila donde ibas: se lleva a la vista y se marca. */
  filaActual?: string | null
  orden?: { columna: string; sentido: Sentido }
  alOrdenar?: (columna: string) => void
  /** Lo que dice la lista vacía, con su botón. */
  vacio: ReactNode
  /** El total, abajo: «9 facturas · Base … · IVA … · Total …». */
  pie?: ReactNode
  movil: boolean
  /** En el móvil, cada fila como tarjeta. */
  tarjeta: (f: T) => ReactNode
  /** D06 · Con ella, las filas se pueden marcar. */
  seleccion?: SeleccionLista
}) {
  const todas = !!seleccion && filas.length > 0 && filas.every((f) => seleccion.marcadas.has(clave(f)))
  const algunas = !!seleccion && !todas && filas.some((f) => seleccion.marcadas.has(clave(f)))
  const casilla = (f: T) => {
    const id = clave(f)
    return (
      <input type="checkbox" className="s-lista-casilla" aria-label={`Marcar ${nombre(f)}`} checked={seleccion!.marcadas.has(id)}
        onClick={(e) => e.stopPropagation()} onChange={(e) => seleccion!.alMarcar(id, e.target.checked)} />
    )
  }
  const caja = useRef<HTMLDivElement | null>(null)
  // N5 · El ancho que tiene la lista, para quitar columnas por prioridad hasta que quepan.
  const [anchoLista, setAnchoLista] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = caja.current
    if (!el || movil) return
    setAnchoLista(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setAnchoLista(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [movil])
  const disponible = anchoLista === null ? Number.POSITIVE_INFINITY : anchoLista - FUERA_DE_COLUMNAS.abrir - (seleccion ? FUERA_DE_COLUMNAS.casilla : 0)
  const caben = new Set(columnasQueCaben(columnas, disponible))
  const vistas = columnas.filter((c) => caben.has(c.id))
  const ocultas = columnas.filter((c) => !caben.has(c.id)).map((c) => c.titulo)
  useEffect(() => {
    if (!filaActual) return
    const el = caja.current?.querySelector<HTMLElement>(`[data-fila="${CSS.escape(filaActual)}"]`)
    el?.scrollIntoView({ block: 'center' })
  }, [filaActual, filas.length])

  if (movil) {
    return (
      <div className="s-lista-tarjetas" ref={caja} aria-label={etiqueta} role="list">
        {filas.length === 0 && <div className="s-lista-vacia">{vacio}</div>}
        {filas.map((f) => {
          const id = clave(f)
          return (
            <div key={id} role="listitem" data-fila={id} data-actual={id === filaActual ? '' : undefined} data-con-casilla={seleccion ? '' : undefined}>
              {seleccion && casilla(f)}
              <button type="button" className="s-lista-tarjeta" onClick={() => alAbrir(f)}>{tarjeta(f)}</button>
            </div>
          )
        })}
        {pie && filas.length > 0 && <div className="s-lista-pie">{pie}</div>}
      </div>
    )
  }
  return (
    <div className="s-lista" ref={caja} data-columnas-ocultas={ocultas.length ? ocultas.join(' · ') : undefined}>
      <table className="s-lista-tabla" aria-label={etiqueta} aria-description={textoColumnasOcultas(ocultas) ?? undefined}>
        <thead>
          <tr>
            {seleccion && (
              <th scope="col" className="s-lista-marca">
                <input type="checkbox" className="s-lista-casilla" aria-label="Marcar todas" checked={todas}
                  ref={(el) => { if (el) el.indeterminate = algunas }} onChange={(e) => seleccion.alMarcarTodas(e.target.checked)} />
              </th>
            )}
            {vistas.map((c) => {
              const activa = orden?.columna === c.id
              return (
                <th key={c.id} scope="col" className={c.cifra ? 's-lista-cifra' : undefined} style={c.ancho ? { width: c.ancho } : undefined}
                  aria-sort={activa ? (orden?.sentido === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.ordenable && alOrdenar
                    ? <button type="button" className="s-lista-orden" onClick={() => alOrdenar(c.id)}>{c.titulo}{activa ? (orden?.sentido === 'asc' ? ' ↑' : ' ↓') : ''}</button>
                    : c.titulo}
                </th>
              )
            })}
            <th aria-label="Abrir" className="s-lista-abrir" />
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 && <tr><td colSpan={vistas.length + (seleccion ? 2 : 1)} className="s-lista-vacia">{vacio}</td></tr>}
          {filas.map((f) => {
            const id = clave(f)
            return (
              <tr key={id} data-fila={id} data-actual={id === filaActual ? '' : undefined} data-marcada={seleccion?.marcadas.has(id) ? '' : undefined} onClick={() => alAbrir(f)}>
                {seleccion && <td className="s-lista-marca">{casilla(f)}</td>}
                {vistas.map((c) => <td key={c.id} className={c.cifra ? 's-lista-cifra' : undefined}>{c.celda(f)}</td>)}
                <td className="s-lista-abrir">
                  <button type="button" className="s-lista-abrir-boton" aria-label={`Abrir ${nombre(f)}`} onClick={(e) => { e.stopPropagation(); alAbrir(f) }}>›</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {pie && filas.length > 0 && <div className="s-lista-pie">{pie}</div>}
    </div>
  )
}
