// tests/conta/erp10/escribir.test.ts — X10b · Sacar una recibida a ERP10 sin que salga dos veces
// (supabase/functions/_shared/erp10Escribir.ts), contra un puerto de mentira: la fila de cada
// asiento con las MISMAS reglas que conta_erp10_envio_tomar (nuevo, no pudo o a medias hace más
// de 3 minutos) y un ERP10 simulado que guarda lo que se le escribe. Con un fallo a la mitad,
// dos clics a la vez y ERP10 diciendo que no. Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { facturaRecibidaErp10, mesesDeBusqueda, sacarRecibida, type Envio, type PuertoEscribir, type RecibidaParaApi } from '../../../supabase/functions/_shared/erp10Escribir'
import { ClienteErp10, sumarPorCuenta, type AlmacenToken } from '../../../supabase/functions/_shared/erp10Cliente'
import { erp10Simulado, type EmpresaSimulada } from './simulado'

const HOY = '2026-11-19'
const recibida = (o: Partial<RecibidaParaApi> = {}): RecibidaParaApi => ({
  entryId: 'asiento-1', numero: 'F-0001', fechaFactura: '2026-10-03', fechaAsiento: '2026-10-05', nif: 'B00000000', nombre: 'Proveedor Inventado, S.L.',
  proveedor: '40000009', tipoOperacion: 'OI', gastos: [{ cuenta: '62300000', importe: 10000 }], iva: [{ pct: 21, base: 10000, cuota: 2100 }], retencion: null, total: 12100, ...o,
})

function mundo(o: { altaFalla?: number; ponerFallaEnErp10?: boolean; subidaFalla?: boolean; yaEnErp10?: number; tiene?: string[] } = {}) {
  let reloj = Date.parse('2026-11-19T10:00:00Z')
  const filas = new Map<string, Envio & { cambiado: number }>()
  const erp = { facturas: [] as Record<string, unknown>[], altas: 0, subcuentas: [...(o.tiene ?? ['40000009', '62300000'])], creadas: [] as string[], subidas: 0, intentosAlta: 0 }
  for (let i = 0; i < (o.yaEnErp10 ?? 0); i++) erp.facturas.push({ Ejercicio: '2026', Serie: '2', Documento: 50 + i, NumeroFactura: 'F-0001', CuentaCliente: '40000009', Fecha: 20261005 })
  let fallaPoner = o.ponerFallaEnErp10 ?? false
  let fallaAlta = o.altaFalla ?? 0
  const p: PuertoEscribir = {
    hoy: HOY,
    // Las reglas de conta_erp10_envio_tomar, en una sola «sentencia» (síncrona).
    tomar: async (entryId) => {
      const f = filas.get(entryId)
      if (!f) {
        const n = { id: `envio-${entryId}`, entry_id: entryId, estado: 'enviando' as const, erp10_ejercicio: null, erp10_serie: null, erp10_documento: null, enlazada: false, pdf: null, motivo: null, intentos: 1, lote_id: null, cambiado: reloj }
        filas.set(entryId, n)
        return { tomado: true, envio: { ...n } }
      }
      if (f.estado === 'no_pudo' || (f.estado === 'enviando' && reloj - f.cambiado > 3 * 60_000)) {
        Object.assign(f, { estado: 'enviando', intentos: f.intentos + 1, motivo: null, cambiado: reloj })
        return { tomado: true, envio: { ...f } }
      }
      return { tomado: false, envio: { ...f } }
    },
    poner: async (id, cambios) => {
      if (fallaPoner && cambios.estado === 'en_erp10') { fallaPoner = false; throw new Error('se ha cortado (inventado)') }
      const f = [...filas.values()].find((x) => x.id === id)!
      Object.assign(f, cambios, { cambiado: reloj })
    },
    pdf: async () => new Uint8Array([37, 80, 68, 70]),
    erp10: {
      tieneSubcuenta: async (k) => erp.subcuentas.includes(k),
      crearSubcuenta: async (sc) => { erp.subcuentas.push(sc.Codigo); erp.creadas.push(sc.Codigo) },
      facturasDelMes: async (m) => erp.facturas.filter((f) => String(f.Fecha).startsWith(m.replace('-', ''))),
      altaFactura: async (fd) => {
        erp.intentosAlta++
        if (fallaAlta > 0) { fallaAlta--; throw new Error('ERP10 no ha dado de alta la factura (500): inventado') }
        await Promise.resolve()
        const doc = 100 + erp.facturas.length
        const f = { ...fd, Documento: doc }
        erp.facturas.push(f); erp.altas++
        return f
      },
      subirDocumento: async () => { erp.subidas++; return o.subidaFalla ? { status: 500, motivo: 'The specified container does not exist.' } : { status: 200, motivo: null } },
    },
  }
  return { p, filas, erp, pasan: (min: number) => { reloj += min * 60_000 } }
}
const PDF = { ruta: 'cuenta/x/f-0001.pdf', nombre: 'f-0001.pdf' }

describe('la factura de ERP10 de una recibida', () => {
  it('la serie 2, con el proveedor, su NIF, el IVA y los gastos en Apuntes (las cuentas, las de ERP10)', () => {
    const r = facturaRecibidaErp10(recibida({ iva: [{ pct: 10, base: 4000, cuota: 400 }, { pct: 21, base: 6000, cuota: 1260 }], total: 11660, gastos: [{ cuenta: '62900000', importe: 4000 }, { cuenta: '62300000', importe: 6000 }] }), { hoy: HOY })
    expect('factura' in r && r.factura).toEqual({
      Ejercicio: '2026', Serie: '2', TipoAsiento: 2, TipoFactura: 1, Fecha: 20261005, FechaFactura: 20261003, FechaIntroduccionFactura: 20261119,
      CuentaCliente: '40000009', CifCliente: 'B00000000', NombreCliente: 'Proveedor Inventado, S.L.', NumeroFactura: 'F-0001',
      Descripcion: 'F-0001-Proveedor Inventado, S.L.',
      BaseImponible1: 60, PorcentajeIVA1: 21, CuotaIVA1: 12.6, BaseImponible2: 40, PorcentajeIVA2: 10, CuotaIVA2: 4,
      TotalFactura: 116.6, TotalGastosIngresos: 100,
      Apuntes: [
        { Linea: 1, Cuenta: '62300000', Concepto: 'F-0001-Proveedor Inventado, S.L.', Fecha: 20261005, Importe: 60 },
        { Linea: 2, Cuenta: '62900000', Concepto: 'F-0001-Proveedor Inventado, S.L.', Fecha: 20261005, Importe: 40 },
      ],
    })
  })
  it('lo no medido no sale por aquí, y dice que sale con el Excel', () => {
    const porque = (x: Partial<RecibidaParaApi>) => { const r = facturaRecibidaErp10(recibida(x), { hoy: HOY }); return 'porque' in r ? r.porque : '' }
    expect(porque({ retencion: { tipo: 'PRO' } })).toContain('retención')
    expect(porque({ tipoOperacion: 'ISP' })).toContain('Sácala con el Excel')
    expect(porque({ numero: ' ' })).toContain('número')
    expect(porque({ total: 12000 })).toContain('No cuadra')
    expect(porque({ gastos: [{ cuenta: '62300000', importe: 9000 }] })).toContain('suma de las bases')
    expect(porque({ iva: [1, 2, 3, 4].map((i) => ({ pct: i, base: 2500, cuota: 0 })), total: 10000 })).toContain('hasta tres')
  })
  it('los meses de la búsqueda: del asiento hasta hoy', () => {
    expect(mesesDeBusqueda('2026-10-05', HOY)).toEqual(['2026-10', '2026-11'])
  })
})

describe('nada sale dos veces', () => {
  it('nueva: da de alta la cuenta que falta, la escribe, apunta su número y sube su PDF; otra vez, ya estaba', async () => {
    const m = mundo({ tiene: ['62300000'] })
    const r = await sacarRecibida(recibida(), [{ codigo: '40000009', nombre: 'Proveedor Inventado, S.L.', nif: 'B00000000' }], PDF, m.p)
    expect(r).toMatchObject({ estado: 'en_erp10', serie: '2', documento: 100, enlazada: false, pdf: 'subido', sinApuntar: true })
    expect(m.erp.creadas).toEqual(['40000009'])
    expect(m.filas.get('asiento-1')).toMatchObject({ estado: 'en_erp10', erp10_documento: 100, pdf: 'subido' })
    const otra = await sacarRecibida(recibida(), [], PDF, m.p)
    expect(otra).toMatchObject({ estado: 'ya_estaba', documento: 100 })
    expect(m.erp.altas).toBe(1)
  })
  it('se corta a la mitad (ERP10 ya la tiene, Sumied no lo ha apuntado): enseguida, en marcha; pasados 3 minutos, la encuentra y la enlaza', async () => {
    const m = mundo({ ponerFallaEnErp10: true })
    await expect(sacarRecibida(recibida(), [], PDF, m.p)).rejects.toThrow('se ha cortado')
    expect(m.erp.altas).toBe(1)
    expect(m.filas.get('asiento-1')!.estado).toBe('enviando')
    expect(await sacarRecibida(recibida(), [], PDF, m.p)).toMatchObject({ estado: 'en_marcha' })
    m.pasan(4)
    const r = await sacarRecibida(recibida(), [], PDF, m.p)
    expect(r).toMatchObject({ estado: 'en_erp10', documento: 100, enlazada: true })
    expect(m.erp.altas).toBe(1)
    expect(m.filas.get('asiento-1')).toMatchObject({ estado: 'en_erp10', intentos: 2, enlazada: true })
  })
  it('dos clics a la vez: una sola alta', async () => {
    const m = mundo()
    const [a, b] = await Promise.all([sacarRecibida(recibida(), [], PDF, m.p), sacarRecibida(recibida(), [], PDF, m.p)])
    expect([a.estado, b.estado].sort()).toEqual(['en_erp10', 'en_marcha'])
    expect(m.erp.altas).toBe(1)
  })
  it('ERP10 dice que no: queda «no pudo» con su motivo; la siguiente vez se vuelve a intentar y entra una', async () => {
    const m = mundo({ altaFalla: 1 })
    const r = await sacarRecibida(recibida(), [], PDF, m.p)
    expect(r).toMatchObject({ estado: 'no_pudo', porque: 'ERP10 no ha dado de alta la factura (500): inventado' })
    expect(m.filas.get('asiento-1')).toMatchObject({ estado: 'no_pudo', motivo: 'ERP10 no ha dado de alta la factura (500): inventado' })
    expect(await sacarRecibida(recibida(), [], PDF, m.p)).toMatchObject({ estado: 'en_erp10', documento: 100 })
    expect([m.erp.intentosAlta, m.erp.altas]).toEqual([2, 1])
  })
  it('alguien ya la metió a mano: se enlaza, no se escribe otra; si hay dos, no se toca nada', async () => {
    const m1 = mundo({ yaEnErp10: 1 })
    expect(await sacarRecibida(recibida(), [], null, m1.p)).toMatchObject({ estado: 'en_erp10', documento: 50, enlazada: true })
    expect(m1.erp.altas).toBe(0)
    const m2 = mundo({ yaEnErp10: 2 })
    expect(await sacarRecibida(recibida(), [], null, m2.p)).toMatchObject({ estado: 'no_pudo', porque: 'Hay 2 facturas F-0001 de este proveedor en ERP10: no se toca nada. Míralo en ERP10.' })
    expect(m2.erp.altas).toBe(0)
  })
  it('el PDF no sube: la factura sigue en ERP10 (no se puede borrar) y se dice', async () => {
    const m = mundo({ subidaFalla: true })
    const r = await sacarRecibida(recibida(), [], PDF, m.p)
    expect(r).toMatchObject({ estado: 'en_erp10', pdf: 'fallo', porque: 'ERP10 no ha guardado el PDF (500): The specified container does not exist.' })
    expect(m.filas.get('asiento-1')).toMatchObject({ estado: 'en_erp10', pdf: 'fallo' })
  })
  it('una que no sale por aquí no coge el asiento (no deja fila)', async () => {
    const m = mundo()
    expect(await sacarRecibida(recibida({ tipoOperacion: 'ISP' }), [], PDF, m.p)).toMatchObject({ estado: 'no_pudo' })
    expect(m.filas.size).toBe(0)
  })
})

// ── Con el cliente de verdad contra el ERP10 simulado ─────────────────────────────────

const sinToken: AlmacenToken = { leer: async () => null, guardar: async () => {}, caida: async () => {} }
const clienteDe = (empresa: EmpresaSimulada, escribir: boolean) => {
  const sim = erp10Simulado({ empresas: { 101: empresa } })
  return new ClienteErp10({
    base: 'https://erp10.invalid', nombreBd: 'D', claves: { client_id: 'cliente-inventado', client_secret: 'x', username: 'x', password: 'codigo-inventado' },
    lista: [{ companyId: 'sociedad-a', codEmpresa: '101', nif: 'B00000000' }], codEmpresa: '101', almacen: sinToken, fetch: sim.fetch, escribir,
  })
}

describe('el cliente escribe solo si se le pide, y solo tres rutas', () => {
  it('sin escribir, el alta para; con escribir, una ruta que no está en la lista también', async () => {
    const e: EmpresaSimulada = { cif: 'B00000000', apuntes: [] }
    await expect(clienteDe(e, false).altaFactura({})).rejects.toThrow('no escribe nada en ERP10')
    const c = clienteDe(e, true)
    // @ts-expect-error: llamar es privado; se prueba el freno.
    await expect(c.llamar('POST', '/api/apuntes/add', undefined, {})).rejects.toThrow('no está en la lista')
  })
  it('una recibida entera: da de alta el proveedor que falta, la factura con su asiento y su PDF; en el paso 3 su asiento suma lo de Sumied', async () => {
    const empresa: EmpresaSimulada = { cif: 'B00000000', apuntes: [], subcuentas: ['62300000', '47200000'] }
    const c = clienteDe(empresa, true)
    const filas = new Map<string, Envio>()
    const p: PuertoEscribir = {
      hoy: HOY,
      tomar: async (id) => {
        const f = filas.get(id)
        if (f) return { tomado: false, envio: f }
        const n: Envio = { id: `e-${id}`, entry_id: id, estado: 'enviando', erp10_ejercicio: null, erp10_serie: null, erp10_documento: null, enlazada: false, pdf: null, motivo: null, intentos: 1, lote_id: null }
        filas.set(id, n)
        return { tomado: true, envio: n }
      },
      poner: async (id, cambios) => { Object.assign([...filas.values()].find((x) => x.id === id)!, cambios) },
      pdf: async () => new Uint8Array([37, 80, 68, 70, 45]),
      erp10: c,
    }
    const r = await sacarRecibida(recibida(), [{ codigo: '40000009', nombre: 'Proveedor Inventado, S.L.', nif: 'B00000000' }], PDF, p)
    expect(r).toMatchObject({ estado: 'en_erp10', serie: '2', enlazada: false, pdf: 'subido' })
    expect(empresa.subcuentas).toContain('40000009')
    expect(empresa.facturas).toHaveLength(1)
    expect(empresa.pdfs).toEqual([{ Ejercicio: '2026', Serie: '2', Documento: r.documento, NombreArchivo: 'f-0001.pdf', bytes: 8 }])
    expect(sumarPorCuenta(empresa.apuntes).map((x) => [x.subcuenta, x.debe, x.haber])).toEqual([['40000009', 0, 12100], ['47200000', 2100, 0], ['62300000', 10000, 0]])
    // Otra vez, con otra fila (como si Sumied la hubiera perdido): ERP10 la tiene y se enlaza, no se escribe otra.
    filas.clear()
    expect(await sacarRecibida(recibida(), [], null, p)).toMatchObject({ estado: 'en_erp10', enlazada: true, documento: r.documento })
    expect(empresa.facturas).toHaveLength(1)
  })
  it('sin almacén de documentos en ERP10 (como Diez): la factura entra y el PDF se dice que no', async () => {
    const empresa: EmpresaSimulada = { cif: 'B00000000', apuntes: [], subcuentas: ['62300000', '40000009'], sinAlmacen: true }
    const c = clienteDe(empresa, true)
    const p: PuertoEscribir = { ...mundo().p, erp10: c }
    expect(await sacarRecibida(recibida(), [], PDF, p)).toMatchObject({ estado: 'en_erp10', pdf: 'fallo', porque: 'ERP10 no ha guardado el PDF (500): The specified container does not exist.' })
  })
})
