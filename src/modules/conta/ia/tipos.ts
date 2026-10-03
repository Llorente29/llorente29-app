// src/modules/conta/ia/tipos.ts
//
// La base de la IA del módulo (C00 §6.1–6.3), en puro: cuándo un dato lleva
// la marca «IA» y cómo se dice en palabras lo que la IA hizo. Sin React ni
// base de datos.

/** De dónde sale un dato que no escribió una persona (ai_data_origin). */
export interface Origen {
  tableKey: string
  rowId: string
  field: string
  source: 'ai' | 'import'
  /** Lo que puso: si el dato ya vale otra cosa, lo cambió una persona. */
  valueSet: unknown
  reason: string
  setAt: string
}

export interface Sugerencia {
  id: string
  kind: string
  reasonKey: string
  title: string
  why: string
  payload: Record<string, unknown>
}

/** Lo que queda hecho al aceptar una sugerencia, dicho con contenido (regla 8). */
export function hechoAlAceptar(s: Sugerencia): string {
  if (s.kind === 'modelo' && typeof s.payload.modelo === 'string') {
    return `Añadido el modelo ${s.payload.modelo} a lo que presentas. Si no era así, lo deshaces en «Lo que ha hecho Folvy».`
  }
  return 'Hecho. Si no era así, lo deshaces en «Lo que ha hecho Folvy».'
}

export interface Registro {
  id: string
  action: 'poner' | 'anadir_actividad'
  source: 'ai' | 'import'
  tableKey: string
  field: string | null
  before: unknown
  after: unknown
  reason: string
  doneAt: string
  doneForName: string | null
  undoneAt: string | null
  undoneByName: string | null
  suggestionId: string | null
  /** El nombre del valor puesto, cuando el valor es un código de un catálogo (la forma jurídica). */
  afterName?: string | null
}

/** Igualdad de valores tal como los guarda la base (jsonb) y los lee la app. */
export function mismoValor(a: unknown, b: unknown): boolean {
  const norma = (v: unknown): unknown => {
    if (v === undefined) return null
    if (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) && /^-?\d+(\.\d+)?$/.test(v)) return Number(v)
    if (Array.isArray(v)) return v.map(norma)
    return v
  }
  return JSON.stringify(norma(a)) === JSON.stringify(norma(b))
}

/**
 * La marca de un dato: el origen, si lo puso la IA (o vino importado) y SIGUE
 * valiendo eso. Si la persona lo cambió, no hay marca (encargo §6.1).
 */
export function marcaDe(origenes: Origen[], tableKey: string, rowId: string, field: string, valorActual: unknown): Origen | null {
  const o = origenes.find((x) => x.tableKey === tableKey && x.rowId === rowId && x.field === field)
  return o && mismoValor(o.valueSet, valorActual) ? o : null
}

// ── Lo que hizo la IA, en palabras ──────────────────────────────────────────

const CAMPO: Record<string, string> = {
  legal_name: 'la razón social', trade_name: 'el nombre comercial', legal_form_code: 'el tipo de empresa',
  fiscal_street_type: 'el tipo de vía', fiscal_street: 'la calle', fiscal_number: 'el número', fiscal_postal_code: 'el código postal',
  fiscal_city: 'la población', fiscal_province: 'la provincia', tax_territory: 'dónde está tu empresa',
  vat_scheme_code: 'el régimen del IVA', vat_period: 'cada cuánto presentas el IVA', vat_cash_basis: 'el criterio de caja',
  vat_surcharge: 'el recargo de equivalencia', chart_kind: 'el plan contable', account_digits: 'los dígitos de las cuentas',
  tax_forms: 'los modelos que presentas', sales_tax_rate_code: 'el IVA de tus ventas',
}

const VALOR: Record<string, Record<string, string>> = {
  vat_period: { quarterly: 'cada tres meses', monthly: 'cada mes' },
  tax_territory: { peninsula_baleares: 'Península y Baleares', canarias: 'Canarias', ceuta_melilla: 'Ceuta y Melilla' },
  chart_kind: { pymes: 'el plan de pymes', normal: 'el plan general' },
  sales_tax_rate_code: { iva_reducido: '10 %', iva_general: '21 %', iva_superreducido: '4 %' },
}

export function valorEnPalabras(field: string | null, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'nada'
  if (typeof v === 'boolean') return v ? 'sí' : 'no'
  if (Array.isArray(v)) return v.length ? v.map(String).join(', ') : 'ninguno'
  const s = String(v)
  return (field && VALOR[field]?.[s]) ?? s
}

/** «Puso cada cuánto presentas el IVA: cada tres meses.» */
export function queHizo(r: Registro): string {
  if (r.action === 'anadir_actividad') {
    const desc = r.after && typeof r.after === 'object' ? String((r.after as Record<string, unknown>).description ?? '') : ''
    return `Añadió la actividad «${desc}»`
  }
  const campo = CAMPO[r.field ?? ''] ?? r.field ?? 'un dato'
  // «Cambió» solo si había OTRA cosa: dejar el valor que ya tenía (el de
  // serie de la columna) es ponerlo, no cambiarlo.
  const vacio = r.before === null || r.before === undefined || r.before === '' || (Array.isArray(r.before) && r.before.length === 0)
  const cambio = !vacio && !mismoValor(r.before, r.after)
  const verbo = r.source === 'import' ? 'Trajo de tu cuenta' : cambio ? 'Cambió' : 'Puso'
  return `${verbo} ${campo}: ${r.afterName ?? valorEnPalabras(r.field, r.after)}`
}

/** Si se puede deshacer y, si no, por qué. */
export function sePuedeDeshacer(r: Registro): { ok: true } | { ok: false; motivo: string } {
  if (r.undoneAt) return { ok: false, motivo: `Deshecho${r.undoneByName ? ` por ${r.undoneByName}` : ''}` }
  return { ok: true }
}
