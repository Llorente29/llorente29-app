// src/modules/personal/laboral/avisosOlvidoServicio.ts
//
// L1a · PR 3 (28/10/2026). Lo que los avisos piden a la base:
//   · el portal: los olvidos de salida que ya avisamos y siguen sin contestar
//     (mis_avisos_olvido) y la respuesta de un toque (responder_aviso_olvido),
//     que crea la petición para el encargado, nunca el fichaje;
//   · Equipo: el contador de la semana (enviados, fallidos, sin teléfono,
//     solo portal) y los avisos a la empresa (aviso_empresa).
// Las funciones son de la 1800 y aún no están en database.ts: van por un
// cliente sin tipos, y cada error sale en palabras.

import { supabase } from '@/lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase
}

function enPalabras(e: { message?: string; hint?: string | null } | null, porDefecto: string): Error {
  return new Error(e?.hint || e?.message || porDefecto)
}

export interface AvisoOlvido {
  id: string
  entradaAt: string
  finTurno: string | null
  local: string
  respuesta: 'a_su_hora' | 'otra_hora' | 'sigo' | null
}

export async function misAvisosOlvido(): Promise<AvisoOlvido[]> {
  const { data, error } = await db().rpc('mis_avisos_olvido')
  if (error) throw enPalabras(error, 'No se han podido leer tus avisos.')
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), entradaAt: String(r.entrada_at), finTurno: r.fin_turno ? String(r.fin_turno) : null,
    local: String(r.local_nombre ?? ''), respuesta: (r.respuesta as AvisoOlvido['respuesta']) ?? null,
  }))
}

export interface RespuestaAviso { resultado: string; texto: string; hora?: string }

export async function responderAvisoOlvido(id: string, respuesta: 'a_su_hora' | 'otra_hora' | 'sigo', hora?: string): Promise<RespuestaAviso> {
  const { data, error } = await db().rpc('responder_aviso_olvido', { p_log_id: id, p_respuesta: respuesta, p_hora: hora ?? null })
  if (error) throw enPalabras(error, 'No se ha podido guardar tu respuesta.')
  return data as RespuestaAviso
}

export interface ContadorAvisos { enviados: number; fallidos: number; sinTelefono: number; soloPortal: number; respondidos: number; total: number }

export interface FilaAvisoLog { status: string; skip_reason: string | null; canal: string | null; respondida_at: string | null }

/** El contador de la semana, a partir de las filas del registro. */
export function contarAvisos(filas: FilaAvisoLog[]): ContadorAvisos {
  const c: ContadorAvisos = { enviados: 0, fallidos: 0, sinTelefono: 0, soloPortal: 0, respondidos: 0, total: filas.length }
  for (const f of filas) {
    if (f.respondida_at) c.respondidos++
    if (f.status === 'sent') c.enviados++
    else if (f.status === 'failed') c.fallidos++
    else if (f.status === 'skipped' && f.skip_reason === 'sin_telefono') c.sinTelefono++
    else if (f.status === 'skipped' && f.skip_reason !== 'ya_fichada') c.soloPortal++
  }
  return c
}

export async function contadorDeLaSemana(accountId: string, ahora = new Date()): Promise<ContadorAvisos> {
  const desde = new Date(ahora.getTime() - 7 * 86400_000).toISOString()
  const { data, error } = await db().from('clockout_reminder_log')
    .select('status, skip_reason, canal, respondida_at').eq('account_id', accountId).gte('created_at', desde)
  if (error) throw enPalabras(error, 'No se han podido contar los avisos.')
  return contarAvisos((data ?? []) as FilaAvisoLog[])
}

export interface AvisoEmpresa { id: string; tipo: 'fuera_del_radio' | 'avisos_olvido_fallan'; titulo: string; texto: string; creadoAt: string; correo: string }

export async function avisosEmpresa(accountId: string, dias = 7, ahora = new Date()): Promise<AvisoEmpresa[]> {
  const desde = new Date(ahora.getTime() - dias * 86400_000).toISOString()
  const { data, error } = await db().from('aviso_empresa')
    .select('id, tipo, titulo, texto, creado_at, correo_estado').eq('account_id', accountId).gte('creado_at', desde)
    .order('creado_at', { ascending: false })
  if (error) throw enPalabras(error, 'No se han podido leer los avisos a la empresa.')
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), tipo: r.tipo as AvisoEmpresa['tipo'], titulo: String(r.titulo), texto: String(r.texto),
    creadoAt: String(r.creado_at), correo: String(r.correo_estado),
  }))
}
