// tests/unit/modules/conta/c06b/porQueNoSeValida.test.ts
//
// C06b (Julio, 21/10): «Validar asiento» en gris con su motivo antes de pulsar.
// Los motivos son los de conta_motivos_para_validar (20261117T0100), con sus
// códigos y sus textos reales; el del envío por aclarar es el que la base da
// hoy (el mismo que espera la e2e c06/promociones).

import { describe, expect, it } from 'vitest'
import { porQueNoSeValida } from '@/modules/conta/lib/esperan'

const ACLARAR = { codigo: 'envio_por_aclarar', motivo: 'No se valida: 1 pedido con envío por aclarar: PR-3 (envío 2,00 €, repartió la plataforma). Se resuelve con la liquidación de esa semana.' }
const MES = { codigo: 'mes_cerrado', motivo: 'El mes de septiembre está cerrado.' }
const CUADRA = { codigo: 'no_cuadra', motivo: 'No cuadra: Debe 10.00 y Haber 9.00, diferencia 1.00.' }

describe('por qué no se valida un asiento', () => {
  it('sin motivos de la base, se puede validar', () => {
    expect(porQueNoSeValida([])).toBeNull()
  })
  it('con un envío por aclarar, bloquea y lo dice con el texto de la base', () => {
    expect(porQueNoSeValida([ACLARAR])).toEqual({ bloquea: true, texto: ACLARAR.motivo, codigos: ['envio_por_aclarar'],
      franja: '1 pedido con envío por aclarar: PR-3 (envío 2,00 €, repartió la plataforma). Se resuelve con la liquidación de esa semana.' })
  })
  it('el mes cerrado bloquea, pero no se repite: ya tiene su franja', () => {
    expect(porQueNoSeValida([MES])).toEqual({ bloquea: true, texto: null, franja: null, codigos: ['mes_cerrado'] })
  })
  it('varios motivos, en el orden de la base y sin el del mes', () => {
    expect(porQueNoSeValida([CUADRA, MES, ACLARAR])?.texto).toBe(`${CUADRA.motivo} ${ACLARAR.motivo}`)
    // En la franja, el «No cuadra» queda igual y al del envío se le quita el «No se valida:».
    expect(porQueNoSeValida([CUADRA, MES, ACLARAR])?.franja).toBe(`${CUADRA.motivo} 1 pedido con envío por aclarar: PR-3 (envío 2,00 €, repartió la plataforma). Se resuelve con la liquidación de esa semana.`)
  })
})
