// supabase/functions/conta-gocardless-leer/salida.ts
//
// G01 · Tarea 2 (06/11/2026). Antes de leer una cuenta de GoCardless, la
// puerta de las demos (_shared/puerta.ts, DM1). Julio, respuesta 3 a la
// tarea 1 del G01: todo funciona igual en una cuenta de demostración
// (accounts.is_demo), pero contra el entorno de PRUEBAS (el sandbox de
// GoCardless, con su clave). Una demo nunca lee una cuenta real.
//
// Solo se lee: con la puerta abierta tampoco se escribe nada en GoCardless.

import { cuentaPuedeSalir } from '../_shared/puerta.ts'
import type { Entorno } from './lector.ts'

type ConRpc = Parameters<typeof cuentaPuedeSalir>[0]

export const SOLO_PRUEBAS_EN_DEMO = 'En la demo solo se lee el entorno de pruebas de GoCardless (el sandbox): esta conexión es la real.'

/** ¿Se puede leer esta conexión? Una cuenta que puede salir lee los dos entornos; una demo, solo el de pruebas. */
export function decidirLectura(puedeSalir: boolean, entorno: Entorno): { lee: true } | { lee: false; porque: string } {
  if (puedeSalir || entorno === 'pruebas') return { lee: true }
  return { lee: false, porque: SOLO_PRUEBAS_EN_DEMO }
}

export async function puedeLeer(db: ConRpc, accountId: string, entorno: Entorno) {
  return decidirLectura(await cuentaPuedeSalir(db, accountId), entorno)
}
