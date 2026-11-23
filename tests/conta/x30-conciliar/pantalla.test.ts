// tests/conta/x30-conciliar/pantalla.test.ts
//
// X30 · Lo que decide la pantalla Conciliar: la regla que sale de un movimiento y casa con él, su frase, a cuántos
// pendientes se aplicaría, lo que se guarda en bank_rule y lo que se lee; el porcentaje y «Sumied · cuándo» en el «Por
// qué»; los días del aviso por empresa; y el comienzo del día de Madrid todo el año. Datos inventados.
import { describe, expect, it } from 'vitest'
import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import { avisos, inicioDelDiaEnMadrid, porQueDe, textosDeAvisos, type Linea } from '@/modules/conta/nucleo/conciliar/conciliar'
import { aCuantosAplica, aLaBase, deLaBase, destinoDeRegla, faltaEnRegla, fraseDeRegla, reglaDesdeMovimiento, textoDelMovimiento, type ReglaEd } from '@/modules/conta/nucleo/conciliar/reglas'

const mov = (id: string, concepto: string, importe: number, x: Partial<MovimientoBanco> = {}): MovimientoBanco => ({
  id, cuentaId: 'b1', fecha: '2026-11-20', importeCent: Math.round(importe * 100), conceptoBanco: concepto, conceptoLimpio: concepto,
  estado: 'por_aclarar', confianza: null, porque: null, propuesta: null, casado: null, tarjeta: null, ticket: null, motivoIgnorado: null, ...x,
})
const linea = (m: MovimientoBanco, x: Partial<Linea> = {}): Linea => ({ m, antes: false, validado: false, subcuenta: null, ...x })
const vacia = { cuenta: '62800000', concepto: '', local: null, marca: null, plataforma: null }

describe('la regla que sale de un movimiento', () => {
  it('casa con su propio movimiento aunque en el concepto haya una «SL» en medio', () => {
    const m = mov('a', 'TRANSFERENCIA CATCHER MARKETPLACE SL · RECARGA SALDO PREPAGO REF 2611', -600)
    const t = textoDelMovimiento(m)
    expect(t).toBe('CATCHER MARKETPLACE')
    expect(aCuantosAplica(reglaDesdeMovimiento(m, vacia), [linea(m)]).map((l) => l.m.id)).toEqual(['a'])
  })
  it('sin contraparte, las palabras con sentido (sin «RECIBO», «ADEUDO», números)', () => {
    expect(textoDelMovimiento(mov('b', 'ADEUDO RECIBO IBERDROLA CLIENTES 0000123', -42.35))).toBe('IBERDROLA CLIENTES')
  })
  it('lleva el signo, el banco, la subcuenta; el importe, de partida «cualquiera»', () => {
    const r = reglaDesdeMovimiento(mov('c', 'RECIBO IBERDROLA', -42.35), vacia)
    expect(r).toMatchObject({ signo: 'pago', bancoId: 'b1', cuenta: '62800000', importe: { modo: 'cualquiera', exacto: 42.35 } })
  })
})

describe('la frase y lo que falta', () => {
  const r: ReglaEd = { id: null, contiene: 'TGSS', signo: 'pago', importe: { modo: 'cualquiera', exacto: null, desde: null, hasta: null }, bancoId: null, cuenta: '64200000',
    concepto: '', local: null, marca: null, plataforma: null }
  it('«Si el concepto contiene “TGSS” y es un pago → 64200000 · S.S. A CARGO DE LA EMPRESA»', () => {
    expect(fraseDeRegla(r, () => 'S.S. a cargo de la empresa')).toBe('Si el concepto contiene “TGSS” y es un pago → 64200000 · S.S. A CARGO DE LA EMPRESA')
    expect(fraseDeRegla({ ...r, importe: { modo: 'entre', exacto: null, desde: 300, hasta: 350 } }, () => ''))
      .toBe('Si el concepto contiene “TGSS”, es un pago y va de 300,00 € a 350,00 € → 64200000')
  })
  it('sin texto, sin subcuenta o con un «entre» al revés, no se guarda y dice qué falta', () => {
    expect(faltaEnRegla({ ...r, contiene: 'TG' })).toBe('Escribe al menos tres letras del concepto.')
    expect(faltaEnRegla({ ...r, cuenta: null })).toBe('Falta la subcuenta.')
    expect(faltaEnRegla({ ...r, importe: { modo: 'entre', exacto: null, desde: 400, hasta: 300 } })).toMatch(/en orden/)
    expect(faltaEnRegla(r)).toBeNull()
  })
})

describe('a cuántos pendientes se aplicaría', () => {
  const ls = [
    linea(mov('1', 'RECIBO IBERDROLA CLIENTES', -42.35)),
    linea(mov('2', 'RECIBO IBERDROLA CLIENTES', -55.10)),
    linea(mov('3', 'ABONO IBERDROLA CLIENTES DEVOLUCION', 10)),                      // ingreso: no
    linea(mov('4', 'RECIBO IBERDROLA CLIENTES', -30, { cuentaId: 'b2' })),           // otro banco
    linea(mov('5', 'RECIBO IBERDROLA CLIENTES', -30, { estado: 'casado' })),         // ya contabilizado: no
    linea(mov('6', 'RECIBO IBERDROLA CLIENTES', -30), { antes: true }),              // de antes del inicio: no
  ]
  const r: ReglaEd = { id: null, contiene: 'IBERDROLA', signo: 'pago', importe: { modo: 'cualquiera', exacto: null, desde: null, hasta: null }, bancoId: null, cuenta: '62800000',
    concepto: 'Luz', local: null, marca: null, plataforma: null }
  it('los pagos pendientes que casan, de todos los bancos; ni el ingreso, ni lo contabilizado, ni lo de antes del inicio', () => {
    expect(aCuantosAplica(r, ls).map((l) => l.m.id)).toEqual(['1', '2', '4'])
  })
  it('con banco y con importe, menos', () => {
    expect(aCuantosAplica({ ...r, bancoId: 'b1' }, ls).map((l) => l.m.id)).toEqual(['1', '2'])
    expect(aCuantosAplica({ ...r, importe: { modo: 'exacto', exacto: 42.35, desde: null, hasta: null } }, ls).map((l) => l.m.id)).toEqual(['1'])
    expect(aCuantosAplica({ ...r, importe: { modo: 'entre', exacto: null, desde: 40, hasta: 60 } }, ls).map((l) => l.m.id)).toEqual(['1', '2'])
  })
  it('el destino de cada uno: la subcuenta por su importe y el concepto de la regla', () => {
    expect(destinoDeRegla(r, ls[1].m)).toEqual({ tipo: 'cuenta', concepto: 'Luz', lineas: [{ cuenta: '62800000', importe: 55.1 }] })
  })
})

describe('lo que se guarda en bank_rule y lo que se lee', () => {
  it('ida y vuelta: condición (texto, signo, importe, banco) y destino (cuenta, concepto, analítica)', () => {
    const r: ReglaEd = { id: 'r1', contiene: 'iberdrola', signo: 'pago', importe: { modo: 'entre', exacto: null, desde: 30, hasta: 60 }, bancoId: 'b1', cuenta: '62800000',
      concepto: 'Luz', local: '00000000-0000-4000-8000-000000000001', marca: null, plataforma: 'comun' }
    const b = aLaBase(r)
    expect(b).toEqual({ palabras: 'IBERDROLA', condicion: { contiene: 'IBERDROLA', signo: -1, importe: { desde: 30, hasta: 60 }, banco: 'b1' },
      destino: { cuenta: '62800000', concepto: 'Luz', local_id: '00000000-0000-4000-8000-000000000001' } })
    const v = deLaBase({ id: 'r1', words: b.palabras, condition: b.condicion, target: b.destino, status: 'activa', confirmations: 2, corrections: 0, seed: null, applies_from: null, veces: 5, ultima: '2026-11-20T08:00:00Z' })
    expect(v).toMatchObject({ contiene: 'IBERDROLA', signo: 'pago', importe: { modo: 'entre', desde: 30, hasta: 60 }, bancoId: 'b1', cuenta: '62800000', concepto: 'Luz', veces: 5, partida: false })
  })
  it('las de partida se leen como tales', () => {
    expect(deLaBase({ id: 'p', words: 'MOVISTAR', condition: { contiene: 'MOVISTAR', signo: -1 }, target: { cuenta: '62900000', que: 'Teléfono' }, status: 'activa', seed: 'partida' }))
      .toMatchObject({ partida: true, que: 'Teléfono', importe: { modo: 'cualquiera' } })
  })
})

describe('el «Por qué» con su porcentaje y quién concilió solo', () => {
  it('«Como 6 ant. · 91 %», «Regla · TGSS · 75 %»; sin porcentaje (de antes del X30), la palabra', () => {
    const p = (origen: string, porque: string, seguridad?: number) => linea(mov('x', 'x', -10, { estado: 'propuesto', confianza: 'probable', porque,
      propuesta: { origen, seguridad, destino: { tipo: 'cuenta', lineas: [{ cuenta: '1', importe: 1 }] } } }))
    expect(porQueDe(p('historial', 'Las 6 anteriores de este concepto fueron Suministros.', 91))?.texto).toBe('Como 6 ant. · 91 %')
    expect(porQueDe(p('regla', 'Regla: TGSS (confirmada 2 veces; a la 3.ª caso sola).', 75))?.texto).toBe('Regla · TGSS · 75 %')
    expect(porQueDe(p('historial', 'Las 6 anteriores fueron Suministros.'))?.texto).toBe('Como 6 ant. · probable')
  })
  it('lo conciliado por Sumied solo: «Sumied · 23/11 08:12», y en el title su porcentaje y por qué', () => {
    const l = linea(mov('y', 'x', -10, { estado: 'casado', casado: { id: 'c', tipo: 'cuenta', porque: 'Regla confirmada 4 veces: TGSS.', porQuien: 'folvy', asientoId: 'a', asientoConcepto: null,
      cuando: '2026-11-23T07:12:00Z', seguridad: 99 } }))
    const p = porQueDe(l)!
    expect(p).toMatchObject({ texto: 'Sumied · 23/11 08:12', tono: 'solo' })
    expect(p.title).toBe('Lo concilió Sumied solo el 23/11 08:12 con un 99 % · Regla · Regla confirmada 4 veces: TGSS.')
  })
})

describe('los días del aviso y el «hoy» de Madrid', () => {
  it('los días del aviso, los de la empresa', () => {
    const ls = [linea(mov('v', 'x', -10, { fecha: '2026-11-15' }))]
    expect(textosDeAvisos(avisos(ls, [], '2026-11-23', 7))).toEqual(['1 movimiento lleva más de 7 días sin conciliar', '1 pago sin factura'])
    expect(textosDeAvisos(avisos(ls, [], '2026-11-23'))).toEqual(['1 pago sin factura'])
  })
  it('las 00:00 de Madrid, en invierno y en verano, y el día del cambio de hora', () => {
    expect(inicioDelDiaEnMadrid('2026-11-23')).toBe('2026-11-22T23:00:00.000Z')
    expect(inicioDelDiaEnMadrid('2026-07-01')).toBe('2026-06-30T22:00:00.000Z')
    expect(inicioDelDiaEnMadrid('2026-03-29')).toBe('2026-03-28T23:00:00.000Z')
    expect(inicioDelDiaEnMadrid('2026-10-25')).toBe('2026-10-24T22:00:00.000Z')
  })
})
