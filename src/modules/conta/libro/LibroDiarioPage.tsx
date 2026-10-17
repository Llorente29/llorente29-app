// src/modules/conta/libro/LibroDiarioPage.tsx
//
// C04 · Libros › Libro diario (maqueta N11Diario), pasado al marco nuevo en
// el M01 (maqueta N30 §4, encargo F01 tarea 4) con la tabla densa:
//   · arriba, en la barra de acciones del marco: «+ Nuevo asiento» (Ins),
//     «Proponer lo pendiente» y «Validar y enviar a Diez»; el ejercicio, en la
//     barra de arriba (lo pone Libros);
//   · la franja «Te toca hoy»: lo que espera revisión y lo validado que no ha
//     llegado a Diez, que filtran al pulsarlos;
//   · el mes en una línea: sus asientos, si está abierto o cerrado y su
//     resultado (las cifras de N11, en pequeño);
//   · las vistas (Todos, Para revisar y los orígenes que la empresa tiene, con
//     cuántos), las que guarda cada persona, los filtros (fechas, serie,
//     estado, local, texto) y Exportar (Excel, CSV y PDF);
//   · la tabla: fecha, número con su serie, el número en Diez, el concepto con
//     sus chips y de dónde sale, el importe y el estado. Intro (o un clic)
//     despliega sus apuntes; en el móvil, abre el asiento;
//   · el pie: cuántos, los marcados y el cuadre («Debe … · Haber … · Cuadra»);
//   · a la derecha, «Lo que he hecho yo» (con Deshacer) y el cierre del mes
//     anterior.
// Nada de lo de antes se pierde: proponer, el corte, enviar a Diez, el mes
// cerrado con «Pedir desbloqueo», lo que no se propuso y por qué.
//
// Regla 7: «Todos» enseña todo, también lo anulado, y el pie dice siempre
// cuántos hay de cuántos. Regla 8: cada botón dice lo que ha hecho, con
// contenido («Validado: Ventas nº 1.287»).

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { rutaAsiento, rutaMayor, rutaNuevoAsiento } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { Chip, ErrorConReintento, Guardado, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { diaMesCorto, eurosExactos, euros, hoyEnMadrid } from '@/modules/conta/lib/formato'
import {
  cifras, deDondeSale, estadoDe, filtrar, filtrosVisibles, importe, loQueHeHechoYo, marcaNegativoDiez, mesAnterior, mesDe, nombreMes, numeroVisible,
  pasosCierre, pastillas, pedirCierre, sePuedeCerrar, type AsientoDiario, type CierreMes, type FiltroDiario, type FuenteCierre,
} from '@/modules/conta/lib/diario'
import { NOMBRE_SERIE } from '@/modules/conta/lib/libro'
import {
  cerrarMes, fuenteCierre, horaDeCierre, leerAsientos, leerCierres, leerEjercicios, localesDeLaCuenta, primerDiaAbierto, reabrirMes, resultadoDelMes,
  type EjercicioLibro,
} from '@/modules/conta/services/diarioService'
import { proponerPendientes, type ResultadoProponer } from '@/modules/conta/services/propuestasLibroService'
import { fijarCorte, primeraVenta } from '@/modules/conta/services/corteService'
import { corteDesdeRespuesta, rangoAProponer } from '@/modules/conta/lib/proponer'
import { textoDiaEnCurso, ultimoDiaCerrado } from '@/modules/conta/lib/cierreDelDia'
import { TonoChip } from '@/modules/conta/libro/piezasLibro'
import { MARCA } from '../cuenta/marca'
import { ChipDiez, EnviarADiezDialogo, type CandidatoDiez } from '@/modules/conta/libro/ConDiez'
import { cobroDe, estadoDiez, motivoSinPatron, type ConDiez, type EstadoDiez } from '@/modules/conta/lib/conDiez'
import { anularConDiez, leerConDiez, validarYEnviar } from '@/modules/conta/services/conDiezService'
import { numeroEnDiez } from '@/modules/conta/lib/numeroEnDiez'
import { localDelAsiento, porQueNoLlegaADiez, primerMotivo, type MotivoEspera, type NoLlegaADiez } from '@/modules/conta/lib/esperan'
import { leerEsperan } from '@/modules/conta/services/esperanService'
import { correspondenciaDeEmpresa } from '../../../../supabase/functions/_shared/diezAnalitica.ts'
import { AccionesPantalla, BotonAccion } from '@/modules/conta/ui/marco/AccionesPantalla'
import { TablaDensa, type ColumnaDensa } from '@/modules/conta/ui/tabla/TablaDensa'
import { borrarVista, cumpleFiltros, guardarVista, leerVistas, miles, type CampoFiltro, type VistaGuardada } from '@/modules/conta/ui/tabla/tablaDensa'
import { CampoFecha } from '@/modules/conta/ui/fecha/CampoFecha'
import { useAnalitica, useHosteleria } from '@/modules/conta/marco/nuevo/contexto'
import type { EjeVista } from '@/modules/conta/esqueleto/productos'

const almacen = (): Storage | null => { try { return window.localStorage } catch { return null } }

/** ¿Está escribiendo en un campo? (Ins no abre un asiento nuevo a media palabra.) */
const escribiendo = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

interface DatosLibro {
  /** La hora de cierre del día de la empresa («06:00»). */
  horaCierre: string
  ejercicios: EjercicioLibro[]
  ejercicio: EjercicioLibro | null
  asientos: AsientoDiario[]
  cierres: CierreMes[]
  mes: string
  resultado: { total: number; porLocal: { nombre: string; resultado: number }[] } | null
  /** Si el resultado no se ha podido calcular, por qué (la página sigue: es una cifra, no el libro). */
  resultadoError: string | null
  cierre: FuenteCierre | null
  /** R15 · Los asientos de ventas de una plataforma, con su documento y su envío a Diez. */
  conDiez: Map<string, ConDiez>
  /** Si no se ha podido leer, por qué (el libro sigue: es el estado con Diez, no el libro). */
  conDiezError: string | null
  /** M01 · «Esperan»: lo propuesto que la validación pararía, con sus motivos (conta_esperan). */
  esperan: Map<string, MotivoEspera[]>
  /** Si no se ha podido leer, por qué: entonces todo lo propuesto cuenta, como antes, y «Esperan» dice «—». */
  esperanError: string | null
}

function useLibro(accountId: string | null, companyId: string | null, codigo: string | null, vuelta: number) {
  const [r, setR] = useState<{ clave: string; datos: DatosLibro | null; error: string | null }>({ clave: '', datos: null, error: null })
  const clave = `${accountId}:${companyId}:${codigo}:${vuelta}`
  useEffect(() => {
    if (!accountId || !companyId) return
    let vivo = true
    ;(async () => {
      const [ejercicios, cierres, locales, horaCierre] = await Promise.all([leerEjercicios(accountId, companyId), leerCierres(accountId, companyId), localesDeLaCuenta(accountId), horaDeCierre(accountId, companyId)])
      const hoy = hoyEnMadrid()
      const ejercicio = ejercicios.find((e) => e.code === codigo) ?? ejercicios.find((e) => hoy >= e.inicio && hoy <= e.fin) ?? ejercicios[0] ?? null
      if (!ejercicio) return { horaCierre, ejercicios, ejercicio, asientos: [], cierres, mes: mesDe(hoy), resultado: null, resultadoError: null, cierre: null, conDiez: new Map<string, ConDiez>(), conDiezError: null, esperan: new Map<string, MotivoEspera[]>(), esperanError: null }
      const mes = hoy >= ejercicio.inicio && hoy <= ejercicio.fin ? mesDe(hoy) : mesDe(ejercicio.fin)
      const asientos = await leerAsientos(accountId, companyId, ejercicio.inicio, ejercicio.fin)
      const anterior = mesAnterior(mes)
      let resultadoError: string | null = null
      let conDiezError: string | null = null
      let esperanError: string | null = null
      // M01 (Julio, 16/10): el cierre del mes anterior no se pide si ya está
      // cerrado fuera (la regla de la validación, de la base: pedirCierre).
      const pedir = anterior >= ejercicio.inicio && pedirCierre(anterior, await primerDiaAbierto(companyId, anterior), cierres)
      const [resultado, cierre, conDiez, esperan] = await Promise.all([
        resultadoDelMes(companyId, mes, locales).catch((e: unknown) => { resultadoError = e instanceof Error ? e.message : String(e); return null }),
        pedir ? fuenteCierre(accountId, companyId, anterior, asientos, cierres.some((c) => c.mes === anterior)) : Promise.resolve(null),
        leerConDiez(accountId, companyId, asientos.filter((a) => a.origen === 'sales_day').map((a) => a.id))
          .catch((e: unknown) => { conDiezError = e instanceof Error ? e.message : String(e); return new Map<string, ConDiez>() }),
        leerEsperan(companyId, ejercicio.inicio, ejercicio.fin)
          .catch((e: unknown) => { esperanError = e instanceof Error ? e.message : String(e); return new Map<string, MotivoEspera[]>() }),
      ])
      return { horaCierre, ejercicios, ejercicio, asientos, cierres, mes, resultado, resultadoError, cierre, conDiez, conDiezError, esperan, esperanError }
    })().then((datos) => { if (vivo) setR({ clave, datos, error: null }) },
      (e: unknown) => { if (vivo) setR({ clave, datos: null, error: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false }
  }, [accountId, companyId, codigo, clave])
  return r.clave === clave ? r : { clave, datos: null, error: null }
}

/** Los filtros de arriba de la tabla; las listas salen de lo que hay en el libro (regla 30). */
function camposDelLibro(asientos: readonly AsientoDiario[], ejeLocal: EjeVista | null): CampoFiltro[] {
  const series = [...new Set(asientos.map((a) => a.serie))].sort((x, y) => Number(x) - Number(y))
  const estados = [...new Set(asientos.map((a) => estadoDe(a).texto))].sort((x, y) => x.localeCompare(y, 'es'))
  const locales = [...new Set(asientos.flatMap((a) => a.apuntes.map((l) => (l.comun ? 'Común' : l.local)).filter((x): x is string => !!x)))].sort((x, y) => x.localeCompare(y, 'es'))
  return [
    { id: 'desde', etiqueta: 'Desde', tipo: 'desde' },
    { id: 'hasta', etiqueta: 'Hasta', tipo: 'hasta' },
    { id: 'serie', etiqueta: 'Serie', tipo: 'opciones', opciones: [{ valor: '', texto: 'Todas' }, ...series.map((x) => ({ valor: String(x), texto: NOMBRE_SERIE[x] }))] },
    { id: 'estado', etiqueta: 'Estado', tipo: 'opciones', opciones: [{ valor: '', texto: 'Todos' }, ...estados.map((x) => ({ valor: x, texto: x }))] },
    ...(ejeLocal && locales.length > 1 ? [{ id: 'local', etiqueta: ejeLocal.nombre, tipo: 'opciones' as const, opciones: [{ valor: '', texto: 'Todos' }, ...locales.map((x) => ({ valor: x, texto: x }))] }] : []),
    { id: 'texto', etiqueta: 'Buscar', tipo: 'texto', pista: 'Concepto, número, cuenta, importe…' },
  ]
}

export default function LibroDiarioPage() {
  const { accountId, cargando, userName } = useCuentaConta()
  // S01: el local y la marca, solo con su eje encendido (Definiciones › Analítica).
  const analitica = useAnalitica()
  const ejes = { local: !!analitica.local, marca: !!analitica.marca }
  const { activa } = useEmpresas()
  const movil = useIsMobile()
  // S01: sin hostelería, los textos no hablan de plataformas ni de liquidaciones.
  const hosteleria = useHosteleria()
  const navegar = useNavigate()
  const [params, setParams] = useSearchParams()
  const [vuelta, setVuelta] = useState(0)
  const recargar = () => setVuelta((v) => v + 1)
  const { datos, error } = useLibro(cargando ? null : accountId, activa?.id ?? null, params.get('ejercicio'), vuelta)
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [proponiendo, setProponiendo] = useState(false)
  const [sinPropuesta, setSinPropuesta] = useState<ResultadoProponer['sinPropuesta']>([])
  const [desbloqueo, setDesbloqueo] = useState(false)
  const [enviarDiez, setEnviarDiez] = useState(false)
  const usuario = userName ?? 'yo'
  const [filtros, setFiltros] = useState<Record<string, string>>({})
  const [soloSinDiez, setSoloSinDiez] = useState(false)
  const [guardadas, setGuardadas] = useState<VistaGuardada[]>(() => leerVistas('libro-diario', usuario, almacen()))
  const [vistaGuardada, setVistaGuardada] = useState<string | null>(null)
  // «Esperan» no es un filtro del libro (no sale de lib/diario): es lo que dice la base.
  const [vista, setVista] = useState<'esperan' | null>(null)

  const visibles = useMemo(() => (datos ? filtrosVisibles(datos.asientos) : []), [datos])
  const pedido = params.get('ver') as FiltroDiario | null
  const filtro: FiltroDiario = visibles.some((f) => f.id === pedido) ? pedido! : 'todos'
  const campos = useMemo(() => (datos ? camposDelLibro(datos.asientos, analitica.local) : []), [datos, analitica.local])
  const c = datos ? cifras(datos.asientos, datos.mes, datos.cierres, datos.resultado) : null
  const hechos = datos ? loQueHeHechoYo(datos.asientos) : []
  // R15 · Con Diez: el estado de cada asiento de ventas de una plataforma, y lo
  // que se puede validar y enviar (lo propuesto, y lo validado que no ha llegado).
  const diezDe = (a: AsientoDiario): EstadoDiez | undefined => { const d = datos?.conDiez.get(a.id); return d ? estadoDiez(a, d) : undefined }
  const candidatosDiez: CandidatoDiez[] = datos
    ? datos.asientos.flatMap((a) => {
      const e = diezDe(a)
      if (!e || !(a.estado === 'propuesto' || (a.estado === 'validado' && e.reintentar))) return []
      // M01: lo propuesto que la validación pararía espera; no se ofrece validar y enviar.
      if (a.estado === 'propuesto' && datos.esperan.has(a.id)) return []
      return [{ id: a.id, concepto: a.concepto, fecha: a.fecha, estado: a.estado, cobro: cobroDe(a.apuntes), estadoDiez: e, noSeEnvia: motivoSinPatron(datos.conDiez.get(a.id)!.canal) }]
    }).sort((x, y) => x.fecha.localeCompare(y.fecha) || x.concepto.localeCompare(y.concepto))
    : []
  const propuestosDiez = candidatosDiez.filter((c) => c.estado === 'propuesto' && !c.noSeEnvia).length
  // M01 · «Esperan» (Julio, 16/10). Lo que todavía no se puede hacer no cuenta
  // como tarea: lo propuesto que la validación pararía (la base, conta_esperan)
  // y lo validado que no llega a Diez por algo que no se arregla desde aquí.
  // Lo validado que no llega por algo que sí (le falta su documento, el envío
  // falló) es tarea, con su botón.
  const correspondencia = correspondenciaDeEmpresa(activa?.id)
  // Sin correspondencia, la empresa no tiene Diez: el envío decide, no el grupo.
  const grupoDe = (local: string) => (correspondencia ? correspondencia.localAlEnviar[local] : 'sin correspondencia')
  const noDiez = (a: AsientoDiario): NoLlegaADiez | null => {
    const d = datos?.conDiez.get(a.id)
    return d ? porQueNoLlegaADiez(a, d, localDelAsiento(a.apuntes), grupoDe) : null
  }
  const motivoEspera = (a: AsientoDiario): string | null => {
    if (a.estado === 'propuesto' || a.estado === 'borrador') return primerMotivo(datos?.esperan.get(a.id))
    const n = noDiez(a)
    return n?.tipo === 'espera' ? n.motivo : null
  }
  const tareaDiez = (a: AsientoDiario): Extract<NoLlegaADiez, { tipo: 'tarea' }> | null => { const n = noDiez(a); return n?.tipo === 'tarea' ? n : null }
  const esperanTodos = datos ? datos.asientos.filter((a) => motivoEspera(a) !== null) : []
  const porEnviar = datos ? datos.asientos.filter((a) => tareaDiez(a) !== null).length : 0
  const revisables = datos ? datos.asientos.filter((a) => a.estado === 'propuesto' && !motivoEspera(a)).length : 0
  const enEsperan = vista === 'esperan'

  // Sin memo: filtrar unos miles de asientos es nada, y así no se queda viejo.
  const lista: AsientoDiario[] = !datos ? [] : (() => {
    const diez = (a: AsientoDiario) => numeroEnDiez(a, datos.conDiez.get(a.id))
    const base = enEsperan ? filtrar(datos.asientos, 'todos').filter((a) => motivoEspera(a) !== null)
      // «Para revisar» es lo que se puede revisar: lo que espera va en «Esperan».
      : filtro === 'revisar' ? filtrar(datos.asientos, filtro).filter((a) => !motivoEspera(a))
        : filtrar(datos.asientos, filtro)
    return base.filter((a) => (!soloSinDiez || tareaDiez(a) !== null) && cumpleFiltros(campos, filtros, {
      fecha: a.fecha,
      opcion: (id) => (id === 'serie' ? String(a.serie) : id === 'estado' ? estadoDe(a).texto
        : a.apuntes.map((l) => (l.comun ? 'Común' : l.local ?? '')).filter(Boolean)),
      texto: [a.concepto, numeroVisible(a), deDondeSale(a), eurosExactos(importe(a)), diez(a).valor ?? '',
        ...a.apuntes.flatMap((l) => [l.cuenta, l.nombreCuenta])].join(' '),
    }))
  })()

  const cambiarFiltro = (f: FiltroDiario) => {
    const p = new URLSearchParams(params)
    if (f === 'todos') p.delete('ver'); else p.set('ver', f)
    setParams(p, { replace: true })
  }
  const elegirVista = (id: string) => {
    setSoloSinDiez(false)
    if (id === 'esperan') { setVistaGuardada(null); setVista('esperan'); return }
    setVista(null)
    const g = guardadas.find((v) => v.id === id)
    if (g) {
      setVistaGuardada(g.id)
      setFiltros(g.filtros)
      cambiarFiltro(visibles.some((f) => f.id === g.base) ? g.base as FiltroDiario : 'todos')
      return
    }
    setVistaGuardada(null)
    cambiarFiltro(id as FiltroDiario)
  }

  // Ins: un asiento a mano (la tecla que lleva el botón; no es del navegador).
  const puedeNuevo = !!datos?.ejercicio
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'Insert' || e.ctrlKey || e.metaKey || e.altKey || escribiendo(e.target) || !puedeNuevo) return
      e.preventDefault()
      navegar(rutaNuevoAsiento())
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [navegar, puedeNuevo])

  // Respuesta 4: el corte manda (nada ≤ imported_until), sin corte y con ventas
  // de antes del ejercicio se pregunta primero, y cada vez un mes de ventas del
  // más reciente hacia atrás, diciendo cuántos días quedan.
  const [pregunta, setPregunta] = useState<{ porque: string; desde: string; programa: string; fallo: string | null } | null>(null)

  async function proponer() {
    if (!accountId || !activa || !datos?.ejercicio) return
    setFallo(null); setHecho(null); setProponiendo(true)
    try {
      const e = datos.ejercicio
      // Hasta el último día CERRADO, no hasta hoy: un día no se propone antes
      // de su hora de cierre (las 2:00 de serie, ajuste de la empresa).
      const cerrado = ultimoDiaCerrado(new Date(), datos.horaCierre)
      const rango = rangoAProponer(e, cerrado, { primeraVenta: await primeraVenta(accountId), asientosEnEjercicio: datos.asientos.length })
      if (rango.tipo === 'nada') { setHecho(rango.porque); return }
      if (rango.tipo === 'preguntar') { setPregunta({ porque: rango.porque, desde: '', programa: '', fallo: null }); return }
      const { desde, hasta } = rango
      const r = await proponerPendientes(accountId, activa.id, desde, hasta, userName)
      setSinPropuesta(r.sinPropuesta)
      const partes = [`${r.propuestas} ${r.propuestas === 1 ? 'asiento propuesto' : 'asientos propuestos'}`]
      if (r.validadasSolas) partes.push(`${r.validadasSolas} validados solos (los Seguros de ventas, como tienes elegido)`)
      if (r.yaEstaban) partes.push(`${r.yaEstaban} ya estaban`)
      if (r.descartadas) partes.push(`${r.descartadas} descartados antes, que no vuelvo a proponer`)
      if (r.sinPropuesta.length) partes.push(`${r.sinPropuesta.length} sin propuesta (debajo, por qué)`)
      const ventas = r.mesVentas ? ` Ventas de ${nombreMes(r.mesVentas)}.` : ''
      const quedan = r.quedanDias > 0
        ? ` Quedan ${miles(r.quedanDias)} ${r.quedanDias === 1 ? 'día' : 'días'} de ventas más antiguos por proponer: vuelve a pulsar.`
        : ' No queda ningún día de ventas por proponer.'
      setHecho(`Repasado del ${diaMesCorto(desde)} al ${diaMesCorto(hasta)}${e.traidoHasta ? ` (hasta el ${diaMesCorto(e.traidoHasta)} lo trae el programa anterior)` : ''}: ${partes.join(' · ')}.${ventas}${quedan}`)
      recargar()
    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se ha podido proponer.') }
    finally { setProponiendo(false) }
  }

  async function contestar() {
    if (!activa || !datos?.ejercicio || !pregunta) return
    const r = corteDesdeRespuesta(datos.ejercicio, pregunta.desde, hoyEnMadrid())
    if ('error' in r) { setPregunta({ ...pregunta, fallo: r.error }); return }
    try {
      await fijarCorte(activa.id, r.corte, pregunta.programa.trim() || 'el programa anterior')
      setPregunta(null)
      setHecho(r.corte ? `Guardado: ${MARCA.nombre} asienta desde el ${diaMesCorto(pregunta.desde)}; lo de antes lo trae el programa anterior.` : `Guardado: ${MARCA.nombre} asienta el ejercicio entero.`)
      recargar()
    } catch (e) { setPregunta({ ...pregunta, fallo: e instanceof Error ? e.message : 'No se ha podido guardar.' }) }
  }

  async function deshacer(id: string) {
    const a = datos?.asientos.find((x) => x.id === id)
    if (!a) return
    setFallo(null); setHecho(null)
    try {
      const r = await anularConDiez(id, 'Deshecho desde «Lo que he hecho yo»', null, userName)
      setHecho(`Deshecho: «${a.concepto}» queda anulado con el contraasiento ${NOMBRE_SERIE[r.serie as 1]} nº ${r.numero} del ${diaMesCorto(r.fecha)}. Vuelve a salir para proponer.${r.diez?.estado === 'en_diez' ? ` ${r.diez.texto}` : ''}`)
      if (r.diez?.estado === 'no_llega') setFallo(`${r.diez.texto} Queda en Libros › Pendientes de adjuntar en Diez, con «Enviar el contraasiento».`)
      recargar()
    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se ha podido deshacer.') }
  }

  if (!accountId && !cargando) return <Vacio titulo="No hay cuenta activa." explicacion="Elige una cuenta para ver su libro." />

  const mesCerrado = c?.mes.cerrado ? c.mes : null
  const columnas: ColumnaDensa<AsientoDiario>[] = datos ? [
    { id: 'fecha', titulo: 'Fecha', ancho: '64px', celda: (a) => <span className="cxd-fecha">{diaMesCorto(a.fecha)}</span>, exportar: (a) => a.fecha },
    { id: 'numero', titulo: 'Nº', ancho: '118px', celda: (a) => <span className="cxd-num">{numeroVisible(a)}</span>, exportar: (a) => numeroVisible(a), pesoPdf: 1.3 },
    {
      id: 'diez', titulo: 'Diez', ancho: '76px', cifra: true,
      celda: (a) => { const n = numeroEnDiez(a, datos.conDiez.get(a.id)); return <span className="cxd-diez" title={n.explicacion}>{n.texto}<span className="cx-oculto"> ({n.explicacion})</span></span> },
      exportar: (a) => numeroEnDiez(a, datos.conDiez.get(a.id)).valor,
    },
    {
      id: 'concepto', titulo: ['Concepto', analitica.local?.nombre.toLowerCase(), analitica.marca?.nombre.toLowerCase(), 'de dónde sale'].filter(Boolean).join(' · '), pesoPdf: 4,
      celda: (a) => {
        const d = diezDe(a)
        return (
          <span className="cxd-linea-libro">
            <span className="cxd-concepto-titulo" title={a.concepto}>{a.concepto}</span>
            {pastillas(a, ejes).map((p) => <Chip key={p.texto} tono={p.tono}>{p.texto}</Chip>)}
            {d && a.estado !== 'propuesto' && <ChipDiez e={d} />}
            <QueLePasa a={a} espera={motivoEspera(a)} tarea={tareaDiez(a)?.texto ?? null} />
          </span>
        )
      },
      exportar: (a) => `${a.concepto} · ${motivoEspera(a) ?? tareaDiez(a)?.texto ?? deDondeSale(a)}`,
    },
    { id: 'importe', titulo: 'Importe', ancho: '116px', cifra: true, celda: (a) => <span className="cxd-importe">{eurosExactos(importe(a))}</span>, exportar: (a) => importe(a) },
    { id: 'estado', titulo: 'Estado', ancho: '128px', celda: (a) => { const e = estadoDe(a); return <TonoChip tono={e.tono}>{e.texto}</TonoChip> }, exportar: (a) => estadoDe(a).texto },
    { id: 'abrir', titulo: '', ancho: '24px', celda: (a) => <span className="cxd-flecha" aria-hidden="true">{abierto === a.id ? '▾' : '▸'}</span> },
  ] : []

  return (
    <div className="cxd-pagina cxd-en-marco">
      <h2 className="cx-oculto">Libro diario</h2>
      <AccionesPantalla etiqueta="Acciones del libro diario">
        <BotonAccion principal tecla="Ins" atajo="Insert" onClick={() => navegar(rutaNuevoAsiento())} disabled={!puedeNuevo}>+ Nuevo asiento</BotonAccion>
        <BotonAccion onClick={proponer} disabled={proponiendo || !datos?.ejercicio}>{proponiendo ? 'Repasando…' : 'Proponer lo pendiente'}</BotonAccion>
        {candidatosDiez.length > 0 && (
          <BotonAccion onClick={() => setEnviarDiez(true)}>Validar y enviar a Diez{propuestosDiez ? ` · ${propuestosDiez}` : ''}</BotonAccion>
        )}
      </AccionesPantalla>
      <Guardado texto={hecho} />
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      {datos?.conDiezError && <p className="cx-ayuda cxt-ambar" role="note">No he podido leer cómo están con Diez las ventas por plataforma: {datos.conDiezError}</p>}
      {datos?.esperanError && <p className="cx-ayuda cxt-ambar" role="note">No he podido leer qué asientos esperan (lo que la validación pararía): {datos.esperanError}. Mientras tanto, todo lo propuesto cuenta como para revisar.</p>}
      {datos?.ejercicio && hoyEnMadrid() >= datos.ejercicio.inicio && hoyEnMadrid() <= datos.ejercicio.fin && (
        // Información, no un aviso: el día en curso no se propone hasta su cierre.
        <p className="cx-ayuda cxd-dia-en-curso" role="note">{textoDiaEnCurso(datos.horaCierre)}</p>
      )}
      {pregunta && (
        <section className="cx-tarjeta" aria-label={`Desde qué día asienta ${MARCA.nombre}`}>
          <div className="cx-tarjeta-cabeza"><h2 className="cx-tarjeta-titulo">¿Desde qué día asienta {MARCA.nombre}?</h2></div>
          <p className="cx-ayuda" style={{ marginTop: 0 }}>{pregunta.porque} Lo de antes de ese día no lo propongo: lo trae el programa anterior. Se puede cambiar en Ajustes › Ejercicio.</p>
          <form className="cx-rejilla-2" onSubmit={(ev) => { ev.preventDefault(); void contestar() }}>
            <label className="cx-campo"><span className="cx-etiqueta">Desde el día</span>
              <CampoFecha className="cx-input" valor={pregunta.desde} alCambiar={(v) => setPregunta({ ...pregunta, desde: v, fallo: null })} /></label>
            <label className="cx-campo"><span className="cx-etiqueta">Programa anterior</span>
              <input className="cx-input" value={pregunta.programa} placeholder="Diez, A3, Sage…" onChange={(ev) => setPregunta({ ...pregunta, programa: ev.target.value })} /></label>
            <div className="cx-pie">
              <button type="button" className="cx-boton-sec" onClick={() => setPregunta(null)}>Ahora no</button>
              <button type="submit" className="cx-boton">Guardar</button>
            </div>
          </form>
          {pregunta.fallo && <div className="cx-error" role="alert">{pregunta.fallo}</div>}
        </section>
      )}
      {sinPropuesta.length > 0 && (
        <section className="cx-tarjeta cxd-sin-propuesta" aria-label="Lo que no he propuesto">
          <div className="cx-tarjeta-cabeza"><h2 className="cx-tarjeta-titulo">Lo que no he propuesto, y por qué</h2>
            <button type="button" className="cx-enlace" onClick={() => setSinPropuesta([])}>Entendido</button></div>
          <ul>{sinPropuesta.map((x, i) => <SinPropuesta key={i} x={x} />)}</ul>
        </section>
      )}

      {error && <ErrorConReintento mensaje={error} reintentar={recargar} />}
      {!error && !datos && (
        <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando el libro" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[0, 1, 2, 3, 4].map((i) => <Hueso key={i} alto={44} />)}
        </div>
      )}
      {datos && !datos.ejercicio && (
        <div className="cx-tarjeta"><Vacio titulo="Aún no hay ningún ejercicio abierto." explicacion="Ábrelo en Ajustes › Ejercicio y el libro empieza a llenarse." /></div>
      )}

      {datos?.ejercicio && c && (
        <>
          {/* El mes, en una línea: las cifras de N11, en pequeño (lo que espera revisión va en «Te toca hoy»). */}
          <dl className="cxd-resumen" aria-label={`Cómo va ${nombreMes(datos.mes)}`}>
            <div><dt>Asientos en {nombreMes(datos.mes)}</dt><dd className="cxd-resumen-cifra">{miles(c.asientosMes)}</dd><dd className="cxd-resumen-apoyo">{c.apoyoAsientos}</dd></div>
            <div><dt>{capital(nombreMes(datos.mes))}</dt><dd className="cxd-resumen-cifra">{c.mes.texto}</dd><dd className={c.mes.cerrado ? 'cxd-resumen-apoyo cxt-ambar' : 'cxd-resumen-apoyo cxt-verde'}>{c.mes.apoyo}</dd></div>
            <div><dt>Resultado de {nombreMes(datos.mes)}</dt>
              <dd className="cxd-resumen-cifra">{c.resultado === null ? '—' : `${c.resultado >= 0 ? '+' : ''}${euros(c.resultado)}`}</dd>
              <dd className={datos.resultadoError ? 'cxd-resumen-apoyo cxt-ambar' : 'cxd-resumen-apoyo'}>{datos.resultadoError ? `No se ha podido calcular: ${datos.resultadoError}` : c.apoyoResultado}</dd></div>
          </dl>

          {mesCerrado && (
            <div className="cx-tarjeta cxd-franja" role="status">
              <span><strong>{capital(nombreMes(datos.mes))} está {mesCerrado.texto.toLowerCase()}</strong> · {mesCerrado.apoyo}. Lo que propongo cae en el primer día abierto.</span>
              {mesCerrado.cerrado && mesCerrado.tipo !== 'migrated' && <button type="button" className="cx-boton-sec" onClick={() => setDesbloqueo(true)}>Pedir desbloqueo</button>}
            </div>
          )}

          <div className="cxd-cuerpo">
            <section className="cxd-diario" aria-label="Asientos">
              <TablaDensa<AsientoDiario>
                etiqueta="Asientos del libro diario" nombreFila={['asiento', 'asientos']} filas={lista} total={datos.asientos.length}
                clave={(a) => a.id} columnas={columnas} movil={movil}
                teTocaHoy={[
                  { id: 'revisar', etiqueta: 'para revisar', numero: revisables, activo: filtro === 'revisar' && !vistaGuardada && !enEsperan,
                    alPulsar: () => { setVistaGuardada(null); setVista(null); setSoloSinDiez(false); cambiarFiltro(filtro === 'revisar' && !enEsperan ? 'todos' : 'revisar') } },
                  ...(datos.conDiez.size > 0 || datos.conDiezError ? [{
                    id: 'sin-diez', etiqueta: 'para enviar a Diez', numero: datos.conDiezError ? null : porEnviar, activo: soloSinDiez,
                    alPulsar: () => { setVista(null); setSoloSinDiez((v) => !v) },
                  }] : []),
                ]}
                vistas={{
                  lista: [
                    ...visibles.map((f) => ({ id: f.id, texto: f.texto, n: f.id === 'todos' ? undefined : f.id === 'revisar' ? revisables : f.n })),
                    // Siempre, como «Para revisar»: con 0 dice que no espera nada (regla 7); sin poder leerlo, «—».
                    { id: 'esperan', texto: datos.esperanError ? 'Esperan · —' : 'Esperan', n: datos.esperanError ? undefined : esperanTodos.length },
                    ...guardadas.map((g) => ({ id: g.id, texto: g.nombre, guardada: true })),
                  ],
                  activa: enEsperan ? 'esperan' : vistaGuardada ?? filtro,
                  alElegir: elegirVista,
                  alGuardar: enEsperan ? undefined : (nombre) => {
                    const l = guardarVista('libro-diario', usuario, nombre, filtro, filtros, almacen())
                    setGuardadas(l)
                    setVistaGuardada(l.find((v) => v.nombre.toLowerCase() === nombre.toLowerCase())?.id ?? null)
                  },
                  alBorrar: (id) => { setGuardadas(borrarVista('libro-diario', usuario, id, almacen())); if (vistaGuardada === id) setVistaGuardada(null) },
                }}
                filtros={{ campos, valores: filtros, alCambiar: (v) => { setFiltros(v); setVistaGuardada(null) } }}
                exportar={{
                  nombre: `Libro diario ${datos.ejercicio.code}${activa ? ` ${activa.nombre}` : ''}`,
                  titulo: 'Libro diario',
                  subtitulo: `${activa?.nombre ?? ''} · ejercicio ${datos.ejercicio.code} · ${visibles.find((f) => f.id === filtro)?.texto ?? 'Todos'}`,
                }}
                cuadre={(a) => ({ debe: a.apuntes.reduce((t, l) => t + l.debe, 0), haber: a.apuntes.reduce((t, l) => t + l.haber, 0) })}
                abierta={abierto}
                alAbrir={(a) => (movil ? navegar(rutaAsiento(a.id)) : setAbierto(abierto === a.id ? null : a.id))}
                detalle={(a) => <Apuntes a={a} espera={motivoEspera(a)} tarea={tareaDiez(a)} quien={userName}
                  alHacer={(t) => { setHecho(t); recargar() }} alFallar={setFallo} />}
                claseFila={(a) => (a.estado === 'anulado' ? 'cxd-anulado' : undefined)}
                tarjeta={(a) => <TarjetaAsiento a={a} diez={diezDe(a)} espera={motivoEspera(a)} tarea={tareaDiez(a)?.texto ?? null} />}
                vacio={enEsperan
                  ? <Vacio titulo="Nada esperando." explicacion={`Aquí sale lo que todavía no se puede validar o enviar, con su motivo: un mes cerrado, un envío por aclarar${hosteleria ? ', una plataforma sin su factura medida en Diez' : ''}…`} />
                  : filtro === 'revisar' && !soloSinDiez
                  ? <Vacio titulo="Nada que revisar." explicacion={`Lo que propongo sale aquí; con «Proponer lo pendiente» repaso ${hosteleria ? 'ventas, facturas, liquidaciones y nóminas' : 'ventas, facturas y nóminas'}.`} />
                  : datos.asientos.length === 0
                    ? <Vacio titulo="Aún no hay asientos en este ejercicio." explicacion="Pulsa «Proponer lo pendiente» y los preparo con su porqué; o haz uno a mano con «+ Nuevo asiento»." />
                    : <Vacio titulo="Ningún asiento con lo que hay puesto." explicacion="Prueba con «Todos» o quita los filtros: el libro tiene más." />}
              />
            </section>

            <aside className="cxd-lado">
              <section className="cxd-ia" aria-label="Lo que he hecho yo">
                <h2 className="cxd-ia-titulo"><span className="cx-marca-ia" aria-hidden="true">IA</span> Lo que he hecho yo</h2>
                {hechos.length === 0
                  ? <p className="cxd-ia-apoyo">Aún nada este ejercicio. Cuando proponga o asiente algo, sale aquí con su porqué.</p>
                  : hechos.map((h) => (
                    <div key={h.asientoId} className="cxd-ia-fila">
                      <div><Link to={rutaAsiento(h.asientoId)} className="cxd-ia-hecho">{h.titulo}</Link><span className="cxd-ia-apoyo">{h.apoyo}</span></div>
                      {h.deshacer && <button type="button" className="cx-enlace" onClick={() => deshacer(h.asientoId)}>Deshacer</button>}
                    </div>
                  ))}
              </section>
              {datos.cierre && <TarjetaCierre mes={mesAnterior(datos.mes)} fuente={datos.cierre} companyId={activa!.id}
                alHacer={(t) => { setHecho(t); recargar() }} alFallar={setFallo} />}
            </aside>
          </div>
        </>
      )}
      {enviarDiez && (
        <EnviarADiezDialogo candidatos={candidatosDiez} quien={userName} alCerrar={() => { setEnviarDiez(false); recargar() }}
          alTerminar={(t) => setHecho(`Validar y enviar a Diez: ${t}`)} />
      )}
      {desbloqueo && datos && activa && (
        <PedirDesbloqueo mes={datos.mes} companyId={activa.id} alCerrar={() => setDesbloqueo(false)}
          alHacer={(t) => { setDesbloqueo(false); setHecho(t); recargar() }} />
      )}
    </div>
  )
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

/** Lo que se ve al desplegar un asiento en el ordenador: sus apuntes y «Abrir el asiento». */
function Apuntes({ a, espera, tarea, quien, alHacer, alFallar }: {
  a: AsientoDiario; espera: string | null; tarea: Extract<NoLlegaADiez, { tipo: 'tarea' }> | null; quien: string | null
  alHacer: (t: string) => void; alFallar: (t: string) => void
}) {
  const [ocupado, setOcupado] = useState(false)
  // «Adjuntar» y «Reintentar» hacen lo mismo que en la tarjeta «Con Diez»: guardar
  // su documento si le falta y enviarlo. Lo que ha pasado se dice con contenido (regla 8).
  async function hacer() {
    setOcupado(true)
    try { const [p] = await validarYEnviar([a], quien); alHacer(p.texto) }
    catch (e) { alFallar(e instanceof Error ? e.message : 'No se ha podido enviar a Diez.') }
    finally { setOcupado(false) }
  }
  const { local: ejeLocal, marca: ejeMarca } = useAnalitica()
  return (
    <div className="cxd-apuntes">
      {espera && <p className="cxd-espera" role="note"><strong>Espera:</strong> {espera}</p>}
      {tarea && (
        <p className="cxd-tarea-diez">
          <span>{tarea.texto}</span>
          <button type="button" className="cx-boton" disabled={ocupado} onClick={(e) => { e.stopPropagation(); void hacer() }}>
            {ocupado ? (tarea.accion === 'adjuntar' ? 'Adjuntando…' : 'Reintentando…') : tarea.accion === 'adjuntar' ? 'Adjuntar' : 'Reintentar'}
          </button>
        </p>
      )}
      {a.apuntes.map((l) => (
        <div key={l.posicion} className="cxd-apunte">
          <span className="cxd-apunte-cuenta">
            <span>{l.nombreCuenta}{!ejeLocal ? '' : l.local ? ` · ${l.local}` : l.comun ? ' · común' : ''}</span>
            <Link to={rutaMayor(l.cuenta)} className="cxd-codigo" onClick={(e) => e.stopPropagation()}>{l.cuenta}</Link>
          </span>
          <span>
            {ejeMarca && l.marca && <Chip tono={l.cedida ? 'ambar' : 'neutro'}>{l.cedida ? `${l.marca} · cedida` : l.marca}</Chip>}
            {marcaNegativoDiez(l) && <Chip tono="ambar">{marcaNegativoDiez(l)}</Chip>}
          </span>
          <span className="cxd-importe">{eurosExactos(l.debe || l.haber)}</span>
          <span className="cx-ayuda">{l.debe ? 'al Debe' : 'al Haber'}</span>
        </div>
      ))}
      <div className="cxd-apunte-pie"><Link to={rutaAsiento(a.id)} className="cx-enlace">Abrir el asiento</Link></div>
    </div>
  )
}

/**
 * Lo que va en la fila después de los chips: el motivo si espera, lo que falta
 * para Diez si es tarea, y si no, de dónde sale (en una línea, con «…»).
 */
function QueLePasa({ a, espera, tarea }: { a: AsientoDiario; espera: string | null; tarea: string | null }) {
  if (espera) return <span className="cxd-sale cxd-sale-espera" title={espera}>Espera: {espera}</span>
  if (tarea) return <span className="cxd-sale cxd-sale-tarea" title={tarea}>{tarea}</span>
  return <span className="cxd-sale" title={deDondeSale(a)}>{deDondeSale(a)}</span>
}

/** Un asiento en el móvil: fecha y número, el concepto, sus chips, el importe y el estado. */
function TarjetaAsiento({ a, diez, espera, tarea }: { a: AsientoDiario; diez?: EstadoDiez; espera: string | null; tarea: string | null }) {
  const e = estadoDe(a)
  const analitica = useAnalitica()
  const ejes = { local: !!analitica.local, marca: !!analitica.marca }
  return (
    <span className={`cxd-tarjeta${a.estado === 'anulado' ? ' cxd-anulado' : ''}`}>
      <span className="cxd-fecha">{diaMesCorto(a.fecha)}<span className="cxd-num-movil">{numeroVisible(a)}</span></span>
      <span className="cxd-tarjeta-concepto">
        <span className="cxd-concepto-titulo" title={a.concepto}>{a.concepto}</span>
        <span className="cxd-concepto-apoyo">
          {pastillas(a, ejes).map((p) => <Chip key={p.texto} tono={p.tono}>{p.texto}</Chip>)}
          {diez && a.estado !== 'propuesto' && <ChipDiez e={diez} />}
          <QueLePasa a={a} espera={espera} tarea={tarea} />
        </span>
      </span>
      <span className="cxd-tarjeta-derecha">
        <span className="cxd-importe">{eurosExactos(importe(a))}</span>
        <TonoChip tono={e.tono}>{e.texto}</TonoChip>
      </span>
    </span>
  )
}

function TarjetaCierre({ mes, fuente, companyId, alHacer, alFallar }: {
  mes: string; fuente: FuenteCierre; companyId: string; alHacer: (t: string) => void; alFallar: (t: string) => void
}) {
  const pasos = pasosCierre(fuente)
  const puede = sePuedeCerrar(pasos)
  const [ocupado, setOcupado] = useState(false)
  async function cerrar() {
    setOcupado(true)
    try {
      await cerrarMes(companyId, mes)
      alHacer(`${capital(nombreMes(mes))} cerrado: ya no entra ningún asiento con fecha de ese mes. Lo que llegue tarde va al primer día abierto.`)
    } catch (e) { alFallar(e instanceof Error ? e.message : 'No se ha podido cerrar.') }
    finally { setOcupado(false) }
  }
  return (
    <section className="cx-tarjeta cxd-cierre" aria-label={`Cierre de ${nombreMes(mes)}`}>
      <h2 className="cx-tarjeta-titulo">Cierre de {nombreMes(mes)}</h2>
      <ul className="cxd-pasos">
        {pasos.map((p) => (
          <li key={p.texto} className={p.hecho ? 'cxd-paso-hecho' : 'cxd-paso-falta'}>
            <span aria-hidden="true">{p.hecho ? '✓' : '·'}</span> {p.texto}<span className="cx-oculto">{p.hecho ? ' (hecho)' : ' (falta)'}</span>
          </li>
        ))}
      </ul>
      {!fuente.cerrado && (
        <>
          <button type="button" className="cx-boton" onClick={cerrar} disabled={!puede.puede || ocupado}>{ocupado ? 'Cerrando…' : `Cerrar ${nombreMes(mes)}`}</button>
          {puede.falta && <span className="cx-ayuda">{puede.falta}</span>}
        </>
      )}
    </section>
  )
}

function PedirDesbloqueo({ mes, companyId, alCerrar, alHacer }: { mes: string; companyId: string; alCerrar: () => void; alHacer: (t: string) => void }) {
  const [motivo, setMotivo] = useState('')
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  async function pedir() {
    setOcupado(true); setFallo(null)
    try {
      await reabrirMes(companyId, mes, motivo)
      alHacer(`${capital(nombreMes(mes))} reabierto. Queda escrito por qué: «${motivo.trim()}».`)
    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se ha podido reabrir.') }
    finally { setOcupado(false) }
  }
  return (
    <Dialogo titulo={`Desbloquear ${nombreMes(mes)}`} alCerrar={alCerrar}>
      <p className="cx-ayuda">Solo se reabre el último mes cerrado, y queda escrito quién y por qué. Si su impuesto está presentado, cambiar algo pide una complementaria.</p>
      <label className="cxd-campo">Por qué
        <textarea className="cx-input" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: llegó tarde una factura del 28" />
      </label>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      <div className="cxd-dialogo-acciones">
        <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button>
        <button type="button" className="cx-boton" onClick={pedir} disabled={ocupado || !motivo.trim()}>{ocupado ? 'Reabriendo…' : 'Desbloquear'}</button>
      </div>
    </Dialogo>
  )
}

/** Una línea de «Lo que no he propuesto»; si habla de pedidos, «Ver los N pedidos». */
function SinPropuesta({ x }: { x: ResultadoProponer['sinPropuesta'][number] }) {
  const [ver, setVer] = useState(false)
  const n = x.pedidos?.length ?? 0
  return (
    <li>
      <strong>{x.que}</strong> · {x.porque}
      {n > 0 && <> <button type="button" className="cx-enlace" aria-expanded={ver} onClick={() => setVer((v) => !v)}>{ver ? 'Ocultar' : n === 1 ? 'Ver el pedido' : `Ver los ${n} pedidos`}</button></>}
      {ver && x.pedidos && (
        <ul className="cxd-sin-pedidos">
          {x.pedidos.map((p, j) => <li key={j}>{p.codigo ?? 'sin código'} · {p.marca} · {p.canal} · {eurosExactos(p.total)}</li>)}
        </ul>
      )}
    </li>
  )
}
