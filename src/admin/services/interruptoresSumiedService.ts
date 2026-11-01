// src/admin/services/interruptoresSumiedService.ts
//
// S01f · Leer y cambiar los interruptores de Sumied de una cuenta. Las dos
// funciones de la base comprueban dentro que quien llama es administrador de
// la plataforma (20261031T1706_s01f_interruptores.sql).

import { rpc } from '@/modules/conta/services/bd'
import { CLAVES_SUMIED, type Cambio, type ClaveSumied, type DatosCuenta, type Interruptor } from '@/admin/lib/interruptoresSumied'

type Fila = Record<string, unknown>

const esClave = (x: unknown): x is ClaveSumied => typeof x === 'string' && (CLAVES_SUMIED as readonly string[]).includes(x)

export async function leerInterruptores(accountId: string): Promise<{ interruptores: Interruptor[]; datos: DatosCuenta }> {
  const r = (await rpc<Fila | null>('conta_interruptores_de_cuenta', { p_account: accountId })) ?? {}
  const interruptores = ((r.interruptores ?? []) as Fila[]).filter((x) => esClave(x.clave)).map((x) => ({
    clave: x.clave as ClaveSumied,
    encendida: x.encendida === true,
    existe: x.existe === true,
    cambiada: typeof x.cambiada === 'string' ? x.cambiada : null,
    quien: typeof x.quien === 'string' && x.quien.trim() ? x.quien : null,
    motivo: typeof x.motivo === 'string' && x.motivo.trim() ? x.motivo : null,
  }))
  const d = (r.datos ?? {}) as Fila
  return { interruptores, datos: { asientos: Number(d.asientos ?? 0), facturasRecibidas: Number(d.facturas_recibidas ?? 0), impuestos: Number(d.impuestos ?? 0) } }
}

export async function cambiarInterruptor(accountId: string, clave: ClaveSumied, encender: boolean, motivo: string): Promise<{ cuenta: string; cambiados: Cambio[] }> {
  const r = (await rpc<Fila | null>('conta_interruptor_cambiar', { p_account: accountId, p_clave: clave, p_encender: encender, p_motivo: motivo })) ?? {}
  const cambiados = ((r.cambiados ?? []) as Fila[]).filter((x) => esClave(x.clave)).map((x) => ({ clave: x.clave as ClaveSumied, de: x.de === true, a: x.a === true }))
  return { cuenta: String(r.cuenta ?? ''), cambiados }
}
