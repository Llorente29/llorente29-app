// C05 · Libros y balances: el núcleo contra la población REAL (regla 31).
//
//   · la serie de cuentas anuales que sale del BOE (supabase/conta/pgc/cuentas-anuales.json);
//   · el cuadro de cuentas completo del C02 (supabase/conta/pgc/serie.json):
//     TODA hoja, con saldo deudor y acreedor, cae en una línea de su estado;
//   · el diseño de los libros registro tal cual lo publica la AEAT
//     (docs/conta/fuentes/textos/aeat-disenos-libros-registro.txt): si la AEAT
//     cambia una columna, esta prueba falla.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  calcularEstado, colocar, columnaAnterior, cuadreBalance, mapeoEfectivo, modeloPropuesto, puedeElegir,
  resultadoTresCifras, terminosDeFormula, vistasDeResultado,
  type FilaMapeo, type LineaModelo, type Modelo, type SaldoCuenta,
} from '@/modules/conta/lib/cuentasAnuales'
import { filasQueNoSuman, sumasYSaldos, totales, OPCIONES_POR_DEFECTO, type SaldoPartido } from '@/modules/conta/lib/sumasSaldos'
import {
  COLUMNAS_BIENES, COLUMNAS_EXPEDIDAS, COLUMNAS_RECIBIDAS, agruparPorNif, cuadreConDiario, etiquetaTipo, faltaParaCompletar,
  filaBienes, filaExpedidas, filaRecibidas, filtrar, nombreFichero, trimestre, type AnotacionLibro,
} from '@/modules/conta/lib/libroRegistro'
import { extracto, resumir, type ApunteMayor } from '@/modules/conta/lib/extractos'
import { apertura, aplicar, cierre, prepararCierre, regularizacion, sumas, type SaldoACerrar } from '@/modules/conta/lib/cierre'

type Ref = {
  lineas: { model: Modelo; statement: string; code: string; parent_code: string | null; text: string; level: number; sort_order: number; side: 'activo' | 'pn_pasivo' | null; is_total: boolean; to_create: boolean; legal_ref: string }[]
  mapeo: { model: Modelo; statement: string; line_code: string; account_prefix: string; sign: 'suma' | 'resta'; by_balance: 'deudor' | 'acreedor' | null; origin: FilaMapeo['origin']; note: string | null }[]
}
const ref = JSON.parse(readFileSync('supabase/conta/pgc/cuentas-anuales.json', 'utf8')) as Ref
const cuadro = (JSON.parse(readFileSync('supabase/conta/pgc/serie.json', 'utf8')) as { cuentas: { plan: string; code: string; is_leaf: boolean }[] }).cuentas

const lineasDe = (m: Modelo, e: string): LineaModelo[] => ref.lineas.filter((l) => l.model === m && l.statement === e).map((l) => ({
  code: l.code, parentCode: l.parent_code, text: l.text, level: l.level, sortOrder: l.sort_order, side: l.side, isTotal: l.is_total, toCreate: l.to_create, legalRef: l.legal_ref,
}))
const mapeoDe = (m: Modelo, e: string): FilaMapeo[] => ref.mapeo.filter((x) => x.model === m && x.statement === e).map((x) => ({
  lineCode: x.line_code, prefix: x.account_prefix, sign: x.sign, byBalance: x.by_balance, origin: x.origin, note: x.note,
}))
const saldo = (code: string, debe: number, haber: number, name = code): SaldoCuenta => ({ code: code.padEnd(8, '0'), name, templateCode: code, debe, haber })

describe('Regla 2 · toda hoja del cuadro tiene sitio, con saldo deudor y acreedor', () => {
  for (const [modelo, plan] of [['pymes', 'pymes'], ['abreviado', 'general'], ['normal', 'general']] as const) {
    it(`${modelo}: las ${cuadro.filter((c) => c.plan === plan && c.is_leaf).length} hojas de ${plan}`, () => {
      const hojas = cuadro.filter((c) => c.plan === plan && c.is_leaf && /^[1-7]/.test(c.code)).map((c) => c.code)
      const sin: string[] = []
      for (const code of hojas) {
        const estados = /^[67]/.test(code) ? ['pyg', 'balance'] : ['balance']
        for (const e of estados) for (const s of [100, -100]) if (!colocar(code, s, mapeoDe(modelo, e))) sin.push(`${code}/${e}/${s}`)
      }
      expect(sin).toEqual([])
      expect(hojas.length).toBeGreaterThan(500)
    })
  }
  it('la prueba puede fallar: sin la colocación por defecto, la 473 se queda sin sitio en pymes', () => {
    const sinDefecto = mapeoDe('pymes', 'balance').filter((m) => m.origin !== 'defecto')
    expect(colocar('473', 100, sinDefecto)).toBeNull()
  })
})

describe('Respuestas 1 y 2 · dónde van las cuentas que el modelo no nombra', () => {
  const bal = mapeoDe('pymes', 'balance')
  it('551 va al activo si es deudora y al pasivo si es acreedora (el asterisco de Diez)', () => {
    expect(colocar('551', 50, bal)?.lineCode).toBe('ACT.B.IV')
    expect(colocar('551', -50, bal)?.lineCode).toBe('PNP.C.II.3')
  })
  it('473 con los otros deudores (pymes B.II.3), colocada por defecto', () => {
    const m = colocar('473', 10, bal)!
    expect(m.lineCode).toBe('ACT.B.II.3')
    expect(m.origin).toBe('defecto')
  })
  it('160 a secas va con su hija «otras» (1605: deudas con entidades de crédito), por defecto', () => {
    expect(colocar('160', -10, bal)).toMatchObject({ lineCode: 'PNP.B.II.1', origin: 'defecto' })
  })
  it('678 y 778 van a «Otros resultados», partida a crear de la norma 6.ª.6 del PGC de pymes', () => {
    const pyg = mapeoDe('pymes', 'pyg')
    expect(colocar('678', 1, pyg)?.lineCode).toBe('OR')
    expect(colocar('778', -1, pyg)?.lineCode).toBe('OR')
    const or = lineasDe('pymes', 'pyg').find((l) => l.code === 'OR')!
    expect(or.toCreate).toBe(true)
    expect(or.legalRef).toMatch(/RD 1515\/2007, tercera parte, I, norma 6\.ª Cuenta de pérdidas y ganancias, apartado 6/)
  })
  it('«Otros resultados» va dentro del resultado de explotación, justo después de la 11', () => {
    const ls = lineasDe('pymes', 'pyg').sort((a, b) => a.sortOrder - b.sortOrder).map((l) => l.code)
    expect(ls.slice(ls.indexOf('11'), ls.indexOf('11') + 3)).toEqual(['11', 'OR', '=A'])
  })
  it('774 en pymes no tiene sitio: sale como «sin sitio en el modelo» y no se esconde', () => {
    const r = calcularEstado('pyg', lineasDe('pymes', 'pyg'), mapeoDe('pymes', 'pyg'), [saldo('774', 0, 300)])
    expect(r.sinSitio.map((s) => s.templateCode)).toEqual(['774'])
  })
})

// Un balance de comprobación pequeño y cuadrado (Debe = Haber): constitución,
// compras, ventas con IVA, un préstamo y un ingreso excepcional.
const balanceComprobacion: SaldoCuenta[] = [
  saldo('100', 0, 3000), saldo('572', 10431.5, 0), saldo('430', 1210, 0), saldo('400', 0, 605),
  saldo('472', 105, 0), saldo('477', 0, 210), saldo('170', 0, 5000), saldo('217', 1200, 0),
  saldo('600', 500, 0), saldo('700', 0, 3000), saldo('662', 30, 0), saldo('778', 0, 1661.5),
]
describe('Reglas 1 y 3 · el balance cuadra en cualquier fecha y el resultado es el mismo en los tres sitios', () => {
  const debe = balanceComprobacion.reduce((a, s) => a + s.debe, 0)
  const haber = balanceComprobacion.reduce((a, s) => a + s.haber, 0)
  it('el balance de comprobación de la prueba cuadra (si no, la prueba no probaría nada)', () => expect(Math.round(debe * 100)).toBe(Math.round(haber * 100)))
  for (const modelo of ['pymes', 'abreviado', 'normal'] as const) {
    it(`${modelo}: activo = PN + pasivo; PyG = resultado del balance, sin regularizar`, () => {
      const bal = calcularEstado('balance', lineasDe(modelo, 'balance'), mapeoDe(modelo, 'balance'), balanceComprobacion)
      const c = cuadreBalance(bal)
      expect(c).toMatchObject({ cuadra: true, activo: 12946.5, pnPasivo: 12946.5 })
      const pyg = calcularEstado('pyg', lineasDe(modelo, 'pyg'), mapeoDe(modelo, 'pyg'), balanceComprobacion)
      const tres = resultadoTresCifras(pyg, bal, 0)
      expect(tres).toMatchObject({ pyg: 4131.5, balance: 4131.5, iguales: true })
      expect(pyg.lineas.find((l) => l.code === 'OR')).toMatchObject({ importe: 1661.5, oculta: false })
    })
  }
  it('tras regularizar, el resultado está en la 129 y las tres cifras siguen iguales', () => {
    const reg = regularizacion(balanceComprobacion.map((s) => ({ ...s })), '12900000', '2026-12-31', '2026')!
    const tras = aplicar(balanceComprobacion, reg).map((s) => ({ ...s, templateCode: s.templateCode ?? s.code.slice(0, 3) }))
    const bal = calcularEstado('balance', lineasDe('pymes', 'balance'), mapeoDe('pymes', 'balance'), tras)
    expect(cuadreBalance(bal).cuadra).toBe(true)
    expect(bal.lineas.find((l) => l.code === 'PNP.A.A1.VII')?.importe).toBe(4131.5)
    const pygDelAno = calcularEstado('pyg', lineasDe('pymes', 'pyg'), mapeoDe('pymes', 'pyg'), balanceComprobacion)
    const s129 = tras.find((s) => s.code === '12900000')!
    expect(resultadoTresCifras(pygDelAno, bal, s129.haber - s129.debe).iguales).toBe(true)
  })
  it('si una cuenta con saldo se queda fuera (mapeo propio), no cuadra y dice cuál', () => {
    const propio: FilaMapeo[] = [{ lineCode: 'ACT.B.VI', prefix: '572', sign: 'suma', byBalance: null, origin: 'empresa', excluded: true }]
    const bal = calcularEstado('balance', lineasDe('pymes', 'balance'), mapeoEfectivo(mapeoDe('pymes', 'balance'), propio), balanceComprobacion)
    const c = cuadreBalance(bal)
    expect(c.cuadra).toBe(false)
    expect(c.porque).toMatch(/57200000/)
  })
  it('una cuenta de clientes con saldo acreedor se marca anómala (ámbar)', () => {
    const bal = calcularEstado('balance', lineasDe('pymes', 'balance'), mapeoDe('pymes', 'balance'), [saldo('430', 0, 40), saldo('572', 40, 0)])
    expect(bal.lineas.flatMap((l) => l.cuentas).find((c) => c.templateCode === '430')?.anomalo).toBe(true)
  })
  it('una partida a crear sin saldo no se enseña', () => {
    const pyg = calcularEstado('pyg', lineasDe('pymes', 'pyg'), mapeoDe('pymes', 'pyg'), [saldo('700', 0, 10), saldo('572', 10, 0)])
    expect(pyg.lineas.find((l) => l.code === 'OR')?.oculta).toBe(true)
  })
  it('las fórmulas de los totales se leen del texto del BOE', () => {
    expect(terminosDeFormula('D) RESULTADO DEL EJERCICIO (C + 17)')).toEqual(['C', '17'])
    expect(terminosDeFormula('A.3) RESULTADO ANTES DE IMPUESTOS (A.1+A.2)')).toEqual(['A.1', 'A.2'])
  })
})

describe('Regla 9 · mapeo propio sobre la serie', () => {
  it('lo propio manda para su prefijo; lo demás sigue la serie', () => {
    const serie = mapeoDe('pymes', 'balance')
    const propio: FilaMapeo[] = [{ lineCode: 'ACT.B.II.3', prefix: '4300', sign: 'suma', byBalance: null, origin: 'empresa' }]
    const ef = mapeoEfectivo(serie, propio)
    expect(colocar('4300', 1, ef)?.lineCode).toBe('ACT.B.II.3')
    expect(colocar('4310', 1, ef)?.lineCode).toBe('ACT.B.II.1')
    // Volver al estándar = quitar lo propio.
    expect(colocar('4300', 1, mapeoEfectivo(serie, []))?.lineCode).toBe('ACT.B.II.1')
  })
})

describe('Regla 4 · el modelo que corresponde (LSC 257 y 258; RD 1515/2007 art. 2 vigente)', () => {
  it('una empresa pequeña: pymes, con frase y cita', () => {
    const p = modeloPropuesto({ activo: 900_000, cifraNegocios: 2_100_000, plantillaMedia: 6 }, { activo: 800_000, cifraNegocios: 1_900_000, plantillaMedia: 6 })
    expect(p.modelo).toBe('pymes')
    expect(p.frase).toMatch(/LSC art\. 257\.1/)
    expect(puedeElegir(p, 'normal')).toBe(true)
  })
  it('justo en el límite cuenta como dentro; por encima en dos de tres, normal', () => {
    expect(modeloPropuesto({ activo: 4_000_000, cifraNegocios: 8_000_000, plantillaMedia: 80 }, null).modelo).toBe('pymes')
    const g = modeloPropuesto({ activo: 4_000_001, cifraNegocios: 8_000_001, plantillaMedia: 20 }, null)
    expect(g.modelo).toBe('normal')
    expect(g.pygAbreviada).toBe(true)
    expect(puedeElegir(g, 'pymes')).toBe(false)
  })
  it('hacen falta dos ejercicios seguidos: si el anterior no cumplía, normal', () => {
    expect(modeloPropuesto({ activo: 1e6, cifraNegocios: 1e6, plantillaMedia: 5 }, { activo: 9e6, cifraNegocios: 9e6, plantillaMedia: 5 }).modelo).toBe('normal')
  })
})

describe('Reglas 8 y 10', () => {
  it('sin ejercicio anterior la columna lo dice; no inventa ceros', () => {
    expect(columnaAnterior(null)).toEqual({ sale: false, texto: 'sin ejercicio anterior' })
    expect(columnaAnterior({ estado: 'traido' })).toEqual({ sale: true, texto: 'traído' })
  })
  it('por local solo con más de un local; por marca solo si hay marcas', () => {
    expect(vistasDeResultado(1, 0)).toEqual({ porLocal: false, porMarca: false })
    expect(vistasDeResultado(2, 3)).toEqual({ porLocal: true, porMarca: true })
  })
})

// ── Regla 5 · sumas y saldos ────────────────────────────────────────────────
const partido = (code: string, templateCode: string, p: Partial<SaldoPartido>): SaldoPartido => ({
  code, name: code, templateCode, inicialDebe: 0, inicialHaber: 0, aperturaDebe: 0, aperturaHaber: 0, periodoDebe: 0, periodoHaber: 0,
  regularizacionDebe: 0, regularizacionHaber: 0, cierreDebe: 0, cierreHaber: 0, ...p,
})
const saldosEjercicio: SaldoPartido[] = [
  partido('10000000', '100', { aperturaHaber: 3000 }),
  partido('57200001', '572', { aperturaDebe: 3000, inicialDebe: 1210, periodoDebe: 0.1, periodoHaber: 500 }),
  partido('43000001', '430', { inicialDebe: 1210, inicialHaber: 1210 }),
  partido('70000000', '700', { inicialHaber: 1000, periodoHaber: 0.1, regularizacionDebe: 1000.1 }),
  partido('47700000', '477', { inicialHaber: 210 }),
  partido('62100000', '621', { periodoDebe: 500, regularizacionHaber: 500 }),
  partido('12900000', '129', { regularizacionHaber: 500.1 }),
]
describe('Regla 5 · sumas y saldos por niveles', () => {
  it('cada nivel suma exactamente a sus hijos, con céntimos sueltos', () => {
    const f = sumasYSaldos(saldosEjercicio, ['grupo', 'subgrupo', 'cuenta', 'subcuenta'], { ...OPCIONES_POR_DEFECTO, pyg: true })
    expect(filasQueNoSuman(f)).toEqual([])
    expect(totales(f, 'grupo').cuadra).toBe(true)
    expect(totales(f, 'subcuenta')).toMatchObject({ debe: 6920.2, haber: 6920.2 })
  })
  it('sin la apertura, el 100 y el 572 pierden los 3.000 de la apertura', () => {
    const con = sumasYSaldos(saldosEjercicio, ['subcuenta'], OPCIONES_POR_DEFECTO)
    const sin = sumasYSaldos(saldosEjercicio, ['subcuenta'], { ...OPCIONES_POR_DEFECTO, apertura: false })
    expect(con.find((x) => x.code === '10000000')?.haber).toBe(3000)
    expect(sin.find((x) => x.code === '10000000')).toBeUndefined()
    expect(totales(sin, 'subcuenta').cuadra).toBe(true)
  })
  it('solo el periodo con saldo inicial: lo anterior y la apertura van al inicial', () => {
    const f = sumasYSaldos(saldosEjercicio, ['subcuenta'], { ...OPCIONES_POR_DEFECTO, soloPeriodo: true })
    expect(f.find((x) => x.code === '57200001')).toMatchObject({ inicial: 4210, debe: 0.1, haber: 500, saldo: 3710.1 })
  })
  it('con la PyG (regularización) los 6 y 7 quedan a cero; sin ella, con su saldo', () => {
    const con = sumasYSaldos(saldosEjercicio, ['subcuenta'], { ...OPCIONES_POR_DEFECTO, pyg: true })
    expect(con.find((x) => x.code === '70000000')).toMatchObject({ debe: 1000.1, haber: 1000.1, saldo: 0 })
    const sin = sumasYSaldos(saldosEjercicio, ['subcuenta'], OPCIONES_POR_DEFECTO)
    expect(sin.find((x) => x.code === '70000000')?.saldo).toBe(-1000.1)
  })
  it('saldos a cero: con la opción salen las cuentas saldadas', () => {
    const conCero = [...saldosEjercicio, partido('40000001', '400', {})]
    expect(sumasYSaldos(conCero, ['subcuenta'], OPCIONES_POR_DEFECTO).some((x) => x.code === '40000001')).toBe(false)
    expect(sumasYSaldos(conCero, ['subcuenta'], { ...OPCIONES_POR_DEFECTO, saldosACero: true }).some((x) => x.code === '40000001')).toBe(true)
  })
  it('rango de cuentas', () => {
    const f = sumasYSaldos(saldosEjercicio, ['subcuenta'], { ...OPCIONES_POR_DEFECTO, desdeCuenta: '4', hastaCuenta: '5' })
    expect(f.map((x) => x.code)).toEqual(['43000001', '47700000', '57200001'])
  })
})

// ── Regla 6 · libros registro ───────────────────────────────────────────────
function derivarColumnas(hoja: string): string[] {
  const t = readFileSync('docs/conta/fuentes/textos/aeat-disenos-libros-registro.txt', 'utf8').split('\n')
  let dentro = false
  for (let i = 0; i < t.length; i++) {
    if (t[i].startsWith('## Hoja')) dentro = t[i].includes(hoja)
    const c = t[i].split('\t')
    if (dentro && c[0].startsWith('Decimal (4,0)')) {
      const n = c.length
      const r1 = t[i - 2].split('\t'); const r2 = t[i - 1].split('\t')
      const limpia = (s: string) => s.replace(/\s*\(\d+\)/g, '').trim()
      let g = ''
      return Array.from({ length: n }, (_, k) => {
        if ((r1[k] ?? '').trim()) g = limpia(r1[k])
        const s = limpia(r2[k] ?? '')
        return g + (s ? ` · ${s}` : '')
      })
    }
  }
  throw new Error(`no está la hoja ${hoja}`)
}
const anot = (p: Partial<AnotacionLibro>): AnotacionLibro => ({
  id: 'x', entryId: 'e', book: 'issued', invoiceType: 'F1', series: null, number: '1', numberTo: null, documentsCount: 1, issueDate: '2026-10-04',
  operationDate: null, receivedDate: null, receivedNumber: null, partyId: null, counterpartTaxId: 'B00000000', counterpartIdType: null, counterpartCountry: null,
  counterpartName: 'Cliente de prueba', operationKey: '01', qualification: 'S1', exemptCause: null, taxBase: 100, taxRate: 10, taxAmount: 10,
  surchargeRate: null, surchargeAmount: null, total: 110, deductibleAmount: null, deductibleLater: false, reverseCharge: false, investmentGood: false,
  withholdingRate: null, withholdingAmount: null, activityCode: 'A', activityType: '03', activityIae: '6711', correctsRef: null, sourceType: 'manual', voidedAt: null, ...p,
})
describe('Regla 6 · libros registro en el formato de la AEAT', () => {
  it('las columnas son exactamente las del diseño bajado (36, 42 y 40)', () => {
    expect([...COLUMNAS_EXPEDIDAS]).toEqual(derivarColumnas('EXPEDIDAS'))
    expect([...COLUMNAS_RECIBIDAS]).toEqual(derivarColumnas('RECIBIDAS'))
    expect([...COLUMNAS_BIENES]).toEqual(derivarColumnas('BIENES'))
    expect([COLUMNAS_EXPEDIDAS.length, COLUMNAS_RECIBIDAS.length, COLUMNAS_BIENES.length]).toEqual([36, 42, 40])
  })
  it('cada fila tiene tantas celdas como columnas', () => {
    expect(filaExpedidas(anot({}))).toHaveLength(36)
    expect(filaRecibidas(anot({ book: 'received' }))).toHaveLength(42)
  })
  it('el asiento resumen de tiques es F4, con el rango y cuántos (respuesta 1)', () => {
    const r = anot({ invoiceType: 'F4', number: 'T-0101', numberTo: 'T-0212', documentsCount: 112, counterpartTaxId: null, counterpartName: 'VENTAS A CONSUMIDOR FINAL' })
    expect(etiquetaTipo(r)).toBe('F4 · resumen · art. 63.4 · T-0101–T-0212 · 112 tiques')
    expect(faltaParaCompletar(r)).toEqual([])
    const fila = filaExpedidas(r)
    expect(fila.slice(5, 6)).toEqual(['F4'])
    expect(fila.slice(10, 13)).toEqual([null, 'T-0101', 'T-0212'])
  })
  it('una F1 sin NIF pide «Completar»; F2 (tique suelto) no', () => {
    expect(faltaParaCompletar(anot({ counterpartTaxId: null }))).toEqual(['NIF del destinatario'])
    expect(faltaParaCompletar(anot({ invoiceType: 'F2', counterpartTaxId: null }))).toEqual([])
  })
  it('recibida con retención y rectificativa', () => {
    const f = filaRecibidas(anot({ book: 'received', invoiceType: 'R1', withholdingRate: 19, withholdingAmount: -19, series: 'A', number: '7' }))
    expect(f[5]).toBe('R1')
    expect(f[10]).toBe('A-7')
    expect(f.slice(36, 38)).toEqual([19, -19])
  })
  it('las cuotas del libro cuadran con la 477 del periodo; si no, dice cuánto', () => {
    const libro = [anot({ taxAmount: 10 }), anot({ taxAmount: 8.99 }), anot({ taxAmount: 5, voidedAt: '2026-10-05' })]
    expect(cuadreConDiario(libro, 'issued', 18.99).cuadra).toBe(true)
    const mal = cuadreConDiario(libro, 'issued', 23.99)
    expect(mal.cuadra).toBe(false)
    expect(mal.frase).toMatch(/5,00 € de diferencia/)
  })
  it('el periodo es el trimestre de la fecha de operación (o de expedición)', () => {
    expect(filaExpedidas(anot({ issueDate: '2026-04-03', operationDate: '2026-03-30' })).slice(0, 2)).toEqual([2026, '1T'])
    expect(trimestre('2026-12-31')).toBe('4T')
  })
  it('nombre del fichero: ejercicio + NIF + C + razón social', () => {
    expect(nombreFichero(2026, 'B-12.345.678', 'Empresa de Prueba, S.L.')).toBe('2026B12345678CEmpresa de Prueba, S.L..xlsx')
  })
  it('listado de facturación: importe superior a, tipo, agrupar por NIF y solo los del 347', () => {
    const l = [
      anot({ id: '1', counterpartTaxId: 'B1', total: 2000 }), anot({ id: '2', counterpartTaxId: 'B1', total: 1500 }),
      anot({ id: '3', counterpartTaxId: 'B2', total: 500 }), anot({ id: '4', invoiceType: 'F2', counterpartTaxId: null, total: 20 }),
    ]
    expect(filtrar(l, { importeSuperiorA: 1000 }).map((a) => a.id)).toEqual(['1', '2'])
    expect(filtrar(l, { tipos: ['F2'] }).map((a) => a.id)).toEqual(['4'])
    expect(agruparPorNif(l)[0]).toMatchObject({ nif: 'B1', anotaciones: 2, total: 3500 })
    expect(filtrar(l, { solo347: true }).map((a) => a.id)).toEqual(['1', '2'])
  })
})

// ── Regla 7 · cierre y apertura ─────────────────────────────────────────────
const aCerrar: SaldoACerrar[] = balanceComprobacion.map((s) => ({ ...s }))
describe('Regla 7 · regularización, cierre y apertura', () => {
  const p = prepararCierre(aCerrar, { cuenta129: '12900000', finEjercicio: '2026-12-31', inicioSiguiente: '2027-01-01', ejercicio: '2026', siguiente: '2027' })
  it('los tres cuadran y el resultado es el de la PyG', () => {
    for (const a of [p.regularizacion, p.cierre, p.apertura]) expect(sumas(a!).cuadra).toBe(true)
    expect(p.resultado).toBe(4131.5)
  })
  it('tras el cierre todo el balance queda a cero', () => {
    const tras = aplicar(aplicar(aCerrar, p.regularizacion), p.cierre)
    expect(tras.filter((s) => Math.round(s.debe * 100) !== Math.round(s.haber * 100))).toEqual([])
  })
  it('la apertura es el cierre al revés, en el primer día, serie General', () => {
    expect(p.apertura).toMatchObject({ fecha: '2027-01-01', sourceType: 'opening', serie: 4 })
    const caja = p.cierre!.apuntes.find((x) => x.cuenta === '57200000')!
    expect(p.apertura!.apuntes.find((x) => x.cuenta === '57200000')).toMatchObject({ debe: caja.haber, haber: caja.debe })
  })
  it('no se cierra sin regularizar', () => {
    expect(() => cierre(aCerrar, '2026-12-31', '2026')).toThrow(/Antes del cierre hay que regularizar/)
  })
  it('un ejercicio con pérdidas lleva la 129 al Debe', () => {
    const r = regularizacion([{ code: '62100000', name: 'x', templateCode: '621', debe: 80, haber: 0 }], '12900000', '2026-12-31', '2026')!
    expect(r.apuntes.find((x) => x.cuenta === '12900000')).toMatchObject({ debe: 80, haber: 0 })
  })
  it('apertura sin cierre: nada', () => {
    expect(apertura({ tipo: 'cierre', fecha: '', concepto: '', sourceType: 'closing', serie: 4, apuntes: [] }, '2027-01-01', '2027').apuntes).toEqual([])
  })
})

// ── Tarea 4: diario resumido, extracto del mayor y hoja de bienes ───────────

const ap = (entryId: string, fecha: string, cuenta: string, debe: number, haber: number, localId: string | null = null): ApunteMayor =>
  ({ entryId, fecha, cuenta, nombreCuenta: `Cuenta ${cuenta}`, debe, haber, localId, marcaId: null, comun: localId === null })

describe('diario resumido', () => {
  const ms = [
    ap('a', '2026-01-01', '57200001', 1000, 0), ap('a', '2026-01-01', '10000000', 0, 1000),
    ap('b', '2026-01-15', '62100000', 300.1, 0), ap('b', '2026-01-15', '57200001', 0, 300.1),
    ap('c', '2026-02-03', '70000000', 0, 0.3), ap('c', '2026-02-03', '57200001', 0.1, 0), ap('c', '2026-02-03', '57200002', 0.2, 0),
  ]
  it('un mes por fila de cuenta, y cada mes cuadra al céntimo', () => {
    const r = resumir(ms, null)
    expect(r.map((m) => m.mes)).toEqual(['2026-01', '2026-02'])
    expect(r[0].asientos).toBe(2)
    expect(r[0].filas.find((f) => f.cuenta === '57200001')).toMatchObject({ debe: 1000, haber: 300.1 })
    for (const m of r) expect(Math.round(m.debe * 100)).toBe(Math.round(m.haber * 100))
    // 0,1 + 0,2 en coma flotante es 0,30000000000000004: se suma en céntimos.
    expect(r[1].debe).toBe(0.3)
  })
  it('por nivel junta las subcuentas', () => {
    const r = resumir(ms, 3)
    expect(r[1].filas.map((f) => f.cuenta)).toEqual(['572', '700'])
    expect(r[1].filas[0].debe).toBe(0.3)
  })
})

describe('extracto del mayor', () => {
  const ms = [
    ap('ap', '2026-01-01', '57200001', 500, 0, null),
    ap('x', '2026-02-10', '57200001', 0, 120, 'L1'),
    ap('y', '2026-03-05', '57200001', 80, 0, 'L2'),
    ap('z', '2026-03-20', '57200001', 0, 30, 'L1'),
  ]
  it('saldo inicial con la apertura, y arrastre fila a fila', () => {
    const x = extracto(ms, { desde: '2026-03-01', hasta: '2026-03-31' })
    expect(x.inicial).toBe(380)
    expect(x.filas.map((f) => f.saldo)).toEqual([460, 430])
    expect(x).toMatchObject({ debe: 80, haber: 30, final: 430 })
  })
  it('con filtro de local, el saldo inicial también se filtra', () => {
    const x = extracto(ms, { desde: '2026-03-01', hasta: '2026-03-31', localId: 'L1' })
    expect(x.inicial).toBe(-120)
    expect(x.filas.map((f) => f.saldo)).toEqual([-150])
  })
  it('solo lo común', () => {
    const x = extracto(ms, { desde: '2026-01-01', hasta: '2026-12-31', localId: null, soloComun: true })
    expect(x.filas).toHaveLength(1)
    expect(x.final).toBe(500)
  })
})

describe('hoja BIENES-INVERSIÓN', () => {
  const b = { id: 'b1', descripcion: 'Horno', tipo: 'mueble' as const, alta: '2026-03-02', inicioUso: '2026-03-10', valor: 12100, base: 10000, tipoIva: 21, cuota: 2100, deducible: 100, baja: null }
  it('40 columnas, como el diseño', () => {
    expect(COLUMNAS_BIENES).toHaveLength(40)
    expect(filaBienes(b, 2026)).toHaveLength(COLUMNAS_BIENES.length)
  })
  it('cada dato en su columna (por nombre, no por posición a ojo)', () => {
    const f = filaBienes(b, 2026)
    const en = (col: string) => f[COLUMNAS_BIENES.indexOf(col as (typeof COLUMNAS_BIENES)[number])]
    expect(en('Autoliquidación · Periodo')).toBe('4T')
    expect(en('Tipo de Bien')).toBe('29')
    expect(en('Fecha Inicio Utilización')).toBe('10/03/2026')
    expect(en('Valor Adquisición')).toBe(12100)
    expect(en('Año de Inicio Utilización · Base Imponible')).toBe(10000)
    expect(en('Año de Inicio Utilización · Cuota Deducible')).toBe(2100)
    expect(en('Baja del Bien · Causa')).toBeNull()
    expect(filaBienes({ ...b, tipo: 'inmueble', baja: '2027-01-01' }, 2027)[COLUMNAS_BIENES.indexOf('Baja del Bien · Causa')]).toBe('99')
  })
})
