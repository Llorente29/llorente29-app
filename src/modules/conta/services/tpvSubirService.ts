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

const limpio = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^[a-z_]+: /, '')

/** Los días del TPV ya guardados de la empresa (para «Ya estaba» y para la lista). */
export async function leerGuardados(companyId: string): Promise<DiaYaGuardado[]> {
  const r = await rpc<DiaYaGuardado[] | null>('conta_tpv_dias', { p_company: companyId, p_desde: null, p_hasta: null })
  return (r ?? []).map((x) => ({ ...x, total: Number(x.total) }))
}

/** Guardar un día leído. Dice qué ha guardado, o por qué no (la frase de la base). */
export async function guardarDia(companyId: string, dia: string, lectura: LecturaDia, quien: string | null): Promise<{ ok: true; facturas: number; total: number } | { ok: false; error: string }> {
  try {
    const r = await rpc<{ documentos: number; total: number }>('conta_tpv_dia_guardar', { p_company: companyId, p_dia: dia, p_programa: 'revo', p_lectura: lectura, p_quien_nombre: quien })
    return { ok: true, facturas: Number(r.documentos), total: Number(r.total) }
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
