// supabase/functions/conta-gocardless-leer/enlace.ts
//
// G06 · Tarea 2 · Lo que la lectura escribe en el sitio único del enlace (conta_gc_enlace). Puro: lo prueban las unitarias.
//
//   · Lo atado por una persona (conta_gestoria_decision, tipo enlace) se escribe siempre, con quién y cuándo, y
//     resuelve un conflicto o una propuesta.
//   · Lo atado solo (por NIF o por correo) pisa lo automático y las propuestas, nunca lo de una persona ni un conflicto
//     (eso lo decide una persona: Julio, nº 140).
//   · Lo automático que en esta lectura ya no casa se quita. Lo de una persona y los conflictos se quedan.
// Los dos enlaces de antes (conta_gc_cliente.party_id y conta_cobro_cliente.gc_cliente_id) se siguen escribiendo igual,
// aparte, hasta que todos los que los leen hayan cambiado (cautela del nº 140).

export type PorEnlace = 'nif' | 'correo' | 'nombre' | 'persona'
export type EstadoEnlace = 'atado' | 'propuesto' | 'conflicto'

export interface EnlaceExistente { gcClienteId: string; por: PorEnlace; estado: EstadoEnlace }
export interface EnlaceNuevo { gcClienteId: string; partyId: string; por: 'nif' | 'correo' | 'persona' }
export interface DecisionDePersona { quien: string | null; quienName: string | null; cuando: string }

export interface PlanEnlaces {
  guardar: Record<string, unknown>[]
  quitar: string[]
  /** Los que no se tocan porque son de una persona o un conflicto y la lectura casa otra cosa (o nada). */
  respetados: number
}

const AUTOMATICO: PorEnlace[] = ['nif', 'correo']

export function planEnlaces(empresa: string, cuenta: string, ahora: string, existentes: EnlaceExistente[], nuevos: EnlaceNuevo[],
  personas: Map<string, DecisionDePersona>): PlanEnlaces {
  const antes = new Map(existentes.map((e) => [e.gcClienteId, e]))
  const guardar: Record<string, unknown>[] = []
  let respetados = 0
  for (const n of nuevos) {
    const ex = antes.get(n.gcClienteId)
    if (n.por !== 'persona' && ex && (ex.por === 'persona' || ex.estado === 'conflicto')) { respetados++; continue }
    const p = n.por === 'persona' ? personas.get(n.gcClienteId) : undefined
    guardar.push({ company_id: empresa, gc_cliente_id: n.gcClienteId, account_id: cuenta, party_id: n.partyId, por: n.por, estado: 'atado',
      candidatas: [], porque: null, quien: p?.quien ?? null, quien_name: p?.quienName ?? null, decidido_at: p?.cuando ?? null, updated_at: ahora })
  }
  const ahoraAtados = new Set(nuevos.map((n) => n.gcClienteId))
  const quitar = existentes.filter((e) => e.estado === 'atado' && AUTOMATICO.includes(e.por) && !ahoraAtados.has(e.gcClienteId)).map((e) => e.gcClienteId)
  respetados += existentes.filter((e) => (e.por === 'persona' || e.estado === 'conflicto') && !ahoraAtados.has(e.gcClienteId)).length
  return { guardar, quitar, respetados }
}

/** De las decisiones de la ficha, la más reciente de tipo enlace de cada cliente de GoCardless: quién y cuándo. */
export function personasDeDecisiones(decisiones: { tipo: string; gc_cliente_id: string | null; party_id: string | null; quien: string | null; quien_name: string | null; cuando: string }[]): Map<string, DecisionDePersona> {
  const out = new Map<string, DecisionDePersona>()
  for (const d of decisiones) {
    if (d.tipo !== 'enlace' || !d.gc_cliente_id || !d.party_id) continue
    const ya = out.get(d.gc_cliente_id)
    if (!ya || d.cuando > ya.cuando) out.set(d.gc_cliente_id, { quien: d.quien, quienName: d.quien_name, cuando: d.cuando })
  }
  return out
}
