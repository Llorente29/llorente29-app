// src/modules/kitchen/pages/SalesExceptionsPage.tsx
//
// Casado de ventas POR MARCA × LOCAL (Trabajo B) + vista general (Entrega B previa).
//
// Ejes:
//   - LOCAL: del selector GLOBAL (useLocationScope().resolvedLocationId). null =
//     consolidado = todos los locales.
//   - MARCA: selector PROPIO de esta pantalla. "Todas" → vista general histórica
//     (por razón, todas las marcas). Una marca → su HISTORIA COMPLETA:
//       1. tarjeta resumen (% casado, pendiente, % con coste, ignorado)
//       2. Pendiente de casar (por producto, acotado a la marca)
//       3. Casado (verde con coste / ámbar sin coste)
//       4. Ignorado (motivo + fecha + deshacer)
//
// El casado por marca es ACOTADO: las acciones operan sobre la marca elegida, así
// que es imposible atribuir una venta a otra marca por error. "Ignorar" exige un
// MOTIVO (gol sobre tspoon, que no muestra el porqué).
//
// Anti-invención: sin certeza, queda pendiente. No casa ni inventa marcas solo.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ChevronDown, ChevronRight, Sparkles, ReceiptText,
  HelpCircle, Calculator, EyeOff, Archive, Loader2, GlassWater, ChefHat, Package,
  MapPin, RotateCcw, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useApp } from '@/context/AppContext'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import {
  getReliability,
  listBlindLines,
  suggestMatch,
  resolveUnmapped,
  classifyUnmappedProduct,
  createDishFromUnmapped,
  listCostlessSoldProducts,
  type ClassifyCandidate,
  type SalesReliability,
  type BlindGroup,
  type BlindProduct,
  type BlindReason,
  type MatchSuggestion,
  type ResolveAction,
  type ClassifyAction,
  type CostlessProduct,
} from '@/modules/kitchen/services/salesReliabilityService'
import {
  listBrandsWithSales,
  getBrandReliability,
  listBrandLines,
  ignoreBrandProduct,
  unignoreBrandProduct,
  type BrandWithSales,
  type BrandReliability,
  type BrandProduct,
} from '@/modules/kitchen/services/salesByBrandService'

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

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Heurística de SUGERENCIA (no decide): ¿este nombre parece bebida/reventa?
const RESALE_HINT = /(agua|coca|cola|fanta|sprite|mahou|cerveza|beer|refresco|nestea|aquarius|red bull|monster|zumo|vino|tinto|sidra|tonica|seven up|7up|pepsi|aquabona|bezoya|font vella|san pellegrino|perrier|schweppes)/i
function looksLikeResale(name: string): boolean {
  return RESALE_HINT.test(name)
}

function ownershipLabel(t: string): string {
  if (t === 'ceded' || t === 'cedida') return 'cedida'
  if (t === 'own' || t === 'propia') return 'propia'
  return t
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

// Razón legible para una línea pendiente de una marca (unmapped_reason crudo).
function reasonLabel(raw: string | null): string {
  switch (raw) {
    case 'no_recipe': return 'sin escandallo'
    case 'no_menu_item': return 'sin plato en carta'
    case 'no_brand': return 'marca sin reconocer'
    case 'ambiguous': return 'varios candidatos'
    default: return 'sin id de producto en el ticket'
  }
}

interface Props {
  accountId: string
  onBack: () => void
}

// ═══════════════════════════════════════════════════════════════════════
// Shell: selector de marca + local global. "Todas" → vista general.
// ═══════════════════════════════════════════════════════════════════════

export default function SalesExceptionsPage({ accountId, onBack }: Props) {
  const { resolvedLocationId } = useLocationScope()
  const { locations } = useApp()

  const [brands, setBrands] = useState<BrandWithSales[]>([])
  const [brandsLoading, setBrandsLoading] = useState(true)
  const [brandFilter, setBrandFilter] = useState<string>('all')
  const [brandsTick, setBrandsTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setBrandsLoading(true)
    listBrandsWithSales(accountId, resolvedLocationId)
      .then(b => { if (!cancelled) setBrands(b) })
      .catch(() => { if (!cancelled) setBrands([]) })
      .finally(() => { if (!cancelled) setBrandsLoading(false) })
    return () => { cancelled = true }
  }, [accountId, resolvedLocationId, brandsTick])

  const locationName = resolvedLocationId
    ? (locations.find(l => l.id === resolvedLocationId)?.name ?? 'Local')
    : 'Todos los locales (consolidado)'

  const selectedBrand = brands.find(b => b.brandId === brandFilter) ?? null

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Volver al menú
      </button>

      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Casado de ventas por marca</h1>
      <p className="text-sm text-gray-500 mb-4">
        Ventas que no se han podido vincular a un plato, por marca y local. Resolverlas
        mejora el food cost y el inventario.
      </p>

      {/* Controles: marca (propio) + local (del selector global) */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <select
          value={brandFilter}
          onChange={(e) => setBrandFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200"
        >
          <option value="all">Todas las marcas</option>
          {brands.map(b => (
            <option key={b.brandId} value={b.brandId}>
              {b.brandName} · {ownershipLabel(b.ownershipType)}
              {b.pendientes > 0 ? ` · ${b.pendientes} pend.` : ''}
            </option>
          ))}
        </select>
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
          <MapPin className="w-3.5 h-3.5" /> {locationName}
        </span>
        {brandsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
      </div>

      {brandFilter === 'all' ? (
        <GeneralExceptionsView accountId={accountId} />
      ) : (
        <BrandHistoryView
          key={`${brandFilter}-${resolvedLocationId ?? 'all'}`}
          accountId={accountId}
          brandId={brandFilter}
          brand={selectedBrand}
          locationId={resolvedLocationId}
          activeLocationId={resolvedLocationId}
          locations={locations}
          onChanged={() => setBrandsTick(t => t + 1)}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// Vista por MARCA × LOCAL — historia completa
// ═══════════════════════════════════════════════════════════════════════

interface BrandHistoryProps {
  accountId: string
  brandId: string
  brand: BrandWithSales | null
  locationId: string | null
  activeLocationId: string | null
  locations: { id: string; name: string }[]
  onChanged: () => void
}

function locLabel(
  locationIds: string[],
  locations: { id: string; name: string }[],
  activeLocationId: string | null,
): string {
  if (activeLocationId) return locations.find(l => l.id === activeLocationId)?.name ?? 'este local'
  if (locationIds.length === 0) return '—'
  if (locationIds.length === 1) return locations.find(l => l.id === locationIds[0])?.name ?? 'un local'
  return `${locationIds.length} locales`
}

function BrandHistoryView({
  accountId, brandId, brand, locationId, activeLocationId, locations, onChanged,
}: BrandHistoryProps) {
  const [rel, setRel] = useState<BrandReliability | null>(null)
  const [pending, setPending] = useState<BrandProduct[]>([])
  const [matched, setMatched] = useState<BrandProduct[]>([])
  const [ignored, setIgnored] = useState<BrandProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function reload() {
    setLoading(true)
    setError(null)
    Promise.all([
      getBrandReliability(accountId, brandId, locationId),
      listBrandLines(accountId, brandId, 'pending', locationId),
      listBrandLines(accountId, brandId, 'matched', locationId),
      listBrandLines(accountId, brandId, 'ignored', locationId),
    ])
      .then(([r, p, m, i]) => { setRel(r); setPending(p); setMatched(m); setIgnored(i) })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      getBrandReliability(accountId, brandId, locationId),
      listBrandLines(accountId, brandId, 'pending', locationId),
      listBrandLines(accountId, brandId, 'matched', locationId),
      listBrandLines(accountId, brandId, 'ignored', locationId),
    ])
      .then(([r, p, m, i]) => { if (!cancelled) { setRel(r); setPending(p); setMatched(m); setIgnored(i) } })
      .catch((e) => { if (!cancelled) setError(String(e.message ?? e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, brandId, locationId])

  function afterAction() {
    reload()
    onChanged()
  }

  const brandName = brand?.brandName ?? 'la marca'

  if (loading) return <div className="text-sm text-gray-500">Cargando casado de {brandName}…</div>
  if (error) return <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>

  return (
    <div className="space-y-5">
      {rel && <BrandSummaryCard brand={brand} rel={rel} />}

      <Section
        title="Pendiente de casar"
        count={pending.length}
        dot="bg-red-500"
        amount={rel?.importePendiente ?? null}
        defaultOpen
      >
        {pending.length === 0 ? (
          <EmptyHint text="No queda nada pendiente en esta marca." good />
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {pending.map((p, idx) => (
              <BrandPendingRow
                key={p.productName}
                product={p}
                accountId={accountId}
                brandId={brandId}
                brandName={brandName}
                locationLabel={locLabel(p.locationIds, locations, activeLocationId)}
                isLast={idx === pending.length - 1}
                onResolved={afterAction}
              />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Casado"
        count={matched.length}
        dot="bg-green-500"
        amount={rel?.importeCasado ?? null}
      >
        {matched.length === 0 ? (
          <EmptyHint text="Aún no hay productos casados en esta marca." />
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {matched.map((p, idx) => (
              <BrandMatchedRow key={p.productName} product={p} isLast={idx === matched.length - 1} />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Ignorado"
        count={ignored.length}
        dot="bg-gray-400"
        amount={rel?.importeIgnorado ?? null}
      >
        {ignored.length === 0 ? (
          <EmptyHint text="No hay productos ignorados en esta marca." />
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {ignored.map((p, idx) => (
              <BrandIgnoredRow
                key={p.productName}
                product={p}
                accountId={accountId}
                brandId={brandId}
                isLast={idx === ignored.length - 1}
                onResolved={afterAction}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

function BrandSummaryCard({ brand, rel }: { brand: BrandWithSales | null; rel: BrandReliability }) {
  const pct = rel.casadoPct
  const tone =
    pct === null ? 'bg-gray-50 border-gray-200 text-gray-700'
    : pct >= 90 ? 'bg-green-50 border-green-200 text-green-700'
    : pct >= 70 ? 'bg-amber-50 border-amber-200 text-amber-700'
    : 'bg-red-50 border-red-200 text-red-700'

  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg font-semibold text-gray-900">{brand?.brandName ?? 'Marca'}</span>
        {brand && (
          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-white/70 border border-gray-200 text-gray-600">
            {ownershipLabel(brand.ownershipType)}
          </span>
        )}
        <span className="ml-auto text-2xl font-semibold">
          {pct === null ? '—' : `${pct.toFixed(1)} %`}
          <span className="text-xs font-normal text-gray-500 ml-1">casado</span>
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="pendiente" value={String(rel.lineasPendientes)} valueClass="text-red-700" />
        <MiniStat label="casado" value={String(rel.lineasCasadas)} valueClass="text-green-700" />
        <MiniStat
          label="con coste"
          value={rel.costeCoberturaPct === null ? '—' : `${rel.costeCoberturaPct.toFixed(0)} %`}
        />
        <MiniStat label="ignorado" value={String(rel.lineasIgnoradas)} />
      </div>
      {rel.lineasDescatalogadas > 0 && (
        <p className="text-xs text-gray-500 mt-2">
          + {rel.lineasDescatalogadas} línea{rel.lineasDescatalogadas !== 1 ? 's' : ''} descatalogada{rel.lineasDescatalogadas !== 1 ? 's' : ''}.
        </p>
      )}
    </div>
  )
}

function Section({
  title, count, dot, amount, defaultOpen, children,
}: {
  title: string; count: number; dot: string; amount: number | null; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen))
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 mb-2 text-left"
      >
        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <span className="text-sm font-medium text-gray-900">{title} · {count}</span>
        {amount !== null && <span className="text-xs text-gray-500">{formatEur(amount)}</span>}
      </button>
      {open && children}
    </div>
  )
}

function EmptyHint({ text, good }: { text: string; good?: boolean }) {
  return (
    <div className={`p-3 rounded-lg text-sm ${good ? 'bg-green-50 text-green-800' : 'bg-gray-50 text-gray-500'}`}>
      {text}
    </div>
  )
}

function BrandPendingRow({
  product, accountId, brandId, brandName, locationLabel, isLast, onResolved,
}: {
  product: BrandProduct; accountId: string; brandId: string; brandName: string
  locationLabel: string; isLast: boolean; onResolved: () => void
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<MatchSuggestion[] | null>(null)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [busy, setBusy] = useState<BusyTag | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [classifyMsg, setClassifyMsg] = useState<string | null>(null)
  const [confirmDishOpen, setConfirmDishOpen] = useState(false)
  const [ignoreOpen, setIgnoreOpen] = useState(false)
  // Cuando la RPC no resuelve el ancla, devuelve candidatos para elegir a cuál casar.
  const [targetCandidates, setTargetCandidates] = useState<ClassifyCandidate[] | null>(null)
  const [targetAction, setTargetAction] = useState<ClassifyAction | null>(null)

  function loadSuggestions() {
    if (suggestions !== null || suggestLoading) return
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

  function doClassify(action: ClassifyAction, tag: BusyTag) {
    if (busy) return
    setBusy(tag)
    setRowError(null)
    setTargetCandidates(null)
    classifyUnmappedProduct(accountId, product.productName, action, null)
      .then((res) => {
        if (res.resultado === 'needs_target') {
          // La RPC no pudo resolver el artículo por el nombre → que el usuario elija.
          setTargetCandidates(res.candidatos)
          setTargetAction(action)
          setBusy(null)
        } else if (res.resultado === 'resale_linked') {
          setClassifyMsg('Convertido a reventa y casado. Queda pendiente de coste (lo rellena la factura).')
          setTimeout(onResolved, 1500)
        } else if (res.resultado === 'is_dish') {
          if (res.recipeItemId) navigate('/kitchen/recetas?recipe=' + res.recipeItemId)
          else { setClassifyMsg('Marcado como plato. Crea su escandallo en Recetas.'); setBusy(null) }
        } else if (res.resultado === 'is_combo') {
          setClassifyMsg('Marcado como combo (pendiente del módulo de combos).')
          setBusy(null)
        } else {
          setClassifyMsg('Hecho.')
          setBusy(null)
        }
      })
      .catch((e) => { setRowError(String(e.message ?? e)); setBusy(null) })
  }

  // El usuario eligió a qué artículo casar (desde el desplegable de candidatos):
  // se reintenta anclando al recipe_item elegido (Puerta 1, sin adivinar).
  function doClassifyToTarget(recipeItemId: string) {
    if (busy || !targetAction) return
    setBusy('classify-resale')
    setRowError(null)
    classifyUnmappedProduct(accountId, product.productName, targetAction, null, recipeItemId)
      .then((res) => {
        setTargetCandidates(null)
        if (res.resultado === 'resale_linked') {
          setClassifyMsg('Convertido a reventa y casado. Queda pendiente de coste (lo rellena la factura).')
          setTimeout(onResolved, 1500)
        } else if (res.resultado === 'is_dish') {
          if (res.recipeItemId) navigate('/kitchen/recetas?recipe=' + res.recipeItemId)
          else { setClassifyMsg('Marcado como plato. Crea su escandallo en Recetas.'); setBusy(null) }
        } else {
          setClassifyMsg('Hecho.'); setBusy(null)
        }
      })
      .catch((e) => { setRowError(String(e.message ?? e)); setBusy(null) })
  }

  function confirmCreateDish() {
    setConfirmDishOpen(false)
    setBusy('classify-dish')
    setRowError(null)
    createDishFromUnmapped(accountId, product.productName)
      .then((res) => {
        if (res.recipeItemId) navigate('/kitchen/recetas?recipe=' + res.recipeItemId)
        else { setClassifyMsg('Plato creado. Crea su escandallo en Recetas.'); setBusy(null) }
      })
      .catch((e) => { setRowError(String(e.message ?? e)); setBusy(null) })
  }

  function doIgnore(reason: string) {
    setIgnoreOpen(false)
    setBusy('ignore')
    setRowError(null)
    ignoreBrandProduct(accountId, brandId, product.productName, reason)
      .then(() => onResolved())
      .catch((e) => { setRowError(String(e.message ?? e)); setBusy(null) })
  }

  const top = suggestions && suggestions.length > 0 ? suggestions[0] : null

  return (
    <div className={isLast ? '' : 'border-b border-gray-100'}>
      <button onClick={toggle} className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50">
        {open ? <ChevronDown className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 text-sm">{product.productName}</div>
          <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="inline-flex items-center gap-1">
              <ReceiptText className="w-3 h-3" />
              {product.salesCount} venta{product.salesCount !== 1 ? 's' : ''}
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" /> {brandName} · {locationLabel}
            </span>
            <span className="text-gray-400">· {reasonLabel(product.reason)}</span>
          </div>
        </div>
        <div className="text-sm font-medium text-gray-900 shrink-0">{formatEur(product.totalEur)}</div>
      </button>

      {open && (
        <div className="px-4 pb-3 pl-11 space-y-3">
          {/* Sugerencia de escandallo parecido (IA) — solo platos resueltos por nombre */}
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

          {rowError && <div className="p-2 rounded-lg bg-red-50 text-red-700 text-xs">{rowError}</div>}

          {/* La RPC no resolvió el artículo por el nombre → elige a cuál casar (sin adivinar). */}
          {targetCandidates && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs space-y-2">
              <p className="text-amber-800">
                No encontré el artículo de “{product.productName}” automáticamente. ¿A cuál lo caso?
              </p>
              {targetCandidates.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {targetCandidates.map((c) => (
                    <button
                      key={c.recipeItemId}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => doClassifyToTarget(c.recipeItemId)}
                      className="px-2.5 py-1 rounded-md bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 transition-colors disabled:opacity-50"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-amber-700">
                  No hay artículos de reventa parecidos. Créalo primero, o márcalo desde su ficha.
                </p>
              )}
              <button
                type="button"
                onClick={() => { setTargetCandidates(null); setTargetAction(null) }}
                className="text-amber-700 underline"
              >
                Cancelar
              </button>
            </div>
          )}

          {/* Pista de tipo (no decide) */}
          <div className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 ${looksLikeResale(product.productName) ? 'bg-blue-50' : 'bg-gray-50'}`}>
            {looksLikeResale(product.productName)
              ? <GlassWater className="w-3.5 h-3.5 text-blue-600" />
              : <ChefHat className="w-3.5 h-3.5 text-gray-500" />}
            <span className={`text-xs ${looksLikeResale(product.productName) ? 'text-blue-700' : 'text-gray-600'}`}>
              {looksLikeResale(product.productName) ? '¿Es una bebida o artículo de reventa?' : `¿Es un plato de ${brandName}?`}
            </span>
          </div>

          {/* Casar a plato de la marca (clasificación acotada) */}
          <div className="flex flex-wrap gap-2">
            <ActionButton
              icon={busy === 'classify-dish' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChefHat className="w-3.5 h-3.5" />}
              label={`Casar a plato de ${brandName}`}
              onClick={() => setConfirmDishOpen(true)}
              disabled={busy !== null}
              primary
            />
            <ActionButton
              icon={busy === 'classify-resale' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GlassWater className="w-3.5 h-3.5" />}
              label="Es reventa"
              onClick={() => doClassify('resale', 'classify-resale')}
              disabled={busy !== null}
            />
            <ActionButton
              icon={<Package className="w-3.5 h-3.5" />}
              label="Es un combo"
              onClick={() => doClassify('combo', 'classify-combo')}
              disabled={busy !== null}
              subtle
            />
          </div>

          {/* Ignorar (con motivo obligatorio) */}
          <div className="flex flex-wrap gap-2 pt-1">
            <ActionButton
              icon={busy === 'ignore' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <EyeOff className="w-3.5 h-3.5" />}
              label="Ignorar"
              onClick={() => setIgnoreOpen(true)}
              disabled={busy !== null}
              subtle
            />
          </div>

          {classifyMsg && <p className="text-xs text-green-700">{classifyMsg}</p>}
        </div>
      )}

      <ConfirmDialog
        open={confirmDishOpen}
        title="Crear plato nuevo"
        message={`Se va a crear el plato "${product.productName}" en ${brandName} y se enlazará con sus ventas.\n\nDespués te llevaremos a su ficha para añadir la receta.`}
        confirmLabel="Crear plato"
        busy={busy === 'classify-dish'}
        onConfirm={confirmCreateDish}
        onCancel={() => setConfirmDishOpen(false)}
      />

      <IgnoreReasonModal
        open={ignoreOpen}
        productName={product.productName}
        onCancel={() => setIgnoreOpen(false)}
        onConfirm={doIgnore}
      />
    </div>
  )
}

function BrandMatchedRow({ product, isLast }: { product: BrandProduct; isLast: boolean }) {
  return (
    <div className={`px-4 py-3 flex items-start gap-3 ${isLast ? '' : 'border-b border-gray-100'}`}>
      {product.hasCost
        ? <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
        : <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-gray-900 text-sm">{product.productName}</div>
        <div className="text-xs text-gray-500 mt-0.5 inline-flex items-center gap-1">
          <ReceiptText className="w-3 h-3" />
          {product.salesCount} venta{product.salesCount !== 1 ? 's' : ''}
          {' · '}
          {product.hasCost
            ? <span className="text-green-700">con coste</span>
            : <span className="text-amber-700">sin coste (falta escandallo)</span>}
        </div>
      </div>
      <div className="text-sm font-medium text-gray-900 shrink-0">{formatEur(product.totalEur)}</div>
    </div>
  )
}

function BrandIgnoredRow({
  product, accountId, brandId, isLast, onResolved,
}: {
  product: BrandProduct; accountId: string; brandId: string; isLast: boolean; onResolved: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)

  function doUndo() {
    if (busy) return
    setBusy(true)
    setRowError(null)
    unignoreBrandProduct(accountId, brandId, product.productName)
      .then(() => onResolved())
      .catch((e) => { setRowError(String(e.message ?? e)); setBusy(false) })
  }

  return (
    <div className={`px-4 py-3 ${isLast ? '' : 'border-b border-gray-100'}`}>
      <div className="flex items-start gap-3">
        <EyeOff className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 text-sm">{product.productName}</div>
          <div className="text-xs text-gray-500 mt-0.5 inline-flex items-center gap-1">
            <ReceiptText className="w-3 h-3" />
            {product.salesCount} venta{product.salesCount !== 1 ? 's' : ''}
          </div>
          <div className="text-xs text-gray-600 mt-1">
            <span className="text-gray-400">Motivo:</span>{' '}
            {product.ignoreReason ? product.ignoreReason : <span className="text-gray-400 italic">(sin motivo registrado)</span>}
            {product.ignoredAt && <span className="text-gray-400"> · {formatDateTime(product.ignoredAt)}</span>}
          </div>
          {rowError && <div className="p-2 rounded-lg bg-red-50 text-red-700 text-xs mt-2">{rowError}</div>}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="text-sm font-medium text-gray-900">{formatEur(product.totalEur)}</div>
          <ActionButton
            icon={busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            label="Deshacer"
            onClick={doUndo}
            disabled={busy}
            subtle
          />
        </div>
      </div>
    </div>
  )
}

function IgnoreReasonModal({
  open, productName, onCancel, onConfirm,
}: {
  open: boolean; productName: string; onCancel: () => void; onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  useEffect(() => { if (open) setReason('') }, [open])
  if (!open) return null
  const trimmed = reason.trim()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900 mb-1">Ignorar “{productName}”</h3>
        <p className="text-xs text-gray-500 mb-3">
          ¿Por qué se ignora? El motivo queda visible (y se puede deshacer). Obligatorio.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Ej.: producto de prueba / ya no se vende / error del TPV…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1.5">
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(trimmed)}
            disabled={trimmed === ''}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <EyeOff className="w-3.5 h-3.5" /> Ignorar
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// Vista GENERAL (todas las marcas, por razón) — comportamiento previo
// ═══════════════════════════════════════════════════════════════════════

function GeneralExceptionsView({ accountId }: { accountId: string }) {
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

  if (loading) return <div className="text-sm text-gray-500">Cargando excepciones…</div>
  if (error) return <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
  if (!signal) return null

  return (
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
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<MatchSuggestion[] | null>(null)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [busy, setBusy] = useState<BusyTag | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [showCostInput, setShowCostInput] = useState(false)
  const [costInput, setCostInput] = useState('')
  const [classifyMsg, setClassifyMsg] = useState<string | null>(null)
  const [confirmDishOpen, setConfirmDishOpen] = useState(false)
  const [targetCandidates, setTargetCandidates] = useState<ClassifyCandidate[] | null>(null)
  const [targetAction, setTargetAction] = useState<ClassifyAction | null>(null)

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
    setTargetCandidates(null)
    classifyUnmappedProduct(accountId, product.productName, action, unitCost)
      .then((res) => {
        if (res.resultado === 'needs_target') {
          setTargetCandidates(res.candidatos)
          setTargetAction(action)
          setBusy(null)
        } else if (res.resultado === 'resale_linked') {
          if (unitCost == null) {
            setClassifyMsg('Convertido a reventa y casado. Queda PENDIENTE DE COSTE: se rellenará con la próxima factura, o ponlo a mano en la ficha del artículo.')
            setTimeout(onResolved, 1800)
          } else {
            onResolved()
          }
        } else if (res.resultado === 'is_dish') {
          if (res.recipeItemId) {
            navigate('/kitchen/recetas?recipe=' + res.recipeItemId)
          } else {
            setClassifyMsg('Marcado como plato. Crea su escandallo en Recetas; al recasar, casará solo.')
            setBusy(null)
          }
        } else if (res.resultado === 'is_combo') {
          setClassifyMsg('Marcado como combo (pendiente del módulo de combos).')
          setBusy(null)
        } else {
          setClassifyMsg('Hecho.')
          setBusy(null)
        }
      })
      .catch((e) => { setRowError(String(e.message ?? e)); setBusy(null) })
  }

  // El usuario eligió a qué artículo casar (desplegable de candidatos): ancla por id.
  function doClassifyToTarget(recipeItemId: string) {
    if (busy || !targetAction) return
    setBusy('classify-resale')
    setRowError(null)
    classifyUnmappedProduct(accountId, product.productName, targetAction, null, recipeItemId)
      .then((res) => {
        setTargetCandidates(null)
        if (res.resultado === 'resale_linked') {
          setClassifyMsg('Convertido a reventa y casado. Pendiente de coste (lo rellena la factura).')
          setTimeout(onResolved, 1800)
        } else if (res.resultado === 'is_dish') {
          if (res.recipeItemId) navigate('/kitchen/recetas?recipe=' + res.recipeItemId)
          else { setClassifyMsg('Marcado como plato. Crea su escandallo en Recetas.'); setBusy(null) }
        } else {
          setClassifyMsg('Hecho.'); setBusy(null)
        }
      })
      .catch((e) => { setRowError(String(e.message ?? e)); setBusy(null) })
  }

  function confirmCreateDish() {
    setConfirmDishOpen(false)
    setBusy('classify-dish')
    setRowError(null)
    createDishFromUnmapped(accountId, product.productName)
      .then((res) => {
        if (res.recipeItemId) {
          navigate('/kitchen/recetas?recipe=' + res.recipeItemId)
        } else {
          setClassifyMsg('Plato creado. Crea su escandallo en Recetas.')
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

          {targetCandidates && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs space-y-2">
              <p className="text-amber-800">
                No encontré el artículo de “{product.productName}” automáticamente. ¿A cuál lo caso?
              </p>
              {targetCandidates.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {targetCandidates.map((c) => (
                    <button
                      key={c.recipeItemId}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => doClassifyToTarget(c.recipeItemId)}
                      className="px-2.5 py-1 rounded-md bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 transition-colors disabled:opacity-50"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-amber-700">No hay artículos de reventa parecidos. Créalo primero, o márcalo desde su ficha.</p>
              )}
              <button type="button" onClick={() => { setTargetCandidates(null); setTargetAction(null) }} className="text-amber-700 underline">
                Cancelar
              </button>
            </div>
          )}

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
                  onClick={() => setConfirmDishOpen(true)}
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

      <ConfirmDialog
        open={confirmDishOpen}
        title="Crear plato nuevo"
        message={`Se va a crear el plato "${product.productName}" en Folvy y se enlazará con sus ventas.\n\nDespués te llevaremos a su ficha para añadir la receta.`}
        confirmLabel="Crear plato"
        busy={busy === 'classify-dish'}
        onConfirm={confirmCreateDish}
        onCancel={() => setConfirmDishOpen(false)}
      />
    </div>
  )
}

function CostlessRow({
  product, accountId, isLast, onResolved,
}: {
  product: CostlessProduct; accountId: string; isLast: boolean; onResolved: () => void
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState<'resale' | 'dish' | 'combo' | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [targetCandidates, setTargetCandidates] = useState<ClassifyCandidate[] | null>(null)
  const [targetAction, setTargetAction] = useState<ClassifyAction | null>(null)

  function goToRecipe() {
    navigate('/kitchen/recetas?recipe=' + product.recipeItemId)
  }

  function doClassify(action: ClassifyAction) {
    if (busy) return
    setBusy(action)
    setRowError(null)
    setTargetCandidates(null)
    // Este producto YA tiene recipeItemId → lo pasamos como ancla (Puerta 1, sin adivinar).
    classifyUnmappedProduct(accountId, product.productName, action, null, product.recipeItemId)
      .then((res) => {
        if (res.resultado === 'needs_target') {
          setTargetCandidates(res.candidatos)
          setTargetAction(action)
          setBusy(null)
        } else if (res.resultado === 'resale_linked') {
          setMsg('Convertido a reventa. Queda pendiente de coste: lo rellenará la factura, o ponlo a mano en la ficha.')
          setTimeout(onResolved, 1800)
        } else if (res.resultado === 'is_dish') {
          if (res.recipeItemId) {
            navigate('/kitchen/recetas?recipe=' + res.recipeItemId)
          } else {
            setMsg('Marcado como plato. Crea su escandallo en Recetas; al recompute, dejará de estar sin coste.')
            setBusy(null)
          }
        } else if (res.resultado === 'is_combo') {
          setMsg('Marcado como combo (pendiente del módulo de combos y modificadores).')
          setBusy(null)
        } else {
          setMsg('Hecho.')
          setBusy(null)
        }
      })
      .catch((e) => { setRowError(String(e.message ?? e)); setBusy(null) })
  }

  function doClassifyToTarget(recipeItemId: string) {
    if (busy || !targetAction) return
    setBusy('resale')
    setRowError(null)
    classifyUnmappedProduct(accountId, product.productName, targetAction, null, recipeItemId)
      .then((res) => {
        setTargetCandidates(null)
        if (res.resultado === 'resale_linked') {
          setMsg('Convertido a reventa. Pendiente de coste (lo rellena la factura).')
          setTimeout(onResolved, 1800)
        } else { setMsg('Hecho.'); setBusy(null) }
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

      {targetCandidates && (
        <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs space-y-2 mt-2">
          <p className="text-amber-800">No encontré el artículo de “{product.productName}”. ¿A cuál lo caso?</p>
          {targetCandidates.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {targetCandidates.map((c) => (
                <button key={c.recipeItemId} type="button" disabled={busy !== null}
                  onClick={() => doClassifyToTarget(c.recipeItemId)}
                  className="px-2.5 py-1 rounded-md bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 transition-colors disabled:opacity-50">
                  {c.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-amber-700">No hay artículos parecidos. Créalo o márcalo desde su ficha.</p>
          )}
          <button type="button" onClick={() => { setTargetCandidates(null); setTargetAction(null) }} className="text-amber-700 underline">Cancelar</button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-2">
        <ActionButton
          icon={<ChefHat className="w-3.5 h-3.5" />}
          label={product.hasRecipeLines ? 'Completar escandallo' : 'Es un plato (crear escandallo)'}
          onClick={goToRecipe}
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
