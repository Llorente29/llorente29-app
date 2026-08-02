// src/modules/kitchen/components/EtiquetadoTab.tsx
//
// Pestaña "Etiquetado" de la ficha unificada — recipe_item-scoped (el
// escandallo declara sus alérgenos, no el producto de venta que lo casa).
//
// NO es una extracción: sustituye la sección S5 de CatalogProductDetailPage
// (id="s-alergenos"), que mostraba los 14 alérgenos UE como "no" para TODOS
// los platos siempre, sin mirar ningún dato real (riesgo Reglamento UE
// 1169/2011). Aquí se lee/escribe la fuente real: recipe_item_allergen, vía
// el servicio ya existente recipeItemAllergenService.ts.
//
// Regla de oro de esta pantalla (nunca romperla): los 14 EU_ALLERGENS se
// muestran SIEMPRE los 14, nunca una lista parcial de "solo los declarados"
// — eso sería la misma mentira de antes con menos texto. Cada uno muestra su
// estado real si hay fila en recipe_item_allergen, o "Sin declarar" si no la
// hay. Ningún alérgeno puede leerse como 'free' (libre de) sin una fila real
// que lo respalde: el valor por defecto de un código sin fila es la AUSENCIA
// en el Map de abajo, nunca 'free'.
//
// Decisión de diseño "Sin declarar" vs 'unknown' (documentada, ver plan):
// son DOS conceptos distintos, no un alias del mismo estado.
//  · "Sin declarar" = no existe fila en BBDD — nadie ha mirado este alérgeno
//    todavía. Es un estado SOLO-UI (ausencia de entrada en `values`), nunca
//    se envía a saveItemAllergens — al guardar, los códigos sin entrada se
//    BORRAN de recipe_item_allergen (si tenían fila previa) o simplemente no
//    se crean.
//  · 'unknown' = SÍ hay fila real (source='manual'), y esa fila dice
//    explícitamente "alguien lo miró y no pudo determinarlo". Es uno de los 4
//    estados reales del CHECK de BBDD, seleccionable a propósito.
// La UI distingue visualmente ambos: "Sin declarar" se pinta neutro con
// borde discontinuo (ausencia de dato), 'unknown' se pinta con relleno sólido
// gris (declaración real, solo que sin certeza) — nunca se confunden entre sí
// ni con los 3 estados con color (contains/may_contain/free).

import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Save } from 'lucide-react'
import {
  listItemAllergens,
  saveItemAllergens,
} from '@/modules/kitchen/services/recipeItemAllergenService'
import {
  EU_ALLERGENS,
  ALLERGEN_STATES,
  allergenLabel,
  allergenStateLabel,
  type AllergenCode,
  type AllergenState,
} from '@/modules/kitchen/lib/allergens'

interface Props {
  recipeItemId: string
}

/** Clases de tono por estado — 'null' (sin fila) es su propio tono, distinto de 'unknown'. */
function stateTone(state: AllergenState | null): string {
  if (state === 'free') return 'bg-success-bg text-success'
  if (state === 'may_contain') return 'bg-warning-bg text-warning'
  if (state === 'contains') return 'bg-danger-bg text-danger'
  if (state === 'unknown') return 'bg-accent-bg text-text-secondary'
  // Sin fila en BBDD: "Sin declarar". Nunca se lee como 'free'.
  return 'bg-page text-text-secondary border border-dashed border-border-default italic'
}

export default function EtiquetadoTab({ recipeItemId }: Props) {
  const [values, setValues] = useState<Map<AllergenCode, AllergenState>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSuccess(false)
    listItemAllergens(recipeItemId)
      .then((rows) => {
        if (cancelled) return
        const m = new Map<AllergenCode, AllergenState>()
        for (const r of rows) m.set(r.code, r.state)
        setValues(m)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Error cargando alérgenos.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [recipeItemId])

  function handleChange(code: AllergenCode, raw: string) {
    setSuccess(false)
    setValues((prev) => {
      const next = new Map(prev)
      if (raw === '') next.delete(code) // "Sin declarar" — vuelve a ausencia de dato.
      else next.set(code, raw as AllergenState)
      return next
    })
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const payload = Array.from(values.entries()).map(([code, state]) => ({ code, state }))
      await saveItemAllergens(recipeItemId, payload)
      setSuccess(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudieron guardar los alérgenos.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 md:p-5 flex items-center gap-2 text-sm text-text-secondary">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando alérgenos…
      </div>
    )
  }

  return (
    <div className="p-4 md:p-5 space-y-5">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-text-secondary mt-0.5 flex-shrink-0" />
        <p className="text-xs text-text-secondary">
          Declaración de los 14 alérgenos de declaración obligatoria (Reglamento UE 1169/2011).
          Esta es la información que verán tickets, KDS y los canales de venta — marca cada uno
          solo con la certeza real del ingrediente, y usa "Sin determinar" si no lo sabes.
        </p>
      </div>

      {error && <div className="p-2.5 rounded-lg bg-danger-bg text-danger text-xs">{error}</div>}
      {success && (
        <div className="p-2.5 rounded-lg bg-success-bg text-success text-xs">Alérgenos guardados.</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {EU_ALLERGENS.map((a) => {
          const current = values.get(a.code) ?? null
          return (
            <div
              key={a.code}
              className={
                'flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ' +
                (current ? 'border-border-default bg-card' : 'border-dashed border-border-default bg-page')
              }
            >
              <div className="min-w-0">
                <div className="text-sm text-text-primary font-medium truncate">{allergenLabel(a.code)}</div>
                <span className={'inline-block mt-0.5 text-[11px] px-2 py-0.5 rounded-full font-medium ' + stateTone(current)}>
                  {current ? allergenStateLabel(current) : 'Sin declarar'}
                </span>
              </div>
              <select
                value={current ?? ''}
                disabled={saving}
                onChange={(e) => handleChange(a.code, e.target.value)}
                className="text-xs border border-border-default rounded-md bg-card text-text-primary px-1.5 py-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent flex-shrink-0"
              >
                <option value="">Sin declarar</option>
                {ALLERGEN_STATES.map((s) => (
                  <option key={s} value={s}>{allergenStateLabel(s)}</option>
                ))}
              </select>
            </div>
          )
        })}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-lg font-medium bg-terracota text-white hover:bg-terracota-hover disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? 'Guardando…' : 'Guardar alérgenos'}
        </button>
      </div>
    </div>
  )
}
