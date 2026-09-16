// src/modules/pase/PaseBoard.tsx
//
// EL PASE · LA PANTALLA · 14/09/2026
//
// Tablet Android de 7 pulgadas, apaisada, a un metro, con las manos llenas.
// No es un panel de oficina. Una zona a la vez con tres pestañas grandes; la
// tarjeta es una FILA porque en apaisado sobra ancho y falta alto.
//
// Toda la decisión --qué zona, qué palabras, si hay botón-- vive en
// `lib/lasTresZonas.ts` y está probada contra la población real. Aquí sólo se
// pinta.
//
// 🔴 `declaraTrabajoEnCurso` ES INNEGOCIABLE. El vigía de versión pregunta
// `hayTrabajoEnCurso()` antes de recargar la tablet sola, y esta pantalla
// sustituye a `OrdersFeed`, que es quien lo declaraba. Sin esto, una tablet con
// comandas vivas se recarga en mitad del servicio y deshacemos el trabajo del
// 01/09. Va también en el ensayo, no sólo aquí.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clock, Truck, Printer, AlertTriangle, ChevronRight } from 'lucide-react'
import { declaraTrabajoEnCurso } from '@/services/trabajoEnCurso'
import {
  laZona, laSituacion, tieneBotonDeListo, tieneBotonDeRecogida, loQuePasa, loQueNoSabemos,
  sabemosSuCiclo, seVaSola, MINUTOS_PARA_IRSE_SOLA,
  elSubtitulo, elTono, losMinutos, type Zona, type Tono,
} from './lib/lasTresZonas'
import {
  getTablero, marcarListo, marcarRecogido, reimprimirBolsa,
  type TarjetaDelPase, type ElTablero, apagarElPase,
} from './services/paseService'
import { elCodigoCorto, laPastilla, type TonoPastilla } from './lib/laFicha'
import HojaDelPase from './components/HojaDelPase'

const POLL_MS = 10_000
/** Los entregados se van solos. No hay nada que pulsar. */
const MINUTOS_EN_ENTREGADOS = 20

const ZONAS: { id: Zona; nombre: string; pista: string }[] = [
  // 🔴 «Un toque y se va» dejó de ser verdad el 16/09 con la opción A: las
  // bolsas de plataforma NO se van al pulsar «Listo», se van cuando alguien
  // dice que se las han llevado o solas a los 30 minutos. La frase describía
  // un comportamiento que ya no existe, que es la peor clase de frase.
  { id: 'sigue_aqui', nombre: 'Sigue aquí', pista: 'Lo que todavía está en el local.' },
  { id: 'en_ruta',    nombre: 'En ruta',    pista: 'Sólo lo que sabemos que ha salido. Aquí no se pulsa nada.' },
  { id: 'entregados', nombre: 'Entregados', pista: 'Sólo lo que sabemos que ha llegado. Se vacía sola.' },
]

/** La pastilla corta de quién lo lleva. Verde nosotros, roja lo que no tiene dueño. */
const PASTILLA_CLS: Record<TonoPastilla, string> = {
  nuestro:    'bg-success-bg text-success border-success/40',
  plataforma: 'bg-page text-text-secondary border-default',
  aviso:      'bg-danger-bg text-danger border-danger/40',
  cliente:    'bg-page text-text-secondary border-default',
}

const TONO_CLS: Record<Tono, string> = {
  neutro: 'bg-page text-text-secondary',
  bien:   'bg-success-bg text-success',
  aviso:  'bg-warning-bg text-warning',
  mal:    'bg-danger-bg text-danger',
}

/** Las iniciales, para cuando una marca no tiene logo. Hoy sólo Lovers Burgers. */
function iniciales(nombre: string | null): string {
  return (nombre ?? '?').split(/\s+/).filter(Boolean).slice(0, 2)
    .map(p => p[0]).join('').toUpperCase()
}

function Logo({ t }: { t: TarjetaDelPase }) {
  const [roto, setRoto] = useState(false)
  // Hueco de datos a la vista, no un marcador que parezca un logo: si falta, se
  // ve que falta. (Lovers Burgers es la única sin `logo_url` de 17 activas.)
  if (!t.marca_logo_url || roto) {
    return (
      <div className="w-10 h-10 rounded-lg shrink-0 bg-lavado border border-dashed border-linea-fuerte
                      flex items-center justify-center text-[11px] font-extrabold text-text-tertiary">
        {iniciales(t.marca)}
      </div>
    )
  }
  return (
    <img src={t.marca_logo_url} alt="" onError={() => setRoto(true)}
         className="w-10 h-10 rounded-lg shrink-0 object-cover bg-lavado border border-default" />
  )
}

/**
 * EL RENGLÓN DE LA BOLSA · sólo cuando NO ha salido.
 *
 * 🔴 (16/09) «Bolsa impresa · 21:29 · reimprimir» y «👤 Listo · Lo dice la
 * flota» se han ido a la hoja de detalle, y no es una limpieza de estilo: la
 * maqueta aprobada lo dice y la razón es que son datos de CONSULTA. En la
 * tarjeta competían por el sitio con lo único que se mira de lejos --qué lleva
 * dentro y si hay que hacer algo-- y encima ofrecían un «reimprimir» de una
 * línea, subrayado y pequeño, justo al lado de un botón de 62 píxeles.
 *
 * Lo que SÍ se queda es la bolsa ROTA, porque eso no es una consulta: es una
 * bolsa que no se puede dar, y tiene que verse sin abrir nada.
 */
function LaBolsaRota({ t }: { t: TarjetaDelPase }) {
  if (t.bolsa.estado !== 'rota') return null
  return (
    <p className="text-[12px] leading-snug text-danger font-semibold mt-1.5">
      La bolsa no ha salido. La impresora no contesta. El pedido se queda aquí hasta
      que haya papel: sin etiqueta, la bolsa no se puede dar.
      {t.bolsa.intentos > 0 && ` Intentado ${t.bolsa.intentos} ${t.bolsa.intentos === 1 ? 'vez' : 'veces'}.`}
      {t.bolsa.cuando && ` · ${t.bolsa.cuando}`}
    </p>
  )
}

function Tarjeta({ t, ocupado, onListo, onRecogido, onReimprimir, onAbrir }: {
  t: TarjetaDelPase
  ocupado: boolean
  onListo: () => void
  onRecogido: () => void
  onReimprimir: () => void
  /** Abre la hoja de detalle. Regla 1 de la maqueta: el botón NO la abre. */
  onAbrir: () => void
}) {
  const situacion = laSituacion(t)
  const rota = t.bolsa.estado === 'rota'
  // 🔴 Con la bolsa rota no hay «Listo»: el botón que sale es el de reimprimir.
  // No es una opinión de diseño, es lo que dice la propia tarjeta dos líneas
  // más arriba --sin etiqueta la bolsa no se puede dar-- y hasta hoy la pantalla
  // se contradecía a sí misma ofreciendo las dos cosas a la vez.
  const conBoton = tieneBotonDeListo(t) && !rota
  const conRecogida = tieneBotonDeRecogida(t)
  const pastilla = laPastilla(t)

  return (
    <article className={`grid gap-2.5 items-stretch rounded-xl border p-2.5 mb-1.5
                         ${rota ? 'border-danger/40 bg-danger-bg/25' : 'border-default bg-card'}`}
             style={{ gridTemplateColumns: 'minmax(0,1fr) 240px' }}>
      {/* TODA LA TARJETA MENOS LOS BOTONES ABRE LA HOJA. Es un <button> de
          verdad --no un div con onClick-- para que funcione con teclado y lo
          anuncie un lector de pantalla; los botones de acción viven en la otra
          columna, fuera de éste, así que no hay un botón dentro de otro. */}
      <button type="button" onClick={onAbrir}
              className="min-w-0 flex flex-col justify-center text-left">
        <div className="flex items-center gap-2 w-full">
          <Logo t={t} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <b className="text-[16px] font-extrabold tracking-tight truncate">{t.marca ?? 'Sin marca'}</b>
              {/* LA PASTILLA · quién lo lleva, en una palabra. La frase larga
                  --«Nuestro · Marta · en camino al local»-- es de la hoja. */}
              <span className={`shrink-0 px-1.5 py-0.5 rounded-md border text-[10.5px]
                                font-extrabold uppercase tracking-wide ${PASTILLA_CLS[pastilla.tono]}`}>
                {pastilla.texto}
              </span>
            </div>
            <i className="block not-italic text-[11.5px] font-semibold text-text-secondary truncate">
              {elSubtitulo(t)}
            </i>
          </div>
          <span className="ml-auto self-start flex items-center gap-0.5 text-[11px]
                           text-text-tertiary tabular-nums shrink-0">
            {elCodigoCorto(t.codigo) ?? ''}
            <ChevronRight size={13} className="text-text-tertiary/70" />
          </span>
        </div>

        {/* La hora de la recogida cuando ya se la han llevado: es el único
            trozo de «quién lo lleva» que cambia lo que hace el del pase --deja
            de esperar al rider-- así que se queda. El resto está en la hoja. */}
        {t.handed_to_courier_at != null && (
          <p className="text-[12.5px] font-bold leading-snug mt-1 truncate text-text-secondary">
            Recogido a las {new Date(t.handed_to_courier_at).toLocaleTimeString('es-ES',
              { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}
          </p>
        )}

        {/* 🔴 LOS PLATOS, SIEMPRE (16/09). Estaban gateados a `por_marcar`, así
            que en cuanto alguien pulsaba «Listo» la bolsa se quedaba sin su
            contenido: justo cuando el del pase la coge de la estantería y tiene
            que saber qué lleva dentro para dársela al rider correcto. */}
        {t.lineas.length > 0 && (
          <div className="border-t border-lavado mt-1.5 pt-1.5">
            {t.lineas.map((l, i) => (
              <div key={i} className="flex gap-2 items-baseline">
                <b className="font-extrabold tabular-nums min-w-[20px]">{l.cantidad}×</b>
                <span className="text-text-primary/80 truncate">{l.nombre}</span>
              </div>
            ))}
          </div>
        )}

        <LaBolsaRota t={t} />
      </button>

      <div className="flex flex-col justify-center gap-1">
        {conBoton ? (
          <button onClick={onListo} disabled={ocupado}
                  className="w-full flex-1 min-h-[62px] rounded-xl bg-accent text-text-on-accent
                             text-[18px] font-extrabold tracking-tight flex items-center justify-center
                             gap-2 disabled:opacity-50">
            {ocupado ? '…' : <><Check size={20} strokeWidth={3.2} /> Listo</>}
          </button>
        ) : (
          <div className={`rounded-lg px-2.5 py-2.5 text-[14px] font-bold text-center
                           flex items-center justify-center gap-2 ${TONO_CLS[elTono(t, losMinutos(t))]}`}>
            {situacion === 'en_ruta' ? <Truck size={16} className="shrink-0" />
                                     : <Clock size={16} className="shrink-0" />}
            <span className="min-w-0">{loQuePasa(t, losMinutos(t))}</span>
          </div>
        )}
        {/* 🔴 «SE LO HA LLEVADO» (16/09). El del pase VE la bolsa salir por la
            puerta: es la única persona del sistema que lo sabe en ese instante,
            y hasta hoy no tenía dónde decirlo. Escribe sólo si está vacío, así
            que no pisa un aviso que hubiera llegado antes. */}
        {conRecogida && (
          <button onClick={onRecogido} disabled={ocupado}
                  className="w-full min-h-[46px] rounded-xl border-2 border-accent text-accent
                             text-[14.5px] font-extrabold flex items-center justify-center gap-2
                             disabled:opacity-50">
            <Truck size={16} strokeWidth={3} /> Se lo ha llevado
          </button>
        )}
        {rota && (
          <button onClick={onReimprimir} disabled={ocupado}
                  className="w-full min-h-[42px] rounded-xl bg-danger text-white text-[14px]
                             font-extrabold flex items-center justify-center gap-2 disabled:opacity-50">
            <Printer size={16} /> Reimprimir
          </button>
        )}
      </div>
    </article>
  )
}

export default function PaseBoard({ token, onCerrarAMano, onApagado }: {
  token: string
  onCerrarAMano?: () => void
  /** Se ha apagado el Pase desde aquí. La tablet vuelve a la pantalla de siempre. */
  onApagado?: () => void
}) {
  const [tablero, setTablero] = useState<ElTablero | null>(null)
  const [zona, setZona] = useState<Zona>('sigue_aqui')
  const [verIdas, setVerIdas] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  /** Qué pedido tiene la hoja abierta. `null` = ninguna. */
  const [hoja, setHoja] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // El apagado: `false` = ni preguntado. `true` = preguntando. Ver la hoja.
  const [preguntandoApagar, setPreguntandoApagar] = useState(false)
  const [apagando, setApagando] = useState(false)
  const vivo = useRef(true)

  const refrescar = useCallback(async () => {
    try {
      const t = await getTablero(token)
      if (vivo.current) setTablero(t)
    } catch (e) {
      // Un fallo de datos SÍ se ve: una pantalla de cocina que se queda quieta
      // sin decir nada es peor que una que dice que no puede.
      if (vivo.current) setAviso(String((e as { message?: string })?.message ?? e))
    }
  }, [token])

  useEffect(() => {
    vivo.current = true
    const tic = () => { void refrescar() }
    // La primera pasada sale del cuerpo del efecto a propósito: pintar el
    // estado dentro del efecto es lo que canta `react-hooks/set-state-in-effect`,
    // y la regla tiene razon --el primer refresco no tiene por que bloquear el
    // montaje--. Se difiere un tic y ya.
    const primero = setTimeout(tic, 0)
    const id = setInterval(tic, POLL_MS)
    return () => { vivo.current = false; clearTimeout(primero); clearInterval(id) }
  }, [refrescar])

  const porZona = useMemo(() => {
    const m: Record<Zona, TarjetaDelPase[]> = { sigue_aqui: [], en_ruta: [], entregados: [] }
    for (const t of tablero?.tarjetas ?? []) {
      const z = laZona(t)
      if (!z) continue
      if (z === 'entregados' && (losMinutos(t) ?? 0) > MINUTOS_EN_ENTREGADOS) continue
      // 🔴 A los 30 min, la del grupo 2 se va sola: de ella no va a llegar
      // ningún aviso nunca, así que sólo ocupa sitio delante de las que sí
      // esperan algo. NO se esconde: se cuentan abajo y se pueden ver.
      if (seVaSola(t)) continue
      m[z].push(t)
    }
    return m
  }, [tablero])

  // 🔴 EL TRABAJO EN CURSO. Lo que esta pantalla tiene entre manos es lo que
  // sigue en la cocina: si hay algo ahí, la tablet NO se recarga sola.
  useEffect(() => {
    const clave = 'pase'
    // 🔴 NO SE DECLARA HASTA SABER. Con `tablero == null` todavía no se ha
    // preguntado, y declarar 0 ahí es decirle al vigía de versión «no hay nada»
    // cuando puede haber cuatro comandas vivas. Ese tic es justo el mecanismo
    // del incidente del 11/09, sólo que de una décima.
    if (tablero == null) return
    declaraTrabajoEnCurso(clave, porZona.sigue_aqui.length)
    return () => declaraTrabajoEnCurso(clave, 0)
  }, [tablero, porZona.sigue_aqui.length])

  /**
   * LAS QUE SE HAN IDO SOLAS, que se cuentan y se pueden ver (regla 7). Un
   * umbral ordena; no esconde. Si desaparecieran en silencio, el del pase
   * aprendería que las bolsas se evaporan y dejaría de creerse la pantalla.
   */
  const idasSolas = useMemo(
    () => (tablero?.tarjetas ?? []).filter(t => seVaSola(t)),
    [tablero])

  /**
   * EL AVISO DE LA ZONA, UNA VEZ ARRIBA Y NO EN CADA TARJETA (16/09). La frase
   * es la misma para todas las del grupo 2, así que repetirla seis veces no
   * informa: hace ruido y empuja hacia abajo lo que sí cambia de una a otra.
   * Y sólo sale si en ESTA zona hay alguna del grupo 2.
   */
  const avisoDeLaZona = useMemo(() => {
    const delGrupo2 = porZona[zona].filter(t => !sabemosSuCiclo(t))
    if (delGrupo2.length === 0) return null
    const primeros = delGrupo2.map(t => loQueNoSabemos(t)).filter(Boolean) as string[]
    return primeros[0] ?? null
  }, [porZona, zona])

  /** ¿Hay algo que lleve de más? El contador avisa sin cambiar de pestaña. */
  const avisaEnRuta = porZona.en_ruta.some(t => elTono(t, losMinutos(t)) === 'aviso')
  const avisaAqui = porZona.sigue_aqui.some(
    t => elTono(t, losMinutos(t)) === 'aviso' || t.bolsa.estado === 'rota')

  const pulsarListo = async (t: TarjetaDelPase) => {
    setOcupado(t.sale_id); setAviso(null)
    try {
      await marcarListo(t.sale_id, token)
      await refrescar()
    } catch (e) {
      setAviso(`No se ha podido marcar: ${String((e as { message?: string })?.message ?? e)}`)
    } finally { setOcupado(null) }
  }

  /**
   * «Se lo ha llevado». Confirma con CONTENIDO y no con un visto (regla 8): se
   * dice la HORA que quedó escrita, que es lo que el del pase necesita poder
   * comprobar. Y si ya había una --porque el aviso llegó primero-- se dice
   * también, en vez de fingir que la acaba de poner él.
   */
  const pulsarRecogido = async (t: TarjetaDelPase) => {
    setOcupado(t.sale_id); setAviso(null)
    try {
      const yaLaTenia = t.handed_to_courier_at != null
      const hora = await marcarRecogido(t.sale_id, token)
      const hhmm = hora
        ? new Date(hora).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
        : null
      setAviso(
        hhmm == null ? 'Apuntado, pero sin hora: avisa.'
        : yaLaTenia  ? `Ya estaba apuntado a las ${hhmm}. No se ha cambiado.`
                     : `Apuntado: se lo han llevado a las ${hhmm}.`)
      await refrescar()
    } catch (e) {
      setAviso(`No se ha podido apuntar: ${String((e as { message?: string })?.message ?? e)}`)
    } finally { setOcupado(null) }
  }

  const pulsarReimprimir = async (t: TarjetaDelPase) => {
    setOcupado(t.sale_id); setAviso(null)
    try {
      const n = await reimprimirBolsa(t.sale_id, token)
      // Regla 8: confirma con CONTENIDO. Cero copias significa que este local
      // no tiene impresora de bolsa, y eso hay que decirlo, no tragárselo.
      setAviso(n > 0 ? `Bolsa pedida otra vez (${n} ${n === 1 ? 'copia' : 'copias'}).`
                     : 'No hay ninguna impresora de bolsa configurada en este local.')
      await refrescar()
    } catch (e) {
      setAviso(`No se ha podido reimprimir: ${String((e as { message?: string })?.message ?? e)}`)
    } finally { setOcupado(null) }
  }

  const actual = ZONAS.find(z => z.id === zona)!

  return (
    // `relative`: la hoja de detalle se coloca DENTRO del Pase, no encima de la
    // pantalla entera. Así la fila de pestañas de la estación --Pase, Pedidos,
    // Cocina-- sigue estando donde estaba y nadie se queda atrapado.
    <div className="h-full flex flex-col bg-page relative">
      <nav className="grid grid-cols-3 gap-1.5 p-2 bg-card border-b border-default shrink-0">
        {ZONAS.map(z => {
          const n = porZona[z.id].length
          const activa = z.id === zona
          const avisa = (z.id === 'en_ruta' && avisaEnRuta) || (z.id === 'sigue_aqui' && avisaAqui)
          return (
            <button key={z.id} onClick={() => setZona(z.id)}
                    className={`min-h-[44px] rounded-xl border text-[13px] font-extrabold uppercase
                                tracking-wide flex items-center justify-center gap-2 px-2
                                ${activa ? 'bg-accent text-text-on-accent border-accent'
                                         : 'bg-page text-text-secondary border-default'}`}>
              {z.nombre}
              <span className={`rounded-full px-2 py-0.5 tabular-nums text-[13px]
                                ${avisa ? 'bg-warning text-white'
                                        : activa ? 'bg-white/20' : 'bg-lavado text-text-primary/70'}`}>
                {n}
              </span>
            </button>
          )
        })}
      </nav>

      <p className="px-3 pt-1.5 text-[12px] text-text-tertiary shrink-0">{actual.pista}</p>

      {/* El aviso de la zona: una vez, arriba, y sólo si aquí hay del grupo 2. */}
      {avisoDeLaZona && (
        <p className="mx-3 mt-1.5 px-3 py-2 rounded-lg bg-accent-bg text-text-secondary
                      text-[12.5px] leading-snug shrink-0">{avisoDeLaZona}</p>
      )}

      {aviso && (
        <div className="mx-3 mt-1.5 px-3 py-2 rounded-lg bg-background-info text-text-info
                        text-[12.5px] flex items-center gap-2 shrink-0">
          <span className="min-w-0">{aviso}</span>
          <button onClick={() => setAviso(null)} className="ml-auto underline shrink-0">cerrar</button>
        </div>
      )}

      {/* 🔴 EL PIE DE LAS QUE SE FUERON SOLAS. La regla 7 en una línea: el
          umbral decide el ORDEN, nunca la EXISTENCIA. Se dice cuántas, y el
          «ver» las lista con su hora. */}
      {zona === 'sigue_aqui' && idasSolas.length > 0 && (
        <p className="mx-3 mt-1.5 px-3 py-2 rounded-lg bg-page border border-default
                      text-[12.5px] text-text-secondary shrink-0">
          <b className="tabular-nums">{idasSolas.length}</b>
          {idasSolas.length === 1 ? ' se fue sola' : ' se fueron solas'} a los {MINUTOS_PARA_IRSE_SOLA} min
          sin que nadie tocara{' · '}
          <button onClick={() => setVerIdas(v => !v)} className="underline font-bold">
            {verIdas ? 'ocultar' : 'ver'}
          </button>
          {verIdas && (
            <span className="block mt-1.5 pt-1.5 border-t border-default">
              {idasSolas.map(t => (
                <span key={t.sale_id} className="block">
                  {t.codigo ?? '—'} · {t.marca ?? 'sin marca'} · listo hace{' '}
                  <b className="tabular-nums">{losMinutos(t) ?? '—'} min</b>
                </span>
              ))}
            </span>
          )}
        </p>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pt-1.5 pb-2">
        {tablero == null ? (
          /* El primer pintado es SIEMPRE el estado de carga, nunca un tablero
             vacío: «no hay nada» y una décima después cuatro pedidos se paga en
             confianza, y la confianza es lo único que hace que la usen. */
          <p className="text-center text-text-tertiary text-[13px] py-8">Cargando…</p>
        ) : tablero.sin_instalar ? (
          <p className="text-center text-text-secondary text-[13px] py-7 border border-dashed
                        border-linea-fuerte rounded-xl leading-relaxed px-4">
            <b className="block text-text-primary mb-1">El Pase todavía no está instalado en este local.</b>
            La pantalla existe pero la base no la sirve aún. Si esto sigue aquí mañana,
            hay que decirlo: no es que no haya pedidos, es que no se han podido pedir.
          </p>
        ) : porZona[zona].length === 0 ? (
          <p className="text-center text-text-tertiary text-[13px] py-7 border border-dashed
                        border-linea-fuerte rounded-xl leading-relaxed">
            {zona === 'sigue_aqui' ? 'No queda nada en la cocina.'
             : zona === 'en_ruta'  ? 'No hay nada de camino.'
             : 'Las entregadas desaparecen a los 20 minutos. No hay nada que pulsar.'}
          </p>
        ) : (
          porZona[zona].map(t => (
            <Tarjeta key={t.sale_id} t={t} ocupado={ocupado === t.sale_id}
                     onAbrir={() => setHoja(t.sale_id)}
                     onListo={() => void pulsarListo(t)}
                     onRecogido={() => void pulsarRecogido(t)}
                     onReimprimir={() => void pulsarReimprimir(t)} />
          ))
        )}
      </div>

      {/* ── LA SALIDA ────────────────────────────────────────────────────────
          El respaldo del Pase no es un segundo botón de «Listo»: es el
          interruptor a `false`, que devuelve esta tablet a la pantalla de
          siempre sin perder un pedido. Y tiene que poder hacerlo la persona
          del pase, sin llamar a la oficina a las 21:00.

          🔴 DÓNDE VA, y las dos condiciones del encargo:
            · NO se puede pulsar sin querer → vive en el pie, en el borde
              opuesto al botón «Listo» (que está a la derecha de cada tarjeta),
              fuera de la barra de pestañas, en letra pequeña y sin color de
              acción. Y pregunta antes: un toque abre la hoja, no apaga.
            · DICE QUÉ VA A PASAR antes de hacerlo, con las palabras del
              encargo: «Vuelve la pantalla de siempre. No se pierde ningún
              pedido.» */}
      <div className="flex items-center px-3 py-1 bg-card border-t border-default shrink-0">
        <button onClick={() => setPreguntandoApagar(true)}
                className="text-[11.5px] text-text-tertiary underline underline-offset-2
                           min-h-[30px] px-1">
          Apagar el Pase
        </button>
      </div>

      {preguntandoApagar && (
        /* Sube desde abajo y tapa la pantalla: no se apaga de refilón. El botón
           de quedarse va PRIMERO y es el grande, porque es lo que se quiere el
           99 % de las veces que alguien abre esto por error. */
        <div className="fixed inset-0 z-50 bg-black/55 flex items-end"
             onClick={() => { if (!apagando) setPreguntandoApagar(false) }}>
          <div className="w-full bg-card rounded-t-2xl p-4" onClick={e => e.stopPropagation()}>
            <b className="block text-[17px] font-extrabold tracking-tight mb-1">
              ¿Apagar el Pase en este local?
            </b>
            <p className="text-[13.5px] leading-snug text-text-secondary mb-3.5">
              Vuelve la pantalla de siempre. <b className="text-text-primary">No se pierde
              ningún pedido.</b> El botón de «Listo» vuelve a estar en Pedidos, como antes.
              Para volver a encenderlo hace falta la oficina.
            </p>
            <div className="flex gap-2.5">
              <button onClick={() => setPreguntandoApagar(false)} disabled={apagando}
                      className="flex-1 min-h-[52px] rounded-xl bg-accent text-text-on-accent
                                 text-[15px] font-extrabold disabled:opacity-50">
                No, seguir en el Pase
              </button>
              <button disabled={apagando}
                      onClick={() => { void (async () => {
                        setApagando(true)
                        try {
                          const r = await apagarElPase(token)
                          // Regla 8: confirma con CONTENIDO, y dice la verdad
                          // también cuando no ha tenido que hacer nada.
                          setAviso(r.estaba
                            ? `Pase apagado en ${r.local ?? 'este local'}. Vuelve la pantalla de siempre.`
                            : `El Pase ya estaba apagado en ${r.local ?? 'este local'}.`)
                          setPreguntandoApagar(false)
                          onApagado?.()
                        } catch (e) {
                          setAviso(`No se ha podido apagar: ${(e as Error).message}. Sigue encendido.`)
                        } finally { setApagando(false) }
                      })() }}
                      className="min-w-[128px] min-h-[52px] px-3 rounded-xl border border-linea-fuerte
                                 bg-card text-text-secondary text-[14px] font-extrabold disabled:opacity-50">
                {apagando ? '…' : 'Sí, apagar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LA HOJA DE DETALLE. Va la última para quedar por encima de todo lo
          demás, y dentro del contenedor `relative` de arriba. */}
      {hoja && (
        <HojaDelPase key={hoja} saleId={hoja} token={token} onCerrar={() => setHoja(null)} />
      )}

      {/* El cerrar a mano vive FUERA de las tarjetas: es una excepción, no un paso. */}
      {onCerrarAMano && (
        <div className="flex items-center gap-2.5 px-3 py-1.5 bg-card border-t border-default shrink-0">
          <AlertTriangle size={16} className="text-text-tertiary shrink-0" />
          <span className="text-[12px] text-text-secondary min-w-0">
            El cliente no abre, el rider se queda sin batería… se cierra a mano y se apunta por qué.
          </span>
          <button onClick={onCerrarAMano}
                  className="ml-auto shrink-0 min-h-[38px] px-3 rounded-xl border border-linea-fuerte
                             bg-card text-text-secondary text-[12.5px] font-extrabold">
            Cerrar a mano
          </button>
        </div>
      )}
    </div>
  )
}
