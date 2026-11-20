// src/modules/conta/services/erp10Service.ts
//
// X04 · La salida a ERP10, contra la base: el interruptor de la empresa, lo que
// sale de un mes, las recibidas (y, X05, las emitidas) con lo que necesita su
// fila, lo que salió y ha cambiado, los lotes ya apuntados, apuntar uno nuevo y
// bajar los PDF.
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
//     conta_erp10_cambiadas, conta_erp10_lote_apuntar; y la del X05,
//     conta_erp10_emitidas_por_salir (migración 20261117T2231), con sus campos
//     (emitidas: entryId, fecha, factura, cliente, origen, rectificativa,
//     tipoFactura, operacion, recargo, retencion, lineas, tienePdf, pdf;
//     cuentas; yaSalidas; corregidas), cruzados con la e2e contra staging;
//   · el almacén: conta-documentos (el de los PDF de los asientos y de las facturas de venta).

import { supabase } from '@/lib/supabase'
import { hayBase, mensaje, rpc, tabla } from '@/modules/conta/services/bd'
import {
  aAsientos, aDias, aEmitidas, aPorSalir, aRecibidas,
  type AsientosPorSalir, type DiasPorSalir, type EmitidasPorSalir, type PorSalir, type RecibidasPorSalir,
} from '../../../../supabase/functions/_shared/erp10Lectura.ts'

// X10c (19/11): lo puro (los tipos y cómo se lee lo que devuelve la base) vive en
// supabase/functions/_shared/erp10Lectura.ts, para que el servidor lo lea igual. Se vuelve a exportar.
export * from '../../../../supabase/functions/_shared/erp10Lectura.ts'
import type { Comprobar } from '@/modules/conta/erp10/comparar'

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

export async function leerPorSalir(companyId: string, mes: string): Promise<PorSalir> {
  return aPorSalir(await rpc<Record<string, unknown>>('conta_erp10_por_salir', { p_company: companyId, p_mes: mes }))
}

// ── Las recibidas, con lo que necesita su fila ──────────────────────────────────────────────

export async function leerRecibidasPorSalir(companyId: string, mes: string): Promise<RecibidasPorSalir> {
  return aRecibidas(await rpc<Record<string, unknown>>('conta_erp10_recibidas_por_salir', { p_company: companyId, p_mes: mes }))
}

// ── Las emitidas, con lo que necesita su fila (X05) ──────────────────────────────────────────

export async function leerEmitidasPorSalir(companyId: string, mes: string): Promise<EmitidasPorSalir> {
  return aEmitidas(await rpc<Record<string, unknown>>('conta_erp10_emitidas_por_salir', { p_company: companyId, p_mes: mes }))
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

// ── X06 · «Comprueba que queda igual» ───────────────────────────────────────────────
//
// Nombres dentro de cadenas (regla 40), de la migración 20261118T0515_x06_comprobar_salida
// y cruzados con la e2e contra staging: conta_erp10_comprobar (fecha, ejercicio, desde,
// codigo, largo, saldos, asientos, lotes, igualado), conta_erp10_a_mano_poner,
// conta_erp10_volver_a_sacar y conta_erp10_igualado_poner (texto).

export function aComprobar(r: Record<string, unknown>): Comprobar {
  const ej = (r.ejercicio ?? {}) as Record<string, unknown>
  const g = r.igualado as Record<string, unknown> | null
  return {
    fecha: String(r.fecha), ejercicio: { desde: String(ej.desde), hasta: String(ej.hasta) }, desde: String(r.desde), codigo: String(r.codigo), largo: Number(r.largo),
    saldos: ((r.saldos ?? []) as Record<string, unknown>[]).map((s) => ({
      codigo: String(s.codigo), plantilla: s.plantilla == null ? null : String(s.plantilla), nombre: String(s.nombre ?? ''), saldo: n(s.saldo), erp: s.erp == null ? null : String(s.erp),
    })),
    asientos: ((r.asientos ?? []) as Record<string, unknown>[]).map((a) => {
      const sa = a.salida as Record<string, unknown> | null
      const am = a.aMano as Record<string, unknown> | null
      return {
        entryId: String(a.entryId), serie: n(a.serie), numero: a.numero == null ? null : Number(a.numero), fecha: String(a.fecha), concepto: String(a.concepto ?? ''),
        origen: String(a.origen), estado: String(a.estado), deshace: s(a.deshace), factura: s(a.factura), tercero: s(a.tercero),
        salida: sa ? { lote: String(sa.lote), mes: String(sa.mes), salioEn: String(sa.salioEn), clase: String(sa.clase) } : null,
        aMano: am ? { quien: s(am.quien), cuando: String(am.cuando) } : null,
        lineas: ((a.lineas ?? []) as Record<string, unknown>[]).map((l) => ({ cuenta: String(l.cuenta), importe: n(l.importe) })),
      }
    }),
    lotes: ((r.lotes ?? []) as Record<string, unknown>[]).map((l) => ({ id: String(l.id), mes: String(l.mes), creadoEn: String(l.creadoEn), quien: s(l.quien) })),
    igualado: g ? { mes: String(g.mes), fichero: String(g.fichero), fechaSaldos: String(g.fechaSaldos), quien: s(g.quien), cuando: String(g.cuando) } : null,
  }
}

export async function leerComprobar(companyId: string, fecha: string): Promise<Comprobar> {
  return aComprobar(await rpc<Record<string, unknown>>('conta_erp10_comprobar', { p_company: companyId, p_fecha: fecha }))
}

/** «Ya la he metido a mano». Devuelve la frase de la base. */
export async function ponerAMano(companyId: string, entryId: string, quien: string | null): Promise<string> {
  const r = await rpc<{ texto: string }>('conta_erp10_a_mano_poner', { p_company: companyId, p_entry: entryId, p_quien_nombre: quien })
  return String(r.texto)
}

/** «Volver a sacar solo esa»: su partida pasa a retirada y vuelve a lo que sale. */
export async function volverASacar(companyId: string, entryId: string, quien: string | null): Promise<void> {
  await rpc('conta_erp10_volver_a_sacar', { p_company: companyId, p_entry: entryId, p_quien_nombre: quien })
}

/** «Darlo por igualado». Devuelve la frase de la base. */
export async function ponerIgualado(companyId: string, o: { mes: string; fichero: string; fecha: string; cuentas: number; conDiferencia: number; quien: string | null }): Promise<string> {
  const r = await rpc<{ texto: string }>('conta_erp10_igualado_poner', {
    p_company: companyId, p_mes: o.mes, p_fichero: o.fichero, p_fecha: o.fecha, p_cuentas: o.cuentas, p_con_diferencia: o.conDiferencia, p_quien_nombre: o.quien,
  })
  return String(r.texto)
}

// ── X07 · Los asientos, con cada apunte ───────────────────────────────────────────
//
// Nombre dentro de cadena (regla 40), de la migración 20261118T0746_x07_asientos_por_salir y
// cruzado con la e2e contra staging: conta_erp10_asientos_por_salir (asientos: entryId, serie,
// numero, fecha, concepto, origen, lineas [cuenta, plantilla, nombre, concepto, debe, haber];
// cuentas; yaSalidas).

export async function leerAsientosPorSalir(companyId: string, mes: string): Promise<AsientosPorSalir> {
  return aAsientos(await rpc<Record<string, unknown>>('conta_erp10_asientos_por_salir', { p_company: companyId, p_mes: mes }))
}

// ── X08 · Los días del TPV, con su rango y los apuntes de su asiento ──────────────────────
//
// Nombre dentro de cadena (regla 40), de la migración 20261119T0551_x08_dias_tpv_por_salir y
// cruzado con su prueba de staging: conta_erp10_dias_tpv_por_salir (dias: entryId, serie, numero,
// fecha, concepto, origen, local, localId, primero, ultimo, facturas, contadores, lineas [cuenta,
// plantilla, nombre, debe, haber, tipoIva, baseIva, libro]; contado [codigo, plantilla, nombre];
// cuentas; yaSalidas).

export async function leerDiasTpvPorSalir(companyId: string, mes: string): Promise<DiasPorSalir> {
  return aDias(await rpc<Record<string, unknown>>('conta_erp10_dias_tpv_por_salir', { p_company: companyId, p_mes: mes }))
}
