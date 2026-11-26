// R20 · Las cifras de «Clientes y cuotas» (_shared/tarifa/cifras.ts). Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { avisosDeLasCifras, cifrasDeCuotas, fraseDiferencia, fraseNoCobrado, noCobrado, textoAltasBajas,
  type CargoParaDeuda, type Lista, type ReciboDeFicha, type SuscripcionDelCobro } from '../../../../../supabase/functions/_shared/tarifa/cifras'

const E = 'emp-1'
const MES = '2026-12'
const sus = (gcId: string, fichaId: string | null, importeCent: number, fecha = '2026-12-04', x: Partial<SuscripcionDelCobro> = {}): SuscripcionDelCobro => ({
  empresaId: E, gcId, gcClienteId: `CU-${fichaId ?? gcId}`, clienteGc: `Cliente ${fichaId ?? gcId}`, fichaId, nombre: 'Gestoría mensual', fecha, importeCent, ...x,
})
const recibo = (fichaId: string, lineas: [string, number][]): ReciboDeFicha => ({
  empresaId: E, fichaId, nombre: `Ficha ${fichaId}`, lineas: lineas.map(([id, c]) => ({ id, texto: `Línea ${id}`, importeCent: c })),
  totalCent: lineas.reduce((s, [, c]) => s + c, 0),
})
const sumaFilas = (l: Lista) => l.filas.reduce((s, f) => s + f.importeCent, 0)

describe('R20 · cuotas: GoCardless y Sumied del mismo mes', () => {
  const suscripciones = [
    sus('s1', 'f1', 6050), sus('s2', 'f1', 2420), // f1: igual que Sumied
    sus('s3', 'f2', 8470), // f2: Sumied 6050 → distinto (+2420)
    sus('s4', null, 12100, '2026-12-14'), // sin atar
    sus('s5', 'f4', 6050), // f4: atado y Sumied sin cuota
    sus('s6', 'f9', 9999, '2027-01-04'), // de otro mes: no cuenta
  ]
  const recibos = [recibo('f1', [['l1', 6050], ['l2', 2420]]), recibo('f2', [['l3', 6050]]), recibo('f3', [['l4', 7260]])] // f3: solo en Sumied
  const antes = [recibo('f1', [['l1', 6050]]), recibo('f2', [['l3', 6050], ['l9', 2420]]), recibo('f3', [['l4', 7260]])]
  const c = cifrasDeCuotas(MES, suscripciones, recibos, antes)

  it('cada cifra es la suma de su lista', () => {
    expect(c.gocardless.lista.totalCent).toBe(6050 + 2420 + 8470 + 12100 + 6050)
    expect(c.gocardless.lista.totalCent).toBe(sumaFilas(c.gocardless.lista))
    expect(c.sumied.lista.totalCent).toBe(6050 + 2420 + 6050 + 7260)
    expect(c.sumied.lista.totalCent).toBe(sumaFilas(c.sumied.lista))
    expect(c.gocardless.porDia.reduce((s, d) => s + d.lista.totalCent, 0)).toBe(c.gocardless.lista.totalCent)
    expect(c.gocardless.porDia.map((d) => [d.texto, d.cobros])).toEqual([['El 4/12', 4], ['Otros días de diciembre', 1]])
  })

  it('la diferencia sale en sus cuatro listas, que suman exactamente la diferencia', () => {
    expect(c.diferencia.cent).toBe(c.gocardless.lista.totalCent - c.sumied.lista.totalCent)
    expect(c.diferencia.grupos.reduce((s, g) => s + g.totalCent, 0)).toBe(c.diferencia.cent)
    expect(c.diferencia.grupos.map((g) => [g.titulo, g.totalCent])).toEqual([
      ['GoCardless cobra a 1 cliente sin atar a ninguna ficha', 12100],
      ['Sumied tiene cuota y GoCardless no les cobra (1 ficha)', -7260],
      ['Con un importe distinto en cada lado (1 ficha)', 2420],
      ['Atados, y Sumied sin cuota en diciembre (1 ficha)', 6050],
    ])
    expect(fraseDiferencia(c.diferencia.cent)).toBe('133,10 € más en GoCardless que en Sumied')
    expect(fraseDiferencia(-31460)).toBe('314,60 € más en Sumied que en GoCardless')
    expect(fraseDiferencia(0)).toBeNull()
  })

  it('una baja sale como baja y un alta como alta (las líneas de Sumied)', () => {
    expect(c.altas.filas.map((f) => f.id)).toEqual([`${E}|l2`])
    expect(c.bajas.filas.map((f) => f.id)).toEqual([`${E}|l9`])
    expect(textoAltasBajas(c.altas, 'alta')).toBe('+1 alta (1 cliente)')
    expect(textoAltasBajas(c.bajas, 'baja')).toBe('−1 baja (1 cliente)')
    expect(textoAltasBajas({ titulo: '', filas: [], totalCent: 0 }, 'baja')).toBe('sin bajas')
  })

  it('el «Este mes» de cada ficha compara el mismo mes a los dos lados', () => {
    expect(c.porFicha.get(`${E}|f1`)).toEqual({ gocardlessCent: 8470, sumiedCent: 8470 })
    expect(c.porFicha.get(`${E}|f3`)).toEqual({ gocardlessCent: null, sumiedCent: 7260 })
  })

  it('si cuadran, no hay ámbar ni aviso', () => {
    const igual = cifrasDeCuotas(MES, [sus('s1', 'f1', 6050)], [recibo('f1', [['l1', 6050]])], [])
    expect(igual.diferencia).toEqual({ cent: 0, grupos: [] })
    expect(avisosDeLasCifras(igual, noCobrado([], '2026-11-26', null))).toEqual([])
  })

  it('si no cuadran, la comprobación de cada noche lo dice con la diferencia y sus grupos', () => {
    const [a] = avisosDeLasCifras(c, noCobrado([], '2026-11-26', null))
    expect(a.codigo).toBe('cuotas_no_cuadran')
    expect(a.cent).toBe(13310)
    expect(a.porque).toBe('Diciembre: GoCardless cobrará 350,90 € y las cuotas de Sumied suman 217,80 €; 133,10 € más en GoCardless que en Sumied. Por qué: '
      + 'GoCardless cobra a 1 cliente sin atar a ninguna ficha: +121,00 €; Sumied tiene cuota y GoCardless no les cobra (1 ficha): −72,60 €; '
      + 'Con un importe distinto en cada lado (1 ficha): +24,20 €; Atados, y Sumied sin cuota en diciembre (1 ficha): +60,50 €.')
  })
})

describe('R20 · «GoCardless no cobró»', () => {
  const HOY = '2026-11-26'
  const cargo = (id: string, fecha: string, importeCent: number, x: Partial<CargoParaDeuda> = {}): CargoParaDeuda => ({
    id, empresaId: E, fichaId: 'f1', nombre: 'Ficha f1', suscripcionId: 'sub-1', estado: 'failed', fecha, importeCent,
    mandatoActivo: true, cobradoDespues: false, cobradoPorOtraVia: false, ...x,
  })
  const cargos = [
    cargo('c1', '2026-05-04', 6050, { suscripcionId: 'sub-a', mandatoActivo: false }), // mandato cancelado: cuenta
    cargo('c2', '2026-10-04', 6050, { suscripcionId: 'sub-b', estado: 'charged_back', fichaId: 'f2', nombre: 'Ficha f2' }),
    cargo('c3', '2026-11-04', 2420, { suscripcionId: 'sub-c' }),
    cargo('c4', '2026-09-04', 2420, { suscripcionId: 'sub-d' }), cargo('c5', '2026-10-04', 2420, { suscripcionId: 'sub-d', estado: 'paid_out' }), // cobrado después
    cargo('c6', '2026-08-04', 1210, { suscripcionId: 'sub-e', cobradoPorOtraVia: true }),
    cargo('c7', '2026-08-04', 1210, { suscripcionId: 'sub-f', cobradoDespues: true }),
  ]

  it('recibo a recibo, también con el mandato cancelado, y la lista suma la cifra', () => {
    const n = noCobrado(cargos, HOY, null)
    expect(n.titulo).toBe('GoCardless no cobró')
    expect(n.lista.filas.map((f) => f.id)).toEqual(['c1', 'c2', 'c3'])
    expect(n.lista.totalCent).toBe(14520)
    expect(n.conMandatoCancelado.filas.map((f) => f.id)).toEqual(['c1'])
    expect(n.tramos.map((t) => [t.texto, t.lista.totalCent])).toEqual([['Hasta 30 días', 2420], ['De 31 a 60 días', 6050], ['De 61 a 90 días', 0], ['Más de 90 días', 6050]])
    expect(n.tramos.reduce((s, t) => s + t.lista.totalCent, 0)).toBe(n.lista.totalCent)
    expect(fraseNoCobrado(n)).toBe('Fallidos y devueltos en GoCardless desde mayo, sin cobrar después · 3 recibos de 2 clientes')
  })

  it('cruzado con el banco pasa a «Te deben» y descuenta lo pagado por el banco; la tarjeta sin asignar no se descuenta', () => {
    const n = noCobrado(cargos, HOY, { pagadosPorElBanco: new Set(['c2']), tarjetaSinAsignarCent: 5000 })
    expect(n.titulo).toBe('Te deben')
    expect(n.lista.filas.map((f) => f.id)).toEqual(['c1', 'c3'])
    expect(n.pagadoPorElBanco?.totalCent).toBe(6050)
    expect(n.tarjetaSinAsignarCent).toBe(5000)
    expect(n.lista.totalCent).toBe(8470)
  })
})

describe('R20 · altas y bajas trabajador a trabajador', () => {
  it('un trabajador que entra es un alta y uno que se cobra por última vez el mes anterior es una baja, aunque la línea siga', () => {
    const conTrab = (fichaId: string, id: string, n: number, altas: string[], bajas: string[]): ReciboDeFicha => ({
      empresaId: E, fichaId, nombre: `Ficha ${fichaId}`, lineas: [{ id, texto: `Gestión laboral · ${n} trabajadores`, importeCent: n * 2420, altas, bajas }], totalCent: n * 2420 })
    const c = cifrasDeCuotas(MES, [], [conTrab('f1', 'a1', 3, ['Persona Prueba C'], [])], [conTrab('f1', 'a1', 3, [], ['Persona Prueba B'])])
    expect(c.altas.filas.map((f) => f.detalle)).toEqual(['Gestión laboral · alta de Persona Prueba C'])
    expect(c.bajas.filas.map((f) => f.detalle)).toEqual(['Gestión laboral · baja de Persona Prueba B'])
    expect([c.altas.soloCuenta, textoAltasBajas(c.altas, 'alta'), textoAltasBajas(c.bajas, 'baja')]).toEqual([true, '+1 alta (1 cliente)', '−1 baja (1 cliente)'])
  })
})
