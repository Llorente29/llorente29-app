// src/modules/conta/libros/LibrosPage.tsx
//
// C05 · Libros (maqueta N13cLibros), dentro del esqueleto del S01.
//
// S01 (paso 3): las áreas y sus acciones ya no las pinta esta pantalla. Son
// las pestañas de Contabilidad («Libros y listados», «Cierre y Registro»,
// «Importar») y su cinta, que sale del catálogo de órdenes del esqueleto
// (esqueleto/ordenes.ts, sacado de AREAS_LIBROS). Lo que esta pantalla sabe de
// cada acción —su número escrito, su punto ámbar si pide algo, su dato— lo
// pone en la cinta (useDatosEnCinta), como antes en su segunda fila: ninguna
// se esconde (regla 7), lo que la empresa no usa sale en gris.
//
// El ejercicio va en la cabecera (PeriodoEnBarra). «Libros» a secas lleva a la
// primera de «Libros y listados» (el Libro mayor): la portada por áreas sobra.
//
// M01 (encargo F01, tarea 4; Julio, 16/10): sin el recuadro de antes ni el
// título grande. Ctrl K es del marco y las acciones de Libros salen en su
// buscador, en «Opciones».

import { useMemo, useState, type ReactNode } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { rutaLibros } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { useDatosEnCinta, type DatosCinta } from '@/modules/conta/marco/nuevo/contexto'
import { PeriodoEnBarra } from '@/modules/conta/ui/marco/PeriodoEnBarra'
import { miles } from '@/modules/conta/ui/tabla/tablaDensa'
import { ErrorConReintento, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { AREAS_LIBROS, NINGUNO, accionesDe, resolver, type EstadoAccion } from '@/modules/conta/libros/navegacion'
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
  // «Libros» a secas: la primera de «Libros y listados» (el Libro mayor).
  const enLaPortada = !params.area && !areaFija

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

  // Lo que esta pantalla sabe de cada acción, a la cinta (antes, su segunda fila).
  // Julio, 16/10: lo que enseña un número lo lleva escrito, nunca solo al pasar el ratón.
  useDatosEnCinta(ctx && trimestre ? datosDeLaCinta(estados(resumen.datos, trimestre.nombre, ctx), resumen.datos, ctx.ejercicios.length) : null)

  if (enLaPortada) return <Navigate to={`${rutaLibros('mayor', 'libro-mayor')}${pedido ? `?ejercicio=${encodeURIComponent(pedido)}` : ''}`} replace />
  if (!accountId && !cargando) return <Vacio titulo="No hay cuenta activa." explicacion="Elige una cuenta para ver sus libros." />
  if (base.error) return <ErrorConReintento mensaje={base.error} reintentar={base.recargar} />
  if (!base.datos) return <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando los libros">{[0, 1, 2].map((i) => <Hueso key={i} alto={40} />)}</div>
  if (!ejercicio || !ctx) return <div className="cx-tarjeta"><Vacio titulo="Aún no hay ningún ejercicio." explicacion="Ábrelo en Ajustes › Ejercicio y los libros empiezan a llenarse." /></div>

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

        {resumen.error && <div className="cx-error" role="alert">No se ha podido leer el estado de los libros: {resumen.error}</div>}
        <div key={`${area.id}:${accion.id}`}>{contenido(accion.id)}</div>
      </div>
    </LibrosCtx.Provider>
  )
}

/** Por id de orden de la cinta (libros.<acción>): su número escrito, su punto ámbar, su dato y si está en gris. */
function datosDeLaCinta(est: Record<string, EstadoAccion>, r: ResumenLibros | null, nEjercicios: number): DatosCinta {
  const numeros: Record<string, number | undefined> = r ? {
    'pendientes-diez': r.pdfPendientesDiez, expedidas: r.expedidas, recibidas: r.recibidas, 'bienes-inversion': r.bienes,
    intracomunitarias: r.intracomunitarias, suplidos: r.suplidos,
  } : {}
  numeros.ejercicios = nEjercicios
  const datos: DatosCinta = {}
  for (const a of AREAS_LIBROS) for (const x of accionesDe(a)) {
    const e = est[x.id] ?? NINGUNO
    const n = numeros[x.id]
    datos[`libros.${x.id}`] = { numero: n && n > 0 ? n : undefined, aviso: e.tono === 'ambar', dato: `${x.nombre}: ${e.texto}`, gris: e.texto === 'ninguno' || e.texto === 'ninguna' }
  }
  return datos
}
