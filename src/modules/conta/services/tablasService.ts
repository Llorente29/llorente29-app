// src/modules/conta/services/tablasService.ts
//
// Leer y escribir las tablas generales (C00 §4.3). Genérico: lo que cambia de
// una tabla a otra está en el registro (src/modules/conta/tablas/registro.ts).
//
// Lo que se lee es de la EMPRESA activa: las filas de serie (iguales para
// todos) más las propias de esa empresa, más lo que ha cambiado de las de
// serie (general_row_setting). Los proveedores, de la cuenta (regla 9: con
// account_id).
//
// Nombres de la base entre comillas (regla 40), comprobados contra las
// migraciones 20261003T0100/0110/0120 y la del C01: tax_rate, withholding_rate,
// payment_method, payment_term, invoice_series, treasury_account,
// expense_category, entry_text, country, currency, general_row_setting,
// company, company_tax_profile, supplier.

import { tabla, mensaje } from '@/modules/conta/services/bd'
import type { AjusteSerie, CuentaEditable, DefinicionTabla, FilaGeneral, Valores } from '@/modules/conta/tablas/registro'
import { TABLAS_GENERALES } from '@/modules/conta/tablas/registro'
import type { ContextoUso, ProveedorParaUso } from '@/modules/conta/tablas/usadas'

export interface Quien {
  accountId: string
  companyId: string
  userId: string | null
}

type Fila = Record<string, unknown>

/** Las tablas que tienen columna `code` y la genera Folvy al añadir una fila propia. */
const CON_CODIGO_AUTOMATICO = new Set(['tax_rate', 'withholding_rate', 'payment_method', 'payment_term', 'entry_text', 'expense_category'])

function codigoDe(tablaBd: string, f: Fila): string {
  if (tablaBd === 'country') return String(f.alpha2)
  if (tablaBd === 'currency' || tablaBd === 'invoice_series') return String(f.code)
  if (tablaBd === 'treasury_account') return String(f.id)
  return String(f.code)
}

function aFilaGeneral(tablaBd: string, f: Fila, ajustes: Map<string, AjusteSerie>): FilaGeneral {
  const id = tablaBd === 'country' ? String(f.alpha2) : tablaBd === 'currency' ? String(f.code) : String(f.id)
  const serie = tablaBd === 'country' || tablaBd === 'currency' ? true : f.is_system === true
  return {
    id, tablaBd, code: codigoDe(tablaBd, f), serie, datos: f,
    validFrom: typeof f.valid_from === 'string' ? f.valid_from : null,
    validTo: typeof f.valid_to === 'string' ? f.valid_to : null,
    ajuste: ajustes.get(`${tablaBd}:${id}`) ?? null,
  }
}

async function leer(def: DefinicionTabla, tablaBd: string, companyId: string): Promise<Fila[]> {
  let q = tabla(tablaBd).select('*')
  if (def.deEmpresa) q = q.eq('company_id', companyId)
  else if (def.conSerie && tablaBd !== 'country' && tablaBd !== 'currency') q = q.or(`is_system.eq.true,company_id.eq.${companyId}`)
  const { data, error } = await q
  if (error) throw new Error(mensaje(`No se ha podido leer ${def.titulo.toLowerCase()}`, error))
  return (data ?? []) as Fila[]
}

export type FilasPorTabla = Record<string, FilaGeneral[]>

/** Todas las tablas de una vez (son pocas filas): así el menú lleva sus cifras. */
export async function cargarTablasGenerales(accountId: string, companyId: string): Promise<FilasPorTabla> {
  const { data: ajustesBd, error } = await tabla('general_row_setting').select('*').eq('account_id', accountId).eq('company_id', companyId)
  if (error) throw new Error(mensaje('No se han podido leer tus cambios en las tablas', error))
  const ajustes = new Map<string, AjusteSerie>()
  for (const a of (ajustesBd ?? []) as Fila[]) {
    ajustes.set(`${String(a.table_key)}:${String(a.row_id)}`, {
      hidden: a.hidden === true,
      pgc_hint: (a.pgc_hint as string | null) ?? null,
      pgc_input_hint: (a.pgc_input_hint as string | null) ?? null,
      pgc_output_hint: (a.pgc_output_hint as string | null) ?? null,
    })
  }
  const salida: FilasPorTabla = {}
  await Promise.all(TABLAS_GENERALES.map(async (def) => {
    const partes = await Promise.all(def.tablasBd.map(async (t) => (await leer(def, t, companyId)).map((f) => aFilaGeneral(t, f, ajustes))))
    salida[def.id] = partes.flat()
  }))
  // La forma de pago enseña el nombre de su banco o caja.
  const bancos = new Map((salida['bancos-y-cajas'] ?? []).map((b) => [b.id, String(b.datos.name)]))
  for (const f of salida['formas-de-pago'] ?? []) {
    const b = f.datos.treasury_account_id
    if (typeof b === 'string') f.datos = { ...f.datos, _banco: bancos.get(b) ?? null }
  }
  return salida
}

const numeros = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number).filter((n) => !Number.isNaN(n)) : [])
const numero = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const texto = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/** Lo que hace falta para saber qué filas usa la empresa. */
export async function cargarContextoUso(accountId: string, companyId: string, hoy: string): Promise<Omit<ContextoUso, 'hoy'> & { hoy: string }> {
  const [perfil, empresa, prov] = await Promise.all([
    tabla('company_tax_profile').select('tax_territory, tax_forms, account_digits').eq('company_id', companyId).maybeSingle(),
    tabla('company').select('fiscal_country').eq('id', companyId).maybeSingle(),
    tabla('supplier')
      .select('usual_vat_rates, irpf_withholding_pct, payment_method, payment_terms_days, payment_fixed_days, expense_category_id, country_code, currency, is_active, archived_at')
      .eq('account_id', accountId),
  ])
  for (const r of [perfil, empresa, prov]) if (r.error) throw new Error(mensaje('No se ha podido saber qué usas', r.error))
  const p = (perfil.data ?? null) as Fila | null
  const e = (empresa.data ?? null) as Fila | null
  const proveedores: ProveedorParaUso[] = ((prov.data ?? []) as Fila[])
    .filter((s) => s.is_active !== false && !s.archived_at)
    .map((s) => ({
      usualVatRates: numeros(s.usual_vat_rates),
      irpfPct: numero(s.irpf_withholding_pct),
      paymentMethod: texto(s.payment_method),
      paymentTermsDays: numero(s.payment_terms_days),
      paymentFixedDays: numeros(s.payment_fixed_days),
      expenseCategoryId: texto(s.expense_category_id),
      countryCode: texto(s.country_code),
      currency: texto(s.currency),
    }))
  return {
    territorio: texto(p?.tax_territory),
    modelos: Array.isArray(p?.tax_forms) ? (p.tax_forms as unknown[]).map(String) : [],
    pais: texto(e?.fiscal_country),
    proveedores,
    hoy,
    digitos: numero(p?.account_digits) ?? 8,
  }
}

// ── Escribir ────────────────────────────────────────────────────────────────

/** Ocultar o volver a mostrar una fila de serie, o cambiar sus cuentas. */
export async function guardarAjuste(q: Quien, def: DefinicionTabla, f: FilaGeneral,
  cambio: { hidden?: boolean; cuentas?: Partial<Record<CuentaEditable, string | null>> }): Promise<void> {
  if (!def.claveAjuste) throw new Error('Esta tabla no tiene filas de serie.')
  const actual = f.ajuste ?? { hidden: false, pgc_hint: null, pgc_input_hint: null, pgc_output_hint: null }
  const fila = {
    account_id: q.accountId, company_id: q.companyId, table_key: def.claveAjuste, row_id: f.id,
    hidden: cambio.hidden ?? actual.hidden,
    pgc_hint: cambio.cuentas && 'pgc_hint' in cambio.cuentas ? cambio.cuentas.pgc_hint ?? null : actual.pgc_hint,
    pgc_input_hint: cambio.cuentas && 'pgc_input_hint' in cambio.cuentas ? cambio.cuentas.pgc_input_hint ?? null : actual.pgc_input_hint,
    pgc_output_hint: cambio.cuentas && 'pgc_output_hint' in cambio.cuentas ? cambio.cuentas.pgc_output_hint ?? null : actual.pgc_output_hint,
    updated_at: new Date().toISOString(), updated_by: q.userId,
  }
  const { error } = await tabla('general_row_setting').upsert(fila, { onConflict: 'company_id,table_key,row_id' })
  if (error) throw new Error(mensaje('No se ha guardado', error))
}

/** Un código para una fila propia: no lo ve nadie, pero tiene que ser único. */
export function codigoPropio(nombre: string, azar: string = Math.random().toString(36).slice(2, 8)): string {
  const base = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30)
  return `propio_${base || 'fila'}_${azar}`
}

/** Añadir una fila propia de la empresa. Devuelve la fila guardada. */
export async function crearFila(q: Quien, def: DefinicionTabla, v: Valores): Promise<Fila> {
  const tablaBd = def.tablasBd[0]
  const base = def.aBase(v)
  const fila: Fila = { ...base, account_id: q.accountId, company_id: q.companyId, created_by: q.userId }
  if (def.conSerie) fila.is_system = false
  if (CON_CODIGO_AUTOMATICO.has(tablaBd)) fila.code = codigoPropio(String(base.name ?? base.text ?? ''))
  const { data, error } = await tabla(tablaBd).insert(fila).select('*').single()
  if (error) throw new Error(mensaje('No se ha añadido', error))
  return data as Fila
}

/** Cambiar una fila propia. Lo que es de la vigencia (% y fechas) no se toca aquí. */
export async function editarFila(def: DefinicionTabla, f: FilaGeneral, v: Valores): Promise<void> {
  if (f.serie) throw new Error('Una fila de serie no se edita: solo sus cuentas.')
  const base = def.aBase(v)
  for (const c of def.formulario) if (c.fijoAlEditar) delete base[c.clave]
  const { error } = await tabla(f.tablaBd).update(base).eq('id', f.id)
  if (error) throw new Error(mensaje('No se ha guardado', error))
}

/** Borrar una fila propia. */
export async function borrarFila(f: FilaGeneral): Promise<void> {
  if (f.serie) throw new Error('Una fila de serie no se borra: se oculta.')
  const { error } = await tabla(f.tablaBd).delete().eq('id', f.id)
  if (error) throw new Error(mensaje('No se ha borrado', error))
}

/** El día anterior a una fecha AAAA-MM-DD. */
export function diaAnterior(iso: string): string {
  const t = new Date(`${iso}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() - 1)
  return t.toISOString().slice(0, 10)
}

/**
 * Un porcentaje nuevo para una fila PROPIA con vigencia: se cierra la que vale
 * el día anterior y se abre otra con el mismo code. Nunca se edita el %.
 * Si la segunda escritura falla, se deshace la primera.
 */
export async function nuevaVigencia(q: Quien, f: FilaGeneral, rate: number, desde: string): Promise<void> {
  if (f.serie) throw new Error('El porcentaje de una fila de serie lo pone la ley: Folvy lo actualiza.')
  if (!f.validFrom || desde <= f.validFrom) throw new Error('La fecha nueva tiene que ser posterior a la de ahora.')
  const anterior = f.validTo
  if (anterior !== null && desde > anterior) throw new Error('Esa fila ya no vale en esa fecha: añade una nueva.')
  const cerrar = await tabla(f.tablaBd).update({ valid_to: diaAnterior(desde) }).eq('id', f.id)
  if (cerrar.error) throw new Error(mensaje('No se ha cerrado la anterior', cerrar.error))
  const copia: Fila = { ...f.datos }
  for (const c of ['id', 'created_at', '_banco']) delete copia[c]
  const abrir = await tabla(f.tablaBd).insert({ ...copia, rate, valid_from: desde, valid_to: anterior, created_by: q.userId })
  if (abrir.error) {
    await tabla(f.tablaBd).update({ valid_to: anterior }).eq('id', f.id)
    throw new Error(mensaje('No se ha guardado el porcentaje nuevo (la anterior queda como estaba)', abrir.error))
  }
}
