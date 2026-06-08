// src/modules/kitchen/pages/SalesExceptionsPage.tsx
//
// Pantalla de excepciones del casado de ventas (Entrega B: con acciones).
// Se entra desde KitchenMenuPage (patrón lista+detalle por estado). Muestra:
//   - la señal de fiabilidad (verde/ámbar/rojo) + los importes,
//   - dos cajas de dinero ciego (desconocido vs calculable),
//   - las líneas sin casar agrupadas por razón, con tickets y sugerencia de IA,
//   - acciones: Vincular a plato (no_menu_item → crea menu_item + recasa),
//     Ignorar, Descatalogar (escriben estado deliberado).
//
// Las acciones llaman a resolveUnmapped (RPC resolve_unmapped_sales). 'link' solo
// aplica a no_menu_item; en no_recipe (a menudo combos) la RPC rechaza con mensaje
// claro y aquí solo se ofrece ignorar/descatalogar. Al resolver, se recarga todo.

import { useEffect, useState } from 'react'
import {
  ArrowLeft, ChevronDown, ChevronRight, Sparkles, ReceiptText,
  HelpCircle, Calculator, EyeOff, Archive, Loader2,
} from 'lucide-react'
import {
  getReliability,
  listBlindLines,
  suggestMatch,
  resolveUnmapped,
  type SalesReliability,
  type BlindGroup,
  type BlindProduct,
  type BlindReason,
  type MatchSuggestion,
  type ResolveAction,
} from '@/modules/kitchen/services/salesReliabilityService'

function formatEur(value: number | null): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}

const REASON_LABEL: Record<BlindReason, string> = {
  no_recipe: 'Sin escandallo',
  no_menu_item: 'Sin plato en carta',
  no_brand: 'Marca sin reconocer',
  ambiguous: 'Varios candidatos',
  otros: 'Otros',
}

const REASON_DOT: Record<BlindReason, string> = {
  no_recipe: 'bg-red-500',
  no_menu_item: 'bg-amber-500',
  no_brand: 'bg-red-500',
  ambiguous: 'bg-amber-500',
  otros: 'bg-gray-400',
}

interface Props {
  accountId: string
  onBack: () => void
}

export default function SalesExceptionsPage({ accountId, onBack }: Props) {
  const [signal, setSignal] = useState<SalesReliability | null>(null)
  const [groups, setGroups] = useState<BlindGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function reload() {
    setLoading(true)
    setError(null)
    Promise.all([getReliability(accountId), listBlindLines(accountId)])
      .then(([sig, grp]) => { setSignal(sig); setGroups(grp) })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([getReliability(accountId), listBlindLines(accountId)])
      .then(([sig, grp]) => { if (!cancelled) { setSignal(sig); setGroups(grp) } })
      .catch((e) => { if (!cancelled) setError(String(e.message ?? e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId])

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Volver al menú
      </button>

      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Casado de ventas — excepciones</h1>
      <p className="text-sm text-gray-500 mb-5">
        Todas las marcas de la cuenta. Ventas que no se han podido vincular a un plato;
        resolverlas mejora el food cost y el inventario.
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Cargando excepciones…</div>
      ) : signal ? (
        <>
          <SignalCard signal={signal} />

          {groups.length === 0 ? (
            <div className="mt-6 p-4 rounded-xl bg-green-50 text-green-800 text-sm">
              No hay ventas sin casar en el periodo. Todo el dinero vendido tiene su plato.
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              {groups.map((g) => (
                <ReasonGroup key={g.reason} group={g} accountId={accountId} onResolved={reload} />
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}

function SignalCard({ signal }: { signal: SalesReliability }) {
  const dot =
    signal.status === 'verde' ? 'bg-green-500'
    : signal.status === 'ambar' ? 'bg-amber-500'
    : 'bg-red-500'
  const valueColor =
    signal.status === 'verde' ? 'text-green-700'
    : signal.status === 'ambar' ? 'text-amber-700'
    : 'text-red-700'
  const cardBg =
    signal.status === 'verde' ? 'bg-green-50 border-green-200'
    : signal.status === 'ambar' ? 'bg-amber-50 border-amber-200'
    : 'bg-red-50 border-red-200'

  return (
    <>
      <div className={`rounded-xl border p-4 ${cardBg}`}>
        <div className="flex items-center gap-2.5 mb-3">
          <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
          <span className={`text-2xl font-semibold ${valueColor}`}>
            {signal.reliabilityPct === null ? '—' : `${signal.reliabilityPct.toFixed(2)} %`} fiable
          </span>
          <span className="text-xs text-gray-500">
            umbral {Math.round(signal.thresholdPct)} % · {signal.status}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <MiniStat label="vendido total" value={formatEur(signal.revenueTotal)} />
          <MiniStat label="casado" value={formatEur(signal.revenueCasado)} valueClass="text-green-700" />
          <MiniStat label="ciego" value={formatEur(signal.revenueSinCasar)} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <div className="rounded-lg bg-red-50 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <HelpCircle className="w-4 h-4 text-red-600" />
            <span className="text-xs text-red-700">coste desconocido</span>
          </div>
          <p className="text-base font-semibold text-red-700">
            {formatEur(signal.ciegoDesconocidoEur)} · {signal.ciegoDesconocidoLineas} líneas
          </p>
          <p className="text-xs text-gray-500 mt-0.5">vendido sin escandallo, no estimable</p>
        </div>
        <div className="rounded-lg bg-amber-50 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Calculator className="w-4 h-4 text-amber-600" />
            <span className="text-xs text-amber-700">coste calculable</span>
          </div>
          <p className="text-base font-semibold text-amber-700">
            {formatEur(signal.ciegoCalculableEur)} · {signal.ciegoCalculableLineas} líneas
          </p>
          <p className="text-xs text-gray-500 mt-0.5">tiene receta, falta plato en carta</p>
        </div>
      </div>
    </>
  )
}

function MiniStat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-white rounded-lg p-2.5">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className={`text-base font-semibold ${valueClass ?? 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

function ReasonGroup({ group, accountId, onResolved }: { group: BlindGroup; accountId: string; onResolved: () => void }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full ${REASON_DOT[group.reason]}`} />
        <span className="text-sm font-medium text-gray-900">
          {REASON_LABEL[group.reason]} · {group.productCount}
        </span>
        <span className="text-xs text-gray-500">{formatEur(group.totalEur)}</span>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {group.products.map((p, idx) => (
          <BlindRow
            key={`${group.reason}-${p.productName}`}
            product={p}
            accountId={accountId}
            isLast={idx === group.products.length - 1}
            onResolved={onResolved}
          />
        ))}
      </div>
    </div>
  )
}

function BlindRow({
  product, accountId, isLast, onResolved,
}: {
  product: BlindProduct; accountId: string; isLast: boolean; onResolved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<MatchSuggestion[] | null>(null)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [busy, setBusy] = useState<ResolveAction | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const canSuggest = product.reason === 'no_menu_item' || product.reason === 'no_recipe'
  // 'link' (crear plato en carta) retirado de la UI: el modelo de producto aun no
  // resuelve la propagacion multi-marca ni los articulos de reventa/bebida. Frente propio.

  function loadSuggestions() {
    if (!canSuggest || suggestions !== null || suggestLoading) return
    setSuggestLoading(true)
    suggestMatch(accountId, product.productName)
      .then(setSuggestions)
      .catch(() => setSuggestions([]))
      .finally(() => setSuggestLoading(false))
  }

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) loadSuggestions()
  }

  function doResolve(action: ResolveAction) {
    if (busy) return
    setBusy(action)
    setRowError(null)
    resolveUnmapped(accountId, product.productName, action)
      .then(() => { onResolved() })   // recarga señal + lista; esta fila desaparece
      .catch((e) => { setRowError(String(e.message ?? e)); setBusy(null) })
  }

  const top = suggestions && suggestions.length > 0 ? suggestions[0] : null

  return (
    <div className={isLast ? '' : 'border-b border-gray-100'}>
      <button onClick={toggle} className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50">
        {open ? <ChevronDown className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 text-sm">{product.productName}</div>
          <div className="text-xs text-gray-500 mt-0.5 inline-flex items-center gap-1">
            <ReceiptText className="w-3 h-3" />
            {product.salesCount} venta{product.salesCount !== 1 ? 's' : ''}
          </div>
        </div>
        <div className="text-sm font-medium text-gray-900 shrink-0">{formatEur(product.totalEur)}</div>
      </button>

      {open && (
        <div className="px-4 pb-3 pl-11 space-y-3">
          {/* Sugerencia de IA */}
          {canSuggest && (
            <div>
              {suggestLoading ? (
                <p className="text-xs text-gray-400">Buscando un escandallo parecido…</p>
              ) : top ? (
                <div className="inline-flex items-center gap-2 bg-blue-50 rounded-lg px-3 py-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                  <span className="text-xs text-blue-700">
                    Parecido a “{top.name}” · confianza {Math.round(top.confidence * 100)} %
                  </span>
                </div>
              ) : suggestions !== null ? (
                <p className="text-xs text-gray-400">Sin escandallo parecido. Habrá que crearlo.</p>
              ) : null}
            </div>
          )}

          {/* Tickets donde se vendió */}
          <div>
            <p className="text-xs text-gray-400 mb-1">Vendido en:</p>
            <div className="space-y-0.5">
              {product.tickets.slice(0, 6).map((t, i) => (
                <div key={`${t.saleId}-${i}`} className="flex items-center justify-between text-xs text-gray-600">
                  <span>{formatDate(t.soldAt)} · {t.quantity} ud</span>
                  <span>{formatEur(t.lineTotal)}</span>
                </div>
              ))}
              {product.tickets.length > 6 && (
                <p className="text-xs text-gray-400">+ {product.tickets.length - 6} ventas más…</p>
              )}
            </div>
          </div>

          {rowError && (
            <div className="p-2 rounded-lg bg-red-50 text-red-700 text-xs">{rowError}</div>
          )}

          {/* Acciones */}
          <div className="flex flex-wrap gap-2 pt-1">
            <ActionButton
              icon={busy === 'ignore' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <EyeOff className="w-3.5 h-3.5" />}
              label="Ignorar"
              onClick={() => doResolve('ignore')}
              disabled={busy !== null}
              subtle
            />
            <ActionButton
              icon={busy === 'delist' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
              label="Descatalogar"
              onClick={() => doResolve('delist')}
              disabled={busy !== null}
              subtle
            />
          </div>
          <p className="text-xs text-gray-400">
            La vinculación automática a la carta está en rediseño (un mismo producto se vende en
            varias marcas, y las bebidas/reventa no llevan escandallo). Por ahora puedes ignorar o
            descatalogar lo que no quieras costear.
          </p>
        </div>
      )}
    </div>
  )
}

function ActionButton({
  icon, label, onClick, disabled, primary, subtle,
}: {
  icon: React.ReactNode; label: string; onClick?: () => void; disabled?: boolean; primary?: boolean; subtle?: boolean
}) {
  const base = 'inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors'
  const tone = primary
    ? 'border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100'
    : subtle
      ? 'border-gray-200 text-gray-500 hover:bg-gray-50'
      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
  const dis = disabled ? 'opacity-50 cursor-not-allowed' : ''
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${tone} ${dis}`}>
      {icon} {label}
    </button>
  )
}
