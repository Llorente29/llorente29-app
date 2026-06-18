// src/admin/pages/CuentaDetallePage.tsx
//
// Detalle de una cuenta cliente — panel superadmin. Sesión 16 (ficha completa).
//
// Edita: datos fiscales, dirección de facturación (desglose del jsonb
// billing_address), contacto de facturación y localización. Reusa
// updateAccount() y setAccountStatus() del service.

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getAccountById, updateAccount, setAccountStatus } from '@/modules/multitenancy/services/accountsService'
import type { Account, AccountStatus, AccountUpdate } from '@/types/multitenancy'
import { getCatalog, getAccountItems, setAccountModules, type CatalogModule } from '@/platform/accountModulesService'
import { getAccountDiscount, setAccountDiscount, clearAccountDiscount, type AccountDiscount } from '@/admin/services/pricingService'
import IntegrationsSection from '@/admin/components/IntegrationsSection'
import AccountLogoUploader from '@/admin/components/AccountLogoUploader'

type LoadState =
  | { state: 'loading' }
  | { state: 'ready'; account: Account }
  | { state: 'error'; message: string }

interface EditFields {
  name: string
  legalName: string
  cif: string
  billingEmail: string
  billingPhone: string
  // Dirección (desglose de billing_address jsonb).
  addrStreet: string
  addrCity: string
  addrPostalCode: string
  addrProvince: string
  // Localización.
  country: string
  timezone: string
  locale: string
  currency: string
}

const COUNTRY_OPTIONS = [
  { value: 'ES', label: 'España' },
  { value: 'PT', label: 'Portugal' },
  { value: 'FR', label: 'Francia' },
  { value: 'IT', label: 'Italia' },
  { value: 'AD', label: 'Andorra' },
]

const LOCALE_OPTIONS = [
  { value: 'es-ES', label: 'Español (España)' },
  { value: 'ca-ES', label: 'Catalán' },
  { value: 'gl-ES', label: 'Gallego' },
  { value: 'eu-ES', label: 'Euskera' },
  { value: 'pt-PT', label: 'Portugués' },
  { value: 'en-GB', label: 'Inglés' },
]

const CURRENCY_OPTIONS = [
  { value: 'EUR', label: 'Euro (€)' },
  { value: 'USD', label: 'Dólar ($)' },
  { value: 'GBP', label: 'Libra (£)' },
]

const TIMEZONE_OPTIONS = [
  { value: 'Europe/Madrid', label: 'Madrid (CET)' },
  { value: 'Atlantic/Canary', label: 'Canarias (WET)' },
  { value: 'Europe/Lisbon', label: 'Lisboa (WET)' },
  { value: 'Europe/Paris', label: 'París (CET)' },
]

function statusLabel(status: string): string {
  switch (status) {
    case 'active': return 'Activa'
    case 'trial': return 'Trial'
    case 'past_due': return 'Impago'
    case 'suspended': return 'Suspendida'
    case 'canceled': return 'Cancelada'
    default: return status
  }
}

function statusColor(status: string): { bg: string; fg: string } {
  switch (status) {
    case 'active': return { bg: '#E3F0E6', fg: '#1F6B3B' }
    case 'trial': return { bg: '#FBF0DC', fg: '#8A6516' }
    case 'past_due': return { bg: '#FBF0DC', fg: '#8A6516' }
    case 'suspended': return { bg: '#FDECEC', fg: '#A12626' }
    case 'canceled': return { bg: '#ECECEC', fg: '#666' }
    default: return { bg: '#ECECEC', fg: '#666' }
  }
}

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export default function CuentaDetallePage() {
  const { accountId } = useParams<{ accountId: string }>()
  const navigate = useNavigate()
  const [load, setLoad] = useState<LoadState>({ state: 'loading' })
  const [edit, setEdit] = useState<EditFields>({
    name: '', legalName: '', cif: '', billingEmail: '', billingPhone: '',
    addrStreet: '', addrCity: '', addrPostalCode: '', addrProvince: '',
    country: 'ES', timezone: 'Europe/Madrid', locale: 'es-ES', currency: 'EUR',
  })
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)

  // Módulos (Sesión 16).
  const [catalog, setCatalog] = useState<CatalogModule[] | null>(null)
  const [selectedSubmodules, setSelectedSubmodules] = useState<Set<string>>(new Set())
  const [modulesSaving, setModulesSaving] = useState(false)
  const [modulesFeedback, setModulesFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)

  // Descuento (capa de precios P-C).
  const [discount, setDiscount] = useState<AccountDiscount | null>(null)
  const [discType, setDiscType] = useState<'percent' | 'fixed'>('percent')
  const [discValue, setDiscValue] = useState('')
  const [discNote, setDiscNote] = useState('')
  const [discUntil, setDiscUntil] = useState('')
  const [discSaving, setDiscSaving] = useState(false)
  const [discFeedback, setDiscFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)

  function hydrateEdit(acc: Account) {
    const addr = acc.billingAddress ?? {}
    setEdit({
      name: acc.name,
      legalName: acc.legalName ?? '',
      cif: acc.cif ?? '',
      billingEmail: acc.billingEmail ?? '',
      billingPhone: acc.billingPhone ?? '',
      addrStreet: asStr(addr.street),
      addrCity: asStr(addr.city),
      addrPostalCode: asStr(addr.postalCode),
      addrProvince: asStr(addr.province),
      country: acc.country ?? 'ES',
      timezone: acc.timezone ?? 'Europe/Madrid',
      locale: acc.locale ?? 'es-ES',
      currency: acc.currency ?? 'EUR',
    })
  }

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    ;(async () => {
      try {
        const acc = await getAccountById(accountId)
        if (cancelled) return
        if (!acc) {
          setLoad({ state: 'error', message: 'Cuenta no encontrada.' })
          return
        }
        setLoad({ state: 'ready', account: acc })
        hydrateEdit(acc)
      } catch (e) {
        if (!cancelled) setLoad({ state: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => { cancelled = true }
  }, [accountId])

  // Carga catálogo + items de módulos de la cuenta.
  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    ;(async () => {
      try {
        const [cat, items] = await Promise.all([getCatalog(), getAccountItems(accountId)])
        if (cancelled) return
        setCatalog(cat)
        setSelectedSubmodules(new Set(items.filter(i => i.active).map(i => i.submoduleId)))
      } catch (e) {
        if (!cancelled) setModulesFeedback({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => { cancelled = true }
  }, [accountId])

  // Carga el descuento activo de la cuenta.
  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    ;(async () => {
      try {
        const d = await getAccountDiscount(accountId)
        if (!cancelled) setDiscount(d)
      } catch (e) {
        if (!cancelled) setDiscFeedback({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => { cancelled = true }
  }, [accountId])

  function toggleSubmodule(submoduleId: string) {
    setSelectedSubmodules(prev => {
      const next = new Set(prev)
      if (next.has(submoduleId)) next.delete(submoduleId)
      else next.add(submoduleId)
      return next
    })
  }

  async function handleSaveModules() {
    if (!accountId) return
    setModulesSaving(true)
    setModulesFeedback(null)
    try {
      await setAccountModules(accountId, Array.from(selectedSubmodules))
      // Recarga items para reflejar el estado real tras la reconciliación.
      const items = await getAccountItems(accountId)
      setSelectedSubmodules(new Set(items.filter(i => i.active).map(i => i.submoduleId)))
      setModulesFeedback({ kind: 'ok', msg: 'Módulos actualizados.' })
    } catch (e) {
      setModulesFeedback({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setModulesSaving(false)
    }
  }

  async function handleSaveDiscount() {
    if (!accountId) return
    const value = Number(discValue)
    if (!Number.isFinite(value) || value <= 0) {
      setDiscFeedback({ kind: 'error', msg: 'Introduce un valor mayor que 0.' }); return
    }
    if (discType === 'percent' && value > 100) {
      setDiscFeedback({ kind: 'error', msg: 'Un porcentaje no puede pasar de 100.' }); return
    }
    setDiscSaving(true); setDiscFeedback(null)
    const res = await setAccountDiscount(
      accountId, discType, value,
      discNote.trim() || null,
      discUntil ? new Date(discUntil + 'T23:59:59').toISOString() : null,
    )
    if (!res.ok) { setDiscFeedback({ kind: 'error', msg: res.error }); setDiscSaving(false); return }
    const d = await getAccountDiscount(accountId)
    setDiscount(d)
    setDiscValue(''); setDiscNote(''); setDiscUntil('')
    setDiscFeedback({ kind: 'ok', msg: 'Descuento aplicado.' })
    setDiscSaving(false)
  }

  async function handleClearDiscount() {
    if (!accountId) return
    if (!window.confirm('¿Retirar el descuento activo de este cliente?')) return
    setDiscSaving(true); setDiscFeedback(null)
    const res = await clearAccountDiscount(accountId)
    if (!res.ok) { setDiscFeedback({ kind: 'error', msg: res.error }); setDiscSaving(false); return }
    setDiscount(null)
    setDiscFeedback({ kind: 'ok', msg: 'Descuento retirado.' })
    setDiscSaving(false)
  }

  async function handleSaveData() {
    if (!accountId) return
    setSaving(true)
    setFeedback(null)
    try {
      // Reconstruye el jsonb de dirección solo con los campos no vacíos.
      const billingAddress: Record<string, unknown> = {}
      if (edit.addrStreet.trim()) billingAddress.street = edit.addrStreet.trim()
      if (edit.addrCity.trim()) billingAddress.city = edit.addrCity.trim()
      if (edit.addrPostalCode.trim()) billingAddress.postalCode = edit.addrPostalCode.trim()
      if (edit.addrProvince.trim()) billingAddress.province = edit.addrProvince.trim()

      const patch: AccountUpdate = {
        name: edit.name.trim(),
        legalName: edit.legalName.trim() || null,
        cif: edit.cif.trim() || null,
        billingEmail: edit.billingEmail.trim() || null,
        billingPhone: edit.billingPhone.trim() || null,
        billingAddress,
        country: edit.country,
        timezone: edit.timezone,
        locale: edit.locale,
        currency: edit.currency,
      }
      const updated = await updateAccount(accountId, patch)
      setLoad({ state: 'ready', account: updated })
      hydrateEdit(updated)
      setFeedback({ kind: 'ok', msg: 'Datos guardados.' })
    } catch (e) {
      setFeedback({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  async function handleStatus(newStatus: AccountStatus, confirmMsg?: string) {
    if (!accountId) return
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setSaving(true)
    setFeedback(null)
    try {
      const updated = await setAccountStatus(accountId, newStatus)
      setLoad({ state: 'ready', account: updated })
      setFeedback({ kind: 'ok', msg: `Estado cambiado a "${statusLabel(newStatus)}".` })
    } catch (e) {
      setFeedback({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  if (load.state === 'loading') {
    return <p className="text-sm" style={{ color: 'var(--color-text-secondary, #666)' }}>Cargando cuenta...</p>
  }

  if (load.state === 'error') {
    return (
      <div className="max-w-2xl">
        <button type="button" onClick={() => navigate('/_admin/cuentas')} className="text-sm mb-4" style={{ color: 'var(--color-accent)' }}>
          ← Volver al listado
        </button>
        <div className="rounded-lg p-4" style={{ background: '#FDECEC', border: '1px solid #E5A0A0' }}>
          <p className="text-sm font-medium" style={{ color: '#A12626' }}>{load.message}</p>
        </div>
      </div>
    )
  }

  const acc = load.account
  const badge = statusColor(acc.status)
  const isCanceled = acc.status === 'canceled'

  return (
    <div className="max-w-3xl">
      <button type="button" onClick={() => navigate('/_admin/cuentas')} className="text-sm mb-4" style={{ color: 'var(--color-accent)' }}>
        ← Volver al listado
      </button>

      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-display font-medium" style={{ color: 'var(--color-accent)' }}>{acc.name}</h1>
        <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: badge.bg, color: badge.fg }}>
          {statusLabel(acc.status)}
        </span>
        {acc.isInternal && <span className="text-xs" style={{ color: 'var(--color-text-secondary, #999)' }}>(interna)</span>}
      </div>

      {feedback && (
        <div className="rounded-lg p-3 mb-4" style={feedback.kind === 'ok'
          ? { background: '#E3F0E6', border: '1px solid #A8D0B5' }
          : { background: '#FDECEC', border: '1px solid #E5A0A0' }}>
          <p className="text-sm" style={{ color: feedback.kind === 'ok' ? '#1F6B3B' : '#A12626' }}>{feedback.msg}</p>
        </div>
      )}

      {/* Datos fiscales */}
      <section className="mb-6">
        <h2 className="text-base font-display font-medium mb-3" style={{ color: 'var(--color-accent)' }}>Datos fiscales</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Nombre" value={edit.name} onChange={v => setEdit(p => ({ ...p, name: v }))} />
          <Field label="Slug (no editable aquí)" value={acc.slug} onChange={() => {}} disabled />
          <Field label="Razón social" value={edit.legalName} onChange={v => setEdit(p => ({ ...p, legalName: v }))} />
          <Field label="CIF / NIF" value={edit.cif} onChange={v => setEdit(p => ({ ...p, cif: v }))} />
        </div>
      </section>

      {/* Logo de la empresa (autoservicio) */}
      {accountId && <AccountLogoUploader accountId={accountId} />}

      {/* Dirección de facturación */}
      <section className="mb-6">
        <h2 className="text-base font-display font-medium mb-3" style={{ color: 'var(--color-accent)' }}>Dirección de facturación</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Calle y número" value={edit.addrStreet} onChange={v => setEdit(p => ({ ...p, addrStreet: v }))} />
          <Field label="Población" value={edit.addrCity} onChange={v => setEdit(p => ({ ...p, addrCity: v }))} />
          <Field label="Código postal" value={edit.addrPostalCode} onChange={v => setEdit(p => ({ ...p, addrPostalCode: v }))} />
          <Field label="Provincia" value={edit.addrProvince} onChange={v => setEdit(p => ({ ...p, addrProvince: v }))} />
        </div>
      </section>

      {/* Contacto de facturación */}
      <section className="mb-6">
        <h2 className="text-base font-display font-medium mb-3" style={{ color: 'var(--color-accent)' }}>Contacto de facturación</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Email de facturación" value={edit.billingEmail} onChange={v => setEdit(p => ({ ...p, billingEmail: v }))} type="email" />
          <Field label="Teléfono de facturación" value={edit.billingPhone} onChange={v => setEdit(p => ({ ...p, billingPhone: v }))} />
        </div>
      </section>

      {/* Localización */}
      <section className="mb-6">
        <h2 className="text-base font-display font-medium mb-3" style={{ color: 'var(--color-accent)' }}>Localización</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SelectField label="País" value={edit.country} options={COUNTRY_OPTIONS} onChange={v => setEdit(p => ({ ...p, country: v }))} />
          <SelectField label="Zona horaria" value={edit.timezone} options={TIMEZONE_OPTIONS} onChange={v => setEdit(p => ({ ...p, timezone: v }))} />
          <SelectField label="Idioma" value={edit.locale} options={LOCALE_OPTIONS} onChange={v => setEdit(p => ({ ...p, locale: v }))} />
          <SelectField label="Moneda" value={edit.currency} options={CURRENCY_OPTIONS} onChange={v => setEdit(p => ({ ...p, currency: v }))} />
        </div>
      </section>

      <button
        type="button"
        onClick={handleSaveData}
        disabled={saving}
        className="px-4 py-2 rounded-md text-sm font-medium mb-8"
        style={{ background: 'var(--color-terracota)', color: '#fff', opacity: saving ? 0.6 : 1 }}
      >
        {saving ? 'Guardando...' : 'Guardar datos'}
      </button>

      {/* Módulos contratados (Sesión 16) */}
      <section className="mb-8">
        <h2 className="text-base font-display font-medium mb-3" style={{ color: 'var(--color-accent)' }}>Módulos contratados</h2>
        {modulesFeedback && (
          <div className="rounded-lg p-3 mb-3" style={modulesFeedback.kind === 'ok'
            ? { background: '#E3F0E6', border: '1px solid #A8D0B5' }
            : { background: '#FDECEC', border: '1px solid #E5A0A0' }}>
            <p className="text-sm" style={{ color: modulesFeedback.kind === 'ok' ? '#1F6B3B' : '#A12626' }}>{modulesFeedback.msg}</p>
          </div>
        )}
        {catalog === null ? (
          <p className="text-sm" style={{ color: 'var(--color-text-secondary, #666)' }}>Cargando catálogo...</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {catalog.map(mod => (
                <div key={mod.id} className="rounded-lg p-3" style={{ border: '1px solid var(--color-border, #e5e5e5)' }}>
                  <p className="text-sm font-medium mb-2" style={{ color: 'var(--color-accent)' }}>{mod.name}</p>
                  <div className="flex flex-col gap-1.5">
                    {mod.submodules.map(sub => (
                      <label key={sub.id} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>
                        <input
                          type="checkbox"
                          checked={selectedSubmodules.has(sub.id)}
                          onChange={() => toggleSubmodule(sub.id)}
                        />
                        <span>{sub.name}</span>
                        {sub.type === 'addon' && (
                          <span className="text-xs" style={{ color: 'var(--color-text-secondary, #999)' }}>(add-on)</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={handleSaveModules}
              disabled={modulesSaving}
              className="px-4 py-2 rounded-md text-sm font-medium"
              style={{ background: 'var(--color-terracota)', color: '#fff', opacity: modulesSaving ? 0.6 : 1 }}
            >
              {modulesSaving ? 'Guardando...' : 'Guardar módulos'}
            </button>
          </>
        )}
      </section>

      {/* Descuento del cliente (capa de precios P-C) */}
      <section className="mb-8">
        <h2 className="text-base font-display font-medium mb-3" style={{ color: 'var(--color-accent)' }}>Descuento</h2>
        {discFeedback && (
          <div className="rounded-lg p-3 mb-3" style={discFeedback.kind === 'ok'
            ? { background: '#E3F0E6', border: '1px solid #A8D0B5' }
            : { background: '#FDECEC', border: '1px solid #E5A0A0' }}>
            <p className="text-sm" style={{ color: discFeedback.kind === 'ok' ? '#1F6B3B' : '#A12626' }}>{discFeedback.msg}</p>
          </div>
        )}

        {discount ? (
          <div className="rounded-lg p-4 mb-3" style={{ border: '1px solid var(--color-border, #e5e5e5)', background: 'var(--color-bg-surface, #fff)' }}>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>
                  {discount.discountType === 'percent' ? `${discount.value}% de descuento` : `${discount.value} € de descuento`}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary, #888)' }}>
                  {discount.validUntil ? `Válido hasta ${discount.validUntil.slice(0, 10)}` : 'Sin caducidad'}
                  {discount.note ? ` · ${discount.note}` : ''}
                </p>
              </div>
              <button type="button" onClick={handleClearDiscount} disabled={discSaving}
                className="px-3 py-2 rounded-md text-sm font-medium"
                style={{ background: '#fff', color: '#A12626', border: '1px solid #E5A0A0', opacity: discSaving ? 0.5 : 1 }}>
                Retirar descuento
              </button>
            </div>
            <p className="text-xs mt-3" style={{ color: 'var(--color-text-secondary, #999)' }}>
              Aplicar uno nuevo sustituye al actual (un descuento activo por cliente).
            </p>
          </div>
        ) : (
          <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary, #666)' }}>Sin descuento activo.</p>
        )}

        <div className="rounded-lg p-4" style={{ border: '1px solid var(--color-border, #e5e5e5)' }}>
          <p className="text-sm font-medium mb-3" style={{ color: 'var(--color-accent)' }}>{discount ? 'Sustituir por' : 'Aplicar descuento'}</p>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-[11px] mb-0.5" style={{ color: 'var(--color-text-secondary, #888)' }}>Tipo</label>
              <select value={discType} onChange={e => setDiscType(e.target.value as 'percent' | 'fixed')}
                className="px-2 py-2 rounded-md text-sm bg-white" style={{ border: '1px solid var(--color-border, #ccc)' }}>
                <option value="percent">Porcentaje (%)</option>
                <option value="fixed">Importe fijo (€)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] mb-0.5" style={{ color: 'var(--color-text-secondary, #888)' }}>{discType === 'percent' ? 'Valor (%)' : 'Valor (€)'}</label>
              <input type="number" min="0" step="0.01" value={discValue} onChange={e => setDiscValue(e.target.value)}
                className="w-28 px-2 py-2 rounded-md text-sm" style={{ border: '1px solid var(--color-border, #ccc)' }} />
            </div>
            <div>
              <label className="block text-[11px] mb-0.5" style={{ color: 'var(--color-text-secondary, #888)' }}>Caduca (opcional)</label>
              <input type="date" value={discUntil} onChange={e => setDiscUntil(e.target.value)}
                className="px-2 py-2 rounded-md text-sm" style={{ border: '1px solid var(--color-border, #ccc)' }} />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-[11px] mb-0.5" style={{ color: 'var(--color-text-secondary, #888)' }}>Nota (opcional)</label>
              <input type="text" value={discNote} onChange={e => setDiscNote(e.target.value)} placeholder="Ej: promo 3 meses"
                className="w-full px-2 py-2 rounded-md text-sm" style={{ border: '1px solid var(--color-border, #ccc)' }} />
            </div>
            <button type="button" onClick={handleSaveDiscount} disabled={discSaving}
              className="px-4 py-2 rounded-md text-sm font-medium"
              style={{ background: 'var(--color-terracota)', color: '#fff', opacity: discSaving ? 0.6 : 1 }}>
              {discSaving ? 'Guardando…' : 'Aplicar'}
            </button>
          </div>
        </div>
      </section>

      {/* Integraciones Last.app (onboarding multi-TPV, solo Folvy) */}
      {accountId && <IntegrationsSection accountId={accountId} />}

      {/* Ciclo de vida / estado */}
      <section>
        <h2 className="text-base font-display font-medium mb-3" style={{ color: 'var(--color-accent)' }}>Estado de la cuenta</h2>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary, #666)' }}>
          Estado actual: <strong>{statusLabel(acc.status)}</strong>.
        </p>
        <div className="flex flex-wrap gap-2">
          <StatusButton
            label="Reactivar (Activa)"
            onClick={() => handleStatus('active')}
            disabled={saving || acc.status === 'active' || isCanceled}
            tone="neutral"
          />
          <StatusButton
            label="Marcar impago"
            onClick={() => handleStatus('past_due')}
            disabled={saving || acc.status === 'past_due' || isCanceled}
            tone="warning"
          />
          <StatusButton
            label="Suspender"
            onClick={() => handleStatus('suspended', `¿Suspender la cuenta "${acc.name}"? Los usuarios no podrán operar hasta reactivarla.`)}
            disabled={saving || acc.status === 'suspended' || isCanceled}
            tone="danger"
          />
          <StatusButton
            label="Cancelar (baja)"
            onClick={() => handleStatus('canceled', `¿Cancelar definitivamente la cuenta "${acc.name}"? Se conservan los datos pero la cuenta deja de operar y de facturar. Esta acción debería ser excepcional.`)}
            disabled={saving || isCanceled}
            tone="danger"
          />
        </div>
        {isCanceled && (
          <p className="text-xs mt-3" style={{ color: 'var(--color-text-secondary, #999)' }}>
            Esta cuenta está cancelada. Para reactivarla, contacta con soporte técnico (reactivación de cuentas canceladas no disponible en el panel v1).
          </p>
        )}
      </section>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', disabled = false }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2 rounded-md text-sm"
        style={{ border: '1px solid var(--color-border, #ccc)', opacity: disabled ? 0.6 : 1 }}
      />
    </div>
  )
}

function SelectField({ label, value, options, onChange }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-md text-sm bg-white"
        style={{ border: '1px solid var(--color-border, #ccc)' }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function StatusButton({ label, onClick, disabled, tone }: {
  label: string; onClick: () => void; disabled: boolean; tone: 'neutral' | 'warning' | 'danger'
}) {
  const styles =
    tone === 'danger' ? { background: '#fff', color: '#A12626', border: '1px solid #E5A0A0' }
    : tone === 'warning' ? { background: '#fff', color: '#8A6516', border: '1px solid #D9C089' }
    : { background: '#fff', color: 'var(--color-accent)', border: '1px solid var(--color-accent)' }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-2 rounded-md text-sm font-medium"
      style={{ ...styles, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      {label}
    </button>
  )
}
