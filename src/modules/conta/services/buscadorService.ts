// src/modules/conta/services/buscadorService.ts
//
// M01 · Lo que el buscador general (Ctrl K) busca en la base: asientos (número,
// concepto), facturas recibidas (número, proveedor, NIF, importe), clientes y
// proveedores (nombre, NIF) y subcuentas (código, nombre). Cinco de cada.
//
// Regla 9: TODA consulta lleva `account_id`, y la empresa cuando la tabla la
// tiene (asientos, facturas y subcuentas son de una empresa; los terceros, de
// la cuenta). Regla 40: los nombres de tabla y columna de aquí se comprobaron
// contra el esquema de producción el 15/10 (information_schema y las claves
// ajenas supplier_invoice_supplier_id_fkey y party_role_party_id_fkey).
//
// Cada grupo es una consulta suelta: si una falla, las demás salen y la que
// falla lo dice en su grupo (regla 8).

import { tabla, mensaje } from '@/modules/conta/services/bd'
import { rutaAsiento, rutaMayor, rutaRevisarFactura } from '@/config/navegacion'
import { NOMBRE_SERIE, type Serie } from '@/modules/conta/lib/libro'
import { diaMesCorto, eurosExactos } from '@/modules/conta/lib/formato'
import { rutaDeTercero, type Papel } from '@/modules/conta/lib/terceros'
import { paraIlike, POR_GRUPO, vivoPrimero, type Consulta, type Resultado, type TipoResultado } from '@/modules/conta/marco/nuevo/buscar'

type Fila = Record<string, unknown>

async function filas(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, que: string): Promise<Fila[]> {
  const { data, error } = await q
  if (error) throw new Error(mensaje(`No he podido buscar ${que}`, error))
  return (data ?? []) as Fila[]
}

const txt = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))
const conMiles = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

const ESTADO: Record<string, string> = { propuesto: 'para revisar', borrador: 'borrador', validado: 'validado', anulado: 'anulado' }

export async function buscarAsientos(accountId: string, companyId: string, c: Consulta): Promise<Resultado[]> {
  const t = paraIlike(c.texto)
  // Lo vivo primero (Julio, 16/10): los anulados no se comen el sitio de los
  // vivos. Dos lecturas, y los anulados rellenan lo que quede del grupo.
  const consulta = (anulados: boolean) => {
    let q = tabla('journal_entry').select('id, series, number, entry_date, concept, status')
      .eq('account_id', accountId).eq('company_id', companyId)
    q = anulados ? q.eq('status', 'anulado') : q.neq('status', 'anulado')
    q = c.entero !== null ? q.or(`number.eq.${c.entero},concept.ilike."*${t}*"`) : q.ilike('concept', `%${t}%`)
    return filas(q.order('entry_date', { ascending: false }).limit(POR_GRUPO), 'en los asientos')
  }
  const [vivos, anulados] = await Promise.all([consulta(false), consulta(true)])
  const r = [...vivos, ...anulados].slice(0, POR_GRUPO)
  return r.map((f) => {
    const n = num(f.number)
    const serie = NOMBRE_SERIE[(num(f.series) ?? 4) as Serie] ?? 'General'
    return {
      clave: `asiento:${txt(f.id)}`, tipo: 'asiento' as const, ruta: rutaAsiento(txt(f.id)),
      titulo: txt(f.concept) || 'Asiento sin concepto',
      apoyo: [txt(f.entry_date) ? diaMesCorto(txt(f.entry_date)) + '/' + txt(f.entry_date).slice(0, 4) : null, ESTADO[txt(f.status)] ?? txt(f.status)].filter(Boolean).join(' · '),
      cifra: n === null ? `${serie} —` : `${serie} ${conMiles(n)}`,
      apagado: f.status === 'anulado',
    }
  })
}

export async function buscarFacturas(accountId: string, companyId: string, c: Consulta): Promise<Resultado[]> {
  const t = paraIlike(c.texto)
  // Por el nombre del proveedor: primero quién se llama así (en esta cuenta).
  const proveedores = t.length >= 2
    ? (await filas(tabla('supplier').select('id').eq('account_id', accountId).ilike('name', `%${t}%`).limit(20), 'en los proveedores')).map((f) => txt(f.id))
    : []
  const o = [`invoice_number.ilike."*${t}*"`, `issuer_name.ilike."*${t}*"`, `issuer_tax_id.ilike."*${t}*"`]
  if (c.importe !== null) o.push(`grand_total.eq.${c.importe}`)
  if (proveedores.length) o.push(`supplier_id.in.(${proveedores.join(',')})`)
  const r = await filas(tabla('supplier_invoice').select('id, invoice_number, invoice_date, grand_total, issuer_name, supplier(name)')
    .eq('account_id', accountId).eq('company_id', companyId).or(o.join(','))
    .order('invoice_date', { ascending: false, nullsFirst: false }).limit(POR_GRUPO), 'en las facturas')
  return r.map((f) => {
    const prov = (f.supplier && typeof f.supplier === 'object' ? txt((f.supplier as Fila).name) : '') || txt(f.issuer_name)
    const total = num(f.grand_total)
    return {
      clave: `factura:${txt(f.id)}`, tipo: 'factura' as const, ruta: rutaRevisarFactura(txt(f.id)),
      titulo: prov || 'Proveedor sin leer',
      apoyo: [txt(f.invoice_number) ? `Nº ${txt(f.invoice_number)}` : 'Sin número', txt(f.invoice_date) ? diaMesCorto(txt(f.invoice_date)) + '/' + txt(f.invoice_date).slice(0, 4) : null].filter(Boolean).join(' · '),
      cifra: total === null ? undefined : eurosExactos(total),
    }
  })
}

const PAPEL: Record<Papel, string> = { supplier: 'proveedor', customer: 'cliente', platform: 'plataforma', brand_partner: 'socio de marca' }

export async function buscarTerceros(accountId: string, c: Consulta): Promise<Resultado[]> {
  const t = paraIlike(c.texto)
  const nif = c.texto.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const o = [`name.ilike."*${t}*"`]
  if (nif.length >= 3) o.push(`tax_id.ilike."*${nif}*"`)
  const r = await filas(tabla('party').select('id, name, tax_id, archived_at, party_role(role, supplier_id)')
    .eq('account_id', accountId).or(o.join(',')).order('name').limit(POR_GRUPO), 'en clientes y proveedores')
  return vivoPrimero(r.map((f) => {
    const roles = Array.isArray(f.party_role) ? (f.party_role as Fila[]) : []
    const papeles = roles.map((x) => txt(x.role)).filter((x): x is Papel => x in PAPEL)
    const supplierId = roles.find((x) => x.role === 'supplier')?.supplier_id
    return {
      clave: `tercero:${txt(f.id)}`, tipo: 'tercero' as const,
      ruta: rutaDeTercero({ id: txt(f.id), papeles, supplierId: typeof supplierId === 'string' ? supplierId : null }),
      titulo: txt(f.name),
      // Un umbral ordena, no esconde (regla 7): el archivado sale, y lo dice.
      apoyo: [papeles.map((p) => PAPEL[p]).join(', ') || null, f.archived_at ? 'archivado' : null].filter(Boolean).join(' · '),
      cifra: txt(f.tax_id) || undefined,
      apagado: Boolean(f.archived_at),
    }
  }))
}

export async function buscarSubcuentas(accountId: string, companyId: string, c: Consulta): Promise<Resultado[]> {
  const t = paraIlike(c.texto)
  const o = [`name.ilike."*${t}*"`]
  if (/^\d+$/.test(c.texto)) o.push(`code.like."${c.texto}*"`)
  const r = await filas(tabla('company_account').select('id, code, name')
    .eq('account_id', accountId).eq('company_id', companyId).or(o.join(',')).order('code').limit(POR_GRUPO), 'en las subcuentas')
  return r.map((f) => ({
    clave: `subcuenta:${txt(f.id)}`, tipo: 'subcuenta' as const, ruta: rutaMayor(txt(f.code)),
    titulo: txt(f.name) || 'Sin nombre', cifra: txt(f.code),
  }))
}

/** Lo que se busca en la base, grupo a grupo. Sin empresa, solo los terceros (son de la cuenta). */
export function busquedas(accountId: string, companyId: string | null, c: Consulta): { tipo: TipoResultado; buscar: () => Promise<Resultado[]> }[] {
  const lista: { tipo: TipoResultado; buscar: () => Promise<Resultado[]> }[] = []
  // «**» o «()» se quedan en nada: buscarían todo.
  if (paraIlike(c.texto) === '' && c.entero === null) return lista
  if (companyId) {
    lista.push({ tipo: 'asiento', buscar: () => buscarAsientos(accountId, companyId, c) })
    lista.push({ tipo: 'factura', buscar: () => buscarFacturas(accountId, companyId, c) })
  }
  lista.push({ tipo: 'tercero', buscar: () => buscarTerceros(accountId, c) })
  if (companyId) lista.push({ tipo: 'subcuenta', buscar: () => buscarSubcuentas(accountId, companyId, c) })
  return lista
}
