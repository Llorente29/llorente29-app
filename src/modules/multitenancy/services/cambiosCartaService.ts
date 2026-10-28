// src/modules/multitenancy/services/cambiosCartaService.ts
//
// F01 · PR 2 · Los cambios de carta de las marcas de Last (tablero 5). La
// lógica vive en la base (20261027T1910_f01b_cambios_carta.sql).

import { rpcSinTipar } from '@/lib/rpcSinTipar'
import { leerCambios, lotePropuestos, type CambiosMarca } from '../lib/cambiosCarta'

export async function leerCambiosCarta(accountId: string): Promise<CambiosMarca[]> {
  return leerCambios(await rpcSinTipar<unknown>('f01_cambios_carta', { p_account: accountId }))
}

const frase = (r: { frase?: string } | null, otra: string) => r?.frase ?? otra

export async function anadirPlatosNuevos(accountId: string, brandId: string): Promise<string> {
  return frase(await rpcSinTipar<{ frase?: string }>('f01_anadir_platos_nuevos', { p_account: accountId, p_brand: brandId }), 'Platos añadidos.')
}

export async function guardarExtrasPropuestos(accountId: string, c: CambiosMarca): Promise<string> {
  return frase(await rpcSinTipar<{ frase?: string }>('f01_guardar_extras', { p_account: accountId, p_brand: c.brandId, p_extras: lotePropuestos(c) }), 'Extras guardados.')
}

export async function ponerPreciosDeLast(accountId: string, brandId: string): Promise<string> {
  return frase(await rpcSinTipar<{ frase?: string }>('f01_poner_precios_de_last', { p_account: accountId, p_brand: brandId }), 'Precios puestos.')
}
