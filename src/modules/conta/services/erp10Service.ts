// src/modules/conta/services/erp10Service.ts
//
// X04 · La salida a ERP10, contra la base: el interruptor de la empresa, lo que
// sale de un mes, las recibidas con lo que necesita su fila, lo que salió y ha
// cambiado, los lotes ya apuntados, apuntar uno nuevo y bajar los PDF.
//
// Nombres dentro de cadenas (regla 40), comprobados contra la estructura de
// staging (estructura/staging 5c8707d5, con la X02) y la migración del X04:
//   · tablas: conta_erp10_salida_empresa (company_id, account_id, encendida,
//     codigo_erp10, largo_subcuenta, desde, carpeta_pdf, cambiado_por_nombre,
//     cambiado_en), conta_erp10_salida_lote (id, account_id, company_id, mes,
//     ficheros, recibidas, emitidas, asientos, cuentas_nuevas, creado_por_nombre,
//     creado_en);
//   · funciones: conta_erp10_salida_poner, conta_erp10_salida_carpeta,
//     conta_erp10_por_salir, conta_erp10_recibidas_por_salir,
//     conta_erp10_cambiadas, conta_erp10_lote_apuntar;
//   · el almacén: conta-documentos (el de los PDF de los asientos).

import { supabase } from '@/lib/supabase'
import { hayBase, mensaje, rpc, tabla } from '@/modules/conta/services/bd'
import type { Operacion, LineaRecibida } from '@/modules/conta/erp10/ficheros'

const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const n = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v))

// ── El interruptor ───────────────────────────────────────────────────────────────

export interface SalidaEmpresa {
  encendida: boolean
  codigo: string | null
  largo: number | null
  desde: string | null
  carpeta: string | null
  cambiadoPor: string | null
  cambiadoEn: string | null
  /** Cuántas veces ha salido algo: con alguna, el código y las cifras ya no se cambian. */
  lotes: number
}

const SIN_SALIDA: SalidaEmpresa = { encendida: false, codigo: null, largo: null, desde: null, carpeta: null, cambiadoPor: null, cambiadoEn: null, lotes: 0 }
const noExiste = (e: { code?: string; message: string }) => e.code === '42P01' || e.code === '42703' || /does not exist|could not find/i.test(e.message)

/** La salida a ERP10 de la empresa. Sin fila (o en una base sin la X02), apagada. */
export async function leerSalidaEmpresa(accountId: string, companyId: string): Promise<SalidaEmpresa> {
  const [{ data, error }, lotes] = await Promise.all([
    tabla('conta_erp10_salida_empresa').select('encendida, codigo_erp10, largo_subcuenta, desde, carpeta_pdf, cambiado_por_nombre, cambiado_en')
      .eq('account_id', accountId).eq('company_id', companyId).maybeSingle(),
    tabla('conta_erp10_salida_lote').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('company_id', companyId),
  ])
  if (error) {
    if (noExiste(error as { code?: string; message: string })) return SIN_SALIDA
    throw new Error(mensaje('No se ha podido leer la salida a ERP10', error))
  }
  const f = data as Record<string, unknown> | null
  if (!f) return SIN_SALIDA
  return {
    encendida: f.encendida === true, codigo: s(f.codigo_erp10), largo: f.largo_subcuenta == null ? null : Number(f.largo_subcuenta),
    desde: s(f.desde), carpeta: s(f.carpeta_pdf), cambiadoPor: s(f.cambiado_por_nombre), cambiadoEn: s(f.cambiado_en),
    lotes: lotes.error ? 0 : lotes.count ?? 0,
  }
}

/** Enciende o apaga, con el código, las cifras y desde cuándo. Devuelve la frase de lo que ha quedado (regla 8). */
export async function ponerSalida(companyId: string, o: { encender: boolean; codigo?: string | null; largo?: number | null; desde?: string | null; quien: string | null }): Promise<string> {
  const r = await rpc<{ texto: string }>('conta_erp10_salida_poner', {
    p_company: companyId, p_encender: o.encender, p_codigo: o.codigo ?? null, p_largo: o.largo ?? null, p_desde: o.desde ?? null, p_quien_nombre: o.quien,
  })
  return String(r.texto)
}

/** Pone la carpeta de los PDF (vacía: la de siempre). Devuelve la frase de lo que ha quedado. */
export async function ponerCarpeta(companyId: string, carpeta: string, quien: string | null): Promise<string> {
  const r = await rpc<{ texto: string }>('conta_erp10_salida_carpeta', { p_company: companyId, p_carpeta: carpeta, p_quien_nombre: quien })
  return String(r.texto)
}

/** La carpeta que se usa: la de la ficha o, si no se dijo, C:\Sumied\<código>\. */
export const carpetaDeLaSalida = (salida: Pick<SalidaEmpresa, 'carpeta' | 'codigo'>): string =>
  salida.carpeta ?? `C:\\Sumied\\${salida.codigo ?? ''}\\`

// ── Lo que sale ───────────────────────────────────────────────────────────────────

export interface PartidaPorSalir {
  entryId: string
  serie: number
  numero: number | null
  fecha: string
  concepto: string
  origen: string
  clase: 'recibida' | 'emitida' | 'asiento'
  importe: number
  numeroFactura: string | null
  nif: string | null
  tercero: string | null
  tienePdf: boolean
  deOtroMes: boolean
  sale: boolean
  avisos: string[]
}
export interface CuentaNuevaPorSalir { codigo: string; nombre: string; codigoErp10: string | null; cabe: boolean; aviso: string | null }
export interface PorSalir { mes: string; desde: string; codigo: string; largo: number; partidas: PartidaPorSalir[]; cuentasNuevas: CuentaNuevaPorSalir[] }

export function aPorSalir(r: Record<string, unknown>): PorSalir {
  const ps = (r.partidas ?? []) as Record<string, unknown>[]
  const cs = (r.cuentas_nuevas ?? []) as Record<string, unknown>[]
  return {
    mes: String(r.mes), desde: String(r.desde), codigo: String(r.codigo), largo: Number(r.largo),
    partidas: ps.map((p) => ({
      entryId: String(p.entry_id), serie: n(p.serie), numero: p.numero == null ? null : Number(p.numero), fecha: String(p.fecha), concepto: String(p.concepto ?? ''),
      origen: String(p.origen), clase: String(p.clase) as PartidaPorSalir['clase'], importe: n(p.importe), numeroFactura: s(p.numero_factura),
      nif: s(p.nif), tercero: s(p.tercero), tienePdf: p.tiene_pdf === true, deOtroMes: p.de_otro_mes === true, sale: p.sale === true,
      avisos: Array.isArray(p.avisos) ? (p.avisos as unknown[]).map(String) : [],
    })),
    cuentasNuevas: cs.map((c) => ({ codigo: String(c.codigo), nombre: String(c.nombre ?? ''), codigoErp10: s(c.codigo_erp10), cabe: c.cabe === true, aviso: s(c.aviso) })),
  }
}

export async function leerPorSalir(companyId: string, mes: string): Promise<PorSalir> {
  return aPorSalir(await rpc<Record<string, unknown>>('conta_erp10_por_salir', { p_company: companyId, p_mes: mes }))
}

// ── Las recibidas, con lo que necesita su fila ──────────────────────────────────────────────

export interface RecibidaDeLaBase {
  entryId: string
  fecha: string
  factura: { numero: string | null; fecha: string }
  proveedor: { nombre: string; nif: string | null }
  operacion: Operacion
  lineas: (LineaRecibida & { plantilla: string })[]
  tienePdf: boolean
  pdf: { ruta: string; nombre: string } | null
}
export interface CuentaDeLaBase { codigo: string; plantilla: string; nombre: string; nif: string | null; gastoHabitual: string | null }
export interface RecibidasPorSalir { recibidas: RecibidaDeLaBase[]; cuentas: CuentaDeLaBase[]; yaSalidas: Map<string, string> }

export function aRecibidas(r: Record<string, unknown>): RecibidasPorSalir {
  const rs = (r.recibidas ?? []) as Record<string, unknown>[]
  return {
    recibidas: rs.map((x) => {
      const f = (x.factura ?? {}) as Record<string, unknown>
      const p = (x.proveedor ?? {}) as Record<string, unknown>
      const pdf = x.pdf as Record<string, unknown> | null
      return {
        entryId: String(x.entryId), fecha: String(x.fecha), factura: { numero: s(f.numero), fecha: String(f.fecha) },
        proveedor: { nombre: String(p.nombre ?? ''), nif: s(p.nif) }, operacion: String(x.operacion) as Operacion,
        lineas: ((x.lineas ?? []) as Record<string, unknown>[]).map((l) => ({
          cuenta: String(l.cuenta), plantilla: String(l.plantilla), debe: n(l.debe), haber: n(l.haber),
          tipoIva: l.tipoIva == null ? null : Number(l.tipoIva), baseIva: l.baseIva == null ? null : Number(l.baseIva),
          deducible: (s(l.deducible) as LineaRecibida['deducible']) ?? null, recargo: l.recargo == null ? null : Number(l.recargo),
          modeloRetencion: (s(l.modeloRetencion) as LineaRecibida['modeloRetencion']) ?? null,
        })),
        tienePdf: x.tienePdf === true, pdf: pdf ? { ruta: String(pdf.ruta), nombre: String(pdf.nombre) } : null,
      }
    }),
    cuentas: ((r.cuentas ?? []) as Record<string, unknown>[]).map((c) => ({
      codigo: String(c.codigo), plantilla: String(c.plantilla), nombre: String(c.nombre ?? ''), nif: s(c.nif), gastoHabitual: s(c.gastoHabitual),
    })),
    yaSalidas: new Map(Object.entries((r.yaSalidas ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)])),
  }
}

export async function leerRecibidasPorSalir(companyId: string, mes: string): Promise<RecibidasPorSalir> {
  return aRecibidas(await rpc<Record<string, unknown>>('conta_erp10_recibidas_por_salir', { p_company: companyId, p_mes: mes }))
}

// ── Lo que salió ─────────────────────────────────────────────────────────────────

export interface Cambiada { entryId: string; serie: number; numero: number | null; fecha: string; concepto: string; clase: string; importe: number; salioEn: string; anuladoEn: string | null; motivo: string | null; queHacer: string }

export async function leerCambiadas(companyId: string): Promise<Cambiada[]> {
  const r = await rpc<Record<string, unknown>[]>('conta_erp10_cambiadas', { p_company: companyId })
  return (r ?? []).map((x) => ({
    entryId: String(x.entry_id), serie: n(x.serie), numero: x.numero == null ? null : Number(x.numero), fecha: String(x.fecha), concepto: String(x.concepto ?? ''),
    clase: String(x.clase), importe: n(x.importe), salioEn: String(x.salio_en), anuladoEn: s(x.anulado_en), motivo: s(x.motivo), queHacer: String(x.que_hacer),
  }))
}

export interface LoteSalido { id: string; mes: string; recibidas: number; emitidas: number; asientos: number; cuentasNuevas: number; quien: string | null; cuando: string }

export async function leerLotes(accountId: string, companyId: string): Promise<LoteSalido[]> {
  const { data, error } = await tabla('conta_erp10_salida_lote')
    .select('id, mes, recibidas, emitidas, asientos, cuentas_nuevas, creado_por_nombre, creado_en')
    .eq('account_id', accountId).eq('company_id', companyId).order('creado_en', { ascending: false })
  if (error) throw new Error(mensaje('No se ha podido leer lo que ya salió', error))
  return ((data ?? []) as Record<string, unknown>[]).map((x) => ({
    id: String(x.id), mes: String(x.mes), recibidas: n(x.recibidas), emitidas: n(x.emitidas), asientos: n(x.asientos), cuentasNuevas: n(x.cuentas_nuevas),
    quien: s(x.creado_por_nombre), cuando: String(x.creado_en),
  }))
}

/** Apunta lo que sale, en una transacción. Devuelve la frase de la base (cuántas de cada) y el id. */
export async function apuntarLote(companyId: string, mes: string, ficheros: { nombre: string; filas: number; huella: string }[],
  partidas: { entry_id: string; clase: 'recibida' | 'emitida' | 'asiento'; huella: string }[], quien: string | null): Promise<{ lote: string; texto: string }> {
  const r = await rpc<{ lote: string; texto: string }>('conta_erp10_lote_apuntar', { p_company: companyId, p_mes: mes, p_ficheros: ficheros, p_partidas: partidas, p_quien_nombre: quien })
  return { lote: String(r.lote), texto: String(r.texto) }
}

/** Un PDF del almacén, con la sesión de quien lo pide. */
export async function bajarPdf(ruta: string): Promise<Uint8Array> {
  hayBase()
  const { data, error } = await supabase!.storage.from('conta-documentos').download(ruta)
  if (error || !data) throw new Error(`No se ha podido bajar el PDF ${ruta.split('/').pop()}: ${error?.message ?? 'no ha contestado'}`)
  return new Uint8Array(await data.arrayBuffer())
}
