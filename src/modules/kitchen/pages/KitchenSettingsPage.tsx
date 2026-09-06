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
//
// Sección 2: OBJETIVO DE COMIDA SOBRE VENTAS (B79 §3.11, 06/09/2026). El único
// ajuste de `kitchen_settings` que se puede tocar desde una pantalla. Antes de
// esto la tabla existía y NADIE la escribía: la fila la creaba NuevaCuentaPage y
// el objetivo se quedaba a NULL en las tres cuentas, así que `food_cost_status`
// salía 'no_target' en todo Kitchen. La regla que se pinta aquí y que cumple el
// motor: el objetivo del PLATO manda, el de la CUENTA vale para los demás.
//
// Sección 3: RECOSTEAR TODO. Recalcula el coste de todas las preparaciones y
// platos de la cuenta. El cálculo NO vive aquí: llama a kitchen_recompute_all,
// la misma función que corre sola cada noche a las 04:00. La pantalla solo la
// invoca por tandas para poder decir por dónde va.

import { useEffect, useState } from 'react'
import { Check, Loader2, Pencil, X, Percent, Calculator, AlertTriangle, Target } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  recomputeAllCosts,
  type RecomputeAllBatch,
} from '@/modules/kitchen/services/recipeItemService'
import ConfirmDialog from '@/components/ConfirmDialog'
import {
  getKitchenSettings,
  setTargetFoodCostPct,
  contarPlatosConObjetivoPropio,
  objetivoValido,
  OBJETIVO_INVALIDO,
} from '@/modules/kitchen/services/kitchenSettingsService'
import {
  listSalesChannels,
  listChannelRates,
  upsertChannelRate,
  baseFromGross,
  vatFromGross,
  SERVICE_VAT_PCT,
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

function VatBreakdown({ value, vatPct }: { value: string; vatPct?: number }) {
  const t = value.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n === 0) return null
  const base = baseFromGross(n, vatPct)
  const vat = vatFromGross(n, vatPct)
  return (
    <p className="text-[10px] text-text-secondary mt-0.5 tabular-nums">
      → Base {fmtEur(base)} + IVA {vatPct ?? SERVICE_VAT_PCT}% ({fmtEur(vat)})
    </p>
  )
}

interface EditState {
  serviceType: ServiceType
  commissionPct: string
  commissionFixed: string
  commissionBase: CommissionBase
  ownCustomerFee: string
  ownCustomerFeeVatPct: string
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

  // ── Objetivo de comida de la cuenta (§3.11) ──────────────────────────────
  // `objetivoGuardado` es lo que hay en la base; `objetivoVal` es lo que está
  // escrito en el campo. Se guardan por separado para poder decir «sin cambios»
  // sin tener que preguntarle otra vez a la base.
  const [objetivoGuardado, setObjetivoGuardado] = useState<number | null>(null)
  const [objetivoVal, setObjetivoVal] = useState('')
  const [objetivoCargado, setObjetivoCargado] = useState(false)
  const [platosPropios, setPlatosPropios] = useState<{ conObjetivoPropio: number; enCarta: number } | null>(null)
  const [guardandoObjetivo, setGuardandoObjetivo] = useState(false)
  const [objetivoOk, setObjetivoOk] = useState<string | null>(null)
  const [objetivoError, setObjetivoError] = useState<string | null>(null)

  function load() {
    if (!activeAccountId) return
    setLoading(true)
    setError(null)
    Promise.all([listSalesChannels(activeAccountId), listChannelRates(activeAccountId)])
      .then(([chs, rts]) => { setChannels(chs); setRates(rts) })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false))
    cargaObjetivo(activeAccountId)
  }

  // El objetivo se carga aparte de los canales: si una de las dos cosas falla, la
  // otra se sigue viendo, y cada una dice su propio fallo en su sitio.
  function cargaObjetivo(accountId: string) {
    setObjetivoCargado(false)
    setObjetivoError(null)
    setObjetivoOk(null)
    Promise.all([getKitchenSettings(accountId), contarPlatosConObjetivoPropio(accountId)])
      .then(([ajustes, conteo]) => {
        const v = ajustes?.targetFoodCostPct ?? null
        setObjetivoGuardado(v)
        setObjetivoVal(v != null ? String(v) : '')
        setPlatosPropios(conteo)
      })
      .catch((e) => setObjetivoError(String(e.message ?? e)))
      .finally(() => setObjetivoCargado(true))
  }

  async function guardaObjetivo() {
    if (!activeAccountId) return
    const t = objetivoVal.trim().replace(',', '.')
    const pct = t === '' ? null : Number(t)
    // La MISMA regla que usa el servicio, no una copia parecida.
    if (!objetivoValido(pct)) {
      setObjetivoError(OBJETIVO_INVALIDO)
      setObjetivoOk(null)
      return
    }
    setGuardandoObjetivo(true)
    setObjetivoError(null)
    setObjetivoOk(null)
    try {
      const guardado = await setTargetFoodCostPct(activeAccountId, pct)
      const v = guardado.targetFoodCostPct
      setObjetivoGuardado(v)
      setObjetivoVal(v != null ? String(v) : '')
      // La confirmación lleva CONTENIDO, no un visto (regla 8): dice el número
      // que ha quedado guardado y a cuántos platos se les aplica.
      const otros = platosPropios ? platosPropios.enCarta - platosPropios.conObjetivoPropio : null
      setObjetivoOk(
        v == null
          ? 'Objetivo borrado. Ningún plato tiene ya con qué compararse, salvo los que tengan el suyo.'
          : `Guardado: ${v} %. Se le aplica a ${otros != null ? otros : '—'} platos de la carta` +
            `${platosPropios && platosPropios.conObjetivoPropio > 0
                ? `; los otros ${platosPropios.conObjetivoPropio} siguen con el suyo propio` : ''}.`,
      )
    } catch (e) {
      setObjetivoError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardandoObjetivo(false)
    }
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
      ownCustomerFeeVatPct: r?.ownCustomerFeeVatPct != null ? String(r.ownCustomerFeeVatPct) : '10',
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
      ownCustomerFeeVatPct: r?.ownCustomerFeeVatPct != null ? String(r.ownCustomerFeeVatPct) : '10',
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
        ownCustomerFeeVatPct: num(edit.ownCustomerFeeVatPct) ?? 10,
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

  // ── Recostear todo ──
  const [askRecompute, setAskRecompute] = useState(false)
  const [recomputing, setRecomputing] = useState(false)
  const [recomputeProgress, setRecomputeProgress] = useState<{ done: number; total: number } | null>(null)
  const [recomputeResult, setRecomputeResult] = useState<RecomputeAllBatch | null>(null)
  const [recomputeError, setRecomputeError] = useState<string | null>(null)

  async function runRecomputeAll() {
    if (!activeAccountId || recomputing) return
    setAskRecompute(false)
    setRecomputing(true)
    setRecomputeError(null)
    setRecomputeResult(null)
    setRecomputeProgress({ done: 0, total: 0 })
    try {
      const res = await recomputeAllCosts(activeAccountId, (p) =>
        setRecomputeProgress({ done: p.done, total: p.total }),
      )
      setRecomputeResult(res)
    } catch (e) {
      setRecomputeError(String((e as Error).message ?? e))
    } finally {
      setRecomputing(false)
      setRecomputeProgress(null)
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
            excepción (próximamente). Los importes en euros se introducen IVA incluido (lo
            que ves en tu factura); Folvy calcula la base para el margen.
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
                            <span>comisión {fmtPct(r.commissionPct)}{r.commissionFixed ? ` + ${fmtEur(r.commissionFixed)}/pedido (base ${fmtEur(baseFromGross(r.commissionFixed))})` : ''}</span>
                            <span>sobre {COMMISSION_BASE_LABEL[r.commissionBase]}</span>
                            {r.serviceType === 'own_delivery' && (
                              <span>rider {fmtEur(r.ownCourierCost)} (base {fmtEur(baseFromGross(r.ownCourierCost))}) · envío cliente {fmtEur(r.ownCustomerFee)}</span>
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
                            <label className="block text-[11px] font-medium text-text-secondary mb-1">Comisión fija (€/pedido, IVA incl.)</label>
                            <input type="text" inputMode="decimal" value={edit.commissionFixed}
                              onChange={(e) => setEdit({ ...edit, commissionFixed: e.target.value })} disabled={saving}
                              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary" />
                            <VatBreakdown value={edit.commissionFixed} />
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
                              <label className="block text-[11px] font-medium text-text-secondary mb-1">Coste rider (€/pedido, IVA incl.)</label>
                              <input type="text" inputMode="decimal" value={edit.ownCourierCost}
                                onChange={(e) => setEdit({ ...edit, ownCourierCost: e.target.value })} disabled={saving}
                                className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary" />
                              <VatBreakdown value={edit.ownCourierCost} />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-text-secondary mb-1">Envío que paga el cliente (€, IVA incl.)</label>
                              <input type="text" inputMode="decimal" value={edit.ownCustomerFee}
                                onChange={(e) => setEdit({ ...edit, ownCustomerFee: e.target.value })} disabled={saving}
                                className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary" />
                              <div className="mt-1">
                                <label className="block text-[10px] text-text-secondary mb-0.5">IVA del envío</label>
                                <select value={edit.ownCustomerFeeVatPct}
                                  onChange={(e) => setEdit({ ...edit, ownCustomerFeeVatPct: e.target.value })} disabled={saving}
                                  className="w-full px-2 py-1 text-xs border border-border-default rounded-md bg-card text-text-primary">
                                  <option value="10">10% (accesorio a comida)</option>
                                  <option value="21">21% (transporte independiente)</option>
                                </select>
                              </div>
                              <VatBreakdown value={edit.ownCustomerFee} vatPct={Number(edit.ownCustomerFeeVatPct) || 10} />
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

      {/* SECCIÓN: OBJETIVO DE COMIDA SOBRE VENTAS (B79 §3.11) */}
      <div className="rounded-lg border border-border-default bg-card" id="objetivo-de-comida">
        <div className="px-4 py-3 border-b border-border-default flex items-center gap-2">
          <Target size={16} className="text-text-secondary" />
          <h2 className="text-sm font-medium text-text-primary">Objetivo de comida sobre ventas</h2>
        </div>

        <div className="px-4 py-3">
          <p className="text-[12px] text-text-secondary mb-3">
            A qué porcentaje quieres que salga la comida (ingredientes y envase) sobre lo
            que vendes, sin IVA. <strong>Vale para todos los platos que no tengan el
            suyo</strong>: el objetivo que pongas en la ficha de un plato manda sobre éste.
            Sin objetivo, Folvy puede decirte cuánto cuesta cada plato, pero no si eso está
            bien o mal.
          </p>

          {!objetivoCargado ? (
            <p className="text-sm text-text-secondary">Cargando el objetivo…</p>
          ) : (
            <>
              <div className="flex items-end gap-2 flex-wrap">
                <label className="block">
                  <span className="block text-[11px] text-text-secondary mb-1">Objetivo</span>
                  <span className="inline-flex items-center gap-1">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={objetivoVal}
                      onChange={(e) => { setObjetivoVal(e.target.value); setObjetivoOk(null) }}
                      placeholder="p. ej. 28"
                      className="w-24 px-2 py-1.5 text-sm rounded-md border border-border-default bg-card text-text-primary tabular-nums"
                    />
                    <span className="text-sm text-text-secondary">%</span>
                  </span>
                </label>

                <button
                  type="button"
                  onClick={() => void guardaObjetivo()}
                  disabled={guardandoObjetivo || !activeAccountId
                    || objetivoVal.trim().replace(',', '.') === (objetivoGuardado != null ? String(objetivoGuardado) : '')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base"
                >
                  {guardandoObjetivo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check size={14} />}
                  {guardandoObjetivo ? 'Guardando…' : 'Guardar objetivo'}
                </button>
              </div>

              {/* Ni el número de la cuenta ni los platos que tienen el suyo se
                  esconden: son dos verdades y se dicen las dos, con cuál manda. */}
              <p className="text-[12px] text-text-secondary mt-2.5">
                {objetivoGuardado == null
                  ? 'Ahora mismo la cuenta no tiene objetivo puesto.'
                  : `Ahora mismo la cuenta apunta al ${objetivoGuardado} %.`}
                {platosPropios && platosPropios.conObjetivoPropio > 0 && (
                  <>
                    {' '}
                    {platosPropios.conObjetivoPropio}{' '}
                    {platosPropios.conObjetivoPropio === 1
                      ? 'plato de la carta tiene el suyo propio y no usa éste'
                      : 'platos de la carta tienen el suyo propio y no usan éste'}
                    {' '}(de {platosPropios.enCarta} en carta).
                  </>
                )}
              </p>

              {objetivoOk && (
                <div className="mt-3 p-2.5 rounded-md bg-success-bg text-success border border-success/20 text-[13px]">
                  {objetivoOk}
                </div>
              )}
              {objetivoError && (
                <div className="mt-3 p-2.5 rounded-md bg-danger-bg text-danger border border-danger/20 text-[13px]">
                  {objetivoError}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* SECCIÓN: RECOSTEAR TODO */}
      <div className="rounded-lg border border-border-default bg-card">
        <div className="px-4 py-3 border-b border-border-default flex items-center gap-2">
          <Calculator size={16} className="text-text-secondary" />
          <h2 className="text-sm font-medium text-text-primary">Costes de escandallo</h2>
        </div>

        <div className="px-4 py-3">
          <p className="text-[12px] text-text-secondary mb-3">
            Recalcula el coste de <strong>todas las preparaciones y platos</strong> a partir
            del precio actual de sus ingredientes y envases. Primero las preparaciones y
            después los platos, para que una sub-receta esté al día antes que el plato que
            la usa. Los ingredientes y envases no se tocan aquí: su coste viene de las
            compras.
          </p>
          <p className="text-[12px] text-text-secondary mb-3">
            Esto ya se hace <strong>solo cada noche a las 04:00</strong>. El botón sirve
            para no esperar a mañana cuando acabas de cambiar precios o escandallos.
          </p>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setAskRecompute(true)}
              disabled={recomputing || !activeAccountId}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base"
            >
              {recomputing
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Calculator size={14} />}
              {recomputing ? 'Recosteando…' : 'Recostear todo'}
            </button>

            {recomputing && recomputeProgress && (
              <span className="text-sm text-text-secondary tabular-nums" aria-live="polite">
                {recomputeProgress.total > 0
                  ? `Recosteando… ${recomputeProgress.done}/${recomputeProgress.total}`
                  : 'Recosteando…'}
              </span>
            )}
          </div>

          {/* Barra de avance: solo cuando ya se sabe el total. */}
          {recomputing && recomputeProgress && recomputeProgress.total > 0 && (
            <div className="mt-3 h-1.5 w-full rounded-full bg-page overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${Math.round((recomputeProgress.done / recomputeProgress.total) * 100)}%` }}
              />
            </div>
          )}

          {recomputeResult && !recomputing && (
            <div className="mt-3 rounded-md border border-border-default bg-page p-3 text-[13px]">
              <p className="text-text-primary">
                <strong>{recomputeResult.processed}</strong>{' '}
                {recomputeResult.processed === 1 ? 'plato recosteado' : 'platos recosteados'}
                {recomputeResult.failed > 0 && (
                  <span className="text-danger">
                    {' · '}{recomputeResult.failed}{' '}
                    {recomputeResult.failed === 1 ? 'falló' : 'fallaron'}
                  </span>
                )}
                .
              </p>
              {/* Los fallos se enseñan, no se esconden: un plato que no recostea
                  sigue vendiéndose con el coste viejo y eso hay que saberlo. */}
              {recomputeResult.errors.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {recomputeResult.errors.map((e) => (
                    <li key={e.itemId} className="flex items-start gap-1.5 text-[12px] text-danger">
                      <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                      <span><strong>{e.name}</strong>: {e.error}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {recomputeError && (
            <div className="mt-3 p-2.5 rounded-md bg-danger-bg text-danger border border-danger/20 text-[13px]">
              {recomputeError}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={askRecompute}
        title="¿Recostear todos los platos?"
        message="Esto puede tardar unos segundos. Se recalcula el coste de todas las preparaciones y platos con el precio actual de sus ingredientes y envases. No se cambia ningún precio de venta ni se toca la carta."
        confirmLabel="Recostear todo"
        cancelLabel="Cancelar"
        busy={recomputing}
        onConfirm={() => void runRecomputeAll()}
        onCancel={() => setAskRecompute(false)}
      />
    </div>
  )
}
