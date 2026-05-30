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
// FOTO (E5): kitchen_photo_url guarda el PATH de un bucket privado; la URL
// servible se firma al render con getDishPhotoUrl(). La lista resuelve las
// URLs firmadas en lote tras cargar los platos (igual criterio que el editor),
// para que la miniatura muestre la foto real y no un path roto.
//
// Patrón de carga: useActiveAccount() + useEffect con flag `cancelled`,
// igual que KitchenItemsPage.

import { useEffect, useMemo, useState } from 'react'
import {
  ChefHat,
  Search,
  Sparkles,
  Check,
  AlertTriangle,
  ChevronRight,
  Soup,
} from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { listRecipeItems, getDishesIncomplete } from '@/modules/kitchen/services/recipeItemService'
import { getDishPhotoUrl } from '@/modules/kitchen/services/recipePhotoService'
import type { RecipeItem } from '@/types/kitchen'
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

  // ── Vista DETALLE: el editor del plato seleccionado ──
  if (selectedRecipeId) {
    return (
      <RecipeEditorPage
        recipeId={selectedRecipeId}
        onBack={() => setSelectedRecipeId(null)}
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
        <div className="text-sm text-text-secondary">
          {search.trim() !== ''
            ? `${filtered.length} de ${items.length}`
            : `${items.length}`}{' '}
          plato{items.length === 1 ? '' : 's'}
        </div>
      </div>

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
            Aún no hay platos en esta cuenta.
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
