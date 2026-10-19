// tests/unit/modules/conta/i01b/porque_corto.test.ts
//
// I01b · 0250 · «Por qué te salen estos» con los nombres cortos del tablero 8
// («IVA (303)», «Retenciones (111)», «Sociedades (200 y 202)», «Terceros (347)»)
// y «No te sale el 349: …». Los porqués son los que escribe la base, copiados
// de conta_impuesto_reglas (0250) y de conta_impuesto_obligacion_decidir (0120),
// no inventados (regla 31): los de la empresa A de staging y los del 349.

import { describe, expect, it } from 'vitest'
import { noTeSale, porQueEnCorto, type ModeloLista } from '@/modules/conta/impuestos/calendario'

const m = (modelo: string, por_que: string, origen: ModeloLista['origen'] = 'rule'): ModeloLista => ({ modelo, nombre: `Modelo ${modelo}`, por_que, origen })

// La empresa A de staging, en el orden en que los devuelve la base (por número).
const A: ModeloLista[] = [
  m('111', 'Tienes 3 personas en nómina: declaras cada trimestre lo que les retienes.'),
  m('115', 'Lo propuso el alta con tus respuestas.'),
  m('180', 'Lo propuso el alta con tus respuestas.'),
  m('190', 'Presentas el 111: en enero resumes el año en el 190.'),
  m('200', 'Eres una sociedad: en julio presentas el Impuesto sobre Sociedades del año.'),
  m('202', 'Eres una sociedad: adelantas el Impuesto sobre Sociedades en abril, octubre y diciembre.'),
  m('303', 'Vendes con IVA: cada trimestre declaras lo que cobras menos lo que pagas.'),
  m('347', 'No llevas el SII: en febrero declaras a quien te compró o vendió más de 3.005,06 € en el año.'),
  m('390', 'Presentas el 303: en enero resumes el año en el 390.'),
]

describe('los que le salen, con el nombre corto del tablero', () => {
  it('en el orden de la maqueta, con el porqué en minúscula detrás del «·»', () => {
    expect(porQueEnCorto(A).map((l) => `${l.titulo} · ${l.porque}`)).toEqual([
      'IVA (303) · vendes con IVA: cada trimestre declaras lo que cobras menos lo que pagas.',
      'Retenciones (111) · tienes 3 personas en nómina: declaras cada trimestre lo que les retienes.',
      'Alquiler (115) · lo propuso el alta con tus respuestas.',
      'Sociedades (200 y 202) · eres una sociedad: en julio presentas el Impuesto sobre Sociedades del año; adelantas el Impuesto sobre Sociedades en abril, octubre y diciembre.',
      'Terceros (347) · no llevas el SII: en febrero declaras a quien te compró o vendió más de 3.005,06 € en el año.',
      'Resumen del IVA (390) · presentas el 303: en enero resumes el año en el 390.',
      'Resumen de retenciones (190) · presentas el 111: en enero resumes el año en el 190.',
      'Resumen del alquiler (180) · lo propuso el alta con tus respuestas.',
    ])
  })
  it('el 349 de Foodint, cuando le sale por sus compras a la UE', () => {
    const [l] = porQueEnCorto([m('349', 'En los últimos 12 meses tienes 16 compras a empresas de la UE: las operaciones intracomunitarias se declaran en el 349 el trimestre en que se hacen.')])
    expect(`${l.titulo} · ${l.porque}`).toBe('Operaciones con la UE (349) · en los últimos 12 meses tienes 16 compras a empresas de la UE: las operaciones intracomunitarias se declaran en el 349 el trimestre en que se hacen.')
  })
  it('un modelo que no conoce la lista corta, con su nombre de siempre', () => {
    expect(porQueEnCorto([m('123', 'Lo añadiste tú: retenciones de capital.', 'added')])[0].titulo).toBe('Modelo 123 (123)')
  })
  it('con una sola de sociedades, sin «y»', () => {
    expect(porQueEnCorto([A[4]])[0].titulo).toBe('Sociedades (200)')
  })
})

describe('«No te sale el …»', () => {
  it('el 349 sin operaciones con la UE ni respuesta del ROI (la regla de la 0250)', () => {
    expect(noTeSale([m('349', 'No tienes compras ni ventas con empresas de la UE en los últimos 12 meses.')]))
      .toEqual([{ clave: '349', texto: 'No te sale el 349: no tienes compras ni ventas con empresas de la UE en los últimos 12 meses.' }])
  })
  it('quitado a mano, con el motivo de la persona', () => {
    expect(noTeSale([m('349', 'Lo quitaste tú: La gestoría no lo presenta', 'removed')])[0].texto)
      .toBe('No te sale el 349: lo quitaste tú: La gestoría no lo presenta')
  })
})
