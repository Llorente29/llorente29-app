// src/modules/conta/services/tpvSubirService.ts
//
// R06 · Lo que leen y escriben «Subir las ventas del TPV» y «A qué cuenta va cada
// forma de pago». Lo que se decide, sin pantalla, en lib/subirTpv.ts.
//
// Nombres dentro de cadenas (regla 40): conta_tpv_dia_guardar es del R03
// (20261117T0951); conta_tpv_dias, del R05 (20261117T1602); conta_tpv_formas,
// conta_tpv_asiento_ejemplo y conta_tpv_formas_guardar, del R06
// (20261117T2130); company_account existe desde el C02.

import { supabase } from '@/lib/supabase'
import { rpc, hayBase } from '@/modules/conta/services/bd'
import type { LecturaDia } from '@/modules/conta/lib/lectorRevo'
import type { DiaYaGuardado, FormaCuenta } from '@/modules/conta/lib/subirTpv'
import type { CuentaHoja } from '@/modules/conta/diseno/plantillas'
import type { FilaLibroDia } from '@/modules/conta/lib/diaTpv'

const limpio = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^[a-z_]+: /, '')

/** Los días del TPV ya guardados de la empresa (para «Ya estaba» y para la lista). */
export async function leerGuardados(companyId: string): Promise<(DiaYaGuardado & { id: string; motivo: string | null })[]> {
  const r = await rpc<(DiaYaGuardado & { id: string; motivo: string | null })[] | null>('conta_tpv_dias', { p_company: companyId, p_desde: null, p_hasta: null })
  return (r ?? []).map((x) => ({ ...x, total: Number(x.total) }))
}

/** Guardar un día leído. Dice qué ha guardado, o por qué no (la frase de la base). */
export async function guardarDia(companyId: string, dia: string, lectura: LecturaDia, quien: string | null, programa = 'revo'): Promise<{ ok: true; id: string; facturas: number; total: number } | { ok: false; error: string }> {
  try {
    const r = await rpc<{ id: string; documentos: number; total: number }>('conta_tpv_dia_guardar', { p_company: companyId, p_dia: dia, p_programa: programa, p_lectura: lectura, p_quien_nombre: quien })
    return { ok: true, id: String(r.id), facturas: Number(r.documentos), total: Number(r.total) }
  } catch (e) {
    return { ok: false, error: limpio(e) }
  }
}

export interface Formas { mes: string; ejemplo: string | null; ejemploDia: string | null; formas: FormaCuenta[] }

/** Las formas de pago de la empresa con su cuenta, lo del mes del día de ejemplo y los días sin validar. */
export async function leerFormas(companyId: string, diaId: string | null = null): Promise<Formas> {
  const r = await rpc<{ mes: string; ejemplo: string | null; ejemplo_dia: string | null; formas: FormaCuenta[] }>('conta_tpv_formas', { p_company: companyId, p_dia: diaId })
  return { mes: r.mes, ejemplo: r.ejemplo, ejemploDia: r.ejemplo_dia, formas: (r.formas ?? []).map((f) => ({ ...f, en_mes: Number(f.en_mes) })) }
}

export interface LineaEjemplo { cuenta: string | null; nombre: string | null; sin_cuenta: boolean; forma: string | null; canal: string | null; debe: number; haber: number; concepto: string; tipo?: number | null }
export interface AsientoEjemplo { dia: string; motivo: string | null; lineas: LineaEjemplo[]; debe: number; haber: number; sinCuenta: number }

export type Eleccion = { forma: string; canal: string | null; cuenta_id: string | null }

/** «Cómo queda el asiento de un día» con las cuentas que se están eligiendo: lo propone la base, sin guardar nada. */
export async function asientoEjemplo(diaId: string, elecciones: Eleccion[]): Promise<AsientoEjemplo> {
  const r = await rpc<{ dia: string; motivo: string | null; lineas: LineaEjemplo[]; debe?: number; haber?: number; sin_cuenta?: number }>('conta_tpv_asiento_ejemplo', { p_dia: diaId, p_cuentas: elecciones })
  return {
    dia: r.dia, motivo: r.motivo,
    lineas: (r.lineas ?? []).map((l) => ({ ...l, debe: Number(l.debe), haber: Number(l.haber) })),
    debe: Number(r.debe ?? 0), haber: Number(r.haber ?? 0), sinCuenta: Number(r.sin_cuenta ?? 0),
  }
}

/** Guardar a qué cuenta va cada forma. Devuelve la frase de la base (regla 8) y los días que pasan a listos. */
export async function guardarFormas(companyId: string, elecciones: Eleccion[], quien: string | null): Promise<{ texto: string; listos: string[] }> {
  const r = await rpc<{ texto: string; listos: string[] }>('conta_tpv_formas_guardar', { p_company: companyId, p_cuentas: elecciones, p_quien_nombre: quien })
  return { texto: r.texto, listos: r.listos ?? [] }
}

export interface CuentaElegible extends CuentaHoja { id: string }

/** Las cuentas de la empresa que se pueden elegir (las de último nivel, abiertas), para el buscador de siempre. */
export async function leerCuentasEmpresa(companyId: string): Promise<CuentaElegible[]> {
  hayBase()
  const { data, error } = await supabase!.from('company_account').select('id, code, name').eq('company_id', companyId).neq('status', 'cerrada').order('code')
  if (error) throw new Error(`No se han podido leer las cuentas: ${error.message}`)
  const filas = (data ?? []) as { id: string; code: string; name: string }[]
  const largo = Math.max(0, ...filas.map((c) => c.code.length))
  return filas.filter((c) => c.code.length === largo).map((c) => ({ id: c.id, codigo: c.code, nombre: c.name }))
}

// ── R07 · La factura del día y su cobro ─────────────────────────────────────────────
// Nombres dentro de cadenas (regla 40): conta_tpv_factura_de, conta_tpv_factura_guardar y
// conta_tpv_dia_ejemplo son del R07 (20261120T0900); company_account_add, del C02.

export interface FacturaDelDia {
  /** La cuenta elegida, con lo que suma en el mes y desde qué día va cada día en dos asientos. */
  factura: { cuenta: string; nombre: string; desde: string; mes: number } | null
  /** Si no hay ninguna elegida: una 430 de la empresa que ya se llama «contado». */
  propuesta: { cuenta: string; nombre: string } | null
}

export async function leerFacturaDelDia(companyId: string, mes: string | null): Promise<FacturaDelDia> {
  const r = await rpc<{ factura: { cuenta: string; nombre: string; desde: string; mes: number } | null; propuesta: { cuenta: string; nombre: string } | null }>(
    'conta_tpv_factura_de', { p_company: companyId, p_mes: mes })
  return { factura: r.factura ? { ...r.factura, mes: Number(r.factura.mes) } : null, propuesta: r.propuesta ?? null }
}

/** Guardar a qué cuenta va la factura del día. Devuelve la frase de la base (regla 8). */
export async function guardarFacturaDelDia(companyId: string, cuenta: string, quien: string | null): Promise<{ texto: string; desde: string }> {
  const r = await rpc<{ texto: string; desde: string }>('conta_tpv_factura_guardar', { p_company: companyId, p_cuenta: cuenta, p_quien_nombre: quien })
  return { texto: r.texto, desde: r.desde }
}

/** Dar de alta «Clientes de contado» (una 430 nueva, la siguiente libre). Devuelve su código. */
export async function altaClientesDeContado(companyId: string, quien: string | null): Promise<string> {
  const r = await rpc<{ id: string; code: string }>('company_account_add', {
    p_company: companyId, p_hoja: '4300', p_nombre: 'Clientes de contado', p_plain_name: null, p_entity: null, p_entity_id: null, p_quien_nombre: quien, p_source: 'manual',
  })
  return r.code
}

export interface LineaDiaEjemplo extends LineaEjemplo { contado: boolean }
export interface AsientoDelDia { lineas: LineaDiaEjemplo[]; debe: number; haber: number }
export interface DiaEjemplo {
  dia: string; motivo: string | null
  primero: string | null; ultimo: string | null; facturas: number | null
  factura: AsientoDelDia | null; cobro: AsientoDelDia | null; sinCuenta: number
}

/** «Cómo quedan los asientos de un día» con las cuentas que se están eligiendo: lo propone la base, sin guardar nada. */
export async function diaEjemplo(diaId: string, elecciones: Eleccion[], facturaId: string | null): Promise<DiaEjemplo> {
  type A = { lineas: LineaDiaEjemplo[]; debe: number; haber: number } | null
  const r = await rpc<{ dia: string; motivo: string | null; primero: number | string | null; ultimo: number | string | null; facturas: number | null; factura: A; cobro: A; sin_cuenta?: number }>(
    'conta_tpv_dia_ejemplo', { p_dia: diaId, p_cuentas: elecciones, p_factura: facturaId })
  const asiento = (a: A): AsientoDelDia | null => (a ? {
    lineas: (a.lineas ?? []).map((l) => ({ ...l, debe: Number(l.debe), haber: Number(l.haber), contado: !!l.contado })), debe: Number(a.debe ?? 0), haber: Number(a.haber ?? 0),
  } : null)
  return {
    dia: r.dia, motivo: r.motivo, primero: r.primero == null ? null : String(r.primero), ultimo: r.ultimo == null ? null : String(r.ultimo), facturas: r.facturas == null ? null : Number(r.facturas),
    factura: asiento(r.factura), cobro: asiento(r.cobro), sinCuenta: Number(r.sin_cuenta ?? 0),
  }
}

// ── R15 · La subida, la ficha del día y los días en «Facturas emitidas» ─────────────
// Nombres dentro de cadenas (regla 40): conta_tpv_subida_apuntar, conta_tpv_dia_ficha y
// conta_tpv_emitidas son del R15 (20261121T1712). Los días en «Facturas emitidas», en ventasService.ts.

/** Apuntar la subida en sus días: el identificador que llevan los días y, por ellos, sus asientos. */
export async function apuntarSubida(companyId: string, dias: string[], quien: string | null, programa = 'revo'): Promise<string> {
  return String(await rpc<string>('conta_tpv_subida_apuntar', { p_company: companyId, p_dias: dias, p_programa: programa, p_quien_nombre: quien }))
}

export interface FichaDiaTpv {
  id: string; company_id: string; dia: string; programa: string; programa_nombre: string
  estado: 'validado' | 'en_espera' | 'por_validar'; motivo: string | null
  documentos: number; primero: number | null; ultimo: number | null; base: number; cuota: number; total: number
  subido_por: string | null; subido_en: string | null
  subida: { id: string; cuando: string; quien: string | null; dias: number } | null
  contadores: { contador: string | null; facturas: number; primero: number | string | null; ultimo: number | string | null; total: number }[]
  con_nif: { numero: string; contador: string | null; nif: string; cliente: string | null; base: number; cuota: number; total: number }[]
  devoluciones: { numero: string; contador: string | null; total: number }[]
  sobre_limite: { numero: string; total: number }[]
  limite: number
  iva: { tipo: number; base: number; cuota: number; facturas: number }[]
  cobros: { forma: string; importe: number; pagos: number; cuenta: string | null; nombre: string | null; por_canal: boolean }[]
  factura: { id: string; serie: number | null; numero: number | null; estado: string } | null
  cobro: { id: string; serie: number | null; numero: number | null; estado: string } | null
  pdf: { ruta: string; nombre: string | null } | null
  erp10: { estado: string; serie: string | null; documento: string | null; cuando: string | null } | null
}

const num = (x: unknown) => Number(x ?? 0)

/** Un día del TPV por dentro: sus facturas, su IVA, sus cobros, sus asientos, su PDF y su salida a ERP10. */
export async function leerFichaDia(diaId: string): Promise<FichaDiaTpv> {
  const r = await rpc<FichaDiaTpv>('conta_tpv_dia_ficha', { p_dia: diaId })
  return {
    ...r,
    documentos: num(r.documentos), base: num(r.base), cuota: num(r.cuota), total: num(r.total), limite: num(r.limite),
    contadores: (r.contadores ?? []).map((c) => ({ ...c, facturas: num(c.facturas), total: num(c.total) })),
    con_nif: (r.con_nif ?? []).map((c) => ({ ...c, base: num(c.base), cuota: num(c.cuota), total: num(c.total) })),
    devoluciones: (r.devoluciones ?? []).map((d) => ({ ...d, total: num(d.total) })),
    sobre_limite: (r.sobre_limite ?? []).map((d) => ({ ...d, total: num(d.total) })),
    iva: (r.iva ?? []).map((t) => ({ tipo: num(t.tipo), base: num(t.base), cuota: num(t.cuota), facturas: num(t.facturas) })),
    cobros: (r.cobros ?? []).map((c) => ({ ...c, importe: num(c.importe), pagos: num(c.pagos), por_canal: !!c.por_canal })),
  }
}

// ── R15b · El día en el libro de IVA ────────────────────────────────────────────────
// Nombre dentro de cadena (regla 40): conta_tpv_dia_libro es del R15b (20261121T2347).

export interface LibroDia { enLibro: boolean; repartido: boolean; filas: FilaLibroDia[] }

/** Las filas del libro de IVA de un día (o las que tendrá). Null si la base aún no tiene la 2347. */
export async function leerLibroDia(diaId: string): Promise<LibroDia | null> {
  try {
    const r = await rpc<{ en_libro: boolean; repartido: boolean; filas: FilaLibroDia[] }>('conta_tpv_dia_libro', { p_dia: diaId })
    return { enLibro: !!r.en_libro, repartido: !!r.repartido,
      filas: (r.filas ?? []).map((f) => ({ ...f, tipo: num(f.tipo), base: num(f.base), cuota: num(f.cuota), total: num(f.total), documentos: num(f.documentos) })) }
  } catch (e) {
    if (/PGRST202|could not find the function|does not exist/i.test(e instanceof Error ? e.message : String(e))) return null
    throw e
  }
}
