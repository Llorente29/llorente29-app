// src/modules/conta/services/empresaDatosService.ts
//
// Ajustes › Tu empresa (C00, tarea 5): leer y cambiar los datos de UNA
// empresa. Todo cuelga de la empresa y de su cuenta (regla 9), además de la
// RLS. Los socios solo los ve un administrador: a quien no lo es no se le
// piden (la RLS devolvería cero filas, y cero no es «no hay socios»).
//
// Nombres de la base entre comillas (regla 40), comprobados contra las
// migraciones 20261003T0100/0110/0150: company, company_tax_profile,
// company_activity, iae_heading, cnae_code, fiscal_year, fiscal_period_lock,
// company_person, legal_form, vat_scheme, tax_form; RPC conta_cerrar_mes,
// conta_reabrir_mes y conta_hacer_principal. La prueba tests/unit/modules/
// conta/empresaC00.test.ts lo comprueba.

import { tabla, mensaje, rpc } from '@/modules/conta/services/bd'
import type {
  Actividad, CambiosQuienEres, Cierre, DatosEmpresa, Empresa, EjercicioBd, Opcion, PerfilFiscal, Socio,
} from '@/modules/conta/empresa/datosEmpresa'
import type { Ejercicio } from '@/modules/conta/lib/ejercicios'
import { limpiarTitulo } from '@/modules/conta/empresa/datosEmpresa'
import { cargarIa } from '@/modules/conta/services/iaService'

type Fila = Record<string, unknown>
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const nulo = (s: string): string | null => (s.trim() === '' ? null : s.trim())

/** El mensaje de una RPC sin el nombre de la función delante: se enseña tal cual. */
const sinPrefijo = (e: unknown): Error => new Error((e instanceof Error ? e.message : String(e)).replace(/^conta_[a-z_]+: /, ''))

function aEmpresa(r: Fila): Empresa {
  return {
    id: String(r.id), legalName: txt(r.legal_name), tradeName: txt(r.trade_name), taxId: txt(r.tax_id),
    taxIdVerifiedAt: txt(r.tax_id_verified_at), entityKind: (txt(r.entity_kind) as Empresa['entityKind']),
    legalFormCode: txt(r.legal_form_code), fiscalStreetType: txt(r.fiscal_street_type), fiscalStreet: txt(r.fiscal_street),
    fiscalNumber: txt(r.fiscal_number), fiscalExtra: txt(r.fiscal_extra), fiscalPostalCode: txt(r.fiscal_postal_code),
    fiscalCity: txt(r.fiscal_city), fiscalProvince: txt(r.fiscal_province), fiscalCountry: txt(r.fiscal_country) ?? 'ES',
    registryName: txt(r.registry_name), registrySheet: txt(r.registry_sheet),
    setupStep: txt(r.setup_step) ?? 'nif', setupCompletedAt: txt(r.setup_completed_at),
  }
}

function aPerfil(r: Fila): PerfilFiscal {
  return {
    taxTerritory: (txt(r.tax_territory) ?? 'peninsula_baleares') as PerfilFiscal['taxTerritory'],
    vatSchemeCode: txt(r.vat_scheme_code), vatCashBasis: r.vat_cash_basis === true, vatSurcharge: r.vat_surcharge === true,
    vatPeriod: r.vat_period === 'monthly' ? 'monthly' : 'quarterly', vatProrata: r.vat_prorata === true,
    vatProrataPct: num(r.vat_prorata_pct), sii: r.sii === true, chartKind: r.chart_kind === 'normal' ? 'normal' : 'pymes',
    accountDigits: Number(r.account_digits ?? 8), taxForms: Array.isArray(r.tax_forms) ? (r.tax_forms as unknown[]).map(String) : [],
  }
}

async function leer<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>, que: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(mensaje(`No se ha podido leer ${que}`, error))
  return data as T
}

export async function cargarDatosEmpresa(accountId: string, companyId: string, esAdmin: boolean): Promise<DatosEmpresa> {
  const [empresa, perfil, acts, ejs, locks, socios, formas, regimenes, modelos] = await Promise.all([
    leer<Fila | null>(tabla('company').select('*').eq('id', companyId).eq('account_id', accountId).maybeSingle(), 'la empresa'),
    leer<Fila | null>(tabla('company_tax_profile').select('*').eq('company_id', companyId).maybeSingle(), 'tus impuestos'),
    leer<Fila[]>(tabla('company_activity').select('*').eq('company_id', companyId).order('is_main', { ascending: false }).order('started_on'), 'a qué te dedicas'),
    leer<Fila[]>(tabla('fiscal_year').select('id, code, starts_on, ends_on, status').eq('company_id', companyId).order('starts_on'), 'los ejercicios'),
    leer<Fila[]>(tabla('fiscal_period_lock').select('month, locked_at, locked_by_name').eq('company_id', companyId).is('reopened_at', null), 'los meses cerrados'),
    esAdmin
      ? leer<Fila[]>(tabla('company_person').select('*').eq('company_id', companyId).order('ownership_pct', { ascending: false, nullsFirst: false }), 'los socios')
      : Promise.resolve(null),
    leer<Fila[]>(tabla('legal_form').select('code, name').order('sort_order'), 'las formas jurídicas'),
    leer<Fila[]>(tabla('vat_scheme').select('code, name').order('sort_order'), 'los regímenes del IVA'),
    leer<Fila[]>(tabla('tax_form').select('code, name').order('code'), 'los modelos'),
  ])
  if (!empresa) throw new Error('Esa empresa no está en tu cuenta.')
  const ia = await cargarIa(companyId)

  // Títulos del IAE y de la CNAE de las actividades, en dos lecturas.
  const iaes = [...new Set(acts.map((a) => txt(a.iae_code)).filter((c): c is string => c !== null))]
  const cnaes = [...new Set(acts.map((a) => txt(a.cnae_code)).filter((c): c is string => c !== null))]
  const [titIae, titCnae] = await Promise.all([
    iaes.length ? leer<Fila[]>(tabla('iae_heading').select('code, title').in('code', iaes), 'los epígrafes') : Promise.resolve([] as Fila[]),
    cnaes.length ? leer<Fila[]>(tabla('cnae_code').select('code, title').eq('version', '2025').in('code', cnaes), 'la CNAE') : Promise.resolve([] as Fila[]),
  ])
  const iae = new Map(titIae.map((r) => [String(r.code), limpiarTitulo(String(r.title))]))
  const cnae = new Map(titCnae.map((r) => [String(r.code), limpiarTitulo(String(r.title))]))

  const opcion = (r: Fila): Opcion => ({ code: String(r.code), name: String(r.name) })
  return {
    empresa: aEmpresa(empresa),
    perfil: perfil ? aPerfil(perfil) : null,
    actividades: acts.map((a): Actividad => ({
      id: String(a.id), kind: (txt(a.kind) ?? 'business') as Actividad['kind'],
      iaeCode: txt(a.iae_code), iaeTitle: iae.get(String(a.iae_code)) ?? null,
      cnaeCode: txt(a.cnae_code), cnaeTitle: cnae.get(String(a.cnae_code)) ?? null,
      description: String(a.description), startedOn: txt(a.started_on), endedOn: txt(a.ended_on), isMain: a.is_main === true,
    })),
    ejercicios: ejs.map((e): EjercicioBd => ({
      id: String(e.id), code: String(e.code), startsOn: String(e.starts_on), endsOn: String(e.ends_on),
      status: e.status === 'closed' ? 'closed' : 'open',
    })),
    cierres: locks.map((l): Cierre => ({ mes: String(l.month), quien: txt(l.locked_by_name), cuando: String(l.locked_at) })),
    socios: socios === null ? null : socios.map((s): Socio => ({
      id: String(s.id), fullName: String(s.full_name), taxId: txt(s.tax_id),
      roles: Array.isArray(s.roles) ? (s.roles as unknown[]).map(String) : [], ownershipPct: num(s.ownership_pct),
      startedOn: txt(s.started_on), endedOn: txt(s.ended_on),
    })),
    formasJuridicas: formas.map(opcion),
    regimenes: regimenes.map(opcion),
    modelos: modelos.map(opcion),
    ia,
  }
}

// ── Quién eres ──────────────────────────────────────────────────────────────

export async function guardarQuienEres(companyId: string, userId: string | null, c: CambiosQuienEres): Promise<void> {
  const { error } = await tabla('company').update({
    legal_name: c.legalName.trim(), trade_name: nulo(c.tradeName), legal_form_code: nulo(c.legalFormCode),
    fiscal_street_type: nulo(c.fiscalStreetType), fiscal_street: nulo(c.fiscalStreet), fiscal_number: nulo(c.fiscalNumber),
    fiscal_extra: nulo(c.fiscalExtra), fiscal_postal_code: nulo(c.fiscalPostalCode), fiscal_city: nulo(c.fiscalCity),
    fiscal_province: nulo(c.fiscalProvince), registry_name: nulo(c.registryName), registry_sheet: nulo(c.registrySheet),
    updated_by: userId,
  }).eq('id', companyId)
  if (error) throw new Error(mensaje('No se ha guardado', error))
}

// ── Tus impuestos y detalle contable ────────────────────────────────────────

export async function guardarPerfil(accountId: string, companyId: string, userId: string | null, p: PerfilFiscal): Promise<void> {
  const { error } = await tabla('company_tax_profile').upsert({
    company_id: companyId, account_id: accountId, tax_territory: p.taxTerritory, vat_scheme_code: p.vatSchemeCode,
    vat_cash_basis: p.vatCashBasis, vat_surcharge: p.vatSurcharge, vat_period: p.vatPeriod, vat_prorata: p.vatProrata,
    vat_prorata_pct: p.vatProrata ? p.vatProrataPct : null, sii: p.sii, chart_kind: p.chartKind,
    account_digits: p.accountDigits, tax_forms: p.taxForms, updated_by: userId,
  }, { onConflict: 'company_id' })
  if (error) throw new Error(mensaje('No se ha guardado', error))
}

// ── A qué te dedicas ────────────────────────────────────────────────────────

export interface OpcionCodigo { code: string; title: string }

/** Epígrafes del IAE (los de último nivel) cuyo título o número contiene el texto. */
export async function buscarIae(texto: string): Promise<OpcionCodigo[]> {
  const t = texto.trim().replace(/[%_,()]/g, ' ')
  if (t.length < 2) return []
  const { data, error } = await tabla('iae_heading').select('code, title, level')
    .or(`title.ilike.%${t}%,code.ilike.%${t.replace(/\./g, '')}%`).in('level', ['grupo', 'epigrafe']).order('code').limit(20)
  if (error) throw new Error(mensaje('No se ha podido buscar en el IAE', error))
  return ((data ?? []) as Fila[]).map((r) => ({ code: String(r.code), title: limpiarTitulo(String(r.title)) }))
}

/** Clases de la CNAE-2025 (cuatro cifras) cuyo título o código contiene el texto. */
export async function buscarCnae(texto: string): Promise<OpcionCodigo[]> {
  const t = texto.trim().replace(/[%_,()]/g, ' ')
  if (t.length < 2) return []
  const { data, error } = await tabla('cnae_code').select('code, title').eq('version', '2025').eq('level', 4)
    .or(`title.ilike.%${t}%,code.ilike.%${t}%`).order('code').limit(20)
  if (error) throw new Error(mensaje('No se ha podido buscar en la CNAE', error))
  return ((data ?? []) as Fila[]).map((r) => ({ code: String(r.code), title: limpiarTitulo(String(r.title)) }))
}

export interface NuevaActividad {
  description: string
  kind: Actividad['kind']
  iaeCode: string | null
  cnaeCode: string | null
  startedOn: string | null
  /** La primera de la empresa es la principal por fuerza. */
  isMain: boolean
}

export async function anadirActividad(accountId: string, companyId: string, userId: string | null, a: NuevaActividad): Promise<void> {
  const { error } = await tabla('company_activity').insert({
    account_id: accountId, company_id: companyId, description: a.description.trim(), kind: a.kind,
    iae_code: a.iaeCode, cnae_version: '2025', cnae_code: a.cnaeCode, started_on: a.startedOn, is_main: a.isMain, created_by: userId,
  })
  if (error) throw new Error(mensaje('No se ha añadido', error))
}

export async function hacerPrincipal(actividadId: string): Promise<void> {
  try { await rpc('conta_hacer_principal', { p_actividad: actividadId }) } catch (e) { throw sinPrefijo(e) }
}

/** Dejar una actividad (no la principal si quedan otras: antes se elige otra). */
export async function terminarActividad(actividadId: string, fecha: string): Promise<void> {
  const { error } = await tabla('company_activity').update({ ended_on: fecha, is_main: false }).eq('id', actividadId)
  if (error) throw new Error(mensaje('No se ha guardado', error))
}

// ── Ejercicios y meses ──────────────────────────────────────────────────────

export async function abrirEjercicio(accountId: string, companyId: string, userId: string | null, e: Ejercicio, anteriorId: string | null): Promise<void> {
  const { error } = await tabla('fiscal_year').insert({
    account_id: accountId, company_id: companyId, code: e.code, starts_on: e.startsOn, ends_on: e.endsOn,
    previous_year_id: anteriorId, created_by: userId,
  })
  if (error) throw new Error(mensaje('No se ha abierto el ejercicio', error))
}

export async function cerrarMes(companyId: string, mes: string): Promise<void> {
  try { await rpc('conta_cerrar_mes', { p_company: companyId, p_mes: mes }) } catch (e) { throw sinPrefijo(e) }
}

export async function reabrirMes(companyId: string, mes: string, motivo: string): Promise<void> {
  try { await rpc('conta_reabrir_mes', { p_company: companyId, p_mes: mes, p_motivo: motivo }) } catch (e) { throw sinPrefijo(e) }
}

// ── Socios y cargos ─────────────────────────────────────────────────────────

export interface CambiosSocio {
  fullName: string
  taxId: string
  roles: string[]
  ownershipPct: string
}

export async function guardarSocio(accountId: string, companyId: string, userId: string | null, id: string | null, c: CambiosSocio): Promise<void> {
  const fila = {
    full_name: c.fullName.trim(), tax_id: nulo(c.taxId), roles: c.roles,
    ownership_pct: c.ownershipPct.trim() === '' ? null : Number(c.ownershipPct.replace(',', '.')),
  }
  const { error } = id
    ? await tabla('company_person').update(fila).eq('id', id)
    : await tabla('company_person').insert({ ...fila, account_id: accountId, company_id: companyId, created_by: userId })
  if (error) throw new Error(mensaje('No se ha guardado', error))
}

/** Deja de ser socio o de tener el cargo: no se borra, se le pone fecha de fin. */
export async function darDeBajaSocio(id: string, fecha: string): Promise<void> {
  const { error } = await tabla('company_person').update({ ended_on: fecha }).eq('id', id)
  if (error) throw new Error(mensaje('No se ha guardado', error))
}
