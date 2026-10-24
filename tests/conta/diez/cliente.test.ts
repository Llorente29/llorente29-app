// El cliente de Diez contra el Diez simulado: los frenos, el token y las
// rarezas de paginación medidas en los runs 7 a 10. Datos inventados.

import { afterEach, describe, expect, it } from 'vitest'
import {
  ClienteDiez, ConexionCaida, FrenoDiez, MARGEN_RENOVAR_MS, limitesMes,
  type AlmacenToken, type Apunte, type TokenGuardado,
} from '../../../supabase/functions/_shared/diezCliente'
import { arrancarDiezFalso } from '../../../scripts/conta/diez/falso.mjs'

type Falso = Awaited<ReturnType<typeof arrancarDiezFalso>>
let falso: Falso | null = null
afterEach(async () => { await falso?.cerrar(); falso = null })

const almacen = (inicial: TokenGuardado | null = null) => {
  const a = { guardado: inicial, caidas: [] as string[], guardados: 0 }
  const api: AlmacenToken = {
    leer: async () => a.guardado,
    guardar: async (token, expiresAt) => { a.guardado = { token, expiresAt }; a.guardados++ },
    caida: async (e) => { a.caidas.push(e); a.guardado = null },
  }
  return { a, api }
}

// n asientos de un mes, cuadrados, con fechas repartidas.
const asientos = (aaaamm: string, n: number, serie = '1'): Apunte[] =>
  Array.from({ length: n }, (_, i) => ({
    Ejercicio: aaaamm.slice(0, 4), Serie: serie, Documento: i + 1, TipoAsiento: 0,
    Fecha: Number(`${aaaamm}${String((i % 28) + 1).padStart(2, '0')}`),
    Detalles: [{ Linea: 1, Cuenta: '62900000', Debe: 10 }, { Linea: 2, Cuenta: '57000000', Haber: 10 }],
  }))

async function montar(bases: Record<string, unknown> = { C0009: {}, C0008: {} }, extra: Partial<ConstructorParameters<typeof ClienteDiez>[0]> = {}, bd = 'C0009') {
  falso = await arrancarDiezFalso({ bases })
  const al = almacen()
  const c = new ClienteDiez({ base: falso.url, nombreBd: bd, credenciales: falso.credenciales, almacen: al.api, ...extra })
  return { c, al, falso }
}

describe('frenos', () => {
  it('C0001 no se toca: ni se crea el cliente, ni sale una petición', async () => {
    falso = await arrancarDiezFalso({ bases: { C0001: {} } })
    expect(() => new ClienteDiez({ base: falso!.url, nombreBd: 'C0001', credenciales: falso!.credenciales, almacen: almacen().api })).toThrow(FrenoDiez)
    expect(() => new ClienteDiez({ base: falso!.url, nombreBd: ' c0001 ', credenciales: falso!.credenciales, almacen: almacen().api })).toThrow(/no se toca nunca/)
    expect(falso.estado.peticiones).toHaveLength(0)
  })

  it('una base que no es C0008 ni C0009 tampoco', () => {
    expect(() => new ClienteDiez({ base: 'https://x', nombreBd: 'C0005', credenciales: {} as never, almacen: almacen().api })).toThrow(/desconocida/)
  })

  it('sin https no sale nada (salvo el simulado en 127.0.0.1)', () => {
    expect(() => new ClienteDiez({ base: 'http://apicon.diezsoftware.com', nombreBd: 'C0009', credenciales: {} as never, almacen: almacen().api })).toThrow(/https/)
  })

  it('si Diez abre otra base, no se lee nada y la conexión queda caída', async () => {
    const { c, al, falso } = await montar()
    falso.estado.fallos.abreOtraBase = 'C0001'
    await expect(c.subcuentas()).rejects.toThrow(/ha abierto C0001/)
    expect(falso.estado.peticiones.filter((p) => p.ruta !== '/token')).toHaveLength(0)
    expect(al.a.caidas).toHaveLength(1)
  })

  it('escribir hay que pedirlo, y en C0008 pedirlo dos veces', async () => {
    const asiento = { Ejercicio: '2026', Serie: 'FOLVY', Fecha: 20261001, Detalles: [{ Cuenta: '62900000', Debe: 1 }, { Cuenta: '57000000', Haber: 1 }] }
    const { c } = await montar()
    await expect(c.enviarAsiento(asiento)).rejects.toThrow(/no está pedido/)
    await falso!.cerrar(); falso = null
    const real = await montar(undefined, { escribir: true }, 'C0008')
    await expect(real.c.enviarAsiento(asiento)).rejects.toThrow(/escribirEnReal/)
    expect(real.falso.estado.bases.C0008.apuntes).toHaveLength(0)
  })

  it('una redirección no se sigue', async () => {
    const al = almacen({ token: 't', expiresAt: new Date(Date.now() + 10 * 864e5).toISOString() })
    const f = (async () => new Response(null, { status: 302, headers: { location: 'http://otro' } })) as typeof fetch
    const c = new ClienteDiez({ base: 'https://apicon.diezsoftware.com', nombreBd: 'C0009', credenciales: {} as never, almacen: al.api, fetch: f })
    await expect(c.series()).rejects.toThrow(/redirige/)
  })
})

describe('token', () => {
  it('entra una vez, guarda el token con su caducidad y lo reutiliza', async () => {
    const { c, al, falso } = await montar({ C0009: { series: [{ Codigo: '1', Descripcion: 'x' }] } })
    await c.series(); await c.series()
    expect(falso.estado.peticiones.filter((p) => p.ruta === '/token')).toHaveLength(1)
    expect(al.a.guardados).toBe(1)
    const dias = (Date.parse(al.a.guardado!.expiresAt) - Date.now()) / 864e5
    expect(dias).toBeGreaterThan(13.9); expect(dias).toBeLessThan(14.1)
  })

  it('con un token guardado de más de 2 días no entra', async () => {
    falso = await arrancarDiezFalso({ bases: { C0009: {} } })
    const tok = await new ClienteDiez({ base: falso.url, nombreBd: 'C0009', credenciales: falso.credenciales, almacen: almacen().api }).entrar()
    const al = almacen({ token: tok.token, expiresAt: new Date(Date.now() + MARGEN_RENOVAR_MS + 3600e3).toISOString() })
    const antes = falso.estado.peticiones.length
    await new ClienteDiez({ base: falso.url, nombreBd: 'C0009', credenciales: falso.credenciales, almacen: al.api }).series()
    expect(falso.estado.peticiones.slice(antes).map((p) => p.ruta)).toEqual(['/api/series'])
  })

  it('le quedan menos de 2 días: renueva ANTES de que caduque', async () => {
    const al = almacen({ token: 'viejo', expiresAt: new Date(Date.now() + MARGEN_RENOVAR_MS - 3600e3).toISOString() })
    falso = await arrancarDiezFalso({ bases: { C0009: {} } })
    await new ClienteDiez({ base: falso.url, nombreBd: 'C0009', credenciales: falso.credenciales, almacen: al.api }).series()
    expect(al.a.guardado!.token).not.toBe('viejo')
    expect(al.a.guardados).toBe(1)
  })

  it('si renovar falla: un solo intento, conexión caída con su porqué, y para', async () => {
    const al = almacen({ token: 'viejo', expiresAt: new Date(Date.now() + 3600e3).toISOString() })
    falso = await arrancarDiezFalso({ bases: { C0009: {} } })
    falso.estado.fallos.entrar = 'Usuario bloqueado'
    const c = new ClienteDiez({ base: falso.url, nombreBd: 'C0009', credenciales: falso.credenciales, almacen: al.api })
    await expect(c.series()).rejects.toThrow(ConexionCaida)
    expect(falso.estado.peticiones.filter((p) => p.ruta === '/token')).toHaveLength(1)
    expect(al.a.caidas[0]).toMatch(/Usuario bloqueado/)
    // El mensaje de Diez sí; las credenciales, nunca.
    expect(al.a.caidas[0]).not.toContain(falso.credenciales.password)
  })
})

describe('paginación (las rarezas medidas)', () => {
  it.each([0, 1, 199, 200, 201, 479, 1418])('%i asientos en un mes: los trae todos, una vez cada uno', async (n) => {
    const { c, falso } = await montar({ C0009: { apuntes: [...asientos('202609', n), ...asientos('202608', 7)] } })
    const filas = await c.apuntesDelMes('202609')
    expect(filas).toHaveLength(n)
    expect(new Set(filas.map((a) => a.Documento)).size).toBe(n)
    // Páginas pedidas: las justas (Diez corta en 200, $skip en páginas).
    const pags = falso.estado.peticiones.filter((p) => p.ruta === '/api/apuntes').length
    expect(pags).toBe(Math.max(1, Math.ceil(n / 200)))
  })

  it('si Diez dice un total que no llega, es un error y no un resultado', async () => {
    const { c, falso } = await montar({ C0009: { apuntes: asientos('202609', 250) } })
    falso.estado.fallos.totalMiente = 5
    await expect(c.apuntesDelMes('202609')).rejects.toThrow(/dice 255 y se han leído 250/)
  })

  it('429: espera y repite, como mucho 3 veces en total', async () => {
    const { c, falso } = await montar({ C0009: { series: [{ Codigo: '1', Descripcion: 'x' }] } })
    falso.estado.fallos.veces429 = 2
    expect(await c.series()).toHaveLength(1)
    expect(c.metrica.reintentos429).toBe(2)
    falso.estado.fallos.veces429 = 3
    await expect(c.series()).rejects.toThrow(/429/)
  })

  it('17/10 · 500 en una LECTURA: repite (Diez falla a ratos), como mucho 3 veces en total', async () => {
    const { c, falso } = await montar({ C0009: { series: [{ Codigo: '1', Descripcion: 'x' }] } })
    falso.estado.fallos.veces500 = 2
    expect(await c.series()).toHaveLength(1)
    expect(c.metrica.reintentos5xx).toBe(2)
    falso.estado.fallos.veces500 = 3
    await expect(c.series()).rejects.toThrow(/500/)
  }, 20_000)

  it('17/10 · 500 al ESCRIBIR: no se repite nunca (no se sabe si entró)', async () => {
    const { c, falso } = await montar({ C0009: {} }, { escribir: true })
    falso.estado.fallos.veces500 = 1
    await expect(c.enviarFactura({ Ejercicio: '2026', Serie: '1', TipoAsiento: 1, CuentaCliente: '43000002', FechaFactura: 20261001 })).rejects.toThrow(/facturas\/add → 500/)
    expect(c.metrica.reintentos5xx).toBe(0)
    expect(falso.estado.peticiones.filter((p) => p.ruta === '/api/facturas/add')).toHaveLength(1)
  })

  it('limitesMes', () => {
    expect(limitesMes('202602')).toEqual([20260201, 20260228])
    expect(limitesMes('202402')).toEqual([20240201, 20240229])
    expect(limitesMes('202612')).toEqual([20261201, 20261231])
    expect(() => limitesMes('202613')).toThrow()
  })
})

describe('escribir (en C0009)', () => {
  it('apuntes/add y la comprobación previa por su clave', async () => {
    const { c, falso } = await montar(undefined, { escribir: true })
    expect(await c.asiento('2026', 'FOLVY', 1)).toBeNull()
    const r = await c.enviarAsiento({ Ejercicio: '2026', Serie: 'FOLVY', Documento: 1, Fecha: 20261001, Detalles: [{ Cuenta: '62900000', Debe: 12.34 }, { Cuenta: '57000000', Haber: 12.34 }] })
    expect(r.Documento).toBe(1)
    expect((await c.asiento('2026', 'FOLVY', 1))?.Documento).toBe(1)
    expect(falso.estado.bases.C0009.apuntes).toHaveLength(1)
    // Una escritura rechazada no se repite.
    await expect(c.enviarAsiento({ Ejercicio: '2026', Serie: 'FOLVY', Documento: 1, Fecha: 20261001, Detalles: [] })).rejects.toThrow(/400/)
    expect(falso.estado.peticiones.filter((p) => p.ruta === '/api/apuntes/add')).toHaveLength(2)
  })

  it('buscarFactura casa por serie + número + NIF (normalizados) y devuelve todas las que casan', async () => {
    const f = (Documento: number, NumeroFactura: string, CifCliente: string, Serie = '2') =>
      ({ Ejercicio: '2026', Serie, Documento, TipoAsiento: 2, Fecha: 20260915, FechaFactura: 20260915, CuentaCliente: '40000001', NumeroFactura, CifCliente })
    const { c } = await montar({ C0009: { facturas: [f(1, 'A-1043', 'B00000000'), f(2, 'A-1044', 'B00000000'), f(3, 'A-1043', 'B11111111'), f(4, 'A-1043', 'B00000000', '1')] } })
    const r = await c.buscarFactura('2', 'a 1043', 'ES-B00000000', 20260915)
    expect(r.map((x) => x.Documento)).toEqual([1])
    expect(await c.buscarFactura('2', 'A-9999', 'B00000000', 20260915)).toEqual([])
  })
})

describe('analítica (medido en C0009 el 12/10)', () => {
  it('se envía con la factura, no vuelve en facturas/factura y sí en analitica/asiento', async () => {
    const { c } = await montar(undefined, { escribir: true })
    const r = await c.enviarFactura({
      Ejercicio: '2026', Serie: '2', TipoAsiento: 2, CuentaCliente: '40000001', FechaFactura: 20261012, NumeroFactura: 'P-1', CifCliente: 'B00000000',
      BaseImponible1: 1, PorcentajeIVA1: 10, CuotaIVA1: 0.1, TotalFactura: 1.1,
      Analitica: [{ Subcuenta: '60000000', Grupo: 'G1', Subgrupo: '1', Nivel3: 'P1', ImporteDebe: 1, ImporteHaber: 0 }],
    })
    const leida = await c.get<{ Analitica: unknown[] }>(`/api/facturas/factura/2026/2/${r.Documento}`)
    expect(leida.Analitica).toEqual([])
    const an = await c.analiticaDe('2026', '2', Number(r.Documento))
    expect(an.map((a) => [a.Grupo, a.Subgrupo, a.Nivel3, a.ImporteDebe])).toEqual([['G1', '1', 'P1', 1]])
  })
})
