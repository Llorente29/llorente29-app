// supabase/functions/conta-bitrix-leer/salida.ts
//
// G01 · Tarea 2 (06/11/2026). Antes de leer Bitrix24, la puerta de las demos
// (_shared/puerta.ts, DM1). Julio, respuesta 3 a la tarea 1 del G01: en una
// cuenta de demostración (accounts.is_demo) se lee igual, pero el portal de
// PRUEBAS (otro Bitrix24, con otra dirección). Una demo nunca lee el real.
//
// Solo se lee: con la puerta abierta tampoco se escribe nada en Bitrix24.

import { cuentaPuedeSalir } from '../_shared/puerta.ts'

export type Entorno = 'real' | 'pruebas'
type ConRpc = Parameters<typeof cuentaPuedeSalir>[0]

export const SOLO_PRUEBAS_EN_DEMO = 'En la demo solo se lee el Bitrix24 de pruebas: esta conexión es la real.'

/** ¿Se puede leer esta conexión? Una cuenta que puede salir lee los dos entornos; una demo, solo el de pruebas. */
export function decidirLectura(puedeSalir: boolean, entorno: Entorno): { lee: true } | { lee: false; porque: string } {
  if (puedeSalir || entorno === 'pruebas') return { lee: true }
  return { lee: false, porque: SOLO_PRUEBAS_EN_DEMO }
}

export async function puedeLeer(db: ConRpc, accountId: string, entorno: Entorno) {
  return decidirLectura(await cuentaPuedeSalir(db, accountId), entorno)
}
