// src/modules/shop/pages/ShopDeliveryPage.tsx
//
// Pestaña "Entrega" de Folvy Shop. Capa 1 del motor de envío — chrome de gestión.
// Rebrand 30/06/2026: reconstruido sobre TOKENS de Folvy (fuera inline-styles y
// var(--color-*) terracota/navy). El COLOR POR ZONA (zoneColor) se conserva: es
// dato funcional del mapa, no marca.
//
// Gestor de zonas: mapa + tarjetas + editor unificado (radio / por carretera por
// distancia / por carretera por tiempo) con copiloto de ayudas. Carga el ticket
// medio real del local para el aviso de margen. Casos límite: consolidado y
// local sin coordenadas.

import { useEffect, useState, useCallback } from 'react'
import { Plus, MapPin } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import DeliveryMap, { zoneColor, type DraftCircle, type DraftPolygon } from '@/modules/shop/components/DeliveryMap'
import ZoneEditor from '@/modules/shop/components/ZoneEditor'
import { listDeliveryZones, deleteZone, type DeliveryZone } from '@/modules/shop/services/deliveryZoneService'

type LocationRow = { id: string; name: string; lat: number | null; lng: number | null }

function approxMinutesFromRadius(radiusM: number): number {
  const km = radiusM / 1000
  return Math.max(10, Math.round((km / 18) * 60 / 5) * 5)
}
function reachLabel(z: DeliveryZone): string {
  if (z.method === 'radius' && z.radius_m) {
    const km = z.radius_m / 1000
    return `hasta ${km.toFixed(km % 1 === 0 ? 0 : 1)} km a la redonda`
  }
  if (z.method === 'postal') {
    const n = z.postal_codes?.length ?? 0
    return `${n} código${n === 1 ? '' : 's'} postal${n === 1 ? '' : 'es'}`
  }
  return 'alcance por carretera'
}
function timeLabel(z: DeliveryZone): string {
  if (z.eta_min != null) return `llega en ~${z.eta_min} min`
  if (z.method === 'radius' && z.radius_m) return `llega en ~${approxMinutesFromRadius(z.radius_m)} min (aprox.)`
  return ''
}

export default function ShopDeliveryPage() {
  const { resolvedLocationId, isConsolidated } = useLocationScope()
  const [loc, setLoc] = useState<LocationRow | null>(null)
  const [zones, setZones] = useState<DeliveryZone[]>([])
  const [ticketMedio, setTicketMedio] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [mode, setMode] = useState<'idle' | 'new' | 'edit'>('idle')
  const [editingZone, setEditingZone] = useState<DeliveryZone | null>(null)
  const [draftRadiusM, setDraftRadiusM] = useState<number | null>(null)
  const [draftPolygon, setDraftPolygon] = useState<DraftPolygon>(null)
  const [drawing, setDrawing] = useState(false)
  const [drawnPolygon, setDrawnPolygon] = useState<GeoJSON.Polygon | null>(null)

  useEffect(() => {
    if (!resolvedLocationId || !supabase) { setLoc(null); return }
    let alive = true
    setLoading(true); setErr(null)
    ;(supabase as any)
      .from('locations').select('id, name, lat, lng').eq('id', resolvedLocationId).single()
      .then(({ data, error }: any) => {
        if (!alive) return
        if (error) setErr(error.message); else setLoc(data as LocationRow)
        setLoading(false)
      })
    return () => { alive = false }
  }, [resolvedLocationId])

  useEffect(() => {
    if (!resolvedLocationId || !supabase) { setTicketMedio(null); return }
    let alive = true
    ;(supabase as any)
      .from('sale').select('total').eq('location_id', resolvedLocationId).gt('total', 0).limit(2000)
      .then(({ data }: any) => {
        if (!alive || !data?.length) { setTicketMedio(null); return }
        const avg = data.reduce((s: number, r: any) => s + Number(r.total), 0) / data.length
        setTicketMedio(Math.round(avg * 100) / 100)
      })
    return () => { alive = false }
  }, [resolvedLocationId])

  const reloadZones = useCallback(async () => {
    if (!resolvedLocationId) { setZones([]); return }
    try { setZones(await listDeliveryZones(resolvedLocationId)) }
    catch (e: any) { setErr(e.message) }
  }, [resolvedLocationId])

  useEffect(() => { reloadZones() }, [reloadZones])

  function startNew() {
    setEditingZone(null); setDraftRadiusM(2000); setDraftPolygon(null); setMode('new')
  }
  function startEdit(z: DeliveryZone) {
    if (z.method !== 'radius') return
    setEditingZone(z); setDraftRadiusM(z.radius_m ?? 2000); setDraftPolygon(null); setMode('edit')
  }
  function closeEditor() {
    setMode('idle'); setEditingZone(null); setDraftRadiusM(null); setDraftPolygon(null)
    setDrawing(false); setDrawnPolygon(null)
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`¿Quitar la zona "${name}"? Dejarás de repartir ahí.`)) return
    try { await deleteZone(id); if (editingZone?.id === id) closeEditor(); await reloadZones() }
    catch (e: any) { setErr(e.message) }
  }

  if (isConsolidated) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <h2 className="font-display text-xl font-semibold text-text-primary mb-1">Entrega</h2>
        <p className="text-text-secondary text-sm">
          Las zonas de entrega se configuran por local. Elige un local concreto
          en el selector de arriba para definir sus zonas.
        </p>
      </div>
    )
  }
  if (loading) return <div className="p-6 text-text-secondary">Cargando local…</div>
  if (err) return <div className="p-6 text-danger">Error: {err}</div>
  if (!loc) return <div className="p-6 text-text-secondary">No se encontró el local.</div>

  if (loc.lat == null || loc.lng == null) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <h2 className="font-display text-xl font-semibold text-text-primary mb-3">Entrega · {loc.name}</h2>
        <div className="rounded-xl bg-warning-bg text-warning border border-warning/30 p-4 text-sm">
          Este local aún no tiene ubicación en el mapa. Hay que geocodificar su
          dirección antes de poder definir zonas de entrega.
        </div>
      </div>
    )
  }

  const editorOpen = mode !== 'idle'
  const draftCircle: DraftCircle = (editorOpen && draftRadiusM != null && !draftPolygon)
    ? { lat: loc.lat, lng: loc.lng, radiusM: draftRadiusM }
    : null
  const highlightId = mode === 'edit' ? editingZone?.id ?? null : null

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h2 className="font-display text-xl font-semibold text-text-primary">Entrega · {loc.name}</h2>
      <p className="text-text-secondary text-sm mt-1 mb-4">
        Define dónde repartes a domicilio y a qué precio.
      </p>

      <div className="flex gap-4 flex-wrap items-start">
        <div className="flex-1 min-w-[360px]">
          <DeliveryMap
            key={loc.id}
            lat={loc.lat} lng={loc.lng} locationName={loc.name}
            zones={zones} draftCircle={draftCircle} draftPolygon={drawing ? draftPolygon : (drawnPolygon ?? draftPolygon)} highlightZoneId={highlightId}
            drawing={drawing} onPolygonDrawn={setDrawnPolygon}
          />
        </div>

        <div className="flex-1 min-w-[320px] flex flex-col gap-3">
          {!editorOpen && (
            <div className="flex items-center justify-between">
              <span className="text-base font-medium text-text-primary">Tus zonas de reparto</span>
              <button onClick={startNew}
                className="inline-flex items-center gap-1.5 bg-accent text-text-on-accent px-3.5 py-2 rounded-lg text-sm font-semibold hover:opacity-90">
                <Plus size={15} /> Nueva zona
              </button>
            </div>
          )}

          {editorOpen && (
            <ZoneEditor
              locationId={loc.id}
              centerLat={loc.lat} centerLng={loc.lng}
              zone={mode === 'edit' ? editingZone : null}
              ticketMedio={ticketMedio}
              drawnPolygon={drawnPolygon}
              onDraftRadius={setDraftRadiusM}
              onDraftPolygon={setDraftPolygon}
              onDrawingChange={setDrawing}
              onSaved={() => { closeEditor(); reloadZones() }}
              onCancel={closeEditor}
            />
          )}

          {!editorOpen && (
            zones.length === 0 ? (
              <div className="border border-dashed border-default rounded-xl p-6 text-center text-text-secondary">
                <MapPin size={28} className="mx-auto mb-3 text-text-secondary" />
                <div className="text-[15px] font-medium text-text-primary mb-1">Aún no repartes a domicilio</div>
                <div className="text-[13px] mb-3.5">Crea tu primera zona para empezar a recibir pedidos.</div>
                <button onClick={startNew}
                  className="bg-accent text-text-on-accent px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90">
                  Crear mi primera zona
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {zones.map((z, i) => {
                  const canEdit = z.method === 'radius'
                  const spine = z.method === 'postal' ? '#9CA0A6' : zoneColor(i)
                  const time = timeLabel(z)
                  return (
                    <div key={z.id} className="flex items-stretch border border-default rounded-xl overflow-hidden bg-card">
                      <div className="w-1.5 shrink-0" style={{ background: spine }} />
                      <div className="flex-1 px-3.5 py-3 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-base font-medium text-text-primary">{z.name}</span>
                          {i === 0 && (
                            <span className="text-[11px] bg-accent-bg text-text-secondary px-2 py-0.5 rounded-full">la más barata</span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-text-secondary">
                          <span>{reachLabel(z)}</span>
                          {time && <span>· {time}</span>}
                          {z.min_order != null && <span>· pedido mínimo {z.min_order.toFixed(0)} €</span>}
                        </div>
                      </div>
                      <div className="flex flex-col items-end justify-center px-3.5 py-3">
                        <div className="text-xl font-medium text-text-primary leading-none">{z.delivery_fee.toFixed(2)} €</div>
                        <div className="text-[11px] text-text-secondary">de envío</div>
                      </div>
                      <div className="flex flex-col border-l border-default">
                        <button onClick={() => startEdit(z)} disabled={!canEdit}
                          title={canEdit ? 'Editar' : 'La edición de zonas por carretera llega pronto'}
                          className={`flex-1 px-4 text-[13px] border-b border-default ${
                            canEdit ? 'text-text-primary hover:bg-page cursor-pointer' : 'text-text-secondary opacity-50 cursor-not-allowed'
                          }`}>Editar</button>
                        <button onClick={() => handleDelete(z.id, z.name)} title="Quitar"
                          className="flex-1 px-4 text-[13px] text-text-secondary hover:bg-page hover:text-text-primary">Quitar</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
