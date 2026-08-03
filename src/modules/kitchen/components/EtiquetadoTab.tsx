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
//    todavía. Es un estado SOLO-UI (ausencia de entrada en `values`). Al
//    guardar (saveManualAllergenOverrides, Capa 2) solo viajan los códigos
//    que la persona tocó de verdad esta sesión — si uno de ellos queda sin
//    entrada, se BORRA de recipe_item_allergen; los códigos NO tocados
//    (típicamente heredados) ni se leen ni se tocan.
//  · 'unknown' = SÍ hay fila real (source='manual'), y esa fila dice
//    explícitamente "alguien lo miró y no pudo determinarlo". Es uno de los 4
//    estados reales del CHECK de BBDD, seleccionable a propósito.
// La UI distingue visualmente ambos: "Sin declarar" se pinta neutro con
// borde discontinuo (ausencia de dato), 'unknown' se pinta con relleno sólido
// gris (declaración real, solo que sin certeza) — nunca se confunden entre sí
// ni con los 3 estados con color (contains/may_contain/free).

import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Save, Sparkles } from 'lucide-react'
import {
  listItemAllergens,
  saveManualAllergenOverrides,
} from '@/modules/kitchen/services/recipeItemAllergenService'
import { getRecipeBreakdown } from '@/modules/kitchen/services/recipeLineService'
import { cascadeAllergensFromItem } from '@/modules/kitchen/services/allergenCascadeService'
import { streamMessage } from '@/modules/folvy-ai/services/folvyAIService'
import {
  EU_ALLERGENS,
  ALLERGEN_CODES,
  ALLERGEN_STATES,
  allergenLabel,
  allergenStateLabel,
  isAllergenCode,
  type AllergenCode,
  type AllergenState,
} from '@/modules/kitchen/lib/allergens'

// Pista informativa "según sus ingredientes" (decisión de Julio, 04/08 —
// barata, NO es la herencia automática de Capa 2): para cada alérgeno, qué
// ingredientes de ESTE escandallo lo declaran contains/may_contain en su
// propia ficha (recipe_item_allergen de cada ingrediente, mismo servicio,
// reutilizado sin cambios). Es solo lectura — nunca escribe, nunca cambia el
// estado del PLATO — el motor de propagación real sigue siendo Capa 2.
interface IngredientHint { name: string; state: 'contains' | 'may_contain' }

interface Props {
  recipeItemId: string
  /** Necesario para A3 ("Verificar con IA") — streamMessage requiere accountId. */
  accountId: string
}

// De dónde viene el valor mostrado — visible junto a cada chip (encargo de
// Julio, 06/08: "que se vea en pantalla de dónde viene cada valor" — antes
// los 14 se veían iguales y por eso el bug de fill-only era invisible: no
// había forma de distinguir a simple vista un heredado de un manual).
const SOURCE_LABEL: Record<string, string> = {
  inherited: 'Heredado',
  manual: 'Manual',
  ai_enrich: 'IA sin confirmar',
  automatic: 'Automático',
}
function sourceLabel(source: string | undefined): string | null {
  if (!source) return null
  return SOURCE_LABEL[source] ?? source
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

export default function EtiquetadoTab({ recipeItemId, accountId }: Props) {
  const [values, setValues] = useState<Map<AllergenCode, AllergenState>>(new Map())
  // De dónde viene CADA valor cargado (inherited/manual/ai_enrich/automatic)
  // — solo informativo, nunca se manda al guardar. Se actualiza en el acto
  // a 'manual' cuando la persona toca un código (handleChange): es lo que
  // ese código VA a ser en cuanto se guarde, honesto de inmediato.
  const [sources, setSources] = useState<Map<AllergenCode, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [ingredientHints, setIngredientHints] = useState<Map<AllergenCode, IngredientHint[]>>(new Map())
  // Códigos que la persona tocó de verdad en ESTA sesión — es lo ÚNICO que
  // se manda a guardar (saveManualAllergenOverrides), nunca los 14. Fix del
  // bug de fill-only: mandar el Map completo pisaba de source='inherited' a
  // 'manual' los códigos que la persona nunca tocó.
  const [touchedCodes, setTouchedCodes] = useState<Set<AllergenCode>>(new Set())

  // ── A3: "Verificar con IA" (cableado real, Fase 6) — DISTINTO de la pista
  // "según sus ingredientes" de arriba (esa es agregado fijo, solo lectura).
  // Aquí se pide a la IA una sugerencia completa por alérgeno según los
  // nombres de los ingredientes del escandallo, y se aplica "fill-only" sobre
  // `values`: solo rellena códigos SIN declaración todavía (ausentes del
  // Map) — nunca pisa una fila ya declarada/guardada, sea manual o de una
  // sesión anterior. `aiPendingCodes` marca qué filas son sugerencia IA
  // pendiente de confirmar (visualmente distintas) — el usuario tiene que
  // pulsar "Guardar alérgenos" para persistirlas, igual que las mermas.
  const [aiChecking, setAiChecking] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiPendingCodes, setAiPendingCodes] = useState<Set<AllergenCode>>(new Set())

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSuccess(false)
    setTouchedCodes(new Set())
    listItemAllergens(recipeItemId)
      .then((rows) => {
        if (cancelled) return
        const m = new Map<AllergenCode, AllergenState>()
        const s = new Map<AllergenCode, string>()
        for (const r of rows) {
          m.set(r.code, r.state)
          if (r.source) s.set(r.code, r.source)
        }
        setValues(m)
        setSources(s)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Error cargando alérgenos.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [recipeItemId])

  // Pista "según sus ingredientes" — carga las líneas del escandallo y, para
  // cada ingrediente (childType != 'recipe': las sub-recetas quedan fuera de
  // esta pista barata), lee sus propios alérgenos declarados. Solo lectura,
  // no bloquea ni retrasa el editor del plato (loading/error independientes).
  useEffect(() => {
    let cancelled = false
    getRecipeBreakdown(recipeItemId)
      .then(async (lines) => {
        if (cancelled) return
        const children = new Map<string, string>()
        for (const l of lines) {
          if (l.childType === 'recipe') continue
          if (!children.has(l.childItemId)) children.set(l.childItemId, l.childName)
        }
        const entries = Array.from(children.entries())
        const rowsPerChild = await Promise.all(
          entries.map(([childId]) => listItemAllergens(childId).catch(() => []))
        )
        if (cancelled) return
        const hints = new Map<AllergenCode, IngredientHint[]>()
        entries.forEach(([, name], i) => {
          for (const row of rowsPerChild[i]) {
            if (row.state !== 'contains' && row.state !== 'may_contain') continue
            const list = hints.get(row.code) ?? []
            list.push({ name, state: row.state })
            hints.set(row.code, list)
          }
        })
        setIngredientHints(hints)
      })
      .catch(() => { if (!cancelled) setIngredientHints(new Map()) })
    return () => { cancelled = true }
  }, [recipeItemId])

  function handleChange(code: AllergenCode, raw: string) {
    setSuccess(false)
    // El usuario toma el control manual de esta fila — deja de estar
    // "pendiente de confirmar IA" aunque la hubiera sugerido la IA.
    setAiPendingCodes((prev) => {
      if (!prev.has(code)) return prev
      const next = new Set(prev)
      next.delete(code)
      return next
    })
    setValues((prev) => {
      const next = new Map(prev)
      if (raw === '') next.delete(code) // "Sin declarar" — vuelve a ausencia de dato.
      else next.set(code, raw as AllergenState)
      return next
    })
    // La persona tocó este código: se guardará como manual, y se enseña ya
    // como tal (honesto de inmediato, no solo tras guardar).
    setSources((prev) => {
      const next = new Map(prev)
      if (raw === '') next.delete(code)
      else next.set(code, 'manual')
      return next
    })
    setTouchedCodes((prev) => {
      const next = new Set(prev)
      next.add(code)
      return next
    })
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      // SOLO los códigos que la persona tocó de verdad (handleChange) o que
      // aceptó de una sugerencia de IA pendiente — nunca los 14. Fix del bug
      // de fill-only: mandar todo el Map (como antes) pisaba a 'manual' los
      // códigos heredados que nadie tocó, y el motor de Capa 2 dejaba de
      // tocarlos para siempre (el fill-only protege 'manual', ese es el
      // punto — el bug era disparar esa protección sin querer).
      const codesToSave = new Set<AllergenCode>([...touchedCodes, ...aiPendingCodes])
      if (codesToSave.size === 0) {
        setSuccess(true)
        return
      }
      const changes = Array.from(codesToSave).map((code) => ({
        code,
        state: values.get(code) ?? null,
      }))
      await saveManualAllergenOverrides(recipeItemId, changes)
      setSuccess(true)
      setSources((prev) => {
        const next = new Map(prev)
        for (const code of codesToSave) {
          if (values.has(code)) next.set(code, 'manual')
          else next.delete(code)
        }
        return next
      })
      setTouchedCodes(new Set())
      // Ya persistidas: dejan de ser "sugerencia pendiente".
      setAiPendingCodes(new Set())
      // Este plato puede ser a su vez sub-receta de otro — best-effort, no
      // bloquea el guardado si falla.
      cascadeAllergensFromItem(recipeItemId).catch((e) =>
        console.error('EtiquetadoTab: cascada de alérgenos tras guardar falló', e)
      )
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudieron guardar los alérgenos.')
    } finally {
      setSaving(false)
    }
  }

  // Aplica el resultado de la IA sobre `values` en modo "fill-only": solo los
  // códigos SIN entrada previa en el Map (ni guardados ni ya editados en esta
  // sesión) se rellenan, y quedan marcados en `aiPendingCodes`. Nunca
  // sobrescribe una declaración humana existente.
  function applyAiResult(raw: string) {
    let arr: Array<{ alergeno_code?: unknown; estado?: unknown }> = []
    try {
      const m = raw.match(/\[[\s\S]*\]/)
      arr = m ? JSON.parse(m[0]) : []
    } catch {
      setAiError('La IA no devolvió un formato válido. Declara los alérgenos a mano.')
      return
    }
    const filled = new Set<AllergenCode>()
    setValues((prev) => {
      const next = new Map(prev)
      for (const it of arr) {
        const code = it.alergeno_code
        const state = it.estado
        if (typeof code !== 'string' || !isAllergenCode(code)) continue
        if (next.has(code)) continue // fill-only: nunca pisa una declaración existente
        if (state !== 'contains' && state !== 'may_contain' && state !== 'free' && state !== 'unknown') continue
        next.set(code, state)
        filled.add(code)
      }
      return next
    })
    if (filled.size === 0) {
      setAiError('La IA no aportó alérgenos nuevos (los ya declarados no se tocan).')
    } else {
      setAiPendingCodes((prev) => new Set([...prev, ...filled]))
    }
  }

  async function verifyAllergensAI() {
    if (aiChecking) return
    setAiError(null)
    setAiChecking(true)
    try {
      const lines = await getRecipeBreakdown(recipeItemId)
      const names = Array.from(
        new Set(lines.filter((l) => l.childType !== 'recipe').map((l) => l.childName)),
      )
      if (names.length === 0) {
        setAiError('Este escandallo no tiene ingredientes que analizar.')
        setAiChecking(false)
        return
      }
      let acc = ''
      await streamMessage(
        {
          accountId,
          surface: 'background',
          message:
            `Estos son los ingredientes de un plato: ${JSON.stringify(names)}. ` +
            `Evalúa cada uno de los 14 alérgenos de declaración obligatoria del ` +
            `Reglamento UE 1169/2011 (códigos: ${JSON.stringify(ALLERGEN_CODES)}). ` +
            `Responde SOLO un JSON array con los 14 códigos, formato ` +
            `[{"alergeno_code","estado"}], donde "estado" es exactamente uno de ` +
            `"contains", "may_contain", "free" o "unknown". Usa "unknown" si no ` +
            `puedes determinarlo con certeza a partir de los nombres. Sin texto adicional.`,
          history: [],
        },
        (evt) => {
          if (evt.type === 'text') {
            acc += evt.content
          } else if (evt.type === 'done' || evt.type === 'partial_end') {
            applyAiResult(acc)
          } else if (evt.type === 'error') {
            setAiError('No se pudo consultar a la IA. Declara los alérgenos a mano.')
          }
        },
      )
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : 'No se pudo consultar a la IA.')
    } finally {
      setAiChecking(false)
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
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <AlertTriangle className="w-4 h-4 text-text-secondary mt-0.5 flex-shrink-0" />
          <p className="text-xs text-text-secondary">
            Declaración de los 14 alérgenos de declaración obligatoria (Reglamento UE 1169/2011).
            Esta es la información que verán tickets, KDS y los canales de venta — marca cada uno
            solo con la certeza real del ingrediente, y usa "Sin determinar" si no lo sabes.
          </p>
        </div>
        {/* A3: DISTINTO de la pista "según sus ingredientes" (fija, siempre
            visible bajo cada alérgeno) — esto es una consulta puntual a la IA
            que solo rellena huecos ("Sin declarar"), nunca pisa lo ya
            declarado. El resultado queda marcado como pendiente hasta
            "Guardar alérgenos". */}
        <button
          type="button"
          onClick={verifyAllergensAI}
          disabled={aiChecking || saving}
          title="Sugiere, según los ingredientes del escandallo, los alérgenos que aún están «Sin declarar». Nunca cambia una declaración ya guardada — revisa y confirma antes de guardar."
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-medium border border-accent/30 text-accent bg-card hover:bg-accent-bg disabled:opacity-50 transition-colors shrink-0"
        >
          {aiChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {aiChecking ? 'Consultando IA…' : 'Verificar con IA'}
        </button>
      </div>

      {error && <div className="p-2.5 rounded-lg bg-danger-bg text-danger text-xs">{error}</div>}
      {aiError && <div className="p-2.5 rounded-lg bg-warning-bg text-warning text-xs">{aiError}</div>}
      {success && (
        <div className="p-2.5 rounded-lg bg-success-bg text-success text-xs">Alérgenos guardados.</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {EU_ALLERGENS.map((a) => {
          const current = values.get(a.code) ?? null
          const aiPending = aiPendingCodes.has(a.code)
          const hints = ingredientHints.get(a.code) ?? []
          const containsNames = hints.filter((h) => h.state === 'contains').map((h) => h.name)
          const mayContainNames = hints.filter((h) => h.state === 'may_contain').map((h) => h.name)
          return (
            <div
              key={a.code}
              className={
                'flex flex-col gap-1 px-3 py-2 rounded-lg border ' +
                (aiPending
                  ? 'border-accent bg-accent-bg ring-1 ring-accent/40'
                  : current ? 'border-border-default bg-card' : 'border-dashed border-border-default bg-page')
              }
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm text-text-primary font-medium truncate">{allergenLabel(a.code)}</div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className={'inline-block text-[11px] px-2 py-0.5 rounded-full font-medium ' + stateTone(current)}>
                      {current ? allergenStateLabel(current) : 'Sin declarar'}
                    </span>
                    {aiPending ? (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-accent text-text-on-accent font-medium">
                        <Sparkles size={10} /> IA sugiere, sin guardar
                      </span>
                    ) : current && sourceLabel(sources.get(a.code)) ? (
                      <span
                        className="text-[10px] text-text-tertiary"
                        title="De dónde viene este valor — heredado se recalcula solo al cambiar el escandallo, manual nunca se toca."
                      >
                        {sourceLabel(sources.get(a.code))}
                      </span>
                    ) : null}
                  </div>
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
              {/* Pista "según sus ingredientes" — solo informativa, nunca
                  cambia el estado del plato de arriba. Capa 2 (fuera de
                  alcance) sería aplicar esto automáticamente; aquí solo se
                  enseña, decide la persona. */}
              {(containsNames.length > 0 || mayContainNames.length > 0) && (
                <p className="text-[10px] text-text-secondary italic leading-snug">
                  según sus ingredientes:{' '}
                  {containsNames.length > 0 && <>contiene — {containsNames.join(', ')}</>}
                  {containsNames.length > 0 && mayContainNames.length > 0 && ' · '}
                  {mayContainNames.length > 0 && <>puede contener — {mayContainNames.join(', ')}</>}
                </p>
              )}
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
