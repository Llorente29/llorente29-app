// S01d · Repartir un movimiento entre varias cuentas y recordarlo en una
// regla (tableros 1 y 2). Importes de la maqueta; sin nombres ni cuentas
// reales de nadie.
import { describe, expect, it } from 'vitest'
import { aplicarRegla, cuentas, leerImporte, lineaNueva, lineasParaRegla, porQueNoSeCasa, textoImporte, type LineaRegla } from '@/modules/conta/lib/reparto'
import { decidir, type Contexto, type Movimiento } from '@/modules/conta/lib/conciliacion'

const plan = new Set(['52010000', '66230000', '62600000', '47510000'])
const existe = (c: string) => plan.has(c)

describe('el importe, en euros como se escribe', () => {
  it('lee «1.303,46», «1303,46», «1303.46», «1.303» y «29,8»', () => {
    expect(leerImporte('1.303,46')).toBe(130346)
    expect(leerImporte('1303,46')).toBe(130346)
    expect(leerImporte('1303.46')).toBe(130346)
    expect(leerImporte('1.303')).toBe(130300)
    expect(leerImporte('29,8')).toBe(2980)
    expect(leerImporte('')).toBeNull()
    expect(leerImporte('veinte')).toBeNull()
  })
  it('lo escribe con punto de miles y coma', () => {
    expect(textoImporte(133334)).toBe('1.333,34')
    expect(textoImporte(5)).toBe('0,05')
  })
})

describe('falta por repartir', () => {
  const mov = -133334
  it('capital e intereses suman el movimiento: falta 0 y se puede casar', () => {
    const ls = [{ cuenta: '52010000', importe: '1.303,46', concepto: 'Capital' }, { cuenta: '66230000', importe: '29,88', concepto: 'Intereses' }]
    expect(cuentas(mov, ls)).toEqual({ repartidoCent: 133334, faltaCent: 0 })
    expect(porQueNoSeCasa(mov, ls, existe)).toBeNull()
  })
  it('no se casa hasta que cuadra, y dice cuánto falta o sobra', () => {
    expect(porQueNoSeCasa(mov, [{ cuenta: '52010000', importe: '1.303,46', concepto: '' }], existe)).toBe('Falta por repartir 29,88 €.')
    expect(porQueNoSeCasa(mov, [{ cuenta: '52010000', importe: '1.400', concepto: '' }], existe)).toBe('Has repartido 66,66 € de más.')
  })
  it('cada línea con su cuenta del plan y su importe; la 4751, con modelo y periodo', () => {
    expect(porQueNoSeCasa(mov, [{ cuenta: '', importe: '1.333,34', concepto: '' }], existe)).toBe('La línea no tiene cuenta.')
    expect(porQueNoSeCasa(mov, [{ cuenta: '99999999', importe: '1.333,34', concepto: '' }], existe)).toBe('La línea: la cuenta 99999999 no está en el plan.')
    expect(porQueNoSeCasa(mov, [{ cuenta: '52010000', importe: '1.333,34', concepto: '' }, { cuenta: '66230000', importe: '0', concepto: '' }], existe))
      .toBe('La línea 2: el importe tiene que ser mayor que cero.')
    expect(porQueNoSeCasa(-57801, [{ cuenta: '47510000', importe: '578,01', concepto: '' }], existe)).toBe('La línea va a la 4751: di el modelo y el periodo que paga.')
    expect(porQueNoSeCasa(-57801, [{ cuenta: '47510000', importe: '578,01', concepto: '', modelo: '111', periodo: '2026-3T' }], existe)).toBeNull()
  })
  it('«+ Repartir en otra cuenta» trae lo que falta', () => {
    expect(lineaNueva(mov, [{ cuenta: '52010000', importe: '1.303,46', concepto: '' }]).importe).toBe('29,88')
    expect(lineaNueva(mov, [{ cuenta: '52010000', importe: '1.333,34', concepto: '' }]).importe).toBe('')
  })
})

describe('la regla con reparto', () => {
  const regla: LineaRegla[] = [{ cuenta: '52010000', importeCent: 130346, concepto: 'Capital' }, { cuenta: '66230000', importeCent: 2988, concepto: 'Intereses' }]
  it('«Recordar este reparto» guarda cada importe fijo', () => {
    expect(lineasParaRegla([{ cuenta: ' 52010000 ', importe: '1.303,46', concepto: 'Capital' }, { cuenta: '66230000', importe: '29,88', concepto: '' }]))
      .toEqual([{ cuenta: '52010000', importeCent: 130346, concepto: 'Capital' }, { cuenta: '66230000', importeCent: 2988, concepto: null }])
  })
  it('mismo importe: repartido; otro importe: las mismas cuentas sin cuadrar', () => {
    expect(aplicarRegla(-133334, regla)).toEqual({ cuadra: true, lineas: regla })
    expect(aplicarRegla(-140000, regla).cuadra).toBe(false)
    expect(aplicarRegla(-140000, regla).lineas.map((l) => l.cuenta)).toEqual(['52010000', '66230000'])
  })
  it('una línea «lo que falte» completa cualquier importe mayor que las fijas', () => {
    const conResto: LineaRegla[] = [{ cuenta: '62600000', importeCent: 1200, concepto: 'Comisión' }, { cuenta: '66230000', importeCent: null, concepto: 'Intereses' }]
    expect(aplicarRegla(-3324, conResto)).toEqual({ cuadra: true, lineas: [conResto[0], { ...conResto[1], importeCent: 2124 }] })
    expect(aplicarRegla(-1000, conResto).cuadra).toBe(false)
  })
})

describe('la regla con reparto en Bancos', () => {
  const ctx = (lineas: LineaRegla[]) => ({
    cuentas: [{ id: 'cta', nombre: 'Cuenta', cuenta: '57200001' }], sinCasar: [], facturas: [], saldosTraidos: [], proveedores: [], clientes: [], liquidaciones: [], plataformas: [],
    nominas: [], contratos: [], aprendido: [], asientos: [], impuestos: [], cuentas626: '62600000', cuentas476: '47600000', cuentaCaja: '57000000',
    nombres: { '52010000': 'Pago aplazado · capital', '66230000': 'Intereses de deudas con bancos' },
    reglas: [{ id: 'r', palabras: 'Cuando el concepto tenga «LIQUIDACION APLAZADO»', contiene: 'LIQUIDACION APLAZADO', signo: -1, cuenta: '52010000', terceroId: null, confirmaciones: 5, lineas }],
  }) as unknown as Contexto
  const mov = (importeCent: number): Movimiento => ({ id: 'm', cuentaId: 'cta', fecha: '2026-10-29', conceptoComun: null, referencias: [], antesDelCorte: false, importeCent, concepto: 'LIQUIDACION APLAZADO' })
  const lineas: LineaRegla[] = [{ cuenta: '52010000', importeCent: 130346, concepto: 'Capital' }, { cuenta: '66230000', importeCent: 2988, concepto: 'Intereses' }]

  it('mismo importe: sale repartido como «probable», aunque la regla lleve 5 confirmaciones (no casa sola)', () => {
    const d = decidir(mov(-133334), ctx(lineas))
    expect(d.confianza).toBe('probable')
    expect(d.destino).toMatchObject({ tipo: 'cuenta', lineas: [{ cuenta: '52010000', importe: 1303.46, concepto: 'Capital' }, { cuenta: '66230000', importe: 29.88, concepto: 'Intereses' }] })
  })
  it('otro importe: por aclarar, con las mismas cuentas para repartir', () => {
    const d = decidir(mov(-140000), ctx(lineas))
    expect(d.confianza).toBe('duda')
    expect(d.destino).toBeNull()
    expect(d.falta).toBe('repartir el importe')
    expect(d.reparto?.map((l) => l.cuenta)).toEqual(['52010000', '66230000'])
  })
})
