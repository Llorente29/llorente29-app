// src/modules/conta/gestoria/q10/datos.ts
//
// Q10 · Lo que lee «Las facturas de noviembre». SOLO LEE: nada se emite, se
// guarda ni se envía desde aquí (eso es el PR siguiente, con el sí de Julio).
//   · De Sumied, de la empresa (regla 9: todo por company_id, y las fichas por
//     account_id): los cobros del mes de GoCardless, sus suscripciones y
//     mandatos, los enlaces de cada cliente de GoCardless y las fichas atadas.
//     Columnas comprobadas contra producción el 25/11 (regla 40).
//   · De ERP10, por la conexión (conta-erp10-leer, «traer», solo GET): las
//     facturas emitidas de los meses de antes, para la retención de cada
//     cliente (su última factura) y el último número de la serie.

import { tabla, mensaje } from '@/modules/conta/services/bd'
import { traerPaginaErp10 } from '@/modules/conta/services/erp10ApiService'
import type { CobroQ10, EnlaceQ10, FacturaErp10Q10, FichaQ10, MandatoQ10, SuscripcionQ10 } from './facturasDelMes'

type Fila = Record<string, unknown>
const s = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())

/** Todas las filas, de 1000 en 1000 (PostgREST corta en 1000). */
async function todas(que: string, pedir: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Fila[]> {
  const r: Fila[] = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await pedir(i, i + 999)
    if (error) throw new Error(mensaje(`No se ha podido leer ${que}`, error as never))
    const xs = (data ?? []) as Fila[]
    r.push(...xs)
    if (xs.length < 1000) return r
  }
}

export interface DatosQ10 {
  empresa: Fila
  cobros: CobroQ10[]
  suscripciones: SuscripcionQ10[]
  mandatos: (MandatoQ10 & { final: string | null })[]
  enlaces: EnlaceQ10[]
  fichas: FichaQ10[]
  /** La 430 de cada ficha en Sumied (company_account_link «customer», principal): el código de su cliente en Cegid. */
  cuentas: Map<string, string>
}

const finDeMes = (mes: string) => {
  const [a, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
}

export async function leerFacturasDelMes(cuenta: string, empresa: string, mes: string): Promise<DatosQ10> {
  const [emp, cobros, suscripciones, mandatos, enlaces] = await Promise.all([
    tabla('company').select('id, legal_name, trade_name, tax_id, fiscal_street_type, fiscal_street, fiscal_number, fiscal_extra, fiscal_postal_code, fiscal_city, email, phone')
      .eq('account_id', cuenta).eq('id', empresa).maybeSingle(),
    todas('los cobros de GoCardless', (a, b) => tabla('conta_gc_cobro').select('gc_id, estado, fecha, importe, suscripcion_gc_id, mandato_gc_id, motivo_es')
      .eq('company_id', empresa).gte('fecha', `${mes}-01`).lte('fecha', finDeMes(mes)).order('gc_id').range(a, b)),
    todas('las suscripciones de GoCardless', (a, b) => tabla('conta_gc_suscripcion').select('gc_id, nombre, gc_cliente_id').eq('company_id', empresa).order('gc_id').range(a, b)),
    todas('los mandatos de GoCardless', (a, b) => tabla('conta_gc_mandato').select('gc_id, gc_cliente_id, cuenta_final').eq('company_id', empresa).order('gc_id').range(a, b)),
    todas('los enlaces de GoCardless', (a, b) => tabla('conta_gc_enlace').select('gc_cliente_id, party_id, estado').eq('company_id', empresa).order('gc_cliente_id').range(a, b)),
  ])
  if (emp.error) throw new Error(mensaje('No se ha podido leer la empresa', emp.error as never))
  if (!emp.data) throw new Error('Esa empresa no es de esta cuenta.')
  const partes = [...new Set(enlaces.map((e) => s(e.party_id)).filter((x): x is string => !!x))]
  const fichas: FichaQ10[] = []
  for (let i = 0; i < partes.length; i += 200) {
    const ids = partes.slice(i, i + 200)
    const [p, f] = await Promise.all([
      tabla('party').select('id, name, tax_id').eq('account_id', cuenta).in('id', ids),
      tabla('customer_fiscal').select('party_id, legal_name, fiscal_street, fiscal_postal_code, fiscal_city, fiscal_province').eq('account_id', cuenta).in('party_id', ids),
    ])
    if (p.error) throw new Error(mensaje('No se han podido leer las fichas', p.error as never))
    if (f.error) throw new Error(mensaje('No se han podido leer los datos fiscales de las fichas', f.error as never))
    const fis = new Map(((f.data ?? []) as Fila[]).map((x) => [String(x.party_id), x]))
    for (const x of (p.data ?? []) as Fila[]) {
      const d = fis.get(String(x.id))
      const ciudad = s(d?.fiscal_city), prov = s(d?.fiscal_province)
      const direccion = [s(d?.fiscal_street), [s(d?.fiscal_postal_code), ciudad].filter(Boolean).join(' ') + (prov && prov !== ciudad ? ` (${prov})` : '')]
        .filter(Boolean).join(' · ') || null
      fichas.push({ partyId: String(x.id), nombre: s(d?.legal_name) ?? s(x.name) ?? 'Sin nombre', nif: s(x.tax_id), direccion })
    }
  }
  // La 430 de cada ficha atada (company_account_link + company_account; columnas y clave ajena comprobadas el 25/11, regla 40).
  const cuentas = new Map<string, string>()
  for (let i = 0; i < partes.length; i += 200) {
    const l = await tabla('company_account_link').select('entity_id, company_account(code)').eq('company_id', empresa).eq('entity', 'customer').eq('role', 'principal')
      .in('entity_id', partes.slice(i, i + 200))
    if (l.error) throw new Error(mensaje('No se han podido leer las subcuentas de los clientes', l.error as never))
    for (const x of (l.data ?? []) as Fila[]) { const c = s((x.company_account as Fila | null)?.code); if (c) cuentas.set(String(x.entity_id), c) }
  }
  return {
    cuentas,
    empresa: emp.data as Fila,
    cobros: cobros.map((c) => ({ gcId: String(c.gc_id), estado: String(c.estado), fecha: String(c.fecha), importe: Number(c.importe), suscripcionId: s(c.suscripcion_gc_id), mandatoId: s(c.mandato_gc_id), motivo: s(c.motivo_es) })),
    suscripciones: suscripciones.map((x) => ({ gcId: String(x.gc_id), nombre: s(x.nombre), gcClienteId: s(x.gc_cliente_id) })),
    mandatos: mandatos.map((x) => ({ gcId: String(x.gc_id), gcClienteId: s(x.gc_cliente_id), final: s(x.cuenta_final) })),
    enlaces: enlaces.map((x) => ({ gcClienteId: String(x.gc_cliente_id), partyId: s(x.party_id), estado: String(x.estado) })),
    fichas,
  }
}

/** Los meses de antes de `mes`, del más nuevo al más viejo, dentro del mismo año: «2026-11» → 2026-11, 2026-10… 2026-01. */
export const mesesHaciaAtras = (mes: string) => {
  const [a, m] = mes.split('-').map(Number)
  return Array.from({ length: m }, (_, i) => `${a}-${String(m - i).padStart(2, '0')}`)
}

/**
 * Las facturas emitidas de ERP10 de un mes, todas sus páginas. Solo GET, por
 * la conexión de la sociedad; si ERP10 tarda (504), vuelve a pedir esa misma
 * página una vez.
 */
export async function facturasErp10DelMes(empresa: string, mes: string): Promise<FacturaErp10Q10[]> {
  const r: FacturaErp10Q10[] = []
  for (let pagina = 0; pagina < 50; pagina++) {
    const pedir = () => traerPaginaErp10(empresa, { que: 'facturas', ejercicio: mes.slice(0, 4), mes, pagina })
    const pag = await pedir().catch((e: Error & { noReintentar?: boolean }) => { if (e.noReintentar) throw e; return pedir() })
    for (const f of pag.filas as unknown as Fila[]) {
      const ret = f.retencion as { tipo: number | null; importe: number } | null
      r.push({ cuenta: String(f.cuenta ?? ''), nif: String(f.nif ?? ''), numero: String(f.numero ?? ''), fecha: Number(f.fechaFactura ?? f.fecha ?? 0), retencion: ret ?? null })
    }
    if (pag.ultima) break
  }
  return r.filter((f) => f.cuenta.startsWith('43'))
}
