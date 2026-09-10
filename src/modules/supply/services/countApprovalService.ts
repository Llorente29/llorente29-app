// src/modules/supply/services/countApprovalService.ts
//
// LA PANTALLA 4: «Revisa antes de aprobar» (§2.4 del encargo del 10/09/2026).
//
// Reparte las líneas de un recuento en DOS grupos y, para las del primero,
// arma la frase que explica por qué hay que mirarlas.
//
// REGLA 7 · EL UMBRAL ORDENA, NO ESCONDE. Esta pantalla se abre a propósito,
// así que las 36 líneas están las 36. El umbral (25 % Y 5 €) decide en qué
// grupo cae cada una y en qué orden salen, nunca si existen. Por eso el botón
// dice «Aprobar los 30 que cuadran» y no «Aprobar»: el número es la promesa de
// que los 30 están ahí y se pueden mirar.
//
// LO QUE NO SE SABE, SE DICE. Una línea sin coste fiable no vale 0 €: vale
// «sin coste», y así sale. La franja de valor suma lo que se puede sumar y
// dice aparte cuántas quedan fuera — que es lo contrario de lo que hacía el
// `COALESCE(avg_unit_cost, 0)` de antes.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import type { InventoryCountLine } from '@/modules/supply/services/inventoryCountService'
import {
  listEntriesByCount, describirEntradas, esAOjo, type CountEntry,
} from '@/modules/supply/services/countEntryService'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
}

type Row = Record<string, unknown>

/** Umbrales de la pantalla. Salen de `supply_settings`, no del código. */
export interface CountReviewThresholds {
  reviewPct: number
  reviewEur: number
  contradictionPct: number
}

export const UMBRALES_POR_DEFECTO: CountReviewThresholds = {
  reviewPct: 25, reviewEur: 5, contradictionPct: 40,
}

export async function getCountReviewThresholds(accountId: string): Promise<CountReviewThresholds> {
  requireSupabase()
  const { data, error } = await (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  })
    .from('supply_settings')
    .select('count_review_pct, count_review_eur, count_contradiction_pct')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw new Error(`No se pudieron leer los umbrales: ${error.message}`)
  const r = (data as Row | null) ?? {}
  return {
    reviewPct: Number(r.count_review_pct ?? UMBRALES_POR_DEFECTO.reviewPct),
    reviewEur: Number(r.count_review_eur ?? UMBRALES_POR_DEFECTO.reviewEur),
    contradictionPct: Number(r.count_contradiction_pct ?? UMBRALES_POR_DEFECTO.contradictionPct),
  }
}

/** Los hechos del recuento anterior. Salen de `count_review_context`. */
export interface PrevContext {
  prevQty: number | null
  prevCountedAt: string | null
  prevByName: string | null
  movedSince: number
  receivedSince: number
  soldSince: number
}

export async function getReviewContext(countId: string): Promise<Map<string, PrevContext>> {
  requireSupabase()
  const { data, error } = await (supabase! as unknown as {
    rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  }).rpc('count_review_context', { p_count_id: countId })
  if (error) throw new Error(`No se pudo cargar el contexto: ${error.message}`)
  const out = new Map<string, PrevContext>()
  for (const r of ((data as Row[] | null) ?? [])) {
    out.set(r.line_id as string, {
      prevQty: r.prev_qty == null ? null : Number(r.prev_qty),
      prevCountedAt: (r.prev_counted_at as string | null) ?? null,
      prevByName: (r.prev_by_name as string | null) ?? null,
      movedSince: Number(r.moved_since ?? 0),
      receivedSince: Number(r.received_since ?? 0),
      soldSince: Number(r.sold_since ?? 0),
    })
  }
  return out
}

export type MotivoRevision =
  'desviacion' | 'needs_review' | 'contradiccion' | 'a_ojo' | 'sin_referencia'

export interface ReviewLine {
  line: InventoryCountLine
  entries: CountEntry[]
  /** «2 bolsas de 2,5 kg + 750 g pesados». */
  howCounted: string
  estimated: boolean
  prev: PrevContext | null
  /** Por qué está en «Revisa antes de aprobar». Vacío = cuadra. */
  reasons: MotivoRevision[]
  /** La frase de la contradicción, con nombres y fecha. Vacía si no contradice. */
  contradiction: string
}

export interface CountReview {
  toReview: ReviewLine[]
  ok: ReviewLine[]
  /** Las cuatro cifras de la franja. */
  counts: {
    ok: number
    toReview: number
    contradictions: number
    /** € a coste fiable de lo que hay que revisar. */
    reviewValue: number
    /** Cuántas de esas líneas NO se pueden valorar. Se dice, no se esconde. */
    reviewWithoutCost: number
  }
}

const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 })

// Espacio de NO SEPARACIÓN entre la cifra y su unidad: «750 g» no se parte.
function qtyTxt(v: number, unit: string | null): string {
  const u = (unit ?? '').toLowerCase()
  if (u === 'g' && Math.abs(v) >= 1000) return `${nf.format(v / 1000)}\u00A0kg`
  if (u === 'ml' && Math.abs(v) >= 1000) return `${nf.format(v / 1000)}\u00A0l`
  return `${nf.format(v)}${unit ? `\u00A0${unit}` : ''}`
}

function fechaCorta(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `el ${dd}/${mm} a las ${hh}:${mi}`
}

/**
 * ¿Contradice al recuento anterior? Y si sí, en qué palabras.
 *
 * Se exporta suelta para poder probarla contra las líneas REALES de los
 * recuentos de septiembre y no contra ejemplos inventados (regla 31): fue
 * escribiendo esta frase donde se vio que «no ha entrado peperoni» sólo se
 * puede afirmar si `receivedSince` es cero, no si `movedSince` es negativo.
 */
export function explicarContradiccion(
  line: InventoryCountLine,
  prev: PrevContext | null,
  umbralPct: number,
): string {
  if (!prev || prev.prevQty == null || prev.prevCountedAt == null) return ''
  if (line.countedQty == null) return ''
  // Con mercancía entrada de por medio, apartarse del recuento anterior tiene
  // una explicación conocida: no es contradicción.
  if (prev.receivedSince > 0) return ''
  const esperado = prev.prevQty + prev.movedSince
  if (esperado <= 0) return ''
  const desvio = Math.abs(line.countedQty - esperado) / esperado * 100
  if (desvio < umbralPct) return ''

  const u = line.unitAbbr
  const quien = prev.prevByName ?? 'Alguien'
  const producto = line.itemName.toLowerCase()
  const vendido = prev.soldSince > 0
    ? `se han vendido ${qtyTxt(prev.soldSince, u)}`
    : 'no se ha vendido nada'
  return `${quien} contó ${qtyTxt(prev.prevQty, u)} ${fechaCorta(prev.prevCountedAt)}. ` +
    `Desde entonces no ha entrado ${producto} y ${vendido}.`
}

/**
 * El reparto en dos grupos.
 *
 * Una línea va a revisar si CUALQUIERA de estas cuatro cosas es cierta:
 *   · se desvía ≥ 25 % Y ≥ 5 € a coste fiable — los dos ejes, no uno;
 *   · viene marcada `needs_review` (se contó dos veces y sigue sin cuadrar);
 *   · contradice al recuento anterior sin recepciones de por medio;
 *   · lleva algo estimado a ojo Y se desvía.
 *
 * Lo de «Y se desvía» en la última no es un descuido: media bolsa a ojo que
 * cuadra con lo esperado no le hace perder el tiempo a nadie. Sale marcada
 * «A ojo» en su grupo, que es distinto de esconderla.
 */
export async function buildCountReview(
  countId: string,
  lines: InventoryCountLine[],
  th: CountReviewThresholds,
): Promise<CountReview> {
  const [entriesByLine, ctx] = await Promise.all([
    listEntriesByCount(countId).catch(() => new Map<string, CountEntry[]>()),
    getReviewContext(countId).catch(() => new Map<string, PrevContext>()),
  ])

  const todas: ReviewLine[] = lines
    .filter(l => l.countedQty !== null)
    .map(l => {
      const entries = entriesByLine.get(l.id) ?? []
      const prev = ctx.get(l.id) ?? null
      const estimated = esAOjo(entries)
      const contradiction = explicarContradiccion(l, prev, th.contradictionPct)

      const pct = Math.abs(l.variancePct ?? 0)
      const eur = l.varianceValue == null ? null : Math.abs(l.varianceValue)
      const desviacionGrande = pct >= th.reviewPct && eur != null && eur >= th.reviewEur

      const reasons: MotivoRevision[] = []
      if (desviacionGrande) reasons.push('desviacion')
      if (l.lineNeedsReview) reasons.push('needs_review')
      // FOLVY NO TENÍA REFERENCIA. La marca la pone el servidor cuando ni el
      // teórico vivo ni el último recuento aprobado eran positivos, así que
      // ninguno de los dos frenos pudo mirar la línea (Humus a −355 g).
      //
      // Va al grupo de revisar SALVO que se haya contado cero: si Folvy no
      // sabía qué esperar y la persona dice que no queda nada, no hay nada
      // que revisar. La ETIQUETA sale igual en los dos grupos —eso es la
      // regla 7: el umbral decide el orden, nunca la existencia de la fila.
      if (l.lineNoReference && l.countedQty !== 0) reasons.push('sin_referencia')
      if (contradiction) reasons.push('contradiccion')
      if (estimated && pct >= th.reviewPct) reasons.push('a_ojo')

      return {
        line: l,
        entries,
        howCounted: describirEntradas(entries, l.unitAbbr),
        estimated,
        prev,
        reasons,
        contradiction,
      }
    })

  const toReview = todas.filter(r => r.reasons.length > 0)
  const ok = todas.filter(r => r.reasons.length === 0)

  // Ordenado por valor, como pide la maqueta. Las que no se pueden valorar van
  // arriba, no abajo: «no sé lo que vale» merece más atención que «vale poco».
  toReview.sort((a, b) => {
    const va = a.line.varianceValue
    const vb = b.line.varianceValue
    if (va == null && vb == null) return 0
    if (va == null) return -1
    if (vb == null) return 1
    return Math.abs(vb) - Math.abs(va)
  })

  return {
    toReview,
    ok,
    counts: {
      ok: ok.length,
      toReview: toReview.length,
      contradictions: todas.filter(r => r.contradiction !== '').length,
      reviewValue: toReview.reduce((s, r) => s + (r.line.varianceValue ?? 0), 0),
      reviewWithoutCost: toReview.filter(r => r.line.varianceValue == null).length,
    },
  }
}

/** Los motivos, en palabras de cocina. El orden es el de la maqueta. */
export const MOTIVOS_DE_COCINA: { value: string; label: string; pideNota?: boolean }[] = [
  { value: 'merma',            label: 'Merma · se tiró' },
  { value: 'caducado',         label: 'Caducado' },
  { value: 'rotura',           label: 'Roto' },
  { value: 'uso_sin_apuntar',  label: 'Se usó sin apuntar' },
  { value: 'traspaso',         label: 'Se llevó a otro local' },
  { value: 'error_recepcion',  label: 'No se apuntó una entrega' },
  { value: 'error_conteo',     label: 'Se contó mal' },
  { value: 'robo_desconocido', label: 'Falta y no se sabe por qué' },
  { value: 'error_escandallo', label: 'La receta consume distinto' },
  { value: 'otro',             label: 'Otro', pideNota: true },
]

export function motivoPideNota(value: string | null): boolean {
  return value === 'otro'
}

/** Guarda motivo y nota juntos: «otro» sin nota no se puede guardar (§2.4). */
export async function saveReason(
  lineId: string,
  reasonCode: string | null,
  reasonNote: string | null,
): Promise<void> {
  requireSupabase()
  if (motivoPideNota(reasonCode) && !(reasonNote ?? '').trim()) {
    throw new Error('«Otro» necesita una nota que diga qué ha pasado. Sin ella, «otro» no dice nada.')
  }
  const { error } = await (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  })
    .from('inventory_count_line')
    .update({ reason_code: reasonCode, reason_note: reasonCode ? reasonNote : null })
    .eq('id', lineId)
  if (error) throw new Error(`No se pudo guardar el motivo: ${error.message}`)
}
