// C03 · El núcleo: terceros (reglas 1 y 6), liquidaciones de plataforma
// (reglas 2 y 3), liquidación del socio por local (regla 4), lo aprendido
// (regla 5), plazo de cobro (regla 7) y el lector de los CSV de las
// plataformas, con fixtures INVENTADAS con la forma de los ficheros que ya
// importa Folvy (tests/conta/fixtures/liquidaciones/).

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import {
  accionPrincipal, cuentaPorFiltro, filtrarTerceros, franjaArchivado, mismoNif, nifNormal, ordenarPapeles, type Tercero,
} from '@/modules/conta/lib/terceros'
import { cifrasPlataforma, cuadre, estadoLiquidacion, periodo, teDebe, type LiquidacionPlataforma } from '@/modules/conta/lib/liquidaciones'
import { liquidarLocal, liquidarMes, mesDe, textoImporte, type CalculoLocal } from '@/modules/conta/lib/liquidacionSocio'
import { aprendidoDeCliente } from '@/modules/conta/lib/aprendidoCliente'
import { MENU_CONTA, entradaActiva, migasFichaTercero, rutaFichaTercero, rutaTerceros } from '@/config/navegacion'
import { apartadosDe } from '@/modules/conta/terceros/contextoTercero'
import { avisoPlazo } from '@/modules/conta/lib/morosidad'
import { FicheroNoReconocido, importe, leerLiquidaciones, queFichero } from '@/modules/conta/lib/lectorLiquidaciones'

const dir = join(__dirname, '../../../conta/fixtures/liquidaciones')
const fichero = (f: string) => readFileSync(join(dir, f), 'utf8')

// La población de la semilla de staging (seed_c03_staging.sql) más dos casos de borde.
const terceros: Tercero[] = [
  { id: 'plat', nombre: 'Plataforma Norte', nif: 'B91030015', archivadoEn: null, notaArchivado: null, papeles: ['supplier', 'customer', 'platform'] },
  { id: 'socio', nombre: 'Marcas del Sur', nif: 'B91030023', archivadoEn: null, notaArchivado: null, papeles: ['supplier', 'brand_partner', 'customer'] },
  { id: 'arch', nombre: 'Distribuciones Antiguas', nif: 'B91030031', archivadoEn: '2024-12-31T11:00:00Z', notaArchivado: 'histórico de 2024', papeles: ['supplier'] },
  { id: 'cli', nombre: 'Catering Eventos Norte', nif: 'B91030049', archivadoEn: null, notaArchivado: null, papeles: ['customer'] },
  { id: 'ruiz', nombre: 'Hermanos Ruiz', nif: 'B91000018', archivadoEn: null, notaArchivado: null, papeles: ['supplier'] },
  { id: 'luna', nombre: 'Panadería Luna', nif: null, archivadoEn: null, notaArchivado: null, papeles: ['supplier'] },
]

describe('regla 1 · un NIF, un tercero', () => {
  it('el NIF se compara como la base (party_nif): sin guiones ni puntos, en mayúsculas', () => {
    expect(nifNormal('b-91.000.018')).toBe('B91000018')
    expect(nifNormal('  ')).toBeNull()
  })
  it('alta de cliente con el NIF de un proveedor: propone añadirle el papel, no otro tercero', () => {
    const m = mismoNif(terceros, 'b-91000018', 'customer')!
    expect(m.tercero.id).toBe('ruiz')
    expect(m.yaLoEs).toBe(false)
    expect(m.texto).toBe('Es el mismo que tu proveedor Hermanos Ruiz: añadirle el papel de cliente.')
  })
  it('si ya tiene ese papel, lo dice; si está archivado, también', () => {
    expect(mismoNif(terceros, 'B91030049', 'customer')!.texto).toBe('Catering Eventos Norte ya es cliente con el NIF B91030049.')
    expect(mismoNif(terceros, 'B91030031', 'customer')!.texto).toBe('Es el mismo que tu proveedor Distribuciones Antiguas (está archivado: se recupera): añadirle el papel de cliente.')
  })
  it('sin NIF, o con un NIF nuevo, o editando el mismo tercero: nada que proponer', () => {
    expect(mismoNif(terceros, null, 'customer')).toBeNull()
    expect(mismoNif(terceros, 'B91030056', 'customer')).toBeNull()
    expect(mismoNif(terceros, 'B91000018', 'customer', 'ruiz')).toBeNull()
  })
})

describe('regla 6 · archivados, y la lista', () => {
  it('un archivado no sale en ninguna lista salvo «Archivados»', () => {
    for (const f of ['todos', 'proveedores', 'clientes', 'plataformas', 'socios'] as const) {
      expect(filtrarTerceros(terceros, f, '').map((t) => t.id)).not.toContain('arch')
    }
    expect(filtrarTerceros(terceros, 'archivados', '').map((t) => t.id)).toEqual(['arch'])
    expect(franjaArchivado(terceros[2])).toBe('Archivado · histórico de 2024')
  })
  it('el filtro es por papel: una plataforma que también es cliente sale en las dos', () => {
    expect(filtrarTerceros(terceros, 'clientes', '').map((t) => t.id)).toEqual(['plat', 'socio', 'cli'])
    expect(filtrarTerceros(terceros, 'plataformas', '').map((t) => t.id)).toEqual(['plat'])
    expect(cuentaPorFiltro(terceros)).toEqual({ todos: 5, proveedores: 4, clientes: 3, plataformas: 1, socios: 1, archivados: 1 })
  })
  it('se busca por nombre sin acentos o por NIF con guiones', () => {
    expect(filtrarTerceros(terceros, 'todos', 'panaderia').map((t) => t.id)).toEqual(['luna'])
    expect(filtrarTerceros(terceros, 'todos', 'b-9103').map((t) => t.id)).toEqual(['plat', 'socio', 'cli'])
  })
  it('las píldoras, en orden, y la acción principal según el papel', () => {
    expect(ordenarPapeles(['supplier', 'customer', 'platform'])).toEqual(['platform', 'customer', 'supplier'])
    expect(accionPrincipal(['supplier', 'customer', 'platform'], 'octubre').texto).toBe('Subir liquidación')
    expect(accionPrincipal(['supplier', 'brand_partner', 'customer'], 'octubre').texto).toBe('Preparar liquidación de octubre')
    expect(accionPrincipal(['customer'], 'octubre').texto).toBe('Nueva factura')
    expect(accionPrincipal(['supplier'], 'octubre').id).toBeNull()
  })
})

// Las cuatro de la maqueta N9 (y de la semilla), más una sin neto (como las de Just Eat y Uber).
const base: Omit<LiquidacionPlataforma, 'id' | 'desde' | 'hasta' | 'fecha' | 'ventas' | 'comision' | 'neto' | 'cobradoEn' | 'cobrado'> = {
  ref: null, propuestoDesde: null, propuestoHasta: null, pedidos: null, otros: [], paraRevisar: false, motivoRevisar: null,
}
const liqs: LiquidacionPlataforma[] = [
  { ...base, id: 'ago2', desde: '2026-08-16', hasta: '2026-08-31', fecha: '2026-09-05', ventas: 8905, comision: 1870, neto: 7035, cobradoEn: '2026-09-05', cobrado: 6822.70 },
  { ...base, id: 'sep1', desde: '2026-09-01', hasta: '2026-09-15', fecha: '2026-09-20', ventas: 10412, comision: 2185.90, neto: 8226.10, cobradoEn: '2026-09-20', cobrado: 8226.10 },
  { ...base, id: 'sep2', desde: '2026-09-16', hasta: '2026-09-30', fecha: '2026-10-05', ventas: 9870, comision: 2072.60, neto: 7797.40, cobradoEn: '2026-10-05', cobrado: 7797.40 },
  { ...base, id: 'oct1', desde: '2026-10-01', hasta: '2026-10-15', fecha: '2026-10-20', ventas: 11004, comision: 2310.80, neto: 8693.20, cobradoEn: null, cobrado: null },
]
const HOY = '2026-10-06'

describe('regla 3 · ventas − comisiones − otros cargos = neto; con diferencia, la cifra', () => {
  it('la cuenta de la maqueta, y los costes en valor absoluto aunque vengan en positivo o en negativo', () => {
    const c = cuadre(liqs[3])
    expect(c.frase).toBe('11.004,00 € − 2.310,80 € = 8.693,20 €')
    expect(c.descuadre).toBe(0)
    expect(cuadre({ ventas: 100, comision: -30, otros: [-5, 2], neto: 63 }).calculado).toBe(63)
    expect(cuadre({ ventas: 100, comision: 30, otros: [], neto: 60 }).descuadre).toBe(-10)
  })
  it('cobrada al céntimo · con diferencia y cuánto falta · de más · pendiente · vencida · sin neto', () => {
    expect(estadoLiquidacion(liqs[1], HOY)).toMatchObject({ estado: 'cobrada', explica: 'cuadra con el banco' })
    expect(estadoLiquidacion(liqs[0], HOY)).toMatchObject({ estado: 'con_diferencia', explica: 'faltan 212,30 € en el banco', pendiente: 212.3 })
    expect(estadoLiquidacion({ ...liqs[1], cobrado: 8230 }, HOY)).toMatchObject({ estado: 'con_diferencia', explica: 'llegaron 3,90 € de más', pendiente: 0 })
    expect(estadoLiquidacion(liqs[3], HOY)).toMatchObject({ estado: 'pendiente', etiqueta: 'Pendiente', explica: 'llega el 20' })
    expect(estadoLiquidacion(liqs[3], '2026-10-21')).toMatchObject({ estado: 'vencida', explica: 'tenía que llegar el 20 oct y no ha llegado' })
    expect(estadoLiquidacion({ ...liqs[3], neto: null }, HOY)).toMatchObject({ estado: 'sin_neto', pendiente: null })
  })
  it('el periodo como en la maqueta; el propuesto, por confirmar', () => {
    expect(periodo(liqs[3])).toEqual({ texto: '1–15 oct', porConfirmar: false })
    expect(periodo({ desde: null, hasta: null, propuestoDesde: '2026-09-03', propuestoHasta: '2026-09-14' })).toEqual({ texto: '3–14 sept', porConfirmar: true })
    expect(periodo({ desde: '2026-09-28', hasta: '2026-10-04', propuestoDesde: null, propuestoHasta: null }).texto).toBe('28 sept – 4 oct')
  })
})

describe('regla 2 · te debe y vencido', () => {
  it('lo pendiente de cada una, ordenado por cuándo vence; la frase de la maqueta', () => {
    const d = teDebe(liqs, HOY)
    expect(d.total).toBe(8905.5)
    expect(d.vencido).toBe(212.3)
    expect(d.partes.map((p) => p.id)).toEqual(['ago2', 'oct1'])
    expect(d.frase).toBe('2 liquidaciones · la primera, del 16–31 ago · faltan 212,30 € en el banco')
    const soloOct = teDebe(liqs.slice(1), HOY)
    expect(soloOct.frase).toBe('liquidación del 1–15 oct · llega el 20')
  })
  it('las que no traen neto no suman, pero se cuentan', () => {
    const d = teDebe([{ ...liqs[3], neto: null }], HOY)
    expect(d).toMatchObject({ total: 0, sinNeto: 1, frase: null })
  })
})

describe('las cuatro cifras de la plataforma (N9)', () => {
  it('te debe, lo vendido y las comisiones del año, y la última liquidación (la última cobrada)', () => {
    const c = cifrasPlataforma(liqs.map((l) => ({ ...l, pedidos: 300 })), HOY)
    expect(c).toMatchObject({ vendidoEsteAnio: 40191, pedidosEsteAnio: 1200, comisionesEsteAnio: 8439.3, pctMedio: 21, hayLiquidaciones: true })
    expect(c.teDebe.total).toBe(8905.5)
    expect(c.ultima?.periodo).toBe('16–30 sept')
    expect(c.ultima?.estado.explica).toBe('cuadra con el banco')
  })
  it('sin liquidaciones: nada que enseñar como cifra', () => {
    expect(cifrasPlataforma([], HOY)).toMatchObject({ hayLiquidaciones: false, ultima: null, pctMedio: null, vendidoEsteAnio: 0 })
  })
})

// La semilla de staging (y la maqueta N10): dos locales, octubre.
const norteCentro: CalculoLocal = { localId: 'l1', local: 'Norte Centro', compras: 3800, aportaciones: 700, faltan: [],
  marcas: [{ marca: 'Milanesa Cedida', pct: 9, base: 6000 }, { marca: 'Wok Cedido', pct: 9, base: 5000 }], importeBase: 4090 }
const norteMercado: CalculoLocal = { localId: 'l2', local: 'Norte Mercado', compras: 2620, aportaciones: 480, faltan: [],
  marcas: [{ marca: 'Milanesa Cedida', pct: 9, base: 4300 }, { marca: 'Wok Cedido', pct: 9, base: 3000 }], importeBase: 2797 }

describe('regla 4 · la liquidación del socio, por local y por periodo', () => {
  it('un local: compras − aportaciones + comisión, con sus tres líneas', () => {
    const l = liquidarLocal(norteCentro)
    expect(l).toMatchObject({ compras: 3800, aportaciones: 700, baseVentas: 11000, comision: 990, pct: 9, importe: 4090, sentido: 'a su favor', cerrable: true })
    expect(l.lineas.map((x) => [x.texto, x.importe])).toEqual([
      ['Compras de mercancía del mes', 3800], ['− Aportaciones del socio', -700], ['+ Comisión sobre ventas de sus marcas (9 %)', 990],
    ])
  })
  it('el mes es la suma de los locales: 6.420 − 1.180 + 1.647 = 6.887 a su favor (la maqueta N10)', () => {
    const m = liquidarMes([norteCentro, norteMercado])
    expect(m).toMatchObject({ compras: 6420, aportaciones: 1180, baseVentas: 18300, comision: 1647, importe: 6887, cerrable: true })
    expect(m.porLocal.map((x) => [x.local, x.importe])).toEqual([['Norte Centro', 4090], ['Norte Mercado', 2797]])
    expect(textoImporte(m)).toBe('6.887,00 € a su favor')
  })
  it('el signo que salga: si aporta más de lo que le compras, a tu favor', () => {
    const l = liquidarLocal({ ...norteCentro, compras: 100, aportaciones: 2000, importeBase: undefined })
    expect(l).toMatchObject({ importe: -910, sentido: 'a tu favor' })
    expect(textoImporte(l)).toBe('910,00 € a tu favor')
  })
  it('si falta una fuente del periodo, se dice y no se cierra (ni el local ni el mes)', () => {
    const m = liquidarMes([norteCentro, { ...norteMercado, faltan: ['1 línea de albarán sin precio: complétala en el albarán.'] }])
    expect(m.cerrable).toBe(false)
    expect(m.faltan).toEqual(['Norte Mercado: 1 línea de albarán sin precio: complétala en el albarán.'])
  })
  it('si la base y Folvy no dicen lo mismo, no se confirma (y se dice cuánto)', () => {
    const l = liquidarLocal({ ...norteCentro, importeBase: 4100 })
    expect(l).toMatchObject({ cerrable: false, descuadreConBase: 10 })
  })
  it('marcas con % distinto: la comisión por marca, redondeada como la base', () => {
    const l = liquidarLocal({ ...norteCentro, marcas: [{ marca: 'A', pct: 9, base: 333.33 }, { marca: 'B', pct: 7.5, base: 100.01 }], importeBase: undefined })
    expect(l.comision).toBe(30 + 7.5)
    expect(l.pct).toBeNull()
    expect(l.lineas[2].texto).toBe('+ Comisión sobre ventas de sus marcas')
  })
  it('el mes de una fecha, para «Preparar liquidación de octubre»', () => {
    expect(mesDe('2026-10-06')).toEqual({ desde: '2026-10-01', hasta: '2026-10-31', nombre: 'octubre' })
    expect(mesDe('2028-02-10').hasta).toBe('2028-02-29')
  })
})

describe('regla 5 · lo que he aprendido de este cliente', () => {
  const quincenal = ['2026-08-05', '2026-08-20', '2026-09-05', '2026-09-20', '2026-10-05', '2026-10-20'].map((f) => ({
    llegoEl: f, ventas: 10000, comision: 2100, banco: 'BBVA ···6536',
  }))
  it('una plataforma quincenal: los días 5 y 20, la comisión del 21 % y el banco', () => {
    expect(aprendidoDeCliente(quincenal).map((a) => [a.texto, a.porque])).toEqual([
      ['Liquida los días 5 y 20', 'las últimas 6 liquidaciones llegaron así'],
      ['Comisión 21 %', 'igual en las 6; si cambia, te aviso'],
      ['Cobro por transferencia a BBVA ···6536', 'las 6 llegaron ahí'],
    ])
  })
  it('con menos de 3, nada; si la última cambia, se desaprende', () => {
    expect(aprendidoDeCliente(quincenal.slice(0, 2))).toEqual([])
    const cambia = [...quincenal.slice(0, 5), { ...quincenal[5], llegoEl: '2026-10-23', comision: 2500, banco: 'Otro banco' }]
    expect(aprendidoDeCliente(cambia).map((a) => a.campo)).toEqual([])
  })
  it('lo fijado a mano con «Cambiar» gana y lo dice', () => {
    const a = aprendidoDeCliente(quincenal, { comision: 'Comisión 19 % + IVA' })
    expect(a.find((x) => x.campo === 'comision')).toEqual({ campo: 'comision', texto: 'Comisión 19 % + IVA', porque: 'lo has fijado tú', fijadoAMano: true })
  })
})

describe('regla 7 · plazo de cobro de más de 60 días: se guarda, pero avisa', () => {
  it('la misma regla que el proveedor (Ley 3/2004)', () => {
    expect(avisoPlazo([75])).toBe('Supera los 60 días que permite la ley de morosidad entre empresas')
    expect(avisoPlazo([60])).toBeNull()
  })
})

describe('el lector de los CSV de las plataformas («Subir liquidación»)', () => {
  it('reconoce cada fichero por sus columnas, y uno que no es, no lo lee a medias', () => {
    expect(leerLiquidaciones(fichero('glovo.csv')).plataforma).toBe('glovo')
    expect(leerLiquidaciones(fichero('je.csv')).plataforma).toBe('je')
    expect(leerLiquidaciones(fichero('uber.csv')).plataforma).toBe('uber')
    expect(queFichero(['fecha', 'importe', 'concepto'])).toBeNull()
    expect(() => leerLiquidaciones('fecha;importe\n01/10/2026;12,00\n')).toThrow(FicheroNoReconocido)
  })
  it('los importes con coma y con punto, sin perder los céntimos (B59)', () => {
    expect(importe('8.905,00')).toBe(8905)
    expect(importe('-25,50')).toBe(-25.5)
    expect(importe('9870.00')).toBe(9870)
    expect(importe('1,234.56')).toBe(1234.56)
    expect(importe('')).toBeNull()
  })
  it('Glovo: la liquidación entera; la marca BOM, las comillas con «;» dentro, filas en blanco y una clave repetida', () => {
    const l = leerLiquidaciones(fichero('glovo.csv'))
    expect(l.filas.map((f) => f.import_key)).toEqual(['glovo:GL-0001', 'glovo:GL-0002', 'glovo:GL-0003'])
    expect(l.filas[0]).toMatchObject({ external_brand_text: 'Plataforma Norte; Centro', settlement_date: '2026-09-05', gross_sales: 8905, commission: 1870, net_payout: 7035 })
    expect(l.filas[1]).toMatchObject({ incidents_cost: -25.5, net_payout: 8200.6 })
    expect(l.sinLeer).toEqual(['canal_pago'])
    expect(l.noTrae).toEqual([])
  })
  it('Just Eat y Uber Eats: solo ventas; lo dicen (sin comisión ni neto)', () => {
    const je = leerLiquidaciones(fichero('je.csv'))
    expect(je.filas[0]).toMatchObject({ import_key: 'je:JE-0101', gross_sales: 4120.3, settlement_date: '2026-09-15' })
    expect(je.filas[0].net_payout).toBeUndefined()
    expect(je.noTrae).toEqual(['la comisión', 'el neto', 'el periodo'])
    const uber = leerLiquidaciones(fichero('uber.csv'))
    expect(uber.filas[1]).toMatchObject({ import_key: 'uber:Norte Centro:2026-09', period_from: '2026-09-01', period_to: '2026-09-30', orders_count: 198, gross_sales: 5990 })
    expect(uber.noTrae).toEqual(['la comisión', 'el neto'])
  })
  it('lee lo mismo que el script de importación que ya usa Folvy (misma vara: filas y claves)', () => {
    const salida = execFileSync('node', ['scripts/import-channel-settlements.mjs', '--account', '00000000-0000-0000-0000-00000000c003',
      '--glovo', join(dir, 'glovo.csv'), '--je', join(dir, 'je.csv'), '--uber', join(dir, 'uber.csv')], { encoding: 'utf8' })
    const m = salida.match(/Filas mapeadas: (\d+) (\{[^}]*\})/)!
    const porOrigen = JSON.parse(m[2].replace(/(\w+):/g, '"$1":').replace(/'/g, '"'))
    const nuestras = ['glovo.csv', 'je.csv', 'uber.csv'].flatMap((f) => leerLiquidaciones(fichero(f)).filas)
    expect(Number(m[1])).toBe(nuestras.length)
    expect(porOrigen).toEqual({ import_csv_glovo: 3, import_csv_je: 2, import_csv_uber: 2 })
    // La muestra del script es la primera fila: la misma, columna a columna.
    const muestra = JSON.parse(salida.slice(salida.indexOf('Muestra:') + 8, salida.indexOf('\n\nDRY RUN')).trim())
    const sinRaw = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !['raw', 'account_id', 'currency', 'needs_review'].includes(k)))
    expect(sinRaw(muestra)).toEqual(sinRaw({ ...nuestras[0] }))
  })
})

describe('C03 · direcciones y pestañas de la ficha', () => {
  it('la lista, el filtro y la ficha salen de un sitio', () => {
    expect(rutaTerceros()).toBe('/conta/clientes-y-proveedores')
    expect(rutaTerceros('socios')).toBe('/conta/clientes-y-proveedores?ver=socios')
    expect(rutaFichaTercero('p1')).toBe('/conta/clientes-y-proveedores/p1')
    expect(rutaFichaTercero('p1', 'cobro')).toBe('/conta/clientes-y-proveedores/p1/cobro')
    expect(migasFichaTercero('Plataforma Norte', { etiqueta: 'Plataformas', filtro: 'plataformas' }).map((m) => m.etiqueta))
      .toEqual(['Clientes y proveedores', 'Plataformas', 'Plataforma Norte'])
  })
  it('dentro de la ficha, el menú marca «Clientes y proveedores»', () => {
    expect(entradaActiva('/conta/clientes-y-proveedores/p1/cobro', MENU_CONTA.flat())).toBe('terceros')
  })
  it('«Liquidaciones» solo sale a plataformas y socios', () => {
    expect(apartadosDe(['customer'])).not.toContain('liquidaciones')
    expect(apartadosDe(['platform', 'supplier'])).toContain('liquidaciones')
    expect(apartadosDe(['brand_partner'])).toContain('liquidaciones')
    expect(apartadosDe(['customer'])).toEqual(['ficha', 'datos-fiscales', 'contactos', 'cobro', 'contabilidad', 'documentos', 'historial'])
  })
})
