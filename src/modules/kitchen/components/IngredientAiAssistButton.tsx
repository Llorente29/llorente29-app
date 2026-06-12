// src/modules/kitchen/components/IngredientAiAssistButton.tsx
//
// Copiloto IA de ficha (UI autocontenida). Un botón "Completar con IA" que:
//  1. Llama a enrichIngredient (Edge Function).
//  2. Muestra la propuesta (alérgenos, merma, conservación) con su CONFIANZA.
//  3. El cocinero ACEPTA/RECHAZA campo a campo (nada se aplica solo).
//  4. Aplica lo aceptado y avisa al padre (onApplied) para recargar la ficha.
//
// Se enchufa en KitchenItemDetailPage con una línea:
//   <IngredientAiAssistButton itemId={item.id} accountId={item.accountId} onApplied={reload} />
//
// "IA propone, humano decide": la confianza es visible y cada campo es opcional.

import { useState } from 'react'
import { Sparkles, X, Check, Loader2 } from 'lucide-react'
import {
  enrichIngredient,
  applyEnrichment,
  type EnrichProposal,
  type EnrichAllergen,
} from '@/modules/kitchen/services/recipeAiService'
import { allergenLabel } from '@/modules/kitchen/lib/allergens'

interface Props {
  itemId: string
  accountId: string
  onApplied?: () => void
  className?: string
}

const CONSERVATION_LABEL: Record<string, string> = {
  fridge: 'Refrigerado',
  freezer: 'Congelado',
  dry: 'Seco / ambiente',
  hot: 'Caliente',
}

const STATE_LABEL: Record<string, string> = {
  contains: 'Contiene',
  may_contain: 'Trazas',
  free: 'Libre',
}

// Etiquetas de menú: código -> texto visible.
const MENU_TAG_LABEL: Record<string, string> = {
  picante: 'Picante',
  vegano: 'Vegano',
  vegetariano: 'Vegetariano',
  sin_gluten: 'Sin gluten',
  sin_lactosa: 'Sin lactosa',
  halal: 'Halal',
  ecologico: 'Ecológico / Bio',
}

// Campos de nutrición (orden de la etiqueta UE) + etiqueta y unidad.
const NUTRITION_FIELDS: { key: string; label: string; unit: string }[] = [
  { key: 'energy_kcal', label: 'Energía', unit: 'kcal' },
  { key: 'fat_g', label: 'Grasas', unit: 'g' },
  { key: 'saturated_fat_g', label: '· saturadas', unit: 'g' },
  { key: 'carbs_g', label: 'Hidratos', unit: 'g' },
  { key: 'sugars_g', label: '· azúcares', unit: 'g' },
  { key: 'fiber_g', label: 'Fibra', unit: 'g' },
  { key: 'protein_g', label: 'Proteínas', unit: 'g' },
  { key: 'salt_g', label: 'Sal', unit: 'g' },
]

function confidenceLabel(c: number | null): { text: string; cls: string } {
  if (c === null) return { text: 'Sin confianza', cls: 'text-text-secondary' }
  if (c >= 0.8) return { text: `Confianza alta (${Math.round(c * 100)}%)`, cls: 'text-success' }
  if (c >= 0.5) return { text: `Confianza media (${Math.round(c * 100)}%)`, cls: 'text-warning' }
  return { text: `Confianza baja (${Math.round(c * 100)}%)`, cls: 'text-danger' }
}

export function IngredientAiAssistButton({ itemId, accountId, onApplied, className }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<EnrichProposal | null>(null)

  // Selección del cocinero (qué acepta).
  const [acceptFamily, setAcceptFamily] = useState(false)
  const [acceptAllergens, setAcceptAllergens] = useState<Set<string>>(new Set())
  const [acceptWaste, setAcceptWaste] = useState(false)
  const [acceptConservation, setAcceptConservation] = useState(false)
  const [acceptNutrition, setAcceptNutrition] = useState(false)
  const [acceptShelfLife, setAcceptShelfLife] = useState(false)
  const [acceptTags, setAcceptTags] = useState<Set<string>>(new Set())

  async function handleOpen() {
    setOpen(true)
    setError(null)
    setProposal(null)
    setLoading(true)
    try {
      const res = await enrichIngredient(itemId, accountId)
      setProposal(res.proposal)
      // Por defecto, preselecciona lo propuesto (el cocinero puede desmarcar).
      setAcceptFamily(res.proposal.family !== null)
      setAcceptAllergens(new Set(res.proposal.allergens.map((a) => a.code)))
      setAcceptWaste(res.proposal.defaultWastePct !== null)
      setAcceptConservation(res.proposal.conservationType !== null)
      setAcceptNutrition(res.proposal.nutrition !== null)
      setAcceptShelfLife(res.proposal.shelfLifeDays !== null)
      setAcceptTags(new Set(res.proposal.menuTags))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  function toggleAllergen(code: string) {
    setAcceptAllergens((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  function toggleTag(tag: string) {
    setAcceptTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  const hasAnythingToApply =
    !!proposal &&
    ((acceptFamily && proposal.family !== null) ||
      acceptAllergens.size > 0 ||
      (acceptWaste && proposal.defaultWastePct !== null) ||
      (acceptConservation && proposal.conservationType !== null) ||
      (acceptNutrition && proposal.nutrition !== null) ||
      (acceptShelfLife && proposal.shelfLifeDays !== null) ||
      acceptTags.size > 0)

  async function handleApply() {
    if (!proposal) return
    setApplying(true)
    setError(null)
    try {
      const allergens: EnrichAllergen[] = proposal.allergens.filter((a) =>
        acceptAllergens.has(a.code),
      )
      await applyEnrichment(itemId, {
        ...(acceptFamily && proposal.family !== null
          ? { familyId: proposal.family.id }
          : {}),
        ...(allergens.length > 0 ? { allergens } : {}),
        ...(acceptWaste && proposal.defaultWastePct !== null
          ? { defaultWastePct: proposal.defaultWastePct }
          : {}),
        ...(acceptConservation && proposal.conservationType !== null
          ? { conservationType: proposal.conservationType }
          : {}),
        ...(acceptShelfLife && proposal.shelfLifeDays !== null
          ? { shelfLifeDays: proposal.shelfLifeDays }
          : {}),
        ...(acceptTags.size > 0
          ? { menuTags: proposal.menuTags.filter((t) => acceptTags.has(t)) }
          : {}),
        ...(acceptNutrition && proposal.nutrition !== null
          ? { nutrition: proposal.nutrition }
          : {}),
      })
      setOpen(false)
      onApplied?.()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error aplicando los cambios')
    } finally {
      setApplying(false)
    }
  }

  const conf = proposal ? confidenceLabel(proposal.confidence) : null

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={
          className ??
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-base'
        }
      >
        <Sparkles className="w-3.5 h-3.5" />
        Completar con IA
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md bg-card rounded-xl shadow-lg border border-border-default overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent" />
                <span className="text-sm font-semibold text-text-primary">Completar ficha con IA</span>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-text-secondary hover:text-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-4 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {loading && (
                <div className="flex items-center gap-2 text-sm text-text-secondary py-6 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  La IA está analizando el ingrediente…
                </div>
              )}

              {error && (
                <div className="text-xs text-danger bg-danger-bg border border-danger/30 rounded-md p-2">
                  {error}
                </div>
              )}

              {!loading && proposal && (
                <>
                  {conf && (
                    <p className={`text-[11px] ${conf.cls}`}>
                      {conf.text} · revisa y acepta lo que quieras
                    </p>
                  )}

                  {/* Familia → de ella se deriva el IVA y se retira "sin terminar" */}
                  <div>
                    <p className="text-xs font-medium text-text-secondary mb-1.5">Familia e IVA</p>
                    {proposal.family ? (
                      <label className="flex items-start justify-between gap-2 cursor-pointer rounded-md bg-page p-2">
                        <span className="text-xs text-text-primary">
                          Clasificar en <span className="font-medium">{proposal.family.name}</span>
                          <span className="block text-[11px] text-text-secondary mt-0.5">
                            El IVA se deriva de la familia (no lo inventa la IA). Si la ficha
                            queda completa, se retira el aviso «sin terminar».
                          </span>
                        </span>
                        <input
                          type="checkbox"
                          checked={acceptFamily}
                          onChange={(e) => setAcceptFamily(e.target.checked)}
                          className="accent-accent mt-0.5"
                        />
                      </label>
                    ) : (
                      <p className="text-xs text-text-secondary">
                        La IA no ha podido clasificar la familia con seguridad. Asígnala a mano
                        en la ficha (de la familia sale el IVA).
                      </p>
                    )}
                  </div>

                  {/* Alérgenos */}
                  <div>
                    <p className="text-xs font-medium text-text-secondary mb-1.5">Alérgenos</p>
                    {proposal.allergens.length === 0 ? (
                      <p className="text-xs text-text-secondary">La IA no detecta alérgenos en este ingrediente.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {proposal.allergens.map((a) => {
                          const sel = acceptAllergens.has(a.code)
                          return (
                            <button
                              key={a.code}
                              type="button"
                              onClick={() => toggleAllergen(a.code)}
                              className={
                                'text-[11px] px-2.5 py-1 rounded-full border transition-base flex items-center gap-1 ' +
                                (sel
                                  ? 'bg-accent-bg border-accent/40 text-text-primary'
                                  : 'bg-page border-border-default text-text-secondary line-through')
                              }
                            >
                              {sel && <Check className="w-3 h-3 text-accent" />}
                              {allergenLabel(a.code)}
                              <span className="opacity-60">· {STATE_LABEL[a.state] ?? a.state}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Merma */}
                  {proposal.defaultWastePct !== null && (
                    <label className="flex items-center justify-between gap-2 cursor-pointer">
                      <span className="text-xs text-text-primary">
                        Merma por defecto: <span className="font-medium">{proposal.defaultWastePct}%</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={acceptWaste}
                        onChange={(e) => setAcceptWaste(e.target.checked)}
                        className="accent-accent"
                      />
                    </label>
                  )}

                  {/* Conservación */}
                  {proposal.conservationType !== null && (
                    <label className="flex items-center justify-between gap-2 cursor-pointer">
                      <span className="text-xs text-text-primary">
                        Conservación:{' '}
                        <span className="font-medium">
                          {CONSERVATION_LABEL[proposal.conservationType] ?? proposal.conservationType}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={acceptConservation}
                        onChange={(e) => setAcceptConservation(e.target.checked)}
                        className="accent-accent"
                      />
                    </label>
                  )}

                  {/* Vida útil */}
                  {proposal.shelfLifeDays !== null && (
                    <label className="flex items-center justify-between gap-2 cursor-pointer">
                      <span className="text-xs text-text-primary">
                        Vida útil: <span className="font-medium">{proposal.shelfLifeDays} días</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={acceptShelfLife}
                        onChange={(e) => setAcceptShelfLife(e.target.checked)}
                        className="accent-accent"
                      />
                    </label>
                  )}

                  {/* Etiquetas de menú */}
                  {proposal.menuTags.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-text-secondary mb-1.5">Etiquetas de menú</p>
                      <div className="flex flex-wrap gap-1.5">
                        {proposal.menuTags.map((tag) => {
                          const sel = acceptTags.has(tag)
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => toggleTag(tag)}
                              className={
                                'text-[11px] px-2.5 py-1 rounded-full border transition-base flex items-center gap-1 ' +
                                (sel
                                  ? 'bg-accent-bg border-accent/40 text-text-primary'
                                  : 'bg-page border-border-default text-text-secondary line-through')
                              }
                            >
                              {sel && <Check className="w-3 h-3 text-accent" />}
                              {MENU_TAG_LABEL[tag] ?? tag}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Nutrición */}
                  {proposal.nutrition !== null && (
                    <div>
                      <label className="flex items-center justify-between gap-2 cursor-pointer mb-1.5">
                        <span className="text-xs font-medium text-text-secondary">
                          Nutrición <span className="font-normal">(por 100 g, orientativa)</span>
                        </span>
                        <input
                          type="checkbox"
                          checked={acceptNutrition}
                          onChange={(e) => setAcceptNutrition(e.target.checked)}
                          className="accent-accent"
                        />
                      </label>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-text-primary bg-page rounded-md p-2">
                        {NUTRITION_FIELDS.map(({ key, label, unit }) =>
                          proposal.nutrition && proposal.nutrition[key] !== undefined ? (
                            <div key={key} className="flex justify-between">
                              <span className="text-text-secondary">{label}</span>
                              <span className="font-medium">
                                {proposal.nutrition[key]} {unit}
                              </span>
                            </div>
                          ) : null,
                        )}
                      </div>
                    </div>
                  )}

                  <p className="text-[11px] text-text-secondary">
                    La IA propone; tú decides. Lo que aceptes se guarda en la ficha y podrás editarlo.
                  </p>
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={applying}
                className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={!hasAnythingToApply || applying}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-base disabled:opacity-50"
              >
                {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Aplicar seleccionados
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default IngredientAiAssistButton
