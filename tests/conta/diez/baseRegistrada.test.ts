// C06 · El freno de diezCliente.ts con la base registrada de cada empresa
// (conta_diez_base), como lo autorizó Julio en la respuesta 1:
//   1. C0001 vetada siempre, aunque alguien la pasara como registrada;
//   2. una base registrada para la empresa se lee, y escribir en ella pide
//      escribirEnReal (es real), como C0008;
//   3. una base que no es C0008, ni C0009, ni la registrada, no se toca.
// Y Foodint con C0008, igual que hoy (antes = después): sin baseRegistrada,
// C0008 se lee, y escribir pide escribirEnReal con el MISMO mensaje.
// Contra el Diez simulado (scripts/conta/diez/falso.mjs), datos inventados.

import { afterEach, describe, expect, it } from 'vitest'
import { ClienteDiez, FrenoDiez, type AlmacenToken } from '../../../supabase/functions/_shared/diezCliente'
import { arrancarDiezFalso } from '../../../scripts/conta/diez/falso.mjs'

type Falso = Awaited<ReturnType<typeof arrancarDiezFalso>>
let falso: Falso | null = null
afterEach(async () => { await falso?.cerrar(); falso = null })

const memoria = (): AlmacenToken => {
  let g: { token: string; expiresAt: string } | null = null
  return { leer: async () => g, guardar: async (token, expiresAt) => { g = { token, expiresAt } }, caida: async () => { g = null } }
}
const asiento = { Ejercicio: '2026', Serie: 'FOLVY', Fecha: 20261001, Detalles: [{ Cuenta: '62900000', Debe: 1 }, { Cuenta: '57000000', Haber: 1 }] }

describe('C06 · la base registrada de la empresa', () => {
  it('1 · C0001: ni como registrada; no sale ni una petición', async () => {
    falso = await arrancarDiezFalso({ bases: { C0001: {} } })
    for (const bd of ['C0001', ' c0001 ']) {
      expect(() => new ClienteDiez({ base: falso!.url, nombreBd: bd, baseRegistrada: 'C0001', credenciales: falso!.credenciales, almacen: memoria() })).toThrow(/no se toca nunca/)
    }
    expect(falso.estado.peticiones).toHaveLength(0)
  })

  it('2 · la base registrada se lee; escribir en ella pide escribirEnReal y no escribe nada', async () => {
    falso = await arrancarDiezFalso({ bases: { C0042: {} } })
    const c = new ClienteDiez({ base: falso.url, nombreBd: 'C0042', baseRegistrada: ' c0042 ', credenciales: falso.credenciales, almacen: memoria(), escribir: true })
    await expect(c.subcuentas()).resolves.toEqual([])
    await expect(c.enviarAsiento(asiento)).rejects.toThrow('Freno: escribir en C0042 exige escribirEnReal; primero C0009')
    expect(falso.estado.bases.C0042.apuntes).toHaveLength(0)
  })

  it('3 · una base que no es la registrada no se toca (ni con otra registrada, ni sin ninguna)', () => {
    expect(() => new ClienteDiez({ base: 'https://x', nombreBd: 'C0042', baseRegistrada: 'C0043', credenciales: {} as never, almacen: memoria() })).toThrow(FrenoDiez)
    expect(() => new ClienteDiez({ base: 'https://x', nombreBd: 'C0042', credenciales: {} as never, almacen: memoria() })).toThrow(/desconocida/)
    expect(() => new ClienteDiez({ base: 'https://x', nombreBd: 'C0042', baseRegistrada: '', credenciales: {} as never, almacen: memoria() })).toThrow(/desconocida/)
  })

  it('Foodint con C0008, igual que hoy: se lee sin registrar nada y escribir pide escribirEnReal con el mismo mensaje', async () => {
    falso = await arrancarDiezFalso({ bases: { C0008: {} } })
    const c = new ClienteDiez({ base: falso.url, nombreBd: 'C0008', credenciales: falso.credenciales, almacen: memoria(), escribir: true })
    await expect(c.subcuentas()).resolves.toEqual([])
    await expect(c.enviarAsiento(asiento)).rejects.toThrow('Freno: escribir en C0008 exige escribirEnReal; primero C0009')
    expect(falso.estado.bases.C0008.apuntes).toHaveLength(0)
  })

  it('la de pruebas (C0009) sigue escribiendo con escribir: true, sin escribirEnReal', async () => {
    falso = await arrancarDiezFalso({ bases: { C0009: {} } })
    const c = new ClienteDiez({ base: falso.url, nombreBd: 'C0009', credenciales: falso.credenciales, almacen: memoria(), escribir: true })
    await c.enviarAsiento(asiento)
    expect(falso.estado.bases.C0009.apuntes).toHaveLength(1)
  })
})
