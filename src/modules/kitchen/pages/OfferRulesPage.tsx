// src/modules/kitchen/pages/OfferRulesPage.tsx
//
// Reglas del agente de ofertas del Shop (v3 · paso 4b): "automático pero con reglas".
// Edita offers_agent_config.shop_rules. Defaults de cuenta + overrides por marca.
// El suelo de margen 45% es intocable (lo garantiza el agente, no esta pantalla).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Save, Sliders, RotateCcw } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  getShopRules, saveShopRules, listBrandsBasic, parseBand, DEFAULT_RULES,
  OFFER_STATES, type OfferState, type ShopRules, type BrandBasic,
} from '@/modules/kitchen/services/offerRulesService'

type Tri = 'def' | 'on' | 'off'
interface BrandForm { gift: Tri; hh: Tri; lanz: string }

const STATE_LABEL: Record<OfferState, string> = {
  lanzamiento: 'Lanzamiento', urgente: 'Urgente', crecimiento: 'Crecimiento', mantenimiento: 'Mantenimiento',
}

const input = 'w-full px-2.5 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent'
const label = 'block text-[11px] font-medium text-text-secondary mb-1'

export default function OfferRulesPage() {
  const { activeAccountId: accountId } = useActiveAccount()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [brands, setBrands] = useState<BrandBasic[]>([])

  // Defaults (como strings editables).
  const [defBands, setDefBands] = useState<Record<OfferState, string>>({} as any)
  const [hhEnabled, setHhEnabled] = useState(true)
  const [hhMax, setHhMax] = useState('40')
  const [giftEnabled, setGiftEnabled] = useState(true)
  const [giftFloor, setGiftFloor] = useState('12')
  const [giftCap, setGiftCap] = useState('30')
  const [brandForm, setBrandForm] = useState<Record<string, BrandForm>>({})

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true); setError(null)
    try {
      const [{ rules }, bs] = await Promise.all([getShopRules(accountId), listBrandsBasic(accountId)])
      setBrands(bs)
      setDefBands(Object.fromEntries(OFFER_STATES.map((s) => [s, (rules.default.bands[s] ?? []).join(', ')])) as Record<OfferState, string>)
      setHhEnabled(rules.default.happy_hour.enabled)
      setHhMax(String(rules.default.happy_hour.max_pct))
      setGiftEnabled(rules.default.gift.enabled)
      setGiftFloor(String(rules.default.gift.min_floor))
      setGiftCap(String(rules.default.gift.min_cap))
      const bf: Record<string, BrandForm> = {}
      for (const [bid, ov] of Object.entries(rules.brands)) {
        bf[bid] = {
          gift: ov.gift?.enabled === undefined ? 'def' : ov.gift.enabled ? 'on' : 'off',
          hh: ov.happy_hour?.enabled === undefined ? 'def' : ov.happy_hour.enabled ? 'on' : 'off',
          lanz: (ov.bands?.lanzamiento ?? []).join(', '),
        }
      }
      setBrandForm(bf)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando las reglas.')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const bf = useCallback((bid: string): BrandForm => brandForm[bid] ?? { gift: 'def', hh: 'def', lanz: '' }, [brandForm])
  const setBf = (bid: string, patch: Partial<BrandForm>) =>
    setBrandForm((p) => ({ ...p, [bid]: { ...bf(bid), ...patch } }))

  const assemble = useMemo(() => (): ShopRules => {
    const bands = {} as Record<OfferState, number[]>
    for (const s of OFFER_STATES) bands[s] = parseBand(defBands[s] ?? '') ?? DEFAULT_RULES.bands[s]
    const rules: ShopRules = {
      default: {
        bands,
        happy_hour: { enabled: hhEnabled, max_pct: Number(hhMax) || DEFAULT_RULES.happy_hour.max_pct },
        gift: { enabled: giftEnabled, min_floor: Number(giftFloor) || DEFAULT_RULES.gift.min_floor, min_cap: Number(giftCap) || DEFAULT_RULES.gift.min_cap },
      },
      brands: {},
    }
    for (const b of brands) {
      const f = bf(b.id)
      const ov: any = {}
      if (f.gift !== 'def') ov.gift = { enabled: f.gift === 'on' }
      if (f.hh !== 'def') ov.happy_hour = { enabled: f.hh === 'on' }
      const lanz = parseBand(f.lanz)
      if (lanz) ov.bands = { lanzamiento: lanz }
      if (Object.keys(ov).length > 0) rules.brands[b.id] = ov
    }
    return rules
  }, [defBands, hhEnabled, hhMax, giftEnabled, giftFloor, giftCap, brands, bf])

  async function handleSave() {
    if (!accountId) return
    setSaving(true); setError(null); setSaved(false)
    try {
      await saveShopRules(accountId, assemble())
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  function resetDefaults() {
    setDefBands(Object.fromEntries(OFFER_STATES.map((s) => [s, DEFAULT_RULES.bands[s].join(', ')])) as Record<OfferState, string>)
    setHhEnabled(DEFAULT_RULES.happy_hour.enabled); setHhMax(String(DEFAULT_RULES.happy_hour.max_pct))
    setGiftEnabled(DEFAULT_RULES.gift.enabled); setGiftFloor(String(DEFAULT_RULES.gift.min_floor)); setGiftCap(String(DEFAULT_RULES.gift.min_cap))
  }

  if (!accountId) return <div className="p-6 text-sm text-text-secondary">Selecciona una cuenta.</div>

  return (
    <div className="pb-16 max-w-3xl">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-medium text-text-primary flex items-center gap-2"><Sliders size={20} className="text-accent" /> Reglas del agente</h1>
          <p className="text-sm text-text-secondary mt-0.5">Cómo genera el agente las ofertas del Shop. El margen mínimo (45%) es intocable por encima de cualquier regla.</p>
        </div>
        <button type="button" disabled={saving} onClick={() => void handleSave()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent/90 disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>}
      {saved && <div className="mb-4 rounded-lg border border-success/40 bg-success-bg px-3 py-2 text-sm text-success">Reglas guardadas. El agente las usará en su próxima corrida.</div>}

      {loading ? (
        <div className="flex items-center gap-2 py-16 justify-center text-text-secondary"><Loader2 size={18} className="animate-spin" /> Cargando…</div>
      ) : (
        <div className="space-y-6">
          {/* Defaults */}
          <section className="rounded-xl border border-border-default bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-text-primary">Por defecto (toda la cuenta)</h2>
              <button type="button" onClick={resetDefaults} className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"><RotateCcw size={12} /> Restaurar</button>
            </div>

            <div className="mb-4">
              <div className={label}>Bandas de % por estado (el agente rota dentro de la banda por marca y día)</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {OFFER_STATES.map((s) => (
                  <div key={s}>
                    <div className="text-[11px] text-text-secondary/70 mb-0.5">{STATE_LABEL[s]}</div>
                    <input className={input} value={defBands[s] ?? ''} placeholder="25, 20, 15" onChange={(e) => setDefBands((p) => ({ ...p, [s]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-lg border border-border-default p-3">
                <label className="flex items-center gap-2 text-sm text-text-primary mb-2">
                  <input type="checkbox" checked={hhEnabled} onChange={(e) => setHhEnabled(e.target.checked)} /> Happy Hour (en el valle)
                </label>
                <div className={label}>Tope de % de la Happy Hour</div>
                <input className={input} inputMode="numeric" value={hhMax} onChange={(e) => setHhMax(e.target.value)} disabled={!hhEnabled} />
              </div>
              <div className="rounded-lg border border-border-default p-3">
                <label className="flex items-center gap-2 text-sm text-text-primary mb-2">
                  <input type="checkbox" checked={giftEnabled} onChange={(e) => setGiftEnabled(e.target.checked)} /> Plato de regalo (acumulable)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <div><div className={label}>Mínimo €</div><input className={input} inputMode="numeric" value={giftFloor} onChange={(e) => setGiftFloor(e.target.value)} disabled={!giftEnabled} /></div>
                  <div><div className={label}>Tope mínimo €</div><input className={input} inputMode="numeric" value={giftCap} onChange={(e) => setGiftCap(e.target.value)} disabled={!giftEnabled} /></div>
                </div>
              </div>
            </div>
          </section>

          {/* Overrides por marca */}
          <section className="rounded-xl border border-border-default bg-card p-4">
            <h2 className="text-sm font-medium text-text-primary mb-1">Por marca (opcional)</h2>
            <p className="text-xs text-text-secondary mb-3">Deja "Por defecto" para que la marca herede las reglas de arriba. Ej: una marca premium que nunca baje del 20% → banda de lanzamiento "20"; una marca sin regalo → Regalo "No".</p>
            <div className="space-y-2">
              {brands.map((b) => {
                const f = bf(b.id)
                return (
                  <div key={b.id} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center rounded-lg border border-border-default px-3 py-2">
                    <div className="text-sm text-text-primary truncate">{b.name}</div>
                    <div>
                      <div className="text-[10px] text-text-secondary/70">Regalo</div>
                      <select className={input} value={f.gift} onChange={(e) => setBf(b.id, { gift: e.target.value as Tri })}>
                        <option value="def">Por defecto</option><option value="on">Sí</option><option value="off">No</option>
                      </select>
                    </div>
                    <div>
                      <div className="text-[10px] text-text-secondary/70">Happy Hour</div>
                      <select className={input} value={f.hh} onChange={(e) => setBf(b.id, { hh: e.target.value as Tri })}>
                        <option value="def">Por defecto</option><option value="on">Sí</option><option value="off">No</option>
                      </select>
                    </div>
                    <div>
                      <div className="text-[10px] text-text-secondary/70">Banda lanzamiento</div>
                      <input className={input} value={f.lanz} placeholder="por defecto" onChange={(e) => setBf(b.id, { lanz: e.target.value })} />
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
