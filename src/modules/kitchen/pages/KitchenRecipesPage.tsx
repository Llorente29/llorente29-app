// src/modules/kitchen/pages/KitchenRecipesPage.tsx
//
// Página "Recetas" del módulo Kitchen. Patrón LISTA + DETALLE por estado
// (las páginas kitchen NO usan react-router con params; navegan por estado).
//
//   selectedRecipeId === null  → vista LISTA de platos (type='dish').
//   selectedRecipeId !== null  → vista DETALLE: <RecipeEditorPage recipeId
//                                onBack={…} /> (el editor vuelve a la lista).
//
// Esto sustituye al montaje directo del editor en la ruta 'recetas' y elimina
// la necesidad del FALLBACK_RECIPE_ID que tenía RecipeEditorPage.
//
// TRAMO L1 (este): lista funcional + búsqueda léxica por nombre + navegación
// real al editor + CTA "Crear escandallo" para platos sin coste.
// Honestidad de datos: la tarjeta muestra SOLO campos reales de recipe_item
// (foto, nombre, alt, código, coste computado, estado, IA, actualizado).
//   - Marca / canales / food cost → L2 (RPC de lista server-side).
//   - Familia / etiquetas / modos Tarjetas-Tabla / vistas guardadas / búsqueda
//     semántica → tramos siguientes (familia/tags dependen del schema S1).
//
// TRAMO L1.5 (este): botón "Nuevo plato" — crear una receta DESDE CERO. Faltaba:
// la pantalla solo permitía importar ficha o rellenar cascarones existentes, no
// crear un plato nuevo. Reutiliza el modal de alta (RecipeFormModal) que vivía
// en KitchenRecipePage (el lienzo viejo): nombre + tipo + unidad base + raciones
// → createRecipeItem({ type:'dish' }) → abre el plato nuevo en el editor para
// añadir ingredientes. Los 4 campos obligatorios de recipe_item son accountId,
// type, name, baseUnitId; el resto es opcional y el coste se monta luego con las
// líneas. (El lienzo viejo KitchenRecipePage queda como ZOMBI a borrar en un
// commit de limpieza aparte: ya no lo monta nadie — la ruta 'recetas' monta esta
// página, y el editor es RecipeEditorPage.)
//
// FOTO (E5): kitchen_photo_url guarda el PATH de un bucket privado; la URL
// servible se firma al render con getDishPhotoUrl(). La lista resuelve las
// URLs firmadas en lote tras cargar los platos (igual criterio que el editor),
// para que la miniatura muestre la foto real y no un path roto.
//
// Patrón de carga: useActiveAccount() + useEffect con flag `cancelled`,
// igual que KitchenItemsPage.

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ChefHat,
  Search,
  Sparkles,
  Check,
  AlertTriangle,
  ChevronRight,
  Soup,
  Camera,
  Plus,
  Loader2,
  X,
} from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useApp } from '@/context/AppContext'
import { listRecipeItems, getDishesIncomplete, createRecipeItem } from '@/modules/kitchen/services/recipeItemService'
import { getDishPhotoUrl } from '@/modules/kitchen/services/recipePhotoService'
import {
  extractRecipeSession,
  type ImportRecipeResult,
  type ExtractedRecipeSession,
} from '@/modules/kitchen/services/recipeImportService'
import RecipeImportReviewModal from '@/modules/kitchen/components/RecipeImportReviewModal'
import { listUnits } from '@/modules/kitchen/services/kitchenUnitService'
import type { RecipeItem, KitchenUnit, RecipeItemType } from '@/types/kitchen'
import RecipeEditorPage from '@/modules/kitchen/pages/RecipeEditorPage'

function formatEur(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

// Normaliza para buscar: minúsculas + sin acentos/diacríticos.
// "Plátano" → "platano", "Milanèsa" → "milanesa".
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

// Búsqueda por PALABRAS (tokens), no por frase literal: el texto se parte en
// palabras y TODAS deben aparecer en el campo objetivo (en cualquier orden).
// Así "milanesa pol" encuentra "Milanesa de Pollo". Ignora acentos.
function matchesTokens(query: string, ...fields: (string | null | undefined)[]): boolean {
  const tokens = normalize(query).split(/\s+/).filter((t) => t !== '')
  if (tokens.length === 0) return true
  const haystack = fields
    .filter((f): f is string => !!f)
    .map((f) => normalize(f))
    .join(' ')
  return tokens.every((tok) => haystack.includes(tok))
}

// "Actualizado hace…" a partir de cost_updated_at. Devuelve null si no hay dato
// (entonces simplemente no se muestra la línea).
function formatRelative(iso: string | null): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const day = 86_400_000
  const days = Math.floor((Date.now() - then) / day)
  if (days <= 0) return 'hoy'
  if (days === 1) return 'ayer'
  if (days < 7) return `hace ${days} días`
  if (days < 30) {
    const w = Math.floor(days / 7)
    return `hace ${w} semana${w > 1 ? 's' : ''}`
  }
  const m = Math.floor(days / 30)
  return `hace ${m} mes${m > 1 ? 'es' : ''}`
}

// Estado del plato derivado de campos reales. Cuatro estados, para que
// "Revisar" sea SEÑAL y no ruido (decisión Julio 30/05):
//   sin_escandallo → no tiene coste computado (computedCost null).
//   revisar        → ALARMA REAL: coste sospechoso (reviewNotes cost_suspect)
//                    o receta incompleta (ingrediente sin terminar / línea no
//                    costeable, vía incompleteIds). Esto es lo accionable.
//   sin_validar    → needs_review marcado pero SIN diagnóstico accionable
//                    (bebidas, combos: el import marcó en bloque). Neutro, no
//                    es alarma — pintar esto en rojo encendería 2/3 de la carta.
//   validado       → tiene coste, sin sospecha y sin incompletos.
type DishStatus = 'sin_escandallo' | 'revisar' | 'sin_validar' | 'validado'

function dishStatus(item: RecipeItem, incompleteIds: Set<string>): DishStatus {
  if (item.computedCost === null || item.computedCost === undefined) {
    return 'sin_escandallo'
  }
  // Alarma real: coste diagnosticado como sospechoso O receta incompleta.
  // OJO: review_notes se CONSERVA como traza histórica incluso tras "dar por
  // revisado", así que el kind por sí solo no basta — solo cuenta si la
  // incidencia sigue activa (needsReview true). Un plato con nota cost_suspect
  // pero ya revisado (needsReview false) está validado, no en revisión.
  const costSuspectActivo = item.needsReview && item.reviewNotes?.kind === 'cost_suspect'
  if (costSuspectActivo || incompleteIds.has(item.id)) return 'revisar'
  // Marcado para revisar pero sin diagnóstico accionable → neutro, no alarma.
  if (item.needsReview) return 'sin_validar'
  return 'validado'
}

export default function KitchenRecipesPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const { authUserId, userProfile } = useApp()
  const [searchParams, setSearchParams] = useSearchParams()

  const [items, setItems] = useState<RecipeItem[]>([])
  const [incompleteIds, setIncompleteIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // null = vista lista; un id = vista detalle (editor de ese plato).
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)
  // E5: URLs firmadas de las fotos (id del plato -> URL servible). El listado
  // guarda el PATH en kitchen_photo_url; aquí lo firmamos para poder mostrarlo.
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})

  // ── Función estrella: importar escandallo por foto ──
  const [importing, setImporting] = useState(false)
  const [importStage, setImportStage] = useState<'idle' | 'uploading' | 'reading' | 'done'>('idle')
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<ImportRecipeResult | null>(null)
  // B2: sesión extraída pendiente de revisar (abre el modal anti-duplicados).
  const [review, setReview] = useState<ExtractedRecipeSession | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  // ── L1.5: crear plato desde cero ──
  // Unidades base para el selector del modal (tabla semilla global; carga única
  // por cuenta, independiente del reloadTick de la lista). El botón "Nuevo plato"
  // queda deshabilitado hasta que estén cargadas (baseUnitId es obligatorio).
  const [units, setUnits] = useState<KitchenUnit[]>([])
  const [unitsLoading, setUnitsLoading] = useState(false)
  const [showNewDish, setShowNewDish] = useState(false)

  // Navegación entrante desde otra pantalla (p.ej. "Es un plato" en Excepciones):
  // si la URL trae ?recipe=ID, abrimos su editor directamente. Usamos query param
  // (no location.state) porque sobrevive al remontaje de la app al cambiar de ruta.
  // Tras abrirlo, limpiamos el param para que un "volver" a la lista no lo reabra.
  useEffect(() => {
    const incomingId = searchParams.get('recipe')
    if (incomingId) {
      setSelectedRecipeId(incomingId)
      const next = new URLSearchParams(searchParams)
      next.delete('recipe')
      setSearchParams(next, { replace: true })
    }
    // Solo al montar / cambiar el param entrante.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (accountsLoading) return
    if (!activeAccountId) {
      setItems([])
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    listRecipeItems({ accountId: activeAccountId, type: 'dish' })
      .then((rows) => {
        if (!cancelled) setItems(rows)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Error desconocido'
        setError(msg)
        setItems([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    // Propagación: platos con ingrediente sin terminar o línea no costeable.
    // No bloquea la lista; si falla, se registra (no se silencia) y el listado
    // sigue mostrando el needs_review propio de cada plato.
    getDishesIncomplete(activeAccountId)
      .then((set) => {
        if (!cancelled) setIncompleteIds(set)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('getDishesIncomplete falló:', err)
      })

    return () => {
      cancelled = true
    }
  }, [activeAccountId, accountsLoading, reloadTick])

  // L1.5: carga de unidades para el modal "Nuevo plato". Una vez por cuenta;
  // no depende del reloadTick (las unidades no cambian al crear platos).
  useEffect(() => {
    if (accountsLoading || !activeAccountId) return
    let cancelled = false
    setUnitsLoading(true)
    listUnits({})
      .then((rows) => {
        if (!cancelled) setUnits(rows)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('listUnits falló:', err)
      })
      .finally(() => {
        if (!cancelled) setUnitsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeAccountId, accountsLoading])

  // E5: resolver en lote las URLs firmadas de los platos que tienen foto.
  // kitchen_photo_url es un PATH de bucket privado; sin firmar no es servible.
  // Solo se firma para los platos CON foto, así que el coste es proporcional a
  // las fotos existentes, no al total de platos. (Optimización futura: firma
  // por lote con createSignedUrls; deuda menor anotada.)
  useEffect(() => {
    let cancelled = false
    const withPhoto = items.filter((it) => it.kitchenPhotoUrl)
    if (withPhoto.length === 0) {
      setPhotoUrls({})
      return
    }
    Promise.all(
      withPhoto.map(async (it) => {
        try {
          const url = await getDishPhotoUrl(it.kitchenPhotoUrl as string)
          return url ? ([it.id, url] as const) : null
        } catch {
          return null
        }
      }),
    ).then((pairs) => {
      if (cancelled) return
      const map: Record<string, string> = {}
      for (const p of pairs) if (p) map[p[0]] = p[1]
      setPhotoUrls(map)
    })
    return () => {
      cancelled = true
    }
  }, [items])

  // Búsqueda por palabras (tokens) en cliente, ignorando acentos. Coincide si
  // todas las palabras escritas aparecen en nombre / nombre alternativo / código
  // (en cualquier orden). "milanesa pol" → "Milanesa de Pollo".
  const filtered = useMemo(() => {
    const q = search.trim()
    if (q === '') return items
    return items.filter((it) => matchesTokens(q, it.name, it.altName, it.code))
  }, [items, search])

  // Dispara la importación por foto: sube → extrae con IA → abre la pantalla de
  // revisión (B2). La materialización ocurre al "Terminar" en el modal, ya sin
  // duplicar ingredientes.
  async function handleImportPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !activeAccountId) return

    setImporting(true)
    setImportError(null)
    setImportResult(null)
    setReview(null)
    setImportStage('uploading')
    try {
      // Pequeño cambio de etapa para feedback (la subida es rápida; la IA tarda).
      window.setTimeout(() => setImportStage((s) => (s === 'uploading' ? 'reading' : s)), 800)
      const session = await extractRecipeSession(activeAccountId, file)
      // Abre el modal de revisión y cierra el spinner.
      setReview(session)
      setImportStage('idle')
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'No se pudo importar la ficha.')
      setImportStage('idle')
    } finally {
      setImporting(false)
    }
  }

  function closeImportModal() {
    setImportStage('idle')
    setImportError(null)
    setImportResult(null)
  }

  // ── Vista DETALLE: el editor del plato seleccionado ──
  if (selectedRecipeId) {
    return (
      <RecipeEditorPage
        recipeId={selectedRecipeId}
        onBack={() => setSelectedRecipeId(null)}
        onOpenRecipe={(id) => setSelectedRecipeId(id)}
      />
    )
  }

  // ── Vista LISTA ──
  return (
    <div className="space-y-4">
      {/* Cabecera */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-display font-medium text-text-primary">
            Recetas
          </h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Tus platos y el escandallo de cada uno
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* L1.5: crear plato desde cero (acción principal) */}
          <button
            type="button"
            onClick={() => setShowNewDish(true)}
            disabled={unitsLoading || units.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-terracota text-white hover:bg-terracota-hover disabled:opacity-50 transition-colors"
            title={units.length === 0 ? 'Cargando unidades…' : 'Crea un plato desde cero y añade sus ingredientes'}
          >
            <Plus className="w-4 h-4" /> Nuevo plato
          </button>
          {/* Importar ficha (acción secundaria) */}
          <button
            type="button"
            onClick={() => document.getElementById('recipe-import-input')?.click()}
            disabled={importing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border border-terracota text-terracota bg-transparent hover:bg-terracota-bg disabled:opacity-50 transition-colors"
            title="Sube una foto, PDF, Excel o Word de tu ficha y la IA monta el escandallo"
          >
            <Camera className="w-4 h-4" /> Importar ficha
          </button>
          <span className="text-sm text-text-secondary">
            {search.trim() !== ''
              ? `${filtered.length} de ${items.length}`
              : `${items.length}`}{' '}
            plato{items.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <input
        id="recipe-import-input"
        type="file"
        accept="image/*,application/pdf,.pdf,.xlsx,.xls,.csv,.docx"
        className="hidden"
        onChange={handleImportPhoto}
      />

      {/* L1.5: modal de alta — crear plato desde cero */}
      {showNewDish && activeAccountId && (
        <RecipeFormModal
          accountId={activeAccountId}
          units={units}
          actorId={authUserId ?? null}
          actorName={userProfile?.displayName ?? null}
          onClose={() => setShowNewDish(false)}
          onCreated={(created) => {
            // Cierra el modal, refresca la lista para cuando se vuelva, y abre el
            // plato recién creado en el editor para empezar a añadir ingredientes.
            setShowNewDish(false)
            setReloadTick((t) => t + 1)
            setSelectedRecipeId(created.id)
          }}
        />
      )}

      {/* B2: modal de revisión anti-duplicados (sobre la pantalla principal) */}
      {review && activeAccountId && (
        <RecipeImportReviewModal
          accountId={activeAccountId}
          sessionId={review.sessionId}
          dishName={review.dishName}
          lines={review.lines}
          onCancel={() => setReview(null)}
          onCompleted={(result) => {
            setReview(null)
            setImportResult(result)
            setImportStage('done')
          }}
        />
      )}

      {/* Modal de importación por foto (feedback del flujo) */}
      {importStage !== 'idle' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card rounded-xl w-full max-w-md p-6 border border-border-default">
            {importStage === 'done' && importResult ? (
              <>
                <div className="flex items-center gap-2 text-text-primary mb-3">
                  <Sparkles className="w-5 h-5 text-terracota" />
                  <span className="text-base font-medium">Escandallo importado</span>
                </div>
                <p className="text-sm text-text-secondary mb-1">
                  <span className="font-medium text-text-primary">{importResult.dishName}</span>{' '}
                  · {importResult.linesCreated} ingrediente{importResult.linesCreated === 1 ? '' : 's'} en la receta.
                </p>
                {importResult.newArticlesCreated > 0 && (
                  <p className="text-xs text-text-secondary mb-1">
                    {importResult.newArticlesCreated} ingrediente{importResult.newArticlesCreated === 1 ? '' : 's'} nuevo{importResult.newArticlesCreated === 1 ? '' : 's'} creado{importResult.newArticlesCreated === 1 ? '' : 's'} (marcados para completar coste y proveedor).
                  </p>
                )}
                {importResult.linesSkipped > 0 && (
                  <p className="text-xs text-amber-600 mb-1">
                    {importResult.linesSkipped} línea{importResult.linesSkipped === 1 ? '' : 's'} sin cantidad/unidad clara — revísalas en la ficha.
                  </p>
                )}
                <div className="flex gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => {
                      const id = importResult.recipeId
                      closeImportModal()
                      setSelectedRecipeId(id)
                    }}
                    className="flex-1 px-3 py-2 rounded-md text-sm font-medium bg-terracota text-white hover:bg-terracota-hover transition-colors"
                  >
                    Abrir escandallo
                  </button>
                  <button
                    type="button"
                    onClick={() => { closeImportModal(); setReloadTick((t) => t + 1) }}
                    className="px-3 py-2 rounded-md text-sm text-text-secondary hover:bg-page transition-colors"
                  >
                    Cerrar
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center py-4">
                <Loader2 className="w-8 h-8 animate-spin text-terracota mx-auto mb-3" />
                <p className="text-sm text-text-primary font-medium">
                  {importStage === 'uploading' ? 'Subiendo la ficha…' : 'Leyendo tu ficha con IA…'}
                </p>
                <p className="text-xs text-text-secondary mt-1">
                  {importStage === 'uploading'
                    ? 'Un momento.'
                    : 'La IA está extrayendo ingredientes y cantidades. Puede tardar unos segundos.'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {importError && (
        <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm flex items-center justify-between gap-2">
          <span>{importError}</span>
          <button type="button" onClick={() => setImportError(null)} className="text-danger hover:opacity-70 flex-shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Búsqueda */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar plato por nombre…"
          className="w-full pl-9 pr-3 py-2 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {/* Estados de carga / error */}
      {loading && (
        <div className="p-8 text-center text-sm text-text-secondary">
          Cargando platos…
        </div>
      )}

      {!loading && error && (
        <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="p-8 rounded-md bg-card border border-border-default text-center">
          <Soup size={32} className="mx-auto text-text-secondary mb-2" />
          <p className="text-sm text-text-secondary">
            Aún no hay platos en esta cuenta. Pulsa «Nuevo plato» para crear el primero.
          </p>
        </div>
      )}

      {!loading && !error && items.length > 0 && filtered.length === 0 && (
        <div className="p-8 rounded-md bg-card border border-border-default text-center">
          <p className="text-sm text-text-secondary">
            Ningún plato coincide con «{search.trim()}».
          </p>
        </div>
      )}

      {/* Lista de tarjetas */}
      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((item) => {
            const status = dishStatus(item, incompleteIds)
            const isAi =
              item.source === 'ai_recipe' || item.source === 'ocr_invoice'
            const updated = formatRelative(item.costUpdatedAt)
            const photo = photoUrls[item.id]

            return (
              <div
                key={item.id}
                onClick={() => setSelectedRecipeId(item.id)}
                className="bg-card rounded-lg border border-border-default p-3 flex items-center gap-3 cursor-pointer hover:border-terracota hover:shadow-sm transition-base"
              >
                {/* Foto / placeholder cálido. La miniatura usa la URL firmada
                    (photoUrls[id]); mientras se resuelve o si no hay foto,
                    cae al recuadro cálido con el icono. */}
                <span className="w-14 h-14 rounded-md overflow-hidden flex-shrink-0">
                  {photo ? (
                    <img
                      src={photo}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center bg-terracota-bg">
                      <ChefHat className="w-6 h-6 text-terracota opacity-60" />
                    </span>
                  )}
                </span>

                {/* Centro: nombre + meta */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-display font-medium text-text-primary truncate">
                      {item.name}
                    </span>
                    {isAi && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-accent-bg text-accent font-medium flex-shrink-0">
                        <Sparkles className="w-3 h-3" />
                        IA
                      </span>
                    )}
                  </div>
                  {item.altName && (
                    <div className="text-xs text-text-secondary truncate">
                      {item.altName}
                    </div>
                  )}
                  {(item.code || updated) && (
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-text-secondary">
                      {item.code && (
                        <span className="font-mono">{item.code}</span>
                      )}
                      {item.code && updated && (
                        <span className="opacity-50">·</span>
                      )}
                      {updated && <span>Actualizado {updated}</span>}
                    </div>
                  )}
                </div>

                {/* Derecha: coste + estado, o CTA crear escandallo */}
                <div className="flex-shrink-0">
                  {status === 'sin_escandallo' ? (
                    <div className="flex flex-col items-end gap-1.5">
                      <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
                        <span className="w-2 h-2 rounded-full bg-border-default" />
                        Sin escandallo
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedRecipeId(item.id)
                        }}
                        className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md bg-terracota text-white hover:bg-terracota-hover transition-base"
                      >
                        Crear escandallo
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-end gap-1">
                      <span className="font-mono text-sm font-medium text-text-primary">
                        {formatEur(item.computedCost)}
                      </span>
                      {status === 'revisar' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-warning-bg text-warning">
                          <AlertTriangle className="w-3 h-3" />
                          Revisar
                        </span>
                      ) : status === 'sin_validar' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full text-text-secondary">
                          <span className="w-2 h-2 rounded-full bg-border-default" />
                          Sin validar
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-success-bg text-success">
                          <Check className="w-3 h-3" />
                          Validado
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Modal "Nuevo plato" — crear un recipe_item desde cero.
//
// Reutilizado de KitchenRecipePage (lienzo viejo). Crea el plato con los 4
// campos obligatorios (accountId, type, name, baseUnitId) + raciones opcionales,
// y devuelve el RecipeItem creado vía onCreated() para que el contenedor lo abra
// en el editor. El coste NO se monta aquí: nace sin líneas y se construye en el
// editor con "Añadir ingrediente". Para un plato individual la unidad base suele
// ser "Unidad"; para una sub-receta a granel, peso o volumen.
// ─────────────────────────────────────────────────────────────────────

interface RecipeFormModalProps {
  accountId: string
  units: KitchenUnit[]
  actorId: string | null
  actorName: string | null
  onClose: () => void
  onCreated: (created: RecipeItem) => void
}

function RecipeFormModal({
  accountId,
  units,
  actorId,
  actorName,
  onClose,
  onCreated,
}: RecipeFormModalProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState<RecipeItemType>('dish')
  const [baseUnitId, setBaseUnitId] = useState<string>(units[0]?.id ?? '')
  const [yieldPortions, setYieldPortions] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    const trimmed = name.trim()
    if (trimmed === '') {
      setError('El nombre es obligatorio.')
      return
    }
    if (!baseUnitId) {
      setError('Elige una unidad base.')
      return
    }
    const yieldParsed = yieldPortions.trim() === ''
      ? null
      : Number(yieldPortions.replace(',', '.'))
    if (yieldParsed !== null && (Number.isNaN(yieldParsed) || yieldParsed <= 0)) {
      setError('Las raciones deben ser un número > 0 (deja vacío si no aplica).')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const created = await createRecipeItem({
        accountId,
        type,
        name: trimmed,
        baseUnitId,
        yieldPortions: yieldParsed,
        createdBy: actorId,
        createdByName: actorName,
      })
      onCreated(created)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setError(msg)
      setSubmitting(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && !submitting) {
      onClose()
    }
  }

  // Unidades agrupadas por dimensión (igual que KitchenItemsPage).
  const unitsGrouped = useMemo(() => {
    const groups = new Map<string, KitchenUnit[]>()
    units.forEach((u) => {
      const list = groups.get(u.dimension) ?? []
      list.push(u)
      groups.set(u.dimension, list)
    })
    return groups
  }, [units])

  const DIM_LABEL: Record<string, string> = {
    weight: 'Peso',
    volume: 'Volumen',
    unit: 'Unidades',
    length: 'Longitud',
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recipe-form-title"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-card w-full sm:max-w-md max-h-[95vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 id="recipe-form-title" className="text-base font-medium text-text-primary">
            Nuevo plato
          </h3>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            disabled={submitting}
            className="text-text-secondary hover:text-text-primary transition-base disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Nombre
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              placeholder="Ej: Pizza Margherita"
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Tipo
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as RecipeItemType)}
              disabled={submitting}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            >
              <option value="dish">Plato (se sirve al cliente)</option>
              <option value="recipe">Sub-receta (componente reutilizable)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Unidad base
            </label>
            <select
              value={baseUnitId}
              onChange={(e) => setBaseUnitId(e.target.value)}
              disabled={submitting || units.length === 0}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            >
              {Array.from(unitsGrouped.entries()).map(([dim, list]) => (
                <optgroup key={dim} label={DIM_LABEL[dim] ?? dim}>
                  {list.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.abbreviation})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-[11px] text-text-secondary mt-1">
              Para un plato individual normalmente "Unidad". Para una sub-receta a granel, peso o volumen.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Raciones
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={yieldPortions}
              onChange={(e) => setYieldPortions(e.target.value)}
              disabled={submitting}
              placeholder="Opcional. Ej: 8"
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
            <p className="text-[11px] text-text-secondary mt-1">
              Cuántas raciones salen de esta receta. Permite calcular el coste por ración.
            </p>
          </div>

          {error && (
            <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
          >
            {submitting ? 'Creando...' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  )
}
