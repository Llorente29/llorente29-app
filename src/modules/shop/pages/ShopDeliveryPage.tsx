// src/modules/shop/pages/ShopDeliveryPage.tsx
//
// Pestaña "Entrega" de Folvy Shop. Capa 1 del motor de envío.
// Gestor de zonas pensado para HOSTELEROS (no para técnicos): mapa + lista en
// TARJETAS con banda de color (casa con el círculo del mapa), nombre claro,
// el PRECIO como protagonista y el dato traducido a lenguaje sencillo
// (hasta X km a la redonda · llega en ~Y min · pedido mínimo Z €). Botones
// grandes "Editar" y "Quitar" siempre visibles. Panel lateral crea/edita radio.
// Métodos por carretera (distancia/tiempo), polígono y CP llegan a continuación.
// Casos límite: modo consolidado (elegir local) y local sin coordenadas.

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import DeliveryMap, { zoneColor, type DraftCircle } from '@/modules/shop/components/DeliveryMap'
import RadiusZoneEditor from '@/modules/shop/components/RadiusZoneEditor'
import { listDeliveryZones, deleteZone, type DeliveryZone } from '@/modules/shop/services/deliveryZoneService'

type LocationRow = { id: string; name: string; lat: number | null; lng: number | null }

// Estimación de tiempo de relleno (solo si el hostelero no escribió ETA).
// Reparto urbano ~18 km/h de media → min ≈ (km / 18) * 60. Aproximado a propósito;
// el tiempo REAL por carretera lo dará la isócrona de Mapbox (siguiente tramo).
function approxMinutesFromRadius(radiusM: number): number {
  const km = radiusM / 1000
  return Math.max(10, Math.round((km / 18) * 60 / 5) * 5) // redondeo a 5 min, mínimo 10
}

// Línea de "alcance" en lenguaje de hostelero según el método.
function reachLabel(z: DeliveryZone): string {
  if (z.method === 'radius' && z.radius_m) {
    const km = z.radius_m / 1000
    return `hasta ${km.toFixed(km % 1 === 0 ? 0 : 1)} km a la redonda`
  }
  if (z.method === 'postal') {
    const n = z.postal_codes?.length ?? 0
    return `${n} código${n === 1 ? '' : 's'} postal${n === 1 ? '' : 'es'}`
  }
  return 'zona dibujada en el mapa'
}

// Línea de tiempo: el que puso el hostelero, o estimación aprox.
function timeLabel(z: DeliveryZone): string {
  if (z.eta_min != null) return `llega en ~${z.eta_min} min`
  if (z.method === 'radius' && z.radius_m) return `llega en ~${approxMinutesFromRadius(z.radius_m)} min (aprox.)`
  return ''
}

export default function ShopDeliveryPage() {
  const { resolvedLocationId, isConsolidated } = useLocationScope()
  const [loc, setLoc] = useState<LocationRow | null>(null)
  const [zones, setZones] = useState<DeliveryZone[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [mode, setMode] = useState<'idle' | 'new' | 'edit'>('idle')
  const [editingZone, setEditingZone] = useState<DeliveryZone | null>(null)
  const [draftRadiusM, setDraftRadiusM] = useState(2000)

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

  const reloadZones = useCallback(async () => {
    if (!resolvedLocationId) { setZones([]); return }
    try { setZones(await listDeliveryZones(resolvedLocationId)) }
    catch (e: any) { setErr(e.message) }
  }, [resolvedLocationId])

  useEffect(() => { reloadZones() }, [reloadZones])

  function startNew() { setEditingZone(null); setDraftRadiusM(2000); setMode('new') }
  function startEdit(z: DeliveryZone) {
    if (z.method !== 'radius') return
    setEditingZone(z); setDraftRadiusM(z.radius_m ?? 2000); setMode('edit')
  }
  function closeEditor() { setMode('idle'); setEditingZone(null) }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`¿Quitar la zona "${name}"? Dejarás de repartir ahí.`)) return
    try { await deleteZone(id); if (editingZone?.id === id) closeEditor(); await reloadZones() }
    catch (e: any) { setErr(e.message) }
  }

  if (isConsolidated) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>Entrega</h2>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Las zonas de entrega se configuran por local. Elige un local concreto
          en el selector de arriba para definir sus zonas.
        </p>
      </div>
    )
  }
  if (loading) return <div style={{ padding: 24 }}>Cargando local…</div>
  if (err) return <div style={{ padding: 24, color: 'var(--color-danger)' }}>Error: {err}</div>
  if (!loc) return <div style={{ padding: 24 }}>No se encontró el local.</div>

  if (loc.lat == null || loc.lng == null) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>Entrega · {loc.name}</h2>
        <div style={{
          background: 'var(--color-warning-bg, #FAEEDA)', borderRadius: 12,
          padding: 16, color: 'var(--color-warning, #854F0B)',
        }}>
          Este local aún no tiene ubicación en el mapa. Hay que geocodificar su
          dirección antes de poder definir zonas de entrega.
        </div>
      </div>
    )
  }

  const editorOpen = mode !== 'idle'
  const draftCircle: DraftCircle = editorOpen
    ? { lat: loc.lat, lng: loc.lng, radiusM: draftRadiusM }
    : null
  const highlightId = mode === 'edit' ? editingZone?.id ?? null : null

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: 0 }}>Entrega · {loc.name}</h2>
      <p style={{ color: 'var(--color-text-secondary)', marginTop: 4 }}>
        Define dónde repartes a domicilio y a qué precio.
      </p>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Mapa */}
        <div style={{ flex: '1 1 360px', minWidth: 0 }}>
          <DeliveryMap
            key={loc.id}
            lat={loc.lat} lng={loc.lng} locationName={loc.name}
            zones={zones} draftCircle={draftCircle} highlightZoneId={highlightId}
          />
        </div>

        {/* Panel derecho */}
        <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Cabecera: título + botón nueva zona */}
          {!editorOpen && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 16, fontWeight: 500 }}>Tus zonas de reparto</span>
              <button onClick={startNew} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'var(--color-terracota, #D67442)', color: '#fff', border: 'none',
                padding: '9px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 14,
              }}>
                + Nueva zona
              </button>
            </div>
          )}

          {/* Editor (crear o editar) */}
          {editorOpen && (
            <RadiusZoneEditor
              locationId={loc.id}
              centerLat={loc.lat} centerLng={loc.lng}
              zone={mode === 'edit' ? editingZone : null}
              radiusM={draftRadiusM}
              onRadiusChange={setDraftRadiusM}
              onSaved={() => { closeEditor(); reloadZones() }}
              onCancel={closeEditor}
            />
          )}

          {/* Lista de zonas en TARJETAS */}
          {!editorOpen && (
            zones.length === 0 ? (
              <div style={{
                border: '1px dashed var(--color-border-default)', borderRadius: 12,
                padding: 24, textAlign: 'center', color: 'var(--color-text-secondary)',
              }}>
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: 4 }}>
                  Aún no repartes a domicilio
                </div>
                <div style={{ fontSize: 13, marginBottom: 14 }}>
                  Crea tu primera zona para empezar a recibir pedidos.
                </div>
                <button onClick={startNew} style={{
                  background: 'var(--color-terracota, #D67442)', color: '#fff', border: 'none',
                  padding: '9px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 14,
                }}>
                  Crear mi primera zona
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {zones.map((z, i) => {
                  const canEdit = z.method === 'radius'
                  const color = z.method === 'postal' ? 'var(--color-text-secondary)' : zoneColor(i)
                  const time = timeLabel(z)
                  return (
                    <div key={z.id} style={{
                      display: 'flex', alignItems: 'stretch',
                      border: '1px solid var(--color-border-default)', borderRadius: 12,
                      overflow: 'hidden', background: 'var(--color-bg-card, #FFFFFF)',
                    }}>
                      {/* Banda de color */}
                      <div style={{ width: 6, background: color, flexShrink: 0 }} />

                      {/* Cuerpo */}
                      <div style={{ flex: 1, padding: '12px 14px', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                          <span style={{ fontSize: 16, fontWeight: 500 }}>{z.name}</span>
                          {i === 0 && (
                            <span style={{
                              fontSize: 11, background: 'var(--color-accent-bg, #EDECE6)',
                              color: 'var(--color-text-secondary)', padding: '2px 8px', borderRadius: 20,
                            }}>la más barata</span>
                          )}
                        </div>
                        <div style={{
                          display: 'flex', flexWrap: 'wrap', gap: '4px 14px',
                          fontSize: 12.5, color: 'var(--color-text-secondary)',
                        }}>
                          <span>{reachLabel(z)}</span>
                          {time && <span>· {time}</span>}
                          {z.min_order != null && <span>· pedido mínimo {z.min_order.toFixed(0)} €</span>}
                        </div>
                      </div>

                      {/* Precio protagonista */}
                      <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
                        justifyContent: 'center', padding: '12px 14px',
                      }}>
                        <div style={{ fontSize: 20, fontWeight: 500, lineHeight: 1 }}>
                          {z.delivery_fee.toFixed(2)} €
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>de envío</div>
                      </div>

                      {/* Acciones */}
                      <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--color-border-default)' }}>
                        <button
                          onClick={() => startEdit(z)}
                          disabled={!canEdit}
                          title={canEdit ? 'Editar' : 'Edición disponible próximamente'}
                          style={{
                            flex: 1, border: 'none', background: 'transparent',
                            padding: '0 16px', cursor: canEdit ? 'pointer' : 'not-allowed',
                            color: canEdit ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                            fontSize: 13, borderBottom: '1px solid var(--color-border-default)',
                            opacity: canEdit ? 1 : 0.5,
                          }}>
                          Editar
                        </button>
                        <button
                          onClick={() => handleDelete(z.id, z.name)}
                          title="Quitar"
                          style={{
                            flex: 1, border: 'none', background: 'transparent',
                            padding: '0 16px', cursor: 'pointer',
                            color: 'var(--color-text-secondary)', fontSize: 13,
                          }}>
                          Quitar
                        </button>
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
