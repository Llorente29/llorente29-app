// src/modules/kitchen/pages/KitchenSettingsPage.tsx
//
// Zona AJUSTES de Folvy Kitchen. Parámetros operativos de cocina/economía que el
// gestor configura y consulta a menudo (distinto de Configuración de cuenta:
// Locales/Marcas/Avisos/Usuarios).
//
// Sección 1: COMISIONES POR CANAL (defecto que siembra todas las marcas). Edita
// channel_rate vía channelRateService. Los overrides por marca×canal llegan en un
// sub-paso siguiente. Al guardar un canal, el margen de la ficha del producto lo
// recoge por el fallback de menu_item_economics.

import { useEffect, useState } from 'react'
import { Check, Loader2, Pencil, X, Percent } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  listSalesChannels,
  listChannelRates,
  upsertChannelRate,
  type SalesChannel,
  type ChannelRate,
  type ServiceType,
  type CommissionBase,
} from '@/modules/kitchen/services/channelRateService'

const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  platform_delivery: 'Reparto de plataforma',
  own_delivery: 'Reparto propio',
  pickup: 'Recogida',
}

const COMMISSION_BASE_LABEL: Record<CommissionBase, string> = {
  pvp_con_iva: 'PVP con IVA',
  pvp_sin_iva: 'PVP sin IVA',
}

function fmtPct(v: number | null): string {
  return v === null || v === undefined ? '—' : `${v}%`
}
function fmtEur(v: number | null): string {
  if (v === null || v === undefined) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)
}

interface EditState {
  serviceType: ServiceType
  commissionPct: string
  commissionFixed: string
  commissionBase: CommissionBase
  ownCustomerFee: string
  ownCourierCost: string
}

export default function KitchenSettingsPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const [channels, setChannels] = useState<SalesChannel[]>([])
  const [rates, setRates] = useState<ChannelRate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Edición: clave = salesChannelId que se está editando (uno a la vez).
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [edit, setEdit] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  function load() {
    if (!activeAccountId) return
    setLoading(true)
    setError(null)
    Promise.all([listSalesChannels(activeAccountId), listChannelRates(activeAccountId)])
      .then(([chs, rts]) => { setChannels(chs); setRates(rts) })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (accountsLoading || !activeAccountId) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, accountsLoading])

  // Defecto vigente de un canal (service_type platform_delivery por ahora; el
  // selector de service_type está en el editor).
  function rateFor(channelId: string, serviceType: ServiceType): ChannelRate | undefined {
    return rates.find((r) => r.salesChannelId === channelId && r.serviceType === serviceType)
  }

  function openEdit(channel: SalesChannel) {
    // Por defecto edita platform_delivery; si ya hay otra, toma la primera existente.
    const existing = rates.find((r) => r.salesChannelId === channel.id)
    const st: ServiceType = existing?.serviceType ?? 'platform_delivery'
    const r = rateFor(channel.id, st)
    setEdit({
      serviceType: st,
      commissionPct: r?.commissionPct != null ? String(r.commissionPct) : '',
      commissionFixed: r?.commissionFixed != null ? String(r.commissionFixed) : '',
      commissionBase: r?.commissionBase ?? 'pvp_con_iva',
      ownCustomerFee: r?.ownCustomerFee != null ? String(r.ownCustomerFee) : '',
      ownCourierCost: r?.ownCourierCost != null ? String(r.ownCourierCost) : '',
    })
    setSaveError(null)
    setEditingChannelId(channel.id)
  }

  // Al cambiar el service_type dentro del editor, recargar los valores de ese tipo.
  function changeServiceType(channelId: string, st: ServiceType) {
    const r = rateFor(channelId, st)
    setEdit((prev) => prev && ({
      ...prev,
      serviceType: st,
      commissionPct: r?.commissionPct != null ? String(r.commissionPct) : '',
      commissionFixed: r?.commissionFixed != null ? String(r.commissionFixed) : '',
      commissionBase: r?.commissionBase ?? 'pvp_con_iva',
      ownCustomerFee: r?.ownCustomerFee != null ? String(r.ownCustomerFee) : '',
      ownCourierCost: r?.ownCourierCost != null ? String(r.ownCourierCost) : '',
    }))
  }

  function num(s: string): number | null {
    const t = s.trim().replace(',', '.')
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }

  async function save(channelId: string) {
    if (!edit || !activeAccountId) return
    setSaving(true)
    setSaveError(null)
    try {
      await upsertChannelRate({
        accountId: activeAccountId,
        salesChannelId: channelId,
        serviceType: edit.serviceType,
        commissionPct: num(edit.commissionPct),
        commissionFixed: num(edit.commissionFixed),
        commissionBase: edit.commissionBase,
        ownCustomerFee: num(edit.ownCustomerFee),
        ownCourierCost: num(edit.ownCourierCost),
      })
      setEditingChannelId(null)
      setEdit(null)
      load()
    } catch (e) {
      setSaveError(String((e as Error).message ?? e))
    } finally {
      setSaving(false)
    }
  }

  if (accountsLoading || loading) {
    return <div className="p-6 text-sm text-text-secondary">Cargando ajustes…</div>
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-display font-medium text-text-primary">Ajustes</h1>
        <p className="text-sm text-text-secondary mt-1">
          Parámetros de cocina y economía. Empezamos por las comisiones de cada canal.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>
      )}

      {/* SECCIÓN: COMISIONES POR CANAL */}
      <div className="rounded-lg border border-border-default bg-card">
        <div className="px-4 py-3 border-b border-border-default flex items-center gap-2">
          <Percent size={16} className="text-text-secondary" />
          <h2 className="text-sm font-medium text-text-primary">Comisiones por canal</h2>
        </div>

        <div className="px-4 py-3">
          <p className="text-[12px] text-text-secondary mb-3">
            Esta es la comisión por defecto del canal: se aplica a todas las marcas que
            venden en él. Si una marca tiene una comisión distinta, se configurará como
            excepción (próximamente).
          </p>

          {channels.length === 0 ? (
            <p className="text-sm text-text-secondary">No hay canales configurados.</p>
          ) : (
            <div className="divide-y divide-border-default">
              {channels.map((ch) => {
                const isEditing = editingChannelId === ch.id
                const existing = rates.filter((r) => r.salesChannelId === ch.id)
                return (
                  <div key={ch.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {ch.color && (
                          <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: ch.color }} />
                        )}
                        <span className="text-sm font-medium text-text-primary">{ch.name}</span>
                      </div>
                      {!isEditing && (
                        <button
                          type="button"
                          onClick={() => openEdit(ch)}
                          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-accent transition-base shrink-0"
                        >
                          <Pencil size={14} /> {existing.length > 0 ? 'Editar' : 'Configurar'}
                        </button>
                      )}
                    </div>

                    {/* Vista de los defectos existentes del canal */}
                    {!isEditing && existing.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {existing.map((r) => (
                          <div key={r.id} className="text-xs text-text-secondary flex flex-wrap gap-x-4 gap-y-0.5">
                            <span className="text-text-primary">{SERVICE_TYPE_LABEL[r.serviceType]}</span>
                            <span>comisión {fmtPct(r.commissionPct)}{r.commissionFixed ? ` + ${fmtEur(r.commissionFixed)}/pedido` : ''}</span>
                            <span>sobre {COMMISSION_BASE_LABEL[r.commissionBase]}</span>
                            {r.serviceType === 'own_delivery' && (
                              <span>rider {fmtEur(r.ownCourierCost)} · envío cliente {fmtEur(r.ownCustomerFee)}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {!isEditing && existing.length === 0 && (
                      <p className="mt-1 text-xs text-text-secondary">Sin comisión configurada.</p>
                    )}

                    {/* Editor */}
                    {isEditing && edit && (
                      <div className="mt-3 space-y-3 bg-page rounded-md p-3">
                        <div>
                          <label className="block text-[11px] font-medium text-text-secondary mb-1">Tipo de servicio</label>
                          <select
                            value={edit.serviceType}
                            onChange={(e) => changeServiceType(ch.id, e.target.value as ServiceType)}
                            disabled={saving}
                            className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary"
                          >
                            <option value="platform_delivery">Reparto de plataforma</option>
                            <option value="own_delivery">Reparto propio</option>
                            <option value="pickup">Recogida</option>
                          </select>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-medium text-text-secondary mb-1">Comisión (%)</label>
                            <input type="text" inputMode="decimal" value={edit.commissionPct}
                              onChange={(e) => setEdit({ ...edit, commissionPct: e.target.value })} disabled={saving}
                              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary" />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-text-secondary mb-1">Comisión fija (€/pedido)</label>
                            <input type="text" inputMode="decimal" value={edit.commissionFixed}
                              onChange={(e) => setEdit({ ...edit, commissionFixed: e.target.value })} disabled={saving}
                              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary" />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-text-secondary mb-1">Base de la comisión</label>
                          <select value={edit.commissionBase}
                            onChange={(e) => setEdit({ ...edit, commissionBase: e.target.value as CommissionBase })} disabled={saving}
                            className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary">
                            <option value="pvp_con_iva">PVP con IVA</option>
                            <option value="pvp_sin_iva">PVP sin IVA</option>
                          </select>
                        </div>

                        {edit.serviceType === 'own_delivery' && (
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-medium text-text-secondary mb-1">Coste rider (€/pedido)</label>
                              <input type="text" inputMode="decimal" value={edit.ownCourierCost}
                                onChange={(e) => setEdit({ ...edit, ownCourierCost: e.target.value })} disabled={saving}
                                className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary" />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-text-secondary mb-1">Envío que paga el cliente (€)</label>
                              <input type="text" inputMode="decimal" value={edit.ownCustomerFee}
                                onChange={(e) => setEdit({ ...edit, ownCustomerFee: e.target.value })} disabled={saving}
                                className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary" />
                            </div>
                          </div>
                        )}

                        {saveError && (
                          <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">{saveError}</div>
                        )}

                        <div className="flex items-center justify-end gap-2">
                          <button type="button" onClick={() => { setEditingChannelId(null); setEdit(null) }} disabled={saving}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-card transition-base disabled:opacity-50">
                            <X size={14} /> Cancelar
                          </button>
                          <button type="button" onClick={() => save(ch.id)} disabled={saving}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check size={14} />}
                            {saving ? 'Guardando…' : 'Guardar'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
