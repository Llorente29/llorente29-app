// src/modules/conta/services/impuestosService.ts
//
// I01a · Impuestos por dentro. Lo que el front escribe de Impuestos va por
// funciones de la base (security definer): las respuestas del alta, que
// hasta el I01a se usaban para proponer los modelos y se tiraban, y los
// modelos que salen de las reglas de la base.

import { supabase } from '@/lib/supabase'
import { hayBase, rpc } from '@/modules/conta/services/bd'
import type { Cadencia, Calendario, Estado } from '@/modules/conta/impuestos/calendario'
import type { DeclaracionVer, Puerta } from '@/modules/conta/impuestos/declaracion'
import type { CertificadosVer } from '@/modules/conta/impuestos/certificados'

/** Las preguntas del paso «impuestos» del alta que deciden modelos. */
const CLAVES_DEL_ALTA = ['retiene', 'alquiler', 'retenido70'] as const

/**
 * Guarda, como datos de la empresa con quién y cuándo, las respuestas del
 * paso «impuestos»: «sí», «no» o «No lo sé» (__nolose). Las que no se
 * preguntaron no se envían. Devuelve cuántas se guardaron.
 */
export async function guardarRespuestasDelAlta(companyId: string, respuestas: Partial<Record<string, string>>): Promise<number> {
  const p: Record<string, string> = {}
  for (const k of CLAVES_DEL_ALTA) {
    const v = respuestas[k]
    if (v === 'si' || v === 'no' || v === '__nolose') p[k] = v
  }
  if (Object.keys(p).length === 0) return 0
  return rpc<number>('conta_impuesto_datos_del_alta', { p_company: companyId, p_respuestas: p })
}

/** Lo que devuelve conta_impuesto_obligaciones_calcular por cada modelo. */
interface ObligacionCalculada {
  modelo: string
  presenta: boolean
  regla: string
  por_que: string
  hecho: 'igual' | 'nuevo' | 'cambiado' | 'no_toca' | 'lo_decidio_una_persona'
}

/**
 * Escribe los modelos que dicen las reglas de la base (cada uno con su regla,
 * sus datos y su porqué; lo que decidió una persona no se toca) y devuelve los
 * que presenta, ordenados, con el porqué de cada uno en una frase.
 */
export async function calcularObligaciones(companyId: string): Promise<{ modelos: string[]; porque: string }> {
  const filas = await rpc<ObligacionCalculada[]>('conta_impuesto_obligaciones_calcular', { p_company: companyId })
  const presenta = filas.filter((f) => f.presenta).sort((a, b) => a.modelo.localeCompare(b.modelo))
  return {
    modelos: presenta.map((f) => f.modelo),
    porque: presenta.length
      ? presenta.map((f) => `${f.modelo}: ${f.por_que}`).join(' ')
      : 'Con lo que me has dicho, no presentas ningún modelo de los que conozco.',
  }
}

// ── I01b · Las pantallas de Impuestos ──────────────────────────────────────


/** Lo que pinta Impuestos › Calendario (conta_impuesto_calendario). */
export function leerCalendario(companyId: string, hoy?: string): Promise<Calendario> {
  return rpc<Calendario>('conta_impuesto_calendario', { p_company: companyId, ...(hoy ? { p_hoy: hoy } : {}) })
}

/** «+ Añadir otro impuesto»: con su motivo, queda quién y cuándo (conta_impuesto_obligacion_decidir). */
export function anadirImpuesto(companyId: string, modelo: string, motivo: string): Promise<string> {
  return rpc<string>('conta_impuesto_obligacion_decidir', { p_company: companyId, p_form: modelo, p_presenta: true, p_motivo: motivo })
}

/** Lo que devuelve conta_impuesto_303_calcular. */
/** Sin libro de IVA (o sin saber la [110] cuando sale a pagar), `sabido` es false y no hay resultado ni importe. */
export interface Calculo303 { declaracion: string; desde: string; hasta: string; apuntes: number; resultado: string | null; importe: number | null; sabido: boolean }

/** Calcula (o recalcula) el borrador del 303 de un periodo desde el libro de IVA. */
export function calcular303(companyId: string, ejercicio: number, periodo: string): Promise<Calculo303> {
  return rpc<Calculo303>('conta_impuesto_303_calcular', { p_company: companyId, p_year: ejercicio, p_period: periodo })
}

/**
 * Escribe a mano casillas del 303 (la [110] de antes, o las del justificante de
 * lo presentado fuera), con el motivo; null quita la que se puso. La base
 * comprueba que cuadran y vuelve a calcular.
 */
export function ponerCasillas(declaracion: string, casillas: Record<string, number | null>, motivo: string): Promise<{ ok: boolean; mensaje: string; calculo: Calculo303 }> {
  return rpc('conta_impuesto_casillas_poner', { p_return: declaracion, p_casillas: casillas, p_motivo: motivo })
}

/** Lo que pinta el IVA de un periodo (conta_impuesto_declaracion_ver). */
export function leerDeclaracion(companyId: string, ejercicio: number, periodo: string): Promise<DeclaracionVer> {
  return rpc<DeclaracionVer>('conta_impuesto_declaracion_ver', { p_company: companyId, p_year: ejercicio, p_period: periodo })
}

/** «Revisado»: sin nada que Sumied no sepa resolver. */
export function revisarDeclaracion(declaracion: string): Promise<unknown> {
  return rpc('conta_impuesto_revisar', { p_return: declaracion })
}

/** Dar por bueno un aviso, con su motivo. */
export function aceptarAviso(comprobacion: string, motivo: string): Promise<unknown> {
  return rpc('conta_impuesto_aviso_aceptar', { p_check: comprobacion, p_motivo: motivo })
}

/** Cómo se paga: domiciliado, pagar yo o a devolver en un banco. */
export function ponerPago(declaracion: string, modo: 'direct_debit' | 'self' | 'refund', cuenta: string | null): Promise<{ ok: boolean; mensaje: string }> {
  return rpc('conta_impuesto_pago_poner', { p_return: declaracion, p_modo: modo, p_cuenta: cuenta })
}

/** El asiento de liquidación (0180). */
export function contabilizar303(declaracion: string): Promise<{ mensaje: string }> {
  return rpc('conta_impuesto_303_contabilizar', { p_return: declaracion })
}

export interface CargoPosible { movimiento: string; fecha: string; importe: number; concepto: string | null; cuenta: string }

/** Los movimientos del banco sin casar por el importe de la declaración (0180). */
export function cargosPosibles(declaracion: string): Promise<CargoPosible[]> {
  return rpc<CargoPosible[]>('conta_impuesto_cargos_posibles', { p_return: declaracion })
}

/** Casar el cargo con la declaración: «Pagado» (0180). */
export function casarCargo(declaracion: string, movimiento: string): Promise<{ mensaje: string }> {
  return rpc('conta_impuesto_casar_cargo', { p_return: declaracion, p_movement: movimiento })
}

/** El token de un solo uso para usar el certificado en ESA acción (dura 5 minutos). */
export function confirmarCertificado(certificado: string, accion: 'test' | 'file' | 'query', declaracion?: string, empresa?: string): Promise<string> {
  return rpc<string>('conta_cert_confirmar', { p_certificate: certificado, p_action: accion, p_tax_return: declaracion ?? null, p_company: empresa ?? null })
}

/** Lo que contesta conta-hacienda: siempre con un mensaje para la pantalla (regla 8). */
export type SalidaHacienda = { ok: boolean; mensaje: string; motivo?: string; [k: string]: unknown }

/** Llama a conta-hacienda. Nunca lanza: si la función contesta con un error, su cuerpo dice por qué. */
export async function hacienda(accion: 'puerta' | 'fichero_303' | 'presentar_303' | 'ya_presentado_fuera' | 'probar', cuerpo: Record<string, unknown> = {}): Promise<SalidaHacienda> {
  hayBase()
  const { data, error } = await supabase!.functions.invoke('conta-hacienda', { body: { accion, ...cuerpo } })
  if (!error && data && typeof data === 'object' && 'ok' in data) return data as SalidaHacienda
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    const c = await ctx.clone().json().catch(() => null) as SalidaHacienda | null
    if (c && typeof c.mensaje === 'string') return { ...c, ok: false }
    if (ctx.status === 404) return { ok: false, motivo: 'sin_funcion', mensaje: 'La conexión con Hacienda aún no está publicada en este entorno. No se ha enviado nada.' }
    return { ok: false, motivo: 'fallo', mensaje: `La conexión con Hacienda ha contestado ${ctx.status}. No se ha enviado nada nuevo.` }
  }
  return { ok: false, motivo: 'fallo', mensaje: `No se ha podido hablar con la conexión con Hacienda${error ? ` (${error.message})` : ''}. No se ha enviado nada.` }
}

/** ¿Está abierta la puerta de Hacienda? Sin respuesta, cerrada (y se dice). */
export async function leerPuerta(): Promise<Puerta> {
  const r = await hacienda('puerta')
  if (r.ok) return { abierta: r.abierta === true, entorno: (r.entorno as Puerta['entorno']) ?? 'desconocido', mensaje: r.mensaje }
  return { abierta: false, entorno: 'cerrada', mensaje: r.mensaje }
}

export interface Presentado {
  id: string; cuenta: string; modelo: string; nombre: string; cadencia: Cadencia; ejercicio: number; periodo: string
  estado: Estado
  estado_texto: string; resultado: string | null; importe: number | null
  presentada: string | null; presentada_por: string | null; por: 'sumied' | 'outside' | null; plazo: string
  csv: string | null; justificante: string | null; justificante_pdf: string | null; contabilizada: boolean; casada: boolean; comprobada: boolean
}
export interface ParaApuntar { ejercicio: number; periodo: string; presentacion: string; declaracion: string | null; estado: string | null; resultado: string | null; importe: number | null }
export interface Presentados { puede_gestionar: boolean; presentados: Presentado[]; para_apuntar: ParaApuntar[] }

/** Impuestos › Presentados (conta_impuesto_presentados). */
export function leerPresentados(companyId: string): Promise<Presentados> {
  return rpc<Presentados>('conta_impuesto_presentados', { p_company: companyId })
}

const DOCUMENTOS = 'conta-documentos'

/** Un enlace de 5 minutos al justificante en PDF. */
export async function enlaceJustificante(ruta: string): Promise<string> {
  hayBase()
  const { data, error } = await supabase!.storage.from(DOCUMENTOS).createSignedUrl(ruta, 300)
  if (error || !data?.signedUrl) throw new Error(`No se ha podido abrir el justificante: ${error?.message ?? 'sin enlace'}`)
  return data.signedUrl
}

/**
 * Subir el justificante en PDF de una declaración presentada: a
 * <cuenta>/impuestos/<declaración>/<huella>.pdf, y la base comprueba que es ese
 * fichero (tamaño y tipo) antes de enlazarlo. Uno por declaración: no se cambia.
 */
export async function subirJustificante(p: { declaracion: string; cuenta: string; fichero: File }): Promise<string> {
  hayBase()
  if (p.fichero.type && p.fichero.type !== 'application/pdf') throw new Error('El justificante tiene que ser un PDF.')
  const bytes = new Uint8Array(await p.fichero.arrayBuffer())
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Ese PDF pasa de 10 MB: no parece un justificante.')
  const huella = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))).map((b) => b.toString(16).padStart(2, '0')).join('')
  const ruta = `${p.cuenta}/impuestos/${p.declaracion}/${huella}.pdf`
  const sub = await supabase!.storage.from(DOCUMENTOS).upload(ruta, new Blob([bytes as BlobPart], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false })
  if (sub.error && !/exists|duplicate/i.test(sub.error.message)) throw new Error(`No se ha podido subir el PDF: ${sub.error.message}`)
  const r = await rpc<{ mensaje: string }>('conta_impuesto_justificante_guardar', { p_return: p.declaracion, p_ruta: ruta, p_huella: huella, p_tamano: bytes.length })
  return r.mensaje
}

// ── P4 · Certificados y accesos ─────────────────────────────────────────────

/** Lo que pinta Certificados y accesos (conta_impuesto_certificados_ver). */
export function leerCertificados(companyId: string): Promise<CertificadosVer> {
  return rpc<CertificadosVer>('conta_impuesto_certificados_ver', { p_company: companyId })
}

/**
 * Subir un certificado (.p12 / .pfx) con su contraseña a conta-certificado, que
 * lo abre en memoria y lo guarda en el almacén. Ni el fichero ni la contraseña
 * se guardan en el navegador ni en la base. Nunca lanza: devuelve el mensaje.
 */
export async function subirCertificado(cuentaId: string, fichero: File, contrasena: string): Promise<{ ok: boolean; mensaje: string; id?: string }> {
  hayBase()
  const bytes = new Uint8Array(await fichero.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  const { data, error } = await supabase!.functions.invoke('conta-certificado', { body: { cuenta_id: cuentaId, p12_base64: btoa(bin), contrasena } })
  if (!error && data && typeof data === 'object' && 'ok' in data) return data as { ok: boolean; mensaje: string; id?: string }
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    const c = await ctx.clone().json().catch(() => null) as { mensaje?: string } | null
    if (c?.mensaje) return { ok: false, mensaje: c.mensaje }
    return { ok: false, mensaje: `La subida del certificado ha contestado ${ctx.status}. No se ha guardado nada.` }
  }
  return { ok: false, mensaje: 'No se ha podido hablar con la subida del certificado. No se ha guardado nada.' }
}

/** La empresa presenta con este certificado. */
export function certificadoPresenta(companyId: string, certificado: string): Promise<{ mensaje: string }> {
  return rpc('conta_impuesto_certificado_presenta', { p_company: companyId, p_certificate: certificado })
}

/** «Quitar el certificado ahora»: se borra del almacén al instante; el registro de usos se queda. */
export function quitarCertificado(certificado: string): Promise<string> {
  return rpc<string>('conta_cert_quitar', { p_certificate: certificado })
}

/** «Puede presentar» (file), «solo ver» (view) o nada (null). */
export function permisoCertificado(certificado: string, persona: string, permiso: 'file' | 'view' | null): Promise<string> {
  return rpc<string>('conta_cert_permiso', { p_certificate: certificado, p_user: persona, p_permission: permiso })
}

/** «Probar con Hacienda»: un token de un solo uso y la consulta (no presenta nada). */
export async function probarCertificado(certificado: string): Promise<SalidaHacienda> {
  const token = await confirmarCertificado(certificado, 'test')
  return hacienda('probar', { confirmacion: token })
}

// ── P4b · Invitar a mi asesoría ─────────────────────────────────────────────

export interface InvitacionViva {
  id: string; estado: 'pending' | 'waiting_approval'; correo: string; asesoria: string; base: 'social_collaborator' | 'power_of_attorney'
  invita: string; creada: string; expira: string; envios: number; ultimo_envio: string
}

/** La invitación viva de la empresa, si la hay (conta_asesoria_de_empresa). */
export function invitacionDeEmpresa(companyId: string): Promise<InvitacionViva | null> {
  return rpc<InvitacionViva | null>('conta_asesoria_de_empresa', { p_company: companyId })
}

/** Cancelar la invitación: su enlace deja de valer. */
export function cancelarInvitacion(id: string): Promise<string> {
  return rpc<string>('conta_asesoria_cancelar', { p_invitation: id })
}

/** Retirar el permiso de la asesoría: deja de ver y gestionar en el acto. */
export async function retirarAsesoria(companyId: string): Promise<string> {
  await rpc('conta_impuesto_presentador_retirar', { p_company: companyId })
  return 'Retirado el permiso de la asesoría: desde ahora no ve ni gestiona los impuestos de esta empresa.'
}

/** Llama a conta-asesoria. Nunca lanza: si contesta con un error, su cuerpo dice por qué. */
export async function asesoria(accion: 'invitar' | 'ver' | 'aceptar' | 'aprobar', cuerpo: Record<string, unknown>): Promise<{ ok: boolean; mensaje: string; [k: string]: unknown }> {
  hayBase()
  const { data, error } = await supabase!.functions.invoke('conta-asesoria', { body: { accion, ...cuerpo } })
  if (!error && data && typeof data === 'object') return data as { ok: boolean; mensaje: string }
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    const c = await ctx.clone().json().catch(() => null) as { mensaje?: string } | null
    if (c?.mensaje) return { ...c, ok: false, mensaje: c.mensaje }
    if (ctx.status === 404) return { ok: false, mensaje: 'La invitación de asesorías aún no está publicada en este entorno.' }
    return { ok: false, mensaje: `La invitación ha contestado ${ctx.status}. No se ha cambiado nada.` }
  }
  return { ok: false, mensaje: 'No se ha podido hablar con la invitación. No se ha cambiado nada.' }
}
