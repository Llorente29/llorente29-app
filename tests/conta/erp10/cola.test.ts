// tests/conta/erp10/cola.test.ts — X10f · Lo validado sale solo a ERP10 (supabase/functions/_shared/
// erp10Sacar.ts: pasadaDeLaCola y sacarYApuntar, la misma pieza que el botón). Con el cliente de verdad
// contra el ERP10 simulado y una base de mentira cuyos `pendientes` siguen las reglas de
// conta_erp10_cola (20261120T2010): la salida encendida, la prueba hecha (la primera salida de la empresa,
// igualada después), lo que no ha salido, sin lo que está en ERP10, lo que se está sacando, lo que falló
// hace menos de 5 minutos, lo que ya falló tres veces y lo parado. En el orden en que se validó.
// La regla 31: la misma factura sale igual por el botón que sola (la misma huella). Inventado (T11).

import { describe, expect, it } from 'vitest'
import { ClienteErp10, type AlmacenToken } from '../../../supabase/functions/_shared/erp10Cliente'
import { loQueSaleDesdeLaBase, type BaseCruda } from '../../../supabase/functions/_shared/erp10DesdeLaBase'
import type { Envio, PuertoEscribir } from '../../../supabase/functions/_shared/erp10Escribir'
import { pasadaDeLaCola, sacarYApuntar, type EnCola, type Partida, type PuertoApuntar } from '../../../supabase/functions/_shared/erp10Sacar'
import { erp10Simulado, type EmpresaSimulada } from './simulado'

const EMPRESA = '00000000-0000-4000-8000-0000000010f0'
const CUENTA = '00000000-0000-4000-8000-0000000010f9'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const L = (cuenta: string, plantilla: string, debe: number, haber: number, iva: [number, number] | null = null) =>
  ({ cuenta, plantilla, debe, haber, tipoIva: iva?.[0] ?? null, baseIva: iva?.[1] ?? null, deducible: iva ? 'yes' : null, recargo: null, modeloRetencion: null })
const partida = (n: number, o: Record<string, unknown> = {}) => ({
  entry_id: id(n), serie: 2, numero: n, fecha: `2026-10-0${n}`, concepto: `Inventado X10f ${n}`, origen: 'manual', clase: 'recibida', importe: 121, base_iva: 100,
  numero_factura: `X10F-${n}`, nif: 'B00000000', tercero: 'Proveedor Inventado X10f, S.L.', cuentas_base: 1, tiene_pdf: false, de_otro_mes: false, sale: true, avisos: [], ...o,
})
const recibida = (n: number, proveedor = '4000001') => ({
  entryId: id(n), fecha: `2026-10-0${n}`, factura: { numero: `X10F-${n}`, fecha: `2026-10-0${n}` }, proveedor: { nombre: 'Proveedor Inventado X10f, S.L.', nif: 'B00000000' },
  operacion: 'interior', lineas: [L('6290001', '629', 100, 0), L('47200000', '472', 21, 0, [21, 100]), L(proveedor, '400', 0, 121)], tienePdf: false, pdf: null,
})
/** Las recibidas 1, 2 y 3 salen; la 4 no puede salir (su aviso); la 5, ERP10 no la deja dar de alta (fallaFactura) hasta que se arregla. */
function base(fuera: ReadonlySet<string>): BaseCruda {
  const quedan = <T extends { entryId?: string; entry_id?: string }>(xs: T[]) => xs.filter((x) => !fuera.has(String(x.entryId ?? x.entry_id)))
  return {
    carpeta: 'C:\\Sumied\\0007\\',
    porSalir: { mes: '2026-10-01', desde: '2026-10-01', codigo: '0007', largo: 8, cuentas_nuevas: [], partidas: quedan([
      partida(1), partida(2), partida(3), partida(4, { sale: false, avisos: ['Cae en un trimestre de I.V.A. ya presentado: no sale.'] }), partida(5),
    ]) },
    recibidas: { recibidas: quedan([recibida(1), recibida(2), recibida(3), recibida(5, '4000005')]), yaSalidas: {},
      cuentas: [
        { codigo: '4000001', plantilla: '400', nombre: 'Proveedor Inventado X10f', nif: 'B00000000', gastoHabitual: null },
        { codigo: '4000005', plantilla: '400', nombre: 'Proveedor Inventado X10f 5', nif: 'B00000000', gastoHabitual: null },
        { codigo: '6290001', plantilla: '629', nombre: 'Otros servicios inventados', nif: null, gastoHabitual: null },
      ] },
    emitidas: { emitidas: [], cuentas: [], yaSalidas: {}, corregidas: [] },
    asientos: { asientos: [], cuentas: [], yaSalidas: {} },
    dias: { dias: [], contado: [], cuentas: [], yaSalidas: {} },
  }
}

/**
 * La base de mentira: lo validado (en el orden en que se validó), el interruptor, la prueba, los envíos
 * (con las reglas de conta_erp10_envio_tomar) y lo apuntado; y la cola, con las reglas de conta_erp10_cola.
 */
function mundo(o: { prueba?: boolean; encendida?: boolean } = {}) {
  const empresa: EmpresaSimulada = { cif: 'B00000000', apuntes: [], subcuentas: ['40000001', '62900001', '47200000'], fallaFactura: 'X10F-5' }
  const sim = erp10Simulado({ empresas: { 101: empresa } })
  const sinToken: AlmacenToken = { leer: async () => null, guardar: async () => {}, caida: async () => {} }
  const cliente = new ClienteErp10({
    base: 'https://erp10.invalid', nombreBd: 'D', claves: { client_id: 'cliente-inventado', client_secret: 'x', username: 'x', password: 'codigo-inventado' },
    lista: [{ companyId: EMPRESA, codEmpresa: '101', nif: 'B00000000' }], codEmpresa: '101', almacen: sinToken, fetch: sim.fetch, escribir: true,
  })
  let reloj = 0 // minutos
  const estado = { encendida: o.encendida ?? true, prueba: o.prueba ?? true }
  // Validadas en este orden (la 3 antes que la 1): la cola sigue el orden de validar, no el del número.
  const validadas = [3, 1, 2, 4, 5].map((n) => ({ entry_id: id(n), account_id: CUENTA, company_id: EMPRESA, entry_date: `2026-10-0${n}` }))
  const envios = new Map<string, Envio & { cambiado: number }>()
  const apuntadas = new Set<string>()
  const lotes: Partida[][] = []
  const puerto = (como: 'sola' | 'a_mano'): PuertoEscribir & PuertoApuntar => ({
    hoy: '2026-11-20',
    tomar: async (entryId, clase) => {
      const f = envios.get(entryId)
      if (!f || f.estado === 'no_pudo' || (f.estado === 'enviando' && reloj - f.cambiado > 3)) {
        const n = { id: `e-${entryId}`, entry_id: entryId, estado: 'enviando' as const, erp10_ejercicio: null, erp10_serie: null, erp10_documento: null, enlazada: false, pdf: null, motivo: null,
          intentos: (f?.intentos ?? 0) + 1, lote_id: null, clase, como: f?.como ?? null, cambiado: reloj }
        envios.set(entryId, n)
        return { tomado: true, envio: { ...n } }
      }
      return { tomado: false, envio: { ...f } }
    },
    poner: async (eid, cambios) => { Object.assign([...envios.values()].find((x) => x.id === eid)!, { como }, cambios, { cambiado: reloj }) },
    pdf: async () => new Uint8Array(),
    usados: async (entryId) => new Set([...envios.values()].filter((x) => x.estado === 'en_erp10' && x.entry_id !== entryId).map((x) => `${x.erp10_serie}/${x.erp10_documento}`)),
    erp10: cliente,
    apuntar: async (partidas) => { lotes.push(partidas); for (const x of partidas) apuntadas.add(x.entry_id); return { lote: `lote-${lotes.length}` } },
    apuntado: async (lote, r) => { envios.get(r.entryId)!.lote_id = lote },
  })
  // Las reglas de conta_erp10_cola, sobre esta base de mentira.
  const pendientes = async (limite: number): Promise<EnCola[]> => {
    if (!estado.encendida || !estado.prueba) return []
    return validadas.filter((v) => {
      if (apuntadas.has(v.entry_id)) return false
      const e = envios.get(v.entry_id)
      if (!e) return true
      if (e.estado === 'en_erp10') return !e.lote_id && reloj - e.cambiado >= 2
      if (e.estado === 'enviando') return reloj - e.cambiado >= 10
      return e.intentos < 3 && e.como !== 'excel' && reloj - e.cambiado >= 5
    }).slice(0, limite)
  }
  const pasada = () => pasadaDeLaCola({ pendientes, empresa: async () => ({ base: async () => base(apuntadas), puerto: () => puerto('sola') }) })
  return { empresa, sim, envios, apuntadas, lotes, estado, puerto, pasada, pasan: (min: number) => { reloj += min } }
}

const altas = (m: ReturnType<typeof mundo>) => m.sim.vistas.filter((v) => v.metodo === 'POST' && v.ruta === '/api/facturas/add').length

describe('X10f · la cola: lo validado sale solo', () => {
  it('sale en el orden en que se validó, cada una apuntada en la salida de Sumied, con «sola»; la que no puede salir, parada con su porqué', async () => {
    const m = mundo()
    const r = await m.pasada()
    expect(r).toMatchObject({ cogidos: 5, en_erp10: 3, parados: 1, no_pudo: 1 })
    expect(m.empresa.facturas!.map((f) => f.NumeroFactura)).toEqual(['X10F-3', 'X10F-1', 'X10F-2'])
    expect(m.lotes.flat().map((x) => x.entry_id)).toEqual([id(3), id(1), id(2)])
    expect([id(1), id(2), id(3)].map((k) => [m.envios.get(k)?.estado, m.envios.get(k)?.como, !!m.envios.get(k)?.lote_id])).toEqual(Array(3).fill(['en_erp10', 'sola', true]))
    expect(m.envios.get(id(4))).toMatchObject({ estado: 'no_pudo', como: 'excel', motivo: 'Cae en un trimestre de I.V.A. ya presentado: no sale.' })
    expect(m.envios.get(id(5))).toMatchObject({ estado: 'no_pudo', intentos: 1 })
    expect(m.envios.get(id(5))?.motivo).toContain('Error al guardar la factura (inventado)')
  })
  it('nada sale dos veces: otra pasada no escribe nada (lo apuntado y lo parado ya no están en la cola)', async () => {
    const m = mundo()
    await m.pasada()
    const antes = altas(m)
    m.pasan(1)
    expect(await m.pasada()).toMatchObject({ cogidos: 0 })
    expect(altas(m)).toBe(antes)
  })
  it('la que falla se reintenta sola a los 5 minutos, dos veces más; después se queda parada con su motivo', async () => {
    const m = mundo()
    await m.pasada()
    m.pasan(2)
    expect(await m.pasada()).toMatchObject({ cogidos: 0 }) // falló hace menos de 5 minutos
    m.pasan(4)
    expect(await m.pasada()).toMatchObject({ cogidos: 1, no_pudo: 1 })
    m.pasan(5)
    expect(await m.pasada()).toMatchObject({ cogidos: 1, no_pudo: 1 })
    expect(m.envios.get(id(5))).toMatchObject({ estado: 'no_pudo', intentos: 3 })
    m.pasan(60)
    expect(await m.pasada()).toMatchObject({ cogidos: 0 })
  })
  it('si se arregla en ERP10 antes del tercer intento, sale sola en el siguiente', async () => {
    const m = mundo()
    await m.pasada()
    delete m.empresa.fallaFactura
    m.pasan(5)
    expect(await m.pasada()).toMatchObject({ cogidos: 1, en_erp10: 1 })
    expect(m.envios.get(id(5))).toMatchObject({ estado: 'en_erp10', intentos: 2, como: 'sola' })
  })
  it('sin la prueba hecha (la primera de la empresa, igualada), no sale nada solo', async () => {
    const m = mundo({ prueba: false })
    expect(await m.pasada()).toMatchObject({ cogidos: 0 })
    expect(m.empresa.facturas ?? []).toEqual([])
  })
  it('apagar la salida para la cola en el acto, sin perder nada; al encenderla, sigue por donde iba', async () => {
    const m = mundo({ encendida: false })
    expect(await m.pasada()).toMatchObject({ cogidos: 0 })
    m.estado.encendida = true
    expect(await m.pasada()).toMatchObject({ cogidos: 5, en_erp10: 3 })
  })
})

describe('regla 31 · la misma factura sale igual por el botón que sola', () => {
  it('la misma factura en ERP10 y la misma partida (clase y huella) en la salida de Sumied', async () => {
    // Por el botón: lo que pide el navegador (la 1), armado desde la base, «a mano».
    const boton = mundo()
    const b = await sacarYApuntar(await loQueSaleDesdeLaBase(base(new Set()), [id(1)]), boton.puerto('a_mano'))
    expect(b.resultados).toMatchObject([{ estado: 'en_erp10' }])
    // Sola: la cola, con la 1 la primera validada.
    const sola = mundo()
    await sola.pasada()
    const huellaBoton = boton.lotes[0][0]
    const huellaSola = sola.lotes.flat().find((x) => x.entry_id === id(1))!
    console.log(`regla 31 · X10f · huella por el botón: ${huellaBoton.huella} · sola: ${huellaSola.huella}`)
    expect(huellaSola).toEqual(huellaBoton)
    const sinDoc = (f: Record<string, unknown>) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'Documento'))
    expect(sinDoc(sola.empresa.facturas!.find((f) => f.NumeroFactura === 'X10F-1')!)).toEqual(sinDoc(boton.empresa.facturas![0]))
    expect([boton.envios.get(id(1))?.como, sola.envios.get(id(1))?.como]).toEqual(['a_mano', 'sola'])
  })
})
