// tests/conta/erp10/cliente.test.ts — X10 · El cliente de ERP10 (solo leer) contra el ERP10
// simulado: el formulario del token y cada error medido el 19/11, la lista cerrada, el NIF y
// la suma de líneas por cuenta. Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import {
  ClienteErp10, FRASES, FrenoErp10, codigoLimpio, cifDeParametros, finalDelNif, nifLimpio, porTipo, resumenSinDatos, sumarPorCuenta,
  tokenConLaEmpresa, tokenDeLaEmpresa, type AlmacenToken, type ConfigErp10, type TokenGuardado,
} from '../../../supabase/functions/_shared/erp10Cliente'
import { erp10Simulado, type EmpresaSimulada } from './simulado'

const NIF_A = 'B00000000'
const NIF_B = 'B11111111'
const apunte = (Documento: number, Fecha: number, lineas: [string, number, number][], TipoAsiento = 1) =>
  ({ Serie: '1', Documento, TipoAsiento, Fecha, Detalles: lineas.map(([Cuenta, Debe, Haber]) => ({ Cuenta, Debe, Haber })) })
const EMPRESAS: Record<string, EmpresaSimulada> = {
  101: { cif: 'ES-B00000000', apuntes: [
    apunte(1, 20261005, [['60000000', 100, 0], ['47200000', 21, 0], ['40000001', 0, 121]], 2),
    apunte(2, 20261020, [['57000000', 50.1, 0], ['70000000', 0, 50.1]]),
    apunte(3, 20261103, [['60000000', 0.3, 0], ['40000001', 0, 0.3]], 2),
  ] },
  102: { cif: NIF_B, apuntes: [] },
}
const LISTA = [
  { companyId: 'sociedad-a', codEmpresa: '101', nif: NIF_A },
  { companyId: 'sociedad-b', codEmpresa: '102', nif: NIF_A }, // en Sumied dice A; en ERP10, B
]

const almacen = (inicial: TokenGuardado | null = null) => {
  const a = { guardado: inicial, caidas: [] as string[], guardados: 0 }
  const api: AlmacenToken = {
    leer: async () => a.guardado,
    guardar: async (token, expiresAt) => { a.guardado = { token, expiresAt }; a.guardados++ },
    caida: async (e) => { a.caidas.push(e); a.guardado = null },
  }
  return { a, api }
}
function cliente(o: Partial<ConfigErp10> & { sim?: ReturnType<typeof erp10Simulado> } = {}) {
  const sim = o.sim ?? erp10Simulado({ empresas: EMPRESAS })
  const al = almacen()
  const c = new ClienteErp10({
    base: 'https://erp10.invalid', nombreBd: 'DESPACHO_INVENTADO',
    claves: { client_id: 'cliente-inventado', client_secret: 'secreto-inventado', username: 'usuario-inventado', password: 'codigo-inventado' },
    lista: LISTA, codEmpresa: '101', almacen: al.api, fetch: sim.fetch, ...o,
  })
  return { c, sim, al }
}

describe('el formulario del token (medido el 19/11)', () => {
  it('va en formulario, con grant_type password, la base del despacho y cod_empresa', async () => {
    const { c, sim } = cliente()
    await c.probar()
    const t = sim.vistas.find((v) => v.ruta === '/token')!
    expect(t.metodo).toBe('POST')
    expect(t.tipo).toBe('application/x-www-form-urlencoded')
    const p = new URLSearchParams(t.cuerpo!)
    expect(Object.fromEntries(p)).toEqual({
      grant_type: 'password', client_id: 'cliente-inventado', client_secret: 'secreto-inventado',
      username: 'usuario-inventado', password: 'codigo-inventado', nombre_bd: 'DESPACHO_INVENTADO', cod_empresa: '101',
    })
  })
  it('el simulado contesta invalid_clientId en JSON, como ERP10 (por eso va en formulario)', async () => {
    const sim = erp10Simulado({ empresas: EMPRESAS })
    const r = await sim.fetch('https://erp10.invalid/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: 'invalid_clientId' })
  })
  it('claves que ERP10 no reconoce (invalid_clientId o invalid_grant): «ERP10 no reconoce las claves», y la conexión queda caída con ese motivo', async () => {
    for (const claves of [{ client_id: 'otro', password: 'codigo-inventado' }, { client_id: 'cliente-inventado', password: 'otro' }]) {
      const sim = erp10Simulado({ empresas: EMPRESAS, claves })
      const { c, al } = cliente({ sim })
      await expect(c.probar()).rejects.toThrow(FRASES.claves)
      expect(al.a.caidas).toEqual([FRASES.claves])
      expect(al.a.guardados).toBe(0)
      // Nunca las claves en el mensaje.
      expect(al.a.caidas.join(' ')).not.toMatch(/inventado/)
    }
  })
  it('sin cod_empresa el token sale y la lectura da 500 «Error al comprobar…»: se dice «Falta el código de empresa»', async () => {
    const sim = erp10Simulado({ empresas: EMPRESAS })
    const tok = await (await sim.fetch('https://erp10.invalid/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password', client_id: 'cliente-inventado', password: 'codigo-inventado' }).toString(),
    })).json() as { access_token: string }
    const al = almacen({ token: tokenConLaEmpresa('101', tok.access_token), expiresAt: '2099-01-01T00:00:00Z' })
    const c = new ClienteErp10({
      base: 'https://erp10.invalid', nombreBd: 'D', claves: { client_id: 'x', client_secret: 'x', username: 'x', password: 'x' },
      lista: LISTA, codEmpresa: '101', almacen: al.api, fetch: sim.fetch,
    })
    await expect(c.probar()).rejects.toThrow(FRASES.sinCodigo)
    // No se repite el 500 de «sin empresa» como si fuera pasajero.
    expect(sim.vistas.filter((v) => v.ruta === '/api/parametros')).toHaveLength(1)
  })
  it('un código vacío: «Falta el código de empresa», sin hablar con ERP10', () => {
    const sim = erp10Simulado({ empresas: EMPRESAS })
    expect(() => cliente({ sim, codEmpresa: '  ' })).toThrow(FRASES.sinCodigo)
    expect(sim.vistas).toHaveLength(0)
  })
})

describe('la lista cerrada', () => {
  it('un código que no está en la lista para ANTES de pedir el token, con una frase clara', () => {
    const sim = erp10Simulado({ empresas: { ...EMPRESAS, 999: { cif: NIF_A, apuntes: [] } } })
    expect(() => cliente({ sim, codEmpresa: '999' })).toThrow(FrenoErp10)
    expect(() => cliente({ sim, codEmpresa: '999' })).toThrow(FRASES.fueraDeLaLista)
    expect(() => cliente({ sim, codEmpresa: 'abc' })).toThrow(FRASES.fueraDeLaLista)
    expect(sim.vistas).toHaveLength(0)
  })
  it('el código se compara como número (cod_empresa es un entero): 0101 es 101', () => {
    expect(codigoLimpio('0101')).toBe('101')
    expect(codigoLimpio(' 101 ')).toBe('101')
    expect(codigoLimpio('10a')).toBe('')
    expect(() => cliente({ codEmpresa: '0101' })).not.toThrow()
  })
  it('una sociedad de la lista sin NIF en Sumied no entra', () => {
    expect(() => cliente({ lista: [{ companyId: 'x', codEmpresa: '101', nif: null }] })).toThrow(FRASES.sinNifSociedad)
  })
})

describe('el NIF de la empresa abierta', () => {
  it('coincide (con «ES» y guiones en ERP10): entra, guarda el token con su empresa, y dice el final del NIF', async () => {
    const { c, al } = cliente()
    const nif = await c.probar()
    expect(nif).toBe(NIF_A)
    expect(finalDelNif(nif)).toBe('000')
    expect(tokenDeLaEmpresa(al.a.guardado!.token)?.cod).toBe('101')
  })
  it('no coincide: «El NIF de la empresa de ERP10 no es el de esta sociedad», no se lee nada más y el token no se guarda', async () => {
    const { c, sim, al } = cliente({ codEmpresa: '102' })
    await expect(c.apuntesEntre('2026-10-01', '2026-11-30')).rejects.toThrow(FRASES.nif)
    expect(sim.vistas.map((v) => v.ruta.split('?')[0])).toEqual(['/token', '/api/parametros'])
    expect(al.a.guardados).toBe(0)
  })
  it('con un token guardado también se mira el NIF; uno guardado de otra empresa no se usa', async () => {
    const sim = erp10Simulado({ empresas: EMPRESAS })
    const al = almacen({ token: tokenConLaEmpresa('102', 'tok-viejo'), expiresAt: '2099-01-01T00:00:00Z' })
    const c = new ClienteErp10({
      base: 'https://erp10.invalid', nombreBd: 'D', claves: { client_id: 'cliente-inventado', client_secret: 'x', username: 'x', password: 'codigo-inventado' },
      lista: LISTA, codEmpresa: '101', almacen: al.api, fetch: sim.fetch,
    })
    await c.probar()
    expect(sim.vistas[0].ruta).toBe('/token') // el de la 102 no vale para la 101
    expect(sim.vistas[1].ruta).toBe('/api/parametros')
  })
  it('el CIF se encuentra en la Empresa, en una lista o envuelto; los NIF se comparan limpios', () => {
    expect(cifDeParametros({ CIF: 'B00000000' })).toBe('B00000000')
    expect(cifDeParametros([{ Empresa: { Cif: 'B00000000' } }])).toBe('B00000000')
    expect(cifDeParametros({ NombreFiscal: 'x' })).toBeNull()
    expect(nifLimpio('es b-0000.0000')).toBe('B00000000')
    expect(nifLimpio('ESB00000000')).toBe('B00000000')
  })
  it('esta fase no escribe: cualquier cosa que no sea GET para', async () => {
    const { c } = cliente()
    // @ts-expect-error: llamar es privado; se prueba el freno.
    await expect(c.llamar('POST', '/api/apuntes/add')).rejects.toThrow('no escribe nada en ERP10')
  })
})

describe('la suma de líneas por cuenta (como el traspaso de Diez, no getSumasYsaldos)', () => {
  it('suma debe y haber de cada línea por cuenta, en céntimos, con el saldo partido en deudor y acreedor', async () => {
    const { c } = cliente()
    const apuntes = await c.apuntesEntre('2026-10-01', '2026-11-30')
    expect(apuntes).toHaveLength(3)
    expect(sumarPorCuenta(apuntes)).toEqual([
      { subcuenta: '40000001', nombre: '', debe: 0, haber: 12130, deudor: 0, acreedor: 12130 },
      { subcuenta: '47200000', nombre: '', debe: 2100, haber: 0, deudor: 2100, acreedor: 0 },
      { subcuenta: '57000000', nombre: '', debe: 5010, haber: 0, deudor: 5010, acreedor: 0 },
      { subcuenta: '60000000', nombre: '', debe: 10030, haber: 0, deudor: 10030, acreedor: 0 },
      { subcuenta: '70000000', nombre: '', debe: 0, haber: 5010, deudor: 0, acreedor: 5010 },
    ])
  })
  it('solo hasta la fecha elegida (Fecha le AAAAMMDD), y pagina hasta el total', async () => {
    const { c } = cliente()
    expect(await c.apuntesEntre('2026-10-01', '2026-10-31')).toHaveLength(2)
    const muchos: EmpresaSimulada = { cif: NIF_A, apuntes: Array.from({ length: 450 }, (_, i) => apunte(i + 1, 20261001, [['57000000', 1, 0], ['70000000', 0, 1]])) }
    const sim = erp10Simulado({ empresas: { 101: muchos } })
    const x = cliente({ sim })
    const todos = await x.c.apuntesEntre('2026-10-01', '2026-10-31')
    expect(todos).toHaveLength(450)
    expect(sim.vistas.filter((v) => v.ruta.startsWith('/api/apuntes')).length).toBe(3)
    expect(sumarPorCuenta(todos).find((f) => f.subcuenta === '57000000')!.debe).toBe(45000)
  })
  it('por tipo de asiento: cuántos asientos y líneas', async () => {
    const { c } = cliente()
    expect(porTipo(await c.apuntesEntre('2026-10-01', '2026-11-30'))).toEqual([
      { tipo: 1, asientos: 1, lineas: 2 }, { tipo: 2, asientos: 2, lineas: 5 },
    ])
  })
  it('del resumen de ERP10 solo salen el tipo y los recuentos: ni importes ni nombres', () => {
    expect(resumenSinDatos([{ TipoAsiento: 'Por factura', NumeroApuntes: 12, TotalDebe: 1234.5, NombreEmpresa: 'X', Importe: 3 }]))
      .toEqual([{ TipoAsiento: 'Por factura', NumeroApuntes: 12 }])
  })
})
