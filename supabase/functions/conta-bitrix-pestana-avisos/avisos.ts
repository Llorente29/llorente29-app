// supabase/functions/conta-bitrix-pestana-avisos/avisos.ts
//
// GB · nº 13, punto 4 · Lo que se decide sin llamar a nadie al poner una tarea
// en Bitrix24 (lo prueban las unitarias: tests/unit/modules/conta/gb/avisos.test.ts).
//
// Una tarea es una actividad «por hacer» del CRM en la ficha
// (crm.activity.todo.add): sale en la ficha, en el calendario del responsable
// y en sus tareas del día, sin robots que configurar a mano.

import { guardaPortal } from '../_shared/gd/siembra.ts'

export interface PorAbrir {
  cuenta: string; cliente: string; tipo: 'devuelto' | 'mandato_sin_firmar' | 'peticion_portal'; ref: string
  titulo: string; texto: string; laboral: boolean; tipo_ficha: 'empresa' | 'contacto'; id_externo: string
}

/** Cuántos días hay para hacerla. */
export const DIAS_DE_PLAZO: Record<PorAbrir['tipo'], number> = { devuelto: 2, mandato_sin_firmar: 2, peticion_portal: 2 }

/** El plazo: dentro de N días laborables, a las 13:00 de Madrid (ISO con su desfase, como lo pide Bitrix24). */
export function plazoDe(ahora: Date, dias: number): string {
  const d = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()))
  let quedan = dias
  while (quedan > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const s = d.getUTCDay()
    if (s !== 0 && s !== 6) quedan--
  }
  const ymd = d.toISOString().slice(0, 10)
  // El desfase de Madrid ese día (+01:00 en invierno, +02:00 en verano).
  const desfase = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(`${ymd}T12:00:00Z`)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+1'
  const h = Number(/GMT([+-]\d+)/.exec(desfase)?.[1] ?? '1')
  return `${ymd}T13:00:00${h >= 0 ? '+' : '-'}${String(Math.abs(h)).padStart(2, '0')}:00`
}

/** Lo que se manda a crm.activity.todo.add. */
export function tareaDe(a: PorAbrir, responsable: number | null, ahora: Date): Record<string, unknown> {
  return {
    ownerTypeId: a.tipo_ficha === 'empresa' ? 4 : 3,
    ownerId: Number(a.id_externo),
    deadline: plazoDe(ahora, DIAS_DE_PLAZO[a.tipo]),
    title: `Sumied · ${a.titulo}`,
    description: a.texto,
    ...(responsable ? { responsibleId: responsable } : {}),
  }
}

/**
 * La puerta: solo el webhook del Bitrix24 de pruebas (la misma guarda que la
 * siembra de la demo). La base ya solo da conexiones de pruebas; esto es la
 * segunda llave, por si una conexión «de pruebas» apuntara a otro portal.
 */
export function webhookDePruebas(entorno: unknown, url: unknown): { ok: true; url: string } | { ok: false; porque: string } {
  if (entorno !== 'pruebas') return { ok: false, porque: 'La conexión no es de pruebas: no se toca.' }
  try { return { ok: true, url: guardaPortal(String(url ?? '')) } } catch (e) { return { ok: false, porque: e instanceof Error ? e.message : 'Webhook no válido.' } }
}

/** El responsable de la ficha (ASSIGNED_BY_ID de crm.company.get o crm.contact.get). */
export function responsableDe(ficha: unknown): number | null {
  const r = (ficha && typeof ficha === 'object' ? (ficha as { result?: Record<string, unknown> }).result : null) ?? null
  const n = Number(r?.ASSIGNED_BY_ID)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** El jefe del departamento «Laboral» (department.get); null si no hay o el webhook no tiene permiso. */
export function jefeDeLaboral(departamentos: unknown): number | null {
  const lista = (departamentos && typeof departamentos === 'object' ? (departamentos as { result?: unknown }).result : null)
  if (!Array.isArray(lista)) return null
  const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const d = lista.find((x) => /laboral/.test(sinTildes(String((x as Record<string, unknown>).NAME ?? ''))))
  const n = Number((d as Record<string, unknown> | undefined)?.UF_HEAD)
  return Number.isInteger(n) && n > 0 ? n : null
}
