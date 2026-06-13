// src/modules/kds/components/KdsBoard.tsx
//
// Tablero KDS reutilizable. El MISMO componente sirve con sesión (Shell) y con
// token (kiosco): si llega `token`, se pasa a todas las RPC. Cálculo en
// servidor (kds_board); el cliente solo pinta, refresca y manda bump/marcado.
//
// Refresco en vivo: Supabase Realtime (sale + kds_ticket_station_state) cuando
// hay sesión; SIEMPRE además polling cada 10 s como fallback (el kiosco con
// token no autentica Realtime por RLS → vive del polling). Sonido + resalte al
// entrar un ticket nuevo.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw, Volume2, VolumeX } from 'lucide-react'
import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import {
  getBoard, bump as bumpRpc, unbump as unbumpRpc, markLine as markLineRpc,
  type KdsBoard as KdsBoardData, type KdsLine,
} from '../services/kdsService'
import KdsTicketCard from './KdsTicketCard'
import CookModePanel from './CookModePanel'
import { playNewTicketSound } from '../kdsUtils'

const POLL_MS = 10_000
const NEW_HIGHLIGHT_MS = 6_000

interface KdsBoardProps {
  locationId: string
  token?: string | null
  /** id estación → nombre (con sesión). El kiosco puede no tenerlo. */
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

  const refresh = useCallback(async () => {
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
      firstLoadRef.current = false
      setBoard(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error cargando el tablero')
    } finally {
      setLoading(false)
    }
  }, [locationId, token])

  // Carga inicial + reinicio al cambiar de local/token.
  useEffect(() => {
    firstLoadRef.current = true
    knownIdsRef.current = new Set()
    setLoading(true)
    void refresh()
  }, [refresh])

  // Polling (siempre activo como fallback fiable).
  useEffect(() => {
    const id = window.setInterval(() => { void refresh() }, POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  // Realtime (solo con sesión: el kiosco con token no autentica por RLS).
  useEffect(() => {
    if (token) return
    if (!isSupabaseEnabled || !supabase) return
    const sb = supabase
    const ch = sb
      .channel(`kds-board-${locationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale' }, () => { void refresh() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kds_ticket_station_state' }, () => { void refresh() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kds_line_state' }, () => { void refresh() })
      .subscribe()
    return () => { void sb.removeChannel(ch) }
  }, [locationId, token, refresh])

  // ── Acciones (optimista local + RPC + refresh de reconciliación) ──────────

  const handleBump = useCallback(async (saleId: string, stationId: string) => {
    setBusy(true)
    try { await bumpRpc(saleId, stationId, token); await refresh() }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error al marcar la estación'); await refresh() }
    finally { setBusy(false) }
  }, [token, refresh])

  const handleUnbump = useCallback(async (saleId: string, stationId: string) => {
    setBusy(true)
    try { await unbumpRpc(saleId, stationId, token); await refresh() }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error al revertir la estación'); await refresh() }
    finally { setBusy(false) }
  }, [token, refresh])

  const handleMarkLine = useCallback(async (line: KdsLine) => {
    // Optimista: togglea el sombreado al instante; la RPC confirma/reconcilia.
    setBoard(prev => prev ? toggleLineMarked(prev, line.line_id) : prev)
    try { await markLineRpc(line.line_id, token) }
    catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al marcar el plato')
      await refresh()
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
            onClick={() => { void refresh() }}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
            title="Refrescar"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-lg bg-red-500/15 text-red-200 ring-1 ring-red-500/40 px-3 py-2 text-sm shrink-0">
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
                stationNames={stationNames}
                stationFilter={effectiveFilter}
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
