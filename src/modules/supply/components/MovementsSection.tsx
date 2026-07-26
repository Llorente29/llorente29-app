// src/modules/supply/components/MovementsSection.tsx
//
// AL1 — Frente ① Movimientos: el libro mayor del almacén.
// Histórico del ledger (con referencia legible por movimiento) + las tres
// acciones que lo alimentan: entrada directa, traspaso entre locales y merma.
//
// ── BÚSQUEDA EN SERVIDOR + PAGINACIÓN HONESTA (26/07/2026) ──────────────────
// Esta pantalla llegó a hacer creer que el almacén no registraba los consumos:
// buscar "pan hambur" devolvía 1 movimiento de los ~30 que había. El texto se
// filtraba en el navegador sobre las 300 filas ya descargadas, mientras el
// contador de arriba ("3287 movimientos") venía del servidor. Total correcto,
// filas incompletas y ninguna señal de que faltaban: la trampa perfecta.
//
// Ahora:
//   · el texto viaja a la RPC (con el tipo y el rango, que ya iban) y se aplica
//     antes de contar y de paginar;
//   · la cabecera dice "31 de 3287" cuando hay búsqueda, y las entradas/salidas
//     de esa búsqueda si todas comparten unidad;
//   · el pie dice cuántas filas se están viendo de cuántas hay, con "Cargar
//     más". Nunca se muestra un subconjunto sin decirlo.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, ArrowLeftRight, Trash2, RefreshCw, Search, X, ChevronDown } from 'lucide-react'
import { fmtInt } from '@/lib/format'
import type { SupplyLocation } from '@/modules/supply/services/supplierCatalogService'
import {
  listMovements, MOVEMENT_FILTERS, movementLabel,
  type MovementRow, type MovementsPage,
} from '@/modules/supply/services/movementsService'
import MovementActionModal, { type MovementKind } from '@/modules/supply/components/MovementActionModal'

type RangeKey = 'today' | '7d' | '30d' | 'month' | 'all'
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Hoy' }, { key: '7d', label: '7 días' },
  { key: '30d', label: '30 días' }, { key: 'month', label: 'Este mes' }, { key: 'all', label: 'Todo' },
]
function rangeFor(key: RangeKey): { from: string | null; to: string | null } {
  const now = new Date()
  const sod = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
  const iso = (d: Date) => d.toISOString()
  const tomorrow = sod(new Date(now.getTime() + 86400000))
  switch (key) {
    case 'today': return { from: iso(sod(now)), to: iso(tomorrow) }
    case '7d': return { from: iso(sod(new Date(now.getTime() - 6 * 86400000))), to: iso(tomorrow) }
    case '30d': return { from: iso(sod(new Date(now.getTime() - 29 * 86400000))), to: iso(tomorrow) }
    case 'month': return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(tomorrow) }
    case 'all': return { from: null, to: null }
  }
}

// Cuántas filas se piden por tirada. Antes se pedían 300 de una vez y ahí
// terminaba todo lo que el usuario podía llegar a ver.
const PAGE_SIZE = 100
// Espera antes de consultar mientras se teclea (la búsqueda ya no es local).
const SEARCH_DEBOUNCE_MS = 300

const fmtEur = (v: number | null) => v == null ? '—' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)
const fmtQty = (v: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(v)
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

function typeChipClass(type: string): string {
  if (type === 'recepcion' || type === 'traspaso_entrada') return 'bg-success-bg text-success'
  if (type === 'merma') return 'bg-danger-bg text-danger'
  if (type === 'ajuste' || type === 'apertura' || type === 'recuento') return 'bg-warning-bg text-warning'
  return 'bg-page text-text-secondary'
}

const EMPTY: MovementsPage = { total: 0, totalAll: 0, sumIn: 0, sumOut: 0, units: [], items: [] }

export default function MovementsSection({
  accountId, locationId, locations, actorId, actorName, onError, onFlash,
}: {
  accountId: string
  locationId: string | null
  locations: SupplyLocation[]
  actorId: string | null
  actorName: string | null
  onError: (m: string) => void
  onFlash: (m: string) => void
}) {
  const [filterKey, setFilterKey] = useState('all')
  const [rangeKey, setRangeKey] = useState<RangeKey>('30d')
  const [q, setQ] = useState('')            // lo que se está tecleando
  const [qApplied, setQApplied] = useState('')  // lo que se ha consultado
  const [page, setPage] = useState<MovementsPage>(EMPTY)
  const [rows, setRows] = useState<MovementRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  const [modalKind, setModalKind] = useState<MovementKind | null>(null)

  const types = useMemo(() => MOVEMENT_FILTERS.find(f => f.key === filterKey)?.types ?? null, [filterKey])
  const range = useMemo(() => rangeFor(rangeKey), [rangeKey])

  // Identidad de la consulta activa: si cambia, lo que llegue tarde se descarta.
  const queryKey = useMemo(
    () => JSON.stringify([locationId, filterKey, range.from, range.to, qApplied, reloadTick]),
    [locationId, filterKey, range.from, range.to, qApplied, reloadTick],
  )
  const queryKeyRef = useRef(queryKey)
  useEffect(() => { queryKeyRef.current = queryKey }, [queryKey])

  // Teclear no dispara una consulta por letra.
  useEffect(() => {
    const t = window.setTimeout(() => setQApplied(q.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [q])

  // Primera página: cualquier cambio de filtro, rango o búsqueda empieza de cero.
  useEffect(() => {
    // Sin local elegido no hay nada que pedir; el render ya muestra el aviso.
    if (!accountId || !locationId) return
    let cancelled = false
    setLoading(true)
    listMovements({
      accountId, locationId, types, from: range.from, to: range.to,
      search: qApplied, limit: PAGE_SIZE, offset: 0,
    })
      .then(d => { if (!cancelled) { setPage(d); setRows(d.items) } })
      .catch(e => { if (!cancelled) onError(e instanceof Error ? e.message : 'Error cargando el histórico.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, locationId, types, range.from, range.to, qApplied, reloadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    if (!accountId || !locationId || loadingMore) return
    // Foto del filtro con el que se pidió: si cambia mientras llega la respuesta
    // (otra pestaña, otro rango, otra búsqueda), se descarta en vez de mezclar
    // filas de dos consultas distintas.
    const clave = queryKey
    setLoadingMore(true)
    try {
      const d = await listMovements({
        accountId, locationId, types, from: range.from, to: range.to,
        search: qApplied, limit: PAGE_SIZE, offset: rows.length,
      })
      if (clave !== queryKeyRef.current) return
      // Un movimiento nuevo puede haber desplazado la ventana entre dos páginas:
      // deduplicamos por id para no pintar la misma fila dos veces.
      setRows(prev => {
        const vistos = new Set(prev.map(r => r.id))
        return [...prev, ...d.items.filter(r => !vistos.has(r.id))]
      })
      setPage(d)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Error cargando más movimientos.')
    } finally {
      setLoadingMore(false)
    }
  }

  if (!locationId) {
    return <div className="text-sm text-text-secondary p-4 border border-dashed border-border-default rounded-lg">Elige un local para ver sus movimientos.</div>
  }

  const buscando = qApplied.length > 0
  const hayMas = rows.length < page.total
  // Sólo se suman cantidades si TODAS comparten unidad (no mezclar kg con ud).
  const unidad = page.units.length === 1 ? page.units[0] : null
  const conteo = buscando
    ? `${fmtInt(page.total)} de ${fmtInt(page.totalAll)} movimientos`
    : `${fmtInt(page.totalAll)} movimientos · todo lo que entra, sale o se ajusta`

  return (
    <div className="space-y-3">
      {/* Barra de acciones */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm text-text-secondary">
          {conteo}
          {buscando && (
            <>
              <span className="text-text-tertiary"> · «{qApplied}»</span>
              {unidad && (page.sumIn > 0 || page.sumOut > 0) && (
                <span className="ml-2 text-xs tabular-nums">
                  {page.sumIn > 0 && <span className="text-success">+{fmtQty(page.sumIn)}</span>}
                  {page.sumIn > 0 && page.sumOut > 0 && <span className="text-text-tertiary"> / </span>}
                  {page.sumOut > 0 && <span className="text-danger">−{fmtQty(page.sumOut)}</span>}
                  <span className="text-text-tertiary"> {unidad}</span>
                </span>
              )}
            </>
          )}
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setModalKind('entry')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base">
            <Plus size={15} /> Entrada directa
          </button>
          <button type="button" onClick={() => setModalKind('transfer')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border-default text-text-secondary hover:text-text-primary transition-base">
            <ArrowLeftRight size={15} /> Traspaso
          </button>
          <button type="button" onClick={() => setModalKind('waste')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border-default text-text-secondary hover:text-text-primary transition-base">
            <Trash2 size={15} /> Merma
          </button>
        </div>
      </div>

      {/* Filtros — tipo, texto y rango: los tres se resuelven en el servidor */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {MOVEMENT_FILTERS.map(f => (
          <button key={f.key} type="button" onClick={() => setFilterKey(f.key)}
            className={`text-xs rounded-md px-2.5 py-1 border transition-base ${filterKey === f.key ? 'bg-accent text-text-on-accent border-accent' : 'border-border-default text-text-secondary hover:bg-page'}`}>
            {f.label}
          </button>
        ))}
        <span className="mx-1 w-px h-4 bg-border-default" />
        <div className="relative flex-1 min-w-[150px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar artículo…"
            className="w-full h-7 pl-7 pr-7 text-xs rounded-md border border-border-default bg-card text-text-primary" />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="Limpiar"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary">
              <X size={12} />
            </button>
          )}
        </div>
        <select value={rangeKey} onChange={e => setRangeKey(e.target.value as RangeKey)}
          className="text-xs px-2 py-1 border border-border-default rounded-md bg-page text-text-secondary">
          {RANGES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <button type="button" onClick={() => setReloadTick(t => t + 1)}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-border-default rounded-md text-text-secondary hover:bg-page transition-base">
          <RefreshCw size={13} /> Actualizar
        </button>
      </div>

      {/* Histórico */}
      {loading ? (
        <div className="flex items-center gap-2 text-text-secondary text-sm p-4"><Loader2 size={15} className="animate-spin" /> Cargando histórico…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-text-secondary text-sm border border-dashed border-border-default rounded-lg">
          {buscando ? `Sin movimientos de "${qApplied}" en este rango. Amplía el rango de fechas si buscas algo antiguo.` : 'No hay movimientos en este filtro.'}
        </div>
      ) : (
        <div className="border border-border-default rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-2 bg-page text-[11px] uppercase tracking-wide text-text-tertiary border-b border-border-default">
            <span className="w-24">Fecha</span>
            <span className="flex-1">Artículo</span>
            <span className="w-28">Tipo</span>
            <span className="w-24 text-right">Cantidad</span>
            <span className="w-20 text-right">Coste</span>
            <span className="w-32">Quién / origen</span>
          </div>
          {rows.map(m => (
            <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 border-t border-border-default first:border-t-0">
              <span className="w-24 text-xs text-text-tertiary">{fmtDate(m.occurredAt)}</span>
              <span className="flex-1 text-sm text-text-primary truncate">{m.itemName}</span>
              <span className="w-28">
                <span className={`text-[11px] px-2 py-0.5 rounded ${typeChipClass(m.movementType)}`}>{movementLabel(m.movementType)}</span>
              </span>
              <span className={`w-24 text-right text-sm tabular-nums ${m.qtyBase < 0 ? 'text-danger' : 'text-success'}`}>
                {m.qtyBase > 0 ? '+' : ''}{fmtQty(m.qtyBase)}{m.unitAbbr ? ` ${m.unitAbbr}` : ''}
              </span>
              <span className="w-20 text-right text-xs text-text-tertiary tabular-nums">{fmtEur(m.costEur)}</span>
              <span className="w-32 text-xs text-text-secondary truncate">{m.reference ?? m.createdByName ?? '—'}</span>
            </div>
          ))}

          {/* Pie: cuántas filas se ven de cuántas hay. Si falta lista, se dice. */}
          <div className="flex items-center justify-between gap-3 px-3 py-2 bg-page border-t border-border-default">
            <span className="text-[11px] text-text-tertiary">
              Mostrando {fmtInt(rows.length)} de {fmtInt(page.total)}
              {buscando ? ' resultados' : ' movimientos'}
            </span>
            {hayMas && (
              <button type="button" onClick={loadMore} disabled={loadingMore}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 border border-border-default rounded-md text-text-secondary hover:bg-card transition-base disabled:opacity-60">
                {loadingMore ? <Loader2 size={13} className="animate-spin" /> : <ChevronDown size={13} />}
                {loadingMore ? 'Cargando…' : `Cargar más (${fmtInt(page.total - rows.length)})`}
              </button>
            )}
          </div>
        </div>
      )}

      {modalKind && (
        <MovementActionModal
          kind={modalKind}
          accountId={accountId}
          locationId={locationId}
          locations={locations}
          actorId={actorId}
          actorName={actorName}
          onClose={() => setModalKind(null)}
          onDone={(msg) => { setModalKind(null); onFlash(msg); setReloadTick(t => t + 1) }}
        />
      )}
    </div>
  )
}
