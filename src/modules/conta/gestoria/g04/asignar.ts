// src/modules/conta/gestoria/g04/asignar.ts
//
// G04 · Tarea 4 · «Cobros de GoCardless sin cliente» → «Asignar a un
// cliente» (Julio, 08/11): cada cliente de GoCardless con alguna suscripción
// activa que aún no está unido a un cliente de Sumied, con lo que cobra al mes
// y el cliente más probable (por NIF, después email y después nombre:
// lista.ts · proponerCliente). Solo propone: lo confirma una persona, con
// conta_gestoria_enlazar. Ordenados por lo que cobran al mes, de más a menos.
// Puro: lo prueba tests/unit/modules/conta/gestoria/g04/asignar.test.ts.

import { proponerCliente, type ClienteParaCasar, type Propuesta } from '../../../../../supabase/functions/_shared/tarifa/lista'
import type { DatosClientes, Fila } from './datos'

export interface PorAsignar {
  empresaId: string
  empresa: string
  gcClienteId: string
  nombre: string
  correo: string | null
  nif: string | null
  suscripciones: { nombre: string; alMesCent: number }[]
  alMesCent: number
  propuesta: Propuesta
}

const cent = (v: unknown) => Math.round(Number(v ?? 0) * 100)
const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Los clientes de Sumied para casar (uno por cliente, con los correos de su ficha). */
export function clientesParaCasar(d: DatosClientes): ClienteParaCasar[] {
  const correos = new Map(d.fichas.map((f) => {
    const x = (f.ficha ?? {}) as Fila
    return [String(f.party_id), Array.isArray(x.correos) ? x.correos.map(String) : []]
  }))
  const vistos = new Map<string, ClienteParaCasar>()
  for (const c of d.clientes) {
    const id = String(c.cliente_id)
    if (!vistos.has(id)) vistos.set(id, { id, nombre: String(c.cliente ?? ''), nif: texto(c.nif), correos: correos.get(id) ?? [] })
  }
  return [...vistos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

export function porAsignar(d: DatosClientes, gcClientes: readonly Fila[], empresas: readonly { id: string; nombre: string }[], elegidas: readonly string[]): PorAsignar[] {
  const unidos = new Set(d.clientes.filter((c) => c.cliente_en_gocardless && c.empresa_id).map((c) => `${String(c.empresa_id)}|${String(c.cliente_en_gocardless)}`))
  const delGc = new Map(gcClientes.map((g) => [`${String(g.company_id)}|${String(g.gc_id)}`, g]))
  const grupos = new Map<string, PorAsignar>()
  const casar = clientesParaCasar(d)
  for (const s of d.suscripciones) {
    const empresaId = String(s.company_id)
    if (!elegidas.includes(empresaId) || s.estado !== 'active' || !s.gc_cliente_id) continue
    const k = `${empresaId}|${String(s.gc_cliente_id)}`
    if (unidos.has(k)) continue
    let g = grupos.get(k)
    if (!g) {
      const gc = delGc.get(k)
      const nombre = texto(gc?.nombre) ?? String(s.gc_cliente_id)
      const correo = texto(gc?.correo)
      const nif = texto(gc?.nif)
      g = { empresaId, empresa: empresas.find((e) => e.id === empresaId)?.nombre ?? '', gcClienteId: String(s.gc_cliente_id), nombre, correo, nif, suscripciones: [], alMesCent: 0,
        propuesta: proponerCliente({ nombre: texto(gc?.nombre), correo, nif }, casar) }
      grupos.set(k, g)
    }
    const al = cent(s.al_mes)
    g.suscripciones.push({ nombre: String(s.nombre ?? 'Suscripción'), alMesCent: al })
    g.alMesCent += al
  }
  return [...grupos.values()].sort((a, b) => b.alMesCent - a.alMesCent || a.nombre.localeCompare(b.nombre, 'es'))
}

/** «Propuesto por NIF», «2 posibles por nombre», «Sin propuesta». */
export function textoDePropuesta(p: Propuesta, nombreDe: (id: string) => string): string {
  if (p.tipo === 'una') return `Propuesto por ${p.por}: ${nombreDe(p.clienteId)}`
  if (p.tipo === 'varias') return `${p.clienteIds.length} posibles por ${p.por}: elige cuál`
  return 'Sin propuesta: ni el NIF, ni el email ni el nombre coinciden con ningún cliente'
}
