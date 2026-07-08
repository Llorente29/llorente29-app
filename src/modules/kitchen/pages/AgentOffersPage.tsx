// src/modules/kitchen/pages/AgentOffersPage.tsx
//
// OFERTAS DEL AGENTE — board unificado de los 4 canales (shop/glovo/uber/justeat)
// en una sola pantalla. Sustituye la vista partida (kitchen/PlatformOffersPage solo
// glovo/uber + shop/ShopCampaignsPage). Lectura única vía agent_offers_unified
// (agentOffersService). Se monta como ruta interna del módulo Kitchen (kitchen/ofertas);
// NO toca App.tsx. Autocontenida y re-alojable (ver nota de Julio 08/07 sobre la futura
// reorganización de módulos): página + service + RPC desacoplados; re-alojar = cambiar
// una entrada del registry, no reescribir.
//
// T2 = la VISTA (ver las 126 juntas, con su porqué, su estado y su verdad de publicación
// por canal, + margen real al expandir en plataforma). "Publicar todas de golpe" (el
// despachador honesto por canal) llega en T3.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Loader2, RefreshCw, Megaphone, Zap, Bot, Hand, Target, AlertTriangle,
  ChevronDown, ChevronRight, Sparkles, Filter, Rocket, CheckCircle2, X,
  Pause, Play, CircleStop, Trash2, Pencil, Search,
} from 'lucide-react'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  listAgentOffers, getLastRunAt, groupByChannel, previewOfferMargin, publishOffers,
  publishOne, pauseOffer, resumeOffer, endOffer, discardOffer,
  getOfferEditData, saveOfferEdit, previewOfferMarginWith,
  OFFER_CHANNELS, CHANNEL_LABEL,
  type AgentOffer, type OfferChannel, type OfferStatus, type PublishMode, type OfferMargin,
  type PublishResult, type OfferEditData, type OfferEditInput, type DiscountType,
} from '@/modules/kitchen/services/agentOffersService'

// ─────────────────────────────────────────────────────────────────────
// Formato
// ─────────────────────────────────────────────────────────────────────

function fmtEur(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}
function fmtDate(v: string | null): string {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) } catch { return '—' }
}
function fmtDateTime(v: string | null): string {
  if (!v) return '—'
  try { return new Date(v).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return '—' }
}

const WD = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] // getDay: 0=domingo

function offerLine(o: AgentOffer): string {
  if (o.kind === 'free_delivery') return 'Envío gratis'
  if (o.kind === 'free_item') return 'Plato de regalo'
  if (o.kind === 'bogo') return o.value >= 100 ? '2x1' : `2ª al −${o.value}%`
  const v = o.discountType === 'percent' ? `−${o.value}%` : fmtEur(o.value)
  return o.kind === 'item_percent' ? `${v} platos` : `${v} carta`
}

const STATUS_META: Record<OfferStatus, { label: string; cls: string }> = {
  propuesta:  { label: 'Propuesta',  cls: 'bg-accent/10 text-accent border-accent/30' },
  borrador:   { label: 'Borrador',   cls: 'bg-page text-text-secondary border-border-default' },
  programada: { label: 'Programada', cls: 'bg-accent/10 text-accent border-accent/30' },
  publicada:  { label: 'Publicada',  cls: 'bg-success-bg text-success border-success/40' },
  pendiente:  { label: 'Pendiente',  cls: 'bg-warning-bg text-warning border-warning/30' },
  pausada:    { label: 'Pausada',    cls: 'bg-page text-text-secondary border-border-default' },
  finalizada: { label: 'Finalizada', cls: 'bg-page text-text-secondary/70 border-border-default' },
  agotada:    { label: 'Agotada',    cls: 'bg-page text-text-secondary border-border-default' },
}

const PUBLISH_META: Record<PublishMode, { label: string; icon: typeof Zap; cls: string }> = {
  auto:   { label: 'se publica sola', icon: Zap,  cls: 'text-success' },
  robot:  { label: 'robot publica',   icon: Bot,  cls: 'text-success' },
  manual: { label: 'a mano',          icon: Hand, cls: 'text-warning' },
}

const COLLAPSED_LIMIT = 6

// ─────────────────────────────────────────────────────────────────────
// Página
// ─────────────────────────────────────────────────────────────────────

export default function AgentOffersPage() {
  const { activeAccountId: accountId } = useActiveAccount()

  const [offers, setOffers] = useState<AgentOffer[]>([])
  const [lastRun, setLastRun] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [onlyProposals, setOnlyProposals] = useState(false)
  const [expandedCols, setExpandedCols] = useState<Record<string, boolean>>({})

  // T3 — publicación por lotes.
  const [publishTarget, setPublishTarget] = useState<'all' | OfferChannel | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [result, setResult] = useState<PublishResult | null>(null)

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    setError(null)
    try {
      const [rows, run] = await Promise.all([
        listAgentOffers(accountId),
        getLastRunAt(accountId).catch(() => null),
      ])
      setOffers(rows)
      setLastRun(run)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando las ofertas.')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(
    () => (onlyProposals ? offers.filter((o) => o.status === 'propuesta') : offers),
    [offers, onlyProposals],
  )
  const grouped = useMemo(() => groupByChannel(filtered), [filtered])
  const proposals = useMemo(() => offers.filter((o) => o.status === 'propuesta'), [offers])
  const proposalCount = proposals.length
  const proposalsByChannel = useMemo(() => groupByChannel(proposals), [proposals])

  // Ofertas objetivo de la confirmación abierta (todas o de un canal).
  const targetOffers = useMemo(() => {
    if (publishTarget === null) return []
    return publishTarget === 'all' ? proposals : proposalsByChannel[publishTarget]
  }, [publishTarget, proposals, proposalsByChannel])

  const doPublish = useCallback(async () => {
    if (!accountId || targetOffers.length === 0) { setPublishTarget(null); return }
    setPublishing(true)
    try {
      const r = await publishOffers(accountId, targetOffers)
      setResult(r)
      setPublishTarget(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error publicando.')
      setPublishTarget(null)
    } finally {
      setPublishing(false)
    }
  }, [accountId, targetOffers, load])

  // Acciones por oferta.
  const [actionBusyId, setActionBusyId] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ offer: AgentOffer; kind: 'end' | 'discard' } | null>(null)
  const [editOffer, setEditOffer] = useState<AgentOffer | null>(null)

  const runAction = useCallback(async (offer: AgentOffer, kind: 'publish' | 'pause' | 'resume' | 'end' | 'discard') => {
    if (!accountId) return
    // Finalizar y descartar piden confirmación.
    if (kind === 'end' || kind === 'discard') { setConfirmAction({ offer, kind }); return }
    setActionBusyId(offer.id)
    setError(null)
    try {
      const r = kind === 'publish' ? await publishOne(accountId, offer)
        : kind === 'pause' ? await pauseOffer(accountId, offer)
        : await resumeOffer(accountId, offer)
      if (!r.ok) setError(r.reason ?? 'No se pudo completar la acción.')
      await load()
    } finally {
      setActionBusyId(null)
    }
  }, [accountId, load])

  const doConfirmedAction = useCallback(async () => {
    if (!accountId || !confirmAction) return
    const { offer, kind } = confirmAction
    setActionBusyId(offer.id)
    setError(null)
    try {
      const r = kind === 'end' ? await endOffer(accountId, offer) : await discardOffer(accountId, offer)
      if (!r.ok) setError(r.reason ?? 'No se pudo completar la acción.')
      setConfirmAction(null)
      await load()
    } finally {
      setActionBusyId(null)
    }
  }, [accountId, confirmAction, load])

  if (!accountId) {
    return <div className="p-6 text-sm text-text-secondary">Selecciona una cuenta para ver las ofertas.</div>
  }

  return (
    <div className="pb-16">
      {/* Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-medium text-text-primary flex items-center gap-2">
            <Megaphone size={20} className="text-accent" /> Ofertas del agente
          </h1>
          <p className="text-sm text-text-secondary mt-0.5">
            {offers.length} ofertas · {proposalCount} propuestas sin publicar
            {lastRun ? ` · última corrida ${fmtDateTime(lastRun)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOnlyProposals((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${
              onlyProposals ? 'bg-accent/10 text-accent border-accent/40' : 'bg-card text-text-secondary border-border-default hover:bg-page/60'
            }`}
          >
            <Filter size={14} /> Solo propuestas
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-card px-3 py-1.5 text-sm text-text-secondary hover:bg-page/60"
          >
            <RefreshCw size={14} /> Actualizar
          </button>
          {proposalCount > 0 && (
            <button
              type="button"
              onClick={() => setPublishTarget('all')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent/90"
            >
              <Rocket size={14} /> Publicar todas ({proposalCount})
            </button>
          )}
        </div>
      </div>

      {/* Nota honesta de publicación por canal */}
      <div className="mb-4 rounded-lg border border-border-default bg-page/60 px-3 py-2 text-xs text-text-secondary">
        Al publicar: <b className="text-success">Shop</b> se publica solo · <b className="text-success">Glovo</b> lo publica el robot · <b className="text-warning">Uber</b> y <b className="text-warning">JustEat</b> se activan y te doy la lista para publicarlas a mano en su panel.
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>
      )}

      {result && <PublishResultBanner result={result} onClose={() => setResult(null)} />}

      {loading ? (
        <div className="flex items-center gap-2 py-16 justify-center text-text-secondary">
          <Loader2 size={18} className="animate-spin" /> Cargando ofertas…
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {OFFER_CHANNELS.map((ch) => (
            <ChannelColumn
              key={ch}
              channel={ch}
              offers={grouped[ch]}
              expanded={!!expandedCols[ch]}
              onToggleExpand={() => setExpandedCols((p) => ({ ...p, [ch]: !p[ch] }))}
              accountId={accountId}
              proposalCount={proposalsByChannel[ch].length}
              onPublish={() => setPublishTarget(ch)}
              onAction={runAction}
              actionBusyId={actionBusyId}
              onEdit={setEditOffer}
            />
          ))}
        </div>
      )}

      {/* Leyenda */}
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary/70">
        <Legend cls="bg-accent" label="propuesta" />
        <Legend cls="bg-success" label="publicada" />
        <Legend cls="bg-warning" label="pendiente / ajustada" />
        <Legend cls="bg-text-secondary/40" label="pausada / borrador" />
      </div>

      <ConfirmDialog
        open={publishTarget !== null}
        title={publishTarget === 'all' ? 'Publicar todas las propuestas' : `Publicar propuestas de ${publishTarget ? CHANNEL_LABEL[publishTarget] : ''}`}
        message={publishConfirmMessage(targetOffers)}
        confirmLabel={`Publicar ${targetOffers.length}`}
        cancelLabel="Cancelar"
        busy={publishing}
        onConfirm={() => void doPublish()}
        onCancel={() => setPublishTarget(null)}
      />

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction?.kind === 'end'
          ? (confirmAction.offer.channel === 'glovo' ? 'Finalizar en Glovo (irreversible)' : 'Finalizar oferta')
          : 'Descartar propuesta'}
        message={confirmAction?.kind === 'end'
          ? (confirmAction.offer.channel === 'glovo'
              ? 'Glovo cancelará la promoción en todos los establecimientos. Es IRREVERSIBLE: para volver a ofrecerla habrá que crear una nueva.'
              : confirmAction.offer.channel === 'shop'
                ? 'Se desactivará la oferta en tu tienda. Podrás reactivarla cuando quieras.'
                : 'Se retirará la oferta del canal.')
          : 'Se eliminará esta propuesta del agente. No afecta a nada publicado.'}
        confirmLabel={confirmAction?.kind === 'end' ? 'Finalizar' : 'Descartar'}
        cancelLabel="Cancelar"
        tone="danger"
        busy={actionBusyId === confirmAction?.offer.id}
        onConfirm={() => void doConfirmedAction()}
        onCancel={() => setConfirmAction(null)}
      />

      {editOffer && (
        <OfferEditorModal
          offer={editOffer}
          accountId={accountId}
          onClose={() => setEditOffer(null)}
          onSaved={async () => { setEditOffer(null); await load() }}
        />
      )}
    </div>
  )
}

/** Desglose honesto por canal para la confirmación. */
function publishConfirmMessage(offers: AgentOffer[]): string {
  const n = { shop: 0, glovo: 0, uber: 0, justeat: 0 } as Record<OfferChannel, number>
  for (const o of offers) n[o.channel]++
  const parts: string[] = []
  if (n.shop) parts.push(`${n.shop} en Shop (se publican solas)`)
  if (n.glovo) parts.push(`${n.glovo} en Glovo (las publica el robot)`)
  if (n.uber) parts.push(`${n.uber} en Uber (se activan; publícalas a mano en Uber Manager)`)
  if (n.justeat) parts.push(`${n.justeat} en JustEat (se activan; publícalas a mano en JustEat)`)
  if (parts.length === 0) return 'No hay propuestas que publicar.'
  return `Vas a publicar ${offers.length} ${offers.length === 1 ? 'oferta' : 'ofertas'}: ${parts.join(' · ')}.`
}

/** Panel de resultado tras publicar: qué salió de verdad + deberes "a mano". */
function PublishResultBanner({ result, onClose }: { result: PublishResult; onClose: () => void }) {
  const manual = result.manualUber.length + result.manualJustEat.length
  return (
    <div className="mb-4 rounded-lg border border-success/40 bg-success-bg px-3 py-2.5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-success">
          <CheckCircle2 size={16} />
          <span className="font-medium">
            Publicadas: {result.shopPublished} en Shop · {result.glovoQueued} en Glovo (al robot)
          </span>
        </div>
        <button type="button" onClick={onClose} className="text-text-secondary hover:text-text-primary"><X size={14} /></button>
      </div>

      {manual > 0 && (
        <div className="mt-2 text-text-secondary">
          <div className="flex items-center gap-1.5 text-warning mb-1">
            <Hand size={13} /> Pendientes de publicar a mano ({manual}):
          </div>
          {result.manualUber.length > 0 && (
            <div className="ml-4"><b className="text-text-primary">Uber Manager:</b> {result.manualUber.join(' · ')}</div>
          )}
          {result.manualJustEat.length > 0 && (
            <div className="ml-4"><b className="text-text-primary">JustEat:</b> {result.manualJustEat.join(' · ')}</div>
          )}
        </div>
      )}

      {result.errors.length > 0 && (
        <div className="mt-2 text-danger">
          {result.errors.length} con error: {result.errors.map((e) => e.name).join(', ')}
        </div>
      )}
    </div>
  )
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full ${cls}`} /> {label}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Columna de canal
// ─────────────────────────────────────────────────────────────────────

function ChannelColumn({ channel, offers, expanded, onToggleExpand, accountId, proposalCount, onPublish, onAction, actionBusyId, onEdit }: {
  channel: OfferChannel
  offers: AgentOffer[]
  expanded: boolean
  onToggleExpand: () => void
  accountId: string
  proposalCount: number
  onPublish: () => void
  onAction: (offer: AgentOffer, kind: 'publish' | 'pause' | 'resume' | 'end' | 'discard') => void
  actionBusyId: string | null
  onEdit: (offer: AgentOffer) => void
}) {
  const pub = PUBLISH_META[
    channel === 'shop' ? 'auto' : channel === 'glovo' ? 'robot' : 'manual'
  ]
  const PubIcon = pub.icon
  const visible = expanded ? offers : offers.slice(0, COLLAPSED_LIMIT)
  const rest = offers.length - visible.length

  return (
    <div className="rounded-xl bg-page/50 border border-border-default p-2.5">
      <div className="flex items-center justify-between px-1 mb-0.5">
        <span className="text-sm font-medium text-text-primary">{CHANNEL_LABEL[channel]}</span>
        <span className="text-xs text-text-secondary">{offers.length}</span>
      </div>
      <div className="flex items-center justify-between px-1 mb-2.5">
        <span className={`flex items-center gap-1 text-xs ${pub.cls}`}>
          <PubIcon size={12} /> {pub.label}
        </span>
        {proposalCount > 0 && (
          <button
            type="button"
            onClick={onPublish}
            className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs text-accent hover:bg-accent/15"
          >
            <Rocket size={11} /> Publicar {proposalCount}
          </button>
        )}
      </div>

      {offers.length === 0 ? (
        <div className="text-xs text-text-secondary/60 px-1 py-6 text-center">Sin ofertas.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((o) => <OfferCard key={o.id} offer={o} accountId={accountId} onAction={onAction} actionBusyId={actionBusyId} onEdit={onEdit} />)}
          {rest > 0 && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="text-xs text-accent hover:text-accent/80 py-1 text-center"
            >
              {expanded ? 'Ver menos' : `Ver todas (${offers.length})`}
            </button>
          )}
          {expanded && offers.length > COLLAPSED_LIMIT && (
            <button type="button" onClick={onToggleExpand} className="text-xs text-text-secondary hover:text-text-primary py-1 text-center">
              Ver menos
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Tarjeta de oferta (+ expand con detalle y margen real)
// ─────────────────────────────────────────────────────────────────────

function OfferCard({ offer, accountId, onAction, actionBusyId, onEdit }: {
  offer: AgentOffer
  accountId: string
  onAction: (offer: AgentOffer, kind: 'publish' | 'pause' | 'resume' | 'end' | 'discard') => void
  actionBusyId: string | null
  onEdit: (offer: AgentOffer) => void
}) {
  const [open, setOpen] = useState(false)
  const [margin, setMargin] = useState<OfferMargin | null | 'loading'>(null)

  const st = STATUS_META[offer.status]
  const brand = offer.brandNames[0] ?? offer.name
  const loc = offer.locationNames[0] ?? null

  const openCard = useCallback(async () => {
    const next = !open
    setOpen(next)
    if (next && offer.channel !== 'shop' && margin === null) {
      setMargin('loading')
      const m = await previewOfferMargin(accountId, offer)
      setMargin(m)
    }
  }, [open, offer, accountId, margin])

  return (
    <div className="rounded-lg border border-border-default bg-card">
      <button type="button" onClick={() => void openCard()} className="w-full text-left p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-primary truncate">{brand}</div>
            {loc && <div className="text-xs text-text-secondary/70 truncate">{loc}</div>}
          </div>
          {open ? <ChevronDown size={14} className="text-text-secondary shrink-0 mt-0.5" /> : <ChevronRight size={14} className="text-text-secondary shrink-0 mt-0.5" />}
        </div>

        <div className="text-sm text-text-secondary mt-1">{offerLine(offer)}</div>

        {/* Porqué (una línea) */}
        {(offer.reason.headline || offer.reason.adjusted || offer.reason.eventUp) && (
          <div className="flex items-center gap-1 mt-1.5 text-xs">
            {offer.reason.adjusted ? (
              <span className="inline-flex items-center gap-1 text-warning">
                <AlertTriangle size={11} /> ajustado {offer.reason.adjusted}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-text-secondary/80 truncate">
                <Target size={11} className="shrink-0" /> {offer.reason.headline ?? 'propuesta del agente'}
              </span>
            )}
          </div>
        )}

        {/* Chips: estado (+ evento) */}
        <div className="flex flex-wrap gap-1 mt-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
          {offer.reason.eventUp && (
            <span className="text-[10px] px-2 py-0.5 rounded-full border bg-accent/5 text-accent border-accent/20">
              <Sparkles size={9} className="inline mr-0.5" /> evento
            </span>
          )}
          {offer.channel === 'shop' && offer.roi != null && (
            <span className="text-[10px] px-2 py-0.5 rounded-full border bg-success-bg text-success border-success/40">
              ROI {offer.roi.toFixed(1).replace('.', ',')}×
            </span>
          )}
        </div>
      </button>

      {/* Detalle */}
      {open && (
        <div className="border-t border-border-default px-2.5 py-2.5 text-xs text-text-secondary space-y-2">
          {/* Ventana */}
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <span><span className="text-text-secondary/60">Días:</span> {offer.weekdays && offer.weekdays.length ? offer.weekdays.map((n) => WD[n] ?? '').join('') : 'todos'}</span>
            {offer.timeFrom && offer.timeTo && (
              <span><span className="text-text-secondary/60">Franja:</span> {offer.timeFrom.slice(0, 5)}–{offer.timeTo.slice(0, 5)}</span>
            )}
            {offer.startsAt && <span><span className="text-text-secondary/60">Desde:</span> {fmtDate(offer.startsAt)}</span>}
            {offer.endsAt && <span><span className="text-text-secondary/60">Hasta:</span> {fmtDate(offer.endsAt)}</span>}
            {offer.budgetMax != null && <span><span className="text-text-secondary/60">Tope:</span> {fmtEur(offer.budgetMax)}</span>}
          </div>

          {/* Por qué esta oferta — el motivo COMPLETO del agente (siempre visible al expandir).
              Hoy el evento real es meteo; cuando exista el recolector sports-events, el
              partido/derbi/festivo aparecerá aquí solo, sin tocar la pantalla. */}
          {offer.reason.fullText && (
            <div>
              <div className="text-text-secondary/60 mb-0.5">Por qué esta oferta</div>
              <div className="text-text-primary leading-relaxed">{offer.reason.fullText}</div>
            </div>
          )}

          {/* Margen real (plataforma, bajo demanda) o ROI real (Shop) */}
          {offer.channel === 'shop' ? (
            offer.redemptions > 0 ? (
              <div className="rounded-md bg-success-bg/60 border border-success/30 px-2 py-1.5 text-success">
                {offer.redemptions} {offer.redemptions === 1 ? 'canje' : 'canjes'} · {fmtEur(offer.discounted)} invertido{offer.roi != null ? ` · ROI ${offer.roi.toFixed(1).replace('.', ',')}×` : ''}
              </div>
            ) : (
              <div className="text-text-secondary/70">Sin canjes todavía.</div>
            )
          ) : margin === 'loading' ? (
            <div className="flex items-center gap-1.5 text-text-secondary/70"><Loader2 size={12} className="animate-spin" /> Calculando margen real…</div>
          ) : margin ? (
            <div className="rounded-md bg-page/70 border border-border-default px-2 py-1.5">
              <div className="text-text-primary">
                Margen medio: <b>{margin.marginPctBefore != null ? `${margin.marginPctBefore}%` : '—'}</b>
                {' → '}
                <b className={margin.marginPctAfter != null && margin.marginPctAfter < 45 ? 'text-warning' : 'text-success'}>
                  {margin.marginPctAfter != null ? `${margin.marginPctAfter}%` : '—'}
                </b>
              </div>
              {(margin.itemsBelowFloor > 0 || margin.itemsNoCost > 0) && (
                <div className="text-text-secondary/70 mt-0.5">
                  {margin.itemsBelowFloor > 0 && <>{margin.itemsBelowFloor} bajo suelo · </>}
                  {margin.itemsNoCost > 0 && <>{margin.itemsNoCost} sin escandallo</>}
                </div>
              )}
            </div>
          ) : (
            <div className="text-text-secondary/60">Margen no disponible (falta escandallo o alcance).</div>
          )}

          {/* Estado de publicación en plataforma */}
          {offer.channel !== 'shop' && offer.jobsTotal > 0 && (
            <div className="text-text-secondary/80">
              Publicación: {offer.jobsDone}/{offer.jobsTotal} hecho
              {offer.jobsError > 0 && <span className="text-danger"> · {offer.jobsError} error</span>}
              {offer.lastError && <div className="text-danger/80 mt-0.5 truncate" title={offer.lastError}>{offer.lastError}</div>}
            </div>
          )}
          {offer.reason.manualNote && (
            <div className="flex items-start gap-1.5 text-warning">
              <Hand size={12} className="shrink-0 mt-0.5" /> {offer.reason.manualNote}
            </div>
          )}

          {/* Acciones por oferta (según estado). Editar solo en propuestas/borradores. */}
          <OfferActions offer={offer} onAction={onAction} onEdit={onEdit} busy={actionBusyId === offer.id} />
        </div>
      )}
    </div>
  )
}

function ActionBtn({ onClick, busy, icon: Icon, label, danger }: {
  onClick: () => void
  busy: boolean
  icon: typeof Rocket
  label: string
  danger?: boolean
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${
        danger
          ? 'border-danger/30 bg-danger-bg text-danger hover:bg-danger/10'
          : 'border-border-default bg-card text-text-secondary hover:bg-page/60'
      }`}
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : <Icon size={11} />} {label}
    </button>
  )
}

function OfferActions({ offer, onAction, onEdit, busy }: {
  offer: AgentOffer
  onAction: (offer: AgentOffer, kind: 'publish' | 'pause' | 'resume' | 'end' | 'discard') => void
  onEdit: (offer: AgentOffer) => void
  busy: boolean
}) {
  const s = offer.status
  const isProposal = s === 'propuesta' || s === 'borrador'
  const isLive = s === 'publicada' || s === 'pendiente'
  const isPaused = s === 'pausada'
  if (!isProposal && !isLive && !isPaused) return null

  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {isProposal && (
        <>
          <ActionBtn onClick={() => onAction(offer, 'publish')} busy={busy} icon={Rocket} label="Publicar" />
          <ActionBtn onClick={() => onEdit(offer)} busy={busy} icon={Pencil} label="Editar" />
          <ActionBtn onClick={() => onAction(offer, 'discard')} busy={busy} icon={Trash2} label="Descartar" danger />
        </>
      )}
      {isLive && (
        <>
          <ActionBtn onClick={() => onAction(offer, 'pause')} busy={busy} icon={Pause} label="Pausar" />
          {offer.channel !== 'shop' && (
            <ActionBtn onClick={() => onAction(offer, 'end')} busy={busy} icon={CircleStop} label="Finalizar" danger />
          )}
        </>
      )}
      {isPaused && (
        <>
          <ActionBtn onClick={() => onAction(offer, 'resume')} busy={busy} icon={Play} label="Reanudar" />
          {offer.channel !== 'shop' && (
            <ActionBtn onClick={() => onAction(offer, 'end')} busy={busy} icon={CircleStop} label="Finalizar" danger />
          )}
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Editor enfocado de una oferta (pieza 2). Canal y marca FIJOS.
// ─────────────────────────────────────────────────────────────────────

const WEEKDAY_TOGGLES: { n: number; label: string }[] = [
  { n: 1, label: 'L' }, { n: 2, label: 'M' }, { n: 3, label: 'X' },
  { n: 4, label: 'J' }, { n: 5, label: 'V' }, { n: 6, label: 'S' }, { n: 0, label: 'D' },
]

function numOrNull(s: string): number | null {
  const t = s.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
function isoToDate(iso: string | null): string {
  if (!iso) return ''
  try { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10) } catch { return '' }
}

function OfferEditorModal({ offer, accountId, onClose, onSaved }: {
  offer: AgentOffer
  accountId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [data, setData] = useState<OfferEditData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [discountType, setDiscountType] = useState<DiscountType>(offer.discountType)
  const [value, setValue] = useState(String(offer.value ?? ''))
  const [scopeMode, setScopeMode] = useState<'all' | 'pick'>('all')
  const [picked, setPicked] = useState<string[]>([])
  const [weekdays, setWeekdays] = useState<number[]>(offer.weekdays ?? [])
  const [timeFrom, setTimeFrom] = useState((offer.timeFrom ?? '').slice(0, 5))
  const [timeTo, setTimeTo] = useState((offer.timeTo ?? '').slice(0, 5))
  const [startsAt, setStartsAt] = useState(isoToDate(offer.startsAt))
  const [endsAt, setEndsAt] = useState(isoToDate(offer.endsAt))
  const [budgetMax, setBudgetMax] = useState(offer.budgetMax != null ? String(offer.budgetMax) : '')
  const [dishSearch, setDishSearch] = useState('')

  const [margin, setMargin] = useState<OfferMargin | null | 'loading'>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getOfferEditData(accountId, offer)
      .then((d) => {
        if (cancelled) return
        setData(d)
        if (d.menuItemIds.length > 0) { setScopeMode('pick'); setPicked(d.menuItemIds) }
      })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Error cargando la oferta.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, offer])

  const num = numOrNull(value)
  const menuItemIds = scopeMode === 'pick' && picked.length > 0 ? picked : null

  // Margen en vivo (plataforma), debounced.
  useEffect(() => {
    if (!data || offer.channel === 'shop' || !(num && num > 0) || data.brandIds.length === 0) { setMargin(null); return }
    let cancelled = false
    setMargin('loading')
    const t = setTimeout(() => {
      previewOfferMarginWith({
        accountId, channelId: data.channelId, brandIds: data.brandIds,
        discountType, value: num, menuItemIds,
      }).then((m) => { if (!cancelled) setMargin(m) })
    }, 400)
    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, discountType, value, scopeMode, picked.join(',')])

  const validation = (): string | null => {
    if (num === null || num <= 0) return 'Introduce un descuento válido.'
    if (discountType === 'percent' && num > 100) return 'El porcentaje no puede superar 100.'
    if (!endsAt) return 'Pon una fecha de fin antes de lanzar la oferta.'
    if (startsAt && endsAt < startsAt) return 'La fecha de fin es anterior a la de inicio.'
    if (scopeMode === 'pick' && picked.length === 0) return 'Elige al menos un plato, o cambia a "Toda la carta".'
    return null
  }

  async function handleSave() {
    const v = validation()
    if (v) { setErr(v); return }
    setSaving(true); setErr(null)
    const input: OfferEditInput = {
      discountType,
      value: num!,
      menuItemIds,
      weekdays: weekdays.length > 0 ? weekdays : null,
      timeFrom: timeFrom || null,
      timeTo: timeTo || null,
      startsAt: startsAt ? new Date(startsAt + 'T00:00:00').toISOString() : null,
      endsAt: endsAt ? new Date(endsAt + 'T23:59:59').toISOString() : null,
      budgetMax: numOrNull(budgetMax),
    }
    const r = await saveOfferEdit(offer, input)
    setSaving(false)
    if (!r.ok) { setErr(r.reason ?? 'No se pudo guardar.'); return }
    onSaved()
  }

  const toggleWeekday = (n: number) =>
    setWeekdays((w) => (w.includes(n) ? w.filter((x) => x !== n) : [...w, n]))
  const togglePick = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const filteredDishes = (data?.dishes ?? []).filter((d) =>
    dishSearch.trim() === '' ? true : d.name.toLowerCase().includes(dishSearch.trim().toLowerCase()),
  )
  const inputCls = 'w-full px-2.5 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent'
  const labelCls = 'block text-[11px] font-medium text-text-secondary mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-auto rounded-xl bg-card border border-border-default p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-base font-medium text-text-primary">Editar oferta</div>
            <div className="text-xs text-text-secondary">{CHANNEL_LABEL[offer.channel]} · {offer.brandNames[0] ?? offer.name}{offer.locationNames[0] ? ` · ${offer.locationNames[0]}` : ''}</div>
          </div>
          <button type="button" onClick={onClose} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-10 justify-center text-text-secondary"><Loader2 size={16} className="animate-spin" /> Cargando…</div>
        ) : (
          <div className="space-y-4">
            {/* Descuento */}
            <div>
              <label className={labelCls}>Descuento</label>
              <div className="flex gap-2">
                <select className={`${inputCls} w-20`} value={discountType} onChange={(e) => setDiscountType(e.target.value as DiscountType)}>
                  <option value="percent">%</option>
                  <option value="fixed">€</option>
                </select>
                <input className={inputCls} inputMode="decimal" value={value} placeholder="10" onChange={(e) => setValue(e.target.value)} />
              </div>
            </div>

            {/* Vigencia */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Desde (opcional)</label>
                <input type="date" className={inputCls} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Hasta (obligatoria)</label>
                <input type="date" className={`${inputCls} ${!endsAt ? 'border-warning/60' : ''}`} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
              </div>
            </div>

            {/* Días + franja */}
            <div>
              <label className={labelCls}>Días (vacío = todos)</label>
              <div className="flex gap-1">
                {WEEKDAY_TOGGLES.map((d) => (
                  <button key={d.n} type="button" onClick={() => toggleWeekday(d.n)}
                    className={`w-8 h-8 rounded-md text-xs border ${weekdays.includes(d.n) ? 'bg-accent text-white border-accent' : 'bg-card text-text-secondary border-border-default hover:bg-page/60'}`}>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Franja desde (opcional)</label>
                <input type="time" className={inputCls} value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Franja hasta (opcional)</label>
                <input type="time" className={inputCls} value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
              </div>
            </div>

            {/* Presupuesto */}
            <div>
              <label className={labelCls}>Presupuesto máx € (opcional — se apaga sola al agotarse)</label>
              <input className={inputCls} inputMode="decimal" value={budgetMax} placeholder="sin tope" onChange={(e) => setBudgetMax(e.target.value)} />
            </div>

            {/* Alcance de platos */}
            <div>
              <label className={labelCls}>A qué platos se aplica</label>
              <div className="flex gap-2 mb-2">
                <button type="button" onClick={() => setScopeMode('all')}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-xs ${scopeMode === 'all' ? 'bg-accent/10 text-accent border-accent/40' : 'bg-card text-text-secondary border-border-default'}`}>
                  Toda la carta
                </button>
                <button type="button" onClick={() => setScopeMode('pick')}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-xs ${scopeMode === 'pick' ? 'bg-accent/10 text-accent border-accent/40' : 'bg-card text-text-secondary border-border-default'}`}>
                  Elegir platos {picked.length > 0 ? `(${picked.length})` : ''}
                </button>
              </div>

              {scopeMode === 'pick' && (
                <div className="rounded-md border border-border-default">
                  <div className="flex items-center gap-2 p-2 border-b border-border-default">
                    <Search size={13} className="text-text-secondary" />
                    <input className="flex-1 bg-transparent text-sm outline-none text-text-primary" placeholder="Buscar plato…" value={dishSearch} onChange={(e) => setDishSearch(e.target.value)} />
                    <button type="button" className="text-xs text-accent" onClick={() => setPicked(filteredDishes.map((d) => d.id))}>Todos</button>
                    <button type="button" className="text-xs text-text-secondary" onClick={() => setPicked([])}>Ninguno</button>
                  </div>
                  <div className="max-h-48 overflow-auto p-1">
                    {filteredDishes.length === 0 ? (
                      <div className="text-xs text-text-secondary/60 py-4 text-center">Sin platos.</div>
                    ) : filteredDishes.map((d) => (
                      <label key={d.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-page/60 cursor-pointer text-sm text-text-primary">
                        <input type="checkbox" checked={picked.includes(d.id)} onChange={() => togglePick(d.id)} />
                        <span className="truncate">{d.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Margen en vivo (plataforma) */}
            {offer.channel !== 'shop' && (
              <div className="rounded-md bg-page/70 border border-border-default px-2.5 py-2 text-xs">
                {margin === 'loading' ? (
                  <span className="flex items-center gap-1.5 text-text-secondary/70"><Loader2 size={12} className="animate-spin" /> Calculando margen…</span>
                ) : margin ? (
                  <span className="text-text-primary">
                    Margen medio: <b>{margin.marginPctBefore != null ? `${margin.marginPctBefore}%` : '—'}</b> → <b className={margin.marginPctAfter != null && margin.marginPctAfter < 45 ? 'text-warning' : 'text-success'}>{margin.marginPctAfter != null ? `${margin.marginPctAfter}%` : '—'}</b>
                    {(margin.itemsBelowFloor > 0 || margin.itemsNoCost > 0) && (
                      <span className="text-text-secondary/70"> · {margin.itemsBelowFloor > 0 ? `${margin.itemsBelowFloor} bajo suelo` : ''}{margin.itemsBelowFloor > 0 && margin.itemsNoCost > 0 ? ' · ' : ''}{margin.itemsNoCost > 0 ? `${margin.itemsNoCost} sin escandallo` : ''}</span>
                    )}
                  </span>
                ) : (
                  <span className="text-text-secondary/60">Margen no disponible.</span>
                )}
              </div>
            )}

            {err && <div className="rounded-md border border-danger/30 bg-danger-bg px-2.5 py-1.5 text-sm text-danger">{err}</div>}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="rounded-lg border border-border-default bg-card px-3 py-1.5 text-sm text-text-secondary hover:bg-page/60">Cancelar</button>
              <button type="button" disabled={saving} onClick={() => void handleSave()} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent/90 disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Guardar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
