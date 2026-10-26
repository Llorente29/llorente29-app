// tests/unit/modules/conta/s02/pr3-liquidaciones.test.ts
//
// S02 · PR 3 · Compras y gastos › Liquidaciones: el núcleo puro de la lista
// (compras/liquidaciones.ts) — el estado en palabras, las pestañas que suman
// «Todas» y el orden — y el sitio de la página en el esqueleto.
//
// Regla 31: la población es la de PRODUCCIÓN de Foodint (cuenta 51ad1792…,
// empresa 658728c0…), leída el 22/10/2026 con SELECT anclados por account_id y
// company_id (regla 9):
//   · licensed_settlement: 3, las tres formula 'anterior', status nulo y sin
//     empresa ni proveedor (junio de 2026: AF-02772 Alcalá 6.606,16 ·
//     AF-02802 Plaza Castilla 3.519,42 · AF-02801 Carabanchel 3.775,78);
//     ninguna 'documentos' todavía;
//   · compras_liquidaciones: CLOUDTOWN BRANDS, S.L. (monthly_settlement) con
//     albaranes en septiembre (Alcalá 26 por 11.394,56 · Carabanchel 5 por
//     2.977,74) y en octubre (Alcalá 19 por 10.195,04 · Carabanchel 6 por
//     6.642,24), sin liquidación;
//   · supplier_batch (catcher): 1, «1.ª quincena de octubre de 2026», 83
//     facturas, 1.919,87 €, cruzada, sin pago, 23 cosas abiertas;
//   · la 40700001: recargas 1.800,00 validadas, pagos 0.
// Más la forma de staging (seed_d01_liquidacion_referencia): una 'documentos'
// en borrador sin bloqueos, «Ha llegado: falta mirarla y confirmarla».

import { describe, expect, it } from 'vitest'
import { CONTA, rutaConta, rutaLiquidaciones } from '@/config/navegacion'
import { dondeEsta } from '@/modules/conta/esqueleto/productos'
import type { FilaLiquidacion } from '@/modules/conta/lib/compras'
import { pestanasConTodas, sumanTodas } from '@/modules/conta/diseno/plantillas/lista'
import {
  estadoMensual, estadoQuincena, filaMensual, filaQuincena, filasLiquidaciones, filasPorLlegar, filtrosLiquidaciones, fraseSaldoPrepago,
  pestanasLiquidaciones, pieLiquidaciones, type FilaLiquidaciones, type LiquidacionGuardada,
} from '@/modules/conta/compras/liquidaciones'

const HOY = '2026-10-22'
const ALCALA = '38158159-cd71-4056-950b-53425afac1ce'
const CARABANCHEL = '92d7656e-082e-452a-8ebc-236b2d6ebf5f'
const PLAZA = '629f9154-b888-48ed-9b8c-ffae77620615'
const CLOUDTOWN = '8d53a379-1aa6-4c49-a7aa-dcfaeb353b5e'
const LOCALES = new Map([[ALCALA, 'Foodint Alcalá'], [CARABANCHEL, 'Foodint Carabanchel'], [PLAZA, 'Foodint Plaza Castilla']])
const nombres = { proveedor: new Map<string, string>(), local: LOCALES }

const anterior = (id: string, ref: string, local: string, neto: string): LiquidacionGuardada => ({
  id, status: null, formula: 'anterior', settlement_ref: ref, period_from: '2026-06-01', period_to: '2026-06-30',
  net_settlement: neto, supplier_id: null, location_id: local, company_id: null, bloqueos: null,
})
const ANTERIORES = [
  anterior('a260d377-7dbe-4c6b-b9a1-506ead28e104', 'AF-02772', ALCALA, '6606.16'),
  anterior('df37b9f2-4588-4cd4-bf28-15baa60b6556', 'AF-02802', PLAZA, '3519.42'),
  anterior('1ed23c44-b1f6-42eb-ade8-8e6dc0ddbbd6', 'AF-02801', CARABANCHEL, '3775.78'),
]
const porLlegar = (local: string, recepciones: number, base: number): FilaLiquidacion => ({
  proveedor: CLOUDTOWN, proveedor_nombre: 'CLOUDTOWN BRANDS, S.L.', local, local_nombre: LOCALES.get(local)!,
  recepciones, base, liquidacion: null, estado: null, referencia: null, saldo: null, bloqueos: null,
})
const SEPTIEMBRE = [porLlegar(ALCALA, 26, 11394.56), porLlegar(CARABANCHEL, 5, 2977.74)]
const OCTUBRE = [porLlegar(ALCALA, 19, 10195.04), porLlegar(CARABANCHEL, 6, 6642.24)]
const QUINCENA = {
  id: 'q1', etiqueta: '1.ª quincena de octubre de 2026', desde: '2026-10-01', hasta: '2026-10-15', facturas: 83, total: 1919.87,
  cruzado: true, pago: null, cuenta: { abiertas: 23, reclamadas: 0, aceptadas: 0 },
}

/** Lo que verá Foodint: las 8 filas. */
const FOODINT: FilaLiquidaciones[] = [
  ...ANTERIORES.map((l) => filaMensual(l, nombres)),
  ...filasPorLlegar('2026-09-01', SEPTIEMBRE, HOY),
  ...filasPorLlegar('2026-10-01', OCTUBRE, HOY),
  filaQuincena(QUINCENA),
]
const DE_SERIE = filtrosLiquidaciones(new URLSearchParams())

describe('el estado en palabras, de lo que de verdad guardan', () => {
  it('mensual: los tres status del CHECK y el nulo del sistema anterior', () => {
    expect(estadoMensual('borrador', 0)).toMatchObject({ texto: 'Por confirmar', grupo: 'te-toca' })
    expect(estadoMensual('borrador', 2)).toMatchObject({ texto: 'No cuadra (2)', tono: 'falta', grupo: 'te-toca', detalle: '2 cosas no cuadran: ábrela.' })
    expect(estadoMensual('confirmada', 0)).toMatchObject({ texto: 'Contabilizada', tono: 'seguro', grupo: 'hecha' })
    expect(estadoMensual('saldada', 0)).toMatchObject({ texto: 'Saldada', grupo: 'hecha' })
    expect(estadoMensual(null, 0)).toMatchObject({ texto: 'Del sistema anterior', grupo: 'espera' })
  })
  it('las tres de junio de Foodint: salen, con su referencia e importe, y sin ficha (lo dicen al abrirlas)', () => {
    const [alcala] = FOODINT
    expect(alcala).toMatchObject({ proveedor: 'Liquidación mensual', local: 'Foodint Alcalá', periodo: 'junio de 2026', referencia: 'AF-02772', importe: 6606.16 })
    expect(alcala.apoyoImporte).toMatch(/^Te paga 6\.606,16\s€$/)
    expect(alcala.abrir).toEqual({ a: 'sin-ficha', porque: 'La liquidación AF-02772 de junio de 2026 llegó del sistema anterior, sin sus documentos: no tiene ficha que abrir.' })
  })
  it('una guardada de verdad abre su ficha; la de staging, en borrador, «Por confirmar»', () => {
    const f = filaMensual({ ...ANTERIORES[0], id: 'x', formula: 'documentos', status: 'borrador', supplier_id: 'p', company_id: 'c', net_settlement: -120, bloqueos: [] },
      { proveedor: new Map([['p', 'Distribuciones Prueba Aurora, S.L.']]), local: LOCALES })
    expect(f).toMatchObject({ proveedor: 'Distribuciones Prueba Aurora, S.L.', importe: 120, abrir: { a: 'liquidacion', id: 'x' }, estado: { texto: 'Por confirmar' } })
    expect(f.apoyoImporte).toMatch(/^Le pagas 120,00\s€$/)
  })
  it('las que se esperan: septiembre «Por llegar» (te toca subirla), octubre «Aún no toca»; las ya guardadas no se repiten', () => {
    const sep = filasPorLlegar('2026-09-01', SEPTIEMBRE, HOY)
    expect(sep.map((x) => [x.local, x.estado.texto, x.estado.grupo])).toEqual([['Foodint Alcalá', 'Por llegar', 'te-toca'], ['Foodint Carabanchel', 'Por llegar', 'te-toca']])
    expect(sep[0].apoyoImporte).toMatch(/^26 albaranes por 11\.394,56\s€$/)
    expect(sep[0].abrir).toEqual({ a: 'nueva', proveedor: CLOUDTOWN, local: ALCALA, mes: '2026-09-01' })
    expect(filasPorLlegar('2026-10-01', OCTUBRE, HOY).map((x) => [x.estado.texto, x.estado.detalle])).toEqual([
      ['Aún no toca', 'Llega a primeros de noviembre de 2026.'], ['Aún no toca', 'Llega a primeros de noviembre de 2026.'],
    ])
    expect(filasPorLlegar('2026-09-01', [{ ...SEPTIEMBRE[0], liquidacion: 'ya', estado: 'borrador' }], HOY)).toEqual([])
  })
  it('quincena de Catcher: lo abierto manda, luego lo reclamado, luego el pago', () => {
    expect(filaQuincena(QUINCENA)).toMatchObject({ proveedor: 'Catcher', periodo: '1.ª quincena de octubre de 2026', importe: 1919.87, apoyoImporte: '83 facturas · lo que baja la 40700001',
      estado: { texto: '23 por aclarar', tono: 'duda', grupo: 'te-toca', detalle: 'Sin proponer el pago.' }, abrir: { a: 'quincena', id: 'q1' } })
    const c = (abiertas: number, reclamadas: number) => ({ abiertas, reclamadas, aceptadas: 0 })
    expect(estadoQuincena({ cruzado: false, pago: null, cuenta: c(0, 0) }).texto).toBe('Sin cruzar')
    expect(estadoQuincena({ cruzado: true, pago: null, cuenta: c(0, 1) })).toMatchObject({ texto: '1 reclamada', grupo: 'espera' })
    expect(estadoQuincena({ cruzado: true, pago: null, cuenta: c(0, 0) })).toMatchObject({ texto: 'Falta el pago', grupo: 'te-toca' })
    expect(estadoQuincena({ cruzado: true, pago: 'asiento', cuenta: c(0, 0) })).toMatchObject({ texto: 'Cuadra · pago propuesto', grupo: 'hecha' })
  })
})

describe('las pestañas suman «Todas» (regla 7: ninguna fila sin pestaña)', () => {
  it('Foodint: 8, de ellas 3 te tocan y 5 en espera', () => {
    const p = pestanasLiquidaciones(FOODINT)
    expect(p.map((x) => [x.id, x.n])).toEqual([['todas', 8], ['te-toca', 3], ['espera', 5]])
    expect(sumanTodas(p)).toBe(true)
    expect(pieLiquidaciones(FOODINT)).toBe('8 liquidaciones · 3 te tocan')
  })
  it('con cualquier mezcla de estados, cada fila cae en una pestaña', () => {
    const todas = [...FOODINT, filaQuincena({ ...QUINCENA, id: 'q2', pago: 'a', cuenta: { abiertas: 0, reclamadas: 0, aceptadas: 3 } })]
    expect(sumanTodas(pestanasLiquidaciones(todas))).toBe(true)
    expect(sumanTodas(pestanasConTodas([]))).toBe(true)
  })
  it('el filtro de tipo y la pestaña, de la dirección', () => {
    const f = filtrosLiquidaciones(new URLSearchParams('ver=te-toca&tipo=catcher&orden=importe'))
    expect(f).toEqual({ pestana: 'te-toca', tipo: 'catcher', orden: { columna: 'importe', sentido: 'asc' } })
    expect(filasLiquidaciones(FOODINT, f).map((x) => x.id)).toEqual(['catcher:q1'])
    expect(filtrosLiquidaciones(new URLSearchParams('ver=otra&tipo=x&orden=-nada'))).toEqual(DE_SERIE)
  })
})

describe('el orden de serie: lo más reciente arriba; en el mismo periodo, lo que te toca primero', () => {
  it('Foodint, tal cual sale', () => {
    expect(filasLiquidaciones(FOODINT, DE_SERIE).map((x) => `${x.periodo} · ${x.proveedor}${x.local ? ` · ${x.local}` : ''} · ${x.estado.texto}`)).toEqual([
      '1.ª quincena de octubre de 2026 · Catcher · 23 por aclarar',
      'octubre de 2026 · CLOUDTOWN BRANDS, S.L. · Foodint Alcalá · Aún no toca',
      'octubre de 2026 · CLOUDTOWN BRANDS, S.L. · Foodint Carabanchel · Aún no toca',
      'septiembre de 2026 · CLOUDTOWN BRANDS, S.L. · Foodint Alcalá · Por llegar',
      'septiembre de 2026 · CLOUDTOWN BRANDS, S.L. · Foodint Carabanchel · Por llegar',
      'junio de 2026 · Liquidación mensual · Foodint Alcalá · Del sistema anterior',
      'junio de 2026 · Liquidación mensual · Foodint Carabanchel · Del sistema anterior',
      'junio de 2026 · Liquidación mensual · Foodint Plaza Castilla · Del sistema anterior',
    ])
  })
  it('no depende de cómo llegaron', () => {
    const al = filasLiquidaciones([...FOODINT].reverse(), DE_SERIE).map((x) => x.id)
    expect(al).toEqual(filasLiquidaciones(FOODINT, DE_SERIE).map((x) => x.id))
  })
  it('por importe, lo que aún no ha llegado (sin importe) al final', () => {
    const f = filtrosLiquidaciones(new URLSearchParams('orden=-importe'))
    expect(filasLiquidaciones(FOODINT, f).slice(0, 4).map((x) => x.importe)).toEqual([6606.16, 3775.78, 3519.42, 1919.87])
    expect(filasLiquidaciones(FOODINT, f).slice(4).every((x) => x.importe === null)).toBe(true)
  })
})

describe('el saldo prepago, en una línea (las cifras de la 40700001 de Foodint)', () => {
  it('recargas 1.800 y pagos 0: te quedan 1.800', () => {
    const s = fraseSaldoPrepago({ existe: true, recargas: 1800, pagos: 0, saldo: 1800, pagosSinValidar: 0 })
    expect(s.frase).toMatch(/^Te quedan 1\.800,00\s€: has recargado 1\.800,00\s€ y se han pagado 0,00\s€\.$/)
    expect(s.sinValidar).toBeNull()
  })
  it('lo sin validar, aparte; sin la cuenta en el plan, lo dice', () => {
    expect(fraseSaldoPrepago({ existe: true, recargas: 1800, pagos: 54.69, saldo: 1745.31, pagosSinValidar: 54.69 }).sinValidar).toMatch(/^De esos pagos, 54,69\s€ aún sin validar\.$/)
    expect(fraseSaldoPrepago({ existe: false, texto: 'Falta la 40700001 «Saldo prepago Catcher» en el plan de la empresa.' }).frase).toBe('Falta la 40700001 «Saldo prepago Catcher» en el plan de la empresa.')
  })
})

describe('el sitio de la página: la barra marca Liquidaciones en la lista, la ficha y la quincena', () => {
  it('las cuatro direcciones', () => {
    const de = (p: string) => { const d = dondeEsta(p); return d ? `${d.producto.id}.${d.pestana?.id}` : null }
    // PC01 · Entrega 2: se llama «Repartidores»; la dirección vieja sigue marcando su pestaña y redirige.
    expect(rutaLiquidaciones()).toBe(rutaConta(CONTA.rutas.repartidores))
    expect(rutaLiquidaciones('catcher')).toBe(`${rutaConta(CONTA.rutas.repartidores)}?subir=catcher`)
    for (const p of ['/conta/compras/repartidores', '/conta/compras/liquidaciones', '/conta/documentos/catcher/q1']) {
      expect(de(p), p).toBe('compras.liquidaciones')
    }
    // V01 · Entrega 3: la mensual del socio (y la de subir sus documentos) es de Ventas › Liquidaciones.
    for (const p of ['/conta/compras/liquidacion/nueva', '/conta/compras/liquidacion/x', '/conta/ventas/liquidaciones']) {
      expect(de(p), p).toBe('facturacion.liquidacionesVentas')
    }
    // Facturas recibidas sigue siendo suya.
    expect(de('/conta/documentos')).toBe('compras.recibidas')
  })
})
