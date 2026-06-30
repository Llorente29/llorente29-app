// src/modules/shop/components/ZoneEditor.tsx
//
// Editor de zona de entrega para HOSTELEROS (Capa 1) — chrome de gestión.
// Rebrand 30/06/2026: reconstruido sobre TOKENS de Folvy (fuera inline-styles
// y var(--color-*) con fallbacks viejos terracota/navy). Misma UX cálida y
// MISMA lógica (radio / por carretera / CP / a mano), copiloto de avisos y
// precio sugerido. Coherente con el resto de la app.
//
// Flujo en dos preguntas claras en lenguaje de hostelero:
//   1) "¿Hasta dónde repartes?" → 4 tarjetas (radio / por carretera / CP / a mano)
//   2) Solo si "por carretera": medio de reparto + distancia o tiempo
// PRECIO SUGERIDO: propone envío = MAX(suelo, base + €/km × distancia).

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

const SUGGEST_BASE = 2.99
const SUGGEST_PER_KM = 0.45

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

// Estilos compartidos como clases Tailwind (tokens Folvy).
const Q_LABEL = 'text-[13px] font-semibold text-text-primary mb-2 block'
const INPUT = 'w-full px-3 py-2.5 rounded-lg text-[15px] border border-default bg-card text-text-primary outline-none focus:border-accent'
const RANGE = 'w-full accent-[#15171A]'

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
  const [feeSuggested, setFeeSuggested] = useState(false)

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

  function zoneDistanceKm(): number | null {
    if (family === 'radius') return radiusM / 1000
    if (family === 'road' && roadBy === 'meters') return routeKm
    if (family === 'road' && roadBy === 'minutes') return (minutes / 60) * 18
    return null
  }
  const canSuggest = zoneDistanceKm() != null

  function suggestPrice() {
    const km = zoneDistanceKm()
    if (km == null) return
    const min = minOrder.trim() ? parseFloat(minOrder.replace(',', '.')) : 0
    const byDistance = SUGGEST_BASE + SUGGEST_PER_KM * km
    const suggested = Math.max(SUGGEST_BASE, byDistance)
    setFee(fmtNum(Math.round(suggested * 20) / 20))
    setFeeSuggested(true)
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

  const tipCls = (t: 'info' | 'warn' | 'good') =>
    t === 'warn' ? 'bg-warning-bg text-warning'
    : t === 'good' ? 'bg-success-bg text-success'
    : 'bg-accent-bg text-text-secondary'

  const selectCls = (on: boolean) =>
    on ? 'border-2 border-accent bg-accent-bg' : 'border border-default bg-transparent hover:bg-page'

  return (
    <div className="rounded-2xl border border-default bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-display text-[17px] font-semibold text-text-primary">
          {editing ? `Editar ${zone!.name}` : 'Nueva zona de reparto'}
        </h3>
        <button onClick={() => finish(onCancel)} disabled={saving} title="Cerrar"
          className="text-text-secondary hover:text-text-primary text-2xl leading-none">×</button>
      </div>

      {!editing && (
        <>
          <span className={Q_LABEL}>¿Hasta dónde repartes?</span>
          <div className="grid grid-cols-2 gap-2 mb-5">
            {FAMILIES.map(f => {
              const on = family === f.v
              return (
                <button key={f.v} onClick={() => pickFamily(f.v)}
                  className={`text-left p-3.5 rounded-xl transition-colors ${selectCls(on)}`}>
                  <div className="text-lg mb-1">{f.icon}</div>
                  <div className="text-sm font-semibold text-text-primary mb-0.5">{f.title}</div>
                  <div className="text-[11.5px] text-text-secondary leading-tight">{f.hint}</div>
                </button>
              )
            })}
          </div>
        </>
      )}

      <span className={Q_LABEL}>¿Cómo se llama esta zona?</span>
      <input className={`${INPUT} mb-5`} value={name} onChange={e => setName(e.target.value)} placeholder="Ej. Centro, Barrio norte…" />

      {family === 'radius' && (
        <div className="mb-5">
          <div className="flex justify-between mb-1.5">
            <span className={Q_LABEL}>Tamaño del radio</span>
            <span className="text-[15px] font-semibold text-text-primary">{(radiusM / 1000).toFixed(1)} km</span>
          </div>
          <input type="range" min={500} max={6000} step={100} value={radiusM} className={RANGE}
            onChange={e => { refreshRadiusPreview(parseInt(e.target.value, 10)); setFeeSuggested(false) }} />
        </div>
      )}

      {family === 'road' && (
        <>
          <span className={Q_LABEL}>¿Cómo repartes?</span>
          <div className="flex gap-1.5 mb-3.5">
            {PROFILES.map(p => {
              const on = profile === p.v
              return (
                <button key={p.v} onClick={() => { setProfile(p.v); clearComputed() }}
                  className={`flex-1 px-0.5 py-2.5 rounded-lg text-[12.5px] ${on ? 'font-semibold' : ''} ${selectCls(on)}`}>
                  {p.label}
                </button>
              )
            })}
          </div>

          <span className={Q_LABEL}>¿Por distancia o por tiempo?</span>
          <div className="flex gap-1.5 mb-3.5">
            <button onClick={() => { setRoadBy('minutes'); clearComputed() }}
              className={`flex-1 py-2.5 rounded-lg text-[13px] ${roadBy === 'minutes' ? 'font-semibold' : ''} ${selectCls(roadBy === 'minutes')}`}>Por tiempo</button>
            <button onClick={() => { setRoadBy('meters'); clearComputed() }}
              className={`flex-1 py-2.5 rounded-lg text-[13px] ${roadBy === 'meters' ? 'font-semibold' : ''} ${selectCls(roadBy === 'meters')}`}>Por distancia</button>
          </div>

          {roadBy === 'minutes' ? (
            <div className="mb-3">
              <div className="flex justify-between mb-1.5">
                <span className={Q_LABEL}>Tiempo {profileWord}</span>
                <span className="text-[15px] font-semibold text-text-primary">{minutes} min</span>
              </div>
              <input type="range" min={5} max={45} step={5} value={minutes} className={RANGE}
                onChange={e => { setMinutes(parseInt(e.target.value, 10)); clearComputed(); setFeeSuggested(false) }} />
            </div>
          ) : (
            <div className="mb-3">
              <div className="flex justify-between mb-1.5">
                <span className={Q_LABEL}>Distancia de ruta</span>
                <span className="text-[15px] font-semibold text-text-primary">{routeKm} km</span>
              </div>
              <input type="range" min={1} max={15} step={1} value={routeKm} className={RANGE}
                onChange={e => { setRouteKm(parseInt(e.target.value, 10)); clearComputed(); setFeeSuggested(false) }} />
            </div>
          )}
          <button onClick={handleCalc} disabled={calc}
            className="w-full py-2.5 rounded-xl mb-1 text-sm font-semibold border-2 border-accent text-text-primary bg-transparent hover:bg-page disabled:opacity-50">
            {calc ? 'Calculando…' : '🗺️ Ver alcance en el mapa'}
          </button>
        </>
      )}

      {family === 'postal' && (
        <div className="mb-3">
          <span className={Q_LABEL}>¿A qué códigos postales repartes?</span>
          <textarea value={postalText} onChange={e => setPostalText(e.target.value)}
            placeholder="28027, 28022, 28002" rows={2}
            className={`${INPUT} resize-y font-sans`} />
          {postalCodes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {postalCodes.map(cp => {
                const bad = !isValidEsCp(cp)
                return (
                  <span key={cp}
                    className={`inline-flex items-center gap-1.5 text-[13px] px-2.5 py-1 rounded-full border ${
                      bad ? 'bg-warning-bg text-warning border-warning/40' : 'bg-accent-bg text-text-primary border-default'
                    }`}>
                    {cp}
                    <button onClick={() => setPostalText(postalCodes.filter(c => c !== cp).join(', '))} title="Quitar"
                      className="text-[15px] leading-none">×</button>
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )}

      {family === 'draw' && (
        <div className="text-[13px] px-3.5 py-3 rounded-xl mb-3 bg-accent-bg text-text-secondary leading-relaxed">
          Dibuja tu zona en el mapa: haz clic para marcar cada esquina y doble clic
          para cerrarla. Luego puedes arrastrar los puntos para ajustarla.
        </div>
      )}

      {/* Precio + sugerir */}
      <div className="flex items-center justify-between gap-2 mt-5 mb-1.5 min-h-[30px]">
        <span className="text-[13px] font-semibold text-text-primary">Precio de envío</span>
        {canSuggest && (
          <button onClick={suggestPrice}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-2.5 py-1.5 rounded-full border border-accent text-text-primary bg-transparent hover:bg-page shrink-0">
            ✨ Sugerir precio
          </button>
        )}
      </div>
      <div className="flex gap-2.5 mb-3.5">
        <div className="flex-[1.2]">
          <div className="relative">
            <input
              className={`${INPUT} pr-7 ${feeSuggested ? 'border-success' : ''}`}
              value={fee} onChange={e => { setFee(e.target.value); setFeeSuggested(false) }} inputMode="decimal" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-secondary pointer-events-none">€</span>
          </div>
        </div>
        <div className="flex-1">
          <span className="text-[11.5px] text-text-secondary block mb-1">Pedido mínimo</span>
          <div className="relative">
            <input className={`${INPUT} pr-7`} value={minOrder} onChange={e => setMinOrder(e.target.value)} inputMode="decimal" placeholder="—" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-secondary pointer-events-none">€</span>
          </div>
        </div>
        <div className="flex-1">
          <span className="text-[11.5px] text-text-secondary block mb-1">Tiempo entrega</span>
          <div className="relative">
            <input className={`${INPUT} pr-9`} value={eta} onChange={e => setEta(e.target.value)} inputMode="numeric" placeholder="—" />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-text-secondary pointer-events-none">min</span>
          </div>
        </div>
      </div>

      {tips.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-4">
          {tips.map((t, i) => (
            <div key={i} className={`flex items-start gap-2 text-[13px] px-3 py-2 rounded-lg leading-snug ${tipCls(t.tone)}`}>
              <span className="shrink-0">{t.icon}</span>
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      )}

      {err && <p className="text-danger text-[13.5px] mt-0 mb-3">{err}</p>}

      <div className="flex gap-2.5">
        <button onClick={handleSave} disabled={saving}
          className="flex-1 py-3 rounded-xl text-[15px] font-semibold bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-60">
          {saving ? 'Guardando…' : 'Guardar zona'}
        </button>
        <button onClick={() => finish(onCancel)} disabled={saving}
          className="px-5 py-3 rounded-xl border border-default text-text-primary bg-transparent hover:bg-page text-[15px]">
          Cancelar
        </button>
      </div>
    </div>
  )
}
