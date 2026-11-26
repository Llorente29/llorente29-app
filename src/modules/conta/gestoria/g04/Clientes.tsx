// src/modules/conta/gestoria/g04/Clientes.tsx
//
// G04 · Tarea 4 · La pantalla de Clientes, fiel a la maqueta aprobada por
// Julio el 08/11 (tablero Main): el selector de empresa con «Las dos», la
// banda del próximo cobro de GoCardless, las cuatro cifras, «Lo que tienes que
// hacer», «Tus clientes» y el panel lateral. Solo pinta: recibe el modelo
// (modelo.ts) y lo que hacer al pulsar. Palabras de oficina; el CRM, por su
// nombre.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { euros } from '../../../../../supabase/functions/_shared/tarifa/precio'
import { miles } from '../../../../../supabase/functions/_shared/tarifa/proximoCobro'
import { fraseDiferencia, fraseNoCobrado, nombreDelMes, textoAltasBajas, type Lista } from '../../../../../supabase/functions/_shared/tarifa/cifras'
import { ordenar, pasaElFiltro, pasaLaBusqueda, grupoDe, type Filtro, type Grupo } from '../../../../../supabase/functions/_shared/tarifa/lista'
import { type Empresa, type FilaDeLaLista, type ModeloClientes, type Tarea } from './modelo'

export interface PropsClientes {
  modelo: ModeloClientes
  empresas: Empresa[]
  /** La empresa activa de Sumied, o null con «Las dos». */
  elegida: string | null
  alElegir: (empresa: string | null) => void
  /** «Noviembre de 2026». */
  mes: string
  crm: string
  rutaFicha: (cliente: string, empresa: string | null) => string
  rutaTarifa: string
  rutaCrm: (f: FilaDeLaLista) => string | null
  alExportar: (filas: FilaDeLaLista[]) => void
  alAsignar: () => void
  /** «Cobrado por otra vía» de unos cargos devueltos: solo se guarda en Sumied. Devuelve la frase. */
  alCobradoPorOtraVia: (empresa: string, cargos: string[], via: 'transferencia' | 'efectivo', fecha: string) => Promise<string>
  /** «Ponerle la cuota»: a la ficha, con «+ Añadir» abierto. */
  rutaPonerCuota: (cliente: string, empresa: string | null) => string
  /** G05 · «Revisar el cobro» de la empresa elegida (con «Las dos», no hay uno solo: sin enlace). */
  rutaCobro?: string | null
  hoy: string
  /** GP · T4: lo del portal de los clientes (portal/PortalPendiente.tsx), con cuántas tareas hay además. Sin él, no sale. */
  portal?: (otras: number) => ReactNode
  /** Q08 · «Cargar decisiones de QBO»: el botón, al lado de «Exportar», y lo que ha pasado, debajo de la cabecera. Sin él, no sale. */
  decisiones?: { boton: ReactNode; resultado: ReactNode }
  /** R19 · «Bajar la copia de GoCardless», al lado de «Exportar». Sin ella, no sale. */
  copiaGc?: ReactNode
}

const FILTROS: { id: Filtro; texto: string }[] = [
  { id: 'todos', texto: 'Todos' }, { id: 'necesitan_algo', texto: 'Necesitan algo' }, { id: 'devueltos', texto: 'Devueltos' },
  { id: 'te_deben', texto: 'Te deben' }, { id: 'sin_mandato', texto: 'Sin mandato' },
]
const iniciales = (nombre: string) => {
  const p = nombre.replace(/[,.]/g, '').split(/\s+/).filter(Boolean)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase()
}

export function Clientes(p: PropsClientes) {
  const { modelo: m } = p
  const [grupo, setGrupo] = useState<Grupo>('se_cobra')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [abierta, setAbierta] = useState<string | null>(null)
  const listaRef = useRef<HTMLElement>(null)
  const cifrasRef = useRef<HTMLDivElement>(null)
  // R20 · La lista que forma una cifra, abierta en el panel lateral (suma exactamente la cifra).
  const [lista, setLista] = useState<{ lista: Lista; fuente: string } | null>(null)
  const cu = m.cifras.cuotas
  const nc = m.cifras.noCobrado

  const delGrupo = useMemo(() => m.filas.filter((f) => grupoDe(f) === grupo), [m.filas, grupo])
  const filas = useMemo(() => ordenar(delGrupo.filter((f) => pasaElFiltro(f, filtro) && pasaLaBusqueda(f, busqueda))), [delGrupo, filtro, busqueda])
  const enGrupo = { se_cobra: m.filas.filter((f) => grupoDe(f) === 'se_cobra').length, otros: m.filas.filter((f) => grupoDe(f) === 'otros').length }
  const clave = (f: FilaDeLaLista) => `${f.clienteId}|${f.empresaId ?? ''}`
  const panel = abierta ? m.filas.find((f) => clave(f) === abierta) ?? null : null
  const lasDos = p.elegida === null

  const irA = (t: Tarea) => {
    if (!t.filtro) {
      if (t.id === 'sin-cliente') p.alAsignar()
      if (t.id === 'cifras-no-cuadran') cifrasRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    setGrupo('se_cobra'); setFiltro(t.filtro)
    listaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="g4" data-pantalla="clientes-g04">
      <header className="g4-cabecera">
        <div className="g4-cabecera-textos">
          <div className="g4-antetitulo">{p.mes}</div>
          <h1 className="g4-titulo">Clientes y cuotas</h1>
        </div>
        <div className="g4-cabecera-acciones">
          <div className="g4-selector">
            <div role="radiogroup" aria-label="Empresa" className="g4-segmentos">
              {p.empresas.map((e) => (
                <button key={e.id} type="button" role="radio" aria-checked={p.elegida === e.id} className="g4-segmento" onClick={() => p.alElegir(e.id)}>{e.nombre}</button>
              ))}
              {p.empresas.length > 1 && <button type="button" role="radio" aria-checked={lasDos} className="g4-segmento" onClick={() => p.alElegir(null)}>Las dos</button>}
            </div>
            <div className="g4-pequeno">La empresa activa de Sumied · cada una con su contabilidad</div>
          </div>
          {p.decisiones?.boton}
          {p.copiaGc}
          <button type="button" className="g4-boton" onClick={() => p.alExportar(filas)}>Exportar</button>
        </div>
      </header>
      {p.decisiones?.resultado}

      <div ref={cifrasRef} />
      <section aria-labelledby="g4-proximo" className="g4-banda" data-cifra="gocardless">
        <div className="g4-banda-textos">
          <div className="g4-banda-ante">GoCardless cobrará en {nombreDelMes(cu.mes)} <span className="g4-fuente">· según GoCardless{m.cifras.leidoAt ? `, leído el ${horaDeLectura(m.cifras.leidoAt)}` : ''}</span></div>
          <h2 id="g4-proximo" className="g4-banda-cifra">
            <button type="button" className="g4-cifra-boton" onClick={() => setLista({ lista: cu.gocardless.lista, fuente: 'Según GoCardless' })}>{euros(cu.gocardless.lista.totalCent)}</button>
            {' · '}{miles(cu.gocardless.cobros)} {cu.gocardless.cobros === 1 ? 'cobro' : 'cobros'}
          </h2>
          {cu.gocardless.porDia.length > 0 && (
            <div className="g4-banda-linea">
              {cu.gocardless.porDia.map((d, i) => (
                <span key={d.texto}>{i > 0 && ' · '}{d.texto}: <button type="button" className="g4-cifra-boton" onClick={() => setLista({ lista: d.lista, fuente: 'Según GoCardless' })}>{euros(d.lista.totalCent)}</button> ({miles(d.cobros)} {d.cobros === 1 ? 'cobro' : 'cobros'})</span>
              ))}
            </div>
          )}
        </div>
        {p.rutaCobro
          ? <Link className="g4-banda-boton" to={p.rutaCobro}>Revisar el cobro →</Link>
          : <button type="button" className="g4-banda-boton" onClick={() => { setGrupo('se_cobra'); setFiltro('necesitan_algo'); listaRef.current?.scrollIntoView({ behavior: 'smooth' }) }}>Revisar el cobro →</button>}
      </section>

      <section aria-label="Cómo va el despacho" className="g4-cifras">
        <div className="g4-cifra" data-cifra="sumied" data-tono={cu.diferencia.cent !== 0 ? 'aviso' : undefined}>
          <div className="g4-cifra-titulo">Cuotas en Sumied · {nombreDelMes(cu.mes)} <span className="g4-fuente">· según las cuotas de Sumied</span></div>
          <div className="g4-cifra-valor"><button type="button" className="g4-cifra-boton" onClick={() => setLista({ lista: cu.sumied.lista, fuente: 'Según las cuotas de Sumied' })}>{euros(cu.sumied.lista.totalCent)}</button></div>
          <div className="g4-cifra-linea">
            {miles(cu.sumied.clientes)} {cu.sumied.clientes === 1 ? 'cliente' : 'clientes'} · Altas y bajas de {nombreDelMes(cu.mes)}:{' '}
            {cu.altas.filas.length ? <button type="button" className="g4-cifra-boton g4-sube" onClick={() => setLista({ lista: cu.altas, fuente: 'Según las cuotas de Sumied' })}>{textoAltasBajas(cu.altas, 'alta')}</button> : 'sin altas'}
            {' · '}
            {cu.bajas.filas.length ? <button type="button" className="g4-cifra-boton g4-baja" onClick={() => setLista({ lista: cu.bajas, fuente: 'Según las cuotas de Sumied' })}>{textoAltasBajas(cu.bajas, 'baja')}</button> : 'sin bajas'}
          </div>
          {cu.diferencia.cent === 0
            ? <div className="g4-cifra-linea">Igual que lo que cobrará GoCardless.</div>
            : (
              <div className="g4-ambar" data-cifra="diferencia">
                <b>{fraseDiferencia(cu.diferencia.cent)}.</b> Por qué (cada parte se abre en su lista):
                <table className="g4-ambar-tabla"><tbody>
                  {cu.diferencia.grupos.map((g) => (
                    <tr key={g.titulo}><td><button type="button" className="g4-cifra-boton" onClick={() => setLista({ lista: g, fuente: 'GoCardless − Sumied' })}>{g.titulo}</button></td><td>{conSigno(g.totalCent)}</td></tr>
                  ))}
                  <tr><td><b>Diferencia</b></td><td><b>{conSigno(cu.diferencia.cent)}</b></td></tr>
                </tbody></table>
              </div>
            )}
        </div>
        <div className="g4-cifra" data-tono="mal" data-cifra="no-cobrado">
          <div className="g4-cifra-titulo">{nc.titulo} <span className="g4-fuente">· según GoCardless{nc.pagadoPorElBanco ? ' y el banco' : ''}</span></div>
          <div className="g4-cifra-valor"><button type="button" className="g4-cifra-boton" onClick={() => setLista({ lista: nc.lista, fuente: 'Según GoCardless' })}>{euros(nc.lista.totalCent)}</button></div>
          <div className="g4-cifra-linea">{fraseNoCobrado(nc)}</div>
          {!nc.cruzado && (nc.faltanPorCruzar.length
            ? <div className="g4-cifra-linea">Falta cruzar con el banco lo de {nc.faltanPorCruzar.join(' y ')}: lo que se pagó por transferencia, Bizum o tarjeta aún no se descuenta.</div>
            : <div className="g4-cifra-linea">Falta cruzar con el banco: lo pagado por transferencia, Bizum o tarjeta aún no se descuenta.</div>)}
          <table className="g4-ambar-tabla"><tbody>
            {nc.tramos.map((t) => (
              <tr key={t.texto}><td>{t.lista.filas.length ? <button type="button" className="g4-cifra-boton" onClick={() => setLista({ lista: t.lista, fuente: 'Según GoCardless' })}>{t.texto}</button> : t.texto}</td><td>{euros(t.lista.totalCent)}</td></tr>
            ))}
          </tbody></table>
          {nc.conMandatoCancelado.filas.length > 0 && (
            <div className="g4-cifra-linea">De ellos, con el mandato ya cancelado: <button type="button" className="g4-cifra-boton" onClick={() => setLista({ lista: nc.conMandatoCancelado, fuente: 'Según GoCardless' })}>{euros(nc.conMandatoCancelado.totalCent)}</button></div>
          )}
          {nc.pagadoPorElBanco && nc.pagadoPorElBanco.filas.length > 0 && (
            <div className="g4-cifra-linea">Pagado después por el banco, que ya no cuenta: <button type="button" className="g4-cifra-boton" onClick={() => setLista({ lista: nc.pagadoPorElBanco!, fuente: 'Según el banco' })}>{euros(nc.pagadoPorElBanco.totalCent)}</button></div>
          )}
          {nc.tarjetaSinAsignar && nc.tarjetaSinAsignar.filas.length > 0 && (
            <div className="g4-cifra-linea">Cobrado con tarjeta sin asignar a ningún cliente (no se descuenta): <button type="button" className="g4-cifra-boton" onClick={() => setLista({ lista: nc.tarjetaSinAsignar!, fuente: 'Según el banco' })}>{euros(nc.tarjetaSinAsignar.totalCent)}</button> ({nc.tarjetaSinAsignar.filas.length.toLocaleString('es-ES')} abonos)</div>
          )}
        </div>
        <div className="g4-cifra" data-tono="aviso">
          <div className="g4-cifra-titulo">Dejas de cobrar</div>
          <div className="g4-cifra-valor">{miles(m.dejasDeCobrar.activosSinCuota)} {m.dejasDeCobrar.activosSinCuota === 1 ? 'cliente' : 'clientes'}</div>
          <div className="g4-cifra-linea">Activos sin cuota: no se les cobra nada, ni en Sumied ni en GoCardless</div>
        </div>
      </section>

      <section aria-labelledby="g4-hacer" className="g4-bloque">
        <div className="g4-bloque-cabecera">
          <h2 id="g4-hacer" className="g4-bloque-titulo">Lo que tienes que hacer</h2>
          <div className="g4-pequeno" style={{ fontSize: 13 }}>Primero lo que más dinero mueve</div>
        </div>
        {m.tareas.length === 0
          ? (p.portal ? null : <p className="g4-nada">Nada pendiente.</p>)
          : <div className="g4-tareas">
            {m.tareas.map((t) => (
              <div key={t.id} className="g4-tarea" data-tono={t.tono}>
                <div className="g4-tarea-cabeza"><div className="g4-tarea-n">{miles(t.n)}</div><div className="g4-tarea-titulo">{t.titulo}</div></div>
                <div className="g4-tarea-texto">{t.texto}</div>
                <button type="button" className="g4-enlace" onClick={() => irA(t)}>{t.boton} →</button>
              </div>
            ))}
          </div>}
        {p.portal?.(m.tareas.length)}
      </section>

      <section aria-labelledby="g4-lista" className="g4-bloque g4-lista" ref={listaRef}>
        <div className="g4-lista-cabecera">
          <div className="g4-lista-izquierda">
            <h2 id="g4-lista" className="g4-bloque-titulo">Tus clientes</h2>
            <div role="tablist" aria-label="Qué clientes ver" className="g4-pestanas">
              <button type="button" role="tab" aria-selected={grupo === 'se_cobra'} className="g4-segmento" onClick={() => { setGrupo('se_cobra'); setFiltro('todos') }}>Se les cobra · {miles(enGrupo.se_cobra)}</button>
              <button type="button" role="tab" aria-selected={grupo === 'otros'} className="g4-segmento" onClick={() => { setGrupo('otros'); setFiltro('todos') }}>Otros · {miles(enGrupo.otros)}</button>
            </div>
          </div>
          <label className="g4-buscador">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input aria-label="Buscar cliente, NIF o trabajador" placeholder="Buscar cliente, NIF o trabajador" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          </label>
        </div>
        {grupo === 'se_cobra' && (
          <div className="g4-filtros">
            {FILTROS.map((x) => (
              <button key={x.id} type="button" className="g4-filtro" aria-pressed={filtro === x.id} onClick={() => setFiltro(x.id)}>
                {x.texto}{x.id === 'todos' ? ` · ${miles(delGrupo.length)}` : ` · ${miles(delGrupo.filter((f) => pasaElFiltro(f, x.id)).length)}`}
              </button>
            ))}
          </div>
        )}
        <div className="g4-tabla-caja">
          <div className="g4-tabla" role="table" aria-label="Tus clientes">
            <div className="g4-fila-titulos" role="row">
              <div role="columnheader">Cliente</div><div role="columnheader">Qué le cobras</div><div role="columnheader" className="g4-derecha">Este mes</div>
              <div role="columnheader" className="g4-derecha">Debe</div><div role="columnheader">Cobro</div>
            </div>
            {filas.map((f, i) => (
              <button key={clave(f)} type="button" role="row" className="g4-fila" aria-current={abierta === clave(f)} aria-label={`Abrir ${f.nombre}`} onClick={() => setAbierta(clave(f))}>
                <div role="cell" className="g4-cliente">
                  <div aria-hidden="true" className="g4-iniciales" data-c={String(i % 4)}>{iniciales(f.nombre)}</div>
                  <div className="g4-cliente-textos">
                    <div className="g4-cliente-nombre">{f.nombre}</div>
                    <div className="g4-cliente-linea">{f.figura}{lasDos && <b> · {f.empresa ?? 'Sin empresa'}</b>}</div>
                  </div>
                </div>
                <div role="cell" className="g4-servicios">{f.servicios}</div>
                <div role="cell" className="g4-importe">
                  {f.esteMes.principalCent === null ? '—' : euros(f.esteMes.principalCent)}
                  {f.esteMes.alLado && <small>{f.esteMes.alLado}</small>}
                </div>
                <div role="cell" className="g4-debe" data-debe={f.debeCent > 0 ? '' : undefined}>{f.debeCent > 0 ? euros(f.debeCent) : '0 €'}</div>
                <div role="cell" className="g4-cobro">
                  <span className="g4-etiqueta" data-tono={f.estado.tono}>{f.estado.texto}</span>
                  {f.estado.detalle && <span className="g4-pequeno">{f.estado.detalle}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="g4-pie">
          <div>{filas.length === delGrupo.length ? `${miles(filas.length)} ${filas.length === 1 ? 'cliente' : 'clientes'}` : `${miles(filas.length)} de ${miles(delGrupo.length)}`}</div>
          <div>Primero los que necesitan algo; después, por nombre</div>
        </div>
      </section>

      {lista && <PanelLista lista={lista.lista} fuente={lista.fuente} alCerrar={() => setLista(null)} />}
      {panel && <PanelCliente fila={panel} crm={p.crm} alCerrar={() => setAbierta(null)} rutaFicha={p.rutaFicha(panel.clienteId, panel.empresaId)} rutaTarifa={p.rutaTarifa} rutaCrm={p.rutaCrm(panel)}
        rutaPonerCuota={p.rutaPonerCuota(panel.clienteId, panel.empresaId)} hoy={p.hoy}
        alCobradoPorOtraVia={(cargos, via, fecha) => p.alCobradoPorOtraVia(panel.empresaId!, cargos, via, fecha)} />}
    </div>
  )
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** El panel lateral: fijo a la vista, sin aplastar la lista; se cierra con «×», con Escape o al pulsar fuera. */
export function PanelCliente({ fila: f, crm, alCerrar, rutaFicha, rutaTarifa, rutaCrm, rutaPonerCuota, hoy, alCobradoPorOtraVia }: {
  fila: FilaDeLaLista; crm: string; alCerrar: () => void; rutaFicha: string; rutaTarifa: string; rutaCrm: string | null; rutaPonerCuota: string; hoy: string
  alCobradoPorOtraVia: (cargos: string[], via: 'transferencia' | 'efectivo', fecha: string) => Promise<string>
}) {
  const cerrarRef = useRef<HTMLButtonElement>(null)
  const [otraVia, setOtraVia] = useState(false)
  useEffect(() => {
    cerrarRef.current?.focus()
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') alCerrar() }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [alCerrar])
  const mesQueViene = MESES[Number(hoy.slice(5, 7)) % 12]
  const fecha = (x: string) => `${Number(x.slice(8, 10))}/${x.slice(5, 7)}`
  return (
    <>
      <button type="button" className="g4-velo" aria-label="Cerrar el resumen" tabIndex={-1} onClick={alCerrar} />
      <aside aria-label="Resumen del cliente" className="g4-panel" data-panel="cliente">
        <div className="g4-panel-cabeza">
          <div className="g4-panel-fila">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2 className="g4-panel-nombre">{f.nombre}</h2>
                <span className="g4-etiqueta" data-tono={f.situacionTono}>{f.situacionTexto}</span>
              </div>
              <div className="g4-panel-linea">{[f.nif ?? 'Sin NIF', f.figura].join(' · ')} · {f.empresa ? <>Le factura <b>{f.empresa}</b></> : 'Sin empresa que le facture'}</div>
            </div>
            <button ref={cerrarRef} type="button" className="g4-cerrar" aria-label="Cerrar" onClick={alCerrar}>×</button>
          </div>
          <div className="g4-tres">
            <div className="g4-mini"><div className="g4-mini-titulo">Este mes</div><div className="g4-mini-valor">{f.esteMes.principalCent === null ? '—' : euros(f.esteMes.principalCent)}</div>
              {f.esteMes.alLado && <div className="g4-mini-titulo">{f.esteMes.alLado}</div>}</div>
            <div className="g4-mini"><div className="g4-mini-titulo">Debe</div><div className="g4-mini-valor" style={f.debeCent > 0 ? { color: '#A11B12' } : undefined}>{f.debeCent > 0 ? euros(f.debeCent) : '0 €'}</div></div>
            <div className="g4-mini"><div className="g4-mini-titulo">Último cobro</div>
              <div className="g4-mini-valor" data-texto="">{f.ultimoCargo ? `${f.ultimoCargo.estado} · ${fecha(f.ultimoCargo.fecha)}` : 'Ninguno en GoCardless'}</div>
              {f.ultimoCargo && <div className="g4-mini-titulo">{euros(f.ultimoCargo.importeCent)}</div>}</div>
          </div>
        </div>
        {f.aviso && (
          <div className="g4-aviso" role="status">
            <div className="g4-aviso-titulo">{f.aviso.titulo}</div>
            <div className="g4-aviso-texto">{f.aviso.texto}</div>
            {otraVia && f.aviso.accion === 'otra_via'
              ? <OtraVia cargos={f.devueltos} hoy={hoy} alGuardar={alCobradoPorOtraVia} alCancelar={() => setOtraVia(false)} />
              : <div className="g4-aviso-botones">
                {f.aviso.accion === 'otra_via' && <button type="button" className="g4-aviso-boton" onClick={() => setOtraVia(true)}>{f.aviso.boton}</button>}
                {f.aviso.accion === 'poner_cuota' && <Link className="g4-aviso-boton" to={rutaPonerCuota}>{f.aviso.boton}</Link>}
                <button type="button" className="g4-aviso-boton" data-tipo="sec" onClick={alCerrar}>Ahora no</button>
              </div>}
          </div>
        )}
        <div className="g4-panel-seccion">
          <h3 className="g4-seccion-titulo">Qué se le cobra en {mesQueViene}</h3>
          {f.lineas.length === 0
            ? <div className="g4-renglon"><span>Nada en Sumied{f.servicios !== 'Sin cuota en Sumied' ? `. En GoCardless: ${f.servicios}` : ''}</span><b>—</b></div>
            : f.lineas.map((l) => <div key={l.texto} className="g4-renglon"><span>{l.texto}</span><b>{l.importe}</b></div>)}
        </div>
        <div className="g4-panel-seccion" style={{ paddingTop: 0 }}>
          <h3 className="g4-seccion-titulo">Contacto</h3>
          <div className="g4-contacto">{[f.telefono, f.correo].filter(Boolean).join(' · ') || `Sin teléfono ni email en ${crm}`}</div>
        </div>
        <div className="g4-panel-pie">
          <Link className="g4-boton" data-tipo="primario" to={rutaFicha}>Abrir la ficha completa</Link>
          <Link className="g4-boton" to={rutaTarifa}>Cambiar tarifa</Link>
          {rutaCrm && <a className="g4-boton" href={rutaCrm} target="_blank" rel="noreferrer">Ver en {crm} ↗</a>}
        </div>
      </aside>
    </>
  )
}

/** «Cobrado por otra vía»: qué cargos, cómo y qué día. Solo se guarda en Sumied; confirma con su frase (regla 8). */
export function OtraVia({ cargos, hoy, alGuardar, alCancelar }: {
  cargos: { id: string; fecha: string; importeCent: number }[]; hoy: string
  alGuardar: (cargos: string[], via: 'transferencia' | 'efectivo', fecha: string) => Promise<string>; alCancelar: () => void
}) {
  const [marcados, setMarcados] = useState<string[]>(cargos.map((c) => c.id))
  const [via, setVia] = useState<'transferencia' | 'efectivo'>('transferencia')
  const [dia, setDia] = useState(hoy)
  const [estado, setEstado] = useState<{ ok: boolean; texto: string } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const guardar = async () => {
    setGuardando(true); setEstado(null)
    try { setEstado({ ok: true, texto: await alGuardar(marcados, via, dia) }) }
    catch (e) { setEstado({ ok: false, texto: e instanceof Error ? e.message : String(e) }) }
    finally { setGuardando(false) }
  }
  if (estado?.ok) return <p className="g4-aviso-texto" role="status"><b>{estado.texto}</b></p>
  return (
    <form className="g4-otra-via" onSubmit={(e) => { e.preventDefault(); void guardar() }}>
      <fieldset className="g4-otra-via-cargos">
        <legend className="g4-aviso-texto">Qué cargos</legend>
        {cargos.map((c) => (
          <label key={c.id} className="g4-casilla">
            <input type="checkbox" checked={marcados.includes(c.id)} onChange={(e) => setMarcados(e.target.checked ? [...marcados, c.id] : marcados.filter((x) => x !== c.id))} />
            {`${Number(c.fecha.slice(8, 10))}/${c.fecha.slice(5, 7)}/${c.fecha.slice(0, 4)} · ${euros(c.importeCent)}`}
          </label>
        ))}
      </fieldset>
      <div className="g4-otra-via-fila">
        <label className="g4-campo">Cómo<select value={via} onChange={(e) => setVia(e.target.value as 'transferencia' | 'efectivo')}><option value="transferencia">Por transferencia</option><option value="efectivo">En efectivo</option></select></label>
        <label className="g4-campo">Qué día<input type="date" value={dia} max={hoy} onChange={(e) => setDia(e.target.value)} /></label>
      </div>
      {estado && !estado.ok && <p className="g4-aviso-texto" role="alert">{estado.texto}</p>}
      <div className="g4-aviso-botones">
        <button type="submit" className="g4-aviso-boton" disabled={guardando || marcados.length === 0 || !dia}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="g4-aviso-boton" data-tipo="sec" onClick={alCancelar}>Cancelar</button>
      </div>
    </form>
  )
}

const conSigno = (cent: number) => `${cent > 0 ? '+' : ''}${euros(cent)}`
/** «26/11 a las 07:15», en Madrid. */
function horaDeLectura(iso: string): string {
  const f = new Date(iso)
  const dia = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'numeric' }).format(f)
  const hora = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(f)
  return `${dia} a las ${hora}`
}

/** R20 · La lista que forma una cifra: cada fila con su importe y, abajo, la suma, que es la cifra (regla 2). */
export function PanelLista({ lista: l, fuente, alCerrar }: { lista: Lista; fuente: string; alCerrar: () => void }) {
  const cerrarRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cerrarRef.current?.focus()
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') alCerrar() }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [alCerrar])
  return (
    <>
      <button type="button" className="g4-velo" aria-label="Cerrar la lista" tabIndex={-1} onClick={alCerrar} />
      <aside aria-label={l.titulo} className="g4-panel" data-panel="lista">
        <div className="g4-panel-cabeza">
          <div className="g4-panel-fila">
            <div>
              <h2 className="g4-panel-nombre">{l.titulo}</h2>
              <div className="g4-panel-linea">{fuente} · {l.filas.length.toLocaleString('es-ES')} {l.filas.length === 1 ? 'fila' : 'filas'}</div>
            </div>
            <button ref={cerrarRef} type="button" className="g4-cerrar" aria-label="Cerrar" onClick={alCerrar}>×</button>
          </div>
        </div>
        <div className="g4-panel-seccion">
          {l.filas.map((f) => (
            <div key={f.id} className="g4-renglon" data-fila="lista">
              <span><span>{f.texto}</span>{f.detalle && <span className="g4-renglon-detalle">{f.detalle}</span>}</span>
              {!l.soloCuenta && <b>{euros(f.importeCent)}</b>}
            </div>
          ))}
          <div className="g4-renglon" data-fila="total"><span><b>{l.soloCuenta ? 'En total' : 'Suma'}</b></span><b>{l.soloCuenta ? l.filas.length.toLocaleString('es-ES') : euros(l.totalCent)}</b></div>
        </div>
      </aside>
    </>
  )
}
