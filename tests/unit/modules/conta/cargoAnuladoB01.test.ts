// tests/unit/modules/conta/cargoAnuladoB01.test.ts
//
// B01·20 · Lo que dice el aviso del cargo que el banco anula, con las cifras
// REALES del 30/10 (regla 31): ···6536, un cargo de −3.308,46 con el banco a
// 75,55; ···4525, dos cargos (−483,36 y −315,00) con el banco a 98,57. Y la
// fila de lo apartado: tachado, con su etiqueta y con «Deshacer».

import { describe, expect, it } from 'vitest'
import { MOTIVO_ANULADO, avisoDeFila, textoDesapartado, textoEsBueno, textoQuitado, textosAviso } from '@/modules/conta/lib/cargoAnulado'
import { filaDe, type MovimientoBanco } from '@/modules/conta/lib/bancosVista'

const SEIS = avisoDeFila({
  extracto: 'e-6536', banco: 'b-6536', dia: '2026-10-30', saldo_banco: 75.55, hueco: 3308.46,
  cargos: [{ id: 'm1', fecha: '2026-10-30', importe: -3308.46, concepto: 'Cuotas de LA SEGURIDAD SOCIAL // OTROS', casado: null, esta_casado: false }],
})
const CUATRO = avisoDeFila({
  extracto: 'e-4525', banco: 'b-4525', dia: '2026-10-30', saldo_banco: 98.57, hueco: 798.36,
  cargos: [
    { id: 'm2', fecha: '2026-10-30', importe: -483.36, concepto: 'Adeudo de cuota de LA SEGURIDAD SOCIAL', casado: null, esta_casado: false },
    { id: 'm3', fecha: '2026-10-30', importe: -315.0, concepto: 'Adeudo de cuota de LA SEGURIDAD SOCIAL', casado: null, esta_casado: false },
  ],
})

describe('B01·20 · el aviso del cargo que el banco anula', () => {
  it('de la base a la pantalla, en céntimos', () => {
    expect(SEIS.saldoBancoCent).toBe(7555)
    expect(SEIS.huecoCent).toBe(330846)
    expect(SEIS.cargos[0].importeCent).toBe(-330846)
    expect(CUATRO.cargos.map((c) => c.importeCent)).toEqual([-48336, -31500])
  })

  it('un cargo: las palabras y las dos cifras de la maqueta', () => {
    const t = textosAviso(SEIS)
    expect(t.titulo).toBe('El banco anuló este cargo: no había saldo')
    expect(t.porque).toBe('Lo apuntó el 30/10 y, como no había saldo, lo anuló. Su saldo no bajó ese día, y la anulación no nos ha llegado. Sin él, Sumied y el banco cuadran al céntimo.')
    expect(t.cifras).toBe('Con él: Sumied −3.232,91 € · banco 75,55 €. Sin él: los dos, 75,55 €.')
    expect(t.casado).toBeNull()
  })

  it('dos cargos: en plural, con las cifras de ···4525', () => {
    const t = textosAviso(CUATRO)
    expect(t.titulo).toBe('El banco anuló estos 2 cargos: no había saldo')
    expect(t.cifras).toBe('Con ellos: Sumied −699,79 € · banco 98,57 €. Sin ellos: los dos, 98,57 €.')
  })

  it('casado: dice que al quitarlo se deshace', () => {
    const casado = { ...SEIS, cargos: [{ ...SEIS.cargos[0], estaCasado: true, casadoCon: 'Agua' }] }
    expect(textosAviso(casado).casado).toBe('Está casado con «Agua»: al quitarlo, ese casado se deshace.')
  })

  it('«Quitarlo» confirma con contenido (regla 8)', () => {
    expect(textoQuitado({ n: 1, sumaCent: 330846, dia: '2026-10-30', saldoBancoCent: 7555, deshechos: 0 }))
      .toBe('Quitado: el cargo de 3.308,46 € del 30/10 ya no cuenta. El saldo de Sumied es el del banco: 75,55 €.')
    expect(textoQuitado({ n: 2, sumaCent: 79836, dia: '2026-10-30', saldoBancoCent: 9857, deshechos: 0 }))
      .toBe('Quitados: los 2 cargos (798,36 €) del 30/10 ya no cuentan. El saldo de Sumied es el del banco: 98,57 €.')
    expect(textoQuitado({ n: 1, sumaCent: 2116, dia: '2026-11-05', saldoBancoCent: 64, deshechos: 1 }))
      .toBe('Quitado: el cargo de 21,16 € del 05/11 ya no cuenta. El saldo de Sumied es el del banco: 0,64 €. Su casado se ha deshecho.')
  })

  it('«No, es bueno» y «Deshacer» también dicen qué ha pasado', () => {
    expect(textoEsBueno({ n: 1, sumaCent: 330846, dia: '2026-10-30' })).toBe('Hecho: el cargo de 3.308,46 € del 30/10 se queda, y no te vuelvo a avisar de él.')
    expect(textoDesapartado({ fecha: '2026-10-30', importeCent: -330846 }, MOTIVO_ANULADO))
      .toBe('Deshecho: el movimiento del 30/10 de −3.308,46 € vuelve a contar (estaba apartado: «Anulado por el banco: no había saldo»). Lo vuelvo a mirar para casarlo.')
  })
})

describe('B01·20 · la fila de lo apartado', () => {
  const mov = (p: Partial<MovimientoBanco>): MovimientoBanco => ({
    id: 'm1', cuentaId: 'b1', fecha: '2026-10-30', importeCent: -330846, conceptoBanco: 'CUOTAS SEGURIDAD SOCIAL', conceptoLimpio: 'Cuotas Seguridad Social',
    contraparte: null, tipo: null, estado: 'ignorado', confianza: null, porque: null, propuesta: null, casado: null, tarjeta: null, ticket: null, motivoIgnorado: null, ...p,
  })

  it('el que quitó el aviso: su motivo de título y «Deshacer»', () => {
    const f = filaDe(mov({ motivoIgnorado: MOTIVO_ANULADO }))
    expect(f.titulo).toBe('Anulado por el banco: no había saldo')
    expect(f.porque).toBe('No cuenta: el banco lo anuló.')
    expect(f.botones).toEqual(['desapartar'])
  })

  it('cualquier otro apartado: «Apartado», su motivo y también «Deshacer»', () => {
    const f = filaDe(mov({ motivoIgnorado: 'Personal' }))
    expect(f.titulo).toBe('Apartado')
    expect(f.porque).toBe('Personal')
    expect(f.botones).toEqual(['desapartar'])
  })
})
