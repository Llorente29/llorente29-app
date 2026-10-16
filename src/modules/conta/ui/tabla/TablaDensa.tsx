// src/modules/conta/ui/tabla/TablaDensa.tsx
//
// M01 · Pieza común · La tabla densa (maqueta N30 §4). La usan las pantallas
// de listado: el libro diario primero, y las de A, B y C cuando pasen las suyas
// (docs/conta/marco.md). De arriba abajo:
//   · la franja «Te toca hoy» (opcional): chips con su número que filtran;
//   · las vistas como botones («Todos», «Para revisar · 4»…), las guardadas
//     por la persona y «+ Guardar vista»; a la derecha, Exportar (Excel, CSV
//     y PDF);
//   · los filtros (fechas, listas y texto);
//   · la tabla: cabecera fija al bajar, en 11 px mayúsculas grises; filas de
//     13 px cuyo alto pone la densidad del marco (compacta, unas 30 por
//     pantalla; cómoda, unas 20); las cifras a la derecha y en mono;
//   · el pie: cuántas filas («12 de 340 asientos»), las marcadas, el cuadre
//     («Debe … · Haber … · Cuadra») y las teclas.
// Teclado: ↑ ↓ para moverse, Inicio y Fin, Intro para abrir y Espacio para
// marcar. En el móvil, una lista de tarjetas (sin teclado) con lo mismo
// arriba y el mismo pie.
//
// Lo que decide sin pintar vive en tablaDensa.ts (con sus pruebas). La
// pantalla filtra sus filas (sabe qué es cada una) y la tabla las pinta,
// las mueve, las marca y las baja.

import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { TeTocaHoy, type ChipPendiente } from '@/modules/conta/ui/marco/TeTocaHoy'
import {
  alternarMarca, cuadreDe, cuantas, hayFiltros, miles, moverEnTabla, textoCuadre,
  type Celda, type CampoFiltro, type ValoresFiltro,
} from '@/modules/conta/ui/tabla/tablaDensa'
import { exportarTabla, type FormatoExportar } from '@/modules/conta/ui/tabla/exportar'

export interface ColumnaDensa<T> {
  id: string
  titulo: string
  celda: (f: T) => ReactNode
  /** Lo que va al Excel, al CSV y al PDF; sin esto, la columna no se baja. */
  exportar?: (f: T) => Celda
  /** Cifra: a la derecha y en mono. */
  cifra?: boolean
  /** Ancho fijo («96px»); sin ancho, la columna se queda con lo que sobra. */
  ancho?: string
  /** Lo que ocupa en el PDF frente a las demás (1 de serie). */
  pesoPdf?: number
}

export interface VistaBoton {
  id: string
  texto: string
  /** Cuántas filas tiene; sin número, no se dice. */
  n?: number
  /** Una vista que guardó la persona: se puede borrar. */
  guardada?: boolean
}

export interface PropsTablaDensa<T> {
  /** El nombre de la tabla para el lector («Asientos del libro diario»). */
  etiqueta: string
  /** Singular y plural de una fila: ['asiento', 'asientos']. */
  nombreFila: readonly [string, string]
  /** Las filas con los filtros ya puestos, en su orden. */
  filas: readonly T[]
  /** Cuántas hay sin filtros (para «12 de 340»). Sin él, las de `filas`. */
  total?: number
  clave: (f: T) => string
  columnas: readonly ColumnaDensa<T>[]
  teTocaHoy?: ChipPendiente[]
  filtros?: { campos: readonly CampoFiltro[]; valores: ValoresFiltro; alCambiar: (v: Record<string, string>) => void }
  vistas?: {
    lista: readonly VistaBoton[]
    activa: string
    alElegir: (id: string) => void
    /** Con esto sale «+ Guardar vista». */
    alGuardar?: (nombre: string) => void
    alBorrar?: (id: string) => void
  }
  exportar?: { nombre: string; titulo: string; subtitulo: string }
  /** El Debe y el Haber de una fila: con esto, el pie dice el cuadre. */
  cuadre?: (f: T) => { debe: number; haber: number }
  /** Intro o clic en la fila. */
  alAbrir?: (f: T) => void
  /** La fila desplegada (la pantalla decide) y lo que se ve debajo de ella. */
  abierta?: string | null
  detalle?: (f: T) => ReactNode
  movil?: boolean
  /** Lo que se ve de una fila en el móvil. */
  tarjeta?: (f: T) => ReactNode
  /** Lo que se ve si no hay ninguna fila. */
  vacio?: ReactNode
  claseFila?: (f: T) => string | undefined
}

export function TablaDensa<T>(p: PropsTablaDensa<T>) {
  const base = useId()
  const [activa, setActiva] = useState(-1)
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set())
  const [aviso, setAviso] = useState<{ texto: string; tono: 'ok' | 'nada' } | null>(null)
  const claves = useMemo(() => p.filas.map(p.clave), [p.filas, p.clave])
  // Lo marcado que ya no se ve (otro filtro) no cuenta ni se baja.
  const marcadasVistas = claves.filter((k) => marcadas.has(k))
  const total = p.total ?? p.filas.length
  const cuadre = p.cuadre ? cuadreDe(p.filas.map(p.cuadre)) : null
  const actual = activa >= p.filas.length ? p.filas.length - 1 : activa

  const idFila = (i: number) => `${base}-f${i}`
  const ir = (i: number) => {
    setActiva(i)
    if (i >= 0) document.getElementById(idFila(i))?.scrollIntoView({ block: 'nearest' })
  }

  function tecla(e: KeyboardEvent<HTMLTableElement>) {
    if (e.target !== e.currentTarget) return
    const n = p.filas.length
    if (e.key === 'ArrowDown') { e.preventDefault(); ir(moverEnTabla(actual, 1, n)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); ir(moverEnTabla(actual, -1, n)) }
    else if (e.key === 'Home') { e.preventDefault(); ir(n ? 0 : -1) }
    else if (e.key === 'End') { e.preventDefault(); ir(n - 1) }
    else if (e.key === 'PageDown') { e.preventDefault(); ir(moverEnTabla(actual, 15, n)) }
    else if (e.key === 'PageUp') { e.preventDefault(); ir(moverEnTabla(actual, -15, n)) }
    else if (e.key === 'Enter' && actual >= 0) { e.preventDefault(); p.alAbrir?.(p.filas[actual]) }
    else if (e.key === ' ' && actual >= 0) { e.preventDefault(); setMarcadas((m) => alternarMarca(m, claves[actual])) }
  }

  function bajar(formato: FormatoExportar) {
    if (!p.exportar) return
    const cols = p.columnas.filter((c) => c.exportar)
    const filas = marcadasVistas.length ? p.filas.filter((_, i) => marcadas.has(claves[i])) : p.filas
    const pie = p.cuadre ? textoCuadre(cuadreDe(filas.map(p.cuadre))) : undefined
    const fichero = exportarTabla(formato, {
      nombre: p.exportar.nombre, titulo: p.exportar.titulo, subtitulo: p.exportar.subtitulo, pie,
      columnas: cols.map((c) => ({ titulo: c.titulo, cifra: c.cifra, peso: c.pesoPdf })),
      filas: filas.map((f) => cols.map((c) => c.exportar!(f))),
    })
    const que = cuantas(filas.length, filas.length, p.nombreFila)
    setAviso(fichero
      ? { texto: `Bajado ${fichero}: ${que}${marcadasVistas.length ? ' marcados' : ''}.`, tono: 'ok' }
      : { texto: `No hay ningún ${p.nombreFila[0]} que bajar con lo que hay puesto.`, tono: 'nada' })
  }

  const filtrosPuestos = p.filtros ? hayFiltros(p.filtros.valores) : false

  return (
    <div className="cxt" data-movil={p.movil ? 'si' : 'no'}>
      {p.teTocaHoy && p.teTocaHoy.length > 0 && <TeTocaHoy chips={p.teTocaHoy} />}

      {(p.vistas || p.exportar) && (
        <div className="cxt-barra">
          {p.vistas && <Vistas {...p.vistas} />}
          {p.exportar && (
            <div className="cxt-exportar" role="group" aria-label="Exportar">
              <span className="cxt-exportar-titulo" aria-hidden="true">Exportar</span>
              <button type="button" className="cxt-boton" onClick={() => bajar('xlsx')}>Excel</button>
              <button type="button" className="cxt-boton" onClick={() => bajar('csv')}>CSV</button>
              <button type="button" className="cxt-boton" onClick={() => bajar('pdf')}>PDF</button>
            </div>
          )}
        </div>
      )}
      {aviso && <p className={aviso.tono === 'ok' ? 'cxt-aviso cxt-aviso-ok' : 'cxt-aviso'} role="status">{aviso.texto}</p>}

      {p.filtros && (
        <Filtros campos={p.filtros.campos} valores={p.filtros.valores} alCambiar={p.filtros.alCambiar} movil={!!p.movil} puestos={filtrosPuestos} />
      )}

      {p.filas.length === 0 ? (
        <div className="cxt-vacio">{p.vacio ?? <p>No hay ningún {p.nombreFila[0]} con lo que hay puesto.</p>}</div>
      ) : p.movil ? (
        <ul className="cxt-lista" aria-label={p.etiqueta}>
          {p.filas.map((f, i) => (
            <li key={claves[i]} className={p.claseFila?.(f)}>
              <button type="button" className="cxt-tarjeta" onClick={() => p.alAbrir?.(f)}>{p.tarjeta ? p.tarjeta(f) : p.columnas.map((c) => <span key={c.id}>{c.celda(f)}</span>)}</button>
            </li>
          ))}
        </ul>
      ) : (
        <table className="cxt-tabla" role="grid" aria-label={p.etiqueta} aria-rowcount={p.filas.length + 1}
          aria-multiselectable="true" tabIndex={0} aria-activedescendant={actual >= 0 ? idFila(actual) : undefined}
          onKeyDown={tecla} onFocus={(e) => { if (e.target === e.currentTarget && actual < 0 && p.filas.length) setActiva(0) }}>
          <colgroup>
            <col style={{ width: 32 }} />
            {p.columnas.map((c) => <col key={c.id} style={c.ancho ? { width: c.ancho } : undefined} />)}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="cxt-marca"><span className="cx-oculto">Marcar</span></th>
              {p.columnas.map((c) => <th key={c.id} scope="col" className={c.cifra ? 'cxt-cifra' : undefined}>{c.titulo}</th>)}
            </tr>
          </thead>
          <tbody>
            {p.filas.map((f, i) => {
              const k = claves[i]
              const marcada = marcadas.has(k)
              const abierta = p.abierta === k
              const det = abierta && p.detalle ? p.detalle(f) : null
              return (
                <FilaConDetalle key={k} detalle={det} columnas={p.columnas.length + 1}>
                  <tr id={idFila(i)} aria-selected={marcada} aria-expanded={p.detalle ? abierta : undefined}
                    className={['cxt-fila', i === actual ? 'cxt-activa' : '', marcada ? 'cxt-marcada' : '', p.claseFila?.(f) ?? ''].filter(Boolean).join(' ')}
                    onClick={() => { setActiva(i); p.alAbrir?.(f) }}>
                    <td className="cxt-marca" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" tabIndex={-1} checked={marcada} aria-label={`Marcar la fila ${i + 1}`}
                        onChange={() => { setActiva(i); setMarcadas((m) => alternarMarca(m, k)) }} />
                    </td>
                    {p.columnas.map((c) => <td key={c.id} className={c.cifra ? 'cxt-cifra' : undefined}>{c.celda(f)}</td>)}
                  </tr>
                </FilaConDetalle>
              )
            })}
          </tbody>
        </table>
      )}

      <div className="cxt-pie">
        <span className="cxt-cuantas">
          {cuantas(p.filas.length, total, p.nombreFila)}
          {marcadasVistas.length > 0 && <> · {miles(marcadasVistas.length)} {marcadasVistas.length === 1 ? 'marcado' : 'marcados'} <button type="button" className="cxt-enlace" onClick={() => setMarcadas(new Set())}>Desmarcar</button></>}
        </span>
        {cuadre && (
          <span className={cuadre.cuadra ? 'cxt-cuadre cxt-cuadre-ok' : 'cxt-cuadre cxt-cuadre-mal'} role="status" aria-label="Cuadre">{textoCuadre(cuadre)}</span>
        )}
        {!p.movil && <span className="cxt-teclas">↑ ↓ moverse · Intro abrir · Espacio marcar</span>}
      </div>
    </div>
  )
}

function FilaConDetalle({ children, detalle, columnas }: { children: ReactNode; detalle: ReactNode; columnas: number }) {
  return (
    <>
      {children}
      {detalle != null && (
        <tr className="cxt-detalle">
          <td colSpan={columnas}>{detalle}</td>
        </tr>
      )}
    </>
  )
}

function Vistas({ lista, activa, alElegir, alGuardar, alBorrar }: NonNullable<PropsTablaDensa<unknown>['vistas']>) {
  const [nombrando, setNombrando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [hecho, setHecho] = useState<string | null>(null)
  const guardar = () => {
    if (!nombre.trim() || !alGuardar) return
    alGuardar(nombre.trim())
    setHecho(`Vista guardada: «${nombre.trim()}». Sale aquí cada vez que abras la pantalla.`)
    setNombre('')
    setNombrando(false)
  }
  return (
    <div className="cxt-vistas" role="group" aria-label="Vistas">
      {lista.map((v) => (
        <span key={v.id} className={v.guardada ? 'cxt-vista-guardada' : undefined}>
          <button type="button" className="cxt-vista" aria-pressed={activa === v.id} onClick={() => alElegir(v.id)}>
            {v.texto}{v.n !== undefined ? ` · ${miles(v.n)}` : ''}
          </button>
          {v.guardada && alBorrar && (
            <button type="button" className="cxt-vista-quitar" aria-label={`Borrar la vista «${v.texto}»`} title="Borrar la vista"
              onClick={() => { alBorrar(v.id); setHecho(`Vista borrada: «${v.texto}».`) }}>×</button>
          )}
        </span>
      ))}
      {alGuardar && !nombrando && <button type="button" className="cxt-vista cxt-vista-nueva" onClick={() => { setNombrando(true); setHecho(null) }}>+ Guardar vista</button>}
      {alGuardar && nombrando && (
        <form className="cxt-vista-nombre" onSubmit={(e) => { e.preventDefault(); guardar() }}>
          <input className="cxt-campo" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} aria-label="Nombre de la vista"
            placeholder="Nombre de la vista" onKeyDown={(e) => { if (e.key === 'Escape') { setNombrando(false); setNombre('') } }} />
          <button type="submit" className="cxt-boton" disabled={!nombre.trim()}>Guardar</button>
          <button type="button" className="cxt-enlace" onClick={() => { setNombrando(false); setNombre('') }}>Cancelar</button>
        </form>
      )}
      {hecho && <span className="cxt-vista-hecho" role="status">{hecho}</span>}
    </div>
  )
}

function Filtros({ campos, valores, alCambiar, movil, puestos }: {
  campos: readonly CampoFiltro[]; valores: ValoresFiltro; alCambiar: (v: Record<string, string>) => void; movil: boolean; puestos: boolean
}) {
  const poner = (id: string, v: string) => alCambiar({ ...valores, [id]: v })
  const cuerpo = (
    <div className="cxt-filtros" role="group" aria-label="Filtros">
      {campos.map((c) => (
        <label key={c.id} className={`cxt-filtro cxt-filtro-${c.tipo}`}>
          <span className="cxt-filtro-etiqueta">{c.etiqueta}</span>
          {c.tipo === 'opciones' ? (
            <select className="cxt-campo" value={valores[c.id] ?? ''} onChange={(e) => poner(c.id, e.target.value)}>
              {(c.opciones ?? []).map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
            </select>
          ) : (
            <input className="cxt-campo" type={c.tipo === 'texto' ? 'search' : 'date'} value={valores[c.id] ?? ''} placeholder={c.pista}
              onChange={(e) => poner(c.id, e.target.value)} />
          )}
        </label>
      ))}
      {puestos && <button type="button" className="cxt-enlace" onClick={() => alCambiar(Object.fromEntries(campos.map((c) => [c.id, ''])))}>Quitar filtros</button>}
    </div>
  )
  if (!movil) return cuerpo
  return (
    <details className="cxt-filtros-movil" open={puestos}>
      <summary>Filtros{puestos ? ' · puestos' : ''}</summary>
      {cuerpo}
    </details>
  )
}
