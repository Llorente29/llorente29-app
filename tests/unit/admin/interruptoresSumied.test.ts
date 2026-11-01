// S01f · Los interruptores de Sumied de una cuenta: la regla «sin Contabilidad
// no hay Impuestos ni Laboral», la línea de cada fila y las frases (regla 8).
// Cuenta y nombres inventados.
import { describe, expect, it } from 'vitest'
import {
  FRASE_BLOQUEADA, avisoApagar, bloqueada, fraseConfirmacion, lineaDeEstado, type Interruptor,
} from '@/admin/lib/interruptoresSumied'

const i = (x: Partial<Interruptor> & Pick<Interruptor, 'clave'>): Interruptor =>
  ({ encendida: false, existe: false, cambiada: null, quien: null, motivo: null, ...x })

describe('S01f · sin Contabilidad no hay Impuestos ni Laboral', () => {
  it('con la contabilidad apagada, impuestos y laboral no se pueden encender; la contabilidad sí', () => {
    const todos = [i({ clave: 'conta' }), i({ clave: 'conta_impuestos' }), i({ clave: 'conta_laboral' })]
    expect(bloqueada(todos[0], todos)).toBe(false)
    expect(bloqueada(todos[1], todos)).toBe(true)
    expect(bloqueada(todos[2], todos)).toBe(true)
    expect(FRASE_BLOQUEADA).toBe('Enciende antes la contabilidad.')
  })
  it('con la contabilidad encendida, nada está bloqueado', () => {
    const todos = [i({ clave: 'conta', encendida: true, existe: true }), i({ clave: 'conta_impuestos' }), i({ clave: 'conta_laboral' })]
    expect(todos.some((x) => bloqueada(x, todos))).toBe(false)
  })
})

describe('S01f · la línea de cada fila dice lo que consta y lo que no', () => {
  it('con quién y motivo', () => {
    expect(lineaDeEstado(i({ clave: 'conta', encendida: true, existe: true, cambiada: '2026-10-31T10:00:00Z', quien: 'Persona Inventada', motivo: 'Alta de cliente nuevo' })))
      .toBe('Encendida desde el 31/10/2026 por Persona Inventada · «Alta de cliente nuevo»')
  })
  it('las de antes, sin quién: «no consta quién», y el motivo si lo tienen', () => {
    expect(lineaDeEstado(i({ clave: 'conta', encendida: true, existe: true, cambiada: '2026-10-06T09:00:00Z' })))
      .toBe('Encendida desde el 06/10/2026 · no consta quién · sin motivo apuntado')
    expect(lineaDeEstado(i({ clave: 'conta_laboral', encendida: true, existe: true, cambiada: '2026-10-29T09:00:00Z', motivo: 'Laboral en la cuenta' })))
      .toBe('Encendida desde el 29/10/2026 · no consta quién · «Laboral en la cuenta»')
  })
  it('sin fila, solo «Apagada»; la fecha es la de Madrid', () => {
    expect(lineaDeEstado(i({ clave: 'conta_impuestos' }))).toBe('Apagada')
    expect(lineaDeEstado(i({ clave: 'conta', existe: true, cambiada: '2026-10-31T23:30:00Z', quien: 'Persona Inventada', motivo: 'x' })))
      .toBe('Apagada desde el 01/11/2026 por Persona Inventada · «x»')
  })
})

describe('S01f · la confirmación lleva contenido (regla 8)', () => {
  it('encender', () => {
    expect(fraseConfirmacion('Bar Inventado', 'conta', true, [{ clave: 'conta', de: false, a: true }]))
      .toBe('Encendida la contabilidad de Bar Inventado. Ya sale Sumied en su menú.')
    expect(fraseConfirmacion('Bar Inventado', 'conta_laboral', true, [{ clave: 'conta_laboral', de: false, a: true }]))
      .toBe('Encendido lo laboral de Bar Inventado. Ya sale en su Sumied.')
    expect(fraseConfirmacion('Bar Inventado', 'conta_impuestos', true, [{ clave: 'conta_impuestos', de: false, a: true }]))
      .toBe('Encendidos los impuestos de Bar Inventado. Ya salen en su Sumied.')
  })
  it('apagar la contabilidad dice qué más se ha apagado, y que no se ha borrado nada', () => {
    expect(fraseConfirmacion('Bar Inventado', 'conta', false, [{ clave: 'conta', de: true, a: false }, { clave: 'conta_impuestos', de: true, a: false }, { clave: 'conta_laboral', de: true, a: false }]))
      .toBe('Apagada la contabilidad de Bar Inventado: Sumied ya no sale en su menú. También se han apagado los impuestos y lo laboral. No se ha borrado nada.')
    expect(fraseConfirmacion('Bar Inventado', 'conta', false, [{ clave: 'conta', de: true, a: false }, { clave: 'conta_laboral', de: true, a: false }]))
      .toBe('Apagada la contabilidad de Bar Inventado: Sumied ya no sale en su menú. También se ha apagado lo laboral. No se ha borrado nada.')
  })
  it('apagar impuestos o laboral', () => {
    expect(fraseConfirmacion('Bar Inventado', 'conta_impuestos', false, [{ clave: 'conta_impuestos', de: true, a: false }]))
      .toBe('Apagados los impuestos de Bar Inventado: ya no salen en su Sumied. No se ha borrado nada.')
  })
  it('si no cambia nada, también lo dice', () => {
    expect(fraseConfirmacion('Bar Inventado', 'conta_laboral', true, []))
      .toBe('No ha cambiado nada: el interruptor «Laboral» de Bar Inventado ya estaba encendido.')
  })
})

describe('S01f · el aviso de apagar la contabilidad con datos dentro', () => {
  const todos = [i({ clave: 'conta', encendida: true, existe: true }), i({ clave: 'conta_impuestos', encendida: true, existe: true }), i({ clave: 'conta_laboral', encendida: true, existe: true })]
  it('dice qué tiene y qué más se apaga; y que no se borra nada', () => {
    expect(avisoApagar('Bar Inventado', { asientos: 15365, facturasRecibidas: 116, impuestos: 14 }, todos)).toEqual({
      titulo: 'Bar Inventado tiene datos en Sumied',
      texto: '15.365 asientos, 116 facturas recibidas y 14 impuestos. Al apagar la contabilidad, Sumied deja de salir en su menú y nadie de la cuenta los ve; también se apagan «Impuestos» y «Laboral». No se borra nada: al volver a encenderla, todo sigue ahí.',
    })
  })
  it('sin datos dentro, no hay aviso', () => {
    expect(avisoApagar('Bar Inventado', { asientos: 0, facturasRecibidas: 0, impuestos: 0 }, todos)).toBeNull()
  })
})
