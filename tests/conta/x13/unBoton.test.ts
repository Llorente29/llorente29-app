// tests/conta/x13/unBoton.test.ts — X13 · «Traer de ERP10» en un botón (src/modules/conta/lib/traer/unBoton.ts):
// los tres estados de la maqueta (antes, trayendo y acabado), pararlo y seguir, «no cuadra» y lo que dicen las
// confirmaciones. Con el lector de verdad sobre el ERP10 simulado del X12 (los ficheros del N07, inventados: T11).

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ClienteErp10, type AlmacenToken, type TokenGuardado } from '../../../supabase/functions/_shared/erp10Cliente'
import { traerUnaPagina } from '../../../supabase/functions/_shared/erp10Traer'
import {
  FRASES_UN_BOTON, confirmarDarlo, confirmarDescartar, estadoUnBoton, filasUnBoton, leerCarga, leidoDeLaConexion, loQueMirar, pastillaUnBoton, queda,
  type AntesVisto, type EntradaUnBoton, type EnPruebaVisto,
} from '@/modules/conta/lib/traer'
import { LectorTraer, PARADO, type PedirAErp10 } from '@/modules/conta/erp10/lectorTraer'
import { almacenEnMemoria } from '@/modules/conta/erp10/almacenTraer'
import { erp10Simulado, type EmpresaSimulada } from '../erp10/simulado'

const NIF = 'B00000000'
const HOY = '2026-11-20'
const EMPRESA: EmpresaSimulada = { ...JSON.parse(readFileSync('tests/conta/x12/erp10DeLosFicheros.json', 'utf8')), cif: NIF }

function pedirDe(e: EmpresaSimulada): PedirAErp10 {
  const sim = erp10Simulado({ empresas: { 101: structuredClone(e) } })
  let g: TokenGuardado | null = null
  const almacen: AlmacenToken = { leer: async () => g, guardar: async (token, expiresAt) => { g = { token, expiresAt } }, caida: async () => { g = null } }
  const c = new ClienteErp10({
    base: 'https://erp10.invalid', nombreBd: 'BASE_INVENTADA', codEmpresa: '101', almacen, fetch: sim.fetch,
    claves: { client_id: 'cliente-inventado', client_secret: 'x', username: 'u', password: 'codigo-inventado' }, lista: [{ companyId: 's', codEmpresa: '101', nif: NIF }],
  })
  return (p) => traerUnaPagina((r) => c.get(r), p)
}
const entrada = (x: Partial<EntradaUnBoton>): EntradaUnBoton => ({ lector: null, carga: null, enPrueba: null, antes: null, meter: null, parado: PARADO, ...x })
const EN_PRUEBA: EnPruebaVisto = {
  cuentas: { asientos: 10, facturas_recibidas: 3, facturas_emitidas: 2, cuentas_nuevas: 16, cuentas_estaban: 0, proveedores_nuevos: 4, clientes_nuevos: 1, aprendido: 3 },
  mirar: [{ frase: '40000000 · Proveedores varios: no trae NIF.' }],
  sumas: [{ debe: 500000, haber: 0 }, { debe: 0, haber: 500000 }, { debe: 100, haber: 100 }],
}
const CUADRA: AntesVisto = { puede: true, texto: 'Vas a dar por bueno lo traído de ERP10: 10 asientos y 5 facturas, hasta el 31/03/2026. Cuadra con el sumas y saldos. Después ya no se podrá deshacer.', comparado: true, cuentas: 2, diferencias: [] }

async function leido() {
  const l = new LectorTraer('s:2026', '2026', pedirDe(EMPRESA), almacenEnMemoria(), { hoy: HOY, reintentosMs: [] })
  await l.traer()
  return { l, carga: leerCarga([], leidoDeLaConexion(l.estado.datos)) }
}

describe('antes de empezar', () => {
  it('siete filas con su círculo vacío y una línea de qué es; nada en ámbar ni «Falta»; sin pastilla', () => {
    const e = entrada({})
    expect(estadoUnBoton(e)).toBe('antes')
    expect(filasUnBoton(e).map((f) => [f.que, f.icono, f.linea])).toEqual([
      ['Plan de cuentas', 'vacio', 'las subcuentas'], ['Proveedores y acreedores', 'vacio', 'con NIF y dirección'], ['Clientes', 'vacio', 'con NIF y dirección'],
      ['Diario', 'vacio', 'todos los asientos del ejercicio'], ['Facturas emitidas', 'vacio', 'con su IVA'], ['Facturas recibidas', 'vacio', 'con su IVA y su retención'],
      ['Sumas y saldos', 'vacio', 'se calcula y se compara con ERP10'],
    ])
    expect(pastillaUnBoton(e)).toBeNull()
    expect(FRASES_UN_BOTON.unBoton).toContain('Entra en prueba: hasta que lo des por bueno, se deshace entero.')
  })
})

describe('mientras trae', () => {
  it('cada fila se marca sola al acabar; la que se lee, con su mes y su barra; las facturas, después del diario; y cuánto queda', async () => {
    let soltar: (() => void) | null = null
    const pedir = pedirDe(EMPRESA)
    const lento: PedirAErp10 = async (p) => {
      if (p.que === 'apuntes' && p.mes === '2026-03' && p.pagina === 0) await new Promise<void>((r) => { soltar = r })
      return pedir(p)
    }
    const l = new LectorTraer('s:2026', '2026', lento, almacenEnMemoria(), { hoy: HOY, reintentosMs: [] })
    const corriendo = l.traer()
    while (!soltar) await new Promise((r) => setTimeout(r, 1))
    const e = entrada({ lector: l.estado })
    expect(estadoUnBoton(e)).toBe('trayendo')
    expect(filasUnBoton(e).map((f) => [f.que, f.icono, f.cifra, f.linea, f.barra])).toEqual([
      ['Plan de cuentas', 'hecho', '16 cuentas', '', null],
      ['Proveedores y acreedores', 'hecho', '4 fichas', 'con NIF y dirección', null],
      ['Clientes', 'hecho', '1 ficha', 'con NIF y dirección', null],
      ['Diario', 'leyendo', '8 asientos', 'Leyendo marzo · 3 de 11 meses', 2 / 11],
      ['Facturas emitidas', 'vacio', null, 'Después del diario', null],
      ['Facturas recibidas', 'vacio', null, 'Después del diario', null],
      ['Sumas y saldos', 'vacio', null, 'Se calcula al final', null],
    ])
    expect(pastillaUnBoton(e)?.texto).toMatch(/^Trayendo( · (quedan unos \d+ minutos|queda un minuto|queda menos de un minuto))?$/)
    expect(pastillaUnBoton(e)?.tono).toBe('azul')
    // Pararlo: lo leído se queda, y la fila dice dónde.
    l.dejar()
    ;(soltar as unknown as () => void)()
    await corriendo
    const p = entrada({ lector: l.estado })
    expect(estadoUnBoton(p)).toBe('parado')
    expect(pastillaUnBoton(p)).toEqual({ texto: 'Parado · sigue donde se quedó', tono: 'gris' })
    expect(filasUnBoton(p).find((f) => f.tipo === 'diario')).toMatchObject({ icono: 'vacio', linea: 'Parado en abril · 4 de 11 meses' })
    // Y seguir: acaba.
    await l.traer()
    expect(estadoUnBoton(entrada({ lector: l.estado }))).toBe('metiendo')
  })
  it('lo que queda, en palabras', () => {
    expect([queda(null), queda(20_000), queda(70_000), queda(5 * 60_000), queda(12.4 * 60_000)]).toEqual([null, 'queda menos de un minuto', 'queda un minuto', 'quedan unos 5 minutos', 'quedan unos 12 minutos'])
  })
})

describe('al acabar', () => {
  it('cuadra: cada fila con su cifra y lo que ha comprobado; lo que hay que mirar, en ámbar en su fila, con «Verlos»', async () => {
    const { l, carga } = await leido()
    const e = entrada({ lector: l.estado, carga, enPrueba: EN_PRUEBA, antes: CUADRA })
    expect(estadoUnBoton(e)).toBe('acabado')
    expect(pastillaUnBoton(e)).toEqual({ texto: '✓ Leído y cuadra con ERP10', tono: 'verde' })
    const filas = filasUnBoton(e)
    expect(filas.map((f) => [f.que, f.icono, f.cifra, f.linea])).toEqual([
      ['Plan de cuentas', 'hecho', '16 cuentas', ''],
      ['Proveedores y acreedores', 'mira', '4 fichas', '1 sin NIF'],
      ['Clientes', 'hecho', '1 ficha', 'con NIF y dirección'],
      ['Diario', 'hecho', '10 asientos', 'igual que en ERP10, mes a mes'],
      ['Facturas emitidas', 'hecho', '2 facturas', 'todas con su asiento'],
      ['Facturas recibidas', 'hecho', '3 facturas', 'todas con su asiento'],
      ['Sumas y saldos', 'hecho', 'Cuadra', 'las 2 cuentas, iguales en Sumied y en ERP10 al céntimo, debe y haber'],
    ])
    expect(filas[1].verlos).toEqual({ titulo: 'Proveedores y acreedores: 1 sin NIF', lista: ['40000000 · Proveedores varios'] })
    expect(loQueMirar(e, filas)).toMatchObject({ titulo: '2 cosas que mirar · no paran nada', lista: ['40000000 · Proveedores varios: no trae NIF.'] })
    expect(confirmarDarlo(e)).toEqual({ texto: CUADRA.texto, boton: 'Darlo por bueno', puede: true })
    expect(confirmarDescartar(e)).toBe('Vas a descartar lo traído: se quita todo lo que entró en prueba (10 asientos, 5 facturas, 16 cuentas nuevas, 4 proveedores y 1 cliente) y la empresa queda como estaba antes de traerlo. En ERP10 no cambia nada.')
    expect(FRASES_UN_BOTON.aprendido(3)).toBe('El IVA habitual de 3 proveedores, sacado de sus facturas: queda propuesto en su ficha, sin pisar lo que ya tenga. Lo verás al contabilizar su siguiente factura.')
  })

  it('no cuadra con el resumen de ERP10: la pastilla en ámbar, la fila con sus dos cifras, y darlo por bueno pide confirmar con la diferencia escrita', async () => {
    // ERP10 dice una línea más en enero de la que se ha leído.
    const otra = structuredClone(EMPRESA)
    const l = new LectorTraer('s:2026', '2026', async (p) => {
      const r = await pedirDe(otra)(p)
      if (p.que !== 'resumen') return r
      return { ...r, filas: r.filas.map((x, i) => (i === 0 ? { ...(x as { lineas: number }), lineas: (x as { lineas: number }).lineas + 1 } : x)) }
    }, almacenEnMemoria(), { hoy: HOY, reintentosMs: [] })
    await l.traer()
    const carga = leerCarga([], leidoDeLaConexion(l.estado.datos))
    const e = entrada({ lector: l.estado, carga, enPrueba: EN_PRUEBA, antes: CUADRA })
    expect(pastillaUnBoton(e)).toEqual({ texto: 'No cuadra con ERP10', tono: 'ambar' })
    const diario = filasUnBoton(e).find((f) => f.tipo === 'diario')!
    expect(diario).toMatchObject({ icono: 'mira', linea: '1 mes no da lo mismo que ERP10' })
    expect(diario.verlos?.lista[0]).toMatch(/^En (enero|febrero|marzo) de 2026 lo traído no da lo mismo que el resumen de ERP10 \(en total, ERP10 cuenta \d+ líneas y se han traído \d+\)\./)
    const d = confirmarDarlo(e)
    expect(d).toMatchObject({ boton: 'Darlo por bueno igual', puede: true })
    expect(d.texto).toContain('Lo leído no da lo mismo que el resumen de ERP10: En ')
  })

  it('no cuadra con el sumas y saldos (la base): la fila con las dos cifras de cada cuenta, y la base no deja darlo por bueno', async () => {
    const { l, carga } = await leido()
    const antes: AntesVisto = { puede: false, texto: 'No cuadra con el sumas y saldos de ERP10 en 1 cuenta. Míralas antes de darlo por bueno.', comparado: true, cuentas: 2,
      diferencias: [{ cuenta: '57200001', nombre: 'Banco de ejemplo', alli_debe: 6100, alli_haber: 1200, traido_debe: 6090, traido_haber: 1200 }] }
    const e = entrada({ lector: l.estado, carga, enPrueba: EN_PRUEBA, antes })
    expect(pastillaUnBoton(e)?.tono).toBe('ambar')
    expect(filasUnBoton(e).find((f) => f.tipo === 'sumas_saldos')).toMatchObject({
      icono: 'mira', cifra: 'No cuadra', linea: '1 cuenta no queda igual',
      verlos: { lista: ['57200001 · Banco de ejemplo: en ERP10, 4.900,00; en Sumied, 4.890,00.'] },
    })
    expect(confirmarDarlo(e)).toEqual({ texto: antes.texto, boton: 'Darlo por bueno', puede: false })
    expect(loQueMirar(e, filasUnBoton(e))?.titulo).toBe('3 cosas que mirar')
  })

  it('si la base no lo deja entrar en prueba: su frase, y el estado «fallo»', async () => {
    const { l, carga } = await leido()
    const e = entrada({ lector: l.estado, carga, meter: { estado: 'fallo', texto: 'La empresa no tiene el ejercicio 2026: créalo en Empresa antes de traer.' } })
    expect(estadoUnBoton(e)).toBe('fallo')
    expect(pastillaUnBoton(e)).toEqual({ texto: 'No ha entrado en prueba', tono: 'ambar' })
  })
})
