// src/modules/conta/services/cuentasProveedorService.ts
//
// C02, tarea 6 · Lee lo que necesita la pestaña «Contabilidad» de la ficha de
// proveedor y cambia sus enlaces. Lo que decide qué se enseña es el núcleo
// (lib/cuentasProveedor.ts); aquí solo se lee y se llama a las funciones de la
// base, que llevan la guarda y el registro.
//
// Regla 9: todo lo que tiene account_id se filtra por la cuenta (y por la
// empresa donde la hay). vat_scheme y tax_form son catálogos GLOBALES del C00,
// sin account_id: se leen enteros a propósito.
//
// Nombres de la base entre comillas (regla 40), comprobados el 05/10 contra
// staging-conta (information_schema y pg_proc): company_tax_profile,
// company_account, company_account_link, tax_rate, withholding_rate,
// treasury_account, fiscal_year, vat_scheme, tax_form; company_account_link_set y
// company_account_link_unset (0160).

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import type { CuentaPlan } from '@/modules/conta/lib/planVista'
import type { Entidad, Papel } from '@/modules/conta/lib/planEmpresa'
import type { BancoConta, EnlaceCuenta, FilaConNorma, PerfilConta, RetencionConta, TasaConta } from '@/modules/conta/lib/cuentasProveedor'

type Fila = Record<string, unknown>

async function leer(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, que: string): Promise<Fila[]> {
  const { data, error } = await q
  if (error) throw new Error(mensaje(`No se ha podido leer ${que}`, error))
  return (data ?? []) as Fila[]
}

export interface DatosCuentasProveedor {
  /** ¿La empresa tiene el plan activado? Sin él, la pestaña lo dice y enlaza al plan. */
  activo: boolean
  perfil: PerfilConta
  cuentas: CuentaPlan[]
  enlaces: EnlaceCuenta[]
  tasas: TasaConta[]
  retenciones: RetencionConta[]
  bancos: BancoConta[]
  regimenes: FilaConNorma[]
  modelos: FilaConNorma[]
  /** Los ejercicios de la empresa, para el extracto «por ejercicio». */
  ejercicios: { code: string; inicio: string; fin: string }[]
}

export async function cargarCuentasProveedor(accountId: string, companyId: string): Promise<DatosCuentasProveedor> {
  const sistemaOCuenta = `is_system.eq.true,account_id.eq.${accountId}`
  const [perfiles, cuentas, enlaces, tasas, retenciones, bancos, regimenes, modelos, ejercicios] = await Promise.all([
    leer(tabla('company_tax_profile').select('vat_prorata, vat_prorata_pct, vat_surcharge, vat_cash_basis, sii, tax_forms').eq('account_id', accountId).eq('company_id', companyId), 'el perfil fiscal'),
    leer(tabla('company_account').select('id, code, template_code, name, plain_name, kind, status, is_common, source').eq('account_id', accountId).eq('company_id', companyId).order('code'), 'las cuentas de la empresa'),
    leer(tabla('company_account_link').select('company_account_id, entity, entity_id, role, source').eq('account_id', accountId).eq('company_id', companyId), 'los enlaces'),
    leer(tabla('tax_rate').select('id, name, rate, surcharge_rate').or(sistemaOCuenta), 'los tipos de IVA'),
    leer(tabla('withholding_rate').select('id, name, rate').or(sistemaOCuenta), 'las retenciones'),
    leer(tabla('treasury_account').select('id, name, iban').eq('account_id', accountId).eq('company_id', companyId).eq('kind', 'bank').eq('is_active', true).order('name'), 'los bancos'),
    leer(tabla('vat_scheme').select('code, name, legal_ref').in('code', ['recargo_equivalencia', 'criterio_caja']), 'los regímenes del IVA'),
    leer(tabla('tax_form').select('code, name, legal_ref').in('code', ['303', '349']), 'los modelos'),
    leer(tabla('fiscal_year').select('code, starts_on, ends_on').eq('account_id', accountId).eq('company_id', companyId).order('starts_on', { ascending: false }), 'los ejercicios'),
  ])
  const p = perfiles[0]
  const formas = Array.isArray(p?.tax_forms) ? (p!.tax_forms as unknown[]).map(String) : []
  const norma = (f: Fila): FilaConNorma => ({ code: String(f.code), name: String(f.name), legalRef: (f.legal_ref as string) ?? null })
  return {
    activo: cuentas.length > 0,
    perfil: {
      vatProrata: p?.vat_prorata === true, vatProrataPct: p?.vat_prorata_pct === null || p?.vat_prorata_pct === undefined ? null : Number(p.vat_prorata_pct),
      vatSurcharge: p?.vat_surcharge === true, vatCashBasis: p?.vat_cash_basis === true,
      presenta347: formas.includes('347') && p?.sii !== true,
    },
    cuentas: cuentas.map((c) => ({
      id: String(c.id), code: String(c.code), templateCode: String(c.template_code), name: String(c.name), plainName: (c.plain_name as string) ?? null,
      keywords: [], kind: c.kind === 'own' ? 'own' : 'template', status: (c.status as CuentaPlan['status']) ?? 'activa',
      isCommon: c.is_common === true, source: (c.source as CuentaPlan['source']) ?? 'serie',
    })),
    enlaces: enlaces.map((l) => ({
      companyAccountId: String(l.company_account_id), entity: l.entity as Entidad, entityId: String(l.entity_id), role: l.role as Papel,
      source: (l.source as EnlaceCuenta['source']) ?? 'serie',
    })),
    tasas: tasas.map((t) => ({ id: String(t.id), name: String(t.name), rate: Number(t.rate), surchargeRate: t.surcharge_rate === null ? null : Number(t.surcharge_rate) })),
    retenciones: retenciones.map((t) => ({ id: String(t.id), name: String(t.name), rate: Number(t.rate) })),
    bancos: bancos.map((b) => ({ id: String(b.id), name: String(b.name), iban: (b.iban as string) ?? null })),
    regimenes: regimenes.map(norma),
    modelos: modelos.map(norma),
    ejercicios: ejercicios.map((e) => ({ code: String(e.code), inicio: String(e.starts_on), fin: String(e.ends_on) })),
  }
}

/** Cambia la cuenta de un papel del proveedor (queda en el registro del plan). */
export const cambiarCuentaProveedor = (companyId: string, supplierId: string, papel: Papel, cuentaId: string, quien: string | null) =>
  rpc<void>('company_account_link_set', {
    p_company: companyId, p_entity: 'supplier', p_entity_id: supplierId, p_role: papel, p_account_id: cuentaId, p_quien_nombre: quien, p_source: 'manual',
  })

/** Quita un enlace propio (gasto, pago, suplidos): vuelve a lo de su tipo de gasto o a «no lleva». */
export const quitarCuentaProveedor = (companyId: string, supplierId: string, papel: Papel, quien: string | null) =>
  rpc<void>('company_account_link_unset', { p_company: companyId, p_entity: 'supplier', p_entity_id: supplierId, p_role: papel, p_quien_nombre: quien })

/**
 * Para la línea «Contabilidad» del resumen de la ficha (§5b): el código de su
 * cuenta (enlace principal) y el de sus facturas (lo suyo o lo de su tipo de
 * gasto). null si la empresa no tiene el plan activado.
 */
export async function cuentasDelResumen(accountId: string, companyId: string, supplierId: string, expenseCategoryId: string | null): Promise<{ suCuenta: string | null; facturas: string | null } | null> {
  const enlaces = await leer(tabla('company_account_link').select('company_account_id, entity, entity_id, role')
    .eq('account_id', accountId).eq('company_id', companyId)
    .or(`and(entity.eq.supplier,entity_id.eq.${supplierId}),and(entity.eq.expense_category,entity_id.eq.${expenseCategoryId ?? '-'})`), 'su cuenta')
  if (enlaces.length === 0) {
    const [alguna] = await leer(tabla('company_account').select('id').eq('account_id', accountId).eq('company_id', companyId).limit(1), 'el plan')
    if (!alguna) return null
  }
  const ids = [...new Set(enlaces.map((l) => String(l.company_account_id)))]
  const cuentas = ids.length ? await leer(tabla('company_account').select('id, code').eq('account_id', accountId).in('id', ids), 'sus cuentas') : []
  const code = (l: Fila | undefined) => (l ? (cuentas.find((c) => c.id === l.company_account_id)?.code as string) ?? null : null)
  const de = (entity: string, role: string) => enlaces.find((l) => l.entity === entity && l.role === role)
  return { suCuenta: code(de('supplier', 'principal')), facturas: code(de('supplier', 'gasto') ?? de('expense_category', 'principal')) }
}
