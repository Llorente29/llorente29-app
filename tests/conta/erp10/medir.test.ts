// tests/conta/erp10/medir.test.ts — X11 · Medir lo que se puede traer de ERP10 por la conexión
// (supabase/functions/_shared/erp10Medir.ts): solo GET, solo recuentos, la paginación de 200
// con $skip en páginas, lo calculado cuando no se lee entero y lo que tardaría una empresa
// grande. Todo inventado (T11): NIF de ceros, nombres «INVENTADO», importes redondos.

import { describe, expect, it } from 'vitest'
import { camposDe, empresaGrande, medidaEnTexto, medirParaTraer, type PuertoMedir } from '../../../supabase/functions/_shared/erp10Medir'
import { ClienteErp10, type AlmacenToken, type TokenGuardado } from '../../../supabase/functions/_shared/erp10Cliente'
import { erp10Simulado } from './simulado'

const NIF = 'B00000000'
const NOMBRE = 'TERCERO INVENTADO'

/** Un ERP10 falso con páginas de 200 y `$skip` en páginas (como el medido en Diez), y un reloj que avanza. */
function falso(o: { subcuentas: number; asientos: number; facturas: number; msPorLlamada?: number; repiteAlFinal?: boolean }) {
  let reloj = 0
  const rutas: string[] = []
  const paginar = (filas: unknown[], u: URL) => {
    const top = Math.min(200, Number(u.searchParams.get('$top') ?? 200)), pag = Number(u.searchParams.get('$skip') ?? 0)
    const d = filas.slice(pag * top, pag * top + top)
    // Diez, al pasarse del final, devuelve la primera otra vez sin avisar.
    return { status: 200, json: { Datos: d.length || !o.repiteAlFinal ? d : filas.slice(0, top), ResultadosTotales: o.repiteAlFinal ? null : filas.length, ElementosPorPagina: 200, PaginaActual: pag + 1 } }
  }
  const sub = Array.from({ length: o.subcuentas }, (_, i) => {
    const pre = ['40', '41', '43', '57', '60', '70'][i % 6]
    return { Codigo: `${pre}${String(i).padStart(6, '0')}`, Descripcion: NOMBRE, NIF: pre.startsWith('4') ? NIF : '', DireccionCompleta: pre === '43' ? 'CALLE INVENTADA 1' : '', Pais: 'ES' }
  })
  const asi = Array.from({ length: o.asientos }, (_, i) => ({ Ejercicio: '2025', Serie: i % 3 ? '1' : '2', Documento: i + 1, TipoAsiento: i === 0 ? 1 : 0, Fecha: 20250101, Descripcion: NOMBRE, Detalles: [{ Cuenta: '60000000', Debe: 100 }, { Cuenta: '40000001', Haber: 100 }] }))
  const fac = Array.from({ length: o.facturas }, (_, i) => ({ Ejercicio: '2025', Serie: '2', Documento: i + 1, TipoFactura: i % 2 ? 1 : 6, CuentaCliente: '40000001', NombreCliente: NOMBRE, CifCliente: NIF, BaseImponible1: 100, CuotaIVA1: 21, BaseImponible2: i === 0 ? 10 : 0, CuotaRetencion: i === 1 ? 15 : 0, ClaveRegimenIva1: '01', Apuntes: [{ Cuenta: '60000000' }] }))
  const p: PuertoMedir = {
    ahora: () => reloj,
    get: async (ruta) => {
      rutas.push(ruta)
      reloj += o.msPorLlamada ?? 500
      const u = new URL(`https://erp10.invalid${ruta}`)
      if (u.pathname === '/api/parametros') return { status: 200, json: { NombreFiscal: NOMBRE, CIF: NIF, TipoContabilidad: 1, DigitosPlanContable: 8 } }
      if (u.pathname === '/api/subcuentas') return paginar(sub, u)
      if (u.pathname.startsWith('/api/subcuentas/subcuenta/')) return { status: 200, json: { ...sub[0], TipoIva1: 0, TipoVencimiento: '' } }
      if (u.pathname === '/api/clientes' || u.pathname === '/api/proveedores') return { status: 500, json: { Message: 'Ha intentado acceder a un endpoint de Estimaciones/Autónomos para una empresa Estándar/Sociedades' } }
      if (u.pathname === '/api/apuntes') return paginar(asi, u)
      if (u.pathname === '/api/apuntes/resumen') return { status: 200, json: [{ Ejercicio: 2025, Mes: 1, TipoIntroduccion: 1, DescripcionTipoIntroduccion: 'Por factura', Numero: 2 * o.asientos }] }
      if (u.pathname === '/api/facturas') return paginar(fac, u)
      if (u.pathname.startsWith('/api/facturasestimaciones/')) return { status: 500, json: { Message: 'Ha intentado acceder a un endpoint de Estimaciones/Autónomos' } }
      if (u.pathname.startsWith('/api/subcuentas/getSumasYsaldos/')) return paginar(asi.slice(0, 3).map((a) => ({ Subcuenta: '60000000', Debe: 100, Fecha: a.Fecha })), u)
      if (u.pathname === '/api/series') return paginar([{ Codigo: '1', Descripcion: 'GENERAL' }, { Codigo: '2', Descripcion: 'RECIBIDAS' }], u)
      return { status: 404, json: { Message: 'No encontrado' } }
    },
  }
  return { p, rutas }
}

describe('medir lo que se puede traer de ERP10', () => {
  it('cada cosa de «Traer», con su ruta, su total y sus páginas; lo grande se calcula con lo medido', async () => {
    const { p } = falso({ subcuentas: 450, asientos: 1000, facturas: 700 })
    const m = await medirParaTraer(p, { ejercicio: '2025', codEmpresa: '101', maxPaginas: 2 })
    const de = (que: string) => m.medidos.find((x) => x.que.startsWith(que))!
    expect(m.medidos.map((x) => x.que)).toEqual([
      'Plan de cuentas y subcuentas', 'Un tercero suelto (su ficha)', 'Clientes', 'Proveedores y acreedores', 'Diario (asientos de 2025)',
      'Resumen de ERP10 (2025)', 'Facturas (2025)', 'Inmovilizado', 'Sumas y saldos (enero de 2025)', 'Series', 'Vencimientos',
    ])
    // Las subcuentas, enteras (3 páginas de 200), con los terceros y lo que traen de su ficha.
    expect(de('Plan')).toMatchObject({ total: 450, paginas: 3, leidas: 3, leidos: 450, msPorPagina: 500, msTodo: 1500, calculado: false })
    expect(de('Plan').recuentos['terceros (40 proveedores, 41 acreedores, 43 clientes, 44 deudores)']).toEqual({ 40: 75, 41: 75, 43: 75 })
    expect(de('Plan').recuentos['de su ficha']).toMatchObject({ '40 con NIF': 75, '43 con dirección': 75 })
    // Los asientos: 1.000 son 5 páginas; se leen 2 y el resto se calcula.
    expect(de('Diario')).toMatchObject({ total: 1000, paginas: 5, leidas: 2, leidos: 400, msTodo: 2500, calculado: true })
    expect(de('Diario').recuentos['asientos por TipoAsiento']).toEqual({ 0: 399, 1: 1 })
    expect(de('Facturas').recuentos.casos).toMatchObject({ '1 tipo de IVA': 399, '2 tipos de IVA': 1, 'con retención': 1, 'con sus apuntes': 400 })
    expect(de('Facturas').recuentos['por TipoFactura']).toEqual({ 1: 200, 6: 200 })
    // Lo que no existe en una sociedad: su estado y su motivo, y se sigue.
    expect(de('Clientes')).toMatchObject({ status: 500, total: null })
    expect(de('Clientes').motivo).toContain('Estimaciones/Autónomos')
    expect(de('Inmovilizado').ruta).toBe('/api/facturasestimaciones/inmovilizados/101')
    expect(de('Un tercero suelto').recuentos['campos de la ficha completa que trae']).toMatchObject({ TipoIva1: 1, TipoVencimiento: 1, IBAN: 0 })
    // 2.000 + 2.000 terceros: 20 páginas del listado, o 4.000 llamadas si la ficha va una a una.
    expect(m.grande).toEqual({ terceros: 4000, listado: { peticiones: 20, ms: 10_000 }, unaAUna: { peticiones: 4000, ms: 2_000_000 } })
    expect(m.cortada).toBe(false)
    expect(m.empresa).toMatchObject({ tipoContabilidad: 1, digitosPlan: 8 })
  })

  it('$skip cuenta páginas, y si ERP10 repite la primera al pasarse del final, para (no la cuenta dos veces)', async () => {
    const { p, rutas } = falso({ subcuentas: 400, asientos: 10, facturas: 0, repiteAlFinal: true })
    const m = await medirParaTraer(p, { ejercicio: '2025', codEmpresa: '101' })
    expect(m.medidos[0]).toMatchObject({ leidos: 400, total: 400, calculado: false })
    expect(rutas.filter((r) => r.startsWith('/api/subcuentas?'))).toEqual(['/api/subcuentas?%24top=200&%24skip=0', '/api/subcuentas?%24top=200&%24skip=1', '/api/subcuentas?%24top=200&%24skip=2'])
  })

  it('con el tiempo gastado, no pide más páginas y lo dice', async () => {
    const { p } = falso({ subcuentas: 2000, asientos: 2000, facturas: 2000, msPorLlamada: 20_000 })
    const m = await medirParaTraer(p, { ejercicio: '2025', codEmpresa: '101', presupuestoMs: 100_000 })
    expect(m.cortada).toBe(true)
    expect(m.medidos[0]).toMatchObject({ total: 2000, paginas: 10, calculado: true })
    expect(m.ms).toBeLessThanOrEqual(140_000)
  })

  it('el texto para el PR no lleva ni un nombre, ni un NIF, ni una dirección, ni un importe', async () => {
    const { p } = falso({ subcuentas: 300, asientos: 300, facturas: 300 })
    const t = medidaEnTexto(await medirParaTraer(p, { ejercicio: '2025', codEmpresa: '101' }))
    expect(t).not.toContain(NOMBRE)
    expect(t).not.toContain(NIF)
    expect(t).not.toContain('CALLE')
    expect(t).not.toMatch(/GENERAL|RECIBIDAS/)
    expect(t).not.toMatch(/\b121\b|\b100,00\b/)
    expect(t).toContain('| Diario (asientos de 2025) | `/api/apuntes` | 200 | 300 | 200 | 2 (2) |')
    expect(t).toContain('Una a una (si la ficha solo viene en la subcuenta suelta): 4.000 peticiones')
  })

  it('por el cliente de verdad contra el ERP10 simulado: solo GET (y el token), con la lista cerrada y el NIF', async () => {
    const sim = erp10Simulado({ empresas: { 101: { cif: NIF, apuntes: [{ Serie: '1', Documento: 1, TipoAsiento: 0, Fecha: 20250105, Detalles: [{ Cuenta: '60000000', Debe: 100, Haber: 0 }, { Cuenta: '40000001', Debe: 0, Haber: 100 }] }] } } })
    let g: TokenGuardado | null = null
    const almacen: AlmacenToken = { leer: async () => g, guardar: async (token, expiresAt) => { g = { token, expiresAt } }, caida: async () => { g = null } }
    const c = new ClienteErp10({
      base: 'https://erp10.invalid', nombreBd: 'BASE_INVENTADA', codEmpresa: '101', almacen, fetch: sim.fetch,
      claves: { client_id: 'cliente-inventado', client_secret: 'x', username: 'u', password: 'codigo-inventado' },
      lista: [{ companyId: 'sociedad', codEmpresa: '101', nif: NIF }],
    })
    await c.probar()
    let reloj = 0
    const m = await medirParaTraer({ get: (r) => c.get(r), ahora: () => (reloj += 10) }, { ejercicio: '2025', codEmpresa: c.codEmpresa })
    expect(new Set(sim.vistas.map((v) => `${v.metodo} ${v.metodo === 'POST' ? v.ruta : ''}`))).toEqual(new Set(['POST /token', 'GET ']))
    expect(m.medidos.find((x) => x.que.startsWith('Diario'))).toMatchObject({ status: 200, total: 1 })
    expect(medidaEnTexto(m)).not.toContain(NIF)
  })

  it('los campos: solo el nombre y cuántos traen valor', () => {
    expect(camposDe([{ A: 'x', B: 0, C: [] }, { A: '', B: 3 }])).toEqual([{ campo: 'A', conValor: 1 }, { campo: 'B', conValor: 1 }, { campo: 'C', conValor: 0 }])
    expect(empresaGrande({ porPagina: null, msPorPagina: null }, null, 4000)).toEqual({ terceros: 4000, listado: { peticiones: 20, ms: null }, unaAUna: { peticiones: 4000, ms: null } })
  })
})
