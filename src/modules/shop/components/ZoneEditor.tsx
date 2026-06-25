// src/modules/shop/components/ZoneEditor.tsx
//
// Editor de zona de entrega para HOSTELEROS (Capa 1) — rediseño cálido.
// Flujo en dos preguntas claras en lenguaje de hostelero, no botones técnicos:
//   1) "¿Hasta dónde repartes?" → 4 tarjetas (radio / por carretera / CP / a mano)
//   2) Solo si "por carretera": medio de reparto + distancia o tiempo
// El precio y el copiloto de ayudas viven debajo con presencia visual.
// PRECIO SUGERIDO: botón que propone el envío = MAX(mínimo, base + €/km × distancia),
// protegiendo margen. El hostelero manda: rellena el campo, no lo impone.
// Lógica intacta: radio→radio; isócrona y a mano→polígono; CP→lista.

import { useState } from 'react'
import {
  upsertRadiusZone, upsertPolygonZone, upsertPostalZone, isochrone,
  type DeliveryZone, type TravelProfile,
} from '@/modules/shop/services/deliveryZoneService'

type ZoneFamily = 'radius' | 'road' | 'postal' | 'draw'
type RoadBy = 'meters' | 'minutes'

type Props = {
  locationId: string
  centerLat: number
  centerLng: number
  zone: DeliveryZone | null
  ticketMedio: number | null
  drawnPolygon: GeoJSON.Polygon | null
  onDraftRadius: (radiusM: number | null) => void
  onDraftPolygon: (poly: GeoJSON.Polygon | null) => void
  onDrawingChange: (drawing: boolean) => void
  onSaved: () => void
  onCancel: () => void
}

// Fórmula de precio sugerido (Paso 1, transparente). Valores de partida
// sensatos para reparto urbano; el hostelero ve el resultado y puede editarlo.
const SUGGEST_BASE = 2.99   // suelo real de un reparto (€ de salir)
const SUGGEST_PER_KM = 0.45 // € por km de distancia

function fmtNum(n: number | null): string { return n == null ? '' : String(n).replace('.', ',') }
function approxMin(km: number): number { return Math.max(10, Math.round((km / 18) * 60 / 5) * 5) }
function parsePostalCodes(text: string): string[] {
  return Array.from(new Set(text.split(/[^0-9]+/).filter(Boolean)))
}
function isValidEsCp(cp: string): boolean { return /^[0-5][0-9]{4}$/.test(cp) }

const FAMILIES: { v: ZoneFamily; icon: string; title: string; hint: string }[] = [
  { v: 'radius', icon: '🎯', title: 'Un radio', hint: 'Rápido: un círculo alrededor de tu local' },
  { v: 'road', icon: '🛣️', title: 'Por carretera', hint: 'Realista: por calles, según cómo repartes' },
  { v: 'postal', icon: '📮', title: 'Códigos postales', hint: 'Por las zonas concretas que tú eliges' },
  { v: 'draw', icon: '✏️', title: 'La dibujo yo', hint: 'Control total: marca el área a mano' },
]

const PROFILES: { v: TravelProfile; label: string }[] = [
  { v: 'moto', label: '🛵 Moto' },
  { v: 'coche', label: '🚗 Coche' },
  { v: 'bici', label: '🚲 Bici' },
  { v: 'pie', label: '🚶 A pie' },
]

export default function ZoneEditor({
  locationId, centerLat, centerLng, zone, ticketMedio, drawnPolygon,
  onDraftRadius, onDraftPolygon, onDrawingChange, onSaved, onCancel,
}: Props) {
  const editing = zone != null

  const [family, setFamily] = useState<ZoneFamily>('radius')
  const [roadBy, setRoadBy] = useState<RoadBy>('minutes')
  const [profile, setProfile] = useState<TravelProfile>('moto')

  const [name, setName] = useState(zone?.name ?? '')
  const [fee, setFee] = useState(zone ? fmtNum(zone.delivery_fee) : '2,50')
  const [minOrder, setMinOrder] = useState(zone ? fmtNum(zone.min_order) : '')
  const [eta, setEta] = useState(zone?.eta_min != null ? String(zone.eta_min) : '')
  const [feeSuggested, setFeeSuggested] = useState(false) // ¿el fee actual lo propuso Folvy?

  const [radiusM, setRadiusM] = useState(zone?.radius_m ?? 2000)
  const [routeKm, setRouteKm] = useState(3)
  const [minutes, setMinutes] = useState(15)

  const [postalText, setPostalText] = useState((zone?.postal_codes ?? []).join(', '))
  const postalCodes = parsePostalCodes(postalText)
  const postalInvalid = postalCodes.filter(c => !isValidEsCp(c))

  const [computedPoly, setComputedPoly] = useState<GeoJSON.Polygon | null>(null)
  const [calc, setCalc] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const feeNum = parseFloat(fee.replace(',', '.'))

  function refreshRadiusPreview(m: number) {
    setRadiusM(m); setComputedPoly(null); onDraftPolygon(null); onDraftRadius(m)
  }
  function clearComputed() { setComputedPoly(null); onDraftPolygon(null) }

  function pickFamily(f: ZoneFamily) {
    setFamily(f); setComputedPoly(null); onDraftPolygon(null)
    onDrawingChange(f === 'draw')
    if (f === 'radius') onDraftRadius(radiusM); else onDraftRadius(null)
  }

  // Distancia representativa (km) de la zona, según método, para sugerir precio.
  // CP y "a mano" no tienen distancia clara → no se puede sugerir por distancia.
  function zoneDistanceKm(): number | null {
    if (family === 'radius') return radiusM / 1000
    if (family === 'road' && roadBy === 'meters') return routeKm
    if (family === 'road' && roadBy === 'minutes') return (minutes / 60) * 18 // ~18 km/h urbano
    return null
  }
  const canSuggest = zoneDistanceKm() != null

  function suggestPrice() {
    const km = zoneDistanceKm()
    if (km == null) return
    const min = minOrder.trim() ? parseFloat(minOrder.replace(',', '.')) : 0
    const byDistance = SUGGEST_BASE + SUGGEST_PER_KM * km
    // Suelo: nunca por debajo del mínimo de envío que el hostelero quiera fijar.
    // (Aquí el "mínimo" suelo = SUGGEST_BASE; min_order es el mínimo de PEDIDO, distinto.)
    const suggested = Math.max(SUGGEST_BASE, byDistance)
    setFee(fmtNum(Math.round(suggested * 20) / 20)) // redondeo a 0,05 €
    setFeeSuggested(true)
    // min_order no se toca; es decisión aparte del hostelero.
    void min
  }

  async function handleCalc() {
    setErr(null); setCalc(true)
    try {
      const poly = roadBy === 'meters'
        ? await isochrone(centerLat, centerLng, { meters: Math.round(routeKm * 1000) }, profile)
        : await isochrone(centerLat, centerLng, { minutes }, profile)
      setComputedPoly(poly); onDraftPolygon(poly); onDraftRadius(null)
    } catch (e: any) { setErr(e.message) } finally { setCalc(false) }
  }

  function finish(cb: () => void) { onDrawingChange(false); cb() }

  async function handleSave() {
    setErr(null)
    if (!name.trim()) { setErr('Ponle un nombre a la zona.'); return }
    if (!isFinite(feeNum) || feeNum < 0) { setErr('El precio de envío no es válido.'); return }
    const eco = {
      name: name.trim(),
      delivery_fee: feeNum,
      min_order: minOrder.trim() ? parseFloat(minOrder.replace(',', '.')) : null,
      eta_min: eta.trim() ? parseInt(eta, 10) : null,
    }
    setSaving(true)
    try {
      if (family === 'radius') {
        await upsertRadiusZone(zone?.id ?? null, locationId, radiusM, centerLat, centerLng, eco)
      } else if (family === 'postal') {
        if (postalCodes.length === 0) { setErr('Escribe al menos un código postal.'); setSaving(false); return }
        await upsertPostalZone(zone?.id ?? null, locationId, postalCodes, eco)
      } else if (family === 'draw') {
        if (!drawnPolygon) { setErr('Dibuja la zona en el mapa antes de guardar.'); setSaving(false); return }
        await upsertPolygonZone(zone?.id ?? null, locationId, drawnPolygon, eco)
      } else {
        if (!computedPoly) { setErr('Pulsa “Ver alcance” para calcular la zona antes de guardar.'); setSaving(false); return }
        await upsertPolygonZone(zone?.id ?? null, locationId, computedPoly, eco)
      }
      onDrawingChange(false)
      onSaved()
    } catch (e: any) { setErr(e.message); setSaving(false) }
  }

  // ── Copiloto de ayudas ──
  const tips: { icon: string; tone: 'info' | 'warn' | 'good'; text: string }[] = []
  const profileWord = profile === 'moto' ? 'en moto' : profile === 'coche' ? 'en coche' : profile === 'bici' ? 'en bici' : 'andando'

  if (family === 'radius') {
    tips.push({ icon: '🕐', tone: 'info', text: `Hasta ${(radiusM / 1000).toFixed(1)} km a la redonda · llega en ~${approxMin(radiusM / 1000)} min (aprox.)` })
    if (radiusM / 1000 > 4) tips.push({ icon: '⚠️', tone: 'warn', text: `${(radiusM / 1000).toFixed(1)} km es mucho para comida caliente: puede llegar fría.` })
  } else if (family === 'road' && roadBy === 'meters') {
    tips.push({ icon: '🕐', tone: 'info', text: `Hasta ${routeKm} km de ruta real ${profileWord} (por calles, no en línea recta).` })
    if (routeKm > 5) tips.push({ icon: '⚠️', tone: 'warn', text: `${routeKm} km de ruta es bastante para comida caliente.` })
  } else if (family === 'road') {
    tips.push({ icon: '🕐', tone: 'info', text: `Hasta ${minutes} min ${profileWord} (tiempo real por carretera).` })
    if (minutes > 25) tips.push({ icon: '⚠️', tone: 'warn', text: `${minutes} min puede ser demasiado para que llegue caliente.` })
  } else if (family === 'postal') {
    if (postalCodes.length > 0) tips.push({ icon: '📮', tone: 'info', text: `Repartes a ${postalCodes.length} código${postalCodes.length === 1 ? '' : 's'} postal${postalCodes.length === 1 ? '' : 'es'}.` })
    if (postalInvalid.length > 0) tips.push({ icon: '⚠️', tone: 'warn', text: `No parecen códigos postales españoles: ${postalInvalid.join(', ')}.` })
  } else {
    if (drawnPolygon) tips.push({ icon: '✅', tone: 'good', text: 'Zona dibujada. Ajusta los puntos en el mapa o guárdala.' })
    else tips.push({ icon: '✏️', tone: 'info', text: 'Haz clic en el mapa para marcar las esquinas; doble clic para cerrar.' })
  }

  if (feeSuggested) {
    tips.push({ icon: '✨', tone: 'good', text: `Precio sugerido por Folvy para esta distancia. Ajústalo si quieres.` })
  }

  if (isFinite(feeNum) && feeNum > 0 && minOrder.trim()) {
    const min = parseFloat(minOrder.replace(',', '.'))
    if (isFinite(min) && min > 0) {
      const pct = Math.round((feeNum / min) * 100)
      if (pct >= 30) tips.push({ icon: '⚠️', tone: 'warn', text: `El envío (${feeNum.toFixed(2)} €) es el ${pct}% de un pedido mínimo de ${min.toFixed(0)} €.` })
    }
  }
  if (isFinite(feeNum) && ticketMedio != null && ticketMedio > 0) {
    const pct = Math.round((feeNum / ticketMedio) * 100)
    if (pct <= 12) tips.push({ icon: '💰', tone: 'good', text: `Con tu ticket medio de ${ticketMedio.toFixed(2)} €, un envío de ${feeNum.toFixed(2)} € deja margen sano.` })
    else if (pct <= 20) tips.push({ icon: '💰', tone: 'info', text: `El envío es el ${pct}% de tu ticket medio (${ticketMedio.toFixed(2)} €): vigila el margen.` })
    else tips.push({ icon: '💸', tone: 'warn', text: `El envío es el ${pct}% de tu ticket medio (${ticketMedio.toFixed(2)} €): se come buena parte del margen.` })
  }

  const tipColor = (t: string) => t === 'warn' ? 'var(--color-warning, #854F0B)' : t === 'good' ? 'var(--color-success, #3F5C2F)' : 'var(--color-text-secondary)'
  const tipBg = (t: string) => t === 'warn' ? 'var(--color-warning-bg, #FAEEDA)' : t === 'good' ? 'var(--color-success-bg, #E2E8DA)' : 'var(--color-accent-bg, #EDECE6)'

  return (
    <div style={{
      border: '1px solid var(--color-border-default)', borderRadius: 16,
      padding: 20, background: 'var(--color-bg-card, #FFFFFF)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{editing ? `Editar ${zone!.name}` : 'Nueva zona de reparto'}</h3>
        <button onClick={() => finish(onCancel)} disabled={saving} title="Cerrar" style={{
          border: 'none', background: 'transparent', cursor: 'pointer',
          color: 'var(--color-text-secondary)', fontSize: 22, lineHeight: 1,
        }}>×</button>
      </div>

      {!editing && (
        <>
          <div style={qLabel}>¿Hasta dónde repartes?</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
            {FAMILIES.map(f => {
              const on = family === f.v
              return (
                <button key={f.v} onClick={() => pickFamily(f.v)} style={{
                  textAlign: 'left', padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                  border: on ? '2px solid var(--color-terracota, #D67442)' : '1px solid var(--color-border-default)',
                  background: on ? 'var(--color-warning-bg, #FAEEDA)' : 'transparent',
                  transition: 'all .12s',
                }}>
                  <div style={{ fontSize: 18, marginBottom: 4 }}>{f.icon}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{f.title}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', lineHeight: 1.3 }}>{f.hint}</div>
                </button>
              )
            })}
          </div>
        </>
      )}

      <div style={qLabel}>¿Cómo se llama esta zona?</div>
      <input style={{ ...bigInput, marginBottom: 18 }} value={name} onChange={e => setName(e.target.value)} placeholder="Ej. Centro, Barrio norte…" />

      {family === 'radius' && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={qLabel}>Tamaño del radio</span>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-terracota, #D67442)' }}>{(radiusM / 1000).toFixed(1)} km</span>
          </div>
          <input type="range" min={500} max={6000} step={100} value={radiusM}
            onChange={e => { refreshRadiusPreview(parseInt(e.target.value, 10)); setFeeSuggested(false) }} style={{ width: '100%' }} />
        </div>
      )}

      {family === 'road' && (
        <>
          <div style={qLabel}>¿Cómo repartes?</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {PROFILES.map(p => {
              const on = profile === p.v
              return (
                <button key={p.v} onClick={() => { setProfile(p.v); clearComputed() }} style={{
                  flex: 1, padding: '9px 2px', borderRadius: 10, fontSize: 12.5, cursor: 'pointer', fontWeight: on ? 600 : 400,
                  border: on ? '2px solid var(--color-accent, #1E3A5F)' : '1px solid var(--color-border-default)',
                  background: on ? 'var(--color-accent-bg, #EDECE6)' : 'transparent',
                }}>{p.label}</button>
              )
            })}
          </div>

          <div style={qLabel}>¿Por distancia o por tiempo?</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            <button onClick={() => { setRoadBy('minutes'); clearComputed() }} style={toggle(roadBy === 'minutes')}>Por tiempo</button>
            <button onClick={() => { setRoadBy('meters'); clearComputed() }} style={toggle(roadBy === 'meters')}>Por distancia</button>
          </div>

          {roadBy === 'minutes' ? (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={qLabel}>Tiempo {profileWord}</span>
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-terracota, #D67442)' }}>{minutes} min</span>
              </div>
              <input type="range" min={5} max={45} step={5} value={minutes}
                onChange={e => { setMinutes(parseInt(e.target.value, 10)); clearComputed(); setFeeSuggested(false) }} style={{ width: '100%' }} />
            </div>
          ) : (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={qLabel}>Distancia de ruta</span>
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-terracota, #D67442)' }}>{routeKm} km</span>
              </div>
              <input type="range" min={1} max={15} step={1} value={routeKm}
                onChange={e => { setRouteKm(parseInt(e.target.value, 10)); clearComputed(); setFeeSuggested(false) }} style={{ width: '100%' }} />
            </div>
          )}
          <button onClick={handleCalc} disabled={calc} style={calcBtn}>{calc ? 'Calculando…' : '🗺️ Ver alcance en el mapa'}</button>
        </>
      )}

      {family === 'postal' && (
        <div style={{ marginBottom: 12 }}>
          <div style={qLabel}>¿A qué códigos postales repartes?</div>
          <textarea value={postalText} onChange={e => setPostalText(e.target.value)}
            placeholder="28027, 28022, 28002" rows={2}
            style={{ ...bigInput, resize: 'vertical', fontFamily: 'inherit' }} />
          {postalCodes.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {postalCodes.map(cp => {
                const bad = !isValidEsCp(cp)
                return (
                  <span key={cp} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: 13, padding: '4px 10px', borderRadius: 20,
                    background: bad ? 'var(--color-warning-bg, #FAEEDA)' : 'var(--color-accent-bg, #EDECE6)',
                    color: bad ? 'var(--color-warning, #854F0B)' : 'var(--color-text-primary)',
                    border: bad ? '1px solid var(--color-warning, #854F0B)' : '1px solid var(--color-border-default)',
                  }}>
                    {cp}
                    <button onClick={() => setPostalText(postalCodes.filter(c => c !== cp).join(', '))} title="Quitar" style={{
                      border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', fontSize: 15, lineHeight: 1, padding: 0,
                    }}>×</button>
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )}

      {family === 'draw' && (
        <div style={{
          fontSize: 13, padding: '12px 14px', borderRadius: 12, marginBottom: 12,
          background: 'var(--color-accent-bg, #EDECE6)', color: 'var(--color-text-secondary)', lineHeight: 1.4,
        }}>
          Dibuja tu zona en el mapa: haz clic para marcar cada esquina y doble clic
          para cerrarla. Luego puedes arrastrar los puntos para ajustarla.
        </div>
      )}

      {/* Precio, en lenguaje humano + botón sugerir */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '18px 0 6px', minHeight: 30 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.2 }}>Precio de envío</span>
        {canSuggest && (
          <button onClick={suggestPrice} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, lineHeight: 1, flexShrink: 0,
            fontSize: 12.5, fontWeight: 600, padding: '5px 10px', borderRadius: 20, cursor: 'pointer',
            border: '1px solid var(--color-terracota, #D67442)', background: 'transparent',
            color: 'var(--color-terracota, #D67442)',
          }}>✨ Sugerir precio</button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1.2 }}>
          <div style={{ position: 'relative' }}>
            <input style={{
              ...bigInput, paddingRight: 26,
              borderColor: feeSuggested ? 'var(--color-success, #3F5C2F)' : 'var(--color-border-default)',
            }} value={fee} onChange={e => { setFee(e.target.value); setFeeSuggested(false) }} inputMode="decimal" />
            <span style={euroSuffix}>€</span>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <span style={{ ...qLabel, fontWeight: 400, fontSize: 11.5 }}>Pedido mínimo</span>
          <div style={{ position: 'relative' }}>
            <input style={{ ...bigInput, paddingRight: 26 }} value={minOrder} onChange={e => setMinOrder(e.target.value)} inputMode="decimal" placeholder="—" />
            <span style={euroSuffix}>€</span>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <span style={{ ...qLabel, fontWeight: 400, fontSize: 11.5 }}>Tiempo entrega</span>
          <div style={{ position: 'relative' }}>
            <input style={{ ...bigInput, paddingRight: 34 }} value={eta} onChange={e => setEta(e.target.value)} inputMode="numeric" placeholder="—" />
            <span style={{ ...euroSuffix, right: 10 }}>min</span>
          </div>
        </div>
      </div>

      {tips.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 16 }}>
          {tips.map((t, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              fontSize: 13, padding: '9px 12px', borderRadius: 10,
              background: tipBg(t.tone), color: tipColor(t.tone), lineHeight: 1.35,
            }}>
              <span style={{ flexShrink: 0 }}>{t.icon}</span>
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      )}

      {err && <p style={{ color: 'var(--color-danger)', fontSize: 13.5, marginTop: 0 }}>{err}</p>}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={handleSave} disabled={saving} style={{
          flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', fontSize: 15, fontWeight: 600,
          background: 'var(--color-terracota, #D67442)', color: '#fff', cursor: 'pointer', opacity: saving ? 0.6 : 1,
        }}>{saving ? 'Guardando…' : 'Guardar zona'}</button>
        <button onClick={() => finish(onCancel)} disabled={saving} style={{
          padding: '12px 20px', borderRadius: 12, border: '1px solid var(--color-border-default)',
          background: 'transparent', cursor: 'pointer', fontSize: 15,
        }}>Cancelar</button>
      </div>
    </div>
  )
}

const qLabel: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)',
  marginBottom: 8, display: 'block',
}
const bigInput: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 15,
  border: '1px solid var(--color-border-default)', background: 'var(--color-bg-card, #FFFFFF)',
  boxSizing: 'border-box',
}
const euroSuffix: React.CSSProperties = {
  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
  fontSize: 14, color: 'var(--color-text-secondary)', pointerEvents: 'none',
}
function toggle(on: boolean): React.CSSProperties {
  return {
    flex: 1, padding: '9px 0', borderRadius: 10, fontSize: 13, cursor: 'pointer', fontWeight: on ? 600 : 400,
    border: on ? '2px solid var(--color-accent, #1E3A5F)' : '1px solid var(--color-border-default)',
    background: on ? 'var(--color-accent-bg, #EDECE6)' : 'transparent',
  }
}
const calcBtn: React.CSSProperties = {
  width: '100%', padding: '11px 0', borderRadius: 12, marginBottom: 4, fontSize: 14, fontWeight: 600,
  border: '2px solid var(--color-accent, #1E3A5F)', background: 'transparent',
  color: 'var(--color-accent, #1E3A5F)', cursor: 'pointer',
}
