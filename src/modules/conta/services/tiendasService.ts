// src/modules/conta/services/tiendasService.ts
//
// D01 · «Sus tiendas» en la ficha de una plataforma (Julio, 16/10): lee las
// tiendas de su canal (platform_store, con la RLS del usuario y por la cuenta
// y la empresa: regla 9) con cuántas liquidaciones tiene cada una, y las
// marcas de la cuenta. Asigna con conta_tienda_plataforma_asignar (la 0100 de
// las liquidaciones, 13/11), que comprueba quién llama y da a sus
// liquidaciones sin marca ni local las que se elijan.

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import type { Opcion, TiendaPlataforma } from '@/modules/conta/lib/tiendas'

type Fila = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

async function leer(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, que: string): Promise<Fila[]> {
  const { data, error } = await q
  if (error) throw new Error(mensaje(`No se ha podido leer ${que}`, error))
  return (data ?? []) as Fila[]
}

export interface MarcaOpcion extends Opcion { archivada: boolean }

export async function leerTiendas(accountId: string, companyId: string, channelId: string): Promise<{ tiendas: TiendaPlataforma[]; marcas: MarcaOpcion[] }> {
  const [tiendas, liqs, marcas] = await Promise.all([
    leer(tabla('platform_store').select('id, external_text, brand_id, location_id, treasury_account_id')
      .eq('account_id', accountId).eq('company_id', companyId).eq('channel_id', channelId).order('external_text'), 'sus tiendas'),
    leer(tabla('channel_settlement').select('store_id').eq('account_id', accountId).eq('channel_id', channelId).not('store_id', 'is', null), 'las liquidaciones de sus tiendas'),
    leer(tabla('brand').select('id, name, is_active, archived_at').eq('account_id', accountId).order('name'), 'las marcas'),
  ])
  const cuantas = new Map<string, number>()
  for (const l of liqs) cuantas.set(String(l.store_id), (cuantas.get(String(l.store_id)) ?? 0) + 1)
  return {
    tiendas: tiendas.map((t) => ({
      id: String(t.id), nombre: String(t.external_text), marcaId: str(t.brand_id), localId: str(t.location_id),
      bancoId: str(t.treasury_account_id), liquidaciones: cuantas.get(String(t.id)) ?? 0,
    })),
    marcas: marcas.map((m) => ({ id: String(m.id), nombre: String(m.name), archivada: m.is_active === false || m.archived_at != null })),
  }
}

export async function asignarTienda(storeId: string, marcaId: string | null, localId: string | null, bancoId: string | null, quien: string | null): Promise<void> {
  await rpc('conta_tienda_plataforma_asignar', { p_store: storeId, p_marca: marcaId, p_local: localId, p_banco: bancoId, p_quien_nombre: quien })
}
