// src/modules/kitchen/pages/PlatformOffersPage.tsx
//
// OFERTAS DE PLATAFORMA v1. Lista de campañas + editor con IMPACTO EN VIVO de
// margen real (RPC server-side) ANTES de aprobar. Al aprobar, se encola en
// promo_push_job (el robot que publica llega en el siguiente tramo → la UI lo
// dice honesto: "Pendiente de publicar / En cola").
//
// Patrón lista+detalle en una misma página (como el resto de Kitchen). NO toca
// App.tsx: se monta como ruta interna del módulo (kitchen/ofertas).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Percent, Plus, Loader2, ArrowLeft, Check, AlertTriangle, Pause, Play,
  CircleStop, Trash2, Search, Megaphone, Info, Target,
} from 'lucide-react'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { listBrands } from '@/modules/multitenancy/services/brandsService'
import { listSalesChannels } from '@/modules/kitchen/services/channelRateService'
import { listMenuItems } from '@/modules/kitchen/services/menuItemService'
import { listLocations, type LocationOption } from '@/modules/kitchen/services/availabilityService'
import type { Brand } from '@/types/multitenancy'
import type { MenuItem } from '@/types/kitchen'
import {
  listCampaigns, previewImpact, saveCampaign, approveCampaign,
  pauseCampaign, resumeCampaign, endCampaign, deleteDraft,
  platformOfChannel,
  getSalesSignal, getRecoveryTargetPct, upsertTarget, deleteTarget,
  type Campaign, type CampaignDraft, type CampaignStatus, type PlatformChannel,
  type DiscountType, type ImpactRow, type ImpactAggregates, type SalesSignalRow,
} from '@/modules/kitchen/services/platformOffersService'

// ─────────────────────────────────────────────────────────────────────
// Formato
// ─────────────────────────────────────────────────────────────────────

function fmtEur(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}
function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return `${v}%`
}
function fmtDate(v: string | null): string {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return '—' }
}

// L M X J V S D → números JS getDay (0=domingo).
const WEEKDAYS: { n: number; label: string }[] = [
  { n: 1, label: 'L' }, { n: 2, label: 'M' }, { n: 3, label: 'X' },
  { n: 4, label: 'J' }, { n: 5, label: 'V' }, { n: 6, label: 'S' }, { n: 0, label: 'D' },
]

const STATUS_META: Record<CampaignStatus, { label: string; cls: string }> = {
  borrador:   { label: 'Borrador',              cls: 'bg-page text-text-secondary border-border-default' },
  pendiente:  { label: 'Pendiente de publicar', cls: 'bg-warning-bg text-warning border-warning/30' },
  publicada:  { label: 'Publicada',             cls: 'bg-success-bg text-success border-success/40' },
  pausada:    { label: 'Pausada',               cls: 'bg-page text-text-secondary border-border-default' },
  finalizada: { label: 'Finalizada',            cls: 'bg-page text-text-secondary border-border-default' },
}

const CHANNEL_META: Record<PlatformChannel, { label: string; color: string }> = {
  glovo: { label: 'Glovo', color: '#FFC244' },
  uber:  { label: 'Uber Eats', color: '#06C167' },
}

// Chip de estado, con variante propia para las PROPUESTAS DEL AGENTE: un
// borrador con origin='agent' no es un borrador humano, y debe verse distinto.
function statusChip(c: Campaign): { label: string; cls: string } {
  if (c.origin === 'agent' && c.status === 'borrador') {
    return { label: 'Propuesta del agente', cls: 'bg-accent/10 text-accent border-accent/30' }
  }
  return STATUS_META[c.status]
}

// El porqué del agente vive en omnibus_ref_note como "Agente YYYY-MM-DD: <razón>".
// Quitamos el prefijo para mostrar solo el razonamiento; si no casa, tal cual.
function agentReason(note: string | null): string | null {
  if (!note) return null
  const m = note.match(/^Agente \d{4}-\d{2}-\d{2}:\s*(.*)$/s)
  const reason = (m ? m[1] : note).trim()
  return reason === '' ? null : reason
}

interface ChannelOption { id: string; name: string; platform: PlatformChannel }

// ─────────────────────────────────────────────────────────────────────
// Estado del formulario del editor
// ─────────────────────────────────────────────────────────────────────

interface FormState {
  id?: string
  name: string
  channelId: string
  discountType: DiscountType
  value: string
  scopeMode: 'all' | 'pick'
  brandIds: string[]
  menuItemIds: string[]
  weekdays: number[]
  timeFrom: string
  timeTo: string
  startsAt: string
  endsAt: string
  budgetMax: string
  marginFloorPct: string
  omnibusRefNote: string
}

function emptyForm(): FormState {
  return {
    name: '', channelId: '', discountType: 'percent', value: '',
    scopeMode: 'all', brandIds: [], menuItemIds: [],
    weekdays: [], timeFrom: '', timeTo: '', startsAt: '', endsAt: '',
    budgetMax: '', marginFloorPct: '', omnibusRefNote: '',
  }
}

function numOrNull(s: string): number | null {
  const t = s.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// ─────────────────────────────────────────────────────────────────────
// Página
// ─────────────────────────────────────────────────────────────────────

export default function PlatformOffersPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const [view, setView] = useState<'list' | 'editor'>('list')
  const [tab, setTab] = useState<'campanas' | 'objetivos'>('campanas')

  // Datos compartidos
  const [brands, setBrands] = useState<Brand[]>([])
  const [channels, setChannels] = useState<ChannelOption[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadAll = useCallback(() => {
    if (!activeAccountId) return
    setLoading(true)
    setError(null)
    Promise.all([
      listBrands({ accountId: activeAccountId, includeInactive: false }),
      listSalesChannels(activeAccountId),
      listCampaigns(activeAccountId),
    ])
      .then(([bs, chs, camps]) => {
        setBrands(bs.filter((b) => b.isActive))
        const opts: ChannelOption[] = chs
          .map((c) => {
            const p = platformOfChannel(c.name, c.slug)
            return p ? { id: c.id, name: c.name, platform: p } : null
          })
          .filter((x): x is ChannelOption => x !== null)
        setChannels(opts)
        setCampaigns(camps)
      })
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false))
  }, [activeAccountId])

  useEffect(() => {
    if (accountsLoading || !activeAccountId) return
    loadAll()
  }, [activeAccountId, accountsLoading, loadAll])

  // Editor
  const [form, setForm] = useState<FormState>(emptyForm())

  function openNew() {
    const f = emptyForm()
    if (channels.length > 0) f.channelId = channels[0].id
    setForm(f)
    setView('editor')
  }

  function openDraft(c: Campaign) {
    // Reabrir un borrador: prefill desde el coupon + su scope (best-effort).
    const chOpt = channels.find((o) => o.platform === c.channel)
    setForm({
      id: c.id,
      name: c.name,
      channelId: chOpt?.id ?? (channels[0]?.id ?? ''),
      discountType: c.discountType,
      value: String(c.value ?? ''),
      scopeMode: c.scope?.menuItemIds && c.scope.menuItemIds.length > 0 ? 'pick' : 'all',
      brandIds: c.scope?.brandIds ?? [],
      menuItemIds: c.scope?.menuItemIds ?? [],
      weekdays: c.weekdays ?? [],
      timeFrom: c.timeFrom ?? '',
      timeTo: c.timeTo ?? '',
      startsAt: c.startsAt ? c.startsAt.slice(0, 10) : '',
      endsAt: c.endsAt ? c.endsAt.slice(0, 10) : '',
      budgetMax: c.budgetMax != null ? String(c.budgetMax) : '',
      marginFloorPct: '',
      omnibusRefNote: c.omnibusRefNote ?? '',
    })
    setView('editor')
  }

  function backToList() {
    setView('list')
    loadAll()
  }

  if (accountsLoading || (loading && view === 'list')) {
    return <div className="p-6 text-sm text-text-secondary">Cargando ofertas…</div>
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Pestañas — solo fuera del editor de una campaña. El objetivo y la
          campaña que lo persigue viven juntos: es su casa. */}
      {view === 'list' && (
        <div className="flex items-center gap-1 border-b border-border-default">
          <TabButton active={tab === 'campanas'} onClick={() => setTab('campanas')} icon={<Megaphone size={15} />} label="Campañas" />
          <TabButton active={tab === 'objetivos'} onClick={() => setTab('objetivos')} icon={<Target size={15} />} label="Objetivos" />
        </div>
      )}

      {view === 'editor' ? (
        <CampaignEditor
          accountId={activeAccountId!}
          brands={brands}
          channels={channels}
          form={form}
          setForm={setForm}
          onBack={backToList}
        />
      ) : tab === 'objetivos' ? (
        <TargetsSection accountId={activeAccountId!} brands={brands} channels={channels} />
      ) : (
        <CampaignList
          campaigns={campaigns}
          error={error}
          hasChannels={channels.length > 0}
          onNew={openNew}
          onEditDraft={openDraft}
          onReload={loadAll}
        />
      )}
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-base ${
        active ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'
      }`}
    >
      {icon} {label}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Lista de campañas
// ─────────────────────────────────────────────────────────────────────

function CampaignList({
  campaigns, error, hasChannels, onNew, onEditDraft, onReload,
}: {
  campaigns: Campaign[]
  error: string | null
  hasChannels: boolean
  onNew: () => void
  onEditDraft: (c: Campaign) => void
  onReload: () => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // Campaña pendiente de confirmar su Finalización (abre ConfirmDialog).
  const [endTarget, setEndTarget] = useState<Campaign | null>(null)

  async function run(id: string, fn: () => Promise<void>) {
    setBusyId(id)
    setActionError(null)
    try { await fn(); onReload() }
    catch (e) { setActionError(String((e as Error)?.message ?? e)) }
    finally { setBusyId(null) }
  }

  async function confirmEnd() {
    if (!endTarget) return
    const target = endTarget
    await run(target.id, () => endCampaign(target.id))
    setEndTarget(null)
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-medium text-text-primary flex items-center gap-2">
            <Megaphone size={22} className="text-accent" /> Ofertas
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Campañas de promoción para Glovo y Uber Eats. Ve el impacto de margen real
            plato a plato antes de aprobar.
          </p>
        </div>
        <button
          type="button"
          onClick={onNew}
          disabled={!hasChannels}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md bg-accent text-white hover:opacity-90 transition-base disabled:opacity-40 shrink-0"
        >
          <Plus size={16} /> Nueva campaña
        </button>
      </div>

      {!hasChannels && (
        <div className="p-3 rounded-md bg-warning-bg text-warning border border-warning/30 text-sm">
          No hay canales de Glovo o Uber configurados en esta cuenta. Añádelos en
          Configuración de cuenta → Canales para poder crear campañas.
        </div>
      )}
      {error && <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>}
      {actionError && <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{actionError}</div>}

      <div className="rounded-lg border border-border-default bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border-default flex items-center gap-2">
          <Percent size={16} className="text-text-secondary" />
          <h2 className="text-sm font-medium text-text-primary">Campañas</h2>
          <span className="text-xs text-text-secondary">({campaigns.length})</span>
        </div>

        {campaigns.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-text-secondary">
            Aún no hay campañas. Crea la primera con “Nueva campaña”.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-text-secondary border-b border-border-default">
                  <th className="px-4 py-2 font-medium">Campaña</th>
                  <th className="px-4 py-2 font-medium">Canal</th>
                  <th className="px-4 py-2 font-medium">Marcas</th>
                  <th className="px-4 py-2 font-medium">Descuento</th>
                  <th className="px-4 py-2 font-medium">Vigencia</th>
                  <th className="px-4 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {campaigns.map((c) => {
                  const chip = statusChip(c)
                  const isAgentProposal = c.origin === 'agent' && c.status === 'borrador'
                  const reason = isAgentProposal ? agentReason(c.omnibusRefNote) : null
                  const ch = CHANNEL_META[c.channel]
                  const busy = busyId === c.id
                  return (
                    <tr key={c.id} className="hover:bg-page/60">
                      <td className="px-4 py-3">
                        <div className="font-medium text-text-primary">{c.name}</div>
                        {c.hasError && c.lastError && (
                          <div className="text-[11px] text-danger flex items-center gap-1 mt-0.5">
                            <AlertTriangle size={11} /> {c.lastError}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: ch.color }} />
                          {ch.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {c.brandNames.length > 0
                          ? c.brandNames.join(', ')
                          : c.scope?.brandIds?.length
                            ? `${c.scope.brandIds.length} marca(s)`
                            : '—'}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-text-primary">
                        {c.discountType === 'percent' ? `${c.value}%` : fmtEur(c.value)}
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-xs">
                        {fmtDate(c.startsAt)} → {fmtDate(c.endsAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${chip.cls}`}
                            title={reason ?? undefined}
                          >
                            {chip.label}
                          </span>
                          {reason && (
                            <div className="text-[11px] text-text-secondary leading-snug max-w-[240px]" title={reason}>
                              {reason}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {busy && <Loader2 size={14} className="animate-spin text-text-secondary" />}
                          {c.status === 'borrador' && (
                            <>
                              <button type="button" disabled={busy} onClick={() => onEditDraft(c)}
                                className="text-xs px-2 py-1 rounded-md border border-border-default text-text-secondary hover:text-accent transition-base">
                                Editar
                              </button>
                              <button type="button" disabled={busy} onClick={() => run(c.id, () => deleteDraft(c.id))}
                                className="p-1.5 rounded-md text-text-secondary hover:text-danger transition-base" title="Borrar borrador">
                                <Trash2 size={14} />
                              </button>
                            </>
                          )}
                          {/* Glovo NO soporta pausar/reanudar (su panel solo ofrece
                              Cancelar, irreversible). Encolar ese job sería mentir:
                              ocultamos ambos botones para canal glovo. */}
                          {c.channel !== 'glovo' && (c.status === 'pendiente' || c.status === 'publicada') && (
                            <button type="button" disabled={busy} onClick={() => run(c.id, () => pauseCampaign(c.id))}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border-default text-text-secondary hover:text-warning transition-base">
                              <Pause size={13} /> Pausar
                            </button>
                          )}
                          {c.channel !== 'glovo' && c.status === 'pausada' && (
                            <button type="button" disabled={busy} onClick={() => run(c.id, () => resumeCampaign(c.id))}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border-default text-text-secondary hover:text-success transition-base">
                              <Play size={13} /> Reanudar
                            </button>
                          )}
                          {(c.status === 'pendiente' || c.status === 'publicada' || c.status === 'pausada') && (
                            <button type="button" disabled={busy} onClick={() => setEndTarget(c)}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border-default text-text-secondary hover:text-danger transition-base">
                              <CircleStop size={13} /> Finalizar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-text-secondary flex items-center gap-1.5">
        <Info size={12} />
        “Pendiente de publicar” = en cola. La publicación automática en el panel del canal
        se activa con el agente (siguiente tramo).
      </p>

      {/* Finalizar = irreversible en Glovo. Confirmación con la verdad (nunca window.confirm). */}
      <ConfirmDialog
        open={endTarget !== null}
        title={endTarget?.channel === 'glovo' ? 'Finalizar campaña en Glovo' : 'Finalizar campaña'}
        message={
          endTarget?.channel === 'glovo'
            ? 'Glovo cancelará la promoción en todos los establecimientos. Esta acción es irreversible: Glovo no permite reactivar una promoción cancelada. Para volver a ofrecerla habrá que crear una campaña nueva.'
            : 'Se finalizará la campaña: se encolará la retirada de la promoción en todos los establecimientos del canal.'
        }
        confirmLabel="Finalizar campaña"
        cancelLabel="Cancelar"
        tone="danger"
        busy={endTarget !== null && busyId === endTarget.id}
        onConfirm={confirmEnd}
        onCancel={() => setEndTarget(null)}
      />
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Editor + impacto en vivo
// ─────────────────────────────────────────────────────────────────────

function CampaignEditor({
  accountId, brands, channels, form, setForm, onBack,
}: {
  accountId: string
  brands: Brand[]
  channels: ChannelOption[]
  form: FormState
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  onBack: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmingApprove, setConfirmingApprove] = useState(false)

  // Menú para el picker de platos (por marcas seleccionadas)
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [menuLoading, setMenuLoading] = useState(false)
  const [menuSearch, setMenuSearch] = useState('')

  // Preview
  const [rows, setRows] = useState<ImpactRow[]>([])
  const [aggregates, setAggregates] = useState<ImpactAggregates | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === form.channelId) ?? null,
    [channels, form.channelId],
  )

  const patch = useCallback((p: Partial<FormState>) => setForm((f) => ({ ...f, ...p })), [setForm])

  function toggleBrand(id: string) {
    setForm((f) => {
      const has = f.brandIds.includes(id)
      const brandIds = has ? f.brandIds.filter((x) => x !== id) : [...f.brandIds, id]
      // Al cambiar marcas, purga platos que ya no pertenecen (se recargan abajo).
      return { ...f, brandIds }
    })
  }
  function toggleWeekday(n: number) {
    setForm((f) => ({
      ...f,
      weekdays: f.weekdays.includes(n) ? f.weekdays.filter((x) => x !== n) : [...f.weekdays, n],
    }))
  }
  function toggleMenuItem(id: string) {
    setForm((f) => ({
      ...f,
      menuItemIds: f.menuItemIds.includes(id) ? f.menuItemIds.filter((x) => x !== id) : [...f.menuItemIds, id],
    }))
  }

  // Cargar platos cuando scopeMode='pick' y hay marcas.
  useEffect(() => {
    if (form.scopeMode !== 'pick' || form.brandIds.length === 0) { setMenuItems([]); return }
    let cancelled = false
    setMenuLoading(true)
    Promise.all(form.brandIds.map((bid) => listMenuItems({ accountId, brandId: bid, includeInactive: false })))
      .then((lists) => {
        if (cancelled) return
        const byId = new Map<string, MenuItem>()
        for (const list of lists) for (const mi of list) if (!byId.has(mi.id)) byId.set(mi.id, mi)
        setMenuItems(Array.from(byId.values()))
      })
      .catch(() => { if (!cancelled) setMenuItems([]) })
      .finally(() => { if (!cancelled) setMenuLoading(false) })
    return () => { cancelled = true }
  }, [accountId, form.scopeMode, form.brandIds])

  // Preview con debounce 400ms.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const value = numOrNull(form.value)
  const floor = numOrNull(form.marginFloorPct)
  const canPreview = !!selectedChannel && form.brandIds.length > 0 && value !== null && value > 0
  const menuItemIds = form.scopeMode === 'pick' && form.menuItemIds.length > 0 ? form.menuItemIds : null
  const brandKey = form.brandIds.join(',')
  const itemKey = menuItemIds ? menuItemIds.join(',') : 'all'

  useEffect(() => {
    if (!canPreview || !selectedChannel) { setRows([]); setAggregates(null); setPreviewError(null); return }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setPreviewLoading(true)
      setPreviewError(null)
      previewImpact({
        accountId,
        channelId: selectedChannel.id,
        brandIds: form.brandIds,
        discountType: form.discountType,
        discountValue: value!,
        menuItemIds,
        marginFloorPct: floor,
      })
        .then((res) => { setRows(res.rows); setAggregates(res.aggregates) })
        .catch((e) => { setPreviewError(String((e as Error)?.message ?? e)); setRows([]); setAggregates(null) })
        .finally(() => setPreviewLoading(false))
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, form.channelId, brandKey, form.discountType, form.value, itemKey, form.marginFloorPct])

  const belowFloorRows = rows.filter((r) => r.status === 'bajo_suelo')

  function buildDraft(): CampaignDraft {
    const iso = (d: string) => (d ? new Date(d + 'T00:00:00').toISOString() : null)
    return {
      id: form.id,
      accountId,
      name: form.name,
      channel: selectedChannel!.platform,
      channelId: selectedChannel!.id,
      discountType: form.discountType,
      value: value!,
      scope: { brandIds: form.brandIds, menuItemIds },
      weekdays: form.weekdays.length > 0 ? form.weekdays : null,
      timeFrom: form.timeFrom || null,
      timeTo: form.timeTo || null,
      startsAt: iso(form.startsAt),
      endsAt: iso(form.endsAt),
      budgetMax: numOrNull(form.budgetMax),
      marginFloorPct: floor,
      omnibusRefNote: form.omnibusRefNote || null,
    }
  }

  const validationError = useMemo(() => {
    if (!form.name.trim()) return 'Ponle un nombre a la campaña.'
    if (!selectedChannel) return 'Elige un canal.'
    if (form.brandIds.length === 0) return 'Selecciona al menos una marca.'
    if (value === null || value <= 0) return 'Introduce un descuento válido.'
    if (form.discountType === 'percent' && value > 100) return 'El porcentaje no puede superar 100.'
    if (form.startsAt && form.endsAt && form.endsAt < form.startsAt) return 'La fecha de fin es anterior a la de inicio.'
    return null
  }, [form, selectedChannel, value])

  async function handleSaveDraft() {
    if (validationError) { setSaveError(validationError); return }
    setSaving(true); setSaveError(null)
    try { await saveCampaign(buildDraft()); onBack() }
    catch (e) { setSaveError(String((e as Error)?.message ?? e)) }
    finally { setSaving(false) }
  }

  async function handleApprove() {
    if (validationError) { setSaveError(validationError); return }
    // Confirmación reforzada si hay platos bajo suelo.
    if (belowFloorRows.length > 0 && !confirmingApprove) { setConfirmingApprove(true); return }
    setSaving(true); setSaveError(null)
    try {
      const draft = buildDraft()
      const couponId = await saveCampaign(draft) // asegura fila + scope
      const brandNames: Record<string, string> = {}
      for (const b of brands) brandNames[b.id] = b.name
      await approveCampaign({ couponId, draft: { ...draft, id: couponId }, brandNames })
      onBack()
    } catch (e) {
      setSaveError(String((e as Error)?.message ?? e))
    } finally {
      setSaving(false)
      setConfirmingApprove(false)
    }
  }

  const inputCls = 'w-full px-2.5 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent'
  const labelCls = 'block text-[11px] font-medium text-text-secondary mb-1'

  const filteredMenu = menuItems.filter((mi) =>
    menuSearch.trim() === '' ? true : mi.name.toLowerCase().includes(menuSearch.trim().toLowerCase()),
  )

  return (
    <>
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-accent transition-base">
          <ArrowLeft size={16} /> Volver
        </button>
        <h1 className="text-xl font-display font-medium text-text-primary">
          {form.id ? 'Editar borrador' : 'Nueva campaña'}
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── FORMULARIO ── */}
        <div className="space-y-4">
          <div className="rounded-lg border border-border-default bg-card p-4 space-y-4">
            <div>
              <label className={labelCls}>Nombre de la campaña</label>
              <input className={inputCls} value={form.name} placeholder="Ej: 10% Dos Coyotes Glovo"
                onChange={(e) => patch({ name: e.target.value })} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Canal</label>
                <select className={inputCls} value={form.channelId} onChange={(e) => patch({ channelId: e.target.value })}>
                  {channels.length === 0 && <option value="">—</option>}
                  {channels.map((c) => <option key={c.id} value={c.id}>{c.name} ({CHANNEL_META[c.platform].label})</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Descuento</label>
                <div className="flex gap-2">
                  <select className={`${inputCls} w-20`} value={form.discountType}
                    onChange={(e) => patch({ discountType: e.target.value as DiscountType })}>
                    <option value="percent">%</option>
                    <option value="fixed">€</option>
                  </select>
                  <input className={inputCls} inputMode="decimal" value={form.value} placeholder="10"
                    onChange={(e) => patch({ value: e.target.value })} />
                </div>
              </div>
            </div>

            <div>
              <label className={labelCls}>Marcas</label>
              <div className="flex flex-wrap gap-1.5">
                {brands.length === 0 && <span className="text-xs text-text-secondary">No hay marcas activas.</span>}
                {brands.map((b) => {
                  const on = form.brandIds.includes(b.id)
                  return (
                    <button key={b.id} type="button" onClick={() => toggleBrand(b.id)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-base ${on ? 'bg-accent text-white border-accent' : 'bg-page text-text-secondary border-border-default hover:border-accent/50'}`}>
                      {b.name}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className={labelCls}>Alcance</label>
              <div className="flex gap-2 mb-2">
                <button type="button" onClick={() => patch({ scopeMode: 'all', menuItemIds: [] })}
                  className={`px-3 py-1.5 rounded-md text-xs border transition-base ${form.scopeMode === 'all' ? 'bg-accent/10 text-accent border-accent/40' : 'bg-page text-text-secondary border-border-default'}`}>
                  Toda la carta
                </button>
                <button type="button" onClick={() => patch({ scopeMode: 'pick' })}
                  className={`px-3 py-1.5 rounded-md text-xs border transition-base ${form.scopeMode === 'pick' ? 'bg-accent/10 text-accent border-accent/40' : 'bg-page text-text-secondary border-border-default'}`}>
                  Elegir platos
                </button>
              </div>
              {form.scopeMode === 'pick' && (
                <div className="border border-border-default rounded-md bg-page">
                  <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border-default">
                    <Search size={13} className="text-text-secondary" />
                    <input className="w-full bg-transparent text-xs text-text-primary focus:outline-none"
                      placeholder="Buscar plato…" value={menuSearch} onChange={(e) => setMenuSearch(e.target.value)} />
                    <span className="text-[10px] text-text-secondary shrink-0">{form.menuItemIds.length} sel.</span>
                  </div>
                  <div className="max-h-48 overflow-y-auto p-1.5 space-y-0.5">
                    {form.brandIds.length === 0 ? (
                      <p className="text-xs text-text-secondary px-1.5 py-2">Selecciona marcas primero.</p>
                    ) : menuLoading ? (
                      <p className="text-xs text-text-secondary px-1.5 py-2 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Cargando platos…</p>
                    ) : filteredMenu.length === 0 ? (
                      <p className="text-xs text-text-secondary px-1.5 py-2">Sin platos.</p>
                    ) : filteredMenu.map((mi) => {
                      const on = form.menuItemIds.includes(mi.id)
                      return (
                        <label key={mi.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-card cursor-pointer">
                          <input type="checkbox" checked={on} onChange={() => toggleMenuItem(mi.id)} className="accent-accent" />
                          <span className="text-xs text-text-primary truncate">{mi.name}</span>
                          <span className="text-[10px] text-text-secondary ml-auto tabular-nums">{fmtEur(mi.price)}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className={labelCls}>Días de la semana <span className="text-text-secondary/70">(vacío = todos)</span></label>
              <div className="flex gap-1.5">
                {WEEKDAYS.map((d) => {
                  const on = form.weekdays.includes(d.n)
                  return (
                    <button key={d.n} type="button" onClick={() => toggleWeekday(d.n)}
                      className={`w-8 h-8 rounded-md text-xs font-medium border transition-base ${on ? 'bg-accent text-white border-accent' : 'bg-page text-text-secondary border-border-default hover:border-accent/50'}`}>
                      {d.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Desde (hora)</label>
                <input type="time" className={inputCls} value={form.timeFrom} onChange={(e) => patch({ timeFrom: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Hasta (hora)</label>
                <input type="time" className={inputCls} value={form.timeTo} onChange={(e) => patch({ timeTo: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Inicio</label>
                <input type="date" className={inputCls} value={form.startsAt} onChange={(e) => patch({ startsAt: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Fin</label>
                <input type="date" className={inputCls} value={form.endsAt} onChange={(e) => patch({ endsAt: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Presupuesto máx (€) <span className="text-text-secondary/70">(opcional)</span></label>
                <input className={inputCls} inputMode="decimal" value={form.budgetMax} placeholder="—"
                  onChange={(e) => patch({ budgetMax: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Suelo de margen (%) <span className="text-text-secondary/70">(opcional)</span></label>
                <input className={inputCls} inputMode="decimal" value={form.marginFloorPct} placeholder="—"
                  onChange={(e) => patch({ marginFloorPct: e.target.value })} />
              </div>
            </div>

            <div>
              <label className={labelCls}>Nota Ómnibus <span className="text-text-secondary/70">(opcional)</span></label>
              <input className={inputCls} value={form.omnibusRefNote} placeholder="Precio de referencia de los últimos 30 días…"
                onChange={(e) => patch({ omnibusRefNote: e.target.value })} />
            </div>
          </div>

          {saveError && <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{saveError}</div>}

          {/* Confirmación reforzada */}
          {confirmingApprove && belowFloorRows.length > 0 && (
            <div className="p-3 rounded-md bg-danger-bg border border-danger/30 text-sm space-y-2">
              <div className="flex items-center gap-1.5 font-medium text-danger">
                <AlertTriangle size={15} /> {belowFloorRows.length} plato(s) quedan BAJO tu suelo de margen
              </div>
              <ul className="text-xs text-text-primary list-disc pl-5 space-y-0.5 max-h-32 overflow-y-auto">
                {belowFloorRows.map((r) => (
                  <li key={r.menuItemId}>
                    {r.itemName} <span className="text-text-secondary">({r.brandName})</span> — margen {fmtPct(r.margenPctDespues)}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-text-secondary">Pulsa de nuevo “Aprobar y publicar” para confirmar.</p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button type="button" onClick={handleSaveDraft} disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border border-border-default text-text-primary hover:bg-page transition-base disabled:opacity-50">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Guardar borrador
            </button>
            <button type="button" onClick={handleApprove} disabled={saving || !!validationError}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md text-white transition-base disabled:opacity-40 ${confirmingApprove && belowFloorRows.length > 0 ? 'bg-danger hover:opacity-90' : 'bg-accent hover:opacity-90'}`}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Megaphone size={15} />}
              {confirmingApprove && belowFloorRows.length > 0 ? 'Confirmar y publicar' : 'Aprobar y publicar'}
            </button>
            {validationError && <span className="text-xs text-text-secondary">{validationError}</span>}
          </div>
        </div>

        {/* ── IMPACTO EN VIVO ── */}
        <div className="space-y-3">
          <div className="rounded-lg border border-border-default bg-card">
            <div className="px-4 py-3 border-b border-border-default flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-text-primary">Impacto en margen (en vivo)</h2>
              {previewLoading && <Loader2 size={15} className="animate-spin text-text-secondary" />}
            </div>

            {!canPreview ? (
              <div className="px-4 py-10 text-center text-sm text-text-secondary">
                Elige canal, marcas y descuento para ver el impacto plato a plato.
              </div>
            ) : previewError ? (
              <div className="px-4 py-4 text-sm text-danger">{previewError}</div>
            ) : (
              <>
                {/* Cabecera de agregados */}
                {aggregates && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border-default">
                    <Stat label="Margen medio" value={
                      <span className="tabular-nums">
                        {fmtPct(aggregates.margenPctAntes)} <span className="text-text-secondary">→</span>{' '}
                        <span className={aggregates.margenPctDespues !== null && aggregates.margenPctAntes !== null && aggregates.margenPctDespues < aggregates.margenPctAntes ? 'text-warning' : 'text-success'}>
                          {fmtPct(aggregates.margenPctDespues)}
                        </span>
                      </span>
                    } />
                    <Stat label="Bajo suelo" value={<span className={aggregates.itemsBajoSuelo > 0 ? 'text-danger' : 'text-text-primary'}>{aggregates.itemsBajoSuelo}</span>} />
                    <Stat label="Sin escandallo" value={<span className="text-text-secondary">{aggregates.itemsSinEscandallo}</span>} />
                    <Stat label="Uds. 30d afectadas" value={<span className="tabular-nums">{aggregates.units30dAfectadas}</span>} />
                  </div>
                )}

                {/* Tabla por plato */}
                <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card">
                      <tr className="text-left text-[10px] uppercase tracking-wide text-text-secondary border-b border-border-default">
                        <th className="px-3 py-2 font-medium">Plato</th>
                        <th className="px-3 py-2 font-medium text-right">PVP → promo</th>
                        <th className="px-3 py-2 font-medium text-right">Margen %</th>
                        <th className="px-3 py-2 font-medium text-right">Uds 30d</th>
                        <th className="px-3 py-2 font-medium text-center">Sem.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-default">
                      {rows.length === 0 && !previewLoading && (
                        <tr><td colSpan={5} className="px-3 py-6 text-center text-text-secondary">Sin platos en el alcance.</td></tr>
                      )}
                      {rows.map((r) => {
                        const dim = r.status === 'sin_escandallo'
                        return (
                          <tr key={r.menuItemId} className={dim ? 'opacity-45' : ''}>
                            <td className="px-3 py-2">
                              <div className="text-text-primary truncate max-w-[180px]">{r.itemName}</div>
                              <div className="text-[10px] text-text-secondary">{r.brandName}</div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                              {fmtEur(r.pvpCliente)} <span className="text-text-secondary/60">→</span>{' '}
                              <span className="text-text-primary">{fmtEur(r.pvpPromoCliente)}</span>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              <span className="text-text-secondary">{fmtPct(r.margenPctAntes)}</span>
                              <span className="text-text-secondary/60"> → </span>
                              <span className={r.status === 'bajo_suelo' ? 'text-danger font-medium' : 'text-text-primary'}>{fmtPct(r.margenPctDespues)}</span>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{r.units30d}</td>
                            <td className="px-3 py-2 text-center"><Semaforo status={r.status} /></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <p className="text-[11px] text-text-secondary flex items-center gap-1.5">
            <Info size={12} /> La comisión fija por pedido del canal no se imputa por plato (es por pedido, no por plato).
          </p>
          <p className="text-[11px] text-text-secondary">
            Los platos <span className="opacity-60">sin escandallo</span> se muestran atenuados: sus números no son
            reales y no cuentan en el margen medio.
          </p>
        </div>
      </div>
    </>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-card px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-text-secondary">{label}</div>
      <div className="text-sm font-medium text-text-primary mt-0.5">{value}</div>
    </div>
  )
}

function Semaforo({ status }: { status: ImpactRow['status'] }) {
  const meta = {
    ok:            { cls: 'bg-success', title: 'OK' },
    bajo_suelo:    { cls: 'bg-danger', title: 'Bajo suelo' },
    sin_escandallo:{ cls: 'bg-text-secondary/40', title: 'Sin escandallo' },
  }[status]
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${meta.cls}`} title={meta.title} />
}

// ─────────────────────────────────────────────────────────────────────
// Objetivos por marca × canal × local (etapa Crecimiento)
// La tabla que gobierna al agente, editable sin SQL. Fuente: agent_sales_signal_v2
// (combos CON objetivo) + matriz completa marca-propia×local×canal (combos SIN).
// ─────────────────────────────────────────────────────────────────────

function shortLoc(name: string): string {
  return name.replace(/^Foodint\s+/i, '').trim()
}

function fmtNum(v: number): string {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(v)
}

/**
 * Semáforo del objetivo, cuadrado con la REGLA REAL del agente (offers-agent):
 *   rojo  = ventas casi a cero (<0,15 ped/día) → el agente saca la artillería.
 *   ámbar = por debajo del umbral de recuperación (% del objetivo < recoveryPct).
 *   verde = en objetivo (>= umbral) → el agente no empuja.
 * Sin objetivo → null (celda vacía, sin semáforo).
 */
function semaforo(
  target: number | null,
  sales: number | null,
  recoveryPct: number,
): { pct: number; dot: string; text: string } | null {
  if (target == null || target <= 0) return null
  const s = sales ?? 0
  const pct = Math.round((s / target) * 100)
  if (s < 0.15) return { pct, dot: 'bg-danger', text: 'text-danger font-medium' }
  if (pct < recoveryPct) return { pct, dot: 'bg-warning', text: 'text-warning' }
  return { pct, dot: 'bg-success', text: 'text-success' }
}

function TargetsSection({
  accountId, brands, channels,
}: {
  accountId: string
  brands: Brand[]
  channels: ChannelOption[]
}) {
  // Solo marcas PROPIAS (las cedidas jamás van a plataforma).
  const ownBrands = useMemo(
    () => brands.filter((b) => b.ownershipType === 'own').sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [brands],
  )
  // Canales de plataforma, Glovo primero.
  const platChannels = useMemo(() => {
    const order: PlatformChannel[] = ['glovo', 'uber']
    return [...channels].sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform))
  }, [channels])

  const [locations, setLocations] = useState<LocationOption[]>([])
  const [recoveryPct, setRecoveryPct] = useState<number>(80)
  const [signal, setSignal] = useState<SalesSignalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  // Edición inline (patrón Niveles de Almacén): draft por celda, guarda en blur/Enter.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  // Estático: locales + umbral (una vez por cuenta).
  useEffect(() => {
    let cancelled = false
    Promise.all([listLocations(accountId), getRecoveryTargetPct(accountId)])
      .then(([locs, pct]) => { if (!cancelled) { setLocations(locs); setRecoveryPct(pct) } })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)) })
    return () => { cancelled = true }
  }, [accountId])

  // Señal (recargable tras cada guardado).
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getSalesSignal(accountId)
      .then((rows) => { if (!cancelled) setSignal(rows) })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, tick])

  // Índice de la señal por (marca|canal|local): la señal trae el canal por nombre
  // ('Glovo'), lo resolvemos a channelId vía la plataforma.
  const signalByKey = useMemo(() => {
    const m = new Map<string, SalesSignalRow>()
    for (const r of signal) {
      const plat = platformOfChannel(r.channelName, null)
      const ch = channels.find((c) => c.platform === plat)
      if (!ch) continue
      m.set(`${r.brandId}|${ch.id}|${r.locationId}`, r)
    }
    return m
  }, [signal, channels])

  const cellKey = (brandId: string, channelId: string, locationId: string) =>
    `${brandId}|${channelId}|${locationId}`

  const displayVal = (key: string): string => {
    if (drafts[key] !== undefined) return drafts[key]
    const t = signalByKey.get(key)?.targetDaily
    return t != null ? String(t) : ''
  }

  function clearDraft(key: string) {
    setDrafts((d) => { const n = { ...d }; delete n[key]; return n })
  }

  async function commit(brandId: string, channelId: string, locationId: string) {
    const key = cellKey(brandId, channelId, locationId)
    const draft = drafts[key]
    if (draft === undefined) return
    const orig = signalByKey.get(key)?.targetDaily ?? null
    const parsed = numOrNull(draft)
    // Inválido (no numérico o negativo) → revertir sin tocar BD.
    if (draft.trim() !== '' && (parsed === null || parsed < 0)) { clearDraft(key); return }
    // Sin cambio real → limpiar draft.
    const nowNothing = parsed === null || parsed === 0
    if ((nowNothing && orig === null) || (parsed !== null && parsed === orig)) { clearDraft(key); return }
    setSaving(key); setError(null)
    try {
      if (nowNothing) {
        // Vacío o 0 = borrar la fila (preferible a acumular ceros).
        if (orig !== null) await deleteTarget({ accountId, brandId, channelId, locationId })
      } else {
        await upsertTarget({ accountId, brandId, channelId, locationId, targetDaily: parsed! })
      }
      clearDraft(key)
      setTick((t) => t + 1)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setSaving(null)
    }
  }

  if (loading && signal.length === 0) {
    return (
      <div className="p-6 text-sm text-text-secondary flex items-center gap-2">
        <Loader2 size={14} className="animate-spin" /> Cargando objetivos…
      </div>
    )
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-display font-medium text-text-primary flex items-center gap-2">
          <Target size={22} className="text-accent" /> Objetivos
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Pedidos/día que quieres por marca, canal y local. Es la vara del agente de ofertas: por
          debajo del objetivo propone promociones; a cero, saca la artillería.
        </p>
      </div>

      {error && <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>}

      {ownBrands.length === 0 ? (
        <div className="p-3 rounded-md bg-warning-bg text-warning border border-warning/30 text-sm">
          No hay marcas propias activas en esta cuenta.
        </div>
      ) : platChannels.length === 0 ? (
        <div className="p-3 rounded-md bg-warning-bg text-warning border border-warning/30 text-sm">
          No hay canales de Glovo o Uber configurados en esta cuenta.
        </div>
      ) : (
        platChannels.map((ch) => (
          <TargetsChannelTable
            key={ch.id}
            channel={ch}
            brands={ownBrands}
            locations={locations}
            signalByKey={signalByKey}
            recoveryPct={recoveryPct}
            saving={saving}
            displayVal={displayVal}
            cellKey={cellKey}
            setDrafts={setDrafts}
            clearDraft={clearDraft}
            onCommit={commit}
          />
        ))
      )}

      <p className="text-[11px] text-text-secondary flex items-start gap-1.5">
        <Info size={12} className="shrink-0 mt-0.5" />
        <span>
          Semáforo: <span className="text-danger font-medium">rojo</span> = casi a cero (&lt;0,15 ped/día,
          el agente saca artillería) · <span className="text-warning font-medium">ámbar</span> = por debajo del
          umbral de recuperación ({recoveryPct}% del objetivo) · <span className="text-success font-medium">verde</span> =
          en objetivo. Escribe el objetivo y pulsa Enter; vaciarlo (o 0) lo borra y el agente ignora esa combinación.
        </span>
      </p>
    </>
  )
}

function TargetsChannelTable({
  channel, brands, locations, signalByKey, recoveryPct, saving, displayVal, cellKey, setDrafts, clearDraft, onCommit,
}: {
  channel: ChannelOption
  brands: Brand[]
  locations: LocationOption[]
  signalByKey: Map<string, SalesSignalRow>
  recoveryPct: number
  saving: string | null
  displayVal: (key: string) => string
  cellKey: (brandId: string, channelId: string, locationId: string) => string
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>
  clearDraft: (key: string) => void
  onCommit: (brandId: string, channelId: string, locationId: string) => void
}) {
  const chMeta = CHANNEL_META[channel.platform]
  const isUber = channel.platform === 'uber'
  return (
    <div className="rounded-lg border border-border-default bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border-default flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: chMeta.color }} />
        <h2 className="text-sm font-medium text-text-primary">{chMeta.label}</h2>
        {isUber && (
          <span className="text-[11px] text-warning bg-warning-bg border border-warning/30 rounded-full px-2 py-0.5">
            brazo pendiente de Uber
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-text-secondary border-b border-border-default">
              <th className="px-4 py-2 font-medium">Marca</th>
              <th className="px-4 py-2 font-medium">Local</th>
              <th className="px-4 py-2 font-medium text-right">Objetivo</th>
              <th className="px-4 py-2 font-medium text-right">Ahora (7d)</th>
              <th className="px-4 py-2 font-medium text-right">% objetivo</th>
              <th className="px-4 py-2 font-medium text-right">Pico 12m</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {brands.map((b) =>
              locations.map((loc, li) => {
                const key = cellKey(b.id, channel.id, loc.id)
                const sig = signalByKey.get(key)
                const target = sig?.targetDaily ?? null
                const sales = sig?.sales7d ?? null
                const peak = sig?.peakDaily ?? null
                const sc = semaforo(target, sales, recoveryPct)
                const isSaving = saving === key
                return (
                  <tr key={key} className="hover:bg-page/60">
                    {li === 0 && (
                      <td className="px-4 py-2 align-top font-medium text-text-primary" rowSpan={locations.length}>
                        {b.name}
                      </td>
                    )}
                    <td className="px-4 py-2 text-text-secondary">{shortLoc(loc.name)}</td>
                    <td className="px-4 py-2 text-right">
                      <span className="inline-flex items-center gap-1 justify-end">
                        {isSaving && <Loader2 size={12} className="animate-spin text-text-secondary" />}
                        <input
                          value={displayVal(key)}
                          inputMode="decimal"
                          placeholder="—"
                          disabled={isSaving}
                          onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                          onBlur={() => onCommit(b.id, channel.id, loc.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur()
                            else if (e.key === 'Escape') { clearDraft(key); e.currentTarget.blur() }
                          }}
                          className="w-16 h-7 px-1.5 text-xs text-right rounded-md border border-border-default bg-card text-text-primary tabular-nums focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                        />
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                      {target != null ? fmtNum(sales ?? 0) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {sc ? (
                        <span className="inline-flex items-center gap-1.5 justify-end tabular-nums">
                          <span className={`inline-block w-2 h-2 rounded-full ${sc.dot}`} />
                          <span className={sc.text}>{sc.pct}%</span>
                        </span>
                      ) : (
                        <span className="text-text-secondary/50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-text-secondary/60">
                      {peak != null && peak > 0 ? fmtNum(peak) : '—'}
                    </td>
                  </tr>
                )
              }),
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
