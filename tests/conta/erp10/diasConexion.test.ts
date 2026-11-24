// tests/conta/erp10/diasConexion.test.ts — X10e · Los días del TPV salen por la conexión con ERP10
// (erp10Escribir.ts, sacarDia y facturaDiaErp10), armados en el servidor desde la base con la misma
// pieza que el Excel (erp10DesdeLaBase.ts): la factura del día (rango de facturas, «Clientes de
// contado» y su IVA) y su cobro como asiento. Las dos formas: el día de un asiento (los de antes del
// R07) y el de dos (la factura y su cobro aparte). El cuerpo del navegador no cambia lo que entra,
// nada sale dos veces, el caso que no sale se dice, y la regla 31: el mismo día por el Excel y por la
// conexión deja lo mismo, céntimo a céntimo. Con el ERP10 simulado y el cliente de verdad. Inventado (T11).

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { columnas } from '../../../supabase/functions/_shared/diezExcel.ts'
import { facturaDiaErp10, partidasDeLoQueSale, sacarUno, type Envio, type PuertoEscribir, type Resultado } from '../../../supabase/functions/_shared/erp10Escribir'
import { loQueSaleDesdeLaBase, pedidasDelCuerpo, type BaseCruda } from '../../../supabase/functions/_shared/erp10DesdeLaBase'
import { ClienteErp10, type AlmacenToken } from '../../../supabase/functions/_shared/erp10Cliente'
import { columnasAsientos } from '@/modules/conta/erp10/ficheros'
import { XML_EXPEDIDAS } from '@/modules/conta/erp10/configuracion'
import { armarSalida, prepararDescarga } from '@/modules/conta/erp10/salida'
import { aAsientos, aDias, aEmitidas, aPorSalir, aRecibidas } from '@/modules/conta/services/erp10Service'
import { erp10Simulado, type EmpresaSimulada } from './simulado'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const UNO = id(1) // un día de antes del R07: un solo asiento (las ventas y lo cobrado)
const DOS = id(2) // un día del R07: la factura del día…
const COBRO = id(92) // …y su cobro, aparte
const LD = (cuenta: string, plantilla: string, debe: number, haber: number, iva?: [number, number]) =>
  ({ cuenta, plantilla, nombre: `Cuenta inventada ${cuenta}`, debe, haber, tipoIva: iva?.[0] ?? null, baseIva: iva?.[1] ?? null, libro: iva ? 'issued' : null })
const partida = (entryId: string, o: Record<string, unknown> = {}) => ({
  entry_id: entryId, serie: 1, numero: 1, fecha: '2026-10-05', concepto: 'Inventado X10e', origen: 'sales_day', clase: 'emitida', importe: 550, base_iva: 500,
  numero_factura: null, nif: null, tercero: null, cuentas_base: 1, tiene_pdf: false, de_otro_mes: false, sale: true, avisos: [], ...o,
})
const dia = (entryId: string, o: Record<string, unknown> = {}) => ({
  entryId, serie: 1, numero: 1, fecha: '2026-10-05', concepto: 'Ventas del día · TPV inventado', origen: 'revo', local: 'Local inventado', localId: null,
  primero: '5001', ultimo: '5048', facturas: 48, contadores: 1,
  // 300 en caja y 250 por una plataforma; 500 de ventas al 10 %.
  lineas: [LD('57000000', '570', 300, 0), LD('43000001', '4300', 250, 0), LD('47700000', '477', 0, 50, [10, 500]), LD('70000000', '700', 0, 500)], ...o,
})
const CUENTAS = [['57000000', '570'], ['43000001', '4300'], ['47700000', '477'], ['70000000', '700'], ['43000099', '4300']].map(([codigo, plantilla]) => ({ codigo, plantilla, nombre: `Cuenta inventada ${codigo}` }))

const BASE: BaseCruda = {
  carpeta: 'C:\\Sumied\\0007\\',
  porSalir: { mes: '2026-10-01', desde: '2026-10-01', codigo: '0007', largo: 8, cuentas_nuevas: [], partidas: [
    partida(UNO), partida(DOS, { fecha: '2026-10-06' }), partida(COBRO, { fecha: '2026-10-06', origen: 'sales_day_payment', clase: 'asiento' }),
    partida(id(8), { fecha: '2026-10-07' }), partida(id(9), { fecha: '2026-10-07' }),
  ] },
  recibidas: { recibidas: [], cuentas: [], yaSalidas: {} },
  emitidas: { emitidas: [], cuentas: [], yaSalidas: {}, corregidas: [] },
  asientos: {
    asientos: [{ entryId: COBRO, serie: 1, numero: 92, fecha: '2026-10-06', concepto: 'Cobro del día · TPV inventado', origen: 'sales_day_payment',
      lineas: [
        { cuenta: '57000000', plantilla: '570', nombre: 'Caja inventada', concepto: 'Cobra Efectivo', debe: 300, haber: 0 },
        { cuenta: '43000001', plantilla: '4300', nombre: 'Plataforma inventada', concepto: 'Cobra Plataforma', debe: 250, haber: 0 },
        { cuenta: '43000099', plantilla: '4300', nombre: 'Clientes de contado', concepto: 'El cobro del día · Clientes de contado', debe: 0, haber: 550 },
      ] }],
    cuentas: CUENTAS, yaSalidas: {},
  },
  dias: {
    dias: [
      dia(UNO),
      dia(DOS, { fecha: '2026-10-06', primero: '6001', ultimo: '6040', facturas: 40, cobroId: COBRO,
        lineas: [LD('43000099', '4300', 550, 0), LD('47700000', '477', 0, 50, [10, 500]), LD('70000000', '700', 0, 500)] }),
      // Folvy: el mismo día y local en dos asientos (uno por plataforma). La factura es una por día y local: no sale.
      dia(id(8), { fecha: '2026-10-07', origen: 'folvy', localId: 'L1', local: 'Local inventado Folvy' }),
      dia(id(9), { fecha: '2026-10-07', origen: 'folvy', localId: 'L1', local: 'Local inventado Folvy' }),
    ],
    contado: [{ codigo: '43000099', plantilla: '4300', nombre: 'Clientes de contado' }],
    cuentas: CUENTAS, yaSalidas: {},
  },
}

/** Un puerto con las reglas de conta_erp10_envio_tomar (por entry_id) y el ERP10 simulado detrás del cliente de verdad. */
function mundo(o: { cortaAlPoner?: boolean } = {}) {
  const empresa: EmpresaSimulada = { cif: 'B00000000', apuntes: [] }
  const sim = erp10Simulado({ empresas: { 101: empresa } })
  const sinToken: AlmacenToken = { leer: async () => null, guardar: async () => {}, caida: async () => {} }
  const c = new ClienteErp10({
    base: 'https://erp10.invalid', nombreBd: 'D', claves: { client_id: 'cliente-inventado', client_secret: 'x', username: 'x', password: 'codigo-inventado' },
    lista: [{ companyId: 'sociedad-a', codEmpresa: '101', nif: 'B00000000' }], codEmpresa: '101', almacen: sinToken, fetch: sim.fetch, escribir: true,
  })
  let reloj = 0
  let corta = o.cortaAlPoner ?? false
  const filas = new Map<string, Envio & { cambiado: number }>()
  const p: PuertoEscribir = {
    hoy: '2026-11-20',
    tomar: async (entryId, clase) => {
      const f = filas.get(entryId)
      if (!f) {
        const n = { id: `e-${entryId}`, entry_id: entryId, estado: 'enviando' as const, erp10_ejercicio: null, erp10_serie: null, erp10_documento: null, enlazada: false, pdf: null, motivo: null, intentos: 1, lote_id: null, clase, cambiado: reloj }
        filas.set(entryId, n)
        return { tomado: true, envio: { ...n } }
      }
      if (f.estado === 'no_pudo' || (f.estado === 'enviando' && reloj - f.cambiado > 3)) { Object.assign(f, { estado: 'enviando', intentos: f.intentos + 1, cambiado: reloj }); return { tomado: true, envio: { ...f } } }
      return { tomado: false, envio: { ...f } }
    },
    poner: async (eid, cambios) => {
      if (corta && cambios.estado === 'en_erp10') { corta = false; throw new Error('se ha cortado (inventado)') }
      Object.assign([...filas.values()].find((x) => x.id === eid)!, cambios, { cambiado: reloj })
    },
    pdf: async () => new Uint8Array(),
    usados: async (entryId) => new Set([...filas.values()].filter((x) => x.estado === 'en_erp10' && x.entry_id !== entryId)
      .flatMap((x) => [`${x.erp10_serie}/${x.erp10_documento}`, ...(x.cobro_documento ? [`${x.cobro_serie}/${x.cobro_documento}`] : [])])),
    erp10: c,
  }
  const altas = () => sim.vistas.filter((v) => v.metodo === 'POST' && (v.ruta === '/api/facturas/add' || v.ruta === '/api/apuntes/add')).map((v) => v.ruta)
  return { p, filas, empresa, altas, pasan: (min: number) => { reloj += min } }
}

const sacar = async (m: ReturnType<typeof mundo>, pedidas: string[]) => {
  const r = await loQueSaleDesdeLaBase(BASE, pedidas)
  const resultados: Resultado[] = []
  for (const x of r.salen) resultados.push(...(await sacarUno(x, r.cuentasNuevas, m.p)))
  return { ...r, resultados }
}

describe('X10e · el día de UN asiento (antes del R07)', () => {
  it('sale su factura del día (con el rango, «Clientes de contado» y el IVA) y su cobro; un solo envío, con los dos números', async () => {
    const m = mundo()
    const { salen, resultados } = await sacar(m, [UNO])
    expect(salen.map((x) => [x.clase, x.numero, x.clase === 'dia' && x.cobro.aparte])).toEqual([['dia', '5001-5048', false]])
    expect(resultados).toMatchObject([{ entryId: UNO, clase: 'dia', estado: 'en_erp10', serie: '1', cobro: { serie: '1' } }])
    const [f] = m.empresa.facturas!
    expect(f).toMatchObject({ Serie: '1', CuentaCliente: '43000099', NombreCliente: 'Clientes de contado', NumeroFactura: '5001-5048', FechaFactura: 20261005,
      BaseImponible1: 500, PorcentajeIVA1: 10, CuotaIVA1: 50, TotalFactura: 550, NumeroFacturasIncluidas340: 48, PrimerNumeroFactura340: '5001', UltimoNumeroFactura340: '5048' })
    const cobro = m.empresa.apuntes.filter((a) => a.TipoAsiento === 0)
    expect(cobro.map((a) => a.Detalles.map((l) => [l.Cuenta, l.Debe, l.Haber]))).toEqual([[['57000000', 300, 0], ['43000001', 250, 0], ['43000099', 0, 550]]])
    expect(m.filas.get(UNO)).toMatchObject({ estado: 'en_erp10', clase: 'emitida', dia: true, erp10_documento: f.Documento, cobro_serie: '1', cobro_documento: cobro[0].Documento })
  })
})

describe('X10e · el día de DOS asientos (R07)', () => {
  it('la factura del día con su envío y su cobro (el otro asiento) con el suyo; los dos, con la marca del día', async () => {
    const m = mundo()
    const { salen, resultados } = await sacar(m, [DOS])
    expect(salen.map((x) => [x.clase, x.entryId, x.clase === 'dia' && x.cobro.entryId, x.clase === 'dia' && x.cobro.aparte])).toEqual([['dia', DOS, COBRO, true]])
    expect(resultados.map((r) => [r.entryId, r.clase, r.estado])).toEqual([[DOS, 'dia', 'en_erp10'], [COBRO, 'asiento', 'en_erp10']])
    expect(m.empresa.facturas!.map((f) => [f.NumeroFactura, f.PrimerNumeroFactura340, f.UltimoNumeroFactura340, f.NumeroFacturasIncluidas340])).toEqual([['6001-6040', '6001', '6040', 40]])
    expect(m.filas.get(DOS)).toMatchObject({ estado: 'en_erp10', clase: 'emitida', dia: true })
    expect(m.filas.get(DOS)?.cobro_documento).toBeUndefined()
    expect(m.filas.get(COBRO)).toMatchObject({ estado: 'en_erp10', clase: 'asiento', dia: true })
  })
  it('pedir el cobro es pedir su día: sale una sola vez, con su factura', async () => {
    const m = mundo()
    const { salen } = await sacar(m, [COBRO, DOS])
    expect(salen.map((x) => x.entryId)).toEqual([DOS])
  })
})

describe('X10e · el cuerpo del navegador no cambia lo que entra', () => {
  it('solo se leen los ids: un total o un rango distinto en el cuerpo no llegan a ERP10', async () => {
    const cuerpo = { entradas: [UNO], dias: [{ api: { entryId: UNO, total: 99999900, primero: '1', ultimo: '9', facturas: 1 } }] }
    const m = mundo()
    await sacar(m, pedidasDelCuerpo(cuerpo))
    expect(m.empresa.facturas!.map((f) => [f.TotalFactura, f.PrimerNumeroFactura340, f.UltimoNumeroFactura340, f.NumeroFacturasIncluidas340])).toEqual([[550, '5001', '5048', 48]])
  })
})

describe('X10e · nada sale dos veces', () => {
  it('otra vez: ya estaba, sin una sola alta más (las dos formas)', async () => {
    const m = mundo()
    await sacar(m, [UNO, DOS])
    expect(m.altas()).toHaveLength(4)
    const otra = await sacar(m, [UNO, DOS])
    expect(otra.resultados.map((r) => [r.entryId, r.estado])).toEqual([[UNO, 'ya_estaba'], [DOS, 'ya_estaba'], [COBRO, 'ya_estaba']])
    expect(m.altas()).toHaveLength(4)
  })
  it('dos clics a la vez: uno lo mete, el otro lo ve en marcha (o ya dentro); una factura y un cobro', async () => {
    const m = mundo()
    const [a, b] = await Promise.all([sacar(m, [UNO]), sacar(m, [UNO])])
    expect([a.resultados[0].estado, b.resultados[0].estado].filter((x) => x === 'en_erp10')).toHaveLength(1)
    expect(m.altas()).toEqual(['/api/facturas/add', '/api/apuntes/add'])
  })
  it('cortado a la mitad (la factura y el cobro ya en ERP10): al volver, enlaza los dos, sin escribirlos otra vez', async () => {
    const m = mundo({ cortaAlPoner: true })
    await expect(sacar(m, [UNO])).rejects.toThrow('se ha cortado')
    expect((await sacar(m, [UNO])).resultados[0].estado).toBe('en_marcha')
    m.pasan(4)
    const r = await sacar(m, [UNO])
    expect(r.resultados).toMatchObject([{ estado: 'en_erp10', enlazada: true, cobro: { enlazado: true } }])
    expect(m.altas()).toHaveLength(2)
  })
  it('si el cobro aparte falla, la factura queda en ERP10 y el cobro se reintenta solo, sin repetir la factura', async () => {
    const m = mundo()
    m.empresa.fallaAsiento = 'Cobr'
    const r1 = await sacar(m, [DOS])
    expect(r1.resultados.map((r) => [r.entryId, r.estado])).toEqual([[DOS, 'en_erp10'], [COBRO, 'no_pudo']])
    delete m.empresa.fallaAsiento
    const r2 = await sacar(m, [DOS])
    expect(r2.resultados.map((r) => [r.entryId, r.estado])).toEqual([[DOS, 'ya_estaba'], [COBRO, 'en_erp10']])
    expect(m.empresa.facturas).toHaveLength(1)
  })
  it('si uno falla, los demás siguen', async () => {
    const m = mundo()
    m.empresa.fallaAsiento = 'Cobr'
    const r = await sacar(m, [UNO, DOS])
    // El día de un asiento escribe su cobro con el nombre del cobro: falla; el de dos, su factura entra y su cobro no.
    expect(r.resultados.map((x) => [x.entryId, x.estado])).toEqual([[UNO, 'no_pudo'], [DOS, 'en_erp10'], [COBRO, 'no_pudo']])
  })
})

describe('X10e · el caso que no sale, dicho', () => {
  it('Folvy con el mismo día y local en dos asientos (uno por plataforma): ninguno sale, con el nombre del local y su porqué', async () => {
    const r = await loQueSaleDesdeLaBase(BASE, [id(8), id(9)])
    expect(r.salen).toEqual([])
    expect(r.noSalen.map((x) => x.entryId)).toEqual([id(8), id(9)])
    for (const x of r.noSalen) expect(x.porque).toMatch(/uno por plataforma/)
  })
  it('sin el rango de facturas, la factura del día no se arma: lo dice', () => {
    const h = facturaDiaErp10({ entryId: UNO, numero: '5001', fechaFactura: '2026-10-05', fechaAsiento: '2026-10-05', nif: '', nombre: 'Clientes de contado', cliente: '43000099',
      ingresos: [{ cuenta: '70000000', importe: 50000 }], iva: [{ pct: 10, base: 50000, cuota: 5000 }], total: 55000, facturas: 0, primero: '', ultimo: '' }, { hoy: '2026-11-20' })
    expect(h).toEqual({ porque: 'Le falta el rango de facturas del día.' })
  })
})

// ── Regla 31: el mismo día por el Excel y por la conexión, céntimo a céntimo ─────────────

const letraE = (campo: string) => XLSX.utils.encode_col(columnas(XML_EXPEDIDAS)[campo] - 1)
const letraA = (campo: string) => XLSX.utils.encode_col(columnasAsientos()[campo] - 1)
const celdas = (fila: readonly (string | number)[]) => Object.fromEntries(fila.flatMap((v, i) => (v === '' ? [] : [[XLSX.utils.encode_col(i), v]])))
const cts = (v: unknown) => Math.round(Number(v) * 100)

describe('regla 31 · el mismo día por el Excel y por la conexión deja lo mismo', () => {
  it('las dos formas: total, bases, cuotas, ventas y cada apunte del cobro, céntimo a céntimo; y la misma partida en la salida', async () => {
    const s = armarSalida(aPorSalir(BASE.porSalir), aRecibidas(BASE.recibidas), aEmitidas(BASE.emitidas), BASE.carpeta, aAsientos(BASE.asientos), aDias(BASE.dias))
    // Lo que lleva el Excel: la fila de dias-tpv.xlsx y las del cobro en asientos.xlsx (en un día de un asiento, con el id del día).
    const excel: string[] = []
    for (const d of s.ficheros.dias) {
      const c = celdas(d.filas[0])
      excel.push(`total ${cts(c[letraE('024')] ?? c.AB)}`, `base ${cts(c.J)}`, `pct ${c.K}`, `cuota ${cts(c.L)}`, `venta ${c.AA} ${cts(c.AC)}`, `rango ${c.AJ} ${c.AK} ${c.AL}`)
      const cobroId = d.cobroId ?? d.entryId
      for (const f of s.ficheros.asientos.filter((a) => a.entryId === cobroId).flatMap((a) => a.filas).map(celdas)) {
        if (f[letraA('005')]) excel.push(`debe ${f[letraA('005')]} ${cts(f[letraA('008')])}`)
        if (f[letraA('010')]) excel.push(`haber ${f[letraA('010')]} ${cts(f[letraA('013')])}`)
      }
    }
    // Lo que ha entrado en ERP10 por la conexión.
    const m = mundo()
    const { salen } = await sacar(m, [UNO, DOS])
    const conexion: string[] = []
    for (const f of m.empresa.facturas!) {
      conexion.push(`total ${cts(f.TotalFactura)}`, `base ${cts(f.BaseImponible1)}`, `pct ${f.PorcentajeIVA1}`, `cuota ${cts(f.CuotaIVA1)}`,
        ...(f.Apuntes as { Cuenta: string; Importe: number }[]).map((a) => `venta ${a.Cuenta} ${cts(a.Importe)}`),
        `rango ${f.NumeroFacturasIncluidas340} ${f.PrimerNumeroFactura340} ${f.UltimoNumeroFactura340}`)
      const cobro = m.empresa.apuntes.filter((a) => a.TipoAsiento === 0)[m.empresa.facturas!.indexOf(f)]
      for (const l of cobro.Detalles) conexion.push(l.Debe ? `debe ${l.Cuenta} ${cts(l.Debe)}` : `haber ${l.Cuenta} ${cts(l.Haber)}`)
    }
    expect(conexion).toEqual(excel)
    const suma = (xs: string[]) => xs.filter((x) => /^(total|base|cuota|venta|debe|haber) /.test(x)).reduce((t, x) => t + Number(x.split(' ').pop()), 0)
    console.log(`regla 31 · X10e · Excel: ${excel.length} importes, ${suma(excel)} céntimos · conexión: ${conexion.length} importes, ${suma(conexion)} céntimos`)
    expect(suma(conexion)).toBe(suma(excel))
    // Y en la salida de Sumied se apunta lo mismo que con el Excel: la misma clase y la misma huella.
    const porExcel = (await prepararDescarga(s)).partidas.map((p) => [p.entry_id, p.clase, p.huella]).sort()
    const porConexion = [...partidasDeLoQueSale(salen)].map(([k, v]) => [k, v.clase, v.huella]).sort()
    expect(porConexion).toEqual(porExcel)
  })
})
