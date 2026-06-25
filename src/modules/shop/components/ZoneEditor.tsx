// src/modules/shop/components/ZoneEditor.tsx
//
// Editor unificado de zona de entrega para HOSTELEROS (Capa 1).
// Tres métodos en un solo panel, con selector arriba:
//   - radio  : círculo rápido (aprox.)
//   - meters : por carretera · distancia de ruta (isócrona Mapbox por metros)
//   - minutes: por carretera · tiempo (isócrona Mapbox por minutos) — el "Google Maps"
// Las isócronas se calculan en Mapbox (botón "Ver alcance") y se guardan como
// polígono (upsertPolygonZone). El radio se guarda como radio (upsertRadiusZone).
//
// COPILOTO DE AYUDAS en vivo (lo que nadie más tiene):
//   - tiempo estimado / real
//   - aviso de zona grande (comida fría)
//   - aviso envío vs pedido mínimo
//   - aviso de MARGEN general (ticket medio del local − envío)  [Nivel 3 "general"]
// El margen por-zona EXACTO llega cuando se extraigan coords de raw_tab (frente aparte).
//
// Editar: de momento solo zonas de radio (se precargan); las de carretera se
// recrean (la edición fina de isócrona llega después). Crear: los tres métodos.

import { useState } from 'react'
import {
  upsertRadiusZone, upsertPolygonZone, isochrone,
  type DeliveryZone,
} from '@/modules/shop/services/deliveryZoneService'

export type ZoneMethodUI = 'radius' | 'meters' | 'minutes'

type Props = {
  locationId: string
  centerLat: number
  centerLng: number
  zone: DeliveryZone | null            // null = crear; con datos = editar (solo radio)
  ticketMedio: number | null           // ticket medio del local (para aviso de margen)
  // Preview en el mapa: la página controla qué se pinta.
  onDraftRadius: (radiusM: number | null) => void
  onDraftPolygon: (poly: GeoJSON.Polygon | null) => void
  onSaved: () => void
  onCancel: () => void
}

const lbl: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }
const inp: React.CSSProperties = { width: '100%' }

function fmtNum(n: number | null): string { return n == null ? '' : String(n).replace('.', ',') }

// Estimación de minutos de relleno desde distancia (reparto urbano ~18 km/h).
function approxMin(km: number): number { return Math.max(10, Math.round((km / 18) * 60 / 5) * 5) }

export default function ZoneEditor({
  locationId, centerLat, centerLng, zone, ticketMedio,
  onDraftRadius, onDraftPolygon, onSaved, onCancel,
}: Props) {
  const editing = zone != null
  // Si editamos, solo radio (precargado). Si creamos, método elegible.
  const [method, setMethod] = useState<ZoneMethodUI>('radius')
  const [name, setName] = useState(zone?.name ?? '')
  const [fee, setFee] = useState(zone ? fmtNum(zone.delivery_fee) : '2,50')
  const [minOrder, setMinOrder] = useState(zone ? fmtNum(zone.min_order) : '')
  const [eta, setEta] = useState(zone?.eta_min != null ? String(zone.eta_min) : '')

  // Controles por método.
  const [radiusM, setRadiusM] = useState(zone?.radius_m ?? 2000)   // radio (m)
  const [routeKm, setRouteKm] = useState(3)                        // distancia de ruta (km)
  const [minutes, setMinutes] = useState(20)                       // tiempo (min)

  // Polígono calculado por Mapbox (para meters/minutes), pendiente de guardar.
  const [computedPoly, setComputedPoly] = useState<GeoJSON.Polygon | null>(null)
  const [calc, setCalc] = useState(false)

  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const feeNum = parseFloat(fee.replace(',', '.'))

  // ── Preview en el mapa según método ──
  function refreshRadiusPreview(m: number) {
    setRadiusM(m); setComputedPoly(null); onDraftPolygon(null); onDraftRadius(m)
  }
  function pickMethod(m: ZoneMethodUI) {
    setMethod(m); setComputedPoly(null); onDraftPolygon(null)
    if (m === 'radius') onDraftRadius(radiusM)
    else onDraftRadius(null) // los de carretera no muestran círculo; esperan "Ver alcance"
  }

  // ── Calcular alcance por carretera (Mapbox) ──
  async function handleCalc() {
    setErr(null); setCalc(true)
    try {
      const poly = method === 'meters'
        ? await isochrone(centerLat, centerLng, { meters: Math.round(routeKm * 1000) })
        : await isochrone(centerLat, centerLng, { minutes })
      setComputedPoly(poly); onDraftPolygon(poly); onDraftRadius(null)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setCalc(false)
    }
  }

  // ── Guardar ──
  async function handleSave() {
    setErr(null)
    if (!name.trim()) { setErr('Pon un nombre a la zona.'); return }
    if (!isFinite(feeNum) || feeNum < 0) { setErr('El coste debe ser un número válido.'); return }

    const eco = {
      name: name.trim(),
      delivery_fee: feeNum,
      min_order: minOrder.trim() ? parseFloat(minOrder.replace(',', '.')) : null,
      eta_min: eta.trim() ? parseInt(eta, 10) : null,
    }
    setSaving(true)
    try {
      if (method === 'radius') {
        await upsertRadiusZone(zone?.id ?? null, locationId, radiusM, centerLat, centerLng, eco)
      } else {
        if (!computedPoly) { setErr('Pulsa “Ver alcance” para calcular la zona antes de guardar.'); setSaving(false); return }
        await upsertPolygonZone(zone?.id ?? null, locationId, computedPoly, eco)
      }
      onSaved()
    } catch (e: any) {
      setErr(e.message); setSaving(false)
    }
  }

  // ── Copiloto de ayudas (en vivo) ──
  const tips: { tone: 'info' | 'warn' | 'good'; text: string }[] = []

  // tiempo
  if (method === 'radius') {
    tips.push({ tone: 'info', text: `Reparto hasta ${(radiusM / 1000).toFixed(1)} km a la redonda · llega en ~${approxMin(radiusM / 1000)} min (aprox.)` })
    if (radiusM / 1000 > 4) tips.push({ tone: 'warn', text: `${(radiusM / 1000).toFixed(1)} km es mucho para comida caliente: puede llegar fría y el reparto se encarece.` })
  } else if (method === 'meters') {
    tips.push({ tone: 'info', text: `Reparto hasta ${routeKm} km de ruta real (por calles, no en línea recta).` })
    if (routeKm > 5) tips.push({ tone: 'warn', text: `${routeKm} km de ruta es bastante para comida caliente.` })
  } else {
    tips.push({ tone: 'info', text: `Reparto hasta ${minutes} min conduciendo (tiempo real por carretera).` })
    if (minutes > 25) tips.push({ tone: 'warn', text: `${minutes} min puede ser demasiado para que la comida llegue caliente.` })
  }

  // envío vs mínimo
  if (isFinite(feeNum) && feeNum > 0 && minOrder.trim()) {
    const min = parseFloat(minOrder.replace(',', '.'))
    if (isFinite(min) && min > 0) {
      const pct = Math.round((feeNum / min) * 100)
      if (pct >= 30) tips.push({ tone: 'warn', text: `El envío (${feeNum.toFixed(2)} €) es el ${pct}% de un pedido mínimo de ${min.toFixed(0)} €: pesa mucho en pedidos pequeños.` })
    }
  }

  // margen general (Nivel 3 "general") con ticket medio del local
  if (isFinite(feeNum) && ticketMedio != null && ticketMedio > 0) {
    const pct = Math.round((feeNum / ticketMedio) * 100)
    if (pct <= 12) tips.push({ tone: 'good', text: `Con tu ticket medio de ${ticketMedio.toFixed(2)} €, un envío de ${feeNum.toFixed(2)} € deja margen sano.` })
    else if (pct <= 20) tips.push({ tone: 'info', text: `El envío es el ${pct}% de tu ticket medio (${ticketMedio.toFixed(2)} €): razonable, vigila el margen.` })
    else tips.push({ tone: 'warn', text: `El envío es el ${pct}% de tu ticket medio (${ticketMedio.toFixed(2)} €): se come buena parte del margen.` })
  }

  const tipColor = (t: string) =>
    t === 'warn' ? 'var(--color-warning, #854F0B)' : t === 'good' ? 'var(--color-success, #3F5C2F)' : 'var(--color-text-secondary)'
  const tipBg = (t: string) =>
    t === 'warn' ? 'var(--color-warning-bg, #FAEEDA)' : t === 'good' ? 'var(--color-success-bg, #EAF3DE)' : 'var(--color-accent-bg, #EDECE6)'

  const methodBtn = (m: ZoneMethodUI, label: string) => (
    <button onClick={() => pickMethod(m)} disabled={editing && m !== 'radius'} style={{
      flex: 1, padding: '8px 6px', borderRadius: 8, fontSize: 12.5, cursor: 'pointer',
      border: method === m ? '2px solid var(--color-accent, #1E3A5F)' : '1px solid var(--color-border-default)',
      background: method === m ? 'var(--color-accent-bg, #EDECE6)' : 'transparent',
      opacity: (editing && m !== 'radius') ? 0.4 : 1,
    }}>{label}</button>
  )

  return (
    <div style={{ border: '2px solid var(--color-accent, #1E3A5F)', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{editing ? `Editar · ${zone!.name}` : 'Nueva zona'}</h3>
        <button onClick={onCancel} disabled={saving} title="Cerrar" style={{
          border: 'none', background: 'transparent', cursor: 'pointer',
          color: 'var(--color-text-secondary)', fontSize: 18, lineHeight: 1,
        }}>×</button>
      </div>

      {/* Selector de método (oculto al editar: solo radio editable de momento) */}
      {!editing && (
        <>
          <label style={lbl}>¿Cómo defines la zona?</label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {methodBtn('radius', 'Radio rápido')}
            {methodBtn('meters', 'Por carretera · km')}
            {methodBtn('minutes', 'Por carretera · tiempo')}
          </div>
        </>
      )}

      <label style={lbl}>Nombre</label>
      <input style={{ ...inp, marginBottom: 12 }} value={name} onChange={e => setName(e.target.value)} placeholder="Ej. Centro" />

      {/* Control según método */}
      {method === 'radius' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <label style={{ ...lbl, marginBottom: 0 }}>Radio</label>
            <span style={{ fontSize: 12, fontWeight: 500 }}>{(radiusM / 1000).toFixed(1)} km</span>
          </div>
          <input type="range" min={500} max={6000} step={100} value={radiusM}
            onChange={e => refreshRadiusPreview(parseInt(e.target.value, 10))}
            style={{ ...inp, marginBottom: 12 }} />
        </>
      )}
      {method === 'meters' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <label style={{ ...lbl, marginBottom: 0 }}>Distancia de ruta</label>
            <span style={{ fontSize: 12, fontWeight: 500 }}>{routeKm} km</span>
          </div>
          <input type="range" min={1} max={15} step={1} value={routeKm}
            onChange={e => { setRouteKm(parseInt(e.target.value, 10)); setComputedPoly(null); onDraftPolygon(null) }}
            style={{ ...inp, marginBottom: 8 }} />
          <button onClick={handleCalc} disabled={calc} style={calcBtn}>{calc ? 'Calculando…' : 'Ver alcance en el mapa'}</button>
        </>
      )}
      {method === 'minutes' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <label style={{ ...lbl, marginBottom: 0 }}>Tiempo conduciendo</label>
            <span style={{ fontSize: 12, fontWeight: 500 }}>{minutes} min</span>
          </div>
          <input type="range" min={5} max={45} step={5} value={minutes}
            onChange={e => { setMinutes(parseInt(e.target.value, 10)); setComputedPoly(null); onDraftPolygon(null) }}
            style={{ ...inp, marginBottom: 8 }} />
          <button onClick={handleCalc} disabled={calc} style={calcBtn}>{calc ? 'Calculando…' : 'Ver alcance en el mapa'}</button>
        </>
      )}

      {/* Económico */}
      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Coste €</label>
          <input style={inp} value={fee} onChange={e => setFee(e.target.value)} inputMode="decimal" />
        </div>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Mínimo €</label>
          <input style={inp} value={minOrder} onChange={e => setMinOrder(e.target.value)} inputMode="decimal" placeholder="—" />
        </div>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Tiempo min</label>
          <input style={inp} value={eta} onChange={e => setEta(e.target.value)} inputMode="numeric" placeholder="—" />
        </div>
      </div>

      {/* Copiloto de ayudas */}
      {tips.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {tips.map((t, i) => (
            <div key={i} style={{
              fontSize: 12.5, padding: '7px 10px', borderRadius: 8,
              background: tipBg(t.tone), color: tipColor(t.tone),
            }}>{t.text}</div>
          ))}
        </div>
      )}

      {err && <p style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 0 }}>{err}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handleSave} disabled={saving} style={{
          flex: 1, padding: '9px 0', borderRadius: 8, border: 'none',
          background: 'var(--color-terracota, #D67442)', color: '#fff', cursor: 'pointer',
          opacity: saving ? 0.6 : 1,
        }}>{saving ? 'Guardando…' : 'Guardar'}</button>
        <button onClick={onCancel} disabled={saving} style={{
          padding: '9px 16px', borderRadius: 8, border: '1px solid var(--color-border-default)',
          background: 'transparent', cursor: 'pointer',
        }}>Cancelar</button>
      </div>
    </div>
  )
}

const calcBtn: React.CSSProperties = {
  width: '100%', padding: '8px 0', borderRadius: 8, marginBottom: 4,
  border: '1px solid var(--color-accent, #1E3A5F)', background: 'transparent',
  color: 'var(--color-accent, #1E3A5F)', cursor: 'pointer', fontSize: 13,
}
