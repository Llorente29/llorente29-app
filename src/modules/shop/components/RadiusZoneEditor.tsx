// src/modules/shop/components/RadiusZoneEditor.tsx
//
// Editor de una zona de RADIO (Capa 1). Sirve para CREAR (zone=null) y EDITAR
// (zone con datos). Panel simple para un manager no técnico: nombre + radio
// (slider) + coste/mínimo/tiempo. El círculo se previsualiza en vivo en el mapa
// (la página pasa el radio actual como draft). Guarda vía upsertRadiusZone, que
// con id != null actualiza (la geometría la construye la RPC en SQL).

import { useState } from 'react'
import { upsertRadiusZone, type DeliveryZone } from '@/modules/shop/services/deliveryZoneService'

type Props = {
  locationId: string
  centerLat: number
  centerLng: number
  zone: DeliveryZone | null          // null = crear; con datos = editar
  radiusM: number                    // radio actual (controlado por la página para el preview)
  onRadiusChange: (m: number) => void
  onSaved: () => void
  onCancel: () => void
}

const lbl: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }
const inp: React.CSSProperties = { width: '100%' }

function fmtNum(n: number | null): string {
  return n == null ? '' : String(n).replace('.', ',')
}

export default function RadiusZoneEditor({
  locationId, centerLat, centerLng, zone, radiusM, onRadiusChange, onSaved, onCancel,
}: Props) {
  const editing = zone != null
  const [name, setName] = useState(zone?.name ?? '')
  const [fee, setFee] = useState(zone ? fmtNum(zone.delivery_fee) : '2,50')
  const [minOrder, setMinOrder] = useState(zone ? fmtNum(zone.min_order) : '')
  const [eta, setEta] = useState(zone?.eta_min != null ? String(zone.eta_min) : '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const km = (radiusM / 1000).toFixed(1)

  async function handleSave() {
    setErr(null)
    const feeNum = parseFloat(fee.replace(',', '.'))
    if (!name.trim()) { setErr('Pon un nombre a la zona.'); return }
    if (!isFinite(feeNum) || feeNum < 0) { setErr('El coste debe ser un número válido.'); return }
    setSaving(true)
    try {
      await upsertRadiusZone(zone?.id ?? null, locationId, radiusM, centerLat, centerLng, {
        name: name.trim(),
        delivery_fee: feeNum,
        min_order: minOrder.trim() ? parseFloat(minOrder.replace(',', '.')) : null,
        eta_min: eta.trim() ? parseInt(eta, 10) : null,
      })
      onSaved()
    } catch (e: any) {
      setErr(e.message); setSaving(false)
    }
  }

  return (
    <div style={{
      border: '2px solid var(--color-accent, #1E3A5F)', borderRadius: 12, padding: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{editing ? `Editar · ${zone!.name}` : 'Nueva zona de radio'}</h3>
        <button onClick={onCancel} disabled={saving} title="Cerrar" style={{
          border: 'none', background: 'transparent', cursor: 'pointer',
          color: 'var(--color-text-secondary)', fontSize: 18, lineHeight: 1,
        }}>×</button>
      </div>

      <label style={lbl}>Nombre</label>
      <input style={{ ...inp, marginBottom: 12 }} value={name} onChange={e => setName(e.target.value)} placeholder="Ej. Centro" />

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <label style={{ ...lbl, marginBottom: 0 }}>Radio</label>
        <span style={{ fontSize: 12, fontWeight: 500 }}>{km} km</span>
      </div>
      <input
        type="range" min={500} max={6000} step={100} value={radiusM}
        onChange={e => onRadiusChange(parseInt(e.target.value, 10))}
        style={{ ...inp, marginBottom: 12 }}
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
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

      {err && <p style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 0 }}>{err}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handleSave} disabled={saving} style={{
          flex: 1, padding: '9px 0', borderRadius: 8, border: 'none',
          background: 'var(--color-terracota, #D67442)', color: '#fff', cursor: 'pointer',
          opacity: saving ? 0.6 : 1,
        }}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
        <button onClick={onCancel} disabled={saving} style={{
          padding: '9px 16px', borderRadius: 8, border: '1px solid var(--color-border-default)',
          background: 'transparent', cursor: 'pointer',
        }}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
