// tests/e2e/conta/v03/clienteSuizo.ts
//
// El cliente de Suiza de la cuenta D (Alpen Gastro AG, CHE123456789), para las
// pruebas que facturan sin IVA fuera de la UE. Lo usan verifactu.spec.ts y
// corregir-y-cuadrar.spec.ts, en el mismo carril y la misma cuenta: el primero
// que llega lo da de alta y el segundo se encuentra el NIF ya puesto. La base
// lo para con MISMO_NIF (un NIF, un tercero por cuenta), y eso está bien: aquí
// se usa ese mismo cliente, cuyo id viene en el mensaje de la base.

import { expect } from '@playwright/test'
import { CUENTA_D, type Sesion } from '../sesion'
import { rest } from '../api'

export const NIF_SUIZO = 'CHE123456789'

/** El id del cliente suizo de D: lo da de alta, o el que ya tenía ese NIF. */
export async function clienteSuizo(s: Sesion, quien: string): Promise<string> {
  const alta = await rest<{ party_id?: string; code?: string; message?: string }>(s, 'POST', 'rpc/party_save_customer', {
    p_account: CUENTA_D.id, p_party: null, p_nombre: `Alpen Gastro AG ${quien} ${Date.now().toString(36)}`, p_nif: NIF_SUIZO,
    p_datos: { countryCode: 'CH' }, p_quien_nombre: quien,
  })
  if (alta.status === 200 && alta.datos.party_id) return alta.datos.party_id
  const ya = /^MISMO_NIF ([0-9a-f-]{36}):/.exec(alta.datos.message ?? '')
  expect(alta.status === 409 && ya, `alta del cliente suizo: ${JSON.stringify(alta.datos)}`).toBeTruthy()
  return ya![1]
}
