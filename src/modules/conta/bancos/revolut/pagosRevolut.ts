// src/modules/conta/bancos/revolut/pagosRevolut.ts
//
// B01 Revolut · PR 2c-1 · Lo que leen las pantallas de pagos (ActivarPagos.tsx
// y la tarjeta de Revolut), sin React: tu llave y tu PIN, y quién paga.

import { rpc } from '@/modules/conta/services/bd'
import type { QuienPaga } from '@/modules/conta/bancos/revolut/revolut'

export interface Llave { id: string; direccion: string; dispositivo: string | null }
export interface Pin { tiene: boolean; bloqueado: boolean; quedan: number | null }
export interface MiSegunda { llaveAqui: Llave | null; llaves: Llave[]; pin: Pin }

/** Tu llave (en esta dirección) y tu PIN de pago. */
export async function leerMiSegunda(): Promise<MiSegunda> {
  const [llaves, pin] = await Promise.all([rpc<Llave[]>('conta_llaves_mias', {}), rpc<Pin>('conta_pago_pin_mio', {})])
  const aqui = typeof window === 'undefined' ? '' : window.location.hostname
  return { llaves, llaveAqui: llaves.find((k) => k.direccion === aqui) ?? null, pin }
}

/** Con qué darás la segunda aprobación: hace falta al menos uno de los dos (maqueta, paso 1). */
export const tieneSegunda = (m: MiSegunda | null) => !!m && (!!m.llaveAqui || m.llaves.length > 0 || (m.pin.tiene && !m.pin.bloqueado))

export async function leerQuienPaga(companyId: string): Promise<QuienPaga> {
  const q = await rpc<{ yo_puedo: boolean; soy_admin: boolean; personas: { nombre: string; yo: boolean }[] }>('conta_pago_quien', { p_company: companyId })
  return { yoPuedo: q.yo_puedo, soyAdmin: q.soy_admin, personas: q.personas ?? [] }
}

