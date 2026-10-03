// src/modules/conta/services/modelosService.ts
//
// La regla de los modelos (respuesta 3 del C00): vive en la tabla de modelos
// (tax_form), en sus filas de serie con su norma, no en el código. Catálogo
// global, sin account_id: se lee entero a propósito (regla 9, excepción).
//
// Nombres de la base entre comillas (regla 40): tax_form y sus columnas
// annual_form_code, annual_legal_ref, default_for, default_legal_ref
// (migración 20261003T0190).

import { tabla, mensaje } from '@/modules/conta/services/bd'
import type { ReglaModelo } from '@/modules/conta/lib/modelos'

const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

export function aReglaModelo(r: Record<string, unknown>): ReglaModelo {
  return {
    codigo: String(r.code), nombre: String(r.name), descripcion: txt(r.description),
    anual: txt(r.annual_form_code), normaAnual: txt(r.annual_legal_ref),
    porDefecto: r.default_for === 'company_not_sii' ? 'company_not_sii' : null, normaPorDefecto: txt(r.default_legal_ref),
  }
}

export async function leerReglasModelos(): Promise<ReglaModelo[]> {
  const { data, error } = await tabla('tax_form')
    .select('code, name, description, annual_form_code, annual_legal_ref, default_for, default_legal_ref').order('code')
  if (error) throw new Error(mensaje('No se han podido leer los modelos', error))
  return ((data ?? []) as Record<string, unknown>[]).map(aReglaModelo)
}
