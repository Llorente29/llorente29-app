// src/modules/conta/services/empresaService.ts
//
// Empresas de la cuenta (tabla `company`, C00 §4.1). Todo filtra por
// `account_id` (regla 9) además de la RLS.

import { tabla, mensaje } from '@/modules/conta/services/bd'
import type { EmpresaResumen } from '@/modules/conta/empresa/contexto'

const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

export function aResumen(r: Record<string, unknown>): EmpresaResumen {
  const razon = txt(r.legal_name)
  return {
    id: String(r.id),
    nombre: txt(r.trade_name) ?? razon ?? 'Empresa sin nombre',
    razonSocial: razon,
    nif: txt(r.tax_id),
    completa: r.setup_completed_at !== null && r.setup_completed_at !== undefined,
    pasoAlta: txt(r.setup_step),
    tieneDireccion: txt(r.fiscal_street) !== null,
  }
}

export async function listarEmpresas(accountId: string): Promise<EmpresaResumen[]> {
  const { data, error } = await tabla('company')
    .select('id, legal_name, trade_name, tax_id, setup_completed_at, setup_step, fiscal_street')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
  if (error) throw new Error(mensaje('No se han podido leer tus empresas', error))
  return ((data ?? []) as Record<string, unknown>[]).map(aResumen)
}
