// src/modules/conta/libros/TraerPorLaConexion.tsx
//
// X13 · «Traer de ERP10» EN UN BOTÓN, con la sociedad conectada (la maqueta nucleo_11_traer_de_erp10_un_boton,
// aprobada por Julio el 20/11). La regla de Julio: llegar fácil, que se entienda sola, y un botón para empezar,
// uno secundario para parar o cancelar, y uno para confirmar. Sin los tres pasos ni la zona de soltar: eso es la
// pantalla de los ficheros (TraerErp10.tsx), a la que lleva «¿Sin conexión con ERP10? Súbelo en ficheros».
//
//   Antes     «Traerlo todo de ERP10» y la lista de lo que se va a traer, con su círculo vacío. Nada en ámbar.
//   Trayendo  «Pararlo». El lector (erp10/lectorTraer.ts, del X12) lee mes a mes fuera de la pantalla: se puede
//             ir a otra pestaña y volver, y si se corta, sigue donde se quedó. Cada fila se marca sola al acabar.
//   Acabado   Al acabar de leer, lo leído entra EN PRUEBA solo (conta_traer_cargar, el camino de siempre, con
//             lo mismo que daría el fichero: lib/traer/conexion.ts). La base lo compara con el sumas y saldos
//             calculado, y la pantalla con el resumen de ERP10 por mes y tipo. «Darlo por bueno» (con su
//             confirmación) y «Descartar lo traído» (lo quita entero, conta_traer_deshacer).
//
// Lo que decide cada estado está en lib/traer/unBoton.ts (puro, con sus pruebas). Las palabras dicen lo que
// hace la base, no lo que decía la maqueta: entra en prueba, y hasta darlo por bueno se deshace entero.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useLeer, useLibros } from '@/modules/conta/libros/contexto'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'
import {
  FRASES_UN_BOTON, confirmarDarlo, confirmarDescartar, conLoDeLaTabla, estadoUnBoton, filasUnBoton, leerCarga, leidoDeLaConexion, lineaDadoPorBueno,
  lineaDeshecho, loQueMirar, paraLaBase, pastillaUnBoton, queSeTrajoSoloCuentas, type EntradaUnBoton, type FilaUnBoton,
} from '@/modules/conta/lib/traer'
import { PARADO, lectorDe, type LectorTraer, type VistaLector } from '@/modules/conta/erp10/lectorTraer'
import { almacenDelNavegador } from '@/modules/conta/erp10/almacenTraer'
import { traerPaginaErp10, type ConexionErp10 } from '@/modules/conta/services/erp10ApiService'
import { antesDeDarlo, darPorBueno, deshacer, leerEnPrueba, leerUltima, traer, type Ultima } from '@/modules/conta/services/traerService'

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const SIN_LECTOR = () => () => undefined
const ICONO: Record<FilaUnBoton['icono'], string> = { vacio: '', leyendo: '', hecho: '✓', mira: '!' }
/** Lo que se está metiendo en prueba (un lector, una vez): que dos montajes de la pantalla no lo metan dos veces. */
const METIENDO = new Set<string>()

function useLector(l: LectorTraer | null): VistaLector | null {
  return useSyncExternalStore(l ? (f) => l.oir(f) : SIN_LECTOR, () => l?.estado ?? null)
}

export function TraerPorLaConexion({ conexion, alFicheros }: { conexion: ConexionErp10; alFicheros: () => void }) {
  const L = useLibros()
  const [vuelta, setVuelta] = useState(0)
  const enPrueba = useLeer(async () => ({ p: await leerEnPrueba(L.accountId, L.companyId) }), `${L.companyId}:${vuelta}:${L.vuelta}`)
  const ultima = useLeer(() => leerUltima(L.accountId, L.companyId), `${L.companyId}:${vuelta}:${L.vuelta}`)
  const [ejercicio, setEjercicio] = useState<string>(L.ejercicio.code)
  const lector = useMemo(() => lectorDe(L.companyId, ejercicio, () => ({
    pedir: (q) => traerPaginaErp10(L.companyId, q), almacen: almacenDelNavegador(), hoy: hoyMadrid(),
  })), [L.companyId, ejercicio])
  const vista = useLector(lector)
  const hecho = vista?.estado === 'hecho' ? vista : null
  const deErp10 = useMemo(() => (hecho ? leidoDeLaConexion(hecho.datos) : null), [hecho])
  const carga = useMemo(() => (deErp10 ? leerCarga([], deErp10) : null), [deErp10])
  const p = enPrueba.datos?.p ?? null
  const antes = useLeer(p ? () => antesDeDarlo(p.id) : null, `${p?.id ?? ''}:${vuelta}`)
  const [meter, setMeter] = useState<EntradaUnBoton['meter']>(null)
  const [verlos, setVerlos] = useState<{ titulo: string; lista: string[] } | null>(null)
  const [confirmar, setConfirmar] = useState<'dar' | 'descartar' | null>(null)
  const [haciendo, setHaciendo] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  // Julio (20/11): si la cabecera no cabe en una línea (a 1366), la pastilla baja a una segunda, debajo del título.
  // Nada cortado ni escondido. Se mide lo que pide cada pieza en una sola línea, quepa o no.
  const cabeza = useRef<HTMLDivElement | null>(null)
  const [dosLineas, setDosLineas] = useState(false)
  useLayoutEffect(() => {
    const el = cabeza.current
    if (!el) return
    const medir = () => {
      const c = getComputedStyle(el)
      const piezas = [...el.children].filter((x) => !x.classList.contains('cxu-salto')) as HTMLElement[]
      const gap = parseFloat(c.columnGap) || 0
      const pide = piezas.reduce((t, x) => t + Math.max(x.scrollWidth, x.offsetWidth), 0) + gap * Math.max(0, piezas.length - 1)
        + (parseFloat(c.paddingLeft) || 0) + (parseFloat(c.paddingRight) || 0)
      const no = pide > el.clientWidth
      setDosLineas((d) => (d === no ? d : no))
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  })

  // Al acabar de leer, lo leído entra en prueba solo (una vez por lectura). Si la base no lo deja, se dice su frase.
  const clave = hecho ? `${lector.clave}|${hecho.acabado ?? ''}` : null
  useEffect(() => {
    if (!clave || !carga || !enPrueba.datos || enPrueba.datos.p || METIENDO.has(clave)) return
    METIENDO.add(clave)
    // El aviso de «metiendo» va en la siguiente vuelta (sin setState síncrono en el efecto).
    void Promise.resolve().then(() => setMeter({ estado: 'metiendo' }))
      .then(() => traer(L.companyId, ejercicio, paraLaBase(carga), L.quien))
      .then(() => { setMeter(null); setVuelta((v) => v + 1) },
        (e: unknown) => { METIENDO.delete(clave); setMeter({ estado: 'fallo', texto: e instanceof Error ? e.message : 'No ha contestado.' }) })
  }, [clave, carga, enPrueba.datos, L.companyId, L.quien, ejercicio])

  if (enPrueba.error) return <ErrorConReintento mensaje={enPrueba.error} reintentar={enPrueba.recargar} />
  if (!enPrueba.datos) return <div className="cx-tarjeta" aria-busy="true" aria-label="Mirando si hay algo traído en prueba"><Hueso alto={40} /></div>

  const entrada: EntradaUnBoton = {
    lector: vista, carga, enPrueba: p, meter, parado: PARADO,
    antes: antes.datos ? { puede: antes.datos.puede, texto: antes.datos.texto, comparado: antes.datos.comparado, diferencias: antes.datos.diferencias ?? [] } : null,
  }
  const estado = estadoUnBoton(entrada)
  const filas = filasUnBoton(entrada)
  const pastilla = pastillaUnBoton(entrada)
  const mirar = estado === 'acabado' ? loQueMirar(entrada, filas) : null
  const darlo = confirmarDarlo(entrada)
  const anioHoy = Number(hoyMadrid().slice(0, 4))
  const anios = [...new Set([...L.ejercicios.map((x) => x.code), ...[anioHoy, anioHoy - 1, anioHoy - 2].map(String)])].sort().reverse()

  async function hacer(que: string, f: () => Promise<unknown>) {
    setHaciendo(que); setFallo(null)
    try {
      await f()
      await lector.olvidar()
      setMeter(null); setVerlos(null)
      setVuelta((v) => v + 1)
    } catch (e) {
      setFallo(e instanceof Error ? e.message : 'No ha contestado.')
    } finally { setHaciendo(null); setConfirmar(null) }
  }
  const reintentar = () => { setMeter(null); if (clave) METIENDO.delete(clave); setVuelta((v) => v + 1) }

  // Un botón principal en cada estado, a la derecha; el secundario, a su izquierda.
  const botones = (
    <div className="cxe-botones">
      {estado === 'antes' && <button type="button" className="cxe-grande" onClick={() => { void lector.traer() }}>Traerlo todo de ERP10</button>}
      {estado === 'trayendo' && <button type="button" className="cxe-sec" onClick={() => lector.dejar()}>Pararlo</button>}
      {estado === 'parado' && <>
        <button type="button" className="cxe-sec" onClick={() => { void lector.olvidar() }}>Descartar lo leído</button>
        <button type="button" className="cxe-grande" onClick={() => { void lector.traer() }}>Seguir trayendo de ERP10</button>
      </>}
      {estado === 'fallo' && <>
        <button type="button" className="cxe-sec" onClick={() => { setMeter(null); void lector.olvidar() }}>Descartar lo leído</button>
        <button type="button" className="cxe-grande" onClick={reintentar}>Volver a intentarlo</button>
      </>}
      {estado === 'acabado' && <>
        <button type="button" className="cxe-sec" disabled={!!haciendo} onClick={() => setConfirmar('descartar')}>Descartar lo traído</button>
        <button type="button" className="cxe-grande" disabled={!antes.datos || !!haciendo} title={antes.datos && !darlo.puede ? darlo.texto : undefined}
          onClick={() => setConfirmar('dar')}>Darlo por bueno</button>
      </>}
    </div>
  )

  const noDa = (
    <div className="cxe-nota cxu-caja"><p><strong>Lo que la conexión no da</strong></p>
      <p>El inmovilizado: <button type="button" className="cxe-enlace" onClick={alFicheros}>súbelo en un fichero</button> cuando quieras.{estado === 'acabado' ? '' : ' No hace falta para empezar.'}</p></div>
  )
  const caja = (titulo: string, texto: string, extra?: ReactNode) => (
    <div className="cxe-nota cxu-caja"><p><strong>{titulo}</strong></p><p>{texto}</p>{extra}</div>
  )
  const pie = estado === 'antes' ? FRASES_UN_BOTON.pieAntes : estado === 'acabado' ? FRASES_UN_BOTON.pieAcabado : FRASES_UN_BOTON.pieTrayendo

  return (
    <section className="cxe cxt cxu" aria-labelledby="cxu-titulo">
      <div className={`cxe-cabeza cxu-cabeza${dosLineas ? ' cxu-dos-lineas' : ''}`} ref={cabeza}>
        <h1 className="cxe-titulo" id="cxu-titulo">Traer de ERP10</h1>
        <select className="cxe-mes" aria-label="Ejercicio" value={ejercicio} disabled={estado !== 'antes'} onChange={(e) => setEjercicio(e.target.value)}>
          {anios.map((x) => <option key={x} value={x}>Ejercicio {x}</option>)}
        </select>
        <span className="cxu-conectada">Conectada con ERP10 · empresa {conexion.codigo}</span>
        {botones}
        {pastilla && <span className="cxu-salto" aria-hidden="true" />}
        {pastilla && <span className={`cxu-pastilla cxu-pastilla-${pastilla.tono}`} role="status">{pastilla.texto}</span>}
      </div>

      {estado === 'antes' && ultima.datos && <LoUltimo u={ultima.datos} />}

      <div className="cxe-cuerpo">
        <div className="cxe-izq cxu-izq">
          <ul className="cxu-filas" aria-label="Lo que se trae">
            {filas.map((f) => (
              <li key={f.tipo} className={`cxu-fila cxu-${f.icono}`} aria-busy={f.icono === 'leyendo' || undefined}>
                <span className="cxu-icono" aria-hidden="true">{ICONO[f.icono]}</span>
                <strong className="cxu-que">{f.que}</strong>
                <span className="cxu-cifra">{f.cifra ?? ''}</span>
                <span className="cxu-linea">
                  {f.linea}
                  {f.barra != null && <span className="cxu-barra" aria-hidden="true"><span style={{ width: `${Math.round(f.barra * 100)}%` }} /></span>}
                  {f.verlos && <> · <button type="button" className="cxe-enlace" onClick={() => setVerlos(f.verlos)}>Verlos</button></>}
                </span>
              </li>
            ))}
          </ul>
          <div className="cxu-pie">
            <p>{pie}</p>
            <p className="cxu-ficheros">¿Sin conexión con ERP10? <button type="button" className="cxe-enlace" onClick={alFicheros}>Súbelo en ficheros</button></p>
          </div>
        </div>
        <aside className="cxe-der cxu-der" aria-label="Lo que pasa">
          <div className="cxe-der-cuerpo">
            {estado === 'antes' && <>{caja('Un botón y listo', FRASES_UN_BOTON.unBoton)}{caja('En ERP10 no cambia nada', FRASES_UN_BOTON.soloLee)}</>}
            {(estado === 'trayendo' || estado === 'parado' || estado === 'metiendo') && <>
              {caja('Qué está pasando', estado === 'parado' ? (vista?.fallo && vista.fallo !== PARADO ? `Se ha cortado: ${vista.fallo} Lo leído se queda: «Seguir trayendo de ERP10» sigue donde se quedó.` : FRASES_UN_BOTON.parado)
                : estado === 'metiendo' ? 'Leído de ERP10. Ahora entra en prueba en Sumied: tarda unos segundos.' : FRASES_UN_BOTON.queEstaPasando)}
              {caja('Cuando acabe', FRASES_UN_BOTON.cuandoAcabe)}
            </>}
            {estado === 'fallo' && meter?.estado === 'fallo' && (
              <div className="cxe-aviso" role="alert"><p><strong>No ha entrado en prueba.</strong> {meter.texto}</p><p>Lo leído se queda: vuelve a intentarlo o descártalo.</p></div>
            )}
            {estado === 'acabado' && <>
              {verlos ? (
                <div className="cxe-aviso cxu-verlos" role="region" aria-label="Lo que hay que mirar">
                  <p><strong>{verlos.titulo}</strong></p>
                  <ul>{verlos.lista.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  <div className="cxe-aviso-botones"><button type="button" className="cxe-sec" onClick={() => setVerlos(null)}>Cerrar</button></div>
                </div>
              ) : mirar ? (
                <div className="cxe-aviso cxu-caja" role="note"><p><strong>{mirar.titulo}</strong></p><p>{mirar.texto}</p>
                  {mirar.lista.length > 0 && <div className="cxe-aviso-botones"><button type="button" className="cxe-ambar" onClick={() => setVerlos({ titulo: 'Al traerlo', lista: mirar.lista })}>Verlos</button></div>}
                </div>
              ) : caja('Nada que mirar', 'Todo lo leído entra sin avisos.')}
              {caja('Lo que Sumied ha aprendido', FRASES_UN_BOTON.aprendido(p?.cuentas.aprendido ?? 0))}
            </>}
            {noDa}
          </div>
        </aside>
      </div>

      {confirmar && (
        <div className="cxt-velo" role="dialog" aria-modal="true" aria-labelledby="cxu-confirmar">
          <div className="cxt-confirmar">
            <h2 id="cxu-confirmar">{confirmar === 'dar' ? 'Darlo por bueno' : 'Descartar lo traído'}</h2>
            <p>{confirmar === 'dar' ? darlo.texto : confirmarDescartar(entrada)}</p>
            <div className="cxt-confirmar-botones">
              {confirmar === 'dar'
                ? <button type="button" className="cxe-grande" disabled={!!haciendo || !darlo.puede || !p} onClick={() => { void hacer('Dándolo por bueno…', () => darPorBueno(p!.id, L.quien)) }}>{darlo.boton}</button>
                : <button type="button" className="cxe-grande" disabled={!!haciendo || !p} onClick={() => { void hacer('Descartando…', () => deshacer(p!.id, L.quien)) }}>Descartar lo traído</button>}
              <button type="button" className="cxe-sec cxt-igual" disabled={!!haciendo} onClick={() => setConfirmar(null)}>Todavía no</button>
            </div>
          </div>
        </div>
      )}

      <div className="cxe-estado" role="status" aria-live="polite">{haciendo && <span>{haciendo}</span>}</div>
      {fallo && <div className="cxe-estado cxe-mal" role="alert">{fallo}</div>}
    </section>
  )
}

/** Lo último que se dio por bueno o se descartó: la confirmación de esos dos botones, leída de la base (regla 8). */
function LoUltimo({ u }: { u: Ultima }) {
  const cuando = new Date(u.cuando)
  if (u.estado === 'deshecha') {
    const quitado = { ...u.quitado, recibidas: u.cuentas.facturas_recibidas ?? u.quitado.recibidas ?? 0, emitidas: u.cuentas.facturas_emitidas ?? u.quitado.emitidas ?? 0 }
    return <div className="cxt-prueba cxt-ultimo" role="status">{lineaDeshecho(u.quien, cuando, quitado)}</div>
  }
  const texto = u.soloCuentas && u.texto ? conLoDeLaTabla(u.texto, queSeTrajoSoloCuentas(u.cuentas, u.textoAlTraer)) : (u.texto ?? 'Hecho.')
  return <div className="cxt-prueba cxt-ultimo cxt-ultimo-bueno" role="status">{lineaDadoPorBueno(u.quien, cuando, texto)}</div>
}
