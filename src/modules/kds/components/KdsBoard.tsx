// src/modules/kds/components/KdsBoard.tsx
//
// Tablero KDS reutilizable. El MISMO componente sirve con sesión (Shell) y con
// token (kiosco): si llega `token`, se pasa a todas las RPC. Cálculo en
// servidor (kds_board); el cliente solo pinta, refresca y manda bump/marcado.
//
// Refresco en vivo: Supabase Realtime (sale + kds_ticket_station_state) cuando
// hay sesión; SIEMPRE además polling como fallback (el kiosco con token no
// autentica Realtime por RLS → vive del polling). Sonido + resalte al entrar
// un ticket nuevo.
//
// fix/sondeo-adaptativo-tablet (13/08): el poll de 10s es el ritmo normal;
// sin cambios se aleja progresivamente hasta 60s (Tarea B1, ver
// BOARD_IDLE_MS) y vuelve al instante en el primer cambio real.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw, Volume2, VolumeX } from 'lucide-react'
import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { runPollingLoop, type RetryLoopHandle } from '@/lib/retryBackoff'
import {
  getBoard, bump as bumpRpc, unbump as unbumpRpc, markLine as markLineRpc,
  type KdsBoard as KdsBoardData, type KdsLine,
} from '../services/kdsService'
import KdsTicketCard from './KdsTicketCard'
import CookModePanel from './CookModePanel'
import { playNewTicketSound } from '../kdsUtils'

const POLL_MS = 10_000
const NEW_HIGHLIGHT_MS = 6_000
// fix/sondeo-adaptativo-tablet (13/08), Tarea B1: mismo ritmo que el feed de
// pedidos (misma fila de la tabla del encargo) — sin cambios ~5 min sube
// progresivamente hasta 60s; AL INSTANTE al primer cambio o toque en Refrescar.
const BOARD_IDLE_MS = 60_000
const BOARD_IDLE_AFTER = 30

// Huella de "qué se ve en el tablero": tickets vivos + estado de estaciones +
// marcado por plato. Sin campos que cambien solo por el reloj.
function boardFingerprint(data: KdsBoardData): string {
  return data.tickets
    .map(t => {
      const est = t.estaciones
        ? Object.entries(t.estaciones).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',')
        : ''
      const marks = t.lineas.map(l => `${l.line_id}:${l.marked ? 1 : 0}`).join(',')
      return `${t.sale_id}|${est}|${marks}`
    })
    .sort()
    .join(';')
}

interface KdsBoardProps {
  /** Local (sesión). En kiosco va null: la RPC deriva el local del token. */
  locationId: string | null
  token?: string | null
  /** id estación → nombre (respaldo de sesión). El board ya trae `stations`,
   *  que es la fuente principal (también sirve al kiosco sin sesión). */
  stationNames?: Record<string, string>
  /** Filtro manual de estación (selector de sesión). Prevalece sobre el del
   *  dispositivo si se pasa. null/undefined = sin override. */
  manualStationFilter?: string[] | null
}

interface CookTarget { menuItemId: string; qty: number; name: string }

export default function KdsBoard({
  locationId, token, stationNames = {}, manualStationFilter,
}: KdsBoardProps) {
  const [board, setBoard] = useState<KdsBoardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newIds, setNewIds] = useState<Set<string>>(new Set())
  const [soundOn, setSoundOn] = useState(true)
  const [cook, setCook] = useState<CookTarget | null>(null)

  // Refs para no recrear suscripciones / comparar entre refrescos.
  const knownIdsRef = useRef<Set<string>>(new Set())
  const firstLoadRef = useRef(true)
  const soundOnRef = useRef(soundOn)
  soundOnRef.current = soundOn
  const lastFingerprintRef = useRef<string | null>(null)
  const pollHandleRef = useRef<RetryLoopHandle | null>(null)

  // Devuelve si hubo trabajo (huella distinta) para el ritmo adaptativo
  // (Tarea B1). Relanza en fallo para que el backoff de fallo, ya existente
  // en runPollingLoop, también cubra este poll (antes no lo tenía).
  const refresh = useCallback(async (): Promise<boolean> => {
    let hadWork: boolean
    try {
      const data = await getBoard(locationId, token)
      setError(null)
      // Detección de tickets nuevos (sonido + resalte), salvo en la 1ª carga.
      const incoming = new Set(data.tickets.map(t => t.sale_id))
      if (!firstLoadRef.current) {
        const fresh = data.tickets.filter(t => !knownIdsRef.current.has(t.sale_id)).map(t => t.sale_id)
        if (fresh.length > 0) {
          if (soundOnRef.current) playNewTicketSound()
          setNewIds(prev => {
            const next = new Set(prev)
            fresh.forEach(id => next.add(id))
            return next
          })
          fresh.forEach(id => {
            window.setTimeout(() => {
              setNewIds(prev => { const n = new Set(prev); n.delete(id); return n })
            }, NEW_HIGHLIGHT_MS)
          })
        }
      }
      knownIdsRef.current = incoming
      const fp = boardFingerprint(data)
      hadWork = firstLoadRef.current || fp !== lastFingerprintRef.current
      lastFingerprintRef.current = fp
      firstLoadRef.current = false
      setBoard(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error cargando el tablero')
      setLoading(false)
      throw e
    }
    setLoading(false)
    return hadWork
  }, [locationId, token])

  // Carga inicial + poll adaptativo (Tarea B1). Un único bucle: runPollingLoop
  // ya hace el primer sondeo al crearse (no hace falta un refresh() aparte).
  useEffect(() => {
    firstLoadRef.current = true
    knownIdsRef.current = new Set()
    lastFingerprintRef.current = null
    setLoading(true)
    const handle = runPollingLoop({
      call: refresh,
      normalIntervalMs: POLL_MS,
      idleIntervalMs: BOARD_IDLE_MS,
      idleAfter: BOARD_IDLE_AFTER,
    })
    pollHandleRef.current = handle
    return () => { pollHandleRef.current = null; handle.cancel() }
  }, [refresh])

  // Realtime (solo con sesión: el kiosco con token no autentica por RLS).
  useEffect(() => {
    if (token) return
    if (!isSupabaseEnabled || !supabase) return
    const sb = supabase
    const wake = () => {
      if (pollHandleRef.current) pollHandleRef.current.wake()
      else void refresh().catch(() => {})
    }
    const ch = sb
      .channel(`kds-board-${locationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale' }, wake)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kds_ticket_station_state' }, wake)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kds_line_state' }, wake)
      .subscribe()
    return () => { void sb.removeChannel(ch) }
  }, [locationId, token, refresh])

  // ── Acciones (optimista local + RPC + refresh de reconciliación) ──────────

  const handleBump = useCallback(async (saleId: string, stationId: string) => {
    setBusy(true)
    try { await bumpRpc(saleId, stationId, token) }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error al marcar la estación') }
    try { await refresh() } catch { /* runPollingLoop reintentará */ }
    setBusy(false)
  }, [token, refresh])

  const handleUnbump = useCallback(async (saleId: string, stationId: string) => {
    setBusy(true)
    try { await unbumpRpc(saleId, stationId, token) }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error al revertir la estación') }
    try { await refresh() } catch { /* runPollingLoop reintentará */ }
    setBusy(false)
  }, [token, refresh])

  const handleMarkLine = useCallback(async (line: KdsLine) => {
    // Optimista: togglea el sombreado al instante; la RPC confirma/reconcilia.
    setBoard(prev => prev ? toggleLineMarked(prev, line.line_id) : prev)
    try { await markLineRpc(line.line_id, token) }
    catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al marcar el plato')
      try { await refresh() } catch { /* runPollingLoop reintentará */ }
    }
  }, [token, refresh])

  const handleOpenCook = useCallback((line: KdsLine) => {
    if (!line.menu_item_id) {
      setError('Este plato no tiene ficha técnica vinculada (sin menu_item).')
      return
    }
    setCook({ menuItemId: line.menu_item_id, qty: line.qty, name: line.name })
  }, [])

  const effectiveFilter = manualStationFilter ?? board?.station_filter ?? null
  const tickets = board?.tickets ?? []

  // Nombres de estación: el board manda (kiosco sin sesión incluido); el prop
  // de sesión es respaldo si el board aún no trajo el bloque.
  const resolvedStationNames = useMemo(() => {
    const m: Record<string, string> = { ...stationNames }
    for (const s of board?.stations ?? []) m[s.id] = s.name
    return m
  }, [board, stationNames])

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100">
      {/* Barra de estado del tablero */}
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          {loading
            ? <><Loader2 size={15} className="animate-spin" /> Cargando…</>
            : <span><span className="text-zinc-100 font-semibold">{tickets.length}</span> pedidos en cocina</span>}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSoundOn(s => !s)}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
            title={soundOn ? 'Silenciar avisos' : 'Activar avisos'}
          >
            {soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button
            onClick={() => pollHandleRef.current?.wake()}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
            title="Refrescar"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-lg bg-[#E0492E]/15 text-[#F8C5B8] ring-1 ring-[#E0492E]/40 px-3 py-2 text-sm shrink-0">
          {error}
        </div>
      )}

      {/* Tablero */}
      <div className="flex-1 overflow-y-auto p-4">
        {!loading && tickets.length === 0 ? (
          <div className="h-full grid place-items-center text-center text-zinc-600">
            <div>
              <p className="text-2xl font-semibold text-zinc-400">Cocina al día</p>
              <p className="text-sm mt-1">No hay pedidos pendientes.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
            {tickets.map(ticket => (
              <KdsTicketCard
                key={ticket.sale_id}
                ticket={ticket}
                stationNames={resolvedStationNames}
                stationFilter={effectiveFilter}
                expoStationId={board?.expo_station_id ?? null}
                isNew={newIds.has(ticket.sale_id)}
                busy={busy}
                onBump={handleBump}
                onUnbump={handleUnbump}
                onMarkLine={handleMarkLine}
                onOpenCook={handleOpenCook}
              />
            ))}
          </div>
        )}
      </div>

      <CookModePanel target={cook} onClose={() => setCook(null)} token={token} locationId={locationId} />
    </div>
  )
}

// Togglea marked de una línea en el estado local (inmutable) para el optimista.
function toggleLineMarked(board: KdsBoardData, lineId: string): KdsBoardData {
  return {
    ...board,
    tickets: board.tickets.map(t => ({
      ...t,
      lineas: t.lineas.map(l => l.line_id === lineId ? { ...l, marked: !l.marked } : l),
    })),
  }
}
