// src/modules/kitchen/pages/SalesExceptionsPage.tsx
//
// Pantalla de excepciones del casado de ventas (Entrega B + capa 1 del modelo de
// producto). Se entra desde KitchenMenuPage. Muestra:
//   - la señal de fiabilidad (verde/ámbar/rojo) + los importes,
//   - dos cajas de dinero ciego (desconocido vs calculable),
//   - las líneas sin casar agrupadas por razón, con tickets y sugerencia de IA,
//   - acciones por razón:
//       no_menu_item (tiene recipe_item, dish con cascarón): Es reventa / Es un plato
//       no_recipe (sin recipe_item): Es un plato / Es un combo
//       todas: Ignorar / Descatalogar
//
// REVENTA sin coste = vía principal: convierte a raw vendible, propaga a todas las
// marcas, recasa, y queda PENDIENTE DE COSTE (la factura/OCR lo rellena). El coste a
// mano es la excepción (corromper el food cost con un número a ojo es peor que NULL).

import { useEffect, useState } from 'react'
import {
  ArrowLeft, ChevronDown, ChevronRight, Sparkles, ReceiptText,
  HelpCircle, Calculator, EyeOff, Archive, Loader2, GlassWater, ChefHat, Package,
} from 'lucide-react'
import {
  getReliability,
  listBlindLines,
  suggestMatch,
  resolveUnmapped,
  classifyUnmappedProduct,
  listCostlessSoldProducts,
  type SalesReliability,
  type BlindGroup,
  type BlindProduct,
  type BlindReason,
  type MatchSuggestion,
  type ResolveAction,
  type ClassifyAction,
  type CostlessProduct,
} from '@/modules/kitchen/services/salesReliabilityService'

type BusyTag = ResolveAction | 'classify-resale' | 'classify-dish' | 'classify-combo'

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

// Heurística de SUGERENCIA (no decide): ¿este nombre parece bebida/reventa?
const RESALE_HINT = /(agua|coca|cola|fanta|sprite|mahou|cerveza|beer|refresco|nestea|aquarius|red bull|monster|zumo|vino|tinto|sidra|tonica|seven up|7up|pepsi|aquabona|bezoya|font vella|san pellegrino|perrier|schweppes)/i
function looksLikeResale(name: string): boolean {
  return RESALE_HINT.test(name)
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
  const [costless, setCostless] = useState<CostlessProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function reload() {
    setLoading(true)
    setError(null)
    Promise.all([getReliability(accountId), listBlindLines(accountId), listCostlessSoldProducts(accountId)])
      .then(([sig, grp, cl]) => { setSignal(sig); setGroups(grp); setCostless(cl) })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([getReliability(accountId), listBlindLines(accountId), listCostlessSoldProducts(accountId)])
      .then(([sig, grp, cl]) => { if (!cancelled) { setSignal(sig); setGroups(grp); setCostless(cl) } })
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

          {/* Casado pero SIN COSTE: productos vendidos cuyo food cost es desconocido.
              Ya casaron (no son ciegos), pero su recipe_item no tiene coste. */}
          {costless.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-orange-500" />
                <span className="text-sm font-medium text-gray-900">
                  Casado pero sin coste · {costless.length}
                </span>
                <span className="text-xs text-gray-500">
                  {formatEur(costless.reduce((s, p) => s + p.importe, 0))} de food cost desconocido
                </span>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {costless.map((p, idx) => (
                  <CostlessRow
                    key={p.recipeItemId}
                    product={p}
                    accountId={accountId}
                    isLast={idx === costless.length - 1}
                    onResolved={reload}
                  />
                ))}
              </div>
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

      {/* Casado pero SIN COSTE: dinero vendido cuyo food cost es desconocido.
          Distinto del dinero ciego (este SÍ casó), pero igual de peligroso: infla la
          fiabilidad sin que el margen sea real. */}
      {signal.casadoSinCosteEur > 0 && (
        <div className="rounded-lg bg-orange-50 border border-orange-200 p-3 mt-3">
          <div className="flex items-center gap-1.5 mb-1">
            <HelpCircle className="w-4 h-4 text-orange-600" />
            <span className="text-xs font-medium text-orange-700">casado pero sin coste</span>
          </div>
          <p className="text-base font-semibold text-orange-700">
            {formatEur(signal.casadoSinCosteEur)} · {signal.casadoSinCosteLineas} líneas
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            vendido y casado, pero el artículo no tiene coste → su food cost es desconocido.
            {signal.costCoveragePct !== null && (
              <> Solo el <strong>{signal.costCoveragePct.toFixed(0)}%</strong> del dinero casado tiene coste conocido.</>
            )}
            {' '}Se rellena con las facturas de compra, o a mano en la ficha del artículo.
          </p>
        </div>
      )}
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
  const [busy, setBusy] = useState<BusyTag | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [showCostInput, setShowCostInput] = useState(false)
  const [costInput, setCostInput] = useState('')
  const [classifyMsg, setClassifyMsg] = useState<string | null>(null)

  const canSuggest = product.reason === 'no_menu_item' || product.reason === 'no_recipe'

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
      .then(() => { onResolved() })
      .catch((e) => { setRowError(String(e.message ?? e)); setBusy(null) })
  }

  function doClassify(action: ClassifyAction, unitCost: number | null, tag: BusyTag) {
    if (busy) return
    setBusy(tag)
    setRowError(null)
    classifyUnmappedProduct(accountId, product.productName, action, unitCost)
      .then((res) => {
        if (res.resultado === 'resale_linked') {
          if (unitCost == null) {
            setClassifyMsg('Convertido a reventa y casado. Queda PENDIENTE DE COSTE: se rellenará con la próxima factura, o ponlo a mano en la ficha del artículo.')
            setTimeout(onResolved, 1800)
          } else {
            onResolved()
          }
        } else if (res.resultado === 'is_dish') {
          setClassifyMsg('Marcado como plato. Crea su escandallo en Recetas; al recasar, casará solo.')
          setBusy(null)
        } else {
          setClassifyMsg('Marcado como combo (pendiente del módulo de combos).')
          setBusy(null)
        }
      })
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
          {/* Sugerencia de escandallo parecido (IA) */}
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

          {/* Sugerencia de tipo (no decide) — pista visible */}
          {canSuggest && (
            <div className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 ${
              looksLikeResale(product.productName) ? 'bg-blue-50' : 'bg-gray-50'
            }`}>
              {looksLikeResale(product.productName)
                ? <GlassWater className="w-3.5 h-3.5 text-blue-600" />
                : <ChefHat className="w-3.5 h-3.5 text-gray-500" />}
              <span className={`text-xs ${looksLikeResale(product.productName) ? 'text-blue-700' : 'text-gray-600'}`}>
                {looksLikeResale(product.productName) ? '¿Es una bebida o artículo de reventa?' : '¿Es un plato?'}
              </span>
            </div>
          )}

          {/* Clasificación */}
          <div className="flex flex-wrap gap-2">
            {product.reason === 'no_menu_item' && (
              <>
                <ActionButton
                  icon={busy === 'classify-resale' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GlassWater className="w-3.5 h-3.5" />}
                  label="Es reventa (bebida, etc.)"
                  onClick={() => doClassify('resale', null, 'classify-resale')}
                  disabled={busy !== null}
                  primary
                />
                <ActionButton
                  icon={busy === 'classify-dish' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChefHat className="w-3.5 h-3.5" />}
                  label="Es un plato (crear escandallo)"
                  onClick={() => doClassify('dish', null, 'classify-dish')}
                  disabled={busy !== null}
                />
              </>
            )}
            {product.reason === 'no_recipe' && (
              <>
                <ActionButton
                  icon={busy === 'classify-dish' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChefHat className="w-3.5 h-3.5" />}
                  label="Es un plato (crear escandallo)"
                  onClick={() => doClassify('dish', null, 'classify-dish')}
                  disabled={busy !== null}
                />
                <ActionButton
                  icon={<Package className="w-3.5 h-3.5" />}
                  label="Es un combo"
                  onClick={() => doClassify('combo', null, 'classify-combo')}
                  disabled={busy !== null}
                  subtle
                />
              </>
            )}
          </div>

          {/* Reventa: el coste NO se teclea a ojo (corrompe el food cost). La vía
              principal es sin coste; la factura/albarán lo rellena vía OCR. El campo
              manual es la excepción para cuando se conoce el coste exacto. */}
          {product.reason === 'no_menu_item' && (
            showCostInput ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-600">Coste de compra exacto (€/ud):</span>
                <input
                  type="number" step="0.01" min="0"
                  value={costInput}
                  onChange={(e) => setCostInput(e.target.value)}
                  className="w-28 border border-gray-300 rounded-lg px-2 py-1 text-xs"
                />
                <ActionButton
                  icon={busy === 'classify-resale' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GlassWater className="w-3.5 h-3.5" />}
                  label="Reventa con este coste"
                  onClick={() => doClassify('resale', costInput.trim() === '' ? null : Number(costInput), 'classify-resale')}
                  disabled={busy !== null || costInput.trim() === ''}
                  primary
                />
                <button
                  onClick={() => { setShowCostInput(false); setCostInput('') }}
                  disabled={busy !== null}
                  className="text-xs text-gray-500 hover:text-gray-800"
                >cancelar</button>
              </div>
            ) : (
              <button
                onClick={() => setShowCostInput(true)}
                disabled={busy !== null}
                className="text-xs text-gray-400 hover:text-gray-700 underline"
              >ya sé el coste exacto de compra</button>
            )
          )}

          {/* Acciones comunes */}
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

          {classifyMsg && (
            <p className="text-xs text-green-700">{classifyMsg}</p>
          )}
        </div>
      )}
    </div>
  )
}

function CostlessRow({
  product, accountId, isLast, onResolved,
}: {
  product: CostlessProduct; accountId: string; isLast: boolean; onResolved: () => void
}) {
  const [busy, setBusy] = useState<'resale' | 'dish' | 'combo' | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  function doClassify(action: ClassifyAction) {
    if (busy) return
    setBusy(action)
    setRowError(null)
    classifyUnmappedProduct(accountId, product.productName, action, null)
      .then((res) => {
        if (res.resultado === 'resale_linked') {
          setMsg('Convertido a reventa. Queda pendiente de coste: lo rellenará la factura, o ponlo a mano en la ficha.')
          setTimeout(onResolved, 1800)
        } else if (res.resultado === 'is_dish') {
          setMsg('Marcado como plato. Crea su escandallo en Recetas; al recompute, dejará de estar sin coste.')
          setBusy(null)
        } else {
          setMsg('Marcado como combo (pendiente del módulo de combos y modificadores).')
          setBusy(null)
        }
      })
      .catch((e) => { setRowError(String(e.message ?? e)); setBusy(null) })
  }

  return (
    <div className={`px-4 py-3 ${isLast ? '' : 'border-b border-gray-100'}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 text-sm">{product.productName}</div>
          <div className="text-xs text-gray-500 mt-0.5 inline-flex items-center gap-1">
            <ReceiptText className="w-3 h-3" />
            {product.ventas} venta{product.ventas !== 1 ? 's' : ''}
            {' · '}
            {product.hasRecipeLines ? 'escandallo a medias' : 'sin escandallo'}
          </div>
        </div>
        <div className="text-sm font-medium text-gray-900 shrink-0">{formatEur(product.importe)}</div>
      </div>

      {/* Pista de tipo (no decide) */}
      <div className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 mt-2 ${
        looksLikeResale(product.productName) ? 'bg-blue-50' : 'bg-gray-50'
      }`}>
        {looksLikeResale(product.productName)
          ? <GlassWater className="w-3.5 h-3.5 text-blue-600" />
          : <ChefHat className="w-3.5 h-3.5 text-gray-500" />}
        <span className={`text-xs ${looksLikeResale(product.productName) ? 'text-blue-700' : 'text-gray-600'}`}>
          {looksLikeResale(product.productName) ? '¿Es una bebida o artículo de reventa?' : '¿Es un plato? Crea su escandallo'}
        </span>
      </div>

      {rowError && (
        <div className="p-2 rounded-lg bg-red-50 text-red-700 text-xs mt-2">{rowError}</div>
      )}

      <div className="flex flex-wrap gap-2 mt-2">
        <ActionButton
          icon={busy === 'dish' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChefHat className="w-3.5 h-3.5" />}
          label={product.hasRecipeLines ? 'Completar escandallo' : 'Es un plato (crear escandallo)'}
          onClick={() => doClassify('dish')}
          disabled={busy !== null}
        />
        <ActionButton
          icon={busy === 'resale' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GlassWater className="w-3.5 h-3.5" />}
          label="Es reventa"
          onClick={() => doClassify('resale')}
          disabled={busy !== null}
        />
        <ActionButton
          icon={<Package className="w-3.5 h-3.5" />}
          label="Es un combo"
          onClick={() => doClassify('combo')}
          disabled={busy !== null}
          subtle
        />
      </div>

      {msg && <p className="text-xs text-green-700 mt-2">{msg}</p>}
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
