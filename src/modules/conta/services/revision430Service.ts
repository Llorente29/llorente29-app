// src/modules/conta/services/revision430Service.ts
//
// C03 · Respuesta 3: lo que lee y escribe la revisión de las 430 traídas.
//
// Lee (con la RLS del usuario; todo filtrado por cuenta y empresa, regla 9):
//   · company_account: las 430 traídas (source migrated) y activas; y las 40/41
//     para decir de qué cuenta es cada proveedor;
//   · company_account_link: de quién es cliente cada 430 (customer/principal),
//     de qué proveedor es cuenta de pago (supplier/pago), y la cuenta de cada
//     proveedor (supplier/principal);
//   · company_chart_import.review: el NIF y la dirección del listado de clientes;
//   · ai_suggestion (clase 'plan', motivo «c03_430_propia:<código>»): las que
//     ya se decidieron como cuenta tuya sin ficha;
//   · sales_channel y party_role: qué canal es de qué plataforma.
// Escribe con las funciones de siempre (party_add_role, party_save_customer,
// company_account_link_set, party_set_archived) y, para «cuenta tuya sin ficha»,
// company_plan_propuesta_responder (C02): la decisión queda guardada y con quién
// la tomó, sin migración nueva.

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import { anadirPapel, archivarTercero, asegurarCuentaLiquidacion, enlazarCuentaCliente, guardarCliente } from '@/modules/conta/services/tercerosService'
import type { Canal430, Cuenta430, Propuesta430 } from '@/modules/conta/lib/revision430'
import { queHace } from '@/modules/conta/lib/revision430'
import { validarNifEs } from '@/modules/conta/lib/nif'
import { PROGRAMAS, nombreCorto, type Programa } from '@/modules/conta/lib/importarPlan'

type Fila = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

async function leer(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, que: string): Promise<Fila[]> {
  const { data, error } = await q
  if (error) throw new Error(mensaje(`No se ha podido leer ${que}`, error))
  return (data ?? []) as Fila[]
}

export const CLAVE_PROPIA = 'c03_430_propia:'

export interface DatosRevision430 {
  cuentas: Cuenta430[]
  /** supplierId → su cuenta 40/41 en el plan. */
  codigoDeProveedor: Map<string, string>
  canales: Canal430[]
  /** El programa del que se trajeron («Diez»), para decirlo. */
  programa: string | null
}


export async function cargarRevision430(accountId: string, companyId: string): Promise<DatosRevision430> {
  const [cuentas, enlaces, importacion, decididas, canales, plataformas] = await Promise.all([
    leer(tabla('company_account').select('id, code, name, template_code, source, status').eq('account_id', accountId).eq('company_id', companyId), 'las cuentas'),
    leer(tabla('company_account_link').select('company_account_id, entity, entity_id, role').eq('account_id', accountId).eq('company_id', companyId), 'los enlaces'),
    leer(tabla('company_chart_import').select('review, program').eq('account_id', accountId).eq('company_id', companyId).eq('status', 'traida'), 'lo traído'),
    leer(tabla('ai_suggestion').select('reason_key').eq('account_id', accountId).eq('company_id', companyId).eq('kind', 'plan').like('reason_key', `${CLAVE_PROPIA}%`), 'lo decidido'),
    leer(tabla('sales_channel').select('id, name').eq('account_id', accountId), 'los canales de venta'),
    leer(tabla('party_role').select('party_id, channel_id').eq('account_id', accountId).eq('role', 'platform'), 'las plataformas'),
  ])
  const porId = new Map(cuentas.map((c) => [String(c.id), c]))
  const codigoDeProveedor = new Map<string, string>()
  const clienteDe = new Map<string, string>()
  const pagoDe = new Map<string, string>()
  for (const l of enlaces) {
    const c = porId.get(String(l.company_account_id))
    if (!c) continue
    if (l.entity === 'customer' && l.role === 'principal') clienteDe.set(String(c.id), String(l.entity_id))
    if (l.entity === 'supplier' && l.role === 'pago') pagoDe.set(String(c.id), String(l.entity_id))
    if (l.entity === 'supplier' && l.role === 'principal' && /^4[01]/.test(String(c.template_code))) codigoDeProveedor.set(String(l.entity_id), String(c.code))
  }
  // Lo que trae el listado de clientes: NIF y dirección por código.
  const review = (importacion[0]?.review ?? null) as Fila | null
  const lectura = (review?.lectura ?? null) as Fila | null
  const delListado = new Map<string, Fila>()
  for (const t of Array.isArray(lectura?.terceros) ? (lectura!.terceros as Fila[]) : []) delListado.set(String(t.code), t)
  const nifDeFila = new Map<string, string>()
  for (const f of Array.isArray(review?.filas) ? (review!.filas as Fila[]) : []) if (str(f.nif)) nifDeFila.set(String(f.code), str(f.nif)!)
  const propias = new Set(decididas.map((d) => String(d.reason_key).slice(CLAVE_PROPIA.length)))
  const deCanal = new Map(plataformas.filter((p) => p.channel_id).map((p) => [String(p.channel_id), String(p.party_id)]))

  const programa = str(importacion[0]?.program)
  return {
    programa: programa && PROGRAMAS.some((x) => x.id === programa) ? nombreCorto(programa as Programa) : null,
    codigoDeProveedor,
    canales: canales.map((c) => ({ id: String(c.id), nombre: String(c.name), plataformaDe: deCanal.get(String(c.id)) ?? null })),
    cuentas: cuentas
      .filter((c) => String(c.template_code).startsWith('430') && c.source === 'migrated' && c.status === 'activa')
      .sort((a, b) => String(a.code).localeCompare(String(b.code)))
      .map((c) => {
        const t = delListado.get(String(c.code))
        const nif = str(t?.nif) ?? nifDeFila.get(String(c.code)) ?? null
        return {
          id: String(c.id), code: String(c.code), name: String(c.name),
          nif: nif ? nif.toUpperCase().replace(/[^A-Z0-9]/g, '') : null,
          direccion: t ? { calle: str(t.direccion), cp: str(t.cp), poblacion: str(t.poblacion), provincia: str(t.provincia) } : null,
          pagoDeProveedor: pagoDe.get(String(c.id)) ?? null,
          clienteDe: clienteDe.get(String(c.id)) ?? null,
          propia: propias.has(String(c.code)),
        }
      }),
  }
}

/**
 * Confirmar una fila. Devuelve la frase de lo hecho (regla 8). Lo que ya está
 * (un papel que ya tiene) no se vuelve a escribir: un papel de plataforma con
 * su canal no se pisa.
 */
export async function confirmar430(
  ctx: { accountId: string; companyId: string; quien: string | null },
  c: Cuenta430, p: Propuesta430, opciones: { archivar: boolean },
): Promise<string> {
  const nombre = c.name.replace(/^Clientes · /, '')
  if (p.tipo === 'propia') {
    await rpc('company_plan_propuesta_responder', {
      p_company: ctx.companyId, p_clave: `${CLAVE_PROPIA}${c.code}`, p_titulo: `${c.code} · ${nombre}: cuenta tuya, sin ficha`,
      p_porque: p.porque, p_confianza: p.confianza === 'seguro' ? 'alta' : 'media',
      // «No le hagas ficha»: la propuesta de darle una se contesta que no, y queda guardado quién y cuándo.
      p_acepta: false, p_ops: [{ op: 'cuenta_propia', code: c.code }], p_quien_nombre: ctx.quien,
    })
    return queHace(c, p)
  }
  let id = p.tercero?.id ?? null
  const tiene = (papel: string) => !!p.tercero?.papeles.includes(papel as never)
  if (!id) {
    const nifOk = !!c.nif && validarNifEs(c.nif).ok
    const d = c.direccion
    const r = await guardarCliente(ctx.accountId, null, nombre, nifOk ? c.nif : null, {
      legalName: nombre, ...(nifOk ? { taxIdType: 'nif_es' as const } : {}),
      ...(d ? { fiscalStreet: d.calle, fiscalPostalCode: d.cp, fiscalCity: d.poblacion, fiscalProvince: d.provincia } : {}),
    }, ctx.quien)
    id = r.party_id
  }
  if (p.tipo === 'plataforma' && !tiene('platform')) await anadirPapel(id, 'platform', p.canal ? { channelId: p.canal.id } : {})
  if (p.tipo === 'socio') {
    if (!tiene('brand_partner')) await anadirPapel(id, 'brand_partner')
    if (!tiene('customer')) await anadirPapel(id, 'customer')
    // Un socio histórico que se archiva no cobra nada por su cuenta: sin cuenta de liquidación.
    if (!opciones.archivar) await asegurarCuentaLiquidacion(ctx.companyId, id, nombre, ctx.quien)
  }
  if (p.tipo === 'cliente' && p.tercero && !tiene('customer')) await anadirPapel(id, 'customer')
  await enlazarCuentaCliente(ctx.companyId, id, c.id, ctx.quien)
  if (p.tipo === 'socio' && opciones.archivar) {
    await archivarTercero(id, true, 'Histórico: socio de marca traído de Diez')
    // Respuesta 4: el 06/10 una ficha marcada «Archivarlo» quedó activa sin que
    // nadie lo viera. Lo que se dice en pantalla sale de la base, no de la casilla.
    const { data, error } = await tabla('party').select('archived_at').eq('id', id).eq('account_id', ctx.accountId).maybeSingle()
    if (error || !(data as { archived_at: string | null } | null)?.archived_at) {
      throw new Error(`${error ? mensaje(`${nombre} queda como socio de marca y cliente con ${c.code}, pero NO se ha podido archivar`, error) : `${nombre} queda como socio de marca y cliente con ${c.code}, pero NO se ha podido archivar`}. Archívalo desde «···» en su fila.`)
    }
  }
  return queHace(c, p, opciones.archivar)
}
