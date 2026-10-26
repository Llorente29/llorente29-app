// src/modules/conta/services/verifactuService.ts
//
// V03 · Entrega 2 · Lo que leen y escriben las pantallas de Verifactu
// (tableros 25, 26 y 27). Se lee con la cuenta (RLS: belongs_to_account) y
// siempre filtrando por account_id y company_id (regla 9); se escribe SOLO por
// las funciones de la base:
//   · verifactu_modo (pruebas / real, con el candado de la conexión probada),
//   · verifactu_autorizar_certificado / verifactu_retirar_autorizacion,
//   · verifactu_otros_programas (0226), verifactu_reenviar (0218),
//   · E3 (1750): verifactu_previsto, verifactu_anular_factura, verifactu_subsanar,
//     verifactu_comprobar_cadena, verifactu_cuadre_pedir / _ver y
//     verifactu_despacho_empresas.

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import type { EstadoFactura, EstadoHacienda, ModoVerifactu, RegistroLeido } from '@/modules/conta/lib/verifactu/estado'
import type { AccionCorreccion, Cadena, CuadreVisto, Previsto, RegistroExportar } from '@/modules/conta/lib/verifactu/correccion'

type Fila = Record<string, unknown>
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

async function leer(q: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>, que: string): Promise<Fila[]> {
  const { data, error } = await q
  if (error) throw new Error(mensaje(`No he podido leer ${que}`, error))
  return (data as Fila[] | null) ?? []
}

export interface VerifactuEmpresa {
  modo: ModoVerifactu
  via: 'colaborador' | 'certificado'
  certificadoId: string | null
  pruebasDesde: string | null
  realDesde: string | null
  realSerie: string | null
  realObligaHasta: string | null
  /** null: no lo ha dicho; []: solo con Sumied. */
  otrosProgramas: string[] | null
}

export interface AutorizacionViva { id: string; certificadoId: string; por: string; el: string }

export interface DatosVerifactu {
  empresa: VerifactuEmpresa
  autorizacion: AutorizacionViva | null
  /** La conexión con el entorno de pruebas de Hacienda, probada (el candado de la 2351). */
  pruebasProbada: boolean
  /** La de real con el NIF de esta empresa. */
  realProbada: boolean
}

const APAGADA: VerifactuEmpresa = { modo: 'apagado', via: 'colaborador', certificadoId: null, pruebasDesde: null, realDesde: null, realSerie: null, realObligaHasta: null, otrosProgramas: null }

/** Cómo está Verifactu en la empresa. Sin fila: apagado, por la vía de colaborador (lo de partida). */
export async function leerVerifactu(accountId: string, companyId: string, nif: string | null): Promise<DatosVerifactu> {
  const [empresa, autorizaciones, pruebas, real] = await Promise.all([
    leer(tabla('verifactu_empresa').select('*').eq('account_id', accountId).eq('company_id', companyId), 'Verifactu de la empresa'),
    leer(tabla('verifactu_autorizacion').select('id, certificate_id, autorizada_por_nombre, autorizada_at, retirada_at')
      .eq('account_id', accountId).eq('company_id', companyId).is('retirada_at', null).order('autorizada_at', { ascending: false }), 'la autorización del certificado'),
    rpc<boolean>('verifactu_conexion_probada', { p_entorno: 'pruebas', p_nif: nif }),
    rpc<boolean>('verifactu_conexion_probada', { p_entorno: 'real', p_nif: nif }),
  ])
  const e = empresa[0]
  const a = autorizaciones[0]
  return {
    empresa: e ? {
      modo: String(e.modo) as ModoVerifactu, via: String(e.via) as VerifactuEmpresa['via'], certificadoId: s(e.certificate_id),
      pruebasDesde: s(e.pruebas_desde), realDesde: s(e.real_desde), realSerie: s(e.real_serie), realObligaHasta: s(e.real_obliga_hasta),
      otrosProgramas: Array.isArray(e.otros_programas) ? (e.otros_programas as unknown[]).map(String) : null,
    } : APAGADA,
    autorizacion: a ? { id: String(a.id), certificadoId: String(a.certificate_id), por: String(a.autorizada_por_nombre), el: String(a.autorizada_at) } : null,
    pruebasProbada: pruebas === true,
    realProbada: real === true,
  }
}

/** Solo el modo (para la banda morada de pruebas). */
export async function modoVerifactu(accountId: string, companyId: string): Promise<ModoVerifactu> {
  const [e] = await leer(tabla('verifactu_empresa').select('modo').eq('account_id', accountId).eq('company_id', companyId), 'Verifactu de la empresa')
  return e ? String(e.modo) as ModoVerifactu : 'apagado'
}

const estadoDe = (r: Fila): EstadoFactura => ({
  invoiceId: String(r.invoice_id), estado: String(r.estado) as EstadoHacienda, entorno: s(r.entorno) as EstadoFactura['entorno'],
  codigo: r.codigo_error == null ? null : n(r.codigo_error), descripcion: s(r.descripcion_error), generado: s(r.generado_at), respondido: s(r.respondido_at),
  intentos: n(r.intentos), proximoIntento: s(r.proximo_intento_at), urlQr: s(r.url_qr),
})

/** El estado con Hacienda de las emitidas de la empresa (verifactu_factura_estado). */
export async function estadosHacienda(accountId: string, companyId: string): Promise<Map<string, EstadoFactura>> {
  const filas = await leer(tabla('verifactu_factura_estado')
    .select('invoice_id, estado, entorno, codigo_error, descripcion_error, generado_at, respondido_at, intentos, proximo_intento_at, url_qr')
    .eq('account_id', accountId).eq('company_id', companyId), 'el estado con Hacienda')
  return new Map(filas.map((r) => [String(r.invoice_id), estadoDe(r)]))
}

/** Una factura: su estado y sus registros (con cuándo salió cada envío), para «Cómo va con Hacienda». */
export async function historiaHacienda(accountId: string, invoiceId: string): Promise<{ estado: EstadoFactura | null; registros: RegistroLeido[] }> {
  const [estado, registros] = await Promise.all([
    leer(tabla('verifactu_factura_estado')
      .select('invoice_id, estado, entorno, codigo_error, descripcion_error, generado_at, respondido_at, intentos, proximo_intento_at, url_qr')
      .eq('account_id', accountId).eq('invoice_id', invoiceId), 'el estado con Hacienda'),
    leer(tabla('verifactu_registro').select('id, tipo, subsanacion, estado, generado_at, respondido_at, codigo_error, descripcion_error, envio_id')
      .eq('account_id', accountId).eq('invoice_id', invoiceId).order('generado_at'), 'sus registros de Verifactu'),
  ])
  const envios = registros.map((r) => s(r.envio_id)).filter((x): x is string => !!x)
  const cuando = new Map((envios.length
    ? await leer(tabla('verifactu_envio').select('id, empezado_at').eq('account_id', accountId).in('id', envios), 'sus envíos')
    : []).map((e) => [String(e.id), String(e.empezado_at)]))
  return {
    estado: estado[0] ? estadoDe(estado[0]) : null,
    registros: registros.map((r) => ({
      id: String(r.id), tipo: String(r.tipo) as RegistroLeido['tipo'], subsanacion: r.subsanacion === true, estado: String(r.estado) as RegistroLeido['estado'],
      generado: String(r.generado_at), enviado: r.envio_id ? cuando.get(String(r.envio_id)) ?? null : null, respondido: s(r.respondido_at),
      codigo: r.codigo_error == null ? null : n(r.codigo_error), descripcion: s(r.descripcion_error),
    })),
  }
}

/** Pasar a pruebas, a real (con la serie nueva y EMPEZAR) o apagar. La base pone el candado. */
export function cambiarModo(companyId: string, modo: ModoVerifactu, serie: string | null, confirmacion: string | null, quien: string | null) {
  return rpc<{ modo: ModoVerifactu; cambiado: boolean; real_serie?: string; real_obliga_hasta?: string }>('verifactu_modo',
    { p_company: companyId, p_modo: modo, p_serie: serie, p_confirmacion: confirmacion, p_quien_nombre: quien })
}

/** «Usar mi certificado solo para enviar Verifactu» (2341): escribiendo AUTORIZO. */
export function autorizarCertificado(companyId: string, certificado: string, confirmacion: string, quien: string | null) {
  return rpc<{ id: string }>('verifactu_autorizar_certificado', { p_company: companyId, p_certificate: certificado, p_confirmacion: confirmacion, p_quien_nombre: quien })
}

export function retirarAutorizacion(companyId: string, motivo: string, quien: string | null) {
  return rpc<{ retirada: boolean }>('verifactu_retirar_autorizacion', { p_company: companyId, p_motivo: motivo, p_quien_nombre: quien })
}

export function guardarOtrosProgramas(companyId: string, programas: readonly string[], quien: string | null) {
  return rpc<{ otros_programas: string[] }>('verifactu_otros_programas', { p_company: companyId, p_programas: programas, p_quien_nombre: quien })
}

/** «Corregir y reenviar» (0218): la rechazada, como subsanación; con el porqué de la venta sin IVA si se cambia. */
export function reenviarAHacienda(invoiceId: string, tipoVenta: { calificacion: string } | { exenta: string } | null, quien: string | null) {
  return rpc<{ registro_id: string; num_serie: string; estado: string }>('verifactu_reenviar', { p_invoice: invoiceId, p_tipo_venta: tipoVenta, p_quien_nombre: quien })
}

// ── V03 · E3 · Corregir y cuadrar ───────────────────────────────────────────

/** Lo que va a pasar si rectificas, anulas o subsanas (solo lee). */
export function previsto(invoiceId: string, accion: AccionCorreccion, descripcion?: string | null) {
  return rpc<Previsto>('verifactu_previsto', { p_invoice: invoiceId, p_accion: accion, p_cambios: descripcion == null ? null : { descripcion } })
}

/** «No tenía que haberla emitido»: escribiendo ANULAR, con el motivo. */
export function anularFactura(invoiceId: string, motivo: string, confirmacion: string, quien: string | null) {
  return rpc<{ numero: string; registro_id: string; sin_registro_previo: boolean; contraasiento: string; numero_contraasiento: number | null; numero_anulado: number | null }>(
    'verifactu_anular_factura', { p_invoice: invoiceId, p_motivo: motivo, p_confirmacion: confirmacion, p_quien_nombre: quien })
}

/** «Solo está mal lo que tiene Hacienda»: un registro nuevo (subsanación); con otra descripción si se da. */
export function subsanar(invoiceId: string, descripcion: string | null, quien: string | null) {
  return rpc<{ numero: string; registro_id: string; cambios: Previsto['cambios']; rechazo_previo: string | null }>(
    'verifactu_subsanar', { p_invoice: invoiceId, p_descripcion: descripcion, p_quien_nombre: quien })
}

export function comprobarCadena(companyId: string) {
  return rpc<Cadena>('verifactu_comprobar_cadena', { p_company: companyId })
}

/** «Comprobar con Hacienda» de un mes (AAAA-MM-01). desdeAccount: la asesoría que lleva la empresa. */
export function pedirCuadre(companyId: string, mes: string, desdeAccount: string | null, quien: string | null) {
  return rpc<{ id: string; ya_estaba: boolean; entorno: string; estado: string }>(
    'verifactu_cuadre_pedir', { p_company: companyId, p_mes: mes, p_desde_account: desdeAccount, p_quien_nombre: quien })
}

export function verCuadre(companyId: string, opciones: { mes?: string; cuadre?: string; desdeAccount?: string | null }) {
  return rpc<CuadreVisto | null>('verifactu_cuadre_ver',
    { p_company: companyId, p_mes: opciones.mes ?? null, p_cuadre: opciones.cuadre ?? null, p_desde_account: opciones.desdeAccount ?? null })
}

export interface EmpresaDelDespacho { company_id: string; nombre: string; nif: string | null; modo: ModoVerifactu }
export function empresasDelDespacho(accountId: string) {
  return rpc<EmpresaDelDespacho[]>('verifactu_despacho_empresas', { p_account: accountId })
}

/** Todos los registros de la empresa, para una inspección (en el orden de la cadena). */
export async function registrosParaExportar(accountId: string, companyId: string): Promise<RegistroExportar[]> {
  const out: RegistroExportar[] = []
  // De mil en mil: PostgREST no da más de una vez.
  for (let desde = 0; ; desde += 1000) {
    const filas = await leer(tabla('verifactu_registro')
      .select('entorno, tipo, subsanacion, rechazo_previo, sin_registro_previo, nif_emisor, num_serie, fecha_expedicion, tipo_factura, cuota_total, importe_total, '
        + 'primer_registro, anterior_num_serie, anterior_fecha, huella_anterior, fecha_hora_huso, generado_at, cadena_huella, huella, estado, codigo_error, '
        + 'descripcion_error, csv, respondido_at, id')
      .eq('account_id', accountId).eq('company_id', companyId).order('generado_at').order('id').range(desde, desde + 999), 'los registros de Verifactu')
    out.push(...filas.map((r): RegistroExportar => ({
      entorno: String(r.entorno), tipo: String(r.tipo), subsanacion: r.subsanacion === true, rechazo_previo: s(r.rechazo_previo),
      sin_registro_previo: r.sin_registro_previo === true, nif_emisor: String(r.nif_emisor), num_serie: String(r.num_serie),
      fecha_expedicion: String(r.fecha_expedicion), tipo_factura: s(r.tipo_factura),
      cuota_total: r.cuota_total == null ? null : n(r.cuota_total), importe_total: r.importe_total == null ? null : n(r.importe_total),
      primer_registro: r.primer_registro === true, anterior_num_serie: s(r.anterior_num_serie), anterior_fecha: s(r.anterior_fecha),
      huella_anterior: s(r.huella_anterior), fecha_hora_huso: String(r.fecha_hora_huso), generado_at: String(r.generado_at),
      cadena_huella: String(r.cadena_huella), huella: String(r.huella), estado: String(r.estado),
      codigo_error: r.codigo_error == null ? null : n(r.codigo_error), descripcion_error: s(r.descripcion_error), csv: s(r.csv), respondido_at: s(r.respondido_at),
    })))
    if (filas.length < 1000) return out
  }
}
