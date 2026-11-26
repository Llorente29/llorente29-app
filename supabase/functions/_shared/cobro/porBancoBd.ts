// supabase/functions/_shared/cobro/porBancoBd.ts
//
// K14 · El motor de lo cobrado por el banco (porBanco.ts) contra la base: lee lo de la empresa
// (conta_banco_cobros_datos), casa y guarda (conta_banco_cobros_guardar). Lo llama la app al leer un extracto en
// Tesorería o en Bancos, y la pantalla al decidir una entrada. Sin cliente propio: recibe la llamada a la base.

import { casarExtracto, eurosTexto, type Casado, type ClienteBanco, type Decision, type EntradaBanco, type ReciboSinCobrar } from './porBanco.ts'

/** La versión del motor que queda en cada fila (conta_banco_cobro.motor). */
export const MOTOR_COBROS = 'k14-1'

type Rpc = <T>(nombre: string, args: Record<string, unknown>) => Promise<T>
type Fila = Record<string, unknown>

const cent = (x: unknown) => Math.round(Number(x ?? 0) * 100)
const euros = (c: number) => Math.round(c) / 100
const lista = (x: unknown): Fila[] => (Array.isArray(x) ? (x as Fila[]) : [])

export interface DatosCobros { entradas: EntradaBanco[]; clientes: ClienteBanco[]; recibos: ReciboSinCobrar[]; decisiones: Map<string, Decision> }

/** Lo que devuelve conta_banco_cobros_datos, con la forma del motor. */
export function aDatos(d: Fila | null | undefined): DatosCobros {
  return {
    entradas: lista(d?.entradas).map((e) => ({ id: String(e.id), fecha: String(e.fecha), importeCent: cent(e.importe), concepto: String(e.concepto ?? '') })),
    clientes: lista(d?.clientes).map((c) => ({
      partyId: String(c.party_id), nombre: String(c.nombre ?? ''), nif: c.nif ? String(c.nif) : null,
      nombresGc: lista(c.nombres_gc).map(String).filter(Boolean), ibans: [],
    })),
    recibos: lista(d?.recibos).map((r) => ({ gcId: String(r.gc_id), partyId: String(r.party_id), fecha: String(r.fecha), importeCent: cent(r.importe) })),
    decisiones: new Map(lista(d?.decisiones).map((x) => [String(x.movement_id), { partyId: x.ninguno ? null : (x.party_id ? String(x.party_id) : null) }])),
  }
}

/** Las filas para conta_banco_cobros_guardar (los abonos de GoCardless no se guardan: sus cobros ya están en Sumied). */
export function aFilas(casados: readonly Casado[]): Fila[] {
  return casados.filter((c) => c.estado !== 'gocardless').map((c) => ({
    movement_id: c.entradaId, fecha: c.fecha, importe: euros(c.importeCent), via: c.via === 'gocardless' ? 'otra' : c.via, estado: c.estado,
    party_id: c.partyId, porque: c.porque, recargo: euros(c.recargoCent), cobro: euros(c.cobroCent),
    recibos: c.recibos.map((r) => ({ gc_id: r.gcId, importe: euros(r.importeCent) })),
  }))
}

export interface ResumenCobros { guardadas: number; casados: number; casadosCent: number; porConfirmar: number; porConfirmarCent: number; tarjetaCent: number; recibos: number }

export function aResumen(r: Fila | null | undefined): ResumenCobros {
  return {
    guardadas: Number(r?.guardadas ?? 0), casados: Number(r?.casados ?? 0), casadosCent: cent(r?.casados_importe),
    porConfirmar: Number(r?.por_confirmar ?? 0), porConfirmarCent: cent(r?.por_confirmar_importe), tarjetaCent: cent(r?.tarjeta_importe), recibos: Number(r?.recibos ?? 0),
  }
}

/**
 * Casa lo cobrado por el banco de una empresa y lo guarda. Devuelve las cuentas de la tabla después, o null si la
 * empresa no cobra por GoCardless (no hay nada que casar).
 */
export async function casarCobrosDelBanco(rpc: Rpc, companyId: string): Promise<ResumenCobros | null> {
  const bruto = await rpc<Fila>('conta_banco_cobros_datos', { p_company: companyId })
  if (!bruto?.aplica) return null
  const d = aDatos(bruto)
  const casados = casarExtracto(d.entradas, d.clientes, d.recibos, d.decisiones)
  return aResumen(await rpc<Fila>('conta_banco_cobros_guardar', { p_company: companyId, p_filas: aFilas(casados), p_motor: MOTOR_COBROS }))
}

/** La frase de después de leer un extracto (regla 8: con números). */
export function fraseCobros(r: ResumenCobros): string {
  return `Cobros de clientes por el banco: ${r.casados} casados solos (${eurosTexto(r.casadosCent)} €) · ${r.porConfirmar} por confirmar (${eurosTexto(r.porConfirmarCent)} €) · tarjeta sin asignar ${eurosTexto(r.tarjetaCent)} €.`
}
