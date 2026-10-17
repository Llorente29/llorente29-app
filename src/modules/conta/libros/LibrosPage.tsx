// src/modules/conta/libros/LibrosPage.tsx
//
// C05 · Libros en tres niveles (maqueta N13cLibros), dentro del marco nuevo.
// Nivel 1, el módulo (barra de módulos del marco). Nivel 2, las áreas: en el
// ordenador son las pestañas de arriba del marco. Nivel 3, las acciones del
// área, en la segunda fila de esa barra (SubpestanasEnBarra), con un punto
// ámbar si piden algo y «Más ▾» si no caben. Debajo, el contenido de la acción elegida. Dos clics como máximo a
// cualquier libro. El ejercicio va en la barra de arriba (PeriodoEnBarra).
//
// M01 (encargo F01, tarea 4; Julio, 16/10): fuera el recuadro de antes
// (grupos Estados / Salidas con su dato debajo y «Tuyos» con favoritos y
// Ctrl K) y el título grande «Contabilidad · Libros»: con las pestañas de
// arriba sobraban. Ctrl K es del marco y las acciones de Libros salen en su
// buscador, en «Opciones».
//
// En el móvil, por niveles: la lista de áreas, al tocar una, sus acciones en
// lista, y al tocar una acción, su contenido con «‹ Libros» para volver.

import { useId, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { rutaLibros } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { usePestanasArriba } from '@/modules/conta/marco/nuevo/contexto'
import { PeriodoEnBarra } from '@/modules/conta/ui/marco/PeriodoEnBarra'
import { SubpestanasEnBarra, type Subpestana } from '@/modules/conta/ui/marco/SubpestanasEnBarra'
import { useDesplegable } from '@/modules/conta/marco/nuevo/useDesplegable'
import { miles } from '@/modules/conta/ui/tabla/tablaDensa'
import { ErrorConReintento, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import {
  AREAS_LIBROS, NINGUNO, accionesDe, resolver, type Accion, type EstadoAccion,
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
import { PendientesDiez } from '@/modules/conta/libros/PendientesDiez'

/** El contenido de cada acción. */
function contenido(accion: string): ReactNode {
  switch (accion) {
    case 'libro-diario': return <LibroDiarioPage />
    case 'diario-resumido': return <DiarioResumido />
    case 'pendientes-diez': return <PendientesDiez />
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
  e['pendientes-diez'] = r?.pdfPendientesDiez ? { texto: `${r.pdfPendientesDiez} sin su PDF`, tono: 'ambar' } : { texto: 'nada pendiente', tono: 'gris' }
  e['libro-mayor'] = { texto: 'por cuenta', tono: 'gris' }
  e['sumas-saldos'] = { texto: 'niveles y opciones', tono: 'gris' }
  e['acumulados'] = { texto: 'saldo de cada mes', tono: 'gris' }
  if (r) {
    e.expedidas = r.expedidas ? { texto: `${nombreTrimestre.split(' ')[0]} · ${miles(r.expedidas)}`, tono: 'verde' } : NINGUNO
    e.recibidas = r.recibidas ? { texto: `${nombreTrimestre.split(' ')[0]} · ${miles(r.recibidas)}${r.sinNif ? ` · ${r.sinNif} sin NIF` : ''}`, tono: r.sinNif ? 'ambar' : 'verde' } : NINGUNO
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
  const [vuelta, setVuelta] = useState(0)
  const { area, accion } = resolver(areaFija ?? params.area, accionFija ?? params.accion)
  const enIndiceMovil = movil && !params.area && !areaFija
  // M01: con el marco nuevo, las áreas son las pestañas de arriba; aquí no se repiten.
  const areasArriba = usePestanasArriba()

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

  // Móvil: la acción como tarjeta, con su dato debajo (por niveles, como antes).
  const tarjetaAccion = (x: Accion) => {
    const e = est[x.id] ?? NINGUNO
    return (
      <Link key={x.id} to={ruta(area.id, x.id)} className={`cxl-accion${e.texto === 'ninguno' || e.texto === 'ninguna' ? ' cxl-accion-gris' : ''}`}
        aria-current={x.id === accion.id ? 'page' : undefined}>
        <span className="cxl-accion-nombre">{x.nombre} <span className={`cxl-punto cxl-punto-${e.tono}`} aria-hidden="true" /></span>
        <span className="cxl-accion-dato">{e.texto}</span>
      </Link>
    )
  }
  // Ordenador: la segunda fila de la barra de arriba del marco; el dato va en
  // el title y un punto ámbar dice que esa acción pide algo (ninguna se
  // esconde: regla 7).
  // Julio, 16/10: lo que hoy enseña un número lo lleva escrito («Pendientes
  // de adjuntar en Diez · 3»), nunca solo al pasar el ratón. Los mismos
  // números del resumen con los que se escribe su dato.
  const r = resumen.datos
  const numeros: Record<string, number | undefined> = r ? {
    'pendientes-diez': r.pdfPendientesDiez, expedidas: r.expedidas, recibidas: r.recibidas, 'bienes-inversion': r.bienes,
    intracomunitarias: r.intracomunitarias, suplidos: r.suplidos,
  } : {}
  numeros.ejercicios = ctx.ejercicios.length
  const subpestanas: Subpestana[] = accionesDe(area).map((x) => {
    const e = est[x.id] ?? NINGUNO
    const n = numeros[x.id]
    return {
      id: x.id, etiqueta: x.nombre, ruta: ruta(area.id, x.id), activa: x.id === accion.id, dato: e.texto, aviso: e.tono === 'ambar',
      gris: e.texto === 'ninguno' || e.texto === 'ninguna', numero: n && n > 0 ? n : undefined,
    }
  })

  return (
    <LibrosCtx.Provider value={ctx}>
      <div className="cxl-pagina cxl-en-marco">
        <h1 className="cx-oculto">Libros</h1>
        <PeriodoEnBarra>
          <label className="cxl-ejercicio">
            <span className="cx-oculto">Ejercicio</span>
            <select className="cxm-select" value={ejercicio.code} onChange={(e) => { const p = new URLSearchParams(query); p.set('ejercicio', e.target.value); setQuery(p, { replace: true }) }}>
              {ejercicios.map((e) => <option key={e.id} value={e.code}>Ejercicio {e.code}{e.origen === 'migrated' ? ' · traído' : e.estado === 'closed' ? ' · cerrado' : ''}</option>)}
            </select>
          </label>
        </PeriodoEnBarra>

        {(!movil || enIndiceMovil) && !areasArriba && (
          <nav className="cxl-areas" aria-label="Áreas de Libros">
            {AREAS_LIBROS.map((a) => (
              <Link key={a.id} to={ruta(a.id, accionesDe(a)[0].id)} className="cxl-area" aria-current={!enIndiceMovil && a.id === area.id ? 'page' : undefined}>{a.nombre}</Link>
            ))}
          </nav>
        )}

        {!enIndiceMovil && (
          <>
            {movil ? (
              // M01 (Julio, 16/10): en el móvil, el menú del área en UNA línea
              // desplegable («Libro diario ▾»), para que el libro empiece arriba.
              <div className="cxl-movil-fila">
                <Link to={rutaLibros()} className="cx-enlace">‹ Libros</Link>
                <AccionesMovil etiqueta={`Acciones de ${area.nombre}`} activa={accion.nombre} dato={(est[accion.id] ?? NINGUNO).texto}>
                  {area.grupos.map((g) => (
                    <div key={g.etiqueta} className="cxl-movil-grupo" role="group" aria-label={g.etiqueta}>
                      <span className="cxl-grupo-etiqueta">{g.etiqueta}</span>
                      {g.acciones.map(tarjetaAccion)}
                    </div>
                  ))}
                </AccionesMovil>
              </div>
            ) : accionesDe(area).length > 1 && <SubpestanasEnBarra etiqueta={`Acciones de ${area.nombre}`} pestanas={subpestanas} />}
            {resumen.error && <div className="cx-error" role="alert">No se ha podido leer el estado de los libros: {resumen.error}</div>}
            <div key={`${area.id}:${accion.id}`}>{contenido(accion.id)}</div>
          </>
        )}
      </div>
    </LibrosCtx.Provider>
  )
}

/**
 * El menú del área en el móvil: una línea con la acción en la que estás y su
 * dato escrito («Pendientes de adjuntar en Diez · 3 sin su PDF ▾»); al tocarla,
 * todas las del área por grupos. Se cierra al elegir (cambia la dirección),
 * al tocar fuera o con Escape.
 */
function AccionesMovil({ etiqueta, activa, dato, children }: { etiqueta: string; activa: string; dato: string; children: ReactNode }) {
  const { abierto, alternar, caja, boton } = useDesplegable<HTMLElement>()
  const idDato = useId()
  return (
    <nav className="cxl-movil-acciones" aria-label={etiqueta} ref={caja}>
      {/* El botón se llama como la acción; su dato, escrito al lado, va de descripción
          (en el nombre, «oficial · por local» se leía como un botón «Por local»). */}
      <button type="button" ref={boton} className="cxl-movil-boton" aria-expanded={abierto} aria-haspopup="true" onClick={alternar}
        aria-label={activa} aria-describedby={dato ? idDato : undefined}>
        <span className="cxl-movil-nombre">{activa}</span>
        {dato && <span className="cxl-movil-dato" id={idDato}> · {dato}</span>}
        <span className="cxl-movil-flecha" aria-hidden="true">▾</span>
      </button>
      {abierto && <div className="cxl-movil-menu">{children}</div>}
    </nav>
  )
}
