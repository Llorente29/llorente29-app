// src/admin/pages/FolvyMapPage.tsx
//
// MAPA DE FOLVY — diagrama de flujo VIVO del proyecto (solo superadmin). Pinta el
// flujo completo (módulos construidos + ideas) agrupado por CAPA en el orden del
// negocio, con el estado de cada caja medido en vivo de la BBDD y editable en 1
// clic. Sustituye a los mapas .md que envejecen.
//
//   • Semáforo DECLARADO (manda, color de la caja): el juicio de Julio.
//   • Señal MEDIDA (secundaria, dato): nº de filas de su measure_table.
//   • CHOQUE: cuando lo declarado no cuadra con lo medido (icono de aviso) — es
//     justo la info útil ("dices vivo pero está vacío").
//
// La tabla folvy_map_node la mantiene Julio/SQL (semilla); esta página solo
// lee+edita estado (status_declared/status_note) vía folvyMapService.

import { useEffect, useMemo, useState } from 'react'
import { Map as MapIcon, AlertTriangle, ArrowRight, X, Check, Loader2 } from 'lucide-react'
import {
  listMapNodes,
  getMeasuredCounts,
  updateNodeStatus,
  type MapNode,
  type MapNodeStatus,
} from '@/admin/services/folvyMapService'

// ── Orden del FLUJO del negocio (las bandas se pintan en este orden) ──
const LAYER_ORDER = [
  'aprovisionamiento', 'cocina', 'venta', 'consumo', 'margen',
  'plataforma', 'soporte', 'admin',
] as const

const LAYER_LABEL: Record<string, string> = {
  aprovisionamiento: 'Aprovisionamiento',
  cocina: 'Cocina',
  venta: 'Venta',
  consumo: 'Consumo',
  margen: 'Margen',
  plataforma: 'Plataforma',
  soporte: 'Soporte',
  admin: 'Admin',
}

// Capas del flujo lineal (flecha entre cajas). Las ramas (plataforma/soporte/
// admin) son módulos que cuelgan: NO llevan flecha de flujo.
const FLOW_LAYERS = new Set(['aprovisionamiento', 'cocina', 'venta', 'consumo', 'margen'])

// ── Estilos por estado DECLARADO. Tokens del sistema; morado (sin token) y gris
// con utilidades Tailwind estándar (como ya hace SalesExceptionsPage). ──
const STATUS: Record<MapNodeStatus, { label: string; chip: string; dot: string; card: string }> = {
  vivo:      { label: 'Vivo',      chip: 'bg-success-bg text-success',                       dot: 'bg-success',     card: 'border-success/40' },
  a_medias:  { label: 'A medias',  chip: 'bg-warning-bg text-warning',                       dot: 'bg-warning',     card: 'border-warning/40' },
  deuda:     { label: 'Deuda',     chip: 'bg-danger-bg text-danger',                         dot: 'bg-danger',      card: 'border-danger/40' },
  bloqueado: { label: 'Bloqueado', chip: 'bg-purple-100 text-purple-700',                    dot: 'bg-purple-500',  card: 'border-purple-300' },
  vacio:     { label: 'Vacío',     chip: 'bg-page text-text-secondary border border-border-default', dot: 'bg-gray-400', card: 'border-border-default' },
  idea:      { label: 'Idea',      chip: 'bg-accent-bg text-accent',                         dot: 'bg-accent',      card: 'border-accent/40 border-dashed' },
}

const STATUS_ORDER: MapNodeStatus[] = ['vivo', 'a_medias', 'deuda', 'bloqueado', 'vacio', 'idea']

// Filas medidas → texto humano. undefined = sin measure_table.
function measuredLabel(count: number | undefined): string | null {
  if (count === undefined) return null
  if (count === 0) return 'vacía'
  return `${count.toLocaleString('es-ES')} fila${count === 1 ? '' : 's'}`
}

// CHOQUE entre lo declarado y lo medido (la info útil del mapa). null = coherente.
function clashFor(node: MapNode, count: number | undefined): string | null {
  if (!node.measureTable || count === undefined) return null
  const populated = count > 0
  if (populated && (node.statusDeclared === 'vacio' || node.statusDeclared === 'idea')) {
    return `Dices «${STATUS[node.statusDeclared].label}» pero la tabla tiene ${count.toLocaleString('es-ES')} filas.`
  }
  if (!populated && node.statusDeclared === 'vivo') {
    return 'Dices «Vivo» pero la tabla está vacía.'
  }
  return null
}

export default function FolvyMapPage() {
  const [nodes, setNodes] = useState<MapNode[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([listMapNodes(), getMeasuredCounts()])
      .then(([ns, cs]) => {
        if (cancelled) return
        setNodes(ns)
        setCounts(cs)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error cargando el mapa.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadTick])

  // Nodos agrupados por capa (ya vienen ordenados por flow_order del servicio).
  const byLayer = useMemo(() => {
    const m = new Map<string, MapNode[]>()
    for (const n of nodes) {
      const arr = m.get(n.layer) ?? []
      arr.push(n)
      m.set(n.layer, arr)
    }
    return m
  }, [nodes])

  // Capas a pintar: las del orden conocido que tengan nodos, + cualquier capa
  // extra no contemplada (al final), para no ocultar datos.
  const layersToRender = useMemo(() => {
    const known = LAYER_ORDER.filter(l => (byLayer.get(l)?.length ?? 0) > 0)
    const extra = Array.from(byLayer.keys()).filter(l => !LAYER_ORDER.includes(l as typeof LAYER_ORDER[number]))
    return [...known, ...extra]
  }, [byLayer])

  const selected = useMemo(
    () => nodes.find(n => n.id === selectedId) ?? null,
    [nodes, selectedId],
  )

  const clashCount = useMemo(
    () => nodes.reduce((acc, n) => acc + (clashFor(n, counts[n.measureTable ?? '']) ? 1 : 0), 0),
    [nodes, counts],
  )

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Cabecera + leyenda */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-xl font-display font-medium text-text-primary flex items-center gap-2">
            <MapIcon size={20} className="text-accent" />
            Mapa de Folvy
          </h1>
          <p className="text-sm text-text-secondary mt-0.5">
            El flujo completo del proyecto, con el estado de cada pieza medido en vivo. Pulsa una caja para reclasificarla.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_ORDER.map(s => (
            <span key={s} className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
              <span className={`w-2.5 h-2.5 rounded-full ${STATUS[s].dot}`} />
              {STATUS[s].label}
            </span>
          ))}
        </div>
      </div>

      {loading && (
        <div className="p-10 text-center text-sm text-text-secondary inline-flex items-center gap-2 justify-center w-full">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando el mapa…
        </div>
      )}

      {!loading && error && (
        <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>
      )}

      {!loading && !error && (
        <>
          {clashCount > 0 && (
            <div className="mb-4 p-3 rounded-md bg-warning-bg text-warning border border-warning/30 text-sm inline-flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0" />
              {clashCount} caja{clashCount === 1 ? '' : 's'} con choque entre lo declarado y lo medido (icono ⚠ en la caja).
            </div>
          )}

          <div className="space-y-3">
            {layersToRender.map(layer => {
              const items = byLayer.get(layer) ?? []
              const isFlow = FLOW_LAYERS.has(layer)
              return (
                <section key={layer} className="rounded-lg border border-border-default bg-card overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border-default bg-page flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{LAYER_LABEL[layer] ?? layer}</span>
                    <span className="text-xs text-text-secondary">· {items.length}</span>
                    {!isFlow && (
                      <span className="text-[11px] text-text-tertiary ml-1">(módulos, fuera del flujo lineal)</span>
                    )}
                  </div>
                  <div className="p-3 overflow-x-auto">
                    <div className="flex items-stretch gap-2 min-w-min">
                      {items.map((node, i) => (
                        <div key={node.id} className="flex items-center gap-2">
                          <MapCard
                            node={node}
                            count={node.measureTable ? counts[node.measureTable] : undefined}
                            onClick={() => setSelectedId(node.id)}
                          />
                          {isFlow && i < items.length - 1 && (
                            <ArrowRight size={16} className="shrink-0 text-text-tertiary" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              )
            })}
          </div>
        </>
      )}

      {/* Panel de edición (lado derecho) */}
      {selected && (
        <EditPanel
          node={selected}
          count={selected.measureTable ? counts[selected.measureTable] : undefined}
          onClose={() => setSelectedId(null)}
          onSaved={() => { setSelectedId(null); setReloadTick(t => t + 1) }}
        />
      )}
    </div>
  )
}

// ── Caja del mapa ──────────────────────────────────────────────────────────
function MapCard({ node, count, onClick }: { node: MapNode; count: number | undefined; onClick: () => void }) {
  const st = STATUS[node.statusDeclared] ?? STATUS.idea
  const measured = measuredLabel(count)
  const clash = clashFor(node, count)
  const tooltip = [node.description, node.statusNote ? `Nota: ${node.statusNote}` : null]
    .filter(Boolean).join('\n') || node.name

  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip}
      className={`w-44 text-left bg-card border ${st.card} rounded-lg p-2.5 hover:shadow-sm transition-base flex flex-col gap-1.5`}
    >
      <div className="flex items-start gap-1.5">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${st.dot}`} />
        <span className="text-sm font-medium text-text-primary leading-tight break-words flex-1 min-w-0">
          {node.name}
        </span>
        {clash && <AlertTriangle size={14} className="shrink-0 text-warning mt-0.5" />}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${st.chip}`}>{st.label}</span>
        {measured !== null && (
          <span className={`text-[10px] tabular-nums ${count === 0 ? 'text-text-tertiary' : 'text-text-secondary'}`}>
            {measured}
          </span>
        )}
      </div>
    </button>
  )
}

// ── Panel de edición en 1 clic ───────────────────────────────────────────────
function EditPanel({
  node, count, onClose, onSaved,
}: {
  node: MapNode
  count: number | undefined
  onClose: () => void
  onSaved: () => void
}) {
  const [status, setStatus] = useState<MapNodeStatus>(node.statusDeclared)
  const [note, setNote] = useState(node.statusNote ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const measured = measuredLabel(count)
  const clash = clashFor(node, count)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await updateNodeStatus(node.id, status, note.trim() || null)
      onSaved()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.')
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="map-edit-title"
      className="fixed inset-0 z-[100] flex justify-end bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card w-full max-w-md h-full shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <div className="min-w-0">
            <h3 id="map-edit-title" className="text-base font-medium text-text-primary truncate">{node.name}</h3>
            <p className="text-[11px] text-text-tertiary font-mono truncate">{node.code} · {LAYER_LABEL[node.layer] ?? node.layer}</p>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-base shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4 overflow-y-auto flex-1">
          {node.description && (
            <p className="text-sm text-text-secondary">{node.description}</p>
          )}

          {/* Señal medida + choque */}
          <div className="rounded-md bg-page border border-border-default px-3 py-2 text-sm">
            <span className="text-text-secondary">Medido en vivo: </span>
            {node.measureTable ? (
              <>
                <span className="font-mono text-text-primary">{node.measureTable}</span>
                <span className="text-text-secondary"> · </span>
                <span className={count === 0 ? 'text-text-tertiary' : 'text-text-primary'}>{measured}</span>
              </>
            ) : (
              <span className="text-text-tertiary">sin tabla asociada</span>
            )}
            {clash && (
              <p className="mt-1.5 text-xs text-warning inline-flex items-start gap-1.5">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {clash}
              </p>
            )}
          </div>

          {/* Selector de estado declarado */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Estado declarado (manda)</label>
            <div className="grid grid-cols-2 gap-1.5">
              {STATUS_ORDER.map(s => {
                const sel = status === s
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    disabled={saving}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm border transition-base disabled:opacity-50 ${
                      sel ? `${STATUS[s].card} bg-page font-medium` : 'border-border-default text-text-secondary hover:bg-page'
                    }`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${STATUS[s].dot}`} />
                    {STATUS[s].label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Nota */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Nota (por qué / disparador)</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              disabled={saving}
              rows={4}
              placeholder="Ej: vivo pero falta poblar; deuda con disparador X; idea para Q3…"
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 resize-y"
            />
          </div>

          {error && (
            <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">{error}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check size={14} />}
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
