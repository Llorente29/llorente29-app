// src/modules/supply/services/countEntryService.ts
//
// LA ÚNICA PUERTA DE ESCRITURA DE UN CONTEO (§2.2 del encargo del 10/09/2026).
//
// Aquí no se multiplica nada. El móvil manda CÓMO se contó —dos bolsas, 750 g,
// media bolsa a ojo— y `save_count_line` (SECURITY DEFINER) decide CUÁNTO es,
// lo suma y lo sella. Antes esa multiplicación vivía en el cliente y el rastro
// de cómo se contó no vivía en ningún sitio.
//
// EL VEREDICTO NO TRAE LA CANTIDAD ESPERADA, y este fichero no puede pedirla ni
// deducirla: es la razón entera de que el freno esté en el servidor. Quien
// cuenta no debe poder saber lo que Folvy espera — en el momento en que lo
// sabe, deja de contar y empieza a confirmar.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

/**
 * Las dos RPC de este fichero son NUEVAS y todavía no están en `database.ts`
 * —los tipos se regeneran contra la BBDD, y la BBDD no las tiene hasta que
 * Julio aplique las migraciones—. Se invocan con el cliente sin tipar para que
 * el compilador no las rechace, exactamente igual que hace
 * `inventoryCountService.ts` con `avt_cause_context`.
 *
 * DEUDA CON FECHA DE CIERRE: cuando las migraciones estén aplicadas y
 * `database.ts` regenerado, esto se borra y se usa `supabase!.rpc` a secas. Va
 * escrito aquí y no en la cabeza de nadie.
 */
function rpc(fn: string, args: Record<string, unknown>) {
  return (supabase! as unknown as {
    rpc: (f: string, a: Record<string, unknown>) => Promise<{
      data: unknown
      error: { message: string; code?: string } | null
    }>
  }).rpc(fn, args)
}

/** Una entrada tal como la manda el móvil. La conversión la hace el servidor. */
export type CountEntryInput =
  | { method: 'formato';  formatId: string; qty: number }
  | { method: 'peso';     qty: number }
  | { method: 'fraccion'; formatId: string; fraction: number }
  | { method: 'cero' }

export interface SaveCountLineResult {
  /** 'ok' = guardado. 'recount' = vuelve a mirarlo (pantalla 3). */
  verdict: 'ok' | 'recount'
  /** Lo que ha tecleado la propia persona, ya en unidad base. */
  counted: number
  entries: number
  attempt: number
  /** Lleva alguna fracción «a ojo»: el encargado lo verá marcado. */
  estimated: boolean
  /** Segundo intento y le sale lo mismo: sellado como confirmado dos veces. */
  confirmed: boolean
  /** Segundo intento y sigue sin cuadrar: no se aplicará solo. */
  needsReview: boolean
}

/** Lo que el servidor rechaza por estar fuera de escala (red de cordura). */
/**
 * El servidor ha rechazado la cantidad por estar fuera de escala (la red de
 * cordura, ahora por arriba Y por abajo). No trae el total dentro a propósito:
 * la excepción aborta la transacción antes de que el servidor pueda devolver
 * nada, así que el único que sabe con seguridad qué se intentó guardar es quien
 * llamó — y es él quien tiene que pasarlo en `confirmTotal` si lo confirma.
 */
export class AbsurdQuantityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AbsurdQuantityError'
  }
}

function toPayload(e: CountEntryInput): Record<string, unknown> {
  switch (e.method) {
    case 'formato':  return { method: 'formato',  format_id: e.formatId, qty: e.qty }
    case 'peso':     return { method: 'peso',     qty: e.qty }
    case 'fraccion': return { method: 'fraccion', format_id: e.formatId, fraction: e.fraction }
    case 'cero':     return { method: 'cero' }
  }
}

/**
 * Guarda lo contado de una línea. Sustituye las entradas del intento en curso.
 *
 * Un array vacío NO es un cero: para decir «no queda nada» hay que mandar
 * `[{ method: 'cero' }]`. La diferencia entre «he mirado y no hay» y «no lo he
 * mirado» es la que Folvy no sabía guardar hasta hoy.
 */
export async function saveCountLine(
  lineId: string,
  entries: CountEntryInput[],
  /** Confirmación expresa de una cantidad que la red de cordura rechazó. Vale
   *  para ESE total y sólo para ése: el servidor exige que coincida. */
  confirmTotal?: number,
): Promise<SaveCountLineResult> {
  requireSupabase()
  if (entries.length === 0) {
    throw new Error('Un campo vacío no es un cero. Marca «No queda nada de este producto» si de verdad no queda.')
  }
  const { data, error } = await rpc('save_count_line', {
    p_line_id: lineId,
    p_entries: entries.map(toPayload),
    p_confirm: confirmTotal ?? null,
  })
  if (error) {
    // FV001 = la red de cordura del conteo, por arriba o por abajo.
    if ((error as { code?: string }).code === 'FV001') {
      throw new AbsurdQuantityError(error.message)
    }
    throw new Error(`No se pudo guardar: ${error.message}`)
  }
  const r = (data ?? {}) as Record<string, unknown>
  return {
    verdict: r.verdict === 'recount' ? 'recount' : 'ok',
    counted: Number(r.counted ?? 0),
    entries: Number(r.entries ?? 0),
    attempt: Number(r.attempt ?? 1),
    estimated: Boolean(r.estimated),
    confirmed: Boolean(r.confirmed),
    needsReview: Boolean(r.needs_review),
  }
}

// ═══════════════════════════════════════════════════════════════════════
// CÓMO SE CONTÓ · lo que lee la pantalla de aprobación
// ═══════════════════════════════════════════════════════════════════════

export interface CountEntry {
  id: string
  lineId: string
  formatId: string | null
  formatName: string | null
  formatQtyInBase: number | null
  qty: number | null
  fraction: number | null
  qtyInBase: number
  method: 'formato' | 'peso' | 'fraccion' | 'cero'
  attempt: number
  createdAt: string
}

type Row = Record<string, unknown>

/** Las entradas de un conteo entero, agrupadas por línea. */
export async function listEntriesByCount(countId: string): Promise<Map<string, CountEntry[]>> {
  requireSupabase()
  const { data, error } = await (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  })
    .from('inventory_count_entry')
    .select('id, line_id, format_id, qty, fraction, qty_in_base, method, attempt, created_at, ' +
            'inventory_count_line!inner(inventory_count_id), ' +
            'recipe_item_purchase_format(name, qty_in_base)')
    .eq('inventory_count_line.inventory_count_id', countId)
    .order('attempt', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(`No se pudo cargar cómo se contó: ${error.message}`)

  const out = new Map<string, CountEntry[]>()
  for (const r of ((data as Row[] | null) ?? [])) {
    const f = (r.recipe_item_purchase_format ?? {}) as Record<string, unknown>
    const e: CountEntry = {
      id: r.id as string,
      lineId: r.line_id as string,
      formatId: (r.format_id as string | null) ?? null,
      formatName: (f.name as string | null) ?? null,
      formatQtyInBase: f.qty_in_base == null ? null : Number(f.qty_in_base),
      qty: r.qty == null ? null : Number(r.qty),
      fraction: r.fraction == null ? null : Number(r.fraction),
      qtyInBase: Number(r.qty_in_base),
      method: r.method as CountEntry['method'],
      attempt: Number(r.attempt ?? 1),
      createdAt: r.created_at as string,
    }
    out.set(e.lineId, [...(out.get(e.lineId) ?? []), e])
  }
  return out
}

const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 })

// Espacio de NO SEPARACIÓN entre la cifra y su unidad: «750 g» no se parte.
function qtyTxt(v: number, unit: string | null): string {
  const u = (unit ?? '').toLowerCase()
  if (u === 'g' && Math.abs(v) >= 1000) return `${nf.format(v / 1000)}\u00A0kg`
  if (u === 'ml' && Math.abs(v) >= 1000) return `${nf.format(v / 1000)}\u00A0l`
  return `${nf.format(v)}${unit ? `\u00A0${unit}` : ''}`
}

const FRACCIONES: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾' }

/**
 * «2 bolsas de 2,5 kg + 750 g pesados». La columna «cómo se contó» de la
 * pantalla 4 sale de aquí, no de una etiqueta guardada.
 */
export function describirEntradas(entries: CountEntry[], baseUnit: string | null): string {
  if (entries.length === 0) return '—'
  const ultimo = Math.max(...entries.map(e => e.attempt))
  const del = entries.filter(e => e.attempt === ultimo)
  const trozos = del.map(e => {
    switch (e.method) {
      case 'cero':
        return 'No queda nada'
      case 'peso':
        return `${qtyTxt(e.qtyInBase, baseUnit)} pesados`
      case 'fraccion': {
        // ¼ ½ ¾ tienen su símbolo; «Otra» sale como número («2,5 bolsas a ojo»).
        const nombre = (e.formatName ?? 'formato').trim().split(/\s+/)[0].toLowerCase()
        const f = FRACCIONES[String(e.fraction)]
        if (f) return `${f} ${nombre} a ojo`
        const n = e.fraction ?? 0
        return `${nf.format(n)} ${n === 1 ? nombre : (/[aeiouáéíóú]$/.test(nombre) ? nombre + 's' : nombre + 'es')} a ojo`
      }
      case 'formato': {
        // El nombre del ENVASE, la primera palabra: «Bolsa cerrada» → «bolsas».
        // Concordar el sintagma entero escribiría «2 bolsa cerradas».
        const n = e.qty ?? 0
        const nombre = (e.formatName ?? 'formato').trim().split(/\s+/)[0].toLowerCase()
        const plural = n === 1 ? nombre : (/[aeiouáéíóú]$/.test(nombre) ? `${nombre}s` : `${nombre}es`)
        return `${nf.format(n)} ${plural} de ${qtyTxt(e.formatQtyInBase ?? 0, baseUnit)}`
      }
    }
  })
  return trozos.join(' + ')
}

/** ¿Hay algo estimado a ojo en el último intento? Manda la pastilla «A ojo». */
export function esAOjo(entries: CountEntry[]): boolean {
  if (entries.length === 0) return false
  const ultimo = Math.max(...entries.map(e => e.attempt))
  return entries.some(e => e.attempt === ultimo && e.method === 'fraccion')
}

// ═══════════════════════════════════════════════════════════════════════
// RECONTAR
// ═══════════════════════════════════════════════════════════════════════

export interface RecountResult {
  requested: boolean
  newLineId: string | null
  /** 'hoy' si ha entrado en el autoinventario de hoy; 'proximo' si espera. */
  when: 'hoy' | 'proximo'
  assignedTo: string | null
  assignedName: string | null
}

/**
 * Pide que OTRA persona vuelva a contar este artículo. Devuelve a quién le ha
 * caído y para cuándo — regla 8: la confirmación lleva contenido, no un visto.
 */
export async function requestRecount(
  lineId: string,
  assignTo?: string | null,
): Promise<RecountResult> {
  requireSupabase()
  const { data, error } = await rpc('request_recount', {
    p_line_id: lineId,
    p_assign_to: assignTo ?? undefined,
  })
  if (error) throw new Error(`No se pudo pedir el recuento: ${error.message}`)
  const r = (data ?? {}) as Record<string, unknown>
  return {
    requested: Boolean(r.requested),
    newLineId: (r.new_line_id as string | null) ?? null,
    when: r.when === 'hoy' ? 'hoy' : 'proximo',
    assignedTo: (r.assigned_to as string | null) ?? null,
    assignedName: (r.assigned_name as string | null) ?? null,
  }
}

/**
 * Deja la línea SIN CONTAR. No es lo mismo que contar cero, y por eso es una
 * llamada distinta con un nombre distinto: «no lo he mirado» y «he mirado y no
 * hay» son las dos respuestas que Folvy guardaba igual hasta hoy.
 */
export async function clearCountLine(lineId: string): Promise<void> {
  requireSupabase()
  const { error } = await rpc('clear_count_line', { p_line_id: lineId })
  if (error) throw new Error(`No se pudo borrar lo contado: ${error.message}`)
}
