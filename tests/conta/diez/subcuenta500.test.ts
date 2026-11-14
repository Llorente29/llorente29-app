// B01r26 (14/11) · El ensayo de octubre en la C0009: Diez contesta 500 «Object
// reference not set to an instance of an object» a la subcuenta que no existe, y
// el traspaso se cortaba (47 asientos). Y era lento: cada asiento releía todo el
// mes. Contra el Diez simulado, con datos inventados.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClienteDiez, olvidarLoLeido, type AlmacenToken, type TokenGuardado } from '../../../supabase/functions/_shared/diezCliente'
import { arrancarDiezFalso } from '../../../scripts/conta/diez/falso.mjs'
import { ES_EL_QUINIENTOS, ES_SUBCUENTA_QUE_FALTA } from '../../../supabase/functions/_shared/diezTraspaso'

type Falso = Awaited<ReturnType<typeof arrancarDiezFalso>>
let falso: Falso | null = null
let guardado: TokenGuardado | null = null
beforeEach(() => { olvidarLoLeido(); guardado = null })
afterEach(async () => { await falso?.cerrar(); falso = null })

const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const NULL_REF = { Message: 'An error has occurred.', ExceptionMessage: 'Object reference not set to an instance of an object.' }

/** Diez de mentira; la consulta de UNA subcuenta contesta como Diez: 200 si existe, 500 si no. */
async function montar(subcuentas: { Codigo: string; Descripcion: string }[], apuntes: unknown[] = []) {
  falso = await arrancarDiezFalso({ bases: { C0009: { subcuentas, apuntes } } })
  const unas: string[] = []
  const f: typeof fetch = async (u, init) => {
    const url = String(u)
    const m = /\/api\/subcuentas\/subcuenta\/([^/?]+)/.exec(url)
    if (m) {
      unas.push(decodeURIComponent(m[1]))
      const x = subcuentas.find((s) => s.Codigo === decodeURIComponent(m[1]))
      return x ? new Response(JSON.stringify(x), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : new Response(JSON.stringify(NULL_REF), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
    if (/\/api\/subcuentas\/add/.test(url)) return new Response(String(init?.body ?? '{}'), { status: 200, headers: { 'Content-Type': 'application/json' } })
    return fetch(u, init)
  }
  const nuevo = () => new ClienteDiez({ base: falso!.url, nombreBd: 'C0009', credenciales: falso!.credenciales, almacen, pausaMs: 0, fetch: f, escribir: true })
  return { nuevo, unas, listas: () => falso!.estado.peticiones.filter((p: { ruta: string }) => p.ruta === '/api/subcuentas').length, meses: () => falso!.estado.peticiones.filter((p: { ruta: string }) => p.ruta === '/api/apuntes').length }
}

describe('una subcuenta que no existe en la base', () => {
  it('no corta: es «no está» (null), y la que existe se encuentra', async () => {
    const { nuevo } = await montar([{ Codigo: '43000002', Descripcion: 'UBER EATS' }])
    const c = nuevo()
    await expect(c.subcuenta('47200010')).resolves.toBeNull()
    await expect(c.subcuenta('43000002')).resolves.toMatchObject({ Codigo: '43000002', Descripcion: 'UBER EATS' })
  })
  it('la lista de la base se lee una vez para todos los clientes (el traspaso hace uno por asiento), sin preguntar una a una', async () => {
    const { nuevo, unas, listas } = await montar([{ Codigo: '43000002', Descripcion: 'UBER EATS' }, { Codigo: '70000000', Descripcion: 'VENTAS' }])
    for (let i = 0; i < 5; i++) {
      const c = nuevo()
      await c.subcuenta('43000002'); await c.subcuenta('70000000'); await c.subcuenta('47200010')
    }
    expect(listas()).toBe(1)
    expect(unas).toEqual([])
  })
  it('lo que crea Sumied entra en la lista ya leída', async () => {
    const { nuevo } = await montar([{ Codigo: '43000002', Descripcion: 'UBER EATS' }])
    const c = nuevo()
    await expect(c.subcuenta('47200010')).resolves.toBeNull()
    await c.crearSubcuenta({ Codigo: '47200010', Descripcion: 'IVA soportado 10 %' })
    // El simulado no la guarda en su lista: lo que se mira es que el cliente la recuerde.
    await expect(nuevo().subcuenta('47200010')).resolves.toMatchObject({ Codigo: '47200010' })
  })
})

describe('los apuntes del mes', () => {
  it('se leen una vez para todos los clientes; «fresco» vuelve a leer', async () => {
    const { nuevo, meses } = await montar([], [{ Ejercicio: '2026', Serie: '4', Documento: 1, TipoAsiento: 0, Fecha: 20261005, Detalles: [{ Linea: 1, Cuenta: '62900000', Debe: 10 }, { Linea: 2, Cuenta: '57200001', Haber: 10 }] }])
    for (let i = 0; i < 4; i++) expect(await nuevo().apuntesDelMes('202610')).toHaveLength(1)
    expect(meses()).toBe(1)
    await nuevo().apuntesDelMes('202610', { fresco: true })
    expect(meses()).toBe(2)
  })
})

describe('lo que vuelve al traspaso después de «Crearlas en Diez»', () => {
  it('el corte del 14/11 y las subcuentas que faltan, sí; lo demás, no', () => {
    expect(ES_EL_QUINIENTOS.test('se cortó: GET subcuenta → 500 (An error has occurred. · Object reference not set to an instance of an object.)')).toBe(true)
    expect(ES_SUBCUENTA_QUE_FALTA.test('la subcuenta 47200010 no está en Diez: no se inventa. Créala allí con el mismo código y reintenta')).toBe(true)
    expect(ES_SUBCUENTA_QUE_FALTA.test('las subcuentas 40000019, 63400000 no están en Diez: no se inventan. Créalas allí con el mismo código y reintenta')).toBe(true)
    expect(ES_SUBCUENTA_QUE_FALTA.test('la subcuenta 43000002 del cliente no está en Diez: no se inventa')).toBe(true)
    for (const m of ['falta el documento', 'lleva retención: Diez la guarda con un TipoRetencion que no se ha medido; no se envía hasta medirlo', 'sin IVA soportado: no se ha medido cómo guarda Diez una recibida exenta; no se envía']) {
      expect(ES_EL_QUINIENTOS.test(m) || ES_SUBCUENTA_QUE_FALTA.test(m)).toBe(false)
    }
  })
})

describe('el nombre con el que se crea una subcuenta en Diez (máximo 60)', async () => {
  const { nombreParaDiez } = await import('../../../supabase/functions/_shared/diezSubcuentas')
  it('la 62300004 del ensayo (61 caracteres) va recortada por la última palabra entera; las cortas, tal cual', () => {
    expect(nombreParaDiez('CATCHER MARKETPLACE SERVICIOS DE PROFESIONALES INDEPENDIENTES')).toEqual({ nombre: 'CATCHER MARKETPLACE SERVICIOS DE PROFESIONALES', recortado: true })
    expect(nombreParaDiez('PROMOCIONES UBER EATS')).toEqual({ nombre: 'PROMOCIONES UBER EATS', recortado: false })
    expect(nombreParaDiez('  PROMOCIONES   JUST EAT ')).toEqual({ nombre: 'PROMOCIONES JUST EAT', recortado: false })
    const largo = 'X'.repeat(70)
    expect(nombreParaDiez(largo).nombre).toHaveLength(60)
    expect(nombreParaDiez('A'.repeat(60)).recortado).toBe(false)
  })
})
