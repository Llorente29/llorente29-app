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
import { Check, Clock, Truck, Printer, AlertTriangle, User, Camera } from 'lucide-react'
import { declaraTrabajoEnCurso } from '@/services/trabajoEnCurso'
import {
  laZona, laSituacion, tieneBotonDeListo, loQuePasa, loQueNoSabemos,
  elSubtitulo, elTono, type Zona, type Tono,
} from './lib/lasTresZonas'
import {
  getTablero, marcarListo, reimprimirBolsa,
  type TarjetaDelPase, type ElTablero,
} from './services/paseService'

const POLL_MS = 10_000
/** Los entregados se van solos. No hay nada que pulsar. */
const MINUTOS_EN_ENTREGADOS = 20

const ZONAS: { id: Zona; nombre: string; pista: string }[] = [
  { id: 'sigue_aqui', nombre: 'Sigue aquí', pista: 'Lo que todavía está en la cocina. Un toque y se va.' },
  { id: 'en_ruta',    nombre: 'En ruta',    pista: 'Sólo lo que sabemos que ha salido. Aquí no se pulsa nada.' },
  { id: 'entregados', nombre: 'Entregados', pista: 'Sólo lo que sabemos que ha llegado. Se vacía sola.' },
]

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

/** El renglón de la bolsa. El HECHO, después; nunca una promesa antes. */
function LaBolsa({ t, onReimprimir }: { t: TarjetaDelPase; onReimprimir: () => void }) {
  if (t.bolsa.estado === 'sin_pedir') return null
  if (t.bolsa.estado === 'rota') {
    return (
      <p className="text-[12px] leading-snug text-danger font-semibold mt-1.5">
        La bolsa no ha salido. La impresora no contesta. El pedido se queda aquí hasta
        que haya papel: sin etiqueta, la bolsa no se puede dar.
        {t.bolsa.intentos > 0 && ` Intentado ${t.bolsa.intentos} ${t.bolsa.intentos === 1 ? 'vez' : 'veces'}.`}
      </p>
    )
  }
  return (
    <button onClick={onReimprimir}
            className="mt-1.5 text-[12px] text-text-tertiary hover:text-text-secondary text-left">
      {t.bolsa.estado === 'hecha' ? 'Bolsa impresa' : 'Bolsa pedida'}
      {t.bolsa.cuando && ` · ${t.bolsa.cuando}`} · <span className="underline">reimprimir</span>
    </button>
  )
}

/** CÓMO avanzó, no quién pulsó. El día que entre la foto, se añade un caso. */
function ComoAvanzo({ t }: { t: TarjetaDelPase }) {
  if (!t.avanzo_por) return null
  const Icono = t.avanzo_por === 'foto' ? Camera : t.avanzo_por === 'flota' ? Truck : User
  const texto =
    t.avanzo_por === 'foto'   ? `Comprobado por foto${t.avanzo_quien ? ` · ${t.avanzo_quien}` : ''}`
    : t.avanzo_por === 'flota' ? 'Lo dice la flota'
    : `Listo${t.avanzo_quien ? ` por ${t.avanzo_quien}` : ''}`
  return (
    <div className={`flex items-center gap-1.5 mt-1 text-[11.5px] ${
      t.avanzo_por === 'foto' ? 'text-text-info' : 'text-text-tertiary'}`}>
      <Icono size={13} className="shrink-0" /> {texto}
    </div>
  )
}

function Tarjeta({ t, ocupado, onListo, onReimprimir }: {
  t: TarjetaDelPase
  ocupado: boolean
  onListo: () => void
  onReimprimir: () => void
}) {
  const situacion = laSituacion(t)
  const conBoton = tieneBotonDeListo(t)
  const noSabemos = loQueNoSabemos(t)
  const rota = t.bolsa.estado === 'rota'

  return (
    <article className={`grid gap-2.5 items-stretch rounded-xl border p-2.5 mb-1.5
                         ${rota ? 'border-danger/40 bg-danger-bg/25' : 'border-default bg-card'}`}
             style={{ gridTemplateColumns: 'minmax(0,1fr) 240px' }}>
      <div className="min-w-0 flex flex-col justify-center">
        <div className="flex items-center gap-2">
          <Logo t={t} />
          <div className="min-w-0">
            <b className="block text-[16px] font-extrabold tracking-tight truncate">{t.marca ?? 'Sin marca'}</b>
            <i className="block not-italic text-[11.5px] font-semibold text-text-secondary truncate">
              {elSubtitulo(t)}
            </i>
          </div>
          <span className="ml-auto self-start text-[11px] text-text-tertiary tabular-nums shrink-0">
            {t.codigo ?? ''}
          </span>
        </div>

        {situacion === 'por_marcar' && t.lineas.length > 0 && (
          <div className="border-t border-lavado mt-1.5 pt-1.5">
            {t.lineas.map((l, i) => (
              <div key={i} className="flex gap-2 items-baseline">
                <b className="font-extrabold tabular-nums min-w-[20px]">{l.cantidad}×</b>
                <span className="text-text-primary/80 truncate">{l.nombre}</span>
              </div>
            ))}
          </div>
        )}

        {noSabemos && <p className="text-[12px] leading-snug text-text-secondary mt-1.5">{noSabemos}</p>}
        <LaBolsa t={t} onReimprimir={onReimprimir} />
        <ComoAvanzo t={t} />
      </div>

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
                           flex items-center justify-center gap-2 ${TONO_CLS[elTono(t, t.minutos)]}`}>
            {situacion === 'en_ruta' ? <Truck size={16} className="shrink-0" />
                                     : <Clock size={16} className="shrink-0" />}
            <span className="min-w-0">{loQuePasa(t, t.minutos)}</span>
          </div>
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

export default function PaseBoard({ token, onCerrarAMano }: {
  token: string
  onCerrarAMano?: () => void
}) {
  const [tablero, setTablero] = useState<ElTablero | null>(null)
  const [zona, setZona] = useState<Zona>('sigue_aqui')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
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
      if (z === 'entregados' && (t.minutos ?? 0) > MINUTOS_EN_ENTREGADOS) continue
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

  /** ¿Hay algo que lleve de más? El contador avisa sin cambiar de pestaña. */
  const avisaEnRuta = porZona.en_ruta.some(t => elTono(t, t.minutos) === 'aviso')
  const avisaAqui = porZona.sigue_aqui.some(
    t => elTono(t, t.minutos) === 'aviso' || t.bolsa.estado === 'rota')

  const pulsarListo = async (t: TarjetaDelPase) => {
    setOcupado(t.sale_id); setAviso(null)
    try {
      await marcarListo(t.sale_id, token)
      await refrescar()
    } catch (e) {
      setAviso(`No se ha podido marcar: ${String((e as { message?: string })?.message ?? e)}`)
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
    <div className="h-full flex flex-col bg-page">
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

      {aviso && (
        <div className="mx-3 mt-1.5 px-3 py-2 rounded-lg bg-background-info text-text-info
                        text-[12.5px] flex items-center gap-2 shrink-0">
          <span className="min-w-0">{aviso}</span>
          <button onClick={() => setAviso(null)} className="ml-auto underline shrink-0">cerrar</button>
        </div>
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
                     onListo={() => void pulsarListo(t)}
                     onReimprimir={() => void pulsarReimprimir(t)} />
          ))
        )}
      </div>

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
