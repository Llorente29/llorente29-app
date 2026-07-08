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
  ChevronDown, ChevronRight, Sparkles, Filter,
} from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  listAgentOffers, getLastRunAt, groupByChannel, previewOfferMargin,
  OFFER_CHANNELS, CHANNEL_LABEL,
  type AgentOffer, type OfferChannel, type OfferStatus, type PublishMode, type OfferMargin,
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
  const proposalCount = useMemo(() => offers.filter((o) => o.status === 'propuesta').length, [offers])

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
        </div>
      </div>

      {/* Nota T3 (honesta, sin botón muerto) */}
      <div className="mb-4 rounded-lg border border-border-default bg-page/60 px-3 py-2 text-xs text-text-secondary">
        Aquí ves las propuestas del agente en los 4 canales. Publicar en lote (Shop se
        publica solo · Glovo por robot · Uber/JustEat a mano) llega en el siguiente tramo.
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>
      )}

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

function ChannelColumn({ channel, offers, expanded, onToggleExpand, accountId }: {
  channel: OfferChannel
  offers: AgentOffer[]
  expanded: boolean
  onToggleExpand: () => void
  accountId: string
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
      <div className={`flex items-center gap-1 px-1 mb-2.5 text-xs ${pub.cls}`}>
        <PubIcon size={12} /> {pub.label}
      </div>

      {offers.length === 0 ? (
        <div className="text-xs text-text-secondary/60 px-1 py-6 text-center">Sin ofertas.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((o) => <OfferCard key={o.id} offer={o} accountId={accountId} />)}
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

function OfferCard({ offer, accountId }: { offer: AgentOffer; accountId: string }) {
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
        </div>
      )}
    </div>
  )
}
