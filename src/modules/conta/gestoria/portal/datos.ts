// src/modules/conta/gestoria/portal/datos.ts
//
// GP · Tarea 4 (Code 3, 09/11/2026) · LO QUE LEE Y HACE LA GESTORÍA CON EL
// PORTAL DEL CLIENTE: la pestaña «Portal» de la ficha, lo del portal en «Lo que
// tienes que hacer» y la forma de pagar un devuelto. Una lectura por pantalla
// (conta_portal_ficha, conta_portal_pendiente: la 1530). Cada acción devuelve
// la frase que dice la base, para enseñarla tal cual (regla 8).

import { supabase } from '@/lib/supabase'
import { hayBase, rpc, tabla } from '@/modules/conta/services/bd'

export type Permiso = 'todo' | 'facturas_documentos'
export interface Acceso { id: string; correo: string; nombre: string | null; permiso: Permiso; invitado_at: string; invitado_por_name: string | null; revocado_at: string | null; user_id?: never }
export interface MensajeFicha { id: string; de: 'cliente' | 'gestoria'; autor: string; texto: string; adjuntos: { ruta: string; nombre: string }[]; cuando: string; leido: string | null }
export interface PeticionFicha { id: string; tipo: 'firmar' | 'subir' | 'contestar'; titulo: string; detalle: string | null; fecha_limite: string | null; estado: 'pendiente' | 'hecha' | 'anulada'; created_at: string; hecha_at: string | null; hecha_por_name: string | null; respuesta?: string | null; creada_por_name: string | null }
export interface IncidenciaFicha { id: string; tipo: string; texto: string; estado: 'abierta' | 'resuelta'; recibo_id: string | null; recibo_parado: boolean | null; respuesta: string | null; created_at: string; resuelta_at: string | null }
export interface SolicitudFicha { id: string; tipo: 'alta' | 'baja'; empleado_nombre: string; estado: 'pedida' | 'hecha' | 'rechazada'; mes: string | null; fecha_efecto: string | null; pedida_at: string; motivo_rechazo: string | null; portal_acceso_id: string | null }
export interface SubidaFicha { id: string; nombre: string; ruta: string; estado: string; created_at: string }
export interface FichaPortal { accesos: Acceso[]; mensajes: MensajeFicha[]; peticiones: PeticionFicha[]; incidencias: IncidenciaFicha[]; solicitudes: SolicitudFicha[]; subidas: SubidaFicha[] }

export interface PendientePortal {
  mensajes: { cliente_id: string; cliente: string; sin_leer: number; ultimo: string }[]
  incidencias: { id: string; cliente_id: string; cliente: string; tipo: string; texto: string; cuando: string }[]
  solicitudes: { id: string; cliente_id: string; cliente: string; tipo: 'alta' | 'baja'; nombre: string; fecha: string; cuando: string; desde_el_portal: boolean }[]
  subidas: { id: string; cliente_id: string; cliente: string; nombre: string; estado: string; cuando: string }[]
}

type Frase = { frase: string }

export const leerFichaPortal = (cliente: string) => rpc<FichaPortal>('conta_portal_ficha', { p_party: cliente })
export const leerPendientePortal = (cuenta: string) => rpc<PendientePortal>('conta_portal_pendiente', { p_cuenta: cuenta })

export async function leerPagarDevuelto(cuenta: string): Promise<('banco' | 'tarjeta')[]> {
  const { data, error } = await tabla('conta_portal_ajustes').select('pagar_devuelto').eq('account_id', cuenta).maybeSingle()
  if (error) throw new Error('No se han podido leer los ajustes del portal.')
  return ((data as { pagar_devuelto?: string[] } | null)?.pagar_devuelto ?? ['banco']) as ('banco' | 'tarjeta')[]
}

/** Lo que pasa por el servidor del portal (el correo de la invitación sale de ahí). */
async function servidor(body: Record<string, unknown>): Promise<{ ok: boolean; frase: string } & Record<string, unknown>> {
  hayBase()
  const { data, error } = await supabase!.functions.invoke('conta-portal', { body: { ...body, origen: typeof window === 'undefined' ? null : window.location.origin } })
  if (error) throw new Error('No se ha podido hacer ahora. Prueba en unos minutos.')
  return data as { ok: boolean; frase: string }
}

export async function invitar(cliente: string, correo: string, nombre: string, permiso: Permiso): Promise<string> {
  const r = await servidor({ accion: 'invitar', cliente, correo, nombre, permiso })
  if (!r.ok) throw new Error(r.frase)
  return r.frase
}

export const quitarAcceso = async (acceso: string) => (await rpc<Frase>('conta_portal_acceso_quitar', { p_acceso: acceso })).frase
export const enviarMensaje = async (cliente: string, texto: string) => (await rpc<Frase>('conta_portal_mensaje_enviar', { p_party: cliente, p_texto: texto })).frase
export const marcarLeidos = (cliente: string) => rpc<number>('conta_portal_mensajes_leidos', { p_party: cliente })
export const anularPeticion = async (peticion: string) => (await rpc<Frase>('conta_portal_peticion_anular', { p_peticion: peticion })).frase
export const resolverIncidencia = async (incidencia: string, respuesta: string) => (await rpc<Frase>('conta_portal_incidencia_resolver', { p_incidencia: incidencia, p_respuesta: respuesta })).frase
export const hacerSolicitud = async (solicitud: string, servicio: string | null) => (await rpc<Frase>('conta_portal_solicitud_hacer', { p_solicitud: solicitud, p_servicio: servicio })).frase
export const rechazarSolicitud = async (solicitud: string, motivo: string) => (await rpc<Frase>('conta_portal_solicitud_rechazar', { p_solicitud: solicitud, p_motivo: motivo })).frase
export const guardarPagarDevuelto = async (cuenta: string, formas: ('banco' | 'tarjeta')[]) => (await rpc<Frase>('conta_portal_ajustes_guardar', { p_cuenta: cuenta, p_pagar_devuelto: formas })).frase

/** «Contrato de servicios.pdf» → «Contrato_de_servicios.pdf», sin carpetas ni raros. */
export function nombreFichero(n: string): string {
  const base = (n.split(/[\\/]/).pop() ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '')
  return (base || 'documento.pdf').slice(-80)
}

/** Pedirle algo al cliente. Para firmar, primero se sube el PDF a su carpeta de peticiones. */
export async function pedir(cuenta: string, cliente: string, p: { tipo: 'firmar' | 'subir' | 'contestar'; titulo: string; detalle: string; fecha: string; pdf: File | null }): Promise<string> {
  hayBase()
  let ruta: string | null = null
  if (p.tipo === 'firmar') {
    if (!p.pdf) throw new Error('Para pedir una firma, elige el PDF que tiene que firmar.')
    if (p.pdf.type !== 'application/pdf') throw new Error('Lo que se firma tiene que ser un PDF.')
    ruta = `${cuenta}/${cliente}/peticiones/${crypto.randomUUID()}-${nombreFichero(p.pdf.name)}`
    const { error } = await supabase!.storage.from('conta-portal').upload(ruta, p.pdf, { contentType: 'application/pdf', upsert: false })
    if (error) throw new Error('No se ha podido subir el PDF. Prueba de nuevo.')
  }
  const r = await rpc<Frase>('conta_portal_peticion_crear', {
    p_party: cliente, p_tipo: p.tipo, p_titulo: p.titulo, p_detalle: p.detalle || null, p_fecha_limite: p.fecha || null, p_documento_ruta: ruta,
  })
  return r.frase
}

/** Un enlace de 5 minutos para abrir un fichero del portal (un adjunto o una subida). */
export async function abrirFichero(ruta: string): Promise<string> {
  hayBase()
  const { data, error } = await supabase!.storage.from('conta-portal').createSignedUrl(ruta, 300)
  if (error || !data?.signedUrl) throw new Error('No se ha podido abrir el fichero.')
  return data.signedUrl
}
