// S02 · PR 2 (Julio, 22/10) · Bancos › Movimientos › «Por validar»: lo casado
// cuyo asiento sigue propuesto se valida aquí, con su veredicto.
//
// La población real (producción, Foodint, 22/10/2026, leída con account_id —regla 9—):
//   los 25 journal_entry propuestos de source_type 'bank', cada uno con su
//   bank_match vivo y su bank_movement 'casado' de la misma cuenta:
//     Cuenta principal · persona · probable · 16 (14 'cuenta' + 2 'factura_recibida')
//     BBVA ···0133     · persona · probable ·  7 (6 + 1)
//     BBVA ···4525     · folvy   · seguro   ·  2
//   del 01/10 al 14/10, los 25 cuadran (debe = haber) y conta_motivos_para_validar
//   no devuelve ningún motivo para ninguno.
// Las pruebas van contra ESA forma, no contra ejemplos inventados (regla 31).

import { describe, expect, it } from 'vitest'
import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import { BANDEJAS, bandejaDe, cuadreDe, enBandeja, porValidar } from '@/modules/conta/lib/conciliarVista'
import { conVeredicto, listosParaValidar, siguienteTras, textoValidados, veredictoBanco } from '@/modules/conta/lib/validarBanco'
import { NOMBRE_SITIO, seDecideEnSuSitio } from '@/modules/conta/lib/diario'

let n = 0
function casado(banco: string, porQuien: 'folvy' | 'persona', confianza: 'seguro' | 'probable', p: Partial<MovimientoBanco> = {}, estadoAsiento: 'propuesto' | 'validado' = 'propuesto'): MovimientoBanco {
  n++
  return {
    id: `m${n}`, cuentaId: banco, fecha: `2026-10-${String(1 + (n % 14)).padStart(2, '0')}`, importeCent: -10_000, conceptoBanco: 'Pago con tarjeta', conceptoLimpio: 'CATCHER',
    contraparte: 'CATCHER', tipo: 'PAGO CON TARJETA', estado: 'casado', confianza, porque: 'Por la regla de CATCHER', propuesta: null, tarjeta: null, ticket: null, motivoIgnorado: null,
    casado: { id: `c${n}`, tipo: 'cuenta', porque: porQuien === 'folvy' ? 'Casado solo: por la regla de UBER EATS' : 'Lo dijiste tú: Otros gastos · 62900000.', porQuien, asientoId: `e${n}`, asientoConcepto: `Pago con tarjeta en DISCOS · ${n}`, asientoEstado: estadoAsiento },
    ...p,
  }
}

const REAL: MovimientoBanco[] = [
  ...Array.from({ length: 16 }, () => casado('principal', 'persona', 'probable')),
  ...Array.from({ length: 7 }, () => casado('bbva0133', 'persona', 'probable')),
  ...Array.from({ length: 2 }, () => casado('bbva4525', 'folvy', 'seguro')),
]
const NADA = new Map<string, string>()

describe('los 25 de producción salen en «Por validar» de su banco', () => {
  it('los 25 salen en «Por validar» (va entre «Por aclarar» y «Casados solos»); los 2 que casé yo, también en «Casados solos»', () => {
    expect(BANDEJAS.map((b) => b.nombre)).toEqual(['Para confirmar', 'Por aclarar', 'Por validar', 'Casados solos', 'Todos'])
    expect(REAL.filter((m) => enBandeja(m, 'validar'))).toHaveLength(25)
    expect(REAL.filter((m) => enBandeja(m, 'casados'))).toHaveLength(2)
    expect(REAL.filter((m) => enBandeja(m, 'todos'))).toHaveLength(25)
  })
  it('por banco: 16, 7 y 2, y los contadores lo dicen', () => {
    const de = (b: string) => cuadreDe(REAL.filter((m) => m.cuentaId === b), null, null, '2026-10').cuenta.validar
    expect([de('principal'), de('bbva0133'), de('bbva4525')]).toEqual([16, 7, 2])
  })
  it('y Contabilidad › Asientos ya no los enseña: su sitio es «Por validar»', () => {
    expect(seDecideEnSuSitio({ estado: 'propuesto', origen: 'bank' })).toBe('bancos')
    expect(NOMBRE_SITIO.bancos).toBe('Bancos › Movimientos › Por validar')
  })
  it('los 25 son «Lista para contabilizar»: 23 los casaste tú y 2 los casé yo seguro; «Validar los 25»', () => {
    const xs = conVeredicto(REAL, NADA)
    expect(xs.map((x) => x.v.titulo)).toEqual(Array(25).fill('Lista para contabilizar'))
    expect(listosParaValidar(xs)).toHaveLength(25)
    expect(xs[0].v.porque).toBe('Lo casaste tú al confirmarlo: lo dijiste tú: Otros gastos · 62900000.')
    expect(xs[24].v.porque).toBe('Lo casé solo y estoy seguro: por la regla de UBER EATS.')
  })
})

describe('el veredicto y lo que entra en bloque', () => {
  it('casado solo sin seguridad: «Revisa esto», y no entra en «Validar los N»', () => {
    const m = casado('b', 'folvy', 'probable')
    expect(veredictoBanco(m, null)).toEqual({ tipo: 'revisa', titulo: 'Revisa esto', porque: 'Lo casé sin estar seguro (Por la regla de UBER EATS): míralo antes de validar.' })
    expect(listosParaValidar(conVeredicto([m], NADA))).toEqual([])
  })
  it('lo que la base pararía: «Aún no se puede validar», con su motivo; tampoco entra', () => {
    const m = casado('b', 'persona', 'probable')
    const xs = conVeredicto([m], new Map([[m.casado!.asientoId!, 'El mes de octubre está cerrado']]))
    expect(xs[0].v).toEqual({ tipo: 'revisa', titulo: 'Aún no se puede validar', porque: 'El mes de octubre está cerrado.' })
    expect(listosParaValidar(xs)).toEqual([])
  })
  it('validado, ya no está en «Por validar»: es libro (lo que casé yo sigue en «Casados solos»)', () => {
    expect(porValidar(casado('b', 'persona', 'probable', {}, 'validado'))).toBe(false)
    expect(bandejaDe(casado('b', 'folvy', 'seguro', {}, 'validado'))).toBe('casados')
    expect(bandejaDe(casado('b', 'persona', 'probable', {}, 'validado'))).toBeNull()
  })
  it('la banda y los contadores, de la misma cuenta: casados solos con o sin validar, y lo que queda por validar', () => {
    const movs = [casado('b', 'folvy', 'seguro'), casado('b', 'folvy', 'seguro', {}, 'validado'), casado('b', 'persona', 'probable')]
    const c = cuadreDe(movs, null, null, '2026-10')
    expect(c.cuenta).toEqual({ confirmar: 0, aclarar: 0, validar: 2, casados: 2, todos: 3 })
    expect(c.frase).toBe('He casado yo 2 de 3 movimientos de octubre. Te quedan 0 por confirmar y 0 por aclarar, y 2 por validar.')
  })
})

describe('«Validar y siguiente» y lo que dice la pantalla', () => {
  it('tras validar, la siguiente; tras la última, nada (S01d: solo hacia delante, y la tarjeta de fin de cuenta)', () => {
    expect(siguienteTras(['a', 'b', 'c'], 'a')).toBe('b')
    expect(siguienteTras(['a', 'b', 'c'], 'c')).toBeNull()
    expect(siguienteTras(['a'], 'a')).toBeNull()
  })
  it('en bloque: cuántos, qué números, y lo que no se ha podido uno a uno (regla 8)', () => {
    expect(textoValidados([1203, 1201, 1202], [], 3)).toEqual({ tipo: 'ok', texto: 'Validados los 3 (asientos 1201 a 1203): ya están en el libro diario.' })
    expect(textoValidados([7], [], 1).texto).toBe('Validado el 1 (el asiento 7): ya está en el libro diario.')
    expect(textoValidados([5, 9], ['05/10 de -100,00 €: el mes está cerrado'], 3)).toEqual({ tipo: 'error', texto: 'Validados 2 de 3 (asientos 5, 9). No he podido: 05/10 de -100,00 €: el mes está cerrado' })
  })
})
