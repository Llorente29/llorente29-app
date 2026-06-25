// src/modules/shop/components/ZoneEditor.tsx
//
// Editor unificado de zona de entrega para HOSTELEROS (Capa 1).
// Métodos: radio rápido / por carretera·km / por carretera·tiempo / códigos
// postales / zona a mano (dibujar el área en el mapa).
// Carretera: selector de MEDIO DE REPARTO (moto/coche/bici/pie) → isócrona Mapbox
// realista. Radio→radio; isócrona y zona a mano→polígono; CP→lista.
//
// COPILOTO DE AYUDAS en vivo: tiempo, zona grande, envío vs mínimo, margen vs
// ticket medio del local (margen general; el por-zona exacto llega con coords de
// raw_tab, frente aparte).
//
// Editar: solo radio se precarga; el resto se recrea.

import { useState } from 'react'
import {
  upsertRadiusZone, upsertPolygonZone, upsertPostalZone, isochrone,
  type DeliveryZone, type TravelProfile,
} from '@/modules/shop/services/deliveryZoneService'

export type ZoneMethodUI = 'radius' | 'meters' | 'minutes' | 'postal' | 'draw'

type Props = {
  locationId: string
  centerLat: number
  centerLng: number
  zone: DeliveryZone | null
  ticketMedio: number | null
  drawnPolygon: GeoJSON.Polygon | null      // polígono que el usuario dibuja en el mapa
  onDraftRadius: (radiusM: number | null) => void
  onDraftPolygon: (poly: GeoJSON.Polygon | null) => void
  onDrawingChange: (drawing: boolean) => void  // pide al mapa entrar/salir de modo dibujo
  onSaved: () => void
  onCancel: () => void
}

const lbl: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }
const inp: React.CSSProperties = { width: '100%' }

function fmtNum(n: number | null): string { return n == null ? '' : String(n).replace('.', ',') }
function approxMin(km: number): number { return Math.max(10, Math.round((km / 18) * 60 / 5) * 5) }

function parsePostalCodes(text: string): string[] {
  const tokens = text.split(/[^0-9]+/).filter(Boolean)
  return Array.from(new Set(tokens))
}
function isValidEsCp(cp: string): boolean { return /^[0-5][0-9]{4}$/.test(cp) }

const PROFILES: { v: TravelProfile; label: string }[] = [
  { v: 'moto', label: '🛵 En moto' },
  { v: 'coche', label: '🚗 En coche' },
  { v: 'bici', label: '🚲 En bici' },
  { v: 'pie', label: '🚶 Andando' },
]

export default function ZoneEditor({
  locationId, centerLat, centerLng, zone, ticketMedio, drawnPolygon,
  onDraftRadius, onDraftPolygon, onDrawingChange, onSaved, onCancel,
}: Props) {
  const editing = zone != null
  const [method, setMethod] = useState<ZoneMethodUI>('radius')
  const [profile, setProfile] = useState<TravelProfile>('moto')
  const [name, setName] = useState(zone?.name ?? '')
  const [fee, setFee] = useState(zone ? fmtNum(zone.delivery_fee) : '2,50')
  const [minOrder, setMinOrder] = useState(zone ? fmtNum(zone.min_order) : '')
  const [eta, setEta] = useState(zone?.eta_min != null ? String(zone.eta_min) : '')

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
  function pickMethod(m: ZoneMethodUI) {
    setMethod(m); setComputedPoly(null); onDraftPolygon(null)
    // Modo dibujo solo en 'draw'.
    onDrawingChange(m === 'draw')
    if (m === 'radius') onDraftRadius(radiusM); else onDraftRadius(null)
  }
  function clearComputed() { setComputedPoly(null); onDraftPolygon(null) }

  function removeCp(cp: string) { setPostalText(postalCodes.filter(c => c !== cp).join(', ')) }

  async function handleCalc() {
    setErr(null); setCalc(true)
    try {
      const poly = method === 'meters'
        ? await isochrone(centerLat, centerLng, { meters: Math.round(routeKm * 1000) }, profile)
        : await isochrone(centerLat, centerLng, { minutes }, profile)
      setComputedPoly(poly); onDraftPolygon(poly); onDraftRadius(null)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setCalc(false)
    }
  }

  function finish(cb: () => void) {
    // Antes de guardar/cancelar, asegura salir del modo dibujo.
    onDrawingChange(false)
    cb()
  }

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
      } else if (method === 'postal') {
        if (postalCodes.length === 0) { setErr('Escribe al menos un código postal.'); setSaving(false); return }
        await upsertPostalZone(zone?.id ?? null, locationId, postalCodes, eco)
      } else if (method === 'draw') {
        if (!drawnPolygon) { setErr('Dibuja la zona en el mapa antes de guardar.'); setSaving(false); return }
        await upsertPolygonZone(zone?.id ?? null, locationId, drawnPolygon, eco)
      } else {
        if (!computedPoly) { setErr('Pulsa “Ver alcance” para calcular la zona antes de guardar.'); setSaving(false); return }
        await upsertPolygonZone(zone?.id ?? null, locationId, computedPoly, eco)
      }
      onDrawingChange(false)
      onSaved()
    } catch (e: any) {
      setErr(e.message); setSaving(false)
    }
  }

  // ── Copiloto de ayudas ──
  const tips: { tone: 'info' | 'warn' | 'good'; text: string }[] = []
  const profileWord = profile === 'moto' ? 'en moto' : profile === 'coche' ? 'en coche' : profile === 'bici' ? 'en bici' : 'andando'

  if (method === 'radius') {
    tips.push({ tone: 'info', text: `Reparto hasta ${(radiusM / 1000).toFixed(1)} km a la redonda · llega en ~${approxMin(radiusM / 1000)} min (aprox.)` })
    if (radiusM / 1000 > 4) tips.push({ tone: 'warn', text: `${(radiusM / 1000).toFixed(1)} km es mucho para comida caliente: puede llegar fría.` })
  } else if (method === 'meters') {
    tips.push({ tone: 'info', text: `Reparto hasta ${routeKm} km de ruta real ${profileWord} (por calles, no en línea recta).` })
    if (routeKm > 5) tips.push({ tone: 'warn', text: `${routeKm} km de ruta es bastante para comida caliente.` })
  } else if (method === 'minutes') {
    tips.push({ tone: 'info', text: `Reparto hasta ${minutes} min ${profileWord} (tiempo real por carretera).` })
    if (minutes > 25) tips.push({ tone: 'warn', text: `${minutes} min puede ser demasiado para que la comida llegue caliente.` })
  } else if (method === 'postal') {
    if (postalCodes.length > 0) tips.push({ tone: 'info', text: `Repartes a ${postalCodes.length} código${postalCodes.length === 1 ? '' : 's'} postal${postalCodes.length === 1 ? '' : 'es'}.` })
    if (postalInvalid.length > 0) tips.push({ tone: 'warn', text: `Estos no parecen códigos postales españoles: ${postalInvalid.join(', ')}. Revísalos.` })
  } else {
    if (drawnPolygon) tips.push({ tone: 'good', text: 'Zona dibujada. Ajusta los puntos en el mapa o guárdala.' })
    else tips.push({ tone: 'info', text: 'Haz clic en el mapa para marcar las esquinas de tu zona; doble clic para cerrarla.' })
  }

  if (isFinite(feeNum) && feeNum > 0 && minOrder.trim()) {
    const min = parseFloat(minOrder.replace(',', '.'))
    if (isFinite(min) && min > 0) {
      const pct = Math.round((feeNum / min) * 100)
      if (pct >= 30) tips.push({ tone: 'warn', text: `El envío (${feeNum.toFixed(2)} €) es el ${pct}% de un pedido mínimo de ${min.toFixed(0)} €: pesa mucho en pedidos pequeños.` })
    }
  }

  if (isFinite(feeNum) && ticketMedio != null && ticketMedio > 0) {
    const pct = Math.round((feeNum / ticketMedio) * 100)
    if (pct <= 12) tips.push({ tone: 'good', text: `Con tu ticket medio de ${ticketMedio.toFixed(2)} €, un envío de ${feeNum.toFixed(2)} € deja margen sano.` })
    else if (pct <= 20) tips.push({ tone: 'info', text: `El envío es el ${pct}% de tu ticket medio (${ticketMedio.toFixed(2)} €): razonable, vigila el margen.` })
    else tips.push({ tone: 'warn', text: `El envío es el ${pct}% de tu ticket medio (${ticketMedio.toFixed(2)} €): se come buena parte del margen.` })
  }

  const tipColor = (t: string) => t === 'warn' ? 'var(--color-warning, #854F0B)' : t === 'good' ? 'var(--color-success, #3F5C2F)' : 'var(--color-text-secondary)'
  const tipBg = (t: string) => t === 'warn' ? 'var(--color-warning-bg, #FAEEDA)' : t === 'good' ? 'var(--color-success-bg, #E2E8DA)' : 'var(--color-accent-bg, #EDECE6)'

  const methodBtn = (m: ZoneMethodUI, label: string) => (
    <button onClick={() => pickMethod(m)} disabled={editing && m !== 'radius'} style={{
      flex: 1, padding: '8px 6px', borderRadius: 8, fontSize: 12.5, cursor: 'pointer',
      border: method === m ? '2px solid var(--color-accent, #1E3A5F)' : '1px solid var(--color-border-default)',
      background: method === m ? 'var(--color-accent-bg, #EDECE6)' : 'transparent',
      opacity: (editing && m !== 'radius') ? 0.4 : 1,
    }}>{label}</button>
  )

  const showProfile = method === 'meters' || method === 'minutes'

  return (
    <div style={{ border: '2px solid var(--color-accent, #1E3A5F)', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{editing ? `Editar · ${zone!.name}` : 'Nueva zona'}</h3>
        <button onClick={() => finish(onCancel)} disabled={saving} title="Cerrar" style={{
          border: 'none', background: 'transparent', cursor: 'pointer',
          color: 'var(--color-text-secondary)', fontSize: 18, lineHeight: 1,
        }}>×</button>
      </div>

      {!editing && (
        <>
          <label style={lbl}>¿Cómo defines la zona?</label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            {methodBtn('radius', 'Radio rápido')}
            {methodBtn('meters', 'Por carretera · km')}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            {methodBtn('minutes', 'Por carretera · tiempo')}
            {methodBtn('postal', 'Códigos postales')}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {methodBtn('draw', '✏️ Zona a mano')}
          </div>
        </>
      )}

      <label style={lbl}>Nombre</label>
      <input style={{ ...inp, marginBottom: 12 }} value={name} onChange={e => setName(e.target.value)} placeholder="Ej. Centro" />

      {showProfile && (
        <>
          <label style={lbl}>¿Cómo repartes?</label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {PROFILES.map(p => (
              <button key={p.v} onClick={() => { setProfile(p.v); clearComputed() }} style={{
                flex: 1, padding: '7px 2px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                border: profile === p.v ? '2px solid var(--color-accent, #1E3A5F)' : '1px solid var(--color-border-default)',
                background: profile === p.v ? 'var(--color-accent-bg, #EDECE6)' : 'transparent',
              }}>{p.label}</button>
            ))}
          </div>
        </>
      )}

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
            onChange={e => { setRouteKm(parseInt(e.target.value, 10)); clearComputed() }}
            style={{ ...inp, marginBottom: 8 }} />
          <button onClick={handleCalc} disabled={calc} style={calcBtn}>{calc ? 'Calculando…' : 'Ver alcance en el mapa'}</button>
        </>
      )}
      {method === 'minutes' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <label style={{ ...lbl, marginBottom: 0 }}>Tiempo {profileWord}</label>
            <span style={{ fontSize: 12, fontWeight: 500 }}>{minutes} min</span>
          </div>
          <input type="range" min={5} max={45} step={5} value={minutes}
            onChange={e => { setMinutes(parseInt(e.target.value, 10)); clearComputed() }}
            style={{ ...inp, marginBottom: 8 }} />
          <button onClick={handleCalc} disabled={calc} style={calcBtn}>{calc ? 'Calculando…' : 'Ver alcance en el mapa'}</button>
        </>
      )}
      {method === 'postal' && (
        <>
          <label style={lbl}>Códigos postales (sepáralos por coma o espacio)</label>
          <textarea value={postalText} onChange={e => setPostalText(e.target.value)}
            placeholder="28027, 28022, 28002" rows={2}
            style={{ ...inp, marginBottom: 8, resize: 'vertical', fontFamily: 'inherit', fontSize: 14 }} />
          {postalCodes.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {postalCodes.map(cp => {
                const bad = !isValidEsCp(cp)
                return (
                  <span key={cp} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: 12.5, padding: '3px 8px', borderRadius: 20,
                    background: bad ? 'var(--color-warning-bg, #FAEEDA)' : 'var(--color-accent-bg, #EDECE6)',
                    color: bad ? 'var(--color-warning, #854F0B)' : 'var(--color-text-primary)',
                    border: bad ? '1px solid var(--color-warning, #854F0B)' : '1px solid var(--color-border-default)',
                  }}>
                    {cp}
                    <button onClick={() => removeCp(cp)} title="Quitar" style={{
                      border: 'none', background: 'transparent', cursor: 'pointer',
                      color: 'inherit', fontSize: 14, lineHeight: 1, padding: 0,
                    }}>×</button>
                  </span>
                )
              })}
            </div>
          )}
        </>
      )}
      {method === 'draw' && (
        <div style={{
          fontSize: 12.5, padding: '10px 12px', borderRadius: 8, marginBottom: 12,
          background: 'var(--color-accent-bg, #EDECE6)', color: 'var(--color-text-secondary)',
        }}>
          Dibuja tu zona en el mapa: haz clic para marcar cada esquina y doble clic
          para cerrarla. Luego puedes arrastrar los puntos para ajustarla.
        </div>
      )}

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
        <button onClick={() => finish(onCancel)} disabled={saving} style={{
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
