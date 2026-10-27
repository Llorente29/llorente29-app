// src/modules/conta/services/ivaPresentadoService.ts
//
// V04 · Respuesta 5 · Los periodos con el IVA presentado de un ejercicio, para
// el candado de las pantallas (lib/ivaPresentado.ts). Quien manda es la base.
// Nombres dentro de cadenas (regla 40): conta_iva_presentados(p_company uuid,
// p_year int), de la 1233 (con «reabierto» desde la 1408). Si la base aún no la tiene (antes de aplicar la
// tanda: PGRST202 / 42883), no hay candado que pintar y la base de antes
// tampoco lo tenía: lista vacía.

import { supabase } from '@/lib/supabase'
import { hayBase } from '@/modules/conta/services/bd'
import { textoParaPantalla, type ErrorDeBase } from '@/modules/conta/lib/errorBase'
import type { PeriodoPresentado } from '@/modules/conta/lib/ivaPresentado'

type Fila = Record<string, unknown>

export function aPeriodo(f: Fila): PeriodoPresentado {
  const r = (f.reabierto ?? null) as Fila | null
  return {
    periodo: String(f.periodo), ejercicio: Number(f.ejercicio), desde: String(f.desde), hasta: String(f.hasta),
    presentado: String(f.presentado), nombre: String(f.nombre), siguiente: String(f.siguiente),
    // V04 (1408): reabierto para corregir.
    reabierto: r ? { id: String(r.id), motivo: String(r.motivo ?? ''), desde: String(r.desde), por: r.por ? String(r.por) : null,
      tipo: r.tipo === 'substitutive' ? 'substitutive' : 'complementary', secuencia: Number(r.secuencia) } : null,
  }
}

export async function leerIvaPresentados(companyId: string, ejercicio: number): Promise<PeriodoPresentado[]> {
  hayBase()
  const cliente = supabase as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: ErrorDeBase | null }> }
  const { data, error } = await cliente.rpc('conta_iva_presentados', { p_company: companyId, p_year: ejercicio })
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883' || /could not find the function|function .* does not exist/i.test(error.message)) return []
    throw new Error(textoParaPantalla('conta_iva_presentados', error, `No he podido leer qué IVA está presentado: ${error.message}`))
  }
  return Array.isArray(data) ? (data as Fila[]).map(aPeriodo) : []
}

/** Los de varios ejercicios (el diario puede mirar un rango que cruza el año). */
export async function leerIvaPresentadosDe(companyId: string, ejercicios: readonly number[]): Promise<PeriodoPresentado[]> {
  const unicos = [...new Set(ejercicios)].sort()
  const todos = await Promise.all(unicos.map((y) => leerIvaPresentados(companyId, y)))
  return todos.flat()
}
