// tests/conta/x12/traer.test.ts — X12 · Traer de ERP10 por la conexión: de una página de ERP10 a la carga
// de «Traer» (supabase/functions/_shared/erp10Traer.ts, src/modules/conta/lib/traer/conexion.ts) y el
// lector que pide mes a mes y sigue donde se quedó (src/modules/conta/erp10/lectorTraer.ts). Contra el
// ERP10 simulado con la forma de lo medido en QBO Integrity (X11). Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { ClienteErp10, type AlmacenToken, type TokenGuardado } from '../../../supabase/functions/_shared/erp10Cliente'
import { facturaT, pedidaDelCuerpo, rutaDe, traerUnaPagina, type ApunteT, type FacturaT, type PedirPagina, type ResumenT, type SubcuentaT } from '../../../supabase/functions/_shared/erp10Traer'
import {
  clasificarFacturas, contraElResumen, filasPaso1, fraseDeLasSeries, leerCarga, leidoDeLaConexion, paraLaBase, serieYNumero, sumasDeLosAsientos, tercerosDeLaConexion,
  type DatosDeLaCarga,
} from '@/modules/conta/lib/traer'
import { LectorTraer, comoVaLaFila, partesDe, type PedirAErp10 } from '@/modules/conta/erp10/lectorTraer'
import { almacenEnMemoria } from '@/modules/conta/erp10/almacenTraer'
import { erp10Simulado, type EmpresaSimulada } from '../erp10/simulado'
import { abrir, cargaDeLosFicheros, erp10DeLosFicheros } from './deFicheros'

const NIF = 'B00000000'
const HOY = '2026-11-20'

function clienteDe(e: EmpresaSimulada) {
  const sim = erp10Simulado({ empresas: { 101: e } })
  let g: TokenGuardado | null = null
  const almacen: AlmacenToken = { leer: async () => g, guardar: async (token, expiresAt) => { g = { token, expiresAt } }, caida: async () => { g = null } }
  const c = new ClienteErp10({
    base: 'https://erp10.invalid', nombreBd: 'BASE_INVENTADA', codEmpresa: '101', almacen, fetch: sim.fetch,
    claves: { client_id: 'cliente-inventado', client_secret: 'x', username: 'u', password: 'codigo-inventado' }, lista: [{ companyId: 'sociedad', codEmpresa: '101', nif: NIF }],
  })
  return { c, sim }
}
const pedirDe = (e: EmpresaSimulada): { pedir: PedirAErp10; sim: ReturnType<typeof erp10Simulado> } => {
  const { c, sim } = clienteDe(e)
  return { pedir: (p) => traerUnaPagina((r) => c.get(r), p), sim }
}
const sub = (codigo: string, nombre: string, x: Partial<SubcuentaT> = {}): SubcuentaT =>
  ({ codigo, nombre, nombreComercial: '', nif: '', direccion: '', codigoPostal: '', poblacion: '', provincia: '', pais: '', ...x })
const fac = (serie: string, documento: number, cuenta: string, x: Partial<FacturaT> = {}): FacturaT => ({
  serie, documento, fecha: 20250310, fechaFactura: 20250308, fechaOperacion: null, cuenta, numero: `N-${documento}`, nombre: 'INVENTADA', nif: '', claveTipo: 'F1', tipoErp: 1,
  tramos: [{ base: 10000, tipo: 21, cuota: 2100 }], total: 12100, retencion: null, ...x,
})
const ap = (fecha: number, tipo: number, lineas: number): ApunteT => ({ serie: '3', documento: fecha % 1000, fecha, tipo, concepto: 'INVENTADO',
  lineas: Array.from({ length: lineas }, (_, i) => ({ cuenta: i % 2 ? '57200001' : '62900000', concepto: '', debe: i % 2 ? 0 : 100, haber: i % 2 ? 100 : 0 })) })

describe('una página de ERP10', () => {
  it('lo que pide el cuerpo: qué, el ejercicio, el mes del ejercicio y la página; la ruta, como la medida en Diez', () => {
    expect(pedidaDelCuerpo({ que: 'apuntes', ejercicio: '2025', mes: '2025-03', pagina: 2 })).toEqual({ que: 'apuntes', ejercicio: '2025', mes: '2025-03', pagina: 2 })
    expect(pedidaDelCuerpo({ que: 'apuntes', ejercicio: '2025', mes: '2024-03' })).toBe('falta el mes (AAAA-MM, del ejercicio)')
    expect(pedidaDelCuerpo({ que: 'asientos', ejercicio: '2025' })).toMatch(/^falta qué traer/)
    expect(rutaDe({ que: 'facturas', ejercicio: '2025', mes: '2025-02', pagina: 1 })).toBe('/api/facturas?$filter=Fecha%20ge%2020250201%20and%20Fecha%20le%2020250228&$top=200&$skip=1')
    expect(rutaDe({ que: 'resumen', ejercicio: '2025', mes: null, pagina: 0 })).toBe('/api/apuntes/resumen?fechaInicio=20250101&fechaFinal=20251231')
  })
  it('una factura: sus tramos con base o cuota (hasta 8), en céntimos, y la retención', () => {
    const f = facturaT({ Serie: '2', Documento: 7, Fecha: 20250310, CuentaCliente: '410.00001', NumeroFactura: 'ALQ-3', BaseImponible1: 1000, PorcentajeIVA1: 21, CuotaIVA1: 210,
      BaseImponible4: 0.1, CuotaIVA4: 0, TotalFactura: 1020.1, CuotaRetencion: 190, PorcentajeRetencion: 19 })
    expect(f).toMatchObject({ cuenta: '41000001', tramos: [{ base: 100000, tipo: 21, cuota: 21000 }, { base: 10, tipo: null, cuota: 0 }], total: 102010, retencion: { tipo: 19, importe: 19000 } })
  })
})

describe('de lo leído a la carga de «Traer»', () => {
  it('de subcuenta a tercero: 40 y 41 proveedores, 43 y 44 clientes, con el NIF limpio, su dirección y su país', () => {
    const subs = [sub('40000001', 'PROVEEDOR  INVENTADO', { nif: 'ES-B00000000', direccion: 'CALLE INVENTADA 1', pais: 'es' }), sub('41000001', 'ACREEDOR INVENTADO'),
      sub('43000001', 'CLIENTE INVENTADO', { nif: 'b12345678' }), sub('44000001', 'DEUDOR INVENTADO'), sub('57200001', 'BANCO INVENTADO')]
    expect(tercerosDeLaConexion(subs, 'proveedores').terceros.map((t) => [t.codigo, t.nombreFiscal, t.nif, t.direccion, t.pais])).toEqual([
      ['40000001', 'PROVEEDOR INVENTADO', 'B00000000', 'CALLE INVENTADA 1', 'ES'], ['41000001', 'ACREEDOR INVENTADO', null, null, null]])
    expect(tercerosDeLaConexion(subs, 'clientes').terceros.map((t) => [t.codigo, t.nif])).toEqual([['43000001', 'B12345678'], ['44000001', null]])
  })
  it('emitida o recibida: por la cuenta; si no, por la serie si solo lleva de un libro; si no, se dice y no entra', () => {
    const c = clasificarFacturas([
      fac('1', 1, '43000001'), fac('1', 2, '44000001'), fac('2', 3, '40000001'), fac('2', 4, '41000001'),
      fac('2', 5, '62300000'), // la cuenta no lo dice; la serie 2 solo lleva recibidas
      fac('9', 6, '57200001'), // ni la cuenta ni la serie
      fac('4', 7, '43000001'), fac('4', 8, '40000001'), fac('4', 9, ''), // la serie 4 lleva de los dos
    ])
    expect(c.expedidas.map((f) => f.documento)).toEqual([1, 2, 7])
    expect(c.recibidas.map((f) => f.documento)).toEqual([3, 4, 5, 8])
    expect(c.sinSaber.map((x) => x.porque)).toEqual([
      'La factura N-6 del 08/03/2025 (asiento 9/6): su cuenta 57200001 no es de proveedor ni de cliente, y su serie 9 no lleva ninguna otra que lo diga. No sé si es emitida o recibida y no se trae.',
      'La factura N-9 del 08/03/2025 (asiento 4/9): no trae la cuenta del tercero, y su serie 4 lleva emitidas y recibidas. No sé si es emitida o recibida y no se trae.',
    ])
    expect(fraseDeLasSeries(c)).toBe('Las facturas de ERP10: 3 emitidas, 4 recibidas y 2 sin saber. Por serie: serie 1: 2 emitidas (cuentas 43, 44); serie 2: 3 recibidas (cuentas 40, 41, 62); serie 4: 3 sin saber o de los dos libros (cuentas 40, 43, —); serie 9: 1 sin saber o de los dos libros (cuentas 57).')
    expect(serieYNumero('F-12')).toEqual({ serie: 'F', numeroSolo: '12' })
    expect(serieYNumero('2025/0012')).toEqual({ serie: '2025', numeroSolo: '0012' })
    expect(serieYNumero('12')).toEqual({ serie: null, numeroSolo: '12' })
  })
  it('la que no se sabe sale en «Qué mirar», con su porqué; no se esconde (regla 7)', () => {
    const l = leidoDeLaConexion({ ejercicio: '2025', subcuentas: [sub('43000001', 'CLIENTE')], apuntes: [], facturas: [fac('9', 6, '57200001')], resumen: null, mesesLeidos: [] })
    const c = leerCarga([], l)
    expect(c.avisos[0]).toMatch(/^Una factura de ERP10 no se sabe si es emitida o recibida, y no se trae\. La factura N-6/)
  })
  it('el sumas y saldos, sumando los asientos; marcado como calculado y sin compararse consigo mismo', () => {
    const l = leidoDeLaConexion({ ejercicio: '2025', subcuentas: [sub('62900000', 'GASTO'), sub('57200001', 'BANCO')], apuntes: [ap(20250105, 0, 2), ap(20250210, 0, 4)], facturas: [], resumen: null, mesesLeidos: [] })
    expect(sumasDeLosAsientos(l.diario).filas).toEqual([
      { subcuenta: '57200001', nombre: 'BANCO', debe: 0, haber: 300, deudor: 0, acreedor: 300 }, { subcuenta: '62900000', nombre: 'GASTO', debe: 300, haber: 0, deudor: 300, acreedor: 0 }])
    const c = leerCarga([], l)
    expect(c.ficheros.find((f) => f.tipo === 'sumas_saldos')).toMatchObject({ fichero: 'Calculado de los asientos', origen: 'calculado', estado: 'leido' })
    expect(c.comprobado.sumas).toBeNull()
    expect(filasPaso1(c, 'nueva').find((f) => f.tipo === 'sumas_saldos')?.nota).toBe('Suelta su fichero para comprobarlo')
    // Si se suelta el fichero, manda el fichero.
    const conFichero = leerCarga(abrir(['sumas_y_saldos.xlsx']), l)
    expect(conFichero.ficheros.find((f) => f.tipo === 'sumas_saldos')).toMatchObject({ fichero: 'sumas_y_saldos.xlsx', origen: 'fichero' })
  })
  it('el resumen de ERP10 contra lo leído, por mes y tipo: igual, otro total, y otro reparto por tipo con las dos cifras', () => {
    const apuntes = [ap(20250105, 1, 3), ap(20250106, 0, 2), ap(20250210, 1, 4)]
    const resumen = (ene1: number, ene0: number, feb1: number): ResumenT[] => [
      { ejercicio: 2025, mes: 1, tipo: 1, nombre: 'Por factura', lineas: ene1 }, { ejercicio: 2025, mes: 1, tipo: 0, nombre: 'Pantalla única', lineas: ene0 },
      { ejercicio: 2025, mes: 2, tipo: 1, nombre: 'Por factura', lineas: feb1 }, { ejercicio: 2025, mes: 3, tipo: 1, nombre: 'Por factura', lineas: 99 }]
    const bien = contraElResumen(apuntes, resumen(3, 2, 4), ['2025-01', '2025-02'])
    expect(bien).toMatchObject({ cuadra: true, frases: [], nota: 'Igual que ERP10, mes a mes', lineasErp10: 9, lineasTraidas: 9 })
    const mal = contraElResumen(apuntes, resumen(2, 3, 5), ['2025-01', '2025-02'])
    // X14l · Enero: 5 líneas en los dos, repartidas de otra forma por tipo: cuadra (los tipos de ERP10 no son los mismos códigos).
    // Febrero: el total no da lo mismo: sale, con el reparto por tipo solo de detalle.
    expect(mal.frases).toEqual([
      'En febrero de 2025 lo traído no da lo mismo que el resumen de ERP10: ERP10 cuenta 5 líneas y se han traído 4. Por tipo (solo de detalle: los tipos de ERP10 no son los mismos códigos), «Por factura»: ERP10 cuenta 5 líneas y se han traído 4.',
    ])
    const soloReparto = contraElResumen(apuntes, resumen(2, 3, 4), ['2025-01', '2025-02'])
    expect(soloReparto).toMatchObject({ cuadra: true, frases: [], nota: 'Igual que ERP10, mes a mes', lineasErp10: 9, lineasTraidas: 9 })
    expect(mal.nota).toBe('1 mes no da lo mismo que ERP10')
    // Y la fila del diario lo dice.
    const c = leerCarga([], leidoDeLaConexion({ ejercicio: '2025', subcuentas: [], apuntes, facturas: [], resumen: resumen(2, 3, 5), mesesLeidos: ['2025-01', '2025-02'] }))
    expect(c.ficheros.find((f) => f.tipo === 'diario')).toMatchObject({ estado: 'mira', avisos: expect.arrayContaining(mal.frases) })
    expect(filasPaso1(c, 'nueva').find((f) => f.tipo === 'diario')?.nota).toBe('1 mes no da lo mismo que ERP10')
  })
})

describe('el lector: mes a mes, y si se corta, sigue donde se quedó', () => {
  // Marzo con 450 asientos (3 páginas) y una factura por mes: así se ve pasar de página dentro de un mes.
  const grande = (): EmpresaSimulada => ({
    cif: NIF,
    fichas: [{ Codigo: '62900000', Descripcion: 'GASTO INVENTADO' }, { Codigo: '57200001', Descripcion: 'BANCO INVENTADO' }, { Codigo: '40000001', Descripcion: 'PROVEEDOR INVENTADO', NIF: NIF }],
    apuntes: [
      ...Array.from({ length: 450 }, (_, i) => ({ Serie: '3', Documento: i + 1, TipoAsiento: 0, Fecha: 20250301 + (i % 28), Detalles: [{ Cuenta: '62900000', Debe: 1, Haber: 0 }, { Cuenta: '57200001', Debe: 0, Haber: 1 }] })),
      { Serie: '3', Documento: 1000, TipoAsiento: 0, Fecha: 20250710, Detalles: [{ Cuenta: '62900000', Debe: 2, Haber: 0 }, { Cuenta: '57200001', Debe: 0, Haber: 2 }] },
    ],
    facturas: [{ Serie: '2', Documento: 1, Fecha: 20250305, FechaFactura: 20250305, CuentaCliente: '40000001', NumeroFactura: 'A-1', NombreCliente: 'PROVEEDOR INVENTADO', CifCliente: NIF, BaseImponible1: 100, PorcentajeIVA1: 21, CuotaIVA1: 21, TotalFactura: 121 }],
  })

  it('lee las cuentas, el resumen y cada mes, con las tres páginas de marzo; y lo leído da lo mismo que ERP10', async () => {
    const { pedir, sim } = pedirDe(grande())
    const l = new LectorTraer('s:2025', '2025', pedir, almacenEnMemoria(), { hoy: HOY, reintentosMs: [] })
    await l.traer()
    const v = l.estado
    expect(v.estado).toBe('hecho')
    expect(v.cuantos).toEqual({ subcuentas: 3, proveedores: 1, clientes: 0, asientos: 451, facturas: 1 })
    expect(sim.vistas.filter((x) => x.ruta.startsWith('/api/apuntes?') && x.ruta.includes('20250301')).map((x) => /\$skip=(\d+)/.exec(x.ruta)?.[1])).toEqual(['0', '1', '2'])
    expect(sim.vistas.every((x) => x.metodo === 'GET' || x.ruta === '/token')).toBe(true)
    const r = leidoDeLaConexion(v.datos).resumen
    expect(r).toMatchObject({ cuadra: true, lineasErp10: 902, lineasTraidas: 902 })
  })

  it('cortado a mitad de marzo (página 2), otro lector con lo guardado sigue en esa página: sin volver a leer lo leído ni juntar nada dos veces', async () => {
    const almacen = almacenEnMemoria()
    const { pedir } = pedirDe(grande())
    let llamadas = 0
    const corta: PedirAErp10 = async (p) => {
      llamadas++
      if (p.que === 'apuntes' && p.mes === '2025-03' && p.pagina === 1) throw Object.assign(new Error('Se ha ido la red (inventado).'), { noReintentar: true })
      return pedir(p)
    }
    const a = new LectorTraer('s:2025', '2025', corta, almacen, { hoy: HOY, reintentosMs: [] })
    await a.traer()
    expect(a.estado).toMatchObject({ estado: 'cortado', fallo: 'Se ha ido la red (inventado).', enCurso: { parte: { que: 'apuntes', mes: '2025-03' }, pagina: 1 }, cuantos: { asientos: 200, proveedores: 1, clientes: 0 } })
    expect(comoVaLaFila(a.estado, 'diario')).toEqual({ leyendo: false, texto: 'Se ha cortado en marzo: sigue donde se quedó', haLeido: '200 asientos' })
    const antes = llamadas

    // La pestaña se cierra: otro lector, con lo guardado en el navegador.
    const pedidas: PedirPagina[] = []
    const b = new LectorTraer('s:2025', '2025', async (p) => { pedidas.push(p); return pedir(p) }, almacen, { hoy: HOY, reintentosMs: [] })
    await b.cargar()
    expect(b.estado.estado).toBe('cortado')
    await b.traer()
    expect(b.estado.estado).toBe('hecho')
    expect(pedidas[0]).toEqual({ que: 'apuntes', ejercicio: '2025', mes: '2025-03', pagina: 1 })
    // X13 · El diario entero y después las facturas: de las facturas no se había leído ninguna.
    expect(pedidas.some((p) => p.que === 'subcuentas' || p.que === 'resumen' || (p.que === 'apuntes' && (p.mes ?? '') < '2025-03'))).toBe(false)
    expect(pedidas.filter((p) => p.que === 'facturas').map((p) => p.mes)).toEqual(Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`))
    expect(b.estado.cuantos).toEqual({ subcuentas: 3, proveedores: 1, clientes: 0, asientos: 451, facturas: 1 })
    expect(new Set(b.estado.datos.apuntes.map((x) => x.documento)).size).toBe(451)
    expect(antes + pedidas.length).toBe(1 + 1 + 2 * 12 + 2 + 1) // subcuentas, resumen, cada mes (asientos y facturas), las dos páginas de más de marzo, y la que falló // la que falló, y ni una más de las que hacían falta
  })

  it('lo que dice cada fila mientras lee: «Leyendo asientos: marzo, 3 de 12», «En cola» y el sumas y saldos', async () => {
    const { pedir } = pedirDe(grande())
    let parar: (() => void) | null = null
    const lento: PedirAErp10 = async (p) => {
      if (p.que === 'apuntes' && p.mes === '2025-03' && p.pagina === 0) await new Promise<void>((r) => { parar = r })
      return pedir(p)
    }
    const l = new LectorTraer('s:2025', '2025', lento, almacenEnMemoria(), { hoy: HOY, reintentosMs: [] })
    const corriendo = l.traer()
    while (!parar) await new Promise((r) => setTimeout(r, 1))
    expect(comoVaLaFila(l.estado, 'diario')).toEqual({ leyendo: true, texto: 'Leyendo asientos: marzo, 3 de 12', haLeido: '0 asientos' })
    expect(comoVaLaFila(l.estado, 'recibidas')).toEqual({ leyendo: false, texto: 'En cola', haLeido: null })
    expect(comoVaLaFila(l.estado, 'plan_cuentas')).toEqual({ leyendo: false, texto: 'Leído; esperando a lo demás', haLeido: '3 cuentas' })
    expect(comoVaLaFila(l.estado, 'sumas_saldos')).toEqual({ leyendo: false, texto: 'Se calcula al acabar los asientos', haLeido: null })
    expect(comoVaLaFila(l.estado, 'proveedores')).toEqual({ leyendo: false, texto: 'Leído; esperando a lo demás', haLeido: '1 ficha' })
    ;(parar as unknown as () => void)()
    await corriendo
    expect(comoVaLaFila(l.estado, 'diario')).toBeNull()
    expect(partesDe('2025', HOY)).toHaveLength(2 + 24)
    expect(partesDe('2026', HOY)).toHaveLength(2 + 22)
  })
})

describe('el ERP10 simulado de la e2e', () => {
  it('es el de los ficheros del N07, tal cual (la e2e no abre Excel: lee este JSON)', () => {
    const { cif: _c, ...resto } = erp10DeLosFicheros(cargaDeLosFicheros())
    void _c
    expect(JSON.parse(readFileSync('tests/conta/x12/erp10DeLosFicheros.json', 'utf8'))).toEqual(JSON.parse(JSON.stringify(resto)))
  })
})

describe('regla 31 · el mismo ejercicio por fichero y por la conexión deja lo mismo', () => {
  const huella = (x: unknown) => createHash('md5').update(JSON.stringify(x)).digest('hex').slice(0, 12)
  const partes = (d: DatosDeLaCarga) => ({
    cuentas: d.cuentas, terceros: d.terceros, asientos: d.asientos, facturas: d.facturas, aprendido: d.aprendido, pendientesNoExactos: d.pendientesNoExactos, raros: d.raros,
  })

  it('con los ficheros de prueba del N07 y su versión en el ERP10 simulado', async () => {
    const porFichero = cargaDeLosFicheros()
    const { pedir } = pedirDe(erp10DeLosFicheros(porFichero))
    const l = new LectorTraer('s:2026', '2026', pedir, almacenEnMemoria(), { hoy: HOY, reintentosMs: [] })
    await l.traer()
    const porLaConexion = leerCarga([], leidoDeLaConexion(l.estado.datos))
    const a = partes(paraLaBase(porFichero)), b = partes(paraLaBase(porLaConexion))
    const cifras = (d: ReturnType<typeof partes>) => ({
      cuentas: d.cuentas.length, terceros: d.terceros.length, asientos: d.asientos.length, apuntes: d.asientos.reduce((s, x) => s + x.apuntes.length, 0),
      debe: d.asientos.reduce((s, x) => s + x.apuntes.reduce((t, y) => t + y.debe, 0), 0), facturas: d.facturas.length, total: d.facturas.reduce((s, x) => s + x.total, 0),
      conAsiento: d.facturas.filter((x) => x.asiento).length, aprendidos: d.aprendido.length, huella: huella(partes(d)),
    })
    // Las dos cifras, tomadas igual a los dos lados (las pega el parte).
    const [x, y] = [cifras(a), cifras(b)]
    if (process.env.REGLA31) writeFileSync(process.env.REGLA31, `regla 31 · por fichero: ${JSON.stringify(x)}\nregla 31 · por la conexión: ${JSON.stringify(y)}\n`)
    for (const k of Object.keys(a) as (keyof typeof a)[]) expect([k, huella(b[k])]).toEqual([k, huella(a[k])])
    expect(y).toEqual(x)
    expect(porLaConexion.conexion?.resumen).toMatchObject({ cuadra: true })
    // X14 · 2 · Lo único distinto, y a propósito: el sumas y saldos. El del fichero es de ERP10 y va a la base; el de la
    // conexión se calcula de los mismos asientos y no se manda, porque no compara nada.
    expect(paraLaBase(porFichero).sumas.length).toBeGreaterThan(0)
    expect(paraLaBase(porLaConexion).sumas).toEqual([])
  })
})
