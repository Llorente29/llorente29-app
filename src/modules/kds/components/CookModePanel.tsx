// src/modules/kds/components/CookModePanel.tsx
//
// Cook Mode: panel lateral (drawer) de tema oscuro que muestra la ficha técnica
// de un plato escalada a la cantidad de la línea. Llama a kds_recipe; el front
// solo pinta y REDONDEA las cantidades (deuda declarada: decimales largos del
// escandallo). Foto arriba ampliable (lightbox). Dos columnas base/total.
//
// Reutilizable con sesión (sin token) y con kiosco (token + locationId).

import { useEffect, useState } from 'react'
import { X, AlertTriangle, ImageOff, Loader2 } from 'lucide-react'
import { getRecipe, type KdsRecipe, type AllergenState } from '../services/kdsService'
import { roundQty } from '../kdsUtils'

interface CookModeTarget {
  menuItemId: string
  qty: number
  name: string
}

interface CookModePanelProps {
  target: CookModeTarget | null
  onClose: () => void
  token?: string | null
  locationId?: string | null
}

const ALLERGEN_LABELS: Record<string, string> = {
  gluten: 'Gluten', crustaceos: 'Crustáceos', huevo: 'Huevo', pescado: 'Pescado',
  cacahuetes: 'Cacahuetes', soja: 'Soja', lacteos: 'Lácteos', frutos_secos: 'Frutos secos',
  apio: 'Apio', mostaza: 'Mostaza', sesamo: 'Sésamo', sulfitos: 'Sulfitos',
  altramuces: 'Altramuces', moluscos: 'Moluscos',
}
function allergenLabel(code: string): string {
  return ALLERGEN_LABELS[code] ?? code
}
function allergenChipClasses(state: AllergenState): string {
  switch (state) {
    case 'contains':     return 'bg-red-500/25 text-red-200 ring-1 ring-red-500/50'
    case 'may_contain':  return 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40'
    default:             return 'bg-zinc-700/60 text-zinc-300 ring-1 ring-zinc-600'
  }
}

export default function CookModePanel({ target, onClose, token, locationId }: CookModePanelProps) {
  const [recipe, setRecipe] = useState<KdsRecipe | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)

  useEffect(() => {
    if (!target) { setRecipe(null); setError(null); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    setRecipe(null)
    getRecipe(target.menuItemId, target.qty, token, locationId)
      .then(r => { if (!cancelled) setRecipe(r) })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [target, token, locationId])

  // Cierre con Escape.
  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (lightbox) setLightbox(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, lightbox, onClose])

  if (!target) return null

  const hasRecipe = recipe && recipe.found
  const hasSteps = hasRecipe && recipe.steps.length > 0

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <aside className="relative h-full w-full max-w-xl bg-zinc-900 text-zinc-100 shadow-2xl flex flex-col border-l border-zinc-700">
        {/* Cabecera */}
        <header className="flex items-start justify-between gap-3 p-5 border-b border-zinc-700 shrink-0">
          <div>
            <h2 className="text-2xl font-bold leading-tight">{target.name}</h2>
            <p className="text-sm text-zinc-400 mt-0.5">
              Cook Mode · <span className="text-zinc-200 font-semibold">× {target.qty}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 shrink-0"
            aria-label="Cerrar"
          >
            <X size={24} />
          </button>
        </header>

        <div className="overflow-y-auto flex-1 p-5 space-y-6">
          {loading && (
            <div className="flex items-center gap-2 text-zinc-400 py-10 justify-center">
              <Loader2 className="animate-spin" size={20} /> Cargando ficha…
            </div>
          )}

          {error && !loading && (
            <div className="rounded-lg bg-red-500/15 text-red-200 ring-1 ring-red-500/40 p-4 text-sm">
              No se pudo cargar la ficha técnica. {error}
            </div>
          )}

          {!loading && !error && !hasRecipe && (
            <div className="flex flex-col items-center justify-center text-center py-16 text-zinc-500">
              <ImageOff size={40} className="mb-3" />
              <p className="text-lg font-medium text-zinc-300">Sin ficha técnica</p>
              <p className="text-sm mt-1">Este plato aún no tiene escandallo ni receta cargada.</p>
            </div>
          )}

          {!loading && !error && hasRecipe && (
            <>
              {/* Foto */}
              {recipe.photo_url && (
                <button
                  onClick={() => setLightbox(recipe.photo_url)}
                  className="block w-full overflow-hidden rounded-xl ring-1 ring-zinc-700 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                >
                  <img
                    src={recipe.photo_url}
                    alt={target.name}
                    className="w-full h-56 object-cover hover:scale-[1.02] transition-transform"
                  />
                </button>
              )}

              {/* Alérgenos */}
              {recipe.allergens.length > 0 && (
                <section>
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-2">
                    <AlertTriangle size={14} /> Alérgenos
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {recipe.allergens.map(a => (
                      <span
                        key={a.code}
                        className={`px-2.5 py-1 rounded-md text-sm font-medium ${allergenChipClasses(a.state)}`}
                      >
                        {allergenLabel(a.code)}
                        {a.state === 'may_contain' && <span className="opacity-70"> (trazas)</span>}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* Ingredientes: dos columnas base / total */}
              {recipe.ingredients.length > 0 && (
                <section>
                  <div className="flex items-baseline justify-between mb-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Ingredientes</h3>
                    <div className="flex gap-6 text-[11px] uppercase tracking-wide text-zinc-500 pr-1">
                      <span className="w-16 text-right">1 ración</span>
                      <span className="w-16 text-right text-zinc-300">× {target.qty}</span>
                    </div>
                  </div>
                  <ul className="divide-y divide-zinc-800 rounded-lg ring-1 ring-zinc-800 overflow-hidden">
                    {recipe.ingredients.map((ing, i) => (
                      <li key={`${ing.name}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2.5 bg-zinc-800/40">
                        <span className="text-zinc-100">
                          {ing.name}
                          {ing.cut && <span className="text-zinc-500 text-sm"> · {ing.cut}</span>}
                        </span>
                        <span className="flex gap-6 shrink-0 tabular-nums">
                          <span className="w-16 text-right text-zinc-400">{roundQty(ing.qty_base)} {ing.unit}</span>
                          <span className="w-16 text-right text-zinc-100 font-semibold">{roundQty(ing.qty_total)} {ing.unit}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Pasos */}
              {hasSteps && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-2">Pasos</h3>
                  <ol className="space-y-3">
                    {recipe.steps.map(step => (
                      <li key={step.position} className="flex gap-3">
                        <span className="shrink-0 w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40 grid place-items-center text-sm font-bold">
                          {step.position}
                        </span>
                        <div className="flex-1 pt-0.5">
                          <p className="text-zinc-100 leading-snug">{step.text}</p>
                          <div className="flex flex-wrap gap-2 mt-1.5 text-xs text-zinc-400">
                            {step.duration_min != null && <span>⏱ {step.duration_min} min</span>}
                            {step.temperature_c != null && <span>🌡 {step.temperature_c} ºC</span>}
                          </div>
                          {step.ingredients.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {step.ingredients.map(code => (
                                <span key={code} className="px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-300 text-xs">
                                  {code}
                                </span>
                              ))}
                            </div>
                          )}
                          {step.photo_url && (
                            <button onClick={() => setLightbox(step.photo_url)} className="mt-2 block">
                              <img src={step.photo_url} alt={`Paso ${step.position}`} className="h-24 rounded-lg ring-1 ring-zinc-700 object-cover" />
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {hasRecipe && !hasSteps && recipe.ingredients.length > 0 && (
                <p className="text-xs text-zinc-500 italic">Pasos de elaboración aún no cargados.</p>
              )}
            </>
          )}
        </div>
      </aside>

      {/* Lightbox de foto */}
      {lightbox && (
        <div
          className="absolute inset-0 z-10 bg-black/90 flex items-center justify-center p-6"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="" className="max-h-full max-w-full object-contain rounded-lg" />
          <button
            className="absolute top-5 right-5 p-2 rounded-lg bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700"
            onClick={() => setLightbox(null)}
            aria-label="Cerrar imagen"
          >
            <X size={24} />
          </button>
        </div>
      )}
    </div>
  )
}
