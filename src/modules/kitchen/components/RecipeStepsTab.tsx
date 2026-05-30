// src/modules/kitchen/components/RecipeStepsTab.tsx
//
// Solapa "Receta" del editor de escandallos: los PASOS de elaboración.
//
// Tramo E8.3 (UI base): listar, crear, editar, borrar y reordenar pasos, con
// dos modos — VER (lectura, la receta entera de un vistazo, mobile-first) y
// EDITAR (formularios). Por defecto abre en VER si ya hay pasos; en añadir si
// está vacía. SIN inteligencia todavía — el resaltado de ingredientes (E8.4),
// el aviso de faltantes (E8.5), el orden-por-elaboración (E8.6), la foto por
// paso (E8.7) y el borrador IA (E8.8) se construyen ENCIMA en tramos
// posteriores. El Cook Mode a pantalla completa (slideshow de servicio) es un
// tramo aparte (G9), tras E8.4, para que nazca con ingredientes por paso.
//
// Responsive: pensado para TABLET en cocina (caso general, no un cliente
// concreto) y usable en móvil a una mano y en escritorio. Mobile-first.
//
// Diseño: se calcan los tokens del codebase (bg-card, border-border-default,
// text-text-primary/secondary, terracota…) para coherencia con el resto del
// editor. Reordenar = botones ↑/↓ (cero dependencias; el drag se valorará como
// barniz posterior). Edición inline: el cambio vive en estado local y se
// persiste al salir del campo (onBlur), patrón sencillo y robusto.

import { useEffect, useState } from 'react'
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Loader2,
  Clock,
  Thermometer,
  ListOrdered,
  Eye,
  Pencil,
} from 'lucide-react'
import {
  listStepsByRecipe,
  createStep,
  updateStep,
  deleteStep,
  reorderSteps,
} from '@/modules/kitchen/services/recipeStepService'
import type { RecipeItemStep } from '@/types/kitchen'

interface RecipeStepsTabProps {
  recipeItemId: string
}

export default function RecipeStepsTab({ recipeItemId }: RecipeStepsTabProps) {
  const [steps, setSteps] = useState<RecipeItemStep[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // Paso cuyo borrado está pendiente de confirmar (evita perder texto sin querer).
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  // Paso que se está guardando / moviendo (para deshabilitar y dar feedback).
  const [busyId, setBusyId] = useState<string | null>(null)
  // Modo de la solapa: 'view' (lectura) o 'edit' (formularios). El valor por
  // defecto se fija al cargar: 'view' si ya hay pasos, 'edit' si está vacía.
  const [mode, setMode] = useState<'view' | 'edit'>('view')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listStepsByRecipe(recipeItemId)
      .then((rows) => {
        if (cancelled) return
        setSteps(rows)
        // Por defecto: lectura si ya hay pasos, edición si está vacía.
        setMode(rows.length > 0 ? 'view' : 'edit')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error cargando los pasos')
        setSteps([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [recipeItemId])

  // Cambia un campo en el estado local (sin persistir todavía).
  function patchLocal(id: string, patch: Partial<RecipeItemStep>) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  async function handleAddStep() {
    setCreating(true)
    setError(null)
    setMode('edit')
    try {
      const created = await createStep({
        recipeItemId,
        text: '',
        position: steps.length,
      })
      setSteps((prev) => [...prev, created])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo añadir el paso')
    } finally {
      setCreating(false)
    }
  }

  // Persiste el texto del paso al salir del campo.
  async function handleSaveText(step: RecipeItemStep) {
    setBusyId(step.id)
    try {
      await updateStep(step.id, { text: step.text })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el paso')
    } finally {
      setBusyId(null)
    }
  }

  // Persiste duración o temperatura al salir del campo numérico.
  async function handleSaveNumber(
    step: RecipeItemStep,
    field: 'durationMin' | 'temperatureC',
    value: number | null,
  ) {
    setBusyId(step.id)
    try {
      await updateStep(step.id, { [field]: value })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el paso')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id)
    try {
      await deleteStep(id)
      setSteps((prev) => prev.filter((s) => s.id !== id))
      setConfirmDeleteId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar el paso')
    } finally {
      setBusyId(null)
    }
  }

  // Mueve un paso una posición arriba/abajo y persiste el nuevo orden.
  async function handleMove(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= steps.length) return
    const reordered = [...steps]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(target, 0, moved)
    // Reflejar el nuevo orden + posiciones en local de inmediato.
    const withPositions = reordered.map((s, i) => ({ ...s, position: i }))
    setSteps(withPositions)
    try {
      await reorderSteps(withPositions.map((s) => s.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reordenar')
      // Recargar para reflejar el estado real si el reorden falló a medias.
      const fresh = await listStepsByRecipe(recipeItemId).catch(() => null)
      if (fresh) setSteps(fresh)
    }
  }

  if (loading) {
    return (
      <div className="p-4 md:p-5">
        <div className="text-sm text-text-secondary py-8 text-center">
          Cargando pasos…
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-5">
      {/* Cabecera de la solapa */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <ListOrdered className="w-4 h-4 text-terracota shrink-0" />
          <span className="text-sm font-medium text-text-primary">
            Pasos de elaboración
          </span>
          <span className="text-xs text-text-secondary">
            {steps.length === 0
              ? ''
              : `· ${steps.length} paso${steps.length === 1 ? '' : 's'}`}
          </span>
        </div>
        {/* Toggle Ver / Editar (solo si hay pasos que mostrar). */}
        {steps.length > 0 && (
          <div className="inline-flex rounded-md border border-border-default overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => setMode('view')}
              className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 transition-colors ${
                mode === 'view'
                  ? 'bg-terracota text-white'
                  : 'bg-card text-text-secondary hover:text-terracota'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Ver
            </button>
            <button
              type="button"
              onClick={() => setMode('edit')}
              className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 transition-colors ${
                mode === 'edit'
                  ? 'bg-terracota text-white'
                  : 'bg-card text-text-secondary hover:text-terracota'
              }`}
            >
              <Pencil className="w-3.5 h-3.5" />
              Editar
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
          {error}
        </div>
      )}

      {/* Lista vacía */}
      {steps.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-default bg-card p-8 text-center">
          <p className="text-sm text-text-secondary mb-3">
            Aún no hay pasos. Añade el primero para describir cómo se elabora el plato.
          </p>
          <button
            type="button"
            onClick={handleAddStep}
            disabled={creating}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md bg-terracota text-white hover:bg-terracota-hover disabled:opacity-60 transition-base"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Añadir primer paso
          </button>
        </div>
      ) : mode === 'view' ? (
        /* ── Modo VER (lectura): la receta entera, limpia, mobile-first ── */
        <div className="space-y-2.5">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className="rounded-lg border border-border-default bg-card p-3.5 flex gap-3.5"
            >
              <span className="w-7 h-7 rounded-full bg-terracota-bg text-terracota text-sm font-semibold flex items-center justify-center shrink-0">
                {index + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] leading-relaxed text-text-primary whitespace-pre-wrap break-words">
                  {step.text?.trim() ? step.text : <span className="text-text-secondary italic">Paso sin texto</span>}
                </p>
                {(step.durationMin !== null || step.temperatureC !== null) && (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {step.durationMin !== null && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-accent-bg text-text-secondary">
                        <Clock className="w-3.5 h-3.5" />
                        {step.durationMin} min
                      </span>
                    )}
                    {step.temperatureC !== null && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-accent-bg text-text-secondary">
                        <Thermometer className="w-3.5 h-3.5" />
                        {step.temperatureC} °C
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {steps.map((step, index) => {
            const isBusy = busyId === step.id
            return (
              <div
                key={step.id}
                className="rounded-lg border border-border-default bg-card p-3 flex gap-3"
              >
                {/* Número + reordenar */}
                <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                  <span className="w-6 h-6 rounded-full bg-terracota-bg text-terracota text-xs font-medium flex items-center justify-center">
                    {index + 1}
                  </span>
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => handleMove(index, -1)}
                      disabled={index === 0}
                      className="text-text-secondary hover:text-terracota disabled:opacity-30 disabled:hover:text-text-secondary transition-colors"
                      aria-label="Subir paso"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMove(index, 1)}
                      disabled={index === steps.length - 1}
                      className="text-text-secondary hover:text-terracota disabled:opacity-30 disabled:hover:text-text-secondary transition-colors"
                      aria-label="Bajar paso"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Cuerpo: texto + tiempo/temperatura */}
                <div className="flex-1 min-w-0">
                  <textarea
                    value={step.text}
                    onChange={(e) => patchLocal(step.id, { text: e.target.value })}
                    onBlur={() => handleSaveText(step)}
                    rows={2}
                    placeholder="Describe este paso…"
                    className="w-full px-2.5 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent resize-y"
                  />
                  <div className="flex items-center gap-4 mt-2 flex-wrap">
                    <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
                      <Clock className="w-3.5 h-3.5" />
                      <input
                        type="number"
                        min={0}
                        value={step.durationMin ?? ''}
                        onChange={(e) =>
                          patchLocal(step.id, {
                            durationMin: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                        onBlur={() => handleSaveNumber(step, 'durationMin', step.durationMin)}
                        placeholder="min"
                        className="w-16 px-1.5 py-1 text-xs border border-border-default rounded bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      min
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
                      <Thermometer className="w-3.5 h-3.5" />
                      <input
                        type="number"
                        value={step.temperatureC ?? ''}
                        onChange={(e) =>
                          patchLocal(step.id, {
                            temperatureC: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                        onBlur={() => handleSaveNumber(step, 'temperatureC', step.temperatureC)}
                        placeholder="°C"
                        className="w-16 px-1.5 py-1 text-xs border border-border-default rounded bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      °C
                    </label>
                    {isBusy && (
                      <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Guardando…
                      </span>
                    )}
                  </div>
                </div>

                {/* Borrar (con confirmación inline) */}
                <div className="shrink-0">
                  {confirmDeleteId === step.id ? (
                    <div className="flex flex-col items-end gap-1">
                      <button
                        type="button"
                        onClick={() => handleDelete(step.id)}
                        disabled={isBusy}
                        className="text-xs font-medium px-2 py-1 rounded-md bg-danger text-white hover:opacity-90 disabled:opacity-60 transition-base"
                      >
                        Borrar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-xs text-text-secondary hover:text-text-primary transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(step.id)}
                      className="text-text-secondary hover:text-danger transition-colors"
                      aria-label="Borrar paso"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {/* Añadir paso al final */}
          <button
            type="button"
            onClick={handleAddStep}
            disabled={creating}
            className="w-full inline-flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md border border-dashed border-border-default text-terracota hover:bg-terracota-bg disabled:opacity-60 transition-base"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Añadir paso
          </button>
        </div>
      )}
    </div>
  )
}
