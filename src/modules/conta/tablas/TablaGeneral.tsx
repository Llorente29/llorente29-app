// src/modules/conta/tablas/TablaGeneral.tsx
//
// UNA tabla general, la que diga el registro (maquetas N3Tablas y M3Tablas).
// La misma pieza para las nueve: lo que cambia está en registro.ts.
//
// Respuesta 1 de Julio, D5: abre con TODAS las filas, las que usas arriba y
// las demás debajo, con la separación a la vista. «Los que usas» es una
// píldora que acota cuando la persona la toca; la pantalla nunca abre acotada
// y no hay aviso al pie de «hay más que no te enseño» (regla 7).
//
// El detalle se abre en la misma fila; añadir y editar, también (§7: sin
// ventanas encima de ventanas). Cada cambio confirma con contenido o falla en
// pantalla (regla 8).

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Chip, Guardado, Inicial } from '@/modules/conta/ui/piezas'
import {
  agruparConceptos, cuentaDe, textoVigencia, valeHoy,
  type Concepto, type CuentaEditable, type DefinicionTabla, type FilaGeneral, type Valores,
} from '@/modules/conta/tablas/registro'
import { repartir, type ConceptoConUso, type ContextoUso } from '@/modules/conta/tablas/usadas'
import { FormularioFila, type OpcionBanco } from '@/modules/conta/tablas/FormularioFila'
import {
  borrarFila, crearFila, editarFila, guardarAjuste, nuevaVigencia, type Quien,
} from '@/modules/conta/services/tablasService'
import { fechaLarga, porcentaje } from '@/modules/conta/lib/formato'
import { leerPorcentaje, valoresIniciales } from '@/modules/conta/tablas/registro'

type Filtro = 'todos' | 'usas'

/** En qué está cada fila abierta: viendo, cambiando cuentas, editando, nuevo %, borrando. */
type Modo = 'ver' | 'cuentas' | 'editar' | 'vigencia' | 'borrar'

const ordenPorDefecto = (a: Concepto, b: Concepto) => {
  const sa = Number(a.fila.datos.sort_order ?? 0); const sb = Number(b.fila.datos.sort_order ?? 0)
  if (a.fila.serie !== b.fila.serie) return a.fila.serie ? -1 : 1
  return sa !== sb ? sa - sb : String(a.fila.datos.name ?? a.fila.datos.name_es ?? a.fila.datos.text ?? '')
    .localeCompare(String(b.fila.datos.name ?? b.fila.datos.name_es ?? b.fila.datos.text ?? ''), 'es')
}

export function TablaGeneral({ def, filas, ctx, quien, bancos, movil, alCambiar, cabeceraMovil }: {
  def: DefinicionTabla
  filas: FilaGeneral[]
  ctx: ContextoUso
  quien: Quien
  bancos: OpcionBanco[]
  movil: boolean
  /** Después de guardar: vuelve a leer. */
  alCambiar: () => void
  /** En el móvil, la cabecera con «atrás» y «+» la pone la página. */
  cabeceraMovil?: (abrirAlta: () => void) => ReactNode
}) {
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busca, setBusca] = useState('')
  // La fila abierta vive en la dirección (?fila=…), no en el componente: si la
  // aplicación se vuelve a montar (App.tsx enseña «Cargando…» mientras recarga
  // la cuenta), la fila sigue abierta; y «atrás» y los enlaces la respetan.
  const [params, setParams] = useSearchParams()
  const abierta = params.get('fila')
  const setAbierta = useCallback((id: string | null) => {
    setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('fila', id); else n.delete('fila'); return n }, { replace: true })
  }, [setParams])
  const [modo, setModo] = useState<Modo>('ver')
  const [anadiendo, setAnadiendo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)

  const reparto = useMemo(() => {
    const conceptos = agruparConceptos(filas, def.conVigencia, ctx.hoy)
    const b = busca.trim().toLowerCase()
    const vistos = b === '' ? conceptos : conceptos.filter((c) => def.buscable(c.fila).toLowerCase().includes(b))
    return repartir(def.id, vistos, ctx, ordenPorDefecto)
  }, [filas, def, ctx, busca])

  const abrir = (id: string | null) => { setAbierta(id); setModo('ver'); setFallo(null) }

  /** Hace algo, enseña lo que ha pasado (con contenido) o el fallo, y vuelve a leer. */
  const hacer = async (accion: () => Promise<void>, exito: string) => {
    setGuardando(true); setFallo(null); setHecho(null)
    try {
      await accion()
      setHecho(exito)
      setModo('ver')
      alCambiar()
    } catch (e) {
      setFallo(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardando(false)
    }
  }

  const nombre = (f: FilaGeneral) => def.tituloFila(f)

  const alta = () => { setAnadiendo(true); setAbierta(null); setHecho(null); setFallo(null) }

  const lista = filtro === 'usas' ? reparto.usas : [...reparto.usas, ...reparto.demas]
  const conGrupos = filtro === 'todos' && reparto.usas.length > 0 && reparto.demas.length > 0
  const total = reparto.usas.length + reparto.demas.length

  // ── Columnas de ordenador ─────────────────────────────────────────────
  const plantilla = [
    'minmax(0,1fr)', ...def.columnas.map((c) => c.ancho),
    ...(def.conVigencia ? ['150px'] : []), '140px', '90px', '64px',
  ].join(' ')

  const barra = (
    <div className="cx-tablas-barra">
      <div className="cx-tablas-filtros">
        {!movil && (
          <input type="search" className="cx-input cx-buscar" placeholder={`Buscar ${def.singular === 'serie' ? 'una serie' : `${articulo(def.singular)} ${def.singular}`}`}
            aria-label={`Buscar en ${def.titulo.toLowerCase()}`} value={busca} onChange={(e) => setBusca(e.target.value)} />
        )}
        <button type="button" className="cx-pildora" aria-pressed={filtro === 'usas'} onClick={() => setFiltro('usas')}>Los que usas</button>
        <button type="button" className="cx-pildora" aria-pressed={filtro === 'todos'} onClick={() => setFiltro('todos')}>Todos</button>
      </div>
      {!movil && !def.soloLectura && (
        <button type="button" className="cx-boton" onClick={alta} aria-expanded={anadiendo}>+ Añadir {def.singular}</button>
      )}
    </div>
  )

  const formularioAlta = anadiendo && (
    <div className="cx-tablas-abierta">
      <FormularioFila def={def} inicial={valoresIniciales(def, ctx.hoy)} editando={false} bancos={bancos}
        titulo={`Añadir ${def.singular}`} guardando={guardando}
        onCancelar={() => { setAnadiendo(false); setFallo(null) }}
        onGuardar={(v) => {
          const n = String(v.name ?? v.text ?? v.code ?? '').trim()
          void hacer(async () => { await crearFila(quien, def, v); setAnadiendo(false) },
            `Añadido «${n}». Ya sale en tus desplegables.`)
        }} />
      {fallo && anadiendo && <div className="cx-error" role="alert">{fallo}</div>}
    </div>
  )

  const avisos = (
    <>
      <Guardado texto={hecho} />
      {fallo && !anadiendo && abierta === null && <div className="cx-error" role="alert">{fallo}</div>}
    </>
  )

  const vacia = total === 0 && (
    <p className="cx-vacio" style={{ padding: '12px' }}>
      {busca.trim() !== '' ? `Nada en ${def.titulo.toLowerCase()} con «${busca.trim()}».` : def.vacia}
    </p>
  )

  const detalle = (c: ConceptoConUso) => (
    <Detalle def={def} c={c} hoy={ctx.hoy} modo={modo} setModo={setModo} guardando={guardando} fallo={fallo}
      bancos={bancos} movil={movil}
      ocultar={(oculta) => void hacer(() => guardarAjuste(quien, def, c.fila, { hidden: oculta }),
        oculta ? `Ocultado «${nombre(c.fila)}»: ya no sale en tus desplegables. Sigue aquí, en «Los demás».`
          : `«${nombre(c.fila)}» vuelve a salir en tus desplegables.`)}
      guardarCuentas={(cuentas) => void hacer(() => guardarAjuste(quien, def, c.fila, { cuentas }),
        `Cuentas de «${nombre(c.fila)}» cambiadas: ${Object.values(cuentas).filter(Boolean).join(' y ') || 'vuelven a las de serie'}.`)}
      editar={(v) => void hacer(() => editarFila(def, c.fila, v), `Guardado «${String(v.name ?? v.text ?? nombre(c.fila)).trim()}».`)}
      vigencia={(rate, desde) => void hacer(() => nuevaVigencia(quien, c.fila, rate, desde),
        `«${nombre(c.fila)}» pasa al ${porcentaje(rate)} desde el ${fechaLarga(desde)}. El ${porcentaje(Number(c.fila.datos.rate))} queda en su historial.`)}
      borrar={() => void hacer(async () => { await borrarFila(c.fila); setAbierta(null) }, `Borrado «${nombre(c.fila)}».`)} />
  )

  // ── Móvil ─────────────────────────────────────────────────────────────
  if (movil) {
    const fila = (c: ConceptoConUso) => {
      const abiertaEsta = abierta === c.fila.id
      const cifra = def.columnas[0]?.valor(c.fila)
      return (
        <div key={c.fila.id} className={abiertaEsta ? 'cx-tablas-movil-abierta' : undefined}>
          <button type="button" className="cx-lista-fila" aria-expanded={abiertaEsta} aria-controls={`det-${c.fila.id}`}
            onClick={() => abrir(abiertaEsta ? null : c.fila.id)}>
            <Inicial texto={def.inicial(c.fila)} tono={def.tono?.(c.fila)} />
            <span className="cx-lista-fila-texto">
              <span className="cx-lista-fila-titulo">{def.tituloFila(c.fila)}</span>
              <span className="cx-lista-fila-apoyo">{abiertaEsta ? def.apoyoFila(c.fila) ?? c.uso.donde : etiquetaMovil(c, def, ctx.hoy)}</span>
            </span>
            {cifra && def.columnas[0].cifra && <span className="cx-cifra" style={{ fontSize: 17 }}>{cifra}</span>}
            {!abiertaEsta && <span className="cx-flecha" aria-hidden="true">›</span>}
          </button>
          {abiertaEsta && <div id={`det-${c.fila.id}`}>{detalle(c)}</div>}
        </div>
      )
    }
    return (
      <>
        {cabeceraMovil?.(alta)}
        {barra}
        {avisos}
        {formularioAlta}
        {vacia || (
          <div className="cx-tablas-movil">
            {conGrupos && <h3 className="cx-tablas-grupo">Los que usas · {reparto.usas.length}</h3>}
            {conGrupos ? (
              <>
                <div className="cx-lista">{reparto.usas.map(fila)}</div>
                <h3 className="cx-tablas-grupo">Los demás · {reparto.demas.length}</h3>
                <div className="cx-lista">{reparto.demas.map(fila)}</div>
              </>
            ) : <div className="cx-lista">{lista.map(fila)}</div>}
          </div>
        )}
      </>
    )
  }

  // ── Ordenador ─────────────────────────────────────────────────────────
  const filaOrdenador = (c: ConceptoConUso) => {
    const abiertaEsta = abierta === c.fila.id
    const contenido = (
      <div role="row" className="cx-rejilla-fila" style={{ gridTemplateColumns: plantilla }}>
        <div role="cell" className="cx-rejilla-titulo">
          <Inicial texto={def.inicial(c.fila)} tono={def.tono?.(c.fila)} />
          <div style={{ minWidth: 0 }}>
            <div className="cx-fila-titulo">{def.tituloFila(c.fila)}</div>
            {def.apoyoFila(c.fila) && <div className="cx-fila-apoyo">{def.apoyoFila(c.fila)}</div>}
          </div>
        </div>
        {def.columnas.map((col) => (
          <div role="cell" key={col.id} className={`${col.cifra ? 'cx-cifra cx-rejilla-cifra' : ''}${col.apoyo ? ' cx-rejilla-apoyo' : ''}`}>
            {col.valor(c.fila)}
          </div>
        ))}
        {def.conVigencia && (
          <div role="cell" className="cx-rejilla-vigente">{textoVigencia(c.fila, ctx.hoy)}</div>
        )}
        <div role="cell" className="cx-rejilla-apoyo">{c.uso.donde}</div>
        <div role="cell"><Origen c={c} hoy={ctx.hoy} /></div>
        <div role="cell" style={{ textAlign: 'right' }}>
          <button type="button" className="cx-enlace" aria-expanded={abiertaEsta} aria-controls={`det-${c.fila.id}`}
            aria-label={`${abiertaEsta ? 'Cerrar' : 'Abrir'} ${def.tituloFila(c.fila)}`}
            onClick={() => abrir(abiertaEsta ? null : c.fila.id)}>
            {abiertaEsta ? 'Cerrar' : 'Abrir'}
          </button>
        </div>
      </div>
    )
    if (!abiertaEsta) return <div role="rowgroup" key={c.fila.id}>{contenido}</div>
    return (
      <div role="rowgroup" key={c.fila.id} className="cx-rejilla-abierta">
        {contenido}
        <div role="row"><div role="cell" id={`det-${c.fila.id}`}>{detalle(c)}</div></div>
      </div>
    )
  }

  const grupo = (titulo: string, filasGrupo: ConceptoConUso[]) => (
    <div role="rowgroup" aria-label={titulo}>
      <div role="row"><div role="cell" className="cx-tablas-grupo">{titulo} · {filasGrupo.length}</div></div>
    </div>
  )

  return (
    <section className="cx-tarjeta cx-tablas-panel" aria-labelledby="tabla-titulo">
      <h2 id="tabla-titulo" className="cx-oculto">{def.titulo}</h2>
      {barra}
      {avisos}
      {formularioAlta}
      {vacia || (
        <div role="table" aria-label={def.titulo} className="cx-rejilla">
          <div role="rowgroup">
            <div role="row" className="cx-rejilla-cabeza" style={{ gridTemplateColumns: plantilla }}>
              <span role="columnheader">{def.columnaTitulo}</span>
              {def.columnas.map((c) => <span role="columnheader" key={c.id} className={c.cifra ? 'cx-rejilla-cifra' : undefined}>{c.etiqueta}</span>)}
              {def.conVigencia && <span role="columnheader" className="cx-rejilla-vigente">Vigente</span>}
              <span role="columnheader">Dónde lo usas</span>
              <span role="columnheader">Origen</span>
              <span role="columnheader"><span className="cx-oculto">Detalle</span></span>
            </div>
          </div>
          {conGrupos && grupo('Los que usas', reparto.usas)}
          {(conGrupos ? reparto.usas : lista).map(filaOrdenador)}
          {conGrupos && grupo('Los demás', reparto.demas)}
          {conGrupos && reparto.demas.map(filaOrdenador)}
        </div>
      )}
    </section>
  )
}

const articulo = (s: string) => (/(ión|a)$/.test(s.split(' ')[0]) ? 'una' : 'un')

function etiquetaMovil(c: ConceptoConUso, def: DefinicionTabla, hoy: string): string {
  if (c.oculta) return 'Oculto'
  if (def.conVigencia && !valeHoy(c.fila, hoy)) return textoVigencia(c.fila, hoy)
  return c.uso.donde === '—' ? def.apoyoFila(c.fila) ?? '' : c.uso.donde
}

function Origen({ c, hoy }: { c: ConceptoConUso; hoy: string }) {
  if (c.oculta) return <Chip>Oculto</Chip>
  if (c.fila.validTo !== null && c.fila.validTo < hoy) return <Chip tono="ambar">Ya no vale</Chip>
  return c.fila.serie ? <Chip tono="ia">De serie</Chip> : <Chip tono="azul">Tuyo</Chip>
}

// ── El detalle, en la misma fila ───────────────────────────────────────────

function Detalle({ def, c, hoy, modo, setModo, guardando, fallo, bancos, movil, ocultar, guardarCuentas, editar, vigencia, borrar }: {
  def: DefinicionTabla
  c: ConceptoConUso
  hoy: string
  modo: Modo
  setModo: (m: Modo) => void
  guardando: boolean
  fallo: string | null
  bancos: OpcionBanco[]
  movil: boolean
  ocultar: (oculta: boolean) => void
  guardarCuentas: (c: Partial<Record<CuentaEditable, string | null>>) => void
  editar: (v: Valores) => void
  vigencia: (rate: number, desde: string) => void
  borrar: () => void
}) {
  const f = c.fila
  const datos = [
    ...(movil ? def.columnas.slice(1).map((col) => ({ etiqueta: col.etiqueta, valor: col.valor(f) })) : []),
    ...(movil && def.conVigencia ? [{ etiqueta: 'Vigente', valor: textoVigencia(f, hoy) }] : []),
    ...(movil ? [{ etiqueta: 'Dónde lo usas', valor: c.uso.donde }] : []),
    ...def.detalle.map((d) => ({ etiqueta: d.etiqueta, valor: d.valor(f) })),
  ].filter((d) => d.valor !== null && d.valor !== '')

  if (modo === 'editar') {
    return (
      <div className="cx-tablas-detalle">
        <FormularioFila def={def} inicial={def.aValores(f)} editando bancos={bancos} titulo={`Cambiar «${def.tituloFila(f)}»`}
          guardando={guardando} onCancelar={() => setModo('ver')} onGuardar={editar} />
        {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      </div>
    )
  }

  const historial = def.conVigencia && (
    <div className="cx-tablas-col" style={{ gap: 5 }}>
      <span className="cx-seccion-titulo">Historial</span>
      {[f, ...c.historial].map((h) => (
        <div key={h.id} style={{ fontSize: 14, fontWeight: h === f ? 600 : 400, color: h === f ? undefined : 'var(--cx-apoyo)' }}>
          {porcentaje(Number(h.datos.rate))} {textoVigencia(h, hoy).replace(/^Desde/, 'desde').replace(/^Hasta/, 'hasta').replace(/^Del/, 'del')}
        </div>
      ))}
    </div>
  )

  const norma = f.serie && (
    <div className="cx-tablas-norma">
      {typeof f.datos.legal_ref === 'string' && <span>{f.datos.legal_ref}</span>}
      {typeof f.datos.verified_at === 'string' && <span>Comprobado en la fuente oficial el {fechaLarga(f.datos.verified_at)}</span>}
      {def.notaSerie && <span>{def.notaSerie}</span>}
    </div>
  )

  return (
    <div className="cx-tablas-detalle">
      <div className="cx-tablas-columnas">
        <div className="cx-tablas-col">
          <span className="cx-seccion-titulo">{def.cuentasEditables.length || def.id === 'tipos-de-gasto' ? 'Detalle contable' : 'Detalle'}</span>
          {datos.map((d) => (
            <div className="cx-dato" key={d.etiqueta}>
              <span className="cx-dato-etiqueta">{d.etiqueta}</span>
              <span className="cx-dato-valor">{d.valor}</span>
            </div>
          ))}
        </div>
        {(historial || norma) && (
          <div className="cx-tablas-col" style={{ gap: 10 }}>
            {historial}
            {norma}
          </div>
        )}
      </div>

      {modo === 'cuentas' && <CambiarCuentas def={def} f={f} guardando={guardando} cancelar={() => setModo('ver')} guardar={guardarCuentas} />}
      {modo === 'vigencia' && <NuevoPorcentaje f={f} hoy={hoy} guardando={guardando} cancelar={() => setModo('ver')} guardar={vigencia} />}
      {modo === 'borrar' && (
        <div className="cx-aviso" role="alert" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ flexGrow: 1 }}>¿Borrar «{def.tituloFila(f)}»? No se puede deshacer.</span>
          <button type="button" className="cx-boton-sec" onClick={() => setModo('ver')} disabled={guardando}>No</button>
          <button type="button" className="cx-boton" onClick={borrar} disabled={guardando}>{guardando ? 'Borrando…' : 'Sí, borrar'}</button>
        </div>
      )}
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}

      {modo === 'ver' && !def.soloLectura && (
        <div className="cx-pie" style={{ justifyContent: 'flex-start' }}>
          {f.serie ? (
            <>
              {def.cuentasEditables.length > 0 && (
                <button type="button" className="cx-boton-sec" onClick={() => setModo('cuentas')}>Cambiar cuentas</button>
              )}
              {def.claveAjuste && (
                <button type="button" className="cx-boton-sec" onClick={() => ocultar(!c.oculta)} disabled={guardando}>
                  {c.oculta ? 'Volver a mostrar' : 'Ocultar'}
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" className="cx-boton-sec" onClick={() => setModo('editar')}>Cambiar</button>
              {def.conVigencia && valeHoy(f, hoy) && (
                <button type="button" className="cx-boton-sec" onClick={() => setModo('vigencia')}>Nuevo porcentaje</button>
              )}
              <button type="button" className="cx-boton-sec" onClick={() => setModo('borrar')}>Borrar</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function CambiarCuentas({ def, f, guardando, cancelar, guardar }: {
  def: DefinicionTabla; f: FilaGeneral; guardando: boolean; cancelar: () => void
  guardar: (c: Partial<Record<CuentaEditable, string | null>>) => void
}) {
  const [v, setV] = useState<Record<string, string>>(() =>
    Object.fromEntries(def.cuentasEditables.map((c) => [c.clave, cuentaDe(f, c.clave) ?? ''])))
  const [error, setError] = useState<string | null>(null)
  return (
    <form className="cx-formulario cx-tablas-formulario" aria-label="Cambiar cuentas" noValidate onSubmit={(e) => {
      e.preventDefault()
      if (Object.values(v).some((x) => x.trim() !== '' && !/^\d{3,12}$/.test(x.trim()))) {
        setError('Una cuenta son solo números, de 3 a 12 cifras (por ejemplo 472).'); return
      }
      // Si se deja igual que la de serie, no se guarda como cambio.
      guardar(Object.fromEntries(def.cuentasEditables.map((c) => {
        const x = v[c.clave].trim()
        return [c.clave, x === '' || x === String(f.datos[c.clave] ?? '') ? null : x]
      })))
    }}>
      <div className="cx-formulario-fila">
        {def.cuentasEditables.map((c) => (
          <div className="cx-campo" key={c.clave}>
            <label htmlFor={`cta-${f.id}-${c.clave}`}>{c.etiqueta}</label>
            <input id={`cta-${f.id}-${c.clave}`} className="cx-input" inputMode="numeric" value={v[c.clave]} disabled={guardando}
              onChange={(e) => setV((x) => ({ ...x, [c.clave]: e.target.value }))} />
            <span className="cx-ayuda">De serie: {String(f.datos[c.clave] ?? '—')}. Vacía, vuelve a la de serie.</span>
          </div>
        ))}
      </div>
      {error && <div className="cx-error" role="alert">{error}</div>}
      <div className="cx-pie">
        <button type="button" className="cx-boton-sec" onClick={cancelar} disabled={guardando}>Cancelar</button>
        <button type="submit" className="cx-boton" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar cuentas'}</button>
      </div>
    </form>
  )
}

function NuevoPorcentaje({ f, hoy, guardando, cancelar, guardar }: {
  f: FilaGeneral; hoy: string; guardando: boolean; cancelar: () => void; guardar: (rate: number, desde: string) => void
}) {
  const [rate, setRate] = useState('')
  const [desde, setDesde] = useState(hoy)
  const [error, setError] = useState<string | null>(null)
  return (
    <form className="cx-formulario cx-tablas-formulario" aria-label="Nuevo porcentaje" noValidate onSubmit={(e) => {
      e.preventDefault()
      const n = leerPorcentaje(rate)
      if (n === null) { setError('Escribe un porcentaje entre 0 y 100 (por ejemplo 21 o 5,2).'); return }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || (f.validFrom !== null && desde <= f.validFrom)) {
        setError(`La fecha tiene que ser posterior al ${f.validFrom ? fechaLarga(f.validFrom) : 'inicio'}.`); return
      }
      guardar(n, desde)
    }}>
      <p className="cx-ayuda" style={{ margin: 0 }}>
        El {porcentaje(Number(f.datos.rate))} no se borra: vale hasta el día antes y queda en el historial.
      </p>
      <div className="cx-formulario-fila">
        <div className="cx-campo">
          <label htmlFor={`vig-r-${f.id}`}>Porcentaje nuevo</label>
          <input id={`vig-r-${f.id}`} className="cx-input" inputMode="decimal" value={rate} disabled={guardando} onChange={(e) => setRate(e.target.value)} />
        </div>
        <div className="cx-campo">
          <label htmlFor={`vig-d-${f.id}`}>Desde</label>
          <input id={`vig-d-${f.id}`} className="cx-input" type="date" value={desde} disabled={guardando} onChange={(e) => setDesde(e.target.value)} />
        </div>
      </div>
      {error && <div className="cx-error" role="alert">{error}</div>}
      <div className="cx-pie">
        <button type="button" className="cx-boton-sec" onClick={cancelar} disabled={guardando}>Cancelar</button>
        <button type="submit" className="cx-boton" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  )
}
