// src/admin/pages/PlanesPreciosPage.tsx
//
// Catálogo de precios (Portal de staff): editar precios de los planes y de los
// add-ons. Cada fila se guarda por separado vía RPC; el cambio queda en Auditoría.

import { useEffect, useState } from 'react'
import {
  listPricing, setPlanPricing, setSubmodulePrice,
  type PlanPricing, type AddonPricing,
} from '../services/pricingService'

export default function PlanesPreciosPage() {
  const [plans, setPlans] = useState<PlanPricing[]>([])
  const [addons, setAddons] = useState<AddonPricing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function reload() {
    setLoading(true); setError(null)
    try {
      const { plans, addons } = await listPricing()
      setPlans(plans); setAddons(addons)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [])

  function flash(msg: string) { setNotice(msg); setTimeout(() => setNotice(null), 3500) }

  if (loading) return <p className="text-sm" style={{ color: 'var(--color-text-secondary, #888)' }}>Cargando precios…</p>

  // Agrupar add-ons por módulo.
  const byModule = addons.reduce<Record<string, AddonPricing[]>>((acc, a) => {
    (acc[a.module] ??= []).push(a); return acc
  }, {})

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-display font-medium mb-1" style={{ color: 'var(--color-accent)' }}>Planes y precios</h1>
      <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary, #666)' }}>
        Precios de catálogo. Estimados hasta conectar Stripe. Cada cambio queda en Auditoría.
      </p>

      {notice && <div className="rounded-lg p-3 mb-4" style={{ background: '#ECF7EC', border: '1px solid #A8D3A8' }}><p className="text-sm" style={{ color: '#2F6B2F' }}>{notice}</p></div>}
      {error && <div className="rounded-lg p-3 mb-4" style={{ background: '#FDECEC', border: '1px solid #E5A0A0' }}><p className="text-sm" style={{ color: '#A12626' }}>{error}</p></div>}

      <h2 className="text-base font-display font-medium mb-2" style={{ color: 'var(--color-accent)' }}>Planes</h2>
      <div className="flex flex-col gap-3 mb-8">
        {plans.map(p => <PlanRow key={p.id} plan={p} onError={setError} onSaved={msg => { flash(msg); reload() }} />)}
      </div>

      <h2 className="text-base font-display font-medium mb-2" style={{ color: 'var(--color-accent)' }}>Módulos extra (add-ons)</h2>
      <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary, #888)' }}>
        Precio mensual de cada add-on contratable suelto. Al activarlo a un cliente, este precio se aplica (editable por cliente).
      </p>
      {Object.entries(byModule).map(([mod, list]) => (
        <div key={mod} className="mb-5">
          <p className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-secondary, #999)' }}>{mod}</p>
          <div className="flex flex-col gap-2">
            {list.map(a => <AddonRow key={a.id} addon={a} onError={setError} onSaved={msg => { flash(msg); reload() }} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

function PlanRow({ plan, onError, onSaved }: { plan: PlanPricing; onError: (m: string) => void; onSaved: (m: string) => void }) {
  const [base, setBase] = useState(String(plan.basePriceEur))
  const [perLoc, setPerLoc] = useState(String(plan.perLocationPrice))
  const [max, setMax] = useState(String(plan.maxLocations))
  const [saving, setSaving] = useState(false)

  const dirty = base !== String(plan.basePriceEur) || perLoc !== String(plan.perLocationPrice) || max !== String(plan.maxLocations)

  async function save() {
    setSaving(true); onError('')
    const res = await setPlanPricing(plan.id, Number(base), Number(perLoc), Number(max))
    setSaving(false)
    if (!res.ok) { onError(res.error); return }
    onSaved(`Plan ${plan.name} actualizado.`)
  }

  return (
    <div className="rounded-lg p-4" style={{ border: '1px solid var(--color-border, #e5e5e5)', background: 'var(--color-bg-surface, #fff)' }}>
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-sm font-medium w-40" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>{plan.name}</span>
        <NumField label="Base €/mes" value={base} onChange={setBase} />
        <NumField label="€/local extra" value={perLoc} onChange={setPerLoc} />
        <NumField label="Locales incl." value={max} onChange={setMax} hint="0 = ilimitado" />
        <button type="button" onClick={save} disabled={!dirty || saving}
          className="px-4 py-1.5 rounded-md text-sm font-medium ml-auto"
          style={{ background: 'var(--color-terracota)', color: '#fff', opacity: (!dirty || saving) ? 0.5 : 1 }}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  )
}

function AddonRow({ addon, onError, onSaved }: { addon: AddonPricing; onError: (m: string) => void; onSaved: (m: string) => void }) {
  const [price, setPrice] = useState(String(addon.priceEur))
  const [saving, setSaving] = useState(false)
  const dirty = price !== String(addon.priceEur)

  async function save() {
    setSaving(true); onError('')
    const res = await setSubmodulePrice(addon.id, Number(price))
    setSaving(false)
    if (!res.ok) { onError(res.error); return }
    onSaved(`Precio de ${addon.name} actualizado.`)
  }

  return (
    <div className="flex items-center gap-4 rounded-md px-3 py-2" style={{ border: '1px solid var(--color-border, #eee)', background: 'var(--color-bg-surface, #fff)' }}>
      <span className="text-sm flex-1 min-w-0 truncate" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>{addon.name}</span>
      <NumField label="€/mes" value={price} onChange={setPrice} />
      <button type="button" onClick={save} disabled={!dirty || saving}
        className="px-3 py-1.5 rounded-md text-sm font-medium"
        style={{ background: 'var(--color-terracota)', color: '#fff', opacity: (!dirty || saving) ? 0.5 : 1 }}>
        {saving ? '…' : 'Guardar'}
      </button>
    </div>
  )
}

function NumField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div>
      <label className="block text-[11px] mb-0.5" style={{ color: 'var(--color-text-secondary, #888)' }}>{label}</label>
      <input type="number" min="0" step="0.01" value={value} onChange={e => onChange(e.target.value)}
        className="w-24 px-2 py-1.5 rounded-md text-sm" style={{ border: '1px solid var(--color-border, #ccc)' }} />
      {hint && <span className="block text-[10px] mt-0.5" style={{ color: 'var(--color-text-secondary, #aaa)' }}>{hint}</span>}
    </div>
  )
}
