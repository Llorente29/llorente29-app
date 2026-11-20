// tests/conta/erp10/asientos.test.ts — X10d · Los asientos de Sumied (lo del X07) salen por la
// conexión con ERP10 (supabase/functions/_shared/erp10Escribir.ts, asientoErp10 y sacarAsiento),
// armados en el servidor desde la base con la misma pieza que el Excel (erp10DesdeLaBase.ts).
// Uno de dos apuntes y otro de más; el cuerpo del navegador no cambia lo que entra; nada sale dos
// veces (también con un corte a la mitad y con dos asientos gemelos); un día del TPV no sale; y la
// regla 10 con el ERP10 simulado: sacar, que falle uno, volver a sacar. Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { asientoErp10, sacarAsiento, type AsientoParaApi, type Envio, type PuertoEscribir } from '../../../supabase/functions/_shared/erp10Escribir'
import { loQueSaleDesdeLaBase, pedidasDelCuerpo, type BaseCruda } from '../../../supabase/functions/_shared/erp10DesdeLaBase'
import { ClienteErp10, type AlmacenToken } from '../../../supabase/functions/_shared/erp10Cliente'
import { erp10Simulado, type EmpresaSimulada } from './simulado'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ap = (cuenta: string, debe: number, haber: number, concepto = '') => ({ cuenta, nombre: `Cuenta inventada ${cuenta}`, concepto, debe, haber })
const pago: AsientoParaApi = { entryId: id(1), numero: '4/1', fecha: '2026-10-05', apuntes: [ap('41000012', 10000, 0, 'Pago inventado'), ap('57200001', 0, 10000, 'Pago inventado')] }
const nomina: AsientoParaApi = {
  entryId: id(2), numero: '4/2', fecha: '2026-10-31',
  apuntes: [ap('64000000', 150000, 0, 'Nómina inventada'), ap('64200000', 45000, 0, 'Nómina inventada'), ap('47510000', 0, 20000, 'Nómina inventada'), ap('47600000', 0, 55000, 'Nómina inventada'), ap('46500000', 0, 120000, 'Nómina inventada')],
}

describe('el asiento de ERP10 (ApunteSimplificado)', () => {
  it('de dos apuntes: la serie 1 del Excel, la fecha, el concepto y una línea por lado', () => {
    expect(asientoErp10(pago)).toEqual({ apunte: {
      Ejercicio: '2026', Serie: '1', Fecha: 20261005, Descripcion: 'Pago inventado',
      Detalles: [
        { Linea: 1, Cuenta: '41000012', Debe: 100, Haber: 0, Descripcion: 'Pago inventado' },
        { Linea: 2, Cuenta: '57200001', Debe: 0, Haber: 100, Descripcion: 'Pago inventado' },
      ],
    } })
  })
  it('de cinco apuntes (una nómina), y un apunte con debe y haber a la vez va en dos líneas, como en el Excel', () => {
    const r = asientoErp10(nomina)
    expect('apunte' in r && (r.apunte.Detalles as { Cuenta: string; Debe: number; Haber: number }[]).map((l) => [l.Cuenta, l.Debe, l.Haber])).toEqual([
      ['64000000', 1500, 0], ['64200000', 450, 0], ['47510000', 0, 200], ['47600000', 0, 550], ['46500000', 0, 1200],
    ])
    const doble = asientoErp10({ ...pago, apuntes: [ap('55500000', 5000, 2000), ap('57200001', 0, 3000)] })
    expect('apunte' in doble && (doble.apunte.Detalles as { Cuenta: string }[]).map((l) => l.Cuenta)).toEqual(['55500000', '55500000', '57200001'])
  })
  it('lo que no cuadra, un negativo o un apunte solo no salen, y lo dicen', () => {
    const porque = (x: AsientoParaApi) => { const r = asientoErp10(x); return 'porque' in r ? r.porque : '' }
    expect(porque({ ...pago, apuntes: [ap('41000012', 10000, 0), ap('57200001', 0, 9000)] })).toBe('No cuadra: 100 al debe y 90 al haber.')
    expect(porque({ ...pago, apuntes: [ap('41000012', -10000, 0), ap('57200001', 0, -10000)] })).toContain('negativo')
    expect(porque({ ...pago, apuntes: [ap('41000012', 10000, 0)] })).toBe('No tiene dos apuntes con importe. Míralo en Sumied.')
  })
})

// ── Desde la base ───────────────────────────────────────────────────────────────────

const partida = (n: number, clase: string, o: Record<string, unknown> = {}) => ({
  entry_id: id(n), serie: clase === 'asiento' ? 4 : 1, numero: n, fecha: '2026-10-05', concepto: `Inventado ${n}`, origen: 'manual', clase, importe: 100, base_iva: null, numero_factura: null,
  nif: null, tercero: null, cuentas_base: 0, tiene_pdf: false, de_otro_mes: false, sale: true, avisos: [], ...o,
})
const LD = (cuenta: string, plantilla: string, debe: number, haber: number, iva?: [number, number]) =>
  ({ cuenta, plantilla, nombre: `Cuenta inventada ${cuenta}`, debe, haber, tipoIva: iva?.[0] ?? null, baseIva: iva?.[1] ?? null, libro: iva ? 'issued' : null })
const BASE: BaseCruda = {
  carpeta: 'C:\\Sumied\\0007\\',
  porSalir: { mes: '2026-10-01', desde: '2026-10-01', codigo: '0007', largo: 8, cuentas_nuevas: [], partidas: [
    partida(1, 'asiento', { origen: 'bank' }), partida(2, 'asiento', { origen: 'payroll' }),
    partida(9, 'emitida', { origen: 'sales_day', importe: 550, base_iva: 500, cuentas_base: 1 }),
  ] },
  recibidas: { recibidas: [], cuentas: [], yaSalidas: {} },
  emitidas: { emitidas: [], cuentas: [], yaSalidas: {}, corregidas: [] },
  asientos: {
    asientos: [
      { entryId: id(1), serie: 4, numero: 1, fecha: '2026-10-05', concepto: 'Pago inventado', origen: 'bank',
        lineas: [{ cuenta: '4100012', plantilla: '410', nombre: 'Proveedor inventado', concepto: null, debe: 100, haber: 0 }, { cuenta: '5720001', plantilla: '572', nombre: 'Banco inventado', concepto: null, debe: 0, haber: 100 }] },
      { entryId: id(2), serie: 4, numero: 2, fecha: '2026-10-31', concepto: 'Nómina inventada', origen: 'payroll',
        lineas: [
          { cuenta: '6400000', plantilla: '640', nombre: 'Sueldos', concepto: null, debe: 1500, haber: 0 }, { cuenta: '6420000', plantilla: '642', nombre: 'Seguridad Social', concepto: null, debe: 450, haber: 0 },
          { cuenta: '4751000', plantilla: '4751', nombre: 'IRPF', concepto: null, debe: 0, haber: 200 }, { cuenta: '4760000', plantilla: '476', nombre: 'SS acreedora', concepto: null, debe: 0, haber: 550 },
          { cuenta: '4650000', plantilla: '465', nombre: 'Remuneraciones pendientes', concepto: null, debe: 0, haber: 1200 },
        ] },
    ],
    cuentas: ['4100012:410', '5720001:572', '6400000:640', '6420000:642', '4751000:4751', '4760000:476', '4650000:465'].map((x) => ({ codigo: x.split(':')[0], plantilla: x.split(':')[1], nombre: `Cuenta inventada ${x}` })),
    yaSalidas: {},
  },
  dias: {
    dias: [{ entryId: id(9), serie: 1, numero: 9, fecha: '2026-10-05', concepto: 'Ventas del día · TPV inventado', origen: 'revo', local: 'Local inventado', localId: null, primero: '5001', ultimo: '5048', facturas: 48, contadores: 1,
      lineas: [LD('57000000', '570', 550, 0), LD('47700000', '477', 0, 50, [10, 500]), LD('70000000', '700', 0, 500)] }],
    contado: [{ codigo: '43000099', plantilla: '4300', nombre: 'Clientes de contado' }],
    cuentas: [['57000000', '570'], ['47700000', '477'], ['70000000', '700'], ['43000099', '4300']].map(([codigo, plantilla]) => ({ codigo, plantilla, nombre: `Cuenta inventada ${codigo}` })),
    yaSalidas: {},
  },
}

describe('desde la base, con la misma pieza que el Excel', () => {
  it('los dos asientos salen, con las cuentas en ERP10 (8 cifras) y la huella de sus filas', async () => {
    const r = await loQueSaleDesdeLaBase(BASE, [id(1), id(2)])
    expect(r.salen.map((x) => [x.clase, x.numero])).toEqual([['asiento', '4/1'], ['asiento', '4/2']])
    const p = r.salen[0]
    expect(p.clase === 'asiento' && p.api.apuntes.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['41000012', 10000, 0], ['57200001', 0, 10000]])
    expect(p.huella).toMatch(/^[0-9a-f]{64}$/)
  })
  it('el cuerpo del navegador no cambia lo que entra: solo se leen los ids', async () => {
    const cuerpo = { entradas: [id(1)], asientos: [{ entryId: id(1), apuntes: [{ cuenta: '41000012', debe: 99999900, haber: 0 }] }] }
    const r = await loQueSaleDesdeLaBase(BASE, pedidasDelCuerpo(cuerpo))
    const a = r.salen[0]
    expect(a.clase === 'asiento' && asientoErp10(a.api)).toMatchObject({ apunte: { Detalles: [{ Cuenta: '41000012', Debe: 100 }, { Cuenta: '57200001', Haber: 100 }] } })
  })
  it('un día del TPV no sale por la conexión (ni su cobro): lo dice', async () => {
    const r = await loQueSaleDesdeLaBase(BASE, [id(9)])
    expect(r.salen).toEqual([])
    expect(r.noSalen).toEqual([{ entryId: id(9), porque: 'Es un día del TPV, y todavía no sale por la conexión: sigue con el Excel.' }])
  })
})

// ── Nada sale dos veces ──────────────────────────────────────────────────────────────

/** Un puerto con las reglas de conta_erp10_envio_tomar y un ERP10 de mentira que guarda lo que se le escribe. */
function mundo(o: { ponerFallaEnErp10?: boolean } = {}) {
  let reloj = 0
  const filas = new Map<string, Envio & { cambiado: number }>()
  const apuntes: { Ejercicio?: string; Serie?: string; Documento?: number; TipoAsiento?: number; Fecha?: number; Detalles?: { Cuenta?: string; Debe?: number; Haber?: number }[] }[] = []
  let altas = 0
  let falla = o.ponerFallaEnErp10 ?? false
  const p: PuertoEscribir = {
    hoy: '2026-11-19',
    tomar: async (entryId) => {
      const f = filas.get(entryId)
      if (!f) {
        const n = { id: `e-${entryId}`, entry_id: entryId, estado: 'enviando' as const, erp10_ejercicio: null, erp10_serie: null, erp10_documento: null, enlazada: false, pdf: null, motivo: null, intentos: 1, lote_id: null, cambiado: reloj }
        filas.set(entryId, n)
        return { tomado: true, envio: { ...n } }
      }
      if (f.estado === 'no_pudo' || (f.estado === 'enviando' && reloj - f.cambiado > 3)) { Object.assign(f, { estado: 'enviando', intentos: f.intentos + 1, cambiado: reloj }); return { tomado: true, envio: { ...f } } }
      return { tomado: false, envio: { ...f } }
    },
    poner: async (id, cambios) => {
      if (falla && cambios.estado === 'en_erp10') { falla = false; throw new Error('se ha cortado (inventado)') }
      Object.assign([...filas.values()].find((x) => x.id === id)!, cambios, { cambiado: reloj })
    },
    pdf: async () => new Uint8Array(),
    usados: async (entryId) => new Set([...filas.values()].filter((x) => x.estado === 'en_erp10' && x.entry_id !== entryId).map((x) => `${x.erp10_serie}/${x.erp10_documento}`)),
    erp10: {
      tieneSubcuenta: async () => true, crearSubcuenta: async () => {}, facturasDelMes: async () => [], altaFactura: async () => ({}), subirDocumento: async () => ({ status: 200, motivo: null }),
      apuntesDelMes: async (m) => apuntes.filter((a) => String(a.Fecha).startsWith(m.replace('-', ''))),
      altaApunte: async (x) => {
        altas++
        const a = { ...x, Documento: 5000 + apuntes.length, TipoAsiento: 0 } as (typeof apuntes)[number]
        apuntes.push(a)
        return a as Record<string, unknown>
      },
    },
  }
  return { p, filas, altas: () => altas, pasan: (min: number) => { reloj += min } }
}

describe('nada sale dos veces', () => {
  it('sale, y otra vez ya estaba; con un corte a la mitad, pasados 3 minutos se enlaza el que escribió', async () => {
    const m = mundo()
    expect(await sacarAsiento(pago, [], m.p)).toMatchObject({ estado: 'en_erp10', serie: '1', documento: 5000, enlazada: false, clase: 'asiento' })
    expect(await sacarAsiento(pago, [], m.p)).toMatchObject({ estado: 'ya_estaba', documento: 5000 })
    const c = mundo({ ponerFallaEnErp10: true })
    await expect(sacarAsiento(pago, [], c.p)).rejects.toThrow('se ha cortado')
    expect(await sacarAsiento(pago, [], c.p)).toMatchObject({ estado: 'en_marcha' })
    c.pasan(4)
    expect(await sacarAsiento(pago, [], c.p)).toMatchObject({ estado: 'en_erp10', documento: 5000, enlazada: true })
    expect(c.altas()).toBe(1)
  })
  it('dos asientos gemelos (el mismo pago dos veces, el mismo día): el segundo no se enlaza al primero, se escribe', async () => {
    const m = mundo()
    const gemelo = { ...pago, entryId: id(3), numero: '4/3' }
    expect(await sacarAsiento(pago, [], m.p)).toMatchObject({ estado: 'en_erp10', documento: 5000 })
    expect(await sacarAsiento(gemelo, [], m.p)).toMatchObject({ estado: 'en_erp10', documento: 5001, enlazada: false })
    expect(m.altas()).toBe(2)
  })
  it('dos clics a la vez: una sola alta', async () => {
    const m = mundo()
    const [a, b] = await Promise.all([sacarAsiento(nomina, [], m.p), sacarAsiento(nomina, [], m.p)])
    expect([a.estado, b.estado].sort()).toEqual(['en_erp10', 'en_marcha'])
    expect(m.altas()).toBe(1)
  })
})

// ── Regla 10, con el ERP10 simulado: sacar, que falle uno, volver a sacar ───────────────

describe('regla 10 con el ERP10 simulado (el cliente de verdad)', () => {
  it('saca tres asientos; uno falla y los demás siguen; se vuelve a sacar y entra; en ERP10, uno de cada', async () => {
    const empresa: EmpresaSimulada = { cif: 'B00000000', apuntes: [], subcuentas: ['41000012', '57200001', '64000000', '64200000', '47510000', '47600000', '46500000'], fallaAsiento: 'Nómina' }
    const sim = erp10Simulado({ empresas: { 101: empresa } })
    const sinToken: AlmacenToken = { leer: async () => null, guardar: async () => {}, caida: async () => {} }
    const c = new ClienteErp10({
      base: 'https://erp10.invalid', nombreBd: 'D', claves: { client_id: 'cliente-inventado', client_secret: 'x', username: 'x', password: 'codigo-inventado' },
      lista: [{ companyId: 'sociedad-a', codEmpresa: '101', nif: 'B00000000' }], codEmpresa: '101', almacen: sinToken, fetch: sim.fetch, escribir: true,
    })
    const m = mundo()
    const p: PuertoEscribir = { ...m.p, erp10: c }
    const otro = { ...pago, entryId: id(4), numero: '4/4', fecha: '2026-10-06' }
    const r1 = [await sacarAsiento(pago, [], p), await sacarAsiento(nomina, [], p), await sacarAsiento(otro, [], p)]
    expect(r1.map((x) => x.estado)).toEqual(['en_erp10', 'no_pudo', 'en_erp10'])
    expect(r1[1].porque).toBe('ERP10 no ha dado de alta el asiento (500): Error al guardar el asiento (inventado)')
    expect(m.filas.get(id(2))).toMatchObject({ estado: 'no_pudo' })
    // Se arregla en ERP10 y se vuelve a sacar: entra, y los que ya estaban no se tocan.
    delete empresa.fallaAsiento
    const r2 = [await sacarAsiento(pago, [], p), await sacarAsiento(nomina, [], p), await sacarAsiento(otro, [], p)]
    expect(r2.map((x) => x.estado)).toEqual(['ya_estaba', 'en_erp10', 'ya_estaba'])
    expect(empresa.apuntes).toHaveLength(3)
    expect(m.filas.get(id(2))).toMatchObject({ estado: 'en_erp10', intentos: 2 })
  })
})
