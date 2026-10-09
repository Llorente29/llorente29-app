// src/modules/conta/libros/LibrosPage.tsx
//
// C05 · Libros en tres niveles (maqueta N13cLibros). Nivel 1, el menú lateral
// (MarcoConta). Nivel 2, las pestañas de área. Nivel 3, la barra de acciones
// agrupadas con la etiqueta del grupo debajo y, a la derecha, «Tuyos»
// (Favoritos y Buscar, Ctrl K). Debajo, el contenido de la acción elegida.
// Dos clics como máximo a cualquier libro. Lo que la empresa no usa sale en
// gris con «ninguno» (son libros obligatorios: no desaparece).
//
// En el móvil, por niveles: la lista de áreas, al tocar una, sus acciones en
// lista, y al tocar una acción, su contenido con «‹ Libros» para volver.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { rutaLibros } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { ErrorConReintento, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import {
  AREAS_LIBROS, NINGUNO, accionesDe, alternarFavorito, buscar, dondeEsta, leerFavoritos, resolver, type Accion, type EstadoAccion,
} from '@/modules/conta/libros/navegacion'
import { LibrosCtx, trimestreDe, useLeer, type ContextoLibros } from '@/modules/conta/libros/contexto'
import { leerEjerciciosLibros, localesYMarcas, resumenLibros, type ResumenLibros } from '@/modules/conta/services/librosService'
import LibroDiarioPage from '@/modules/conta/libro/LibroDiarioPage'
import { DiarioResumido } from '@/modules/conta/libros/DiarioResumido'
import { LibroMayor } from '@/modules/conta/libros/LibroMayor'
import { SumasSaldos, Acumulados } from '@/modules/conta/libros/SumasSaldos'
import { RegistroIva, FormatoAeat } from '@/modules/conta/libros/RegistroIva'
import { BienesInversion, Retenciones, Suplidos } from '@/modules/conta/libros/OtrosLibros'
import { Estados } from '@/modules/conta/libros/Estados'
import { CuentasAnuales, Mapeo, PendienteC05b } from '@/modules/conta/libros/Anuales'
import { CerrarMes, CierreEjercicio, Ejercicios } from '@/modules/conta/libros/Cierre'

const almacen = (): Storage | null => { try { return window.localStorage } catch { return null } }

/** El contenido de cada acción. */
function contenido(accion: string): ReactNode {
  switch (accion) {
    case 'libro-diario': return <LibroDiarioPage />
    case 'diario-resumido': return <DiarioResumido />
    case 'libro-mayor': return <LibroMayor />
    case 'sumas-saldos': return <SumasSaldos />
    case 'acumulados': return <Acumulados />
    case 'expedidas': return <RegistroIva libro="issued" />
    case 'recibidas': return <RegistroIva libro="received" />
    case 'intracomunitarias': return <RegistroIva libro="intracomunitarias" />
    case 'bienes-inversion': return <BienesInversion />
    case 'suplidos': return <Suplidos />
    case 'retenciones': return <Retenciones />
    case 'formato-aeat': return <FormatoAeat />
    case 'balance': return <Estados estado="balance" />
    case 'pyg': return <Estados estado="pyg" />
    case 'ecpn': return <Estados estado="ecpn" />
    case 'balances-pdf': return <Estados estado="balance" salida="pdf" />
    case 'balances-excel': return <Estados estado="balance" salida="excel" />
    case 'cuentas-anuales': return <CuentasAnuales />
    case 'mapeo': return <Mapeo />
    case 'memoria': return <PendienteC05b que="memoria" />
    case 'legalizacion': return <PendienteC05b que="legalizacion" />
    case 'deposito': return <PendienteC05b que="deposito" />
    case 'ejercicios': return <Ejercicios />
    case 'cerrar-mes': return <CerrarMes />
    case 'cierre-ejercicio': return <CierreEjercicio />
    default: return null
  }
}

/** El dato o estado de cada acción, con lo que se ha leído (gris «ninguno» si no hay). */
function estados(r: ResumenLibros | null, nombreTrimestre: string, ctx: Pick<ContextoLibros, 'ejercicio' | 'ejercicios'>): Record<string, EstadoAccion> {
  const e: Record<string, EstadoAccion> = {}
  const ej = ctx.ejercicio
  e['libro-diario'] = { texto: `ejercicio ${ej.code}`, tono: 'verde' }
  e['diario-resumido'] = { texto: 'por mes y cuenta', tono: 'gris' }
  e['libro-mayor'] = { texto: 'por cuenta', tono: 'gris' }
  e['sumas-saldos'] = { texto: 'niveles y opciones', tono: 'gris' }
  e['acumulados'] = { texto: 'saldo de cada mes', tono: 'gris' }
  if (r) {
    e.expedidas = r.expedidas ? { texto: `${nombreTrimestre.split(' ')[0]} · ${r.expedidas.toLocaleString('es-ES')}`, tono: 'verde' } : NINGUNO
    e.recibidas = r.recibidas ? { texto: `${nombreTrimestre.split(' ')[0]} · ${r.recibidas.toLocaleString('es-ES')}${r.sinNif ? ` · ${r.sinNif} sin NIF` : ''}`, tono: r.sinNif ? 'ambar' : 'verde' } : NINGUNO
    e['bienes-inversion'] = r.bienes ? { texto: `${r.bienes} ${r.bienes === 1 ? 'bien' : 'bienes'}`, tono: 'verde' } : NINGUNO
    e.intracomunitarias = r.intracomunitarias ? { texto: String(r.intracomunitarias), tono: 'verde' } : { texto: 'ninguna', tono: 'gris' }
    e.suplidos = r.suplidos ? { texto: `${r.suplidos} ${r.suplidos === 1 ? 'cuenta' : 'cuentas'}`, tono: 'verde' } : NINGUNO
    e.retenciones = r.retenciones.length ? { texto: r.retenciones.join(' y '), tono: 'verde' } : { texto: 'ninguna', tono: 'gris' }
    e['formato-aeat'] = { texto: 'requerimientos', tono: r.sinNif ? 'ambar' : 'verde' }
  }
  e.balance = { texto: ej.origen === 'migrated' ? 'traído' : `a ${ej.fin.slice(8, 10)}/${ej.fin.slice(5, 7)}`, tono: 'gris' }
  e.pyg = { texto: 'oficial · por local', tono: 'gris' }
  e.ecpn = { texto: 'ingresos y gastos · total', tono: 'gris' }
  e['balances-pdf'] = { texto: 'balance y PyG', tono: 'gris' }
  e['balances-excel'] = { texto: 'balance y PyG', tono: 'gris' }
  e['cuentas-anuales'] = ej.modelo ? { texto: `modelo ${ej.modelo.elegido}`, tono: 'verde' } : { texto: 'elegir modelo', tono: 'ambar' }
  e.mapeo = { texto: 'de serie (PGC)', tono: 'gris' }
  e.memoria = { texto: 'Próximamente', tono: 'gris' }
  e.legalizacion = { texto: 'Próximamente', tono: 'gris' }
  e.deposito = { texto: 'Próximamente', tono: 'gris' }
  e.ejercicios = { texto: `${ctx.ejercicios.length} ${ctx.ejercicios.length === 1 ? 'ejercicio' : 'ejercicios'}`, tono: 'gris' }
  e['cerrar-mes'] = { texto: 'mes a mes', tono: 'gris' }
  e['cierre-ejercicio'] = ej.origen === 'migrated' ? { texto: 'traído', tono: 'gris' }
    : ej.estado === 'closed' ? { texto: 'cerrado', tono: 'verde' } : ej.cierre?.estado === 'preparado' ? { texto: 'preparado', tono: 'ambar' } : { texto: 'abierto', tono: 'gris' }
  return e
}

export default function LibrosPage({ area: areaFija, accion: accionFija }: { area?: string; accion?: string }) {
  const { accountId, cargando, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const movil = useIsMobile()
  const params = useParams()
  const [query, setQuery] = useSearchParams()
  const navegar = useNavigate()
  const [vuelta, setVuelta] = useState(0)
  const { area, accion } = resolver(areaFija ?? params.area, accionFija ?? params.accion)
  const enIndiceMovil = movil && !params.area && !areaFija

  const base = useLeer(accountId && activa ? async () => {
    const [ejercicios, lm] = await Promise.all([leerEjerciciosLibros(accountId, activa.id), localesYMarcas(accountId)])
    return { ejercicios, ...lm }
  } : null, `${accountId}:${activa?.id}:${vuelta}`)

  const hoy = hoyEnMadrid()
  const ejercicios = useMemo(() => base.datos?.ejercicios ?? [], [base.datos])
  const pedido = query.get('ejercicio')
  const ejercicio = ejercicios.find((e) => e.code === pedido) ?? ejercicios.find((e) => hoy >= e.inicio && hoy <= e.fin) ?? ejercicios[0] ?? null
  const anterior = ejercicio ? ejercicios.find((e) => e.id === ejercicio.anteriorId) ?? null : null
  const trimestre = ejercicio ? trimestreDe(hoy >= ejercicio.inicio && hoy <= ejercicio.fin ? hoy : ejercicio.fin) : null

  const resumen = useLeer(accountId && activa && trimestre ? () => resumenLibros(accountId, activa.id, trimestre.desde, trimestre.hasta) : null,
    `${accountId}:${activa?.id}:${trimestre?.desde}:${vuelta}`)

  const usuario = userName ?? 'yo'
  const [favoritos, setFavoritos] = useState<string[]>(() => leerFavoritos(usuario, almacen()))
  const [buscando, setBuscando] = useState(false)
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => { if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); setBuscando(true) } }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])

  const ctx: ContextoLibros | null = useMemo(() => (accountId && activa && ejercicio ? {
    accountId, companyId: activa.id, quien: userName ?? null, movil, ejercicios, ejercicio, anterior,
    locales: base.datos?.locales ?? [], marcas: base.datos?.marcas ?? [], vuelta, recargar: () => setVuelta((v) => v + 1),
  } : null), [accountId, activa, ejercicio, anterior, ejercicios, base.datos, movil, userName, vuelta])

  if (!accountId && !cargando) return <Vacio titulo="No hay cuenta activa." explicacion="Elige una cuenta para ver sus libros." />
  if (base.error) return <ErrorConReintento mensaje={base.error} reintentar={base.recargar} />
  if (!base.datos) return <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando los libros">{[0, 1, 2].map((i) => <Hueso key={i} alto={40} />)}</div>
  if (!ejercicio || !ctx) return <div className="cx-tarjeta"><Vacio titulo="Aún no hay ningún ejercicio." explicacion="Ábrelo en Ajustes › Ejercicio y los libros empiezan a llenarse." /></div>

  const est = estados(resumen.datos, trimestre!.nombre, ctx)
  const ruta = (a: string, x: string) => `${rutaLibros(a, x)}${pedido ? `?ejercicio=${encodeURIComponent(pedido)}` : ''}`

  const barraAccion = (x: Accion) => {
    const e = est[x.id] ?? NINGUNO
    return (
      <Link key={x.id} to={ruta(area.id, x.id)} className={`cxl-accion${e.texto === 'ninguno' || e.texto === 'ninguna' ? ' cxl-accion-gris' : ''}`}
        aria-current={x.id === accion.id ? 'page' : undefined}>
        <span className="cxl-accion-nombre">{x.nombre} <span className={`cxl-punto cxl-punto-${e.tono}`} aria-hidden="true" /></span>
        <span className="cxl-accion-dato">{e.texto}</span>
      </Link>
    )
  }

  return (
    <LibrosCtx.Provider value={ctx}>
      <div className="cxl-pagina">
        <header className="cxl-cabeza">
          <div>
            <span className="cxl-ante">Contabilidad</span>
            <h1 className="cxl-titulo">Libros</h1>
          </div>
          <label>
            <span className="cx-oculto">Ejercicio</span>
            <select className="cx-input" value={ejercicio.code} onChange={(e) => { const p = new URLSearchParams(query); p.set('ejercicio', e.target.value); setQuery(p, { replace: true }) }}>
              {ejercicios.map((e) => <option key={e.id} value={e.code}>Ejercicio {e.code}{e.origen === 'migrated' ? ' · traído' : e.estado === 'closed' ? ' · cerrado' : ''}</option>)}
            </select>
          </label>
        </header>

        {(!movil || enIndiceMovil) && (
          <nav className="cxl-areas" aria-label="Áreas de Libros">
            {AREAS_LIBROS.map((a) => (
              <Link key={a.id} to={ruta(a.id, accionesDe(a)[0].id)} className="cxl-area" aria-current={!enIndiceMovil && a.id === area.id ? 'page' : undefined}>{a.nombre}</Link>
            ))}
          </nav>
        )}

        {!enIndiceMovil && (
          <>
            {movil && <Link to={rutaLibros()} className="cx-enlace">‹ Libros</Link>}
            <nav className="cxl-barra" aria-label={`Acciones de ${area.nombre}`}>
              {/* Los grupos pueden partir en filas; «Tuyos» se queda arriba a la derecha (N13c). */}
              <div className="cxl-barra-grupos">
                {area.grupos.map((g) => (
                  <div key={g.etiqueta} className="cxl-grupo" role="group" aria-label={g.etiqueta}>
                    <div className="cxl-grupo-acciones">{g.acciones.map(barraAccion)}</div>
                    <span className="cxl-grupo-etiqueta">{g.etiqueta}</span>
                  </div>
                ))}
              </div>
              <div className="cxl-tuyos" role="group" aria-label="Tuyos">
                <div className="cxl-grupo-acciones">
                  <button type="button" className="cxl-accion" aria-pressed={favoritos.includes(accion.id)}
                    onClick={() => setFavoritos(alternarFavorito(usuario, accion.id, almacen()))}
                    title={favoritos.includes(accion.id) ? `Quitar «${accion.nombre}» de favoritos` : `Guardar «${accion.nombre}» en favoritos`}>
                    <span className="cxl-accion-nombre">{favoritos.includes(accion.id) ? '★' : '☆'} <span className={`cxl-punto${favoritos.length ? ' cxl-punto-verde' : ''}`} aria-hidden="true" /></span>
                    <span className="cxl-accion-dato">favoritos</span>
                  </button>
                  <button type="button" className="cxl-accion" onClick={() => setBuscando(true)} aria-keyshortcuts="Control+K">
                    <span className="cxl-accion-nombre">⌕</span><span className="cxl-accion-dato">Ctrl K</span>
                  </button>
                </div>
                <span className="cxl-grupo-etiqueta">Tuyos</span>
              </div>
            </nav>
            {favoritos.length > 0 && (
              <div className="cx-tablas-filtros" role="group" aria-label="Tus favoritos">
                {favoritos.map((id) => { const d = dondeEsta(id)!; return <Link key={id} to={ruta(d.area.id, id)} className="cx-pildora" aria-pressed={id === accion.id}>★ {d.accion.nombre}</Link> })}
              </div>
            )}
            {resumen.error && <div className="cx-error" role="alert">No se ha podido leer el estado de los libros: {resumen.error}</div>}
            <div key={`${area.id}:${accion.id}`}>{contenido(accion.id)}</div>
          </>
        )}

        {buscando && <Buscar alCerrar={() => setBuscando(false)} alElegir={(a, x) => { setBuscando(false); navegar(ruta(a, x)) }} />}
      </div>
    </LibrosCtx.Provider>
  )
}

function Buscar({ alCerrar, alElegir }: { alCerrar: () => void; alElegir: (area: string, accion: string) => void }) {
  const [q, setQ] = useState('')
  const r = buscar(q)
  return (
    <Dialogo titulo="Buscar en Libros" alCerrar={alCerrar}>
      <input className="cx-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escribe: recibidas, balance, 347, cierre…"
        aria-label="Qué buscas" onKeyDown={(e) => { if (e.key === 'Enter' && r[0]) alElegir(r[0].area.id, r[0].accion.id) }} />
      {q && r.length === 0 && <p className="cx-ayuda">No hay ninguna opción que se llame así.</p>}
      <ul className="cxl-buscar-lista">
        {r.slice(0, 12).map((x) => (
          <li key={x.accion.id}><a href="#" onClick={(e) => { e.preventDefault(); alElegir(x.area.id, x.accion.id) }}>
            <span>{x.accion.nombre}</span><span className="cx-ayuda">{x.area.nombre} › {x.grupo.etiqueta}</span></a></li>
        ))}
      </ul>
    </Dialogo>
  )
}
