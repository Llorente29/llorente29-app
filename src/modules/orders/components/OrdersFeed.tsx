// src/modules/orders/components/OrdersFeed.tsx
//
// El FEED de pedidos (lente "por pedido"). Rebrand 30/06/2026 — tema CLARO
// (gestión moderna tipo Otter/Deliverect): panel blanco, filtros en píldoras de
// tinta, contadores en Space Grotesk, kanban claro.
//
//   - Toggle CUADRÍCULA / POR ESTADO (kanban), filtros, contadores, polling + realtime.
//   - Sonido al entrar cualquier pedido nuevo accionable.
//   - RUTA COMPLETA: avanza el pedido vía advanceOrder (set_order_status). El empuje
//     al canal lo dispara el trigger trg_sale_push_status.
//   - ESCANDALLO: pulsar un plato con receta abre el Cook Mode (panel del KDS).
//   - MARCAR LÍNEA: check por plato (kds_mark_line, compartido con el KDS).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGrid, Columns3, RefreshCw, Volume2, VolumeX } from 'lucide-react'
import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { runPollingLoop, type RetryLoopHandle } from '@/lib/retryBackoff'
import { playNewTicketSound } from '@/modules/kds/kdsUtils'
import { markLine as kdsMarkLine } from '@/modules/kds/services/kdsService'
import CookModePanel from '@/modules/kds/components/CookModePanel'
import {
  getOrdersFeed, advanceOrder, reprintOrder, isTerminalStatus, getKitchenBanner, DEFAULT_KITCHEN_THRESHOLDS,
  type OrderFeedItem, type OrderFeedLine, type OrderStatus,
  type KitchenDayBanner, type KitchenThresholds,
} from '../services/ordersFeedService'
import {
  laFase, ordenDeLaFase, elDistintivoDeLaTarjeta, LAS_FASES,
  losMinutosDeLaTarjeta, elNivelDeLaTarjeta,
  elRotulo, elRotuloVacio, HORAS_QUE_TRAE_LA_TABLET,
  type Fase,
} from '../lib/lasFases'
import OrderCard from './OrderCard'
import KitchenDayBannerBar from './KitchenDayBanner'
import ClosuresChip from '@/modules/kds/components/ClosuresChip'
import { declaraTrabajoEnCurso } from '@/services/trabajoEnCurso'
import ClosureAnomalyAlarm from '@/modules/kds/components/ClosureAnomalyAlarm'

const POLL_MS = 10_000
// fix/sondeo-adaptativo-tablet (13/08), Tarea B1: sin cambios ~5 min (30
// ciclos a 10s) sube progresivamente hasta 60s; vuelve a los 10s AL INSTANTE
// en cuanto cambie algo (pedido nuevo, cambio de estado) o alguien toque
// "Actualizar" (ver wake()).
const FEED_IDLE_MS = 60_000
const FEED_IDLE_AFTER = 30

// Huella de "qué se ve en pantalla" para decidir si el poll trajo trabajo.
// Deliberadamente SIN `minutos` (cuenta atrás viva, cambia solo por el
// reloj) — solo lo que de verdad importa para el pase: qué pedidos hay y en
// qué estado/hito de reparto están.
function feedFingerprint(orders: OrderFeedItem[]): string {
  return orders
    .map(o => `${o.sale_id}:${o.order_status}:${o.delivery_state ?? ''}:${o.ready_at ?? ''}:${o.delivered_at ?? ''}`)
    .sort()
    .join('|')
}

type ViewKey = 'grid' | 'kanban'

interface CookTarget { menuItemId: string; qty: number; name: string }

// ── LAS PESTAÑAS SON TRES, MÁS INCIDENCIAS (15/09/2026) ────────────────────
//
// Antes eran cinco --Activos · Nuevos · En curso · Cerrados · Incidencias-- y
// se filtraban SÓLO por `order_status`, que es el estado que mueven cuatro
// caminos distintos. Ahora la fase la decide `lasFases.laFase`, que mira el
// SELLO DE COCINA (`ready_at`, un solo escritor en toda la base) y el cierre.
//
// Se retiran dos:
//   «Activos» era la suma de las dos primeras y no contestaba a nada.
//   «Nuevos» está vacío el 99,7 % del tiempo --mediana entrada→aceptado 1,22 s,
//   y sólo 10 de 3.122 pasan de 30 s--: una pestaña que casi siempre está a
//   cero enseña a no mirarla.
//
// 🔴 Y el rótulo NO se escribe aquí: sale de `elRotulo`, que es el único sitio
// donde viven estas palabras en todo el módulo (§3 del encargo). Es una función
// y no un objeto porque «Terminados» lleva dentro el periodo que cubre cuando
// la pantalla no cubre el día entero — la tablet.

// Semáforo de columnas kanban (marca nueva): verde fresco / ámbar en curso / tinta por aceptar.
const KANBAN: { key: string; label: string; dot: string; match: (s: OrderStatus) => boolean }[] = [
  { key: 'new',   label: 'Por aceptar',      dot: '#15171A', match: s => ['new','received'].includes(s) },
  { key: 'prep',  label: 'En preparación',   dot: '#C2890F', match: s => ['accepted','in_preparation'].includes(s) },
  { key: 'ready', label: 'Listos / reparto', dot: '#1F9D6B', match: s => ['awaiting_collection','awaiting_shipment','in_delivery'].includes(s) },
]

interface OrdersFeedProps {
  locationId: string
  token?: string | null
  accountId?: string | null
  /** Con el Pase encendido, aquí se mira y no se marca listo. Ver `OrderCard`. */
  sinMarcarListo?: boolean
}

export default function OrdersFeed({ locationId, token, accountId, sinMarcarListo = false }: OrdersFeedProps) {
  // La tablet es la que entra POR TOKEN. La oficina entra con sesión. No hay
  // que inventar una prop nueva: la puerta por la que se entra ya lo dice.
  const esTablet = Boolean(token)
  // Cuántas horas tiene delante ESTA pantalla. La tablet, dos --es lo que trae
  // `orders_feed_by_token`--; la oficina, el día de negocio entero, y por eso
  // no declara alcance ninguno.
  const laVentana = esTablet ? HORAS_QUE_TRAE_LA_TABLET : null
  const [orders, setOrders] = useState<OrderFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewKey>('grid')
  // «En curso» abre por defecto: es la pregunta de quien está cocinando.
  const [filter, setFilter] = useState<Fase>('en_curso')
  const [soundOn, setSoundOn] = useState(true)
  const [cook, setCook] = useState<CookTarget | null>(null)
  const [banner, setBanner] = useState<KitchenDayBanner | null>(null)
  // "Ahora" para el reloj vivo del chip de cocina: UN tick por minuto para todas las
  // tarjetas (no un setInterval por tarjeta). El polling del feed también re-renderiza.
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  const knownIds = useRef<Set<string>>(new Set())
  const firstLoad = useRef(true)
  const soundRef = useRef(true)
  soundRef.current = soundOn
  const lastFingerprintRef = useRef<string | null>(null)
  const pollHandleRef = useRef<RetryLoopHandle | null>(null)

  // Devuelve si hubo trabajo (huella distinta a la última vez) para que
  // runPollingLoop pueda alejar el ritmo cuando el pase lleva rato quieto
  // (Tarea B1). Un fallo se RELANZA (no se traga) para que el backoff de
  // fallo, ya existente, también aplique aquí — antes este poll no lo tenía.
  const refresh = useCallback(async (): Promise<boolean> => {
    let hadWork: boolean
    try {
      const res = await getOrdersFeed(locationId, token)
      const next = res.orders ?? []
      if (soundRef.current && !firstLoad.current) {
        const fresh = next.some(o => !knownIds.current.has(o.sale_id) && !isTerminalStatus(o.order_status))
        if (fresh) playNewTicketSound()
      }
      knownIds.current = new Set(next.map(o => o.sale_id))
      const fp = feedFingerprint(next)
      hadWork = firstLoad.current || fp !== lastFingerprintRef.current
      lastFingerprintRef.current = fp
      firstLoad.current = false
      setOrders(next)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error cargando los pedidos')
      setLoading(false)
      throw e
    }
    setLoading(false)
    // Banner del día (KPI cocina): best-effort, no bloquea ni rompe el feed. Pero NO
    // silencioso: un fallo aquí (p. ej. RPC caída) debe ser diagnosticable en consola.
    try {
      setBanner(await getKitchenBanner(locationId, token))
    } catch (e) {
      console.warn('[KPI cocina] banner no cargó:', e)
    }
    return hadWork
  }, [locationId, token])

  const advance = useCallback(async (saleId: string, next: OrderStatus) => {
    // Optimista: pinta el nuevo estado al instante (la Estación vive de polling,
    // sin realtime; el toque "Listo" tiene que responder ya). Reconcilia el polling.
    setOrders(prev => prev.map(o => (o.sale_id === saleId ? { ...o, order_status: next } : o)))
    try {
      await advanceOrder(saleId, next, token)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar el pedido')
    } finally {
      // Confirma el éxito o REVIERTE el pintado optimista con la verdad del feed
      // (si la RPC falló, el servidor conserva el estado anterior). Un fallo del
      // propio refresh no debe volver a pisar el mensaje de error de arriba —
      // el próximo ciclo del poll ya lo reintenta con su propio backoff.
      void refresh().catch(() => { /* runPollingLoop reintentará */ })
    }
  }, [refresh, token])

  // Reimpresión: encola los tickets del pedido a las impresoras del local. Con
  // token (Estación) sale por la puerta by-token. Devuelve el nº de jobs (0 = el
  // local no tiene impresoras). No refresca: no cambia el estado del pedido.
  const reprint = useCallback(async (saleId: string, docType?: string): Promise<number> => {
    return reprintOrder(saleId, token, docType)
  }, [token])

  const openRecipe = useCallback((line: OrderFeedLine) => {
    if (!line.menu_item_id) return
    setCook({ menuItemId: line.menu_item_id, qty: line.qty, name: line.name })
  }, [])

  const markLineHandler = useCallback(async (lineId: string) => {
    try {
      await kdsMarkLine(lineId, token)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo marcar la línea')
      return
    }
    try { await refresh() } catch { /* runPollingLoop reintentará */ }
  }, [refresh, token])

  // Carga inicial + poll adaptativo (Tarea B1). Un único bucle: runPollingLoop
  // ya hace el primer sondeo al crearse, así que no hace falta un refresh()
  // aparte al montar (evitaría una doble llamada).
  useEffect(() => {
    firstLoad.current = true
    knownIds.current = new Set()
    lastFingerprintRef.current = null
    setLoading(true)
    const handle = runPollingLoop({
      call: refresh,
      normalIntervalMs: POLL_MS,
      idleIntervalMs: FEED_IDLE_MS,
      idleAfter: FEED_IDLE_AFTER,
    })
    pollHandleRef.current = handle
    return () => { pollHandleRef.current = null; handle.cancel() }
  }, [refresh])

  // Reloj vivo del chip de cocina: UN tick por minuto para todas las tarjetas.
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (token) return
    if (!isSupabaseEnabled || !supabase) return
    const ch = supabase
      .channel(`orders-feed-${locationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale' }, () => {
        if (pollHandleRef.current) pollHandleRef.current.wake()
        else void refresh().catch(() => {})
      })
      .subscribe()
    return () => { void supabase!.removeChannel(ch) }
  }, [locationId, token, refresh])

  // La fase de cada pedido, UNA vez por ciclo. De aquí salen las cuatro
  // pestañas, los cuatro contadores y lo que se pinta: así no puede haber un
  // contador que diga 3 y una lista que enseñe 4.
  //
  // Depende de `nowMs` --el tic del minuto-- porque una de las cuatro
  // condiciones es de tiempo: un pedido abierto cruza a incidencia a las 6
  // horas él solo, sin que llegue nada nuevo del servidor.
  const porFase = useMemo(() => {
    const ahora = new Date(nowMs)
    const mapa: Record<Fase, OrderFeedItem[]> = {
      en_curso: [], esperando: [], terminado: [], incidencia: [],
    }
    for (const o of orders) mapa[laFase(o, ahora)].push(o)
    for (const f of LAS_FASES) mapa[f].sort(ordenDeLaFase(f))
    return mapa
  }, [orders, nowMs])

  const counts = useMemo(() => ({
    en_curso: porFase.en_curso.length,
    esperando: porFase.esperando.length,
    incidencias: porFase.incidencia.length,
  }), [porFase])

  // 01/09 — «NUNCA EN MITAD DE UN PEDIDO». La tablet se recarga sola cuando hay
  // versión nueva, y esta es la pantalla que sabe si es buen momento. Declara
  // lo que tiene abierto; el vigía de versión solo pregunta, no sabe qué es un
  // pedido.
  //
  // Se cuenta lo que está EN CURSO y lo que ESPERA AL REPARTIDOR: las dos son
  // trabajo vivo. Las incidencias NO: una puede quedarse abierta horas
  // esperando a una plataforma, y contarla bloquearía la recarga para siempre
  // — que es como no tener recarga. (Antes eran «nuevos + en curso»; es el
  // mismo conjunto con la taxonomía nueva.)
  useEffect(() => {
    const clave = `orders:${locationId ?? 'consolidado'}`
    declaraTrabajoEnCurso(clave, counts.en_curso + counts.esperando)
    return () => declaraTrabajoEnCurso(clave, 0)
  }, [locationId, counts.en_curso, counts.esperando])

  const filtered = porFase[filter]

  // 🔴 LA VISTA EFECTIVA, no la guardada. Si el conmutador desaparece con
  // `view` ya en 'kanban' --una tablet que venía de la pantalla anterior, o un
  // navegador con la pestaña abierta durante el despliegue-- quedaría el modo
  // tres columnas SIN botón para salir de él. Se decide al pintar.
  const vistaEfectiva: ViewKey = esTablet ? 'grid' : view

  // 🔴 EL KANBAN NO SE FILTRA POR PESTAÑA, y es por coherencia, no por pereza.
  // Sus tres columnas se reparten por `order_status`; ponerles encima el filtro
  // de una fase dejaría dos columnas vacías POR CONSTRUCCIÓN --en «En curso» no
  // hay nada que esté en «Listos / reparto»--, y una columna que no puede tener
  // nada no es una columna vacía: es una columna mentirosa.
  //
  // Así que en la oficina el kanban sigue enseñando lo mismo que enseñaba antes
  // de este cambio: lo vivo. Se retira de la tablet, que es lo que pedía el
  // encargo; aquí no se toca.
  const paraPintar = vistaEfectiva === 'kanban'
    ? [...porFase.en_curso, ...porFase.esperando]
    : filtered

  // Umbrales del local para el chip de cocina: del banner; reserva = defaults.
  const thresholds: KitchenThresholds = banner?.config ?? DEFAULT_KITCHEN_THRESHOLDS

  const toggleSound = () => {
    setSoundOn(prev => {
      const nv = !prev
      if (nv) playNewTicketSound()
      return nv
    })
  }

  return (
    <>
      <div className="rounded-2xl overflow-hidden border border-default bg-card text-text-primary flex flex-col h-[calc(100vh-9rem)] min-h-[520px]">
        {/* Cabecera */}
        <div className="flex items-center gap-4 px-5 py-3.5 border-b border-default">
          <div className="flex items-baseline gap-3 flex-1 min-w-0">
            <h1 className="font-display font-semibold text-[22px] leading-none tracking-tight">Pedidos</h1>
          </div>
          <div className="hidden sm:flex gap-4 text-text-secondary">
            <span className="flex items-baseline gap-1.5"><b className="font-display text-[19px] tabular-nums text-text-primary">{counts.en_curso}</b><span className="text-[11px] uppercase tracking-wide">en curso</span></span>
            <span className="flex items-baseline gap-1.5"><b className="font-display text-[19px] tabular-nums text-text-primary">{counts.esperando}</b><span className="text-[11px] uppercase tracking-wide">esperando</span></span>
            {counts.incidencias > 0 && (
              <span className="flex items-baseline gap-1.5"><b className="font-display text-[19px] tabular-nums text-danger">{counts.incidencias}</b><span className="text-[11px] uppercase tracking-wide">incidencias</span></span>
            )}
          </div>
          <button
            onClick={toggleSound}
            title={soundOn ? 'Sonido activado · tocar para silenciar' : 'Sonido silenciado · tocar para activar'}
            className={`p-2 rounded-lg border ${soundOn ? 'bg-page text-text-primary border-default' : 'bg-card text-text-secondary border-default'}`}
          >
            {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button onClick={() => pollHandleRef.current?.wake()} title="Actualizar" className="p-2 rounded-lg bg-card text-text-secondary border border-default hover:text-text-primary hover:bg-page">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          {/* 🔴 «POR ESTADO» NO EXISTE EN LA TABLET (§5.3 del encargo).
              Medido el pico simultáneo de 7 días: Alcalá 21 en cocina + 12
              esperando, Carabanchel 20 + 20. En tres columnas eso son hasta 41
              tarjetas a la vez en una pantalla de 7 pulgadas, y por eso nadie
              lo usa. No se arregla el modo: se quita de donde estorba.
              En la oficina --pantalla grande, sesión, sin token-- se queda. */}
          {!esTablet && (
            <div className="flex bg-accent-bg rounded-xl p-0.5 gap-0.5">
              <button onClick={() => setView('grid')} className={`px-3 py-1.5 rounded-lg text-[13px] font-bold flex items-center gap-1.5 ${view === 'grid' ? 'bg-card text-text-primary shadow-sm' : 'text-text-secondary'}`}><LayoutGrid size={15} /> Cuadrícula</button>
              <button onClick={() => setView('kanban')} className={`px-3 py-1.5 rounded-lg text-[13px] font-bold flex items-center gap-1.5 ${view === 'kanban' ? 'bg-card text-text-primary shadow-sm' : 'text-text-secondary'}`}><Columns3 size={15} /> Por estado</button>
            </div>
          )}
        </div>

        {/* Filtros */}
        <div className="flex gap-1.5 px-5 py-3 border-b border-default overflow-x-auto">
          {LAS_FASES.map(k => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3.5 py-2 rounded-full text-[13.5px] font-bold whitespace-nowrap flex items-center gap-2 ${filter === k ? 'bg-accent text-text-on-accent' : 'text-text-secondary hover:text-text-primary'}`}
            >
              {elRotulo(k, laVentana)}
              <span className={`text-[11px] font-extrabold px-1.5 py-px rounded-full tabular-nums ${filter === k ? 'bg-white/20 text-text-on-accent' : 'bg-accent-bg text-text-secondary'}`}>{porFase[k].length}</span>
            </button>
          ))}
        </div>

        {/* Escalada: cierre de marca OLVIDADO (indefinido >24h o vencido) —
            banner rojo, mismo patrón que KdsAlarmOverlay. Cierre correcto
            con hora NUNCA dispara esto (eso es el chip discreto de abajo). */}
        <ClosureAnomalyAlarm accountId={accountId} token={token} locationId={locationId} variant="inline" />

        {/* Banner del día (KPI cocina) — colectivo, siempre visible arriba. */}
        {banner && (
          <div className="px-5 pt-3 bg-page">
            <KitchenDayBannerBar banner={banner} />
          </div>
        )}

        {/* Chip discreto: qué está cerrado ahora mismo (local/marcas), tocar
            para ver/reabrir sin salir de Pedidos. Nada si no hay nada cerrado. */}
        <ClosuresChip accountId={accountId} locationId={locationId} token={token} />

        {/* Cuerpo */}
        <div className="flex-1 overflow-y-auto p-5 bg-page">
          {error && (
            <div className="text-danger bg-danger-bg border border-danger/30 rounded-xl px-4 py-3 text-sm mb-4">{error}</div>
          )}

          {loading && orders.length === 0 ? (
            <div className="grid place-items-center h-[50vh] text-text-secondary">Cargando pedidos…</div>
          ) : paraPintar.length === 0 ? (
            <div className="grid place-items-center h-[50vh] text-center text-text-secondary">
              <div>
                {/* La frase dice qué pestaña está vacía, no «sin pedidos»: en
                    «Esperando repartidor» vacío es una buena noticia y en
                    «En curso» vacío es que no hay nada que cocinar. */}
                <div className="font-display text-[22px] text-text-primary mb-2">
                  {vistaEfectiva === 'kanban' ? 'Nada vivo ahora mismo.' : elRotuloVacio(filter, laVentana)}
                </div>
                <div className="text-sm">Entran solos en cuanto lleguen.</div>
              </div>
            </div>
          ) : vistaEfectiva === 'grid' ? (
            <div className="grid gap-4 items-start" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
              {filtered.map(o => {
                // El reloj de la tarjeta lo decide la FASE, no la RPC: en «En
                // curso» los minutos desde que entró (y el semáforo de cocina),
                // y en las demás los de la situación con el ámbar de los 20.
                const minutosDeLaFase = losMinutosDeLaTarjeta(o, filter, new Date(nowMs))
                return <OrderCard key={o.sale_id} order={o} allowGrow onAdvance={advance} onOpenRecipe={openRecipe} onMarkLine={markLineHandler} onReprint={reprint} thresholds={thresholds} nowMs={nowMs} sinMarcarListo={sinMarcarListo} distintivo={elDistintivoDeLaTarjeta(o, filter)} minutosDeLaFase={minutosDeLaFase} nivelDeLaFase={elNivelDeLaTarjeta(o, filter, minutosDeLaFase)} />
              })}
            </div>
          ) : (
            <div className="grid gap-4 h-full" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {KANBAN.map(col => {
                const list = paraPintar.filter(o => col.match(o.order_status))
                return (
                  <div key={col.key} className="bg-card border border-default rounded-2xl flex flex-col min-h-0">
                    <div className="px-4 py-3 border-b border-default flex items-center gap-2.5 font-extrabold text-[14px] text-text-primary">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col.dot }} />
                      {col.label}
                      <span className="ml-auto bg-accent-bg text-text-secondary text-[12px] font-extrabold px-2 py-px rounded-full tabular-nums">{list.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 bg-page">
                      {list.map(o => <OrderCard key={o.sale_id} order={o} allowGrow={false} onAdvance={advance} onOpenRecipe={openRecipe} onMarkLine={markLineHandler} onReprint={reprint} thresholds={thresholds} nowMs={nowMs} sinMarcarListo={sinMarcarListo} />)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Cook Mode (reusa el panel del KDS) — sesión, sin token */}
      <CookModePanel target={cook} onClose={() => setCook(null)} token={token} locationId={locationId} />
    </>
  )
}
