// src/modules/conta/services/planService.ts
//
// C02 · Leer y cambiar el plan contable de una empresa. Lo que cambia algo va
// SIEMPRE por las funciones de la base (20261007T0120/0130/0140), que llevan
// la guarda y el registro; las tablas no se escriben desde aquí.
//
// Nombres de la base entre comillas (regla 40), comprobados contra las
// migraciones 20261007T0100–0140 y las del C00/C01: pgc_account,
// company_account, company_account_link, company_account_log,
// company_tax_profile, supplier, treasury_account; funciones
// company_chart_activate, company_account_add, company_account_set_hidden,
// company_account_set_keywords, company_account_link_set. Y para las
// propuestas de la IA (tarea 5, 0180; comprobados el 05/10 en staging):
// expense_category (pgc_account_hint, supplier_account_leaf), tax_rate,
// ai_suggestion; función company_plan_propuesta_responder.

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import type { CuentaPlan, CuentaSeriePlan, EnlacePlan } from '@/modules/conta/lib/planVista'
import type { Entidad, HojaProveedor, Papel } from '@/modules/conta/lib/planEmpresa'
import type { OpPlan, Propuesta, ProveedorPropuesta } from '@/modules/conta/lib/propuestasPlan'

type Fila = Record<string, unknown>

export interface EntradaRegistroPlan { id: string; que: string; code: string | null; detalle: string; doneAt: string; doneByName: string | null; source: string }

export interface DatosPlan {
  plan: 'pymes' | 'general'
  digitos: number
  activo: boolean
  serie: CuentaSeriePlan[]
  cuentas: CuentaPlan[]
  enlaces: EnlacePlan[]
  registro: EntradaRegistroPlan[]
  proveedores: { id: string; name: string }[]
  bancos: { id: string; name: string }[]
  /** Lo que necesita el núcleo de las propuestas de la IA (propuestasPlan.ts). */
  paraPropuestas: {
    proveedores: ProveedorPropuesta[]
    gastos: { id: string; name: string; pgcHint: string | null }[]
    /** Con el ejemplo de la tabla del C00: es el «qué se apunta aquí» de su 472/477 (respuesta 3). */
    tiposIva: { id: string; name: string; rate: number; example: string | null }[]
    contestadas: string[]
  }
}

async function leer<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, que: string): Promise<T[]> {
  const { data, error } = await q
  if (error) throw new Error(mensaje(`No se ha podido leer ${que}`, error))
  return (data ?? []) as T[]
}

export async function cargarPlan(accountId: string, companyId: string): Promise<DatosPlan> {
  const [perfil] = await leer<Fila>(tabla('company_tax_profile').select('chart_kind, account_digits, tax_territory').eq('account_id', accountId).eq('company_id', companyId), 'el detalle contable')
  const plan = perfil?.chart_kind === 'normal' ? 'general' : 'pymes'
  const digitos = Number(perfil?.account_digits ?? 8)
  const hoy = new Date().toISOString().slice(0, 10)
  const sistema = perfil?.tax_territory === 'canarias' ? 'igic' : 'iva'
  const [serie, cuentas, enlaces, registro, proveedores, bancos, gastos, tipos, contestadas] = await Promise.all([
    leer<Fila>(tabla('pgc_account').select('code, name, plain_name, boe_definition, group_code, parent_code, is_leaf').eq('plan', plan).is('valid_to', null).order('code'), 'el cuadro de cuentas'),
    leer<Fila>(tabla('company_account').select('id, code, template_code, name, plain_name, keywords, kind, status, is_common, source').eq('account_id', accountId).eq('company_id', companyId).order('code'), 'las cuentas de la empresa'),
    leer<Fila>(tabla('company_account_link').select('company_account_id, entity, entity_id, role').eq('account_id', accountId).eq('company_id', companyId), 'los enlaces'),
    leer<Fila>(tabla('company_account_log').select('id, que, code, detalle, done_at, done_by_name, source').eq('account_id', accountId).eq('company_id', companyId).order('done_at', { ascending: false }).limit(50), 'el historial del plan'),
    leer<Fila>(tabla('supplier').select('id, name, expense_category_id, vat_regime, country_code').eq('account_id', accountId).is('archived_at', null).order('name'), 'los proveedores'),
    leer<Fila>(tabla('treasury_account').select('id, name').eq('account_id', accountId).eq('company_id', companyId).eq('kind', 'bank').eq('is_active', true).order('name'), 'los bancos'),
    leer<Fila>(tabla('expense_category').select('id, name, pgc_account_hint, supplier_account_leaf, company_id').or(`is_system.eq.true,account_id.eq.${accountId}`), 'los tipos de gasto'),
    leer<Fila>(tabla('tax_rate').select('id, name, rate, example, company_id').eq('tax_system', sistema).eq('treatment', 'taxed')
      .or(`is_system.eq.true,account_id.eq.${accountId}`).or(`valid_to.is.null,valid_to.gte.${hoy}`), 'los tipos de IVA'),
    leer<Fila>(tabla('ai_suggestion').select('reason_key').eq('account_id', accountId).eq('company_id', companyId).eq('kind', 'plan'), 'las propuestas contestadas'),
  ])
  // Las filas propias de la cuenta valen para toda la cuenta o para ESTA empresa.
  const deEsta = (f: Fila) => f.company_id === null || f.company_id === undefined || f.company_id === companyId
  const gastoDe = new Map(gastos.filter(deEsta).map((g) => [String(g.id), g]))
  return {
    plan, digitos, activo: cuentas.length > 0,
    serie: serie.map((s) => ({ code: String(s.code), name: String(s.name), plainName: (s.plain_name as string) ?? null, boeDefinition: (s.boe_definition as string) ?? null, groupCode: Number(s.group_code), parentCode: (s.parent_code as string) ?? null, isLeaf: s.is_leaf === true })),
    cuentas: cuentas.map((c) => ({
      id: String(c.id), code: String(c.code), templateCode: String(c.template_code), name: String(c.name), plainName: (c.plain_name as string) ?? null,
      keywords: Array.isArray(c.keywords) ? (c.keywords as unknown[]).map(String) : [], kind: c.kind === 'own' ? 'own' : 'template',
      status: (c.status as CuentaPlan['status']) ?? 'activa', isCommon: c.is_common === true, source: (c.source as CuentaPlan['source']) ?? 'serie',
    })),
    enlaces: enlaces.map((l) => ({ companyAccountId: String(l.company_account_id), entity: l.entity as Entidad, entityId: String(l.entity_id), role: l.role as Papel })),
    registro: registro.map((r) => ({ id: String(r.id), que: String(r.que), code: (r.code as string) ?? null, detalle: String(r.detalle), doneAt: String(r.done_at), doneByName: (r.done_by_name as string) ?? null, source: String(r.source) })),
    proveedores: proveedores.map((p) => ({ id: String(p.id), name: String(p.name) })),
    bancos: bancos.map((b) => ({ id: String(b.id), name: String(b.name) })),
    paraPropuestas: {
      proveedores: proveedores.map((p) => {
        const g = p.expense_category_id ? gastoDe.get(String(p.expense_category_id)) : undefined
        return {
          id: String(p.id), name: String(p.name), gastoPista: (g?.pgc_account_hint as string) ?? null,
          marca: (g?.supplier_account_leaf as HojaProveedor | null) ?? null, vatRegime: (p.vat_regime as string) ?? null, countryCode: (p.country_code as string) ?? 'ES',
        }
      }),
      gastos: [...gastoDe.values()].map((g) => ({ id: String(g.id), name: String(g.name), pgcHint: (g.pgc_account_hint as string) ?? null })),
      tiposIva: tipos.filter(deEsta).map((t) => ({ id: String(t.id), name: String(t.name), rate: Number(t.rate), example: (t.example as string) ?? null })),
      contestadas: contestadas.map((c) => String(c.reason_key)),
    },
  }
}

/**
 * Contesta una propuesta de la IA (0180): se guarda la respuesta y, si es sí,
 * se hacen sus operaciones todas o ninguna, con origen «IA aceptada».
 * `ops` es la respuesta elegida: las del sí o las de la alternativa.
 */
export const responderPropuesta = (companyId: string, p: Propuesta, acepta: boolean, ops: OpPlan[], quien: string | null) =>
  rpc<{ id: string; aceptada: boolean; hechas: number }>('company_plan_propuesta_responder', {
    p_company: companyId, p_clave: p.clave, p_titulo: p.titulo, p_porque: p.porque, p_confianza: p.confianza,
    p_acepta: acepta, p_ops: acepta ? ops : p.ops, p_quien_nombre: quien,
  })

export interface ResultadoActivar { plan: string; digitos: number; cuentas: number; subcuentas: number; enlaces: number; avisos: string[] }

export const activarPlan = (companyId: string, cuentaComun: boolean, quien: string | null) =>
  rpc<ResultadoActivar>('company_chart_activate', { p_company: companyId, p_comun_proveedores: cuentaComun, p_quien_nombre: quien })

export const anadirSubcuenta = (companyId: string, hoja: string, nombre: string, plain: string | null, enlace: { entity: Entidad; id: string } | null, quien: string | null) =>
  rpc<{ id: string; code: string }>('company_account_add', {
    p_company: companyId, p_hoja: hoja, p_nombre: nombre, p_plain_name: plain, p_entity: enlace?.entity ?? null, p_entity_id: enlace?.id ?? null, p_quien_nombre: quien,
  })

export const ocultarCuenta = (id: string, oculta: boolean, quien: string | null) =>
  rpc<void>('company_account_set_hidden', { p_id: id, p_oculta: oculta, p_quien_nombre: quien })

export const ponerPalabras = (id: string, palabras: string[], quien: string | null) =>
  rpc<string[]>('company_account_set_keywords', { p_id: id, p_palabras: palabras, p_quien_nombre: quien })

export const cambiarEnlace = (companyId: string, entity: Entidad, entityId: string, role: Papel, cuentaId: string, quien: string | null) =>
  rpc<void>('company_account_link_set', { p_company: companyId, p_entity: entity, p_entity_id: entityId, p_role: role, p_account_id: cuentaId, p_quien_nombre: quien })

/** «Deshacer» justo después de añadir una subcuenta (sin enlaces ni historial; 20261007T0150). */
export const deshacerSubcuenta = (id: string, quien: string | null) =>
  rpc<void>('company_account_undo_add', { p_id: id, p_quien_nombre: quien })
